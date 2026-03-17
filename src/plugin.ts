import type { Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { toCMDiagnostic } from "./diagnostics.js";
import type { TypstService } from "./service.js";

export interface PluginOptions {
  service: TypstService;
  ownsService: boolean;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  onVector?: (vector: Uint8Array) => void;
}

export class TypstWorkerPlugin {
  private seq = 0;

  constructor(private options: PluginOptions) {}

  async lint(view: EditorView): Promise<Diagnostic[]> {
    const mySeq = ++this.seq;
    const source = view.state.doc.toString();

    let diagnostics: Diagnostic[];

    try {
      const result = await this.options.service.compile(source);

      if (mySeq !== this.seq) return [];

      if (result.vector) this.options.onVector?.(result.vector);

      diagnostics = result.diagnostics.map((d) => toCMDiagnostic(view.state, d));
    } catch (err) {
      if (mySeq !== this.seq) return [];
      diagnostics = [
        {
          from: 0,
          to: Math.min(1, view.state.doc.length),
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
          source: "typst",
        },
      ];
    }

    this.options.onDiagnostics?.(diagnostics);
    return diagnostics;
  }

  destroy() {
    if (this.options.ownsService) this.options.service.destroy();
  }
}
