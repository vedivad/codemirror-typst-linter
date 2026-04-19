import type { TypstAnalyzer } from "./analyzer.js";
import type { LspDiagnostic } from "./analyzer-types.js";
import type { CompileResult, TypstCompiler } from "./compiler.js";
import { normalizePath, normalizeRoot } from "./uri.js";

export type DiagnosticsSubscriber = (diagnostics: LspDiagnostic[]) => void;

export interface TypstProjectOptions {
  compiler: TypstCompiler;
  /**
   * Optional analyzer. When provided, text file operations also sync with the
   * analyzer so diagnostics / completions / hover reflect the current state.
   */
  analyzer?: TypstAnalyzer;
  /** Default entry file path. Default: "/main.typ". */
  entry?: string;
  /**
   * Project root used to build stable analyzer URIs. Default: "/project".
   * URIs are formed as `untitled:<root-without-leading-slash><path>` — so
   * `/main.typ` becomes `untitled:project/main.typ`.
   */
  rootPath?: string;
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
export class TypstProject {
  private readonly compiler: TypstCompiler;
  private readonly analyzer?: TypstAnalyzer;
  private readonly rootPath: string;
  private readonly trackedTextPaths = new Set<string>();
  /**
   * Last content sent to the analyzer, per path. Used to skip redundant
   * `didChange` calls and to force re-publish via hover when content matches —
   * tinymist won't re-publish on a no-op `didChange`, so cross-file edits
   * (e.g. a dependency error invalidating the active file) need a nudge.
   */
  private readonly lastSyncedContent = new Map<string, string>();
  private _entry: string;

  private readonly listenersByUri = new Map<
    string,
    Set<DiagnosticsSubscriber>
  >();
  /** Last push received per URI. Replayed on subscribe so tab-back shows correct diagnostics instantly. */
  private readonly diagnosticsCache = new Map<string, LspDiagnostic[]>();
  private readonly unsubscribeAnalyzer?: () => void;

  constructor(options: TypstProjectOptions) {
    this.compiler = options.compiler;
    this.analyzer = options.analyzer;
    this.rootPath = normalizeRoot(options.rootPath ?? DEFAULT_ROOT);
    this._entry = normalizePath(options.entry ?? DEFAULT_ENTRY);

    if (this.analyzer) {
      this.unsubscribeAnalyzer = this.analyzer.onDiagnostics(
        (uri, diagnostics) => {
          this.diagnosticsCache.set(uri, diagnostics);
          const listeners = this.listenersByUri.get(uri);
          if (!listeners) return;
          for (const listener of listeners) listener(diagnostics);
        },
      );
    }
  }

  /** Current entry file path. */
  get entry(): string {
    return this._entry;
  }

  /** Whether an analyzer is attached. */
  get hasAnalyzer(): boolean {
    return this.analyzer !== undefined;
  }

  /** Change the sticky entry file used by subsequent compile() calls. */
  setEntry(path: string): void {
    this._entry = normalizePath(path);
  }

  /**
   * Add or overwrite a text file. Goes to the compiler's VFS and, when an
   * analyzer is attached, to the analyzer as a document change. When the
   * content matches the last sync, the analyzer is nudged with a hover
   * instead so it re-publishes diagnostics that may have shifted due to
   * edits in other files.
   */
  async setText(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    this.trackedTextPaths.add(p);
    const ops: Array<Promise<void>> = [this.compiler.setText(p, content)];
    if (this.analyzer) {
      ops.push(this.syncToAnalyzer(p, content));
    }
    await Promise.all(ops);
  }

  private async syncToAnalyzer(path: string, content: string): Promise<void> {
    if (!this.analyzer) return;
    const uri = this.toUri(path);
    if (this.lastSyncedContent.get(path) === content) {
      try {
        await this.analyzer.hover(uri, 0, 0);
      } catch {
        /* best-effort — the hover result is unused */
      }
      return;
    }
    this.lastSyncedContent.set(path, content);
    await this.analyzer.didChange(uri, content);
  }

  /**
   * Add or overwrite a JSON file. Compiler-only — the analyzer does not track
   * data files.
   */
  setJson(path: string, value: unknown): Promise<void> {
    return this.compiler.setJson(normalizePath(path), value);
  }

  /** Add or overwrite a binary file. Compiler-only. */
  setBinary(
    path: string,
    content: ArrayBuffer | ArrayBufferView,
  ): Promise<void> {
    return this.compiler.setBinary(normalizePath(path), content);
  }

