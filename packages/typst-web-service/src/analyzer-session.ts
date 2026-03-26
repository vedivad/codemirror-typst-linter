import type { LspDiagnostic } from "./analyzer-types.js";
import type { TypstAnalyzer } from "./analyzer.js";
import type { CompileResult, TypstCompiler } from "./compiler.js";
import { normalizePath, normalizeRoot } from "./uri.js";

export type DiagnosticsSubscriber = (diagnostics: LspDiagnostic[]) => void;

export interface AnalyzerSessionOptions {
  analyzer: Pick<
    TypstAnalyzer,
    "didOpen" | "didChange" | "completion" | "hover" | "onDiagnostics"
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
  private readonly analyzer: AnalyzerSessionOptions["analyzer"];
  private readonly rootPath: string;
  private readonly entryPath: string;
  private readonly syncedFiles = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  // Diagnostic subscription state
  private readonly listenersByUri = new Map<
    string,
    Set<DiagnosticsSubscriber>
  >();
  /** Last push received per URI. Replayed on subscribe() so tab-back shows correct diagnostics instantly. */
  private readonly diagnosticsCache = new Map<string, LspDiagnostic[]>();
  private readonly unsubscribeAnalyzer: () => void;

  constructor(options: AnalyzerSessionOptions) {
    this.analyzer = options.analyzer;
    this.rootPath = normalizeRoot(options.rootPath ?? "/project");
    this.entryPath = normalizePath(options.entryPath ?? "/main.typ");

    this.unsubscribeAnalyzer = this.analyzer.onDiagnostics(
      (uri, diagnostics) => {
        this.diagnosticsCache.set(uri, diagnostics);
        const listeners = this.listenersByUri.get(uri);
        if (!listeners) return;
        for (const listener of listeners) listener(diagnostics);
      },
    );
  }

  /** Build a tinymist URI from a project-relative path. */
  toUri(path: string): string {
    const root = this.rootPath.replace(/^\//, "");
    return `untitled:${root}${normalizePath(path)}`;
  }

  /**
   * Subscribe to push-based diagnostics for a file path.
   * Returns an unsubscribe function.
   */
  subscribe(path: string, listener: DiagnosticsSubscriber): () => void {
    const uri = this.toUri(path);

    let listeners = this.listenersByUri.get(uri);
    if (!listeners) {
      listeners = new Set();
      this.listenersByUri.set(uri, listeners);
    }
    listeners.add(listener);

    // Replay the last known diagnostics immediately so the UI reflects the
    // correct state without waiting for the next tinymist push.
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
   * Sync all project files with the analyzer, then notify it of the active file change.
   * Diagnostics will arrive asynchronously via subscribers registered with `subscribe()`.
   */
  async sync(
    path: string,
    content: string,
    files: Record<string, string>,
    force = false,
  ): Promise<void> {
    const activePath = normalizePath(path);
    const mergedFiles = { ...files, [activePath]: content };

    await this.enqueue(async () => {
      // Sync dependencies first, then the active file last.
      for (const filePath of this.orderedPaths(mergedFiles)) {
        if (filePath === activePath) continue;
        await this.syncFile(filePath, mergedFiles[filePath]);
      }
      await this.syncFile(activePath, mergedFiles[activePath], force);

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
    force = false,
  ): Promise<void> {
    await this.sync(path, content, files, force);
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
    const activePath = normalizePath(path);
    const mergedFiles = { ...files, [activePath]: content };

    return this.enqueue(async () => {
      for (const filePath of this.orderedPaths(mergedFiles)) {
        if (filePath === activePath) continue;
        await this.syncFile(filePath, mergedFiles[filePath]);
      }
      await this.syncFile(activePath, mergedFiles[activePath]);

      return this.analyzer.completion(this.toUri(activePath), line, character);
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
    const activePath = normalizePath(path);
    const mergedFiles = { ...files, [activePath]: content };

    return this.enqueue(async () => {
      for (const filePath of this.orderedPaths(mergedFiles)) {
        if (filePath === activePath) continue;
        await this.syncFile(filePath, mergedFiles[filePath]);
      }
      await this.syncFile(activePath, mergedFiles[activePath]);

      return this.analyzer.hover(this.toUri(activePath), line, character);
    });
  }

  destroy(): void {
    this.unsubscribeAnalyzer();
    this.listenersByUri.clear();
    this.diagnosticsCache.clear();
  }

  private async syncFile(path: string, content: string, force = false): Promise<void> {
    const prev = this.syncedFiles.get(path);
    if (prev == null) {
      await this.analyzer.didOpen(this.toUri(path), content);
    } else if (force) {
      // Tinymist deduplicates by content hash, so a didChange with identical content
      // would be silently ignored. Send a trivial change (trailing comment) first to
      // force a fresh analysis cycle, then restore the real content.
      await this.analyzer.didChange(this.toUri(path), content + "\n//");
      await this.analyzer.didChange(this.toUri(path), content);
    } else if (prev !== content) {
      await this.analyzer.didChange(this.toUri(path), content);
    }
    this.syncedFiles.set(path, content);
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


