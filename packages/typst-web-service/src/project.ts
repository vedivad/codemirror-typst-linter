import type { TypstAnalyzer } from "./analyzer.js";
import type {
  LspCompletionResponse,
  LspHover,
  LspPosition,
} from "./analyzer-types.js";
import { CompileScheduler } from "./compile-scheduler.js";
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
  /**
   * Scheduling for auto-compiles after VFS mutations. Mutations debounce by
   * `debounceMs`; `maxWaitMs` caps how long the debounce can keep deferring
   * during sustained edits so the user still sees progress.
   */
  autoCompile?: AutoCompileOptions;
}

export interface AutoCompileOptions {
  /**
   * Idle time (ms) after the last VFS mutation before a compile fires.
   * Default: 0 — compile fires on the next macrotask. Set higher (e.g. 150) to
   * coalesce rapid edits.
   */
  debounceMs?: number;
  /**
   * Maximum time (ms) the debounce is allowed to defer a compile during
   * sustained mutation bursts. Default: 0 (no cap — pure debounce).
   */
  maxWaitMs?: number;
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

function errorAsCompileResult(
  err: unknown,
  paths: readonly string[],
): CompileResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    diagnostics: paths.map((path) => ({
      package: "",
      path,
      severity: "Error",
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      message,
    })),
  };
}

export class TypstProject {
  private readonly compiler: TypstCompiler;
  private readonly analyzer?: TypstAnalyzer;
  private readonly analyzerUriRoot: string;
  /**
   * Tracked text files: path → latest content observed. Presence in this map
   * is the source of truth for "is this a tracked text file?"; insertion
   * order drives the `files` getter. Per-sink dedup lives in the compiler and
   * analyzer.
   */
  private readonly contentByPath = new Map<Path, string>();
  private readonly compileListeners = new Set<CompileListener>();
  private readonly scheduler: CompileScheduler;
  private compileVersion = 0;
  private _lastResult: CompileResult | undefined;
  private _entry: Path;
  private destroyed = false;

  private invokeListener(
    listener: CompileListener,
    result: CompileResult,
  ): void {
    try {
      listener(result);
    } catch (err) {
      console.error("[typst] compile listener threw:", err);
    }
  }

  constructor(options: TypstProjectOptions) {
    this.compiler = options.compiler;
    this.analyzer = options.analyzer;
    this.analyzerUriRoot = normalizeRoot(
      options.analyzerUriRoot ?? DEFAULT_ROOT,
    );
    this._entry = normalizePath(options.entry ?? DEFAULT_ENTRY);
    this.scheduler = new CompileScheduler({
      debounceMs: options.autoCompile?.debounceMs,
      maxWaitMs: options.autoCompile?.maxWaitMs,
    });
  }

  /**
   * Schedule an auto-compile after VFS mutations. Coalesces rapid calls via
   * the configured debounce/throttle. Errors surface through `onCompile`
   * listeners via a synthetic diagnostic; callers awaiting a specific compile
   * should call `compile()` directly.
   */
  private scheduleCompile(): void {
    if (this.destroyed) return;
    this.scheduler.schedule(() => {
      this.compile().catch((err) => console.error("[typst]", err));
    });
  }

  /** Current entry file path. Assign to change the sticky entry used by subsequent `compile()` calls. */
  get entry(): Path {
    return this._entry;
  }

  set entry(path: Path) {
    const next = normalizePath(path);
    if (next === this._entry) return;
    this._entry = next;
    this.scheduleCompile();
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
    return [...this.contentByPath.keys()];
  }

  /**
   * Current text content for a tracked file, or `undefined` if the path was
   * never written via `setText`/`setMany` (or was removed). Read-through to the
   * project's sync cache — lets consumers avoid shadowing the VFS themselves.
   */
  getText(path: Path): string | undefined {
    return this.contentByPath.get(normalizePath(path));
  }

  /**
   * Add or overwrite a text file. Goes to the compiler's VFS and, when an
   * analyzer is attached, to the analyzer as a document change. No-op when
   * the tracked path already has this exact content — skips both worker RPCs
   * and the auto-scheduled compile.
   */
  async setText(path: Path, content: string): Promise<void> {
    const p = normalizePath(path);
    if (this.contentByPath.get(p) === content) return;
    this.contentByPath.set(p, content);
    await Promise.all([
      this.compiler.setText(p, content),
      this.analyzer?.didChange(
        pathToAnalyzerUri(p, this.analyzerUriRoot),
        content,
      ) ?? Promise.resolve(),
    ]);
    this.scheduleCompile();
  }

  /**
   * Add or overwrite a JSON file. Compiler-only — the analyzer does not track
   * data files.
   */
  async setJson(path: Path, value: unknown): Promise<void> {
    await this.compiler.setJson(normalizePath(path), value);
    this.scheduleCompile();
  }

