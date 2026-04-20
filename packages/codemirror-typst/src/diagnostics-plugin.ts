import { setDiagnostics } from "@codemirror/lint";
import { type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { CompileResult, TypstProject } from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";
import { typstFilePath } from "./facets.js";

export interface DiagnosticsPluginOptions {
  project: TypstProject;
}

/**
 * Subscribes to `project.onCompile` and dispatches CodeMirror diagnostics for
 * the current file (as read from the `typstFilePath` facet). Does not push
 * content into the project or trigger compiles — pair with `CompileSyncPlugin`
 * or drive compiles yourself.
 */
export class DiagnosticsPlugin {
  private readonly unsubscribe: () => void;
  private view: EditorView;

  constructor(options: DiagnosticsPluginOptions, view: EditorView) {
    this.view = view;
    this.unsubscribe = options.project.onCompile((result) =>
      this.applyDiagnostics(result),
    );
  }

  update(update: { view: EditorView }): void {
    this.view = update.view;
  }

  destroy(): void {
    this.unsubscribe();
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

/** CodeMirror extension that renders compile diagnostics for the active file. */
export function createTypstDiagnostics(
  options: DiagnosticsPluginOptions,
): Extension {
  return ViewPlugin.define((view) => new DiagnosticsPlugin(options, view), {});
}
