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
import { CompilerLintPlugin, PushDiagnosticsPlugin } from "./plugin.js";
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
    /** Shared AnalyzerSession. When provided, the session is reused (not destroyed with the plugin). When omitted, a new session is created and destroyed with the editor. */
    session?: AnalyzerSession;
    /** Project root path for the analyzer session. Default: "/project". Ignored when session is provided. */
    projectRootPath?: string;
    /** Entry path for the analyzer session. Default: "/main.typ". Ignored when session is provided. */
    projectEntryPath?: string;
  };
  /** Code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
  /** Syntax highlighting. Omit for defaults (github-dark). */
  highlighting?: TypstShikiOptions;
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

  const delay = options.compiler.delay ?? 0;
  const extensions: Extension[] = [shiki.extension, lintGutter()];

  if (options.analyzer) {
    const ownsSession = !options.analyzer.session;
    const session = options.analyzer.session ?? new AnalyzerSession({
      analyzer: options.analyzer.instance,
      rootPath: options.analyzer.projectRootPath,
      entryPath: options.analyzer.projectEntryPath,
    });

    const pushPlugin = ViewPlugin.define(
      (view) =>
        new PushDiagnosticsPlugin(
          {
            session,
            ownsSession,
            compiler: options.compiler.instance,
            compileDelay: delay,
            filePath,
            getFiles,
            onCompile: options.compiler.onCompile,
            onDiagnostics,
          },
          view,
        ),
      {},
    );

    extensions.push(pushPlugin);

    // Use lint infrastructure for rendering while diagnostics are push-based.
    extensions.push(linter(null, { delay }));

    extensions.push(
      autocompletion({
        override: [typstCompletionSource({ session, filePath, getFiles })],
      }),
    );

    extensions.push(
      createTypstHover({
        session,
        filePath,
        getFiles,
        highlightCode: shiki.highlightCode,
      }),
    );
  } else {
    const compilerPlugin = ViewPlugin.define(
      () =>
        new CompilerLintPlugin({
          compiler: options.compiler.instance,
          filePath,
          getFiles,
          onCompile: options.compiler.onCompile,
          onDiagnostics,
        }),
      {},
    );

    extensions.push(compilerPlugin);

    const linterExtension = linter(
      async (view) => {
        const plugin = view.plugin(compilerPlugin) as CompilerLintPlugin | null;
        if (!plugin) return [];
        return plugin.lint(view);
      },
      { delay },
    );
    extensions.push(linterExtension);
  }

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }
  return extensions;
}
