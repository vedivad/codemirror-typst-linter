import type { TypstAnalyzer } from "./analyzer.js";
import type { CompileResult, TypstCompiler } from "./compiler.js";
import { normalizePath } from "./uri.js";

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
   * URI prefix for the analyzer. Default: "file:///".
   * Paths are appended without their leading slash — `"/main.typ"` becomes
   * `"file:///main.typ"`.
   */
  analyzerUriPrefix?: string;
}

const DEFAULT_ENTRY = "/main.typ";
const DEFAULT_URI_PREFIX = "file:///";

/**
 * Coordinates a compiler + analyzer pair for multi-file Typst projects.
 *
 * Keeps the compiler's shadow VFS and the analyzer's open-document set in
 * sync through a single path-based API, so callers don't have to hand-mirror
 * file operations between the two subsystems.
 *
 *   const project = new TypstProject({ compiler, analyzer });
 *   await project.setMany({ "/main.typ": "...", "/utils.typ": "..." });
 *   const result = await project.compile();
 */
export class TypstProject {
  private readonly compiler: TypstCompiler;
  private readonly analyzer?: TypstAnalyzer;
  private readonly uriPrefix: string;
  private readonly trackedTextPaths = new Set<string>();
  private _entry: string;

  constructor(options: TypstProjectOptions) {
    this.compiler = options.compiler;
    this.analyzer = options.analyzer;
    this.uriPrefix = options.analyzerUriPrefix ?? DEFAULT_URI_PREFIX;
    this._entry = normalizePath(options.entry ?? DEFAULT_ENTRY);
  }

  /** Current entry file path. */
  get entry(): string {
    return this._entry;
  }

  /** Change the sticky entry file used by subsequent compile() calls. */
  setEntry(path: string): void {
    this._entry = normalizePath(path);
  }

  /**
   * Add or overwrite a text file. Goes to the compiler's VFS and, when an
   * analyzer is attached, to the analyzer as a document change.
   */
  async setText(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    this.trackedTextPaths.add(p);
    const ops: Array<Promise<void>> = [this.compiler.setText(p, content)];
    if (this.analyzer) {
      ops.push(this.analyzer.didChange(this.toUri(p), content));
    }
    await Promise.all(ops);
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

  private toUri(path: string): string {
    return `${this.uriPrefix}${path.startsWith("/") ? path.slice(1) : path}`;
  }
}
