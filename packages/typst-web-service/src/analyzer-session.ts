import type { LspDiagnostic } from "./analyzer-types.js";
import type { TypstAnalyzer } from "./analyzer.js";
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
 *   await session.sync("/main.typ", files);
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
   * Sync all project files with the analyzer.
   * `files` must include the active file's current content under `path`.
   *
   * If the active file's content hasn't changed since the last sync, a
   * lightweight hover is triggered to ensure the analyzer re-analyzes with
   * the current project state and publishes fresh diagnostics.
   */
  async sync(path: string, files: Record<string, string>): Promise<void> {
    await this.enqueue(async () => {
      const changed = await this.syncFiles(path, files);

      // When the active file's content is unchanged, the analyzer won't
      // publish fresh diagnostics on its own.  A hover request forces it
      // to re-evaluate with the (possibly updated) project context.
      if (!changed) {
        try {
          await this.analyzer.hover(this.toUri(normalizePath(path)), 0, 0);
        } catch {
          /* best-effort — the hover result is unused */
        }
      }

      // Clean up files that were removed from the project.
      for (const filePath of this.syncedFiles.keys()) {
        if (!Object.hasOwn(files, filePath)) {
          this.syncedFiles.delete(filePath);
        }
      }
    });
  }

  /**
   * Sync files and request completions at the given position.
   * Returns the raw LSP CompletionList/CompletionItem[] from tinymist.
   */
  async completion(
    path: string,
    files: Record<string, string>,
    line: number,
    character: number,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      await this.syncFiles(path, files);
      return this.analyzer.completion(
        this.toUri(normalizePath(path)),
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
    files: Record<string, string>,
    line: number,
    character: number,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      await this.syncFiles(path, files);
      return this.analyzer.hover(
        this.toUri(normalizePath(path)),
        line,
        character,
      );
    });
  }

  destroy(): void {
    this.unsubscribeAnalyzer();
    this.listenersByUri.clear();
    this.diagnosticsCache.clear();
  }

  /**
   * Sync all project files: dependencies first, active file last.
   * Returns whether the active file's content was actually sent to the analyzer.
   */
  private async syncFiles(
    path: string,
    files: Record<string, string>,
  ): Promise<boolean> {
    const activePath = normalizePath(path);
    for (const filePath of this.orderedPaths(files)) {
      if (filePath === activePath) continue;
      await this.syncFile(filePath, files[filePath]);
    }
    return this.syncFile(activePath, files[activePath]);
  }

  /** Sync a single file. Returns true if content was sent to the analyzer. */
  private async syncFile(path: string, content: string): Promise<boolean> {
    const prev = this.syncedFiles.get(path);
    if (prev == null) {
      await this.analyzer.didOpen(this.toUri(path), content);
    } else if (prev !== content) {
      await this.analyzer.didChange(this.toUri(path), content);
    } else {
      return false;
    }
    this.syncedFiles.set(path, content);
    return true;
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
