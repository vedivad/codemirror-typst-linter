export interface DiagnosticMessage {
  package: string;
  path: string;
  severity: "Error" | "Warning" | "Info";
  range: string; // "startLine:startCol-endLine:endCol" (0-indexed)
  message: string;
}

export type WorkerRequest =
  | { type: "init"; id: number; wasmUrl: string; fonts: string[]; packages: boolean }
  | { type: "compile"; id: number; source: string }
  | { type: "render"; id: number; source: string }
  | { type: "destroy"; id: number };

export type WorkerResponse =
  | { type: "ready"; id: number }
  | { type: "result"; id: number; diagnostics: DiagnosticMessage[]; vector?: ArrayBuffer }
  | { type: "pdf"; id: number; data: ArrayBuffer }
  | { type: "cancelled"; id: number }
  | { type: "destroyed"; id: number }
  | { type: "error"; id: number; message: string };
