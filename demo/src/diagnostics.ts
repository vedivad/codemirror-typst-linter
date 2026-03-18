import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";

const SEVERITY_ICONS: Record<string, string> = {
  error: "\u2715",
  warning: "\u26A0",
  info: "\u2139",
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatLocation(doc: Text, from: number): string {
  const line = doc.lineAt(from);
  const col = from - line.from + 1;
  return `${line.number}:${col}`;
}

export function updateDiagnostics(
  el: HTMLElement,
  diagnostics: Diagnostic[],
  doc?: Text,
) {
  if (diagnostics.length === 0) {
    el.innerHTML = `<h2>Diagnostics</h2><p class="empty">No issues found.</p>`;
    return;
  }
  const items = diagnostics
    .map((d) => {
      const loc = doc
        ? `<span class="loc">${formatLocation(doc, d.from)}</span>`
        : "";
      return `<li class="diagnostic ${d.severity}"><span class="icon">${SEVERITY_ICONS[d.severity] ?? "\u2139"}</span>${loc}<span class="message">${escapeHtml(d.message)}</span></li>`;
    })
    .join("");
  el.innerHTML = `<h2>Diagnostics <span class="count">${diagnostics.length}</span></h2><ul>${items}</ul>`;
}
