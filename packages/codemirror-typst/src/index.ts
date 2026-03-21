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
import { TypstPlugin } from "./plugin.js";
import type { TypstShikiHighlighting, TypstShikiOptions } from "./shiki.js";
import {
  createTypstShikiExtension,
  createTypstShikiHighlighting,
} from "./shiki.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

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

const workspaceRegistry = new WorkspaceRegistry();

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
  const workspaceController = options.analyzer
    ? workspaceRegistry.getController({
      analyzer: options.analyzer.instance,
      compiler: options.compiler.instance,
      projectRootPath: options.analyzer.projectRootPath,
      projectEntryPath: options.analyzer.projectEntryPath,
    })
    : undefined;

  const typstPlugin = ViewPlugin.define(
    (view) =>
      new TypstPlugin({
        compiler: options.compiler.instance,
        workspaceController,
        compileDelay: delay,
        filePath,
        getFiles,
        onCompile: options.compiler.onCompile,
        onDiagnostics,
      }, view),
    {},
  );

  const extensions: Extension[] = [
    shiki.extension,
    typstPlugin,
    lintGutter(),
  ];

  if (options.analyzer) {
    // Use lint infrastructure for rendering while diagnostics are push-based.
    extensions.push(linter(null, { delay }));
  } else {
    const linterExtension = linter(
      async (view) => {
        const plugin = view.plugin(typstPlugin) as TypstPlugin | null;
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

  if (options.analyzer) {
    const session = workspaceController!.analyzerSession;

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
  }

  return extensions;
}
