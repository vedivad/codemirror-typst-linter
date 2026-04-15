# @vedivad/typst-web-service

Editor-agnostic Typst services for the web — compile, render, analyze, and format via WASM.

Four independent classes, each created via async `create()` factory methods. Import only what you need.

## Install

```bash
npm install @vedivad/typst-web-service
```

> Most users should install `@vedivad/codemirror-typst` instead, which re-exports everything from this package and adds CodeMirror 6 integration.

## Compilation

```ts
import { TypstCompiler, TypstRenderer } from "@vedivad/typst-web-service";

const compiler = await TypstCompiler.create();
const renderer = await TypstRenderer.create();

// Single file
const result = await compiler.compile("= Hello, Typst");
if (result.vector) {
  const svg = await renderer.renderSvg(result.vector);
  document.querySelector("#preview")!.innerHTML = svg;
}

// Multi-file
const result = await compiler.compile({
  "/main.typ": '#import "template.typ": greet\n#greet("World")',
  "/template.typ": "#let greet(name) = [Hello, #name!]",
});

// PDF export
const pdf = await compiler.compilePdf("= Hello, Typst");
const blob = new Blob([pdf.slice()], { type: "application/pdf" });

compiler.destroy();
```

## Formatting

Requires a bundler that supports WASM imports (e.g. Vite + `vite-plugin-wasm`).

```ts
import { TypstFormatter } from "@vedivad/typst-web-service";

const formatter = await TypstFormatter.create({ tab_spaces: 2, max_width: 80 });
const formatted = await formatter.format(source);
const rangeResult = await formatter.formatRange(source, start, end);
```

Config options ([typstyle docs](https://github.com/typstyle-rs/typstyle)):

| Option                    | Type      | Default | Description                         |
| ------------------------- | --------- | ------- | ----------------------------------- |
| `tab_spaces`              | `number`  | `2`     | Spaces per indentation level        |
| `max_width`               | `number`  | `80`    | Maximum line width                  |
| `blank_lines_upper_bound` | `number`  | --      | Max consecutive blank lines         |
| `collapse_markup_spaces`  | `boolean` | --      | Collapse whitespace in markup       |
| `reorder_import_items`    | `boolean` | --      | Sort import items alphabetically    |
| `wrap_text`               | `boolean` | --      | Wrap text to fit within `max_width` |

## LSP analysis with tinymist

`TypstAnalyzer` runs a [tinymist](https://github.com/Myriad-Dreamin/tinymist) language server in a Web Worker. The `wasmUrl` option must point to the `tinymist_bg.wasm` binary from the `tinymist-web` package.

```ts
import { TypstAnalyzer } from "@vedivad/typst-web-service";
import tinymistWasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url";

const analyzer = await TypstAnalyzer.create({ wasmUrl: tinymistWasmUrl });

analyzer.onDiagnostics((uri, diagnostics) => {
  console.log(uri, diagnostics);
});

await analyzer.didChange("untitled:project/main.typ", source);
const completions = await analyzer.completion(
  "untitled:project/main.typ",
  line,
  character,
);
const hover = await analyzer.hover(
  "untitled:project/main.typ",
  line,
  character,
);

analyzer.destroy();
```

## Service classes

| Class            | Runs on     | WASM loading            | Purpose                                                    |
| ---------------- | ----------- | ----------------------- | ---------------------------------------------------------- |
| `TypstCompiler`  | Web Worker  | CDN (automatic)         | `compile()` -> diagnostics + vector, `compilePdf()` -> PDF |
| `TypstRenderer`  | Main thread | CDN (automatic)         | `renderSvg(vector)` -> SVG string                          |
| `TypstFormatter` | Main thread | Bundler (static import) | `format(source)`, `formatRange(source, start, end)`        |
| `TypstAnalyzer`  | Web Worker  | User-provided `wasmUrl` | LSP diagnostics, completion, hover via tinymist            |

## License

MIT
