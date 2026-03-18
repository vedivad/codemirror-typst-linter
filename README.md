# typst-web

## Features

### `typst-web-service`

- **Compilation** — compile Typst source to vector artifacts, SVG, or PDF via WASM in a Web Worker
- **Diagnostics** — full diagnostic reporting (errors, warnings, info) with source ranges
- **Multi-file projects** — compile across multiple files with `@preview/` package support
- **SVG preview** — opt-in live SVG rendering via `@myriaddreamin/typst-ts-renderer`
- **PDF export** — render to PDF and download
- **Code formatting** — format documents or ranges via [typstyle](https://github.com/typstyle-rs/typstyle)

### `codemirror-typst`

- **Syntax highlighting** — Shiki-based highlighting with configurable themes
- **Inline diagnostics** — maps Typst diagnostics to CodeMirror lint markers with gutter icons
- **Format keybinding** — Shift+Alt+F to format the document or current selection
- **Format on save** — optional Ctrl+S / Cmd+S formatting with a save callback hook

## Packages

| Package | Purpose |
| --- | --- |
| [`@vedivad/typst-web-service`](packages/typst-web-service) | Core worker-backed Typst compile/render service + formatter |
| [`@vedivad/codemirror-typst`](packages/codemirror-typst) | CodeMirror 6 extension for highlighting, linting, and formatting |

## Usage

### `typst-web-service`

#### Compile and render SVG

```ts
import { TypstService } from "@vedivad/typst-web-service";

const service = TypstService.create({
  renderer: {
    module: () => import("@myriaddreamin/typst-ts-renderer"),
    onSvg: (svg) => {
      document.querySelector("#preview")!.innerHTML = svg;
    },
  },
});
await service.ready;

await service.compile("= Hello, Typst"); // renders SVG into #preview

service.destroy();
```

#### Multi-file compilation

```ts
const result = await service.compile({
  "/main.typ": '#import "template.typ": greet\n#greet("World")',
  "/template.typ": "#let greet(name) = [Hello, #name!]",
});
```

#### PDF export

```ts
const pdf = await service.renderPdf("= Hello, Typst");
const blob = new Blob([pdf.slice()], { type: "application/pdf" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = "output.pdf";
a.click();

URL.revokeObjectURL(url);
```

#### Code formatting

`TypstFormatter` is standalone — it does not require a `TypstService` or a Web Worker.

```ts
import { TypstFormatter } from "@vedivad/typst-web-service";

const formatter = new TypstFormatter({ tab_spaces: 2, max_width: 80 });

// Format an entire document
const formatted = await formatter.format(source);

// Format a selection (indices are UTF-16 code units, matching JS string indexing)
const result = await formatter.formatRange(source, selectionStart, selectionEnd);
// result.text — the formatted text
// result.start, result.end — the actual range that was formatted
```

#### Configuration

`TypstFormatter` accepts any subset of [typstyle's config](https://github.com/typstyle-rs/typstyle):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `tab_spaces` | `number` | `2` | Spaces per indentation level |
| `max_width` | `number` | `80` | Maximum line width |
| `blank_lines_upper_bound` | `number` | — | Max consecutive blank lines |
| `collapse_markup_spaces` | `boolean` | — | Collapse whitespace in markup to a single space |
| `reorder_import_items` | `boolean` | — | Sort import items alphabetically |
| `wrap_text` | `boolean` | — | Wrap text to fit within `max_width` |

### `codemirror-typst`

#### Single-file editor

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  createTypstExtensions,
  TypstFormatter,
  TypstService,
} from "@vedivad/codemirror-typst";

const service = TypstService.create({
  renderer: {
    module: () => import("@myriaddreamin/typst-ts-renderer"),
    onSvg: (svg) => {
      document.querySelector("#preview")!.innerHTML = svg;
    },
  },
});

const typstExtensions = await createTypstExtensions({
  highlighting: {
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: "dark",
  },
  compiler: {
    service,
    onDiagnostics: (diagnostics) => console.log(diagnostics),
  },
  formatter: {
    formatter: new TypstFormatter({ tab_spaces: 2, max_width: 80 }),
  },
});

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: "= Typst",
    extensions: [basicSetup, ...typstExtensions],
  }),
});
```

#### Multi-file editor

For multi-file projects, share a single `TypstService` across editors. Each editor declares its `filePath` and provides a `getFiles` getter so the compiler sees all project files during compilation.

```ts
const files: Record<string, string> = {
  "/main.typ": "...",
  "/template.typ": "...",
};

