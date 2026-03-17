import { TypstService } from 'codemirror-typst';
import { createEditor } from './editor';
import { updateDiagnostics } from './diagnostics';
import { applyVector, initPreview } from './preview';

const editorEl = document.getElementById('editor')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const previewEl = document.getElementById('preview')!;

const service = new TypstService(
  new Worker(new URL('typst-web-service/worker', import.meta.url), { type: 'module' }),
  { onVector: (v) => applyVector(previewEl, v) },
);

createEditor(editorEl, service, (d) => updateDiagnostics(diagnosticsEl, d));

initPreview(previewEl).then(() => {
  if (service.lastVector) applyVector(previewEl, service.lastVector);
});
