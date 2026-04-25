import { autocompletion } from "@codemirror/autocomplete";
import { lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { TypstProject } from "@vedivad/typst-web-service";
import { createTypstCompileSync } from "./compile-sync.js";
import type { TypstCompletionOptions } from "./completion.js";
import { typstCompletionSource } from "./completion.js";
import { toCMDiagnostic } from "./diagnostics.js";
import { createTypstDiagnostics } from "./diagnostics-plugin.js";
import { typstFilePath } from "./facets.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import type { TypstHoverOptions } from "./hover.js";
import { createTypstHover } from "./hover.js";
import type { CodeHighlighter } from "./hover-markdown.js";
import type {
  TypstHighlightingController,
  TypstHighlightingOptions,
} from "./shiki.js";
import { createTypstHighlighting } from "./shiki.js";
import {
  diagnosticLocation,
  groupDiagnosticsByFile,
} from "./diagnostics-utils.js";

export type {
  CompileResult,
  DiagnosticMessage,
  DiagnosticRange,
  FormatConfig,
  TypstCompilerOptions,
  TypstProjectOptions,
} from "@vedivad/typst-web-service";
export {
  TypstAnalyzer,
  TypstCompiler,
  TypstFormatter,
  TypstProject,
  TypstRenderer,
} from "@vedivad/typst-web-service";
export type {
  TypstFormatterOptions,
  TypstCompletionOptions,
  TypstHoverOptions,
  CodeHighlighter,
  TypstHighlightingController,
  TypstHighlightingOptions,
};
export {
  createTypstCompileSync,
  createTypstHover,
  typstCompletionSource,
  createTypstDiagnostics,
  createTypstFormatter,
  createTypstHighlighting,
  diagnosticLocation,
  groupDiagnosticsByFile,
  toCMDiagnostic,
  typstFilePath,
};
export type { CompileSyncOptions } from "./compile-sync.js";
export type { DiagnosticsPluginOptions } from "./diagnostics-plugin.js";

// ---------------------------------------------------------------------------
// High-level API: createTypstSetup
// ---------------------------------------------------------------------------

export interface TypstSetupOptions {
  /**
   * Project that owns the VFS and (optionally) the analyzer. Construct one with
   * `new TypstProject({ compiler, analyzer })` and share it across editors that
   * should see the same files. Subscribe to compile results with
   * `project.onCompile(listener)`. Configure auto-compile scheduling via the
   * `autoCompile` option on the project itself.
   */
  project: TypstProject;
  /**
   * Who owns the canonical text. Required because the wrong choice fails
   * silently.
   *
   * - `"editor-driven"`: CodeMirror is the source of truth. The setup mirrors
   *   doc/path changes into `project.setText()` on mount and on every edit.
   * - `"external"`: something else owns the text (Y.js, server, etc.) and
   *   pushes into the project itself. The setup omits the editor→project
   *   sync — installing both causes double-writes and lets local edits
   *   overwrite remote ones that arrived mid-dispatch.
   */
  sync: "editor-driven" | "external";
  /**
   * Highlighting controller from `createTypstHighlighting()`. Omit to skip
   * syntax highlighting. The same controller can be passed to multiple setups
   * to share the underlying shiki highlighter.
   */
  highlighting?: TypstHighlightingController;
  /** Code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
}

/**
 * Bundle the default Typst CodeMirror extensions: highlighting, lint gutter,
 * compile-on-edit, diagnostics, and (when the project has an analyzer)
 * autocompletion and hover. Formatter and highlighting are opt-in; pass them
 * pre-built so async setup happens once at the call site.
 *
 * The editor's file path is read from the `typstFilePath` facet on the
 * `EditorState` — attach it per-editor when creating the state.
 *
 * ```ts
 * const highlighting = await createTypstHighlighting({ theme: "dark" });
 * const setup = createTypstSetup({
 *   project,
 *   sync: "editor-driven",
 *   highlighting,
 *   formatter: { instance: formatter, formatOnSave: true },
 * });
 *
 * const state = EditorState.create({
 *   doc,
 *   extensions: [basicSetup, ...setup, typstFilePath.of("/main.typ")],
 * });
 * ```
 */
export function createTypstSetup(options: TypstSetupOptions): Extension[] {
  const { project, highlighting, formatter, sync } = options;
  return [
    ...(highlighting ? [highlighting.extension] : []),
    lintGutter(),
    ...(sync === "editor-driven" ? [createTypstCompileSync({ project })] : []),
    createTypstDiagnostics({ project }),
    ...(project.hasAnalyzer
      ? [
          autocompletion({ override: [typstCompletionSource({ project })] }),
          createTypstHover({
            project,
            highlightCode: highlighting?.highlightCode,
          }),
        ]
      : []),
    ...(formatter ? [createTypstFormatter(formatter)] : []),
  ];
}
