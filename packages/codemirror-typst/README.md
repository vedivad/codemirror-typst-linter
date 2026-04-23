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

Syntax highlighting, diagnostics, and compilation — no URLs or config.

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

Adds live SVG preview, autocompletion/hover, and format on save.

```ts
import {
  createTypstExtensions,
  TypstAnalyzer,
  TypstCompiler,
  TypstFormatter,
  TypstProject,
  TypstRenderer,
} from "@vedivad/codemirror-typst";
import tinymistWasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url";

const [compiler, renderer, formatter, analyzer] = await Promise.all([
  TypstCompiler.create(),
  TypstRenderer.create(),
  TypstFormatter.create({ tab_spaces: 2, max_width: 80 }),
  TypstAnalyzer.create({ wasmUrl: tinymistWasmUrl }),
]);

const project = new TypstProject({
  compiler,
  analyzer,
  autoCompile: { debounceMs: 300, maxWaitMs: 2000 },
});

project.onCompile(async (result) => {
  if (result.vector) {
    const svg = await renderer.renderSvg(result.vector);
    document.querySelector("#preview")!.innerHTML = svg;
  }
});

const typstExtensions = await createTypstExtensions({
  project,
  formatter: { instance: formatter, formatOnSave: true },
  highlighting: { theme: "dark" },
});
```

## Multi-file editor

Attach the `typstFilePath` facet per-editor so each `EditorState` carries its own path. Switching tabs with `view.setState(states[path])` propagates the new path automatically — no external closure or `activeFile` variable required.

```ts
import { typstFilePath } from "@vedivad/codemirror-typst";

const project = new TypstProject({ compiler, analyzer });
await project.setMany({
  "/main.typ": "...",
  "/template.typ": "...",
});

const typstExtensions = await createTypstExtensions({ project });
const shared = [basicSetup, ...typstExtensions];

const states = Object.fromEntries(
  project.files.map((path) => [
    path,
    EditorState.create({
      doc: project.getText(path) ?? "",
      extensions: [...shared, typstFilePath.of(path)],
    }),
  ]),
);
```

## Compile timing

`TypstProject` auto-compiles after every VFS mutation (`setText`, `setMany`, `remove`, `clear`, entry change). The editor plugin only mirrors CM edits into `setText`; the project owns the compile schedule. Configure it once per project:

```ts
const project = new TypstProject({
  compiler,
  autoCompile: {
    debounceMs: 300, // wait 300ms after the last mutation
    maxWaitMs: 2000, // force a compile at least every 2s during sustained typing
  },
});
```

| Option                   | Default | Behavior                                                                                                  |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `autoCompile.debounceMs` | `0`     | Debounce — resets on every mutation, fires once mutations pause. `0` means compile on the next macrotask. |
| `autoCompile.maxWaitMs`  | `0`     | Max-wait cap — forces a compile during sustained mutation bursts. Only effective when `debounceMs` > 0.   |

Call `await project.compile()` directly when you need a specific result right now — it flushes any pending scheduled compile and returns the fresh result.

**Initial compile:** VFS mutations schedule a debounced compile, so the first render is delayed by `debounceMs`. To show initial output immediately (e.g. after `setMany`), call `compile()` explicitly:

```ts
await project.setMany({ "/main.typ": "= Hello!" });
await project.compile(); // bypass debounce for first render
```

## LSP analysis

`TypstAnalyzer` runs a [tinymist](https://github.com/Myriad-Dreamin/tinymist) language server in a Web Worker. The `wasmUrl` option must point to the `tinymist_bg.wasm` binary from `tinymist-web` (installed automatically as a transitive dependency).

- **Vite**: `import wasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url"`
- **Static server**: copy `node_modules/tinymist-web/pkg/tinymist_bg.wasm` to your public directory

Diagnostics always come from `TypstCompiler` after each compile. `TypstAnalyzer` powers autocompletion and hover only.

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

## Granular plugins

`createTypstExtensions` composes two view plugins. Use them directly for custom setups:

- **`createTypstCompileSync({ project })`** — mirrors the editor's content into the project's VFS on mount and on every change. The project auto-schedules the compile. Use on its own if you render diagnostics yourself.
- **`createTypstDiagnostics({ project })`** — subscribes to `project.onCompile` and dispatches diagnostics for the active file. Use on its own if you drive VFS updates outside the editor (e.g. a Yjs observer).

```ts
import {
  createTypstCompileSync,
  createTypstDiagnostics,
  typstFilePath,
} from "@vedivad/codemirror-typst";

const extensions = [
  createTypstCompileSync({ project }),
  createTypstDiagnostics({ project }),
  typstFilePath.of("/main.typ"),
];
```

## Styling hover tooltips

Hover content uses stable CSS class names, so you can theme it from your app stylesheet. The plugin only sets scroll behavior inline (`max-height` + `overflow`) and leaves visual theming to CSS.

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

Header element order is controllable via CSS `order` on `.cm-typst-hover-summary`, `.cm-typst-hover-signature`, and `.cm-typst-hover-header-actions`.

## License

MIT
