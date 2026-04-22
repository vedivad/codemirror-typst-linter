import { type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { TypstProject } from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";

export interface CompileSyncOptions {
  project: TypstProject;
}

/**
 * Mirrors editor content into the project's VFS on mount and on every doc or
 * path change. The project auto-schedules a (debounced) compile in response to
 * the resulting `setText`; subscribe to results via `project.onCompile(...)`.
 *
 * Configure compile debounce/throttle on the project, not here — a single
 * project may have multiple editors and all of them share one compile schedule.
 */
export class CompileSyncPlugin {
  private currentPath: string;

  constructor(
    private readonly options: CompileSyncOptions,
    view: EditorView,
  ) {
    this.currentPath = view.state.facet(typstFilePath);
    this.push(view);
  }

  update(update: ViewUpdate): void {
    const nextPath = update.state.facet(typstFilePath);
    if (update.docChanged || nextPath !== this.currentPath) {
      this.currentPath = nextPath;
      this.push(update.view);
    }
  }

  destroy(): void {}

  private push(view: EditorView): void {
    this.options.project
      .setText(this.currentPath, view.state.doc.toString())
      .catch((err) => console.error("[typst]", err));
  }
}

/** CodeMirror extension that mirrors editor content into the project's VFS. */
export function createTypstCompileSync(options: CompileSyncOptions): Extension {
  return ViewPlugin.define((view) => new CompileSyncPlugin(options, view), {});
}
