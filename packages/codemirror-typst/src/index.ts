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
// High-level API: createTypstEditor
// ---------------------------------------------------------------------------

export interface TypstEditorSyncStrategy {
  readonly kind: "editor";
}

export interface TypstExternalSyncStrategy {
  readonly kind: "external";
  readonly ready?: Promise<void>;
  flush?(): Promise<void>;
  dispose?(): void;
}

export type TypstSyncStrategy =
  | TypstEditorSyncStrategy
  | TypstExternalSyncStrategy;

export function editorSync(): TypstEditorSyncStrategy {
  return { kind: "editor" };
}

export function externalSync(): TypstExternalSyncStrategy {
  return { kind: "external" };
}

export type TypstHighlightingConfig =
  | TypstHighlightingOptions
  | TypstHighlightingController
  | false;

export interface TypstEditorOptions {
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
  /**
   * Syntax highlighting. Omit for defaults, pass `false` to disable, or pass an
   * existing controller to share highlighting across editor views.
   */
  highlighting?: TypstHighlightingConfig;
  /**
   * How editor content is mirrored into the TypstProject.
   *
   * - `editorSync()`: CodeMirror pushes doc/path changes into the project.
   * - `externalSync()` or an external sync handle: caller owns syncing, e.g.
   *   from Y.js into `project.setText()` / `project.setMany()`.
   */
  sync: TypstSyncStrategy;
}

export interface TypstEditor {
  readonly extension: Extension;
  readonly highlighting?: TypstHighlightingController;
}

function isTypstHighlightingController(
  value: TypstHighlightingConfig | undefined,
): value is TypstHighlightingController {
  return (
    typeof value === "object" &&
    value !== null &&
    "extension" in value &&
    "setTheme" in value &&
    "highlightCode" in value
  );
}

/**
 * Create the default Typst editor bundle for CodeMirror. The returned extension
 * can drive compilation through the shared `TypstProject`; subscribe to results
 * via `project.onCompile(...)`, and trigger an out-of-band recompile with
 * `project.compile()`.
 *
 * The editor's file path is read from the `typstFilePath` facet on the
 * `EditorState`. Attach it per-editor when creating the state:
 *
 * ```ts
 * const typst = await createTypstEditor({
 *   project,
 *   sync: editorSync(),
 *   formatter: { instance: formatter, formatOnSave: true },
 *   highlighting: { theme: "dark" },
 * });
 *
 * const state = EditorState.create({
 *   doc,
 *   extensions: [basicSetup, typst.extension, typstFilePath.of("/main.typ")],
 * });
 * ```
 *
 * Switching files is just `view.setState(otherState)` — the new state's
 * facet value travels along with it, and the compiler plugin reacts.
 *
 * For collaborative or externally-owned documents, pass `externalSync()` or an
 * external sync handle and mirror your source of truth into the project
 * yourself. Diagnostics, completion, hover, highlighting, and formatting still
 * work against that project state.
 */
export async function createTypstEditor(
  options: TypstEditorOptions,
): Promise<TypstEditor> {
  const { project, sync } = options;
  const highlighting =
    options.highlighting === false
      ? undefined
      : isTypstHighlightingController(options.highlighting)
        ? options.highlighting
        : await createTypstHighlighting(options.highlighting);

  const extensions: Extension[] = [];

  if (highlighting) {
    extensions.push(highlighting.extension);
  }

  extensions.push(lintGutter());

  if (sync.kind === "editor") {
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
        highlightCode: highlighting?.highlightCode,
      }),
    );
  }

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }

  return { extension: extensions, highlighting };
}
