import { type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { TypstProject } from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";
import { type BasePluginOptions, PluginDriver } from "./plugin-driver.js";

export interface CompileSyncOptions extends BasePluginOptions {
  project: TypstProject;
}

/**
 * Mirrors editor content into the project's VFS and triggers `project.compile()`
 * on doc changes, path changes, and once at startup. Subscribe to results with
 * `project.onCompile(...)`.
 */
export class CompileSyncPlugin {
  private readonly driver: PluginDriver;

  constructor(
    private readonly options: CompileSyncOptions,
    view: EditorView,
  ) {
    this.driver = new PluginDriver(view, options, { run: (v) => this.run(v) });
    this.driver.start(view);
  }

  update(update: ViewUpdate): void {
    this.driver.update(update);
  }

  destroy(): void {
    this.driver.dispose();
  }

  private async run(view: EditorView): Promise<void> {
    const source = view.state.doc.toString();
    const path = view.state.facet(typstFilePath);
    await this.options.project.setText(path, source);
    await this.options.project.compile();
  }
}

/** CodeMirror extension that syncs editor content to the project and drives compiles. */
export function createTypstCompileSync(options: CompileSyncOptions): Extension {
  return ViewPlugin.define((view) => new CompileSyncPlugin(options, view), {});
}
