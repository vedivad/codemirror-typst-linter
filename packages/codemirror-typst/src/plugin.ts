import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import {
  AnalyzerSession,
  type CompileResult,
  type TypstAnalyzer,
  type TypstCompiler,
} from "@vedivad/typst-web-service";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";

export interface PluginOptions {
  compiler: TypstCompiler;
  /** tinymist analyzer for push-based diagnostics. When set, diagnostics are pushed asynchronously. */
  analyzer?: TypstAnalyzer;
  /** Optional root path for auto-created analyzer sessions. Default: "/project". */
  projectRootPath?: string;
  /** Optional entry path for auto-created analyzer sessions. Default: "/main.typ". */
  projectEntryPath?: string;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The current editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Called after each successful compile with the full result. */
  onCompile?: (result: CompileResult) => void;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export class TypstLinterPlugin {
  private static sessionCache = new WeakMap<TypstAnalyzer, AnalyzerSession>();

  private controller: AbortController | null = null;
  private path: string;
  private unsubscribe?: () => void;

  constructor(private options: PluginOptions) {
    this.path = options.filePath ?? "/main.typ";
  }

  private getSession(): AnalyzerSession | undefined {
    const analyzer = this.options.analyzer;
    if (!analyzer) return undefined;

    const cached = TypstLinterPlugin.sessionCache.get(analyzer);
    if (cached) return cached;

    const session = new AnalyzerSession({
      analyzer,
      rootPath: this.options.projectRootPath ?? "/project",
      entryPath: this.options.projectEntryPath ?? "/main.typ",
    });
    TypstLinterPlugin.sessionCache.set(analyzer, session);
    return session;
  }

  /**
   * Subscribe to push-based diagnostics from the analyzer for this editor's URI.
   * Called once on first lint.
   */
  private subscribeToDiagnostics(view: EditorView): void {
    const analyzer = this.options.analyzer;
    if (!analyzer || this.unsubscribe) return;

    const session = this.getSession();
    if (!session) return;

    const expectedUri = session.toUri(this.path);

    this.unsubscribe = analyzer.onDiagnostics((uri, lspDiags) => {
      if (uri !== expectedUri) return;
      // Don't replace compiler diagnostics with an empty set from tinymist.
      if (lspDiags.length === 0) return;
      try {
        const cmDiags = lspDiags.map((d) => lspToCMDiagnostic(view.state, d));
        view.dispatch(setDiagnostics(view.state, cmDiags));
        this.options.onDiagnostics?.(cmDiags);
      } catch {
        // View may have been destroyed.
      }
    });
  }

  async lint(view: EditorView): Promise<Diagnostic[]> {
    this.subscribeToDiagnostics(view);

    this.controller?.abort();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const source = view.state.doc.toString();

    const files = { ...this.options.getFiles?.(), [this.path]: source };

    let diagnostics: Diagnostic[];

    try {
      const result = await this.options.compiler.compile(files);

      if (signal.aborted) return [];

      this.options.onCompile?.(result);

      diagnostics = result.diagnostics
        .filter((d) => d.path === this.path)
        .map((d) => toCMDiagnostic(view.state, d));

      // Sync files with analyzer in the background (fire-and-forget).
      // Diagnostics will arrive via the push listener.
      const session = this.getSession();
      if (session) {
        session.sync(this.path, source, files).catch(() => {
          // Analyzer failures are non-fatal.
        });
      }
    } catch (err) {
      if (signal.aborted) return [];
      diagnostics = [
        {
          from: 0,
          to: Math.min(1, view.state.doc.length),
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
          source: "typst",
        },
      ];
    }

    this.options.onDiagnostics?.(diagnostics);
    return diagnostics;
  }

  destroy() {
    this.controller?.abort();
    this.unsubscribe?.();
  }
}
