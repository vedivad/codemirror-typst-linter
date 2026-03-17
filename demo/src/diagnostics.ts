import type { Diagnostic } from '@codemirror/lint';

function severityIcon(severity: string) {
  if (severity === 'error') return '\u2715';
  if (severity === 'warning') return '\u26A0';
  return '\u2139';
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function updateDiagnostics(el: HTMLElement, diagnostics: Diagnostic[]) {
  if (diagnostics.length === 0) {
    el.innerHTML = `<h2>Diagnostics</h2><p class="empty">No issues found.</p>`;
    return;
  }
  const items = diagnostics
    .map(
      (d) =>
        `<li class="diagnostic ${d.severity}"><span class="icon">${severityIcon(d.severity)}</span><span class="message">${escapeHtml(d.message)}</span></li>`,
    )
    .join('');
  el.innerHTML = `<h2>Diagnostics <span class="count">${diagnostics.length}</span></h2><ul>${items}</ul>`;
}
