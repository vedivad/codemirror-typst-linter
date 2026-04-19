import type { DiagnosticMessage } from "./types.js";

/**
 * Return a sorted copy of diagnostics by file path, source range, then message.
 */
export function sortDiagnosticsByFileAndRange(
  diagnostics: readonly DiagnosticMessage[],
): DiagnosticMessage[] {
  return [...diagnostics].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.range.startLine - b.range.startLine ||
      a.range.startCol - b.range.startCol ||
      a.range.endLine - b.range.endLine ||
      a.range.endCol - b.range.endCol ||
      a.message.localeCompare(b.message),
  );
}
