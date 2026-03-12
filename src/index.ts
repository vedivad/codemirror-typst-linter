import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { TypstWorkerPlugin } from "./plugin.js";
import { TypstService, createTypstService } from "./service.js";

export { TypstService, createTypstService };
export type { TypstServiceOptions, CompileResult } from "./service.js";

export interface TypstLinterOptions {
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Include diagnostics from imported packages, not just the main file. Default: false. */
  includePackageDiagnostics?: boolean;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /** Called after each compile with the incremental vector bytes for SVG rendering. */
  onVector?: (vector: Uint8Array) => void;
}

export function typstLinter(
  service: TypstService,
  options: TypstLinterOptions = {},
): Extension {
  const delay = options.delay ?? 0;
  const includePackageDiagnostics = options.includePackageDiagnostics ?? false;
  const onDiagnostics = options.onDiagnostics;
  const onVector = options.onVector;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstWorkerPlugin({
        service,
        includePackageDiagnostics,
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
