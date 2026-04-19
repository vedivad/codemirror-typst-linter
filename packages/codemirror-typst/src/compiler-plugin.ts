import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { TypstProject } from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";
import { type BasePluginOptions, PluginDriver } from "./plugin-driver.js";

export interface CompilerLintPluginOptions extends BasePluginOptions {
  project: TypstProject;
}

export class CompilerLintPlugin {
  private readonly driver: PluginDriver;

  constructor(
    private readonly options: CompilerLintPluginOptions,
    view?: EditorView,
  ) {
    this.driver = new PluginDriver(options, { run: (v) => this.run(v) });
    if (view) this.driver.start(view);
  }

  update(update: ViewUpdate): void {
    this.driver.update(update);
  }

  destroy(): void {
    this.driver.dispose();
  }

  private async run(view: EditorView): Promise<void> {
    this.driver.controller?.abort();
    this.driver.controller = new AbortController();
    const { signal } = this.driver.controller;

    const source = view.state.doc.toString();
    const path = this.driver.currentPath;

    await this.options.project.setText(path, source);
    if (signal.aborted) return;

    try {
      const result = await this.options.project.compile();
      if (signal.aborted) return;

      this.options.onCompile?.(result);
      const diagnostics = result.diagnostics
        .filter((d) => d.path === path)
        .map((d) => toCMDiagnostic(view.state, d));

      this.options.onDiagnostics?.(diagnostics);
      try {
        view.dispatch(setDiagnostics(view.state, diagnostics));
      } catch {
        // View may already be replaced/destroyed.
      }
    } catch (err) {
      if (signal.aborted) return;

      const diagnostics: Diagnostic[] = [
        {
          from: 0,
          to: Math.min(1, view.state.doc.length),
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
          source: "typst",
        },
      ];

      this.options.onDiagnostics?.(diagnostics);
      try {
        view.dispatch(setDiagnostics(view.state, diagnostics));
      } catch {
        // View may already be replaced/destroyed.
      }
    }
  }
}
