import type { TypstAnalyzer } from "./analyzer.js";

export interface AnalyzerSessionOptions {
  analyzer: Pick<
    TypstAnalyzer,
    "ready" | "didOpen" | "didChange" | "completion" | "hover"
  >;
  /** Project root used to build stable in-memory analyzer URIs. Default: "/project". */
  rootPath?: string;
  /** Entry file path within the project. Synced last to ensure dependencies load first. Default: "/main.typ". */
  entryPath?: string;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeRoot(rootPath: string): string {
  const root = normalizePath(rootPath);
  return root === "/" ? "" : root.replace(/\/+$/, "");
}

/**
 * Synchronizes an in-memory Typst project with a TypstAnalyzer.
 * Handles multi-file ordering and avoids cross-file race conditions.
 *
 * Diagnostics are not returned — they arrive via the analyzer's `onDiagnostics` callback.
 *
 *   const session = new AnalyzerSession({ analyzer });
 *   await session.sync("/main.typ", source, files);
 */
export class AnalyzerSession {
  readonly ready: Promise<void>;

  private readonly analyzer: Pick<
    TypstAnalyzer,
    "ready" | "didOpen" | "didChange" | "completion" | "hover"
  >;
  private readonly rootPath: string;
  private readonly entryPath: string;
  private readonly syncedFiles = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AnalyzerSessionOptions) {
    this.analyzer = options.analyzer;
    this.rootPath = normalizeRoot(options.rootPath ?? "/project");
    this.entryPath = normalizePath(options.entryPath ?? "/main.typ");
    this.ready = this.analyzer.ready;
  }

  /** Build a tinymist URI from a project-relative path. */
  toUri(path: string): string {
    // Tinymist publishes untitled URIs without a leading slash after the scheme.
    const root = this.rootPath.replace(/^\//, "");
    return `untitled:${root}${normalizePath(path)}`;
  }

  /**
   * Sync all project files with the analyzer, then notify it of the active file change.
   * Diagnostics will arrive asynchronously via the analyzer's `onDiagnostics` callback.
   */
  async sync(
    path: string,
    content: string,
    files: Record<string, string>,
  ): Promise<void> {
    const normalizedPath = normalizePath(path);
    const mergedFiles = { ...files, [normalizedPath]: content };

    await this.enqueue(async () => {
      await this.ready;
      await this.syncFiles(mergedFiles, normalizedPath);
      // Notify the active file last — tinymist will publish diagnostics for it.
      await this.syncActive(normalizedPath, mergedFiles[normalizedPath], true);
    });
  }

  private async syncActive(
    path: string,
    content: string,
    forceDidChange: boolean,
  ): Promise<void> {
    const prev = this.syncedFiles.get(path);

    if (prev == null) {
      await this.analyzer.didOpen(this.toUri(path), content);
      this.syncedFiles.set(path, content);
      return;
    }

    if (forceDidChange || prev !== content) {
      await this.analyzer.didChange(this.toUri(path), content);
      this.syncedFiles.set(path, content);
    }
  }

  private orderedPaths(files: Record<string, string>): string[] {
    return Object.keys(files)
      .map((path) => normalizePath(path))
      .sort((a, b) => {
        if (a === this.entryPath) return 1;
        if (b === this.entryPath) return -1;
        return a.localeCompare(b);
      });
  }

  private async syncFiles(
    files: Record<string, string>,
    activePath: string,
  ): Promise<void> {
    for (const path of this.orderedPaths(files)) {
      if (path === activePath) continue;

      const next = files[path];
      const prev = this.syncedFiles.get(path);

      if (prev == null) {
        await this.analyzer.didOpen(this.toUri(path), next);
        this.syncedFiles.set(path, next);
        continue;
      }

      if (prev !== next) {
        await this.analyzer.didChange(this.toUri(path), next);
        this.syncedFiles.set(path, next);
      }
    }

    for (const path of Array.from(this.syncedFiles.keys())) {
      if (!Object.hasOwn(files, path)) {
        this.syncedFiles.delete(path);
      }
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
    const normalizedPath = normalizePath(path);
    const mergedFiles = { ...files, [normalizedPath]: content };

    return this.enqueue(async () => {
      await this.ready;
      await this.syncFiles(mergedFiles, normalizedPath);
      await this.syncActive(normalizedPath, mergedFiles[normalizedPath], false);
      return this.analyzer.completion(
        this.toUri(normalizedPath),
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
    const normalizedPath = normalizePath(path);
    const mergedFiles = { ...files, [normalizedPath]: content };

    return this.enqueue(async () => {
      await this.ready;
      await this.syncFiles(mergedFiles, normalizedPath);
      await this.syncActive(normalizedPath, mergedFiles[normalizedPath], false);
      return this.analyzer.hover(this.toUri(normalizedPath), line, character);
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
