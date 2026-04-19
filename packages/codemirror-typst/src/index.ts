import { autocompletion } from "@codemirror/autocomplete";
import { lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import type { CompileResult, TypstProject } from "@vedivad/typst-web-service";
import { typstCompletionSource } from "./completion.js";
import { toCMDiagnostic } from "./diagnostics.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import { createTypstHover } from "./hover.js";
import { CompilerLintPlugin } from "./compiler-plugin.js";
import type { TypstShikiHighlighting, TypstShikiOptions } from "./shiki.js";
import {
  createTypstShikiExtension,
  createTypstShikiHighlighting,
} from "./shiki.js";

export type {
  CompileResult,
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
  createTypstFormatter,
  createTypstShikiExtension,
  createTypstShikiHighlighting,
  toCMDiagnostic,
};

// ---------------------------------------------------------------------------
// High-level API: createTypstExtensions
// ---------------------------------------------------------------------------

export interface TypstExtensionsOptions {
  /**
   * Project that owns the VFS and (optionally) the analyzer. Construct one with
   * `new TypstProject({ compiler, analyzer })` and share it across editors that
   * should see the same files.
   */
  project: TypstProject;
  /** File path this editor represents. Default: () => "/main.typ" */
  filePath?: () => string;
  /**
   * Called after each successful compile with the full result.
   * `result.diagnostics` always contains project-wide diagnostics for all files.
   */
  onCompile?: (result: CompileResult) => void;
  /**
   * Debounce delay in ms. Resets on every keystroke and fires once typing pauses.
   * Without a debounce, every keystroke triggers an immediate compile.
   * Best paired with `throttleDelay` to get periodic updates during long edits.
   * Default: 0 (compile immediately).
   */
  debounceDelay?: number;
  /**
   * Throttle delay in ms. When typing continues past this window, forces a compile
   * even if the debounce hasn't fired yet. Only effective when `debounceDelay` > 0 —
   * without a debounce there is nothing to hold back.
   * Default: disabled.
   */
  throttleDelay?: number;
  /** Code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
  /** Syntax highlighting. Omit for defaults (github-dark). */
  highlighting?: TypstShikiOptions;
}

/**
 * Create the default Typst extension set for CodeMirror.
 *
 * ```ts
 * const project = new TypstProject({ compiler, analyzer });
 * await project.setMany(initialFiles);
 *
 * const extensions = await createTypstExtensions({
 *   project,
 *   filePath: () => activeFile,
 *   onCompile: (r) => { ... },
 *   formatter: { instance: formatter, formatOnSave: true },
 *   highlighting: { theme: "dark" },
 * });
 * ```
 */
export async function createTypstExtensions(
  options: TypstExtensionsOptions,
): Promise<Extension[]> {
  const { project, filePath, onCompile } = options;

  const shiki = await createTypstShikiHighlighting(options.highlighting);

  const delay = options.debounceDelay ?? 0;
  const throttleDelay = options.throttleDelay;
  const extensions: Extension[] = [shiki.extension, lintGutter()];

  const compilerPlugin = ViewPlugin.define(
    (view) =>
      new CompilerLintPlugin(
        {
          project,
          debounceDelay: delay,
          throttleDelay,
          filePath,
          onCompile,
        },
        view,
      ),
    {},
  );

  extensions.push(compilerPlugin);

  if (project.hasAnalyzer) {
    extensions.push(
      autocompletion({
        override: [typstCompletionSource({ project, filePath })],
      }),
    );

    extensions.push(
      createTypstHover({
        project,
        filePath,
        highlightCode: shiki.highlightCode,
      }),
    );
  }

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }
  return extensions;
}
