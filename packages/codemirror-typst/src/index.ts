import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { TypstWorkerPlugin } from "./plugin.js";
import { TypstService, createTypstService } from "typst-web-service";
import type { TypstServiceOptions } from "typst-web-service";

export { TypstService, createTypstService };
export type { TypstServiceOptions, RendererOptions, CompileResult } from "typst-web-service";

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
 *   typstLinter({ onDiagnostics, onSvg })
 *
 * With an explicit service, the caller manages its lifecycle:
 *   typstLinter({ service, onDiagnostics })
 */
export function typstLinter(options: TypstLinterOptions = {}): Extension {
  const { service: externalService, delay = 0, onDiagnostics, ...serviceOptions } = options;
  const service = externalService ?? createTypstService(serviceOptions);

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
