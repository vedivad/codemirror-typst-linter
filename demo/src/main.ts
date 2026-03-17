import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { createTypstExtensions } from '@vedivad/codemirror-typst';
import { updateDiagnostics } from './diagnostics';

const initialDoc = `\
// Package imports are fetched on demand from packages.typst.org.
// Try introducing errors - squiggles appear instantly.
#import "@preview/cetz:0.3.4": canvas, draw

#canvas({
  draw.circle((0, 0), radius: 1)
  draw.line((0, 0), (1, 0))
})

// Uncomment to see a type error:
// #let x = 1 + "oops"
`;

const editorEl = document.getElementById('editor')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const previewEl = document.getElementById('preview')!;

const typstExtensions = await createTypstExtensions({
  highlighting: {
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
    defaultColor: 'dark',
    engine: 'javascript',
  },
  compiler: {
    renderer: {
      module: () => import('@myriaddreamin/typst-ts-renderer'),
      onSvg: (svg) => {
        previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
      },
    },
    onDiagnostics: (d) => updateDiagnostics(diagnosticsEl, d),
  },
});

new EditorView({
  state: EditorState.create({
    doc: initialDoc,
    extensions: [
      basicSetup,
      oneDark,
      ...typstExtensions,
    ],
  }),
  parent: editorEl,
});
