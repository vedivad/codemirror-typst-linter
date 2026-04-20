import type { TypstAnalyzer } from "./analyzer.js";
import type { LspCompletionResponse, LspHover } from "./analyzer-types.js";
import type { CompileResult, TypstCompiler } from "./compiler.js";
import {
  normalizePath,
  normalizeRoot,
  type Path,
  pathToAnalyzerUri,
} from "./identifiers.js";

export interface TypstProjectOptions {
  compiler: TypstCompiler;
  /**
   * Optional analyzer. When provided, text file operations also sync with the
   * analyzer so completions / hover reflect the current state.
   */
  analyzer?: TypstAnalyzer;
  /** Default entry file path. Default: "/main.typ". */
  entry?: string;
  /**
   * Prefix used to build the `untitled:` URIs handed to the analyzer.
   * Default: "/project". A path of `/main.typ` becomes
   * `untitled:project/main.typ`. Only affects URI construction — the compiler
   * and project VFS use the raw paths unchanged.
   */
  analyzerUriRoot?: string;
}

const DEFAULT_ENTRY = "/main.typ";
const DEFAULT_ROOT = "/project";

/**
 * Coordinates a compiler + analyzer pair for multi-file Typst projects.
 *
 * Owns the project's virtual filesystem state. Editors push incremental
 * `setText` updates as the user types; the project mirrors those edits to
 * both the compiler's shadow VFS and the analyzer's open-document set, then
 * compiles or services LSP requests against the current state.
 *
 *   const project = new TypstProject({ compiler, analyzer });
 *   await project.setMany({ "/main.typ": "...", "/utils.typ": "..." });
 *   const result = await project.compile();
 */
export type CompileListener = (result: CompileResult) => void;

function errorAsCompileResult(err: unknown, path: string): CompileResult {
  return {
    diagnostics: [
      {
        package: "",
        path,
        severity: "Error",
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
        message: err instanceof Error ? err.message : String(err),
      },
    ],
  };
}

export class TypstProject {
  private readonly compiler: TypstCompiler;
  private readonly analyzer?: TypstAnalyzer;
  private readonly analyzerUriRoot: string;
  private readonly trackedTextPaths = new Set<Path>();
  /** Last content written via setText/setMany, per path. Used to skip redundant writes to compiler + analyzer. */
  private readonly lastSyncedContent = new Map<Path, string>();
  private readonly compileListeners = new Set<CompileListener>();
  private compileVersion = 0;
  private _lastResult: CompileResult | undefined;
  private _entry: Path;
  private destroyed = false;

  constructor(options: TypstProjectOptions) {
    this.compiler = options.compiler;
    this.analyzer = options.analyzer;
    this.analyzerUriRoot = normalizeRoot(
      options.analyzerUriRoot ?? DEFAULT_ROOT,
    );
    this._entry = normalizePath(options.entry ?? DEFAULT_ENTRY);
  }

  /** Current entry file path. Assign to change the sticky entry used by subsequent `compile()` calls. */
  get entry(): Path {
    return this._entry;
  }

  set entry(path: Path) {
    this._entry = normalizePath(path);
  }

  /** Whether an analyzer is attached. */
  get hasAnalyzer(): boolean {
    return this.analyzer !== undefined;
  }

  /**
   * Most recent compile result, or `undefined` before the first compile has
   * settled. Useful for lazy-mounted UI that subscribes after boot and needs
   * an initial value.
   */
  get lastResult(): CompileResult | undefined {
    return this._lastResult;
  }

  /**
   * Snapshot of tracked text file paths, in insertion order. Updated by
   * `setText`, `setMany`, `remove`, and `clear`. Returns a fresh array — mutate
   * freely without affecting project state.
   */
  get files(): Path[] {
    return [...this.trackedTextPaths];
  }

  /**
   * Current text content for a tracked file, or `undefined` if the path was
   * never written via `setText`/`setMany` (or was removed). Read-through to the
   * project's sync cache — lets consumers avoid shadowing the VFS themselves.
   */
  getText(path: Path): string | undefined {
    return this.lastSyncedContent.get(normalizePath(path));
  }

  /**
   * Add or overwrite a text file. Goes to the compiler's VFS and, when an
   * analyzer is attached, to the analyzer as a document change. Redundant
   * calls with unchanged content are skipped.
   */
  async setText(path: Path, content: string): Promise<void> {
    const p = normalizePath(path);
    this.trackedTextPaths.add(p);
    if (this.lastSyncedContent.get(p) === content) return;
    this.lastSyncedContent.set(p, content);
    const ops: Array<Promise<void>> = [this.compiler.setText(p, content)];
    if (this.analyzer) {
      ops.push(
        this.analyzer.didChange(
          pathToAnalyzerUri(p, this.analyzerUriRoot),
          content,
        ),
      );
    }
    await Promise.all(ops);
  }

  /**
   * Add or overwrite a JSON file. Compiler-only — the analyzer does not track
   * data files.
   */
  setJson(path: Path, value: unknown): Promise<void> {
    return this.compiler.setJson(normalizePath(path), value);
  }

  /** Add or overwrite a binary file. Compiler-only. */
  setBinary(path: Path, content: ArrayBuffer | ArrayBufferView): Promise<void> {
    return this.compiler.setBinary(normalizePath(path), content);
  }

