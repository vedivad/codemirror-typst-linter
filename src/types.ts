export interface DiagnosticMessage {
  package: string;
  path: string;
  severity: string; // 'Error' | 'Warning' | 'Info' from typst.ts
  range: string;    // "startLine:startCol-endLine:endCol" (0-indexed)
  message: string;
}

export type WorkerRequest =
  | { type: 'init'; id: number; wasmUrl: string; fonts: string[] }
  | { type: 'compile'; id: number; source: string }
  | { type: 'destroy'; id: number };

export type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; diagnostics: DiagnosticMessage[] }
  | { type: 'error'; id: number; message: string };
