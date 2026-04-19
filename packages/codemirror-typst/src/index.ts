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
import { CompilerLintPlugin } from "./compiler-plugin.js";
import { PushDiagnosticsPlugin } from "./push-diagnostics-plugin.js";
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

/** Implicit session cache: one session per TypstAnalyzer instance. */
const sessionCache = new WeakMap<TypstAnalyzer, AnalyzerSession>();

export interface TypstExtensionsOptions {
  /** File path this editor represents. Default: () => "/main.typ" */
  filePath?: () => string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /** Compiler config. Handles compilation for preview/PDF and fallback diagnostics. */
  compiler: {
    instance: TypstCompiler;
    /** Called after each successful compile with the full result (e.g. for SVG preview). */
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
  };
  /** Tinymist analyzer for diagnostics, autocompletion, and hover. Omit to disable. */
  analyzer?: {
    instance: TypstAnalyzer;
    /** Project root path for the analyzer session. Default: "/project". Shared when the same analyzer instance is reused across editors. */
    rootPath?: string;
    /** Entry path for the analyzer session. Default: "/main.typ". Shared when the same analyzer instance is reused across editors. */
    entryPath?: string;
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
 *   filePath: () => "/main.typ",
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

  const delay = options.compiler.debounceDelay ?? 0;
  const throttleDelay = options.compiler.throttleDelay;
  const extensions: Extension[] = [shiki.extension, lintGutter()];

  if (options.analyzer) {
    const { instance } = options.analyzer;
    let session = sessionCache.get(instance);
    if (!session) {
      session = new AnalyzerSession({
        analyzer: instance,
        rootPath: options.analyzer.rootPath,
        entryPath: options.analyzer.entryPath,
      });
      sessionCache.set(instance, session);
    }

    const pushPlugin = ViewPlugin.define(
      (view) =>
        new PushDiagnosticsPlugin(
          {
            session,
            ownsSession: false,
            compiler: options.compiler.instance,
            debounceDelay: delay,
            throttleDelay,
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
      (view) =>
        new CompilerLintPlugin(
          {
            compiler: options.compiler.instance,
            debounceDelay: delay,
            throttleDelay,
            filePath,
            getFiles,
            onCompile: options.compiler.onCompile,
            onDiagnostics,
          },
          view,
        ),
      {},
    );

    extensions.push(compilerPlugin);
  }

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }
  return extensions;
}
