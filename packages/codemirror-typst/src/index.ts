import { autocompletion } from "@codemirror/autocomplete";
import { lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { TypstProject } from "@vedivad/typst-web-service";
import { createTypstCompileSync } from "./compile-sync.js";
import { typstCompletionSource } from "./completion.js";
import { toCMDiagnostic } from "./diagnostics.js";
import { createTypstDiagnostics } from "./diagnostics-plugin.js";
import { typstFilePath } from "./facets.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import { createTypstHover } from "./hover.js";
import type { TypstShikiHighlighting, TypstShikiOptions } from "./shiki.js";
import {
  createTypstShikiExtension,
  createTypstShikiHighlighting,
} from "./shiki.js";
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
  TypstShikiHighlighting,
  TypstShikiOptions,
};
export {
  createTypstCompileSync,
  createTypstDiagnostics,
  createTypstFormatter,
  createTypstShikiExtension,
  createTypstShikiHighlighting,
  diagnosticLocation,
  groupDiagnosticsByFile,
  toCMDiagnostic,
  typstFilePath,
};
export type { CompileSyncOptions } from "./compile-sync.js";
export type { DiagnosticsPluginOptions } from "./diagnostics-plugin.js";

// ---------------------------------------------------------------------------
// High-level API: createTypstExtensions
// ---------------------------------------------------------------------------

export interface TypstExtensionsOptions {
  /**
   * Project that owns the VFS and (optionally) the analyzer. Construct one with
   * `new TypstProject({ compiler, analyzer })` and share it across editors that
   * should see the same files. Subscribe to compile results with
   * `project.onCompile(listener)`. Configure auto-compile scheduling via the
   * `autoCompile` option on the project itself.
   */
  project: TypstProject;
  /** Code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
  /** Syntax highlighting. Omit for defaults (github-dark). */
  highlighting?: TypstShikiOptions;
  /**
   * How editor content is mirrored into the TypstProject.
   *
   * - "editor" (default): CodeMirror pushes doc/path changes into the project.
   * - "external": caller owns syncing, e.g. from Y.js observers via
   *   `project.setText()` / `project.setMany()`.
   */
  sync?: "editor" | "external";
}

/**
 * Create the default Typst extension set for CodeMirror. The returned extensions
 * can drive compilation through the shared `TypstProject`; subscribe to results
 * via `project.onCompile(...)`, and trigger an out-of-band recompile with
 * `project.compile()`.
 *
 * The editor's file path is read from the `typstFilePath` facet on the
 * `EditorState`. Attach it per-editor when creating the state:
 *
 * ```ts
 * const typstExtensions = await createTypstExtensions({
 *   project,
 *   formatter: { instance: formatter, formatOnSave: true },
 *   highlighting: { theme: "dark" },
 * });
 *
 * const shared = [basicSetup, ...typstExtensions];
 * const state = EditorState.create({
 *   doc,
 *   extensions: [...shared, typstFilePath.of("/main.typ")],
 * });
 * ```
 *
 * Switching files is just `view.setState(otherState)` — the new state's
 * facet value travels along with it, and the compiler plugin reacts.
 *
 * For collaborative or externally-owned documents, pass `sync: "external"`
 * and mirror your source of truth into the project yourself. Diagnostics,
 * completion, hover, highlighting, and formatting still work against that
 * project state.
 */
export async function createTypstExtensions(
  options: TypstExtensionsOptions,
): Promise<Extension[]> {
  const { project, sync = "editor" } = options;

  const shiki = await createTypstShikiHighlighting(options.highlighting);

  const extensions: Extension[] = [shiki.extension, lintGutter()];

  if (sync !== "external") {
    extensions.push(createTypstCompileSync({ project }));
  }

  extensions.push(createTypstDiagnostics({ project }));

  if (project.hasAnalyzer) {
    extensions.push(
      autocompletion({
        override: [typstCompletionSource({ project })],
      }),
    );

    extensions.push(
      createTypstHover({
        project,
        highlightCode: shiki.highlightCode,
      }),
    );
  }

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }

  return extensions;
}