  /**
   * Batch set multiple files. Strings route to both compiler and analyzer;
   * Uint8Array entries go to the compiler only.
   */
  async setMany(files: Record<string, string | Uint8Array>): Promise<void> {
    const normalized: Record<string, string | Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      normalized[normalizePath(path)] = content;
    }
    const compilerOp = this.compiler.setMany(normalized);
    const analyzerOp = (async () => {
      if (!this.analyzer) return;
      const docs: Record<string, string> = {};
      for (const [path, content] of Object.entries(normalized)) {
        if (typeof content !== "string") continue;
        this.trackedTextPaths.add(path);
        if (this.lastSyncedContent.get(path) === content) continue;
        this.lastSyncedContent.set(path, content);
        docs[this.toUri(path)] = content;
      }
      if (Object.keys(docs).length > 0) {
        await this.analyzer.didChangeMany(docs);
      }
    })();
    await Promise.all([compilerOp, analyzerOp]);
  }

  /**
   * Remove a file. Always removed from the compiler's VFS; also closed on the
   * analyzer when it was previously tracked as text.
   */
  async remove(path: string): Promise<void> {
    const p = normalizePath(path);
    const wasText = this.trackedTextPaths.delete(p);
    this.lastSyncedContent.delete(p);
    const ops: Array<Promise<void>> = [this.compiler.remove(p)];
    if (this.analyzer && wasText) {
      ops.push(this.analyzer.didClose(this.toUri(p)));
    }
    await Promise.all(ops);
  }

  /** Clear all files from both compiler VFS and analyzer document set. */
  async clear(): Promise<void> {
    const uris = Array.from(this.trackedTextPaths, (p) => this.toUri(p));
    this.trackedTextPaths.clear();
    this.lastSyncedContent.clear();
    const compilerOp = this.compiler.clear();
    const analyzerOp =
      this.analyzer && uris.length > 0
        ? this.analyzer.didCloseMany(uris)
        : Promise.resolve();
    await Promise.all([compilerOp, analyzerOp]);
  }

  /** Compile the current VFS state using the sticky entry. */
  compile(): Promise<CompileResult> {
    return this.compiler.compile(undefined, this._entry);
  }

  /** Compile the current VFS state to PDF using the sticky entry. */
  compilePdf(): Promise<Uint8Array> {
    return this.compiler.compilePdf(undefined, this._entry);
  }

  /**
   * Subscribe to push-based analyzer diagnostics for a project-relative path.
   * Returns an unsubscribe function. Replays the last cached diagnostics
   * synchronously so tab-back reflects current state without waiting.
   * Throws when no analyzer is attached.
   */
  onDiagnostics(path: string, listener: DiagnosticsSubscriber): () => void {
    if (!this.analyzer) {
      throw new Error("TypstProject: onDiagnostics requires an analyzer");
    }
    const uri = this.toUri(normalizePath(path));

    let listeners = this.listenersByUri.get(uri);
    if (!listeners) {
      listeners = new Set();
      this.listenersByUri.set(uri, listeners);
    }
    listeners.add(listener);

    const cached = this.diagnosticsCache.get(uri);
    if (cached) listener(cached);

    return () => {
      const current = this.listenersByUri.get(uri);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listenersByUri.delete(uri);
    };
  }

  /**
   * Force the analyzer to re-publish diagnostics for the given path. Useful
   * after switching tabs to ensure the active file's diagnostics reflect
   * recent edits to its dependencies.
   */
  async refreshDiagnostics(path: string): Promise<void> {
    if (!this.analyzer) return;
    try {
      await this.analyzer.hover(this.toUri(normalizePath(path)), 0, 0);
    } catch {
      /* best-effort — the hover result is unused */
    }
  }

  /** Request completions at the given position. Throws when no analyzer is attached. */
  completion(path: string, line: number, character: number): Promise<unknown> {
    if (!this.analyzer) {
      throw new Error("TypstProject: completion requires an analyzer");
    }
    return this.analyzer.completion(
      this.toUri(normalizePath(path)),
      line,
      character,
    );
  }

  /** Request hover info at the given position. Throws when no analyzer is attached. */
  hover(path: string, line: number, character: number): Promise<unknown> {
    if (!this.analyzer) {
      throw new Error("TypstProject: hover requires an analyzer");
    }
    return this.analyzer.hover(
      this.toUri(normalizePath(path)),
      line,
      character,
    );
  }

  /** Build a tinymist URI from a project-relative path. */
  toUri(path: string): string {
    const root = this.rootPath.replace(/^\//, "");
    return `untitled:${root}${normalizePath(path)}`;
  }

  destroy(): void {
    this.unsubscribeAnalyzer?.();
    this.listenersByUri.clear();
    this.diagnosticsCache.clear();
  }
}
