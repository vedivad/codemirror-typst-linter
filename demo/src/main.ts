import { createEditor } from './editor';
import { updateDiagnostics } from './diagnostics';

const editorEl = document.getElementById('editor')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const previewEl = document.getElementById('preview')!;

createEditor(editorEl, {
  renderer: {
    module: () => import('@myriaddreamin/typst-ts-renderer'),
    onSvg: (svg) => {
      previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
    },
  },
  onDiagnostics: (d) => updateDiagnostics(diagnosticsEl, d),
});
