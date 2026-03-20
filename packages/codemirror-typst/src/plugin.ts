import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { CompileResult, TypstCompiler } from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";

export interface PluginOptions {
  compiler: TypstCompiler;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The current editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Called after each successful compile with the full result. */
  onCompile?: (result: CompileResult) => void;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export class TypstLinterPlugin {
  private controller: AbortController | null = null;
  private path: string;

  constructor(private options: PluginOptions) {
    this.path = options.filePath ?? "/main.typ";
  }

  async lint(view: EditorView): Promise<Diagnostic[]> {
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
  }
}
