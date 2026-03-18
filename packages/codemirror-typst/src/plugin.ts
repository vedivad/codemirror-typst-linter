import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type {
  DiagnosticMessage,
  TypstService,
} from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";

export interface PluginOptions {
  service: TypstService;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  onDestroy?: () => void;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export class TypstWorkerPlugin {
  private path: string;
  private unsubscribe: () => void;
  private pendingResolve: ((diags: DiagnosticMessage[]) => void) | null = null;

  constructor(private options: PluginOptions) {
    this.path = options.filePath ?? "/main.typ";
    this.unsubscribe = options.service.onDiagnostics(this.path, (diags) => {
      if (this.pendingResolve) {
        this.pendingResolve(diags);
        this.pendingResolve = null;
      }
    });
  }

  async lint(view: EditorView): Promise<Diagnostic[]> {
    const source = view.state.doc.toString();

    // Update the file in the service — triggers debounced auto-compile
    this.options.service.setFile(this.path, source);

    // Wait for the next diagnostic dispatch for our file
    const diags = await new Promise<DiagnosticMessage[]>((resolve) => {
      this.pendingResolve = resolve;
    });

    const diagnostics = diags.map((d) => toCMDiagnostic(view.state, d));
    this.options.onDiagnostics?.(diagnostics);
    return diagnostics;
  }

  destroy() {
    this.unsubscribe();
    this.options.onDestroy?.();
  }
}