  /**
   * Batch set multiple files. Strings route to both compiler and analyzer;
   * Uint8Array entries go to the compiler only.
   */
  async setMany(files: Record<Path, string | Uint8Array>): Promise<void> {
    const normalized: Record<Path, string | Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      normalized[normalizePath(path)] = content;
    }
    const docs: Record<string, string> = {};
    for (const [path, content] of Object.entries(normalized)) {
      if (typeof content !== "string") continue;
      this.trackedTextPaths.add(path);
      if (this.lastSyncedContent.get(path) === content) continue;
      this.lastSyncedContent.set(path, content);
      docs[pathToAnalyzerUri(path, this.analyzerUriRoot)] = content;
    }
    const compilerOp = this.compiler.setMany(normalized);
    const analyzerOp =
      this.analyzer && Object.keys(docs).length > 0
        ? this.analyzer.didChangeMany(docs)
        : Promise.resolve();
    await Promise.all([compilerOp, analyzerOp]);
  }

  /**
   * Remove a file. Always removed from the compiler's VFS; also closed on the
   * analyzer when it was previously tracked as text.
   */
  async remove(path: Path): Promise<void> {
    const p = normalizePath(path);
    const wasText = this.trackedTextPaths.delete(p);
    this.lastSyncedContent.delete(p);
    const ops: Array<Promise<void>> = [this.compiler.remove(p)];
    if (this.analyzer && wasText) {
      ops.push(
        this.analyzer.didClose(pathToAnalyzerUri(p, this.analyzerUriRoot)),
      );
    }
    await Promise.all(ops);
  }

  /** Clear all files from both compiler VFS and analyzer document set. */
  async clear(): Promise<void> {
    const uris = Array.from(this.trackedTextPaths, (p) =>
      pathToAnalyzerUri(p, this.analyzerUriRoot),
    );
    this.trackedTextPaths.clear();
    this.lastSyncedContent.clear();
    const compilerOp = this.compiler.clear();
    const analyzerOp =
      this.analyzer && uris.length > 0
        ? this.analyzer.didCloseMany(uris)
        : Promise.resolve();
    await Promise.all([compilerOp, analyzerOp]);
  }

  /**
   * Subscribe to compile results. Fires after every `compile()` whose result is
   * still current (stale results from out-of-order concurrent compiles are
   * dropped). If a compile has already settled, the most recent result is
   * delivered synchronously so late-mounted listeners aren't stuck blank until
   * the next compile. Returns an unsubscribe function.
   */
  onCompile(listener: CompileListener): () => void {
    this.compileListeners.add(listener);
    if (this._lastResult !== undefined) {
      try {
        listener(this._lastResult);
      } catch (err) {
        console.error("[typst] compile listener threw:", err);
      }
    }
    return () => {
      this.compileListeners.delete(listener);
    };
  }

  /**
   * Compile the current VFS state using the sticky entry. Errors from the
   * underlying compiler are converted into a synthetic error diagnostic so
   * callers and listeners always receive a `CompileResult`. Listeners are
   * notified only for the most recent compile — results from an earlier call
   * that resolves after a later one are suppressed.
   */
  async compile(): Promise<CompileResult> {
    const version = ++this.compileVersion;
    let result: CompileResult;
    try {
      result = await this.compiler.compile(this._entry);
    } catch (err) {
      result = errorAsCompileResult(err, this._entry);
    }
    if (version === this.compileVersion) {
      this._lastResult = result;
      for (const listener of this.compileListeners) {
        try {
          listener(result);
        } catch (err) {
          console.error("[typst] compile listener threw:", err);
        }
      }
    }
    return result;
  }

  /** Compile the current VFS state to PDF using the sticky entry. */
  compilePdf(): Promise<Uint8Array> {
    return this.compiler.compilePdf(this._entry);
  }

  private requireAnalyzer(operation: string): TypstAnalyzer {
    if (!this.analyzer) {
      throw new Error(`TypstProject: ${operation} requires an analyzer`);
    }
    return this.analyzer;
  }

  /** Request completions at the given position. Throws when no analyzer is attached. */
  completion(
    path: Path,
    line: number,
    character: number,
  ): Promise<LspCompletionResponse> {
    return this.requireAnalyzer("completion").completion(
      pathToAnalyzerUri(normalizePath(path), this.analyzerUriRoot),
      line,
      character,
    );
  }

  /** Request hover info at the given position. Throws when no analyzer is attached. */
  hover(path: Path, line: number, character: number): Promise<LspHover | null> {
    return this.requireAnalyzer("hover").hover(
      pathToAnalyzerUri(normalizePath(path), this.analyzerUriRoot),
      line,
      character,
    );
  }

  /**
   * Tear down the project and the services it owns. Destroys the attached
   * compiler and analyzer, drops all listeners, and clears VFS tracking state.
   * Idempotent — calling twice is a no-op. After destruction, further calls on
   * the project are not supported; construct a new one.
   *
   * If you need to share a compiler or analyzer across projects, destroy them
   * yourself and don't call this method — the project does not provide an
   * ownership toggle.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.compileListeners.clear();
    this.trackedTextPaths.clear();
    this.lastSyncedContent.clear();
    this._lastResult = undefined;
    this.compiler.destroy();
    this.analyzer?.destroy();
  }
}
