import type { LspDiagnostic } from "./analyzer-types.js";
import type { TypstAnalyzer } from "./analyzer.js";
import type { CompileResult, TypstCompiler } from "./compiler.js";
import { normalizePath, normalizeRoot } from "./uri.js";

export type DiagnosticsSubscriber = (diagnostics: LspDiagnostic[]) => void;

export interface AnalyzerSessionOptions {
  analyzer: Pick<
    TypstAnalyzer,
    "ready" | "didOpen" | "didChange" | "completion" | "hover" | "onDiagnostics"
  >;
  /** Project root used to build stable in-memory analyzer URIs. Default: "/project". */
  rootPath?: string;
  /** Entry file path within the project. Synced last to ensure dependencies load first. Default: "/main.typ". */
  entryPath?: string;
}

/**
 * Synchronizes an in-memory Typst project with a TypstAnalyzer.
 * Handles multi-file ordering, request queueing, and diagnostic subscriptions.
 *
 * Diagnostics arrive via the analyzer's push mechanism and are forwarded
 * to subscribers registered with `subscribe()`.
 *
 *   const session = new AnalyzerSession({ analyzer });
 *   session.subscribe("/main.typ", (diags) => { ... });
 *   await session.sync("/main.typ", source, files);
 */
export class AnalyzerSession {
  readonly ready: Promise<void>;

  private readonly analyzer: AnalyzerSessionOptions["analyzer"];
  private readonly rootPath: string;
  private readonly entryPath: string;
  private readonly syncedFiles = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private syncRevision = 0;

  // Diagnostic subscription state
  private readonly listenersByUri = new Map<string, Set<DiagnosticsSubscriber>>();
  private readonly diagnosticsByUri = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticsHashByUri = new Map<string, string>();
  private readonly unsubscribeAnalyzer: () => void;

  constructor(options: AnalyzerSessionOptions) {
    this.analyzer = options.analyzer;
    this.rootPath = normalizeRoot(options.rootPath ?? "/project");
    this.entryPath = normalizePath(options.entryPath ?? "/main.typ");
    this.ready = this.analyzer.ready;

    this.unsubscribeAnalyzer = this.analyzer.onDiagnostics((uri, diagnostics) => {
      const nextHash = diagnosticsHash(diagnostics);
      if (this.diagnosticsHashByUri.get(uri) === nextHash) return;

      this.diagnosticsByUri.set(uri, diagnostics);
      this.diagnosticsHashByUri.set(uri, nextHash);

      const listeners = this.listenersByUri.get(uri);
      if (!listeners) return;
      for (const listener of listeners) listener(diagnostics);
    });
  }

