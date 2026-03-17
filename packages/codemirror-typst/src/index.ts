import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { TypstWorkerPlugin } from "./plugin.js";
import { TypstService } from "@vedivad/typst-web-service";
import type { TypstServiceOptions } from "@vedivad/typst-web-service";
import { createTypstShikiExtension, createTypstShikiHighlighting } from "./shiki.js";
import type { TypstShikiOptions, TypstShikiHighlighting } from "./shiki.js";

export { TypstService };
export { createTypstShikiExtension };
export { createTypstShikiHighlighting };
export type { TypstServiceOptions, RendererOptions, CompileResult } from "@vedivad/typst-web-service";
export type { TypstShikiOptions, TypstShikiHighlighting };

export interface TypstExtensionsOptions {
  /** Options forwarded to the Typst Shiki highlighting factory. */
  highlighting?: TypstShikiOptions;
  /** Options forwarded to the Typst compiler/lint extension factory. */
  compiler?: TypstLinterOptions;
}

export interface TypstLinterOptions extends TypstServiceOptions {
  /**
   * External service to use. When provided, its lifecycle is managed by the caller.
   * When omitted, a service is created automatically and destroyed with the editor.
   */
  service?: TypstService;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

/**
 * Create a Typst linter extension for CodeMirror.
 *
 * Without a service, one is created automatically (destroyed with the editor):
 *   createTypstLinter({ onDiagnostics, renderer: { ... } })
 *
 * With an explicit service, the caller manages its lifecycle:
 *   createTypstLinter({ service, onDiagnostics })
 */
export function createTypstLinter(options: TypstLinterOptions = {}): Extension {
  const { service: externalService, delay = 0, onDiagnostics, ...serviceOptions } = options;
  const service = externalService ?? TypstService.create(serviceOptions);

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstWorkerPlugin({
        service,
        onDestroy: externalService ? undefined : () => service.destroy(),
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
export async function createTypstExtensions(options: TypstExtensionsOptions = {}): Promise<Extension[]> {
  const shikiExtension = await createTypstShikiExtension(options.highlighting);
  const linterExtension = createTypstLinter(options.compiler);
  return [shikiExtension, linterExtension];
}
