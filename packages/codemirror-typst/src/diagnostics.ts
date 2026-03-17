import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type { DiagnosticMessage } from "typst-web-service";

function parseRange(range: string): [number, number, number, number] {
  const m = range.match(/(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) return [0, 0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
}

function mapSeverity(raw: DiagnosticMessage["severity"]): Diagnostic["severity"] {
  if (raw === "Warning") return "warning";
  if (raw === "Info") return "info";
  return "error";
}

export function toCMDiagnostic(state: EditorState, d: DiagnosticMessage): Diagnostic {
  const [startLine, startCol, endLine, endCol] = parseRange(d.range);
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

  return { from, to, severity: mapSeverity(d.severity), message: d.message, source: "typst" };
}