  /** Build a tinymist URI from a project-relative path. */
  toUri(path: string): string {
    const root = this.rootPath.replace(/^\//, "");
    return `untitled:${root}${normalizePath(path)}`;
  }

  /**
   * Subscribe to push-based diagnostics for a file path.
   * Returns an unsubscribe function. Replays cached diagnostics immediately.
   */
  subscribe(path: string, listener: DiagnosticsSubscriber): () => void {
    const uri = this.toUri(path);

    let listeners = this.listenersByUri.get(uri);
    if (!listeners) {
      listeners = new Set();
      this.listenersByUri.set(uri, listeners);
    }
    listeners.add(listener);

    const cached = this.diagnosticsByUri.get(uri);
    if (cached) listener(cached);

    return () => {
      const current = this.listenersByUri.get(uri);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listenersByUri.delete(uri);
    };
  }

  /**
   * Sync all project files with the analyzer, then notify it of the active file change.
   * Diagnostics will arrive asynchronously via subscribers registered with `subscribe()`.
   */
  async sync(
    path: string,
    content: string,
    files: Record<string, string>,
  ): Promise<void> {
    ++this.syncRevision;
    const activePath = normalizePath(path);
    const mergedFiles = { ...files, [activePath]: content };

    await this.enqueue(async () => {
      await this.ready;

      // Sync non-active files first (dependencies), then the active file last
      // to trigger tinymist diagnostics.
      for (const filePath of this.orderedPaths(mergedFiles)) {
        if (filePath === activePath) continue;
        await this.syncFile(filePath, mergedFiles[filePath], false);
      }

      // Active file always uses didOpen to trigger tinymist compilation.
      await this.syncFile(activePath, mergedFiles[activePath], true);

      // Clean up files that were removed from the project.
      for (const filePath of this.syncedFiles.keys()) {
        if (!Object.hasOwn(mergedFiles, filePath)) {
          this.syncedFiles.delete(filePath);
        }
      }
    });
  }

  /**
   * Sync files, then compile with the provided compiler.
   * Diagnostics come from the analyzer (push-based); the compiler provides preview artifacts.
   */
  async syncAndCompile(
    path: string,
    content: string,
    files: Record<string, string>,
    compiler: TypstCompiler,
    onCompile?: (result: CompileResult) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.sync(path, content, files);
    if (signal?.aborted) return;

    try {
      const result = await compiler.compile(files);
      if (signal?.aborted) return;
      onCompile?.(result);
    } catch {
      // Analyzer push diagnostics are authoritative; compiler errors are non-fatal.
    }
  }

  /**
   * Sync files and request completions at the given position.
   * Returns the raw LSP CompletionList/CompletionItem[] from tinymist.
   */
  async completion(
    path: string,
    content: string,
    files: Record<string, string>,
    line: number,
    character: number,
  ): Promise<unknown> {
    const enqueuedRevision = this.syncRevision;
    const activePath = normalizePath(path);
    const mergedFiles = { ...files, [activePath]: content };

    return this.enqueue(async () => {
      if (enqueuedRevision !== this.syncRevision) return null;

      await this.ready;
      for (const filePath of this.orderedPaths(mergedFiles)) {
        if (filePath === activePath) continue;
        await this.syncFile(filePath, mergedFiles[filePath], false);
      }
      await this.syncFile(activePath, mergedFiles[activePath], false);

      return this.analyzer.completion(
        this.toUri(activePath),
        line,
        character,
      );
    });
  }

  /**
   * Sync files and request hover info at the given position.
   * Returns the raw LSP Hover result from tinymist.
   */
  async hover(
    path: string,
    content: string,
    files: Record<string, string>,
    line: number,
    character: number,
  ): Promise<unknown> {
    const enqueuedRevision = this.syncRevision;
    const activePath = normalizePath(path);
    const mergedFiles = { ...files, [activePath]: content };

    return this.enqueue(async () => {
      if (enqueuedRevision !== this.syncRevision) return null;

      await this.ready;
      for (const filePath of this.orderedPaths(mergedFiles)) {
        if (filePath === activePath) continue;
        await this.syncFile(filePath, mergedFiles[filePath], false);
      }
      await this.syncFile(activePath, mergedFiles[activePath], false);

      return this.analyzer.hover(this.toUri(activePath), line, character);
    });
  }

  destroy(): void {
    this.unsubscribeAnalyzer();
    this.listenersByUri.clear();
    this.diagnosticsByUri.clear();
    this.diagnosticsHashByUri.clear();
  }

  /**
   * Sync a single file with the analyzer.
   * @param forceOpen - Always use didOpen (triggers tinymist diagnostics for the active file).
   */
  private async syncFile(
    path: string,
    content: string,
    forceOpen: boolean,
  ): Promise<void> {
    const prev = this.syncedFiles.get(path);

    if (forceOpen || prev == null) {
      await this.analyzer.didOpen(this.toUri(path), content);
      this.syncedFiles.set(path, content);
      return;
    }

    if (prev !== content) {
      await this.analyzer.didChange(this.toUri(path), content);
      this.syncedFiles.set(path, content);
    }
  }

  private orderedPaths(files: Record<string, string>): string[] {
    return Object.keys(files)
      .map((p) => normalizePath(p))
      .sort((a, b) => {
        if (a === this.entryPath) return 1;
        if (b === this.entryPath) return -1;
        return a.localeCompare(b);
      });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function diagnosticsHash(diagnostics: LspDiagnostic[]): string {
  return JSON.stringify(
    diagnostics.map((d) => [
      d.range.start.line,
      d.range.start.character,
      d.range.end.line,
      d.range.end.character,
      d.severity ?? 1,
      d.message,
      d.source ?? "",
    ]),
  );
}
