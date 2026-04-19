import type { DiagnosticMessage } from "@vedivad/typst-web-service";

export interface DiagnosticLocation {
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  col: number;
}

/**
 * Group diagnostics by file path while preserving original order per file.
 */
export function groupDiagnosticsByFile(
  diagnostics: readonly DiagnosticMessage[],
): Record<string, DiagnosticMessage[]> {
  const grouped: Record<string, DiagnosticMessage[]> = {};
  for (const diagnostic of diagnostics) {
    if (!grouped[diagnostic.path]) grouped[diagnostic.path] = [];
    grouped[diagnostic.path].push(diagnostic);
  }
  return grouped;
}

/**
 * Convert a diagnostic's start position to a 1-based location.
 */
export function diagnosticLocation(
  diagnostic: DiagnosticMessage,
): DiagnosticLocation {
  return {
    path: diagnostic.path,
    line: diagnostic.range.startLine + 1,
    col: diagnostic.range.startCol + 1,
  };
}
