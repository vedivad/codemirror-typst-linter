import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { TypstWorkerPlugin } from "./plugin.js";
import { TypstService, createTypstService } from "./service.js";
import type { TypstServiceOptions } from "./service.js";

export { TypstService, createTypstService };
export type { TypstServiceOptions, CompileResult } from "./service.js";

export interface TypstLinterOptions extends TypstServiceOptions {
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /** Called after each compile with the vector artifact bytes, usable with typst-ts-renderer for SVG rendering. */
  onVector?: (vector: Uint8Array) => void;
}

/**
 * Create a Typst linter extension for CodeMirror.
 *
 * When called without a service, one is created automatically (and destroyed
 * when the editor view is destroyed):
 *   typstLinter({ onDiagnostics, onVector })
 *
 * When called with an explicit service, the caller manages its lifecycle:
 *   typstLinter(service, { onDiagnostics, onVector })
 */
export function typstLinter(
  serviceOrOptions?: TypstService | TypstLinterOptions,
  options?: TypstLinterOptions,
): Extension {
  let service: TypstService;
  let ownsService: boolean;
  let opts: TypstLinterOptions;

  if (serviceOrOptions instanceof TypstService) {
    service = serviceOrOptions;
    ownsService = false;
    opts = options ?? {};
  } else {
    opts = serviceOrOptions ?? {};
    service = createTypstService(opts);
    ownsService = true;
  }

  const delay = opts.delay ?? 0;
  const onDiagnostics = opts.onDiagnostics;
  const onVector = opts.onVector;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstWorkerPlugin({
        service,
        ownsService,
        onDiagnostics,
        onVector,
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