  /** Add or overwrite a binary file. Compiler-only. */
  async setBinary(
    path: Path,
    content: ArrayBuffer | ArrayBufferView,
  ): Promise<void> {
    await this.compiler.setBinary(normalizePath(path), content);
    this.scheduleCompile();
  }

  /**
   * Batch set multiple files. Strings route to both compiler and analyzer;
   * Uint8Array entries go to the compiler only. Strings matching the last
   * tracked content for their path are skipped on both sinks. Binary entries
   * always go through (no content cache, so no dedup).
   */
  async setMany(files: Record<Path, string | Uint8Array>): Promise<void> {
    const normalized: Record<Path, string | Uint8Array> = {};
    const analyzerDocs: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      const p = normalizePath(path);
      if (typeof content !== "string") {
        normalized[p] = content;
        continue;
      }
      if (this.contentByPath.get(p) === content) continue;
      this.contentByPath.set(p, content);
      normalized[p] = content;
      analyzerDocs[pathToAnalyzerUri(p, this.analyzerUriRoot)] = content;
    }
    if (Object.keys(normalized).length === 0) return;
    await Promise.all([
      this.compiler.setMany(normalized),
      this.analyzer?.didChangeMany(analyzerDocs) ?? Promise.resolve(),
    ]);
    this.scheduleCompile();
  }

  /**
   * Remove a file. Always removed from the compiler's VFS; also closed on the
   * analyzer when it was previously tracked as text.
   */
  async remove(path: Path): Promise<void> {
    const p = normalizePath(path);
    const wasText = this.contentByPath.delete(p);
    await Promise.all([
      this.compiler.remove(p),
      wasText
        ? this.analyzer?.didClose(pathToAnalyzerUri(p, this.analyzerUriRoot))
        : undefined,
    ]);
    this.scheduleCompile();
  }

  /** Clear all files from both compiler VFS and analyzer document set. */
  async clear(): Promise<void> {
    const uris = Array.from(this.contentByPath.keys(), (p) =>
      pathToAnalyzerUri(p, this.analyzerUriRoot),
    );
    this.contentByPath.clear();
    await Promise.all([
      this.compiler.clear(),
      uris.length > 0 ? this.analyzer?.didCloseMany(uris) : undefined,
    ]);
    this.scheduleCompile();
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
      this.invokeListener(listener, this._lastResult);
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
   *
   * VFS mutations (`setText`, `remove`, etc.) auto-schedule a debounced
   * compile; call this directly only when you need an awaitable handle on the
   * result (e.g., to flush before rendering to PDF).
   */
  async compile(): Promise<CompileResult> {
    this.scheduler.cancel();
    const version = ++this.compileVersion;
    let result: CompileResult;
    try {
      result = await this.compiler.compile(this._entry);
    } catch (err) {
      // Spread the synthetic error across every tracked text path so the
      // diagnostic is visible no matter which file the user is viewing.
      // Falls back to the entry if nothing is tracked yet.
      const paths =
        this.contentByPath.size > 0
          ? [...this.contentByPath.keys()]
          : [this._entry];
      result = errorAsCompileResult(err, paths);
    }
    if (version === this.compileVersion) {
      this._lastResult = result;
      for (const listener of this.compileListeners) {
        this.invokeListener(listener, result);
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

  /**
   * Request completion for `path` at `position`, using `source` as the
   * current document state. One analyzer roundtrip; compiler is not touched —
   * the compile sync path writes to the compiler separately. Throws when no
   * analyzer is attached.
   */
  completion(
    path: Path,
    source: string,
    position: LspPosition,
  ): Promise<LspCompletionResponse> {
    const analyzer = this.requireAnalyzer("completion");
    const p = normalizePath(path);
    this.contentByPath.set(p, source);
    return analyzer.completion(
      pathToAnalyzerUri(p, this.analyzerUriRoot),
      source,
      position,
    );
  }

  /**
   * Request hover for `path` at `position`, using `source` as the current
   * document state. One analyzer roundtrip; compiler is not touched. Throws
   * when no analyzer is attached.
   */
  hover(
    path: Path,
    source: string,
    position: LspPosition,
  ): Promise<LspHover | null> {
    const analyzer = this.requireAnalyzer("hover");
    const p = normalizePath(path);
    this.contentByPath.set(p, source);
    return analyzer.hover(
      pathToAnalyzerUri(p, this.analyzerUriRoot),
      source,
      position,
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
    this.scheduler.cancel();
    this.compileListeners.clear();
    this.contentByPath.clear();
    this._lastResult = undefined;
    this.compiler.destroy();
    this.analyzer?.destroy();
  }
}
