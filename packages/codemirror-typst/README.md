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
  TypstProject,
} from "@vedivad/codemirror-typst";

const compiler = await TypstCompiler.create();
const project = new TypstProject({ compiler });

const typstExtensions = await createTypstExtensions({
  project,
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
  TypstProject,
} from "@vedivad/codemirror-typst";
import tinymistWasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url";

const [compiler, renderer, formatter, analyzer] = await Promise.all([
  TypstCompiler.create(),
  TypstRenderer.create(),
  TypstFormatter.create({ tab_spaces: 2, max_width: 80 }),
  TypstAnalyzer.create({ wasmUrl: tinymistWasmUrl }),
]);

const project = new TypstProject({ compiler, analyzer });

const typstExtensions = await createTypstExtensions({
  project,
  onCompile: async (result) => {
    if (result.vector) {
      const svg = await renderer.renderSvg(result.vector);
      document.querySelector("#preview")!.innerHTML = svg;
    }
  },
  debounceDelay: 300,
  throttleDelay: 2000,
  formatter: { instance: formatter, formatOnSave: true },
  highlighting: { theme: "dark" },
});
```

## Multi-file editor

Pass a `filePath` getter for multi-file projects and keep one shared `TypstProject`:

```ts
let activeFile = "/main.typ";
const files: Record<string, string> = {
  "/main.typ": "...",
  "/template.typ": "...",
};

const project = new TypstProject({ compiler, analyzer });
await project.setMany(files);

const extensions = await createTypstExtensions({
  project,
  filePath: () => activeFile,
});
```

## Compile timing

```ts
debounceDelay: 300,  // wait 300ms after typing stops
throttleDelay: 2000, // force a compile at least every 2s during continuous typing
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

## Styling hover tooltips

Hover content is rendered with stable CSS class names, so you can style it from your app stylesheet.

By default, the plugin only sets hover scroll behavior inline (`max-height` + `overflow`) and leaves visual theming to your CSS.

Useful selectors:

- `.cm-typst-hover`
- `.cm-typst-hover-content`
- `.cm-typst-hover-header`
- `.cm-typst-hover-header-main`
- `.cm-typst-hover-header-actions`
- `.cm-typst-hover-signature`
- `.cm-typst-hover-summary`
- `.cm-typst-hover-open-docs`
- `.cm-typst-hover-section`
- `.cm-typst-hover-pre`

You can also control header element order with CSS (for example via `order` on `.cm-typst-hover-summary`, `.cm-typst-hover-signature`, and `.cm-typst-hover-header-actions`).

```

## License

MIT
```
