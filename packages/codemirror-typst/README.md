# @vedivad/codemirror-typst

CodeMirror 6 extensions for Typst — syntax highlighting, diagnostics, autocompletion, hover tooltips, formatting, and live preview.

Re-exports everything from `@vedivad/typst-web-service`, so you only need this one dependency.

## Install

```bash
npm install @vedivad/codemirror-typst
```

## Prerequisites

- A bundler with WASM support (e.g. [Vite](https://vite.dev) + [`vite-plugin-wasm`](https://github.com/nicolo-ribaudo/vite-plugin-wasm))
- The formatter requires the bundler to handle static WASM imports from `@typstyle/typstyle-wasm-bundler`
- The analyzer requires a URL to the tinymist WASM binary (see [LSP analysis](#lsp-analysis))

## Minimal editor

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  createTypstExtensions,
  TypstCompiler,
} from "@vedivad/codemirror-typst";

const compiler = await TypstCompiler.create();

const typstExtensions = await createTypstExtensions({
  compiler: { instance: compiler },
  highlighting: { theme: "dark" },
});

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: "= Hello, Typst!",
    extensions: [basicSetup, ...typstExtensions],
  }),
});
```

## Full-featured editor

```ts
import {
  createTypstExtensions,
  TypstCompiler,
  TypstRenderer,
  TypstFormatter,
  TypstAnalyzer,
} from "@vedivad/codemirror-typst";
import tinymistWasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url";

const [compiler, renderer, formatter, analyzer] = await Promise.all([
  TypstCompiler.create(),
  TypstRenderer.create(),
  TypstFormatter.create({ tab_spaces: 2, max_width: 80 }),
  TypstAnalyzer.create({ wasmUrl: tinymistWasmUrl }),
]);

const typstExtensions = await createTypstExtensions({
  compiler: {
    instance: compiler,
    onCompile: async (result) => {
      if (result.vector) {
        const svg = await renderer.renderSvg(result.vector);
        document.querySelector("#preview")!.innerHTML = svg;
      }
    },
    debounceDelay: 300,
    throttleDelay: 2000,
  },
  analyzer: { instance: analyzer },
  formatter: { instance: formatter, formatOnSave: true },
  highlighting: { theme: "dark" },
});
```

## Multi-file editor

Pass a `filePath` getter and `getFiles` for multi-file projects. Share the same `TypstAnalyzer` instance across tabs — the session is managed internally:

```ts
let activeFile = "/main.typ";
const files: Record<string, string> = {
  "/main.typ": "...",
  "/template.typ": "...",
};

const extensions = await createTypstExtensions({
  filePath: () => activeFile,
  getFiles: () => files,
  compiler: { instance: compiler },
  analyzer: { instance: analyzer },
});
```

## Compile timing

```ts
compiler: {
  instance: compiler,
  debounceDelay: 300,  // wait 300ms after typing stops
  throttleDelay: 2000, // force a compile at least every 2s during continuous typing
}
```

## LSP analysis

The analyzer requires a URL to `tinymist_bg.wasm` from the `tinymist-web` package:

- **Vite**: `import wasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url"`
- **Static server**: copy `node_modules/tinymist-web/pkg/tinymist_bg.wasm` to your public directory

## Format on save

```ts
formatter: { instance: formatter, formatOnSave: true }

// With a save callback
formatter: {
  instance: formatter,
  formatOnSave: (content) => {
    fetch("/api/save", { method: "POST", body: content });
  },
}
```

## Diagnostics modes

- Diagnostics are always pulled from `TypstCompiler` after each compile.
- `TypstAnalyzer` is used for editor intelligence only (autocompletion and hover).

## License

MIT
