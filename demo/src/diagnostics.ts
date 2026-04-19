import type { DiagnosticMessage } from "@vedivad/codemirror-typst";

const SEVERITY_ICONS: Record<string, string> = {
  Error: "\u2715",
  Warning: "\u26A0",
  Info: "\u2139",
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatPath(path: string): string {
  return path.replace(/^\//, "");
}

export function updateDiagnostics(
  el: HTMLElement,
  diagnostics: DiagnosticMessage[],
) {
  if (diagnostics.length === 0) {
    el.innerHTML = `<h2>Diagnostics</h2><p class="empty">No issues found.</p>`;
    return;
  }
  const items = diagnostics
    .map((d) => {
      const path = escapeHtml(formatPath(d.path));
      const severityClass = d.severity.toLowerCase();
      const line = d.range.startLine + 1;
      const col = d.range.startCol + 1;
      return `<li class="diagnostic ${severityClass}"><span class="icon">${SEVERITY_ICONS[d.severity] ?? "\u2139"}</span><span class="loc">${path}:${line}:${col}</span><span class="message">${escapeHtml(d.message)}</span></li>`;
    })
    .join("");
  el.innerHTML = `<h2>Diagnostics <span class="count">${diagnostics.length}</span></h2><ul>${items}</ul>`;
}
