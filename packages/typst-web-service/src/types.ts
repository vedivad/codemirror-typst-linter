/** Source range for a diagnostic. All values are 0-indexed. */
export interface DiagnosticRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface DiagnosticMessage {
  package: string;
  path: string;
  severity: "Error" | "Warning" | "Info";
  range: DiagnosticRange;
  message: string;
}
