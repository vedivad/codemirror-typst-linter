import { autocompletion } from "@codemirror/autocomplete";
import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import {
  AnalyzerSession,
  type CompileResult,
  type TypstAnalyzer,
  type TypstCompiler,
} from "@vedivad/typst-web-service";
import { typstCompletionSource } from "./completion.js";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import { createTypstHover } from "./hover.js";
import { TypstLinterPlugin } from "./plugin.js";
import type { TypstShikiHighlighting, TypstShikiOptions } from "./shiki.js";
import {
  createTypstShikiExtension,
  createTypstShikiHighlighting,
} from "./shiki.js";

export type {
  CompileResult,
  FormatConfig,
  TypstCompilerOptions,
  TypstRendererOptions,
} from "@vedivad/typst-web-service";
export {
  AnalyzerSession,
  TypstAnalyzer,
  TypstCompiler,
  TypstFormatter,
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
  lspToCMDiagnostic,
  toCMDiagnostic,
};

// ---------------------------------------------------------------------------
// High-level API: createTypstExtensions
// ---------------------------------------------------------------------------

export interface TypstExtensionsOptions {
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /** Compiler config. Handles compilation for preview/PDF and fallback diagnostics. */
  compiler: {
    instance: TypstCompiler;
    /** Called after each successful compile with the full result (e.g. for SVG preview). */
    onCompile?: (result: CompileResult) => void;
    /** Delay in ms before linting fires after a document change. Default: 0. */
    delay?: number;
  };
  /** Tinymist analyzer for diagnostics, autocompletion, and hover. Omit to disable. */
  analyzer?: {
    instance: TypstAnalyzer;
    /** Project root path for the analyzer session. Default: "/project". */
    projectRootPath?: string;
    /** Entry path for the analyzer session. Default: "/main.typ". */
    projectEntryPath?: string;
  };
  /** Code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
  /** Syntax highlighting. Omit for defaults (github-dark). */
  highlighting?: TypstShikiOptions;
}

// ---------------------------------------------------------------------------
// Low-level API: createTypstLinter (unchanged for backward compat)
// ---------------------------------------------------------------------------

export interface TypstLinterOptions {
  /** TypstCompiler instance to use for compilation. */
  compiler: TypstCompiler;
  /** tinymist analyzer for push-based diagnostics. Optional. */
  analyzer?: TypstAnalyzer;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Optional root path for auto-created analyzer sessions. Default: "/project". */
  projectRootPath?: string;
  /** Optional entry path for auto-created analyzer sessions. Default: "/main.typ". */
  projectEntryPath?: string;
  /** Called after each successful compile with the full result (e.g. for SVG preview). */
  onCompile?: (result: CompileResult) => void;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

/**
 * Create a Typst linter extension for CodeMirror (low-level API).
 *
 *   createTypstLinter({ compiler, filePath: "/main.typ", onDiagnostics })
 */
export function createTypstLinter(options: TypstLinterOptions): Extension {
  const {
    compiler,
    analyzer,
    filePath,
    getFiles,
    delay = 0,
    projectRootPath,
    projectEntryPath,
    onCompile,
    onDiagnostics,
  } = options;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstLinterPlugin({
        compiler,
        analyzer,
        filePath,
        getFiles,
        projectRootPath,
        projectEntryPath,
        onCompile,
        onDiagnostics,
      }),
    {},
  );

  const linterExtension = linter(
    async (view) => {
      const plugin = view.plugin(workerPlugin);
      if (!plugin) return [];
      return plugin.lint(view);
    },
    { delay },
  );

  return [workerPlugin, linterExtension, lintGutter()];
}

/**
 * Create the default Typst extension set for CodeMirror.
 *
 * ```ts
 * const extensions = await createTypstExtensions({
 *   filePath: "/main.typ",
 *   getFiles: () => files,
 *   compiler: { instance: compiler, onCompile: (r) => { ... } },
 *   analyzer: { instance: analyzer },
 *   formatter: { instance: formatter, formatOnSave: true },
 *   highlighting: { theme: "dark" },
 *   onDiagnostics: (d) => { ... },
 * });
 * ```
 */
export async function createTypstExtensions(
  options: TypstExtensionsOptions,
): Promise<Extension[]> {
  const { filePath, getFiles, onDiagnostics } = options;

  const shiki = await createTypstShikiHighlighting(options.highlighting);

  const linterExtension = createTypstLinter({
    compiler: options.compiler.instance,
    analyzer: options.analyzer?.instance,
    filePath,
    getFiles,
    delay: options.compiler.delay,
    projectRootPath: options.analyzer?.projectRootPath,
    projectEntryPath: options.analyzer?.projectEntryPath,
    onCompile: options.compiler.onCompile,
    onDiagnostics,
  });

  const extensions: Extension[] = [shiki.extension, linterExtension];

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }

  if (options.analyzer) {
    const session = new AnalyzerSession({
      analyzer: options.analyzer.instance,
      rootPath: options.analyzer.projectRootPath,
      entryPath: options.analyzer.projectEntryPath,
    });

    extensions.push(
      autocompletion({
        override: [
          typstCompletionSource({ session, filePath, getFiles }),
        ],
      }),
    );

    extensions.push(createTypstHover({ session, filePath, getFiles, highlightCode: shiki.highlightCode }));
  }

  return extensions;
}
