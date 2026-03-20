import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type { DiagnosticMessage } from "@vedivad/typst-web-service";

export function toCMDiagnostic(
  state: EditorState,
  d: DiagnosticMessage,
): Diagnostic {
  const { startLine, startCol, endLine, endCol } = d.range;
  const docLines = state.doc.lines;

  // typst.ts 'full' range is 0-indexed; CM doc.line() is 1-indexed
  const fromLine = Math.min(startLine + 1, docLines);
  const toLine = Math.min(endLine + 1, docLines);

  let from = state.doc.line(fromLine).from + startCol;
  let to = state.doc.line(toLine).from + endCol;

  const len = state.doc.length;
  from = Math.max(0, Math.min(from, len));
  to = Math.max(from, Math.min(to, len));

  // Ensure the squiggle covers at least one character
  if (from === to && to < len) to += 1;

  return {
    from,
    to,
    severity: d.severity.toLowerCase() as Diagnostic["severity"],
    message: d.message,
    source: "typst",
  };
}