const typstExtensions = await createTypstExtensions({
  highlighting: {
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: "dark",
  },
  compiler: {
    service,
    filePath: "/main.typ",
    getFiles: () => files,
  },
  formatter: { formatter },
});
```

#### Using individual extensions

`createTypstExtensions` is a convenience wrapper. You can also use the extensions individually for more control:

```ts
import {
  createTypstShikiExtension,
  createTypstLinter,
  createTypstFormatter,
  TypstFormatter,
  TypstService,
} from "@vedivad/codemirror-typst";

const shiki = await createTypstShikiExtension({ /* ... */ });
const linter = createTypstLinter({ service, filePath: "/main.typ" });
const format = createTypstFormatter({
  formatter: new TypstFormatter({ max_width: 100 }),
});

// Use any combination
const extensions = [shiki, linter, format];
```

#### Format on save

Enable `formatOnSave` to format the document on Ctrl+S / Cmd+S. Pass a callback to hook into the save event — useful for persisting to a backend or IndexedDB:

```ts
// Format on save, no callback
formatter: { formatter, formatOnSave: true }

// Format on save with a callback
formatter: {
  formatter,
  formatOnSave: (content) => {
    fetch("/api/save", { method: "POST", body: content });
  },
}
```

## Development

### Prerequisites

- [Bun](https://bun.sh) — workspace scripts and package builds
- [just](https://just.systems) — task runner (optional, `bun run` scripts also work)

### Commands

| Command | Description |
| --- | --- |
| `just install` | Install dependencies |
| `just build` | Build both packages |
| `just test` | Run tests with [Vitest](https://vitest.dev) |
| `just format` | Format and lint with [Biome](https://biomejs.dev) |
| `just dev` | Build packages and start the demo dev server |

### Testing

Tests use [Vitest](https://vitest.dev) with workspace mode — each package has its own test suite.

```bash
just test              # run all tests
just test-watch        # watch mode
```

`typst-web-service` tests load real typstyle WASM for formatter integration tests. `codemirror-typst` tests use mocked services to verify diagnostic mapping, linter plugin behavior, and formatter error handling.

### Demo

```bash
just dev
```

The demo at `demo/` includes a tabbed multi-file editor, live SVG preview, diagnostics panel with source locations, PDF export, code formatting (Shift+Alt+F), and format on save (Ctrl+S).

## Architecture

```mermaid
graph TD
  subgraph "codemirror-typst"
    Shiki[Shiki highlighting]
    Linter[Linter extension]
    Formatter[Formatter keybinding]
  end

  subgraph "typst-web-service"
    TypstService["TypstService\n(Web Worker)"]
    TypstFormatter["TypstFormatter\n(main thread)"]
  end

  Linter --> TypstService
  Formatter --> TypstFormatter

  TypstService --> TypstWASM["typst WASM\n(compiler)"]
  TypstFormatter --> TypstyleWASM["typstyle WASM\n(formatter)"]
```

- **`TypstService`** manages a Web Worker running the Typst WASM compiler. It handles compilation, rendering, and request coalescing. Accepts both single-file strings and multi-file `Record<string, string>` maps.
- **`TypstFormatter`** is a standalone formatter powered by typstyle WASM. It runs on the main thread (typstyle is lightweight) and is independent of `TypstService`.
- **`codemirror-typst`** provides CodeMirror 6 extensions that consume `TypstService` and `TypstFormatter`. The `filePath` and `getFiles` options enable multi-file projects where each editor only shows diagnostics for its own file.
- SVG preview is opt-in — diagnostics-only usage never loads the renderer WASM.

## License

MIT - see `LICENSE`.

This project bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See `THIRD_PARTY_LICENSES`.
