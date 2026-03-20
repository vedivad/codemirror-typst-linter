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
import { toCMDiagnostic } from "./diagnostics.js";
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
  toCMDiagnostic,
};

export interface TypstExtensionsOptions {
  /** Options forwarded to the Typst Shiki highlighting factory. */
  highlighting?: TypstShikiOptions;
  /** Options forwarded to the Typst linter extension. */
  linter: TypstLinterOptions;
  /** Options for the code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
  /** Tinymist analyzer for autocompletion and hover. Omit to disable. */
  analyzer?: TypstAnalyzerExtensionOptions;
}

export interface TypstLinterOptions {
  /** TypstCompiler instance to use for compilation. */
  compiler: TypstCompiler;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Called after each successful compile with the full result (e.g. for SVG preview). */
  onCompile?: (result: CompileResult) => void;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export interface TypstAnalyzerExtensionOptions {
  /** TypstAnalyzer instance for autocompletion and hover. */
  analyzer: TypstAnalyzer;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. */
  getFiles?: () => Record<string, string>;
  /** Project root path for the analyzer session. Default: "/project". */
  projectRootPath?: string;
  /** Entry path for the analyzer session. Default: "/main.typ". */
  projectEntryPath?: string;
  /** Optional function to syntax-highlight code blocks in hover tooltips. Receives code and language, returns HTML. */
  highlightCode?: (code: string, language: string) => string;
}

/**
 * Create a Typst linter extension for CodeMirror.
 *
 *   createTypstLinter({ compiler, filePath: "/main.typ", onDiagnostics })
 */
export function createTypstLinter(options: TypstLinterOptions): Extension {
  const {
    compiler,
    filePath,
    getFiles,
    delay = 0,
    onCompile,
    onDiagnostics,
  } = options;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstLinterPlugin({
        compiler,
        filePath,
        getFiles,
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
 */
export async function createTypstExtensions(
  options: TypstExtensionsOptions,
): Promise<Extension[]> {
  const shikiExtension = await createTypstShikiExtension(options.highlighting);
  const linterExtension = createTypstLinter(options.linter);
  const extensions: Extension[] = [shikiExtension, linterExtension];

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }

  if (options.analyzer) {
    const { analyzer, filePath, getFiles, projectRootPath, projectEntryPath, highlightCode } =
      options.analyzer;

    const session = new AnalyzerSession({
      analyzer,
      rootPath: projectRootPath,
      entryPath: projectEntryPath,
    });

    extensions.push(
      autocompletion({
        override: [
          typstCompletionSource({ session, filePath, getFiles }),
        ],
      }),
    );

    extensions.push(createTypstHover({ session, filePath, getFiles, highlightCode }));
  }

  return extensions;
}
