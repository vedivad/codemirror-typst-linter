import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { typst } from 'codemirror-lang-typst';
import { typstLinter } from 'codemirror-typst';
import type { TypstService } from 'typst-web-service';
import type { Diagnostic } from '@codemirror/lint';

const initialDoc = `\
// Package imports are fetched on demand from packages.typst.org.
// Try introducing errors — squiggles appear instantly.
#import "@preview/cetz:0.3.4": canvas, draw

#canvas({
  draw.circle((0, 0), radius: 1)
  draw.line((0, 0), (1, 0))
})

// Uncomment to see a type error:
// #let x = 1 + "oops"
`;

export function createEditor(
  parent: HTMLElement,
  service: TypstService,
  onDiagnostics: (diagnostics: Diagnostic[]) => void,
) {
  return new EditorView({
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        oneDark,
        typst(),
        typstLinter(service, { onDiagnostics }),
      ],
    }),
    parent,
  });
}
