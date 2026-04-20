import { setDiagnostics } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { CompileResult, TypstProject } from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";
import { typstFilePath } from "./facets.js";
import { type BasePluginOptions, PluginDriver } from "./plugin-driver.js";

export interface CompilerLintPluginOptions extends BasePluginOptions {
  project: TypstProject;
}

export class CompilerLintPlugin {
  private readonly driver: PluginDriver;
  private readonly unsubscribe: () => void;
  private view: EditorView;

  constructor(
    private readonly options: CompilerLintPluginOptions,
    view: EditorView,
  ) {
    this.view = view;
    this.driver = new PluginDriver(view, options, { run: (v) => this.run(v) });
    this.unsubscribe = options.project.onCompile((result) =>
      this.applyDiagnostics(result),
    );
    this.driver.start(view);
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    this.driver.update(update);
  }

  destroy(): void {
    this.unsubscribe();
    this.driver.dispose();
  }

  private async run(view: EditorView): Promise<void> {
    const source = view.state.doc.toString();
    const path = view.state.facet(typstFilePath);
    await this.options.project.setText(path, source);
    await this.options.project.compile();
  }

  private applyDiagnostics(result: CompileResult): void {
    const view = this.view;
    const path = view.state.facet(typstFilePath);
    const diagnostics = result.diagnostics
      .filter((d) => d.path === path)
      .map((d) => toCMDiagnostic(view.state, d));
    try {
      view.dispatch(setDiagnostics(view.state, diagnostics));
    } catch {
      // View may already be replaced/destroyed.
    }
  }
}
