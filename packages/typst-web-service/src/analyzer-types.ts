/** LSP Diagnostic as returned by tinymist. */
export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string;
  source?: string;
}

export type AnalyzerRequest =
  | { type: "init"; id: number; wasmUrl: string }
  | { type: "didOpen"; id: number; uri: string; content: string }
  | { type: "didClose"; id: number; uri: string }
  | {
      type: "didChange";
      id: number;
      uri: string;
      version: number;
      content: string;
    }
  | {
      type: "completion";
      id: number;
      uri: string;
      line: number;
      character: number;
    }
  | { type: "hover"; id: number; uri: string; line: number; character: number }
  | { type: "destroy"; id: number };

export type AnalyzerResponse =
  | { type: "ready"; id: number }
  | { type: "ack"; id: number }
  | { type: "completionResult"; id: number; result: unknown }
  | { type: "hoverResult"; id: number; result: unknown }
  | { type: "destroyed"; id: number }
  | { type: "error"; id: number; message: string };

/** Unsolicited notification pushed from the worker whenever tinymist publishes diagnostics. */
export interface AnalyzerDiagnosticEvent {
  type: "diagnostics";
  uri: string;
  diagnostics: LspDiagnostic[];
}

export type AnalyzerMessage = AnalyzerResponse | AnalyzerDiagnosticEvent;
