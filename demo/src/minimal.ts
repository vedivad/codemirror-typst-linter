import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createTypstExtensions,
  TypstCompiler,
  TypstProject,
  TypstRenderer,
} from "@vedivad/codemirror-typst";
import { basicSetup, EditorView } from "codemirror";

const editorEl = document.getElementById("editor")!;
const previewEl = document.getElementById("preview")!;

const [compiler, renderer] = await Promise.all([
  TypstCompiler.create(),
  TypstRenderer.create(),
]);

const project = new TypstProject({
  compiler,
  autoCompile: { debounceMs: 500, maxWaitMs: 1500 },
});

project.onCompile(async (result) => {
  if (result.vector) {
    const svg = await renderer.renderSvg(result.vector);
    previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
  }
});

const typstExtensions = await createTypstExtensions({
  project,
  highlighting: { theme: "dark" },
});

new EditorView({
  parent: editorEl,
  state: EditorState.create({
    doc: `= Hello, Typst!\n\nType to compile. Errors show in the gutter.\n\n#let greet(name) = [Hello, #name!]\n\n#greet("world")\n`,
    extensions: [basicSetup, oneDark, ...typstExtensions],
  }),
});

await project.compile(); // trigger initial compile immediately, bypass auto-compile debounce
