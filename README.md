# typst-web

Typst tooling for the web.

## Features

### `typst-web-service`

- **Compilation** — compile Typst source to vector artifacts, SVG, or PDF via WASM in a Web Worker
- **Diagnostics** — full diagnostic reporting (errors, warnings, info) with source ranges
- **Multi-file projects** — compile across multiple files with `@preview/` package support
- **SVG preview** — opt-in live SVG rendering via `@myriaddreamin/typst-ts-renderer`
- **Code formatting** — format documents or ranges via [typstyle](https://github.com/typstyle-rs/typstyle)

### `codemirror-typst`

- **Syntax highlighting** — Shiki-based highlighting with configurable themes
- **Inline diagnostics** — maps Typst diagnostics to CodeMirror lint markers with gutter icons
- **Format keybinding** — Shift+Alt+F to format the document or current selection

## Packages

| Package                      | Path                         | Purpose                                                  |
| ---------------------------- | ---------------------------- | -------------------------------------------------------- |
| `@vedivad/typst-web-service` | `packages/typst-web-service` | Core worker-backed Typst compile/render service + formatter |
| `@vedivad/codemirror-typst`  | `packages/codemirror-typst`  | CodeMirror extension for highlighting, linting, and formatting |

## Usage

### `typst-web-service`

Single file:

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

Multi-file:

```ts
const result = await service.compile({
  "/main.typ": '#import "template.typ": greet\n#greet("World")',
  "/template.typ": "#let greet(name) = [Hello, #name!]",
});
```

Formatting (standalone, no editor required):

```ts
import { TypstFormatter } from "@vedivad/typst-web-service";

const formatter = new TypstFormatter({ tab_spaces: 2, max_width: 80 });
const formatted = await formatter.format("= Hello,   Typst");
```

### `codemirror-typst`

Single-file editor (zero-config):

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { createTypstExtensions, TypstFormatter } from "@vedivad/codemirror-typst";

const typstExtensions = await createTypstExtensions({
  highlighting: {
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: "dark",
  },
  compiler: {
    renderer: {
      module: () => import("@myriaddreamin/typst-ts-renderer"),
      onSvg: (svg) => {
        document.querySelector("#preview")!.innerHTML = svg;
      },
    },
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

Multi-file editor (shared service + `getFiles`):

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  createTypstExtensions,
  TypstFormatter,
  TypstService,
} from "@vedivad/codemirror-typst";

const files: Record<string, string> = {
  "/main.typ": "...",
  "/template.typ": "...",
};

const formatter = new TypstFormatter({ tab_spaces: 2, max_width: 80 });

const service = TypstService.create({
  renderer: {
    module: () => import("@myriaddreamin/typst-ts-renderer"),
    onSvg: (svg) => { /* ... */ },
  },
});

// Each editor declares its file path and provides a getter for all project files.
// The editor's own content is included automatically — getFiles provides the rest.
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

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: files["/main.typ"],
    extensions: [basicSetup, ...typstExtensions],
  }),
});
```

## Development

### Prerequisites

- [Bun](https://bun.sh) — workspace scripts and package builds
- [just](https://just.systems) — task runner (optional, `bun run` scripts also work)

### Install

```bash
just install
```

### Build

```bash
just build
```

### Format & lint

```bash
just format
```

Uses [Biome](https://biomejs.dev) for formatting, linting, and import sorting.

### Run demo

```bash
just dev
```

The demo serves from `demo/` with a tabbed multi-file editor, diagnostics panel, and live SVG preview.

## Architecture summary

- **`TypstService`** manages a Web Worker running the Typst WASM compiler. It handles compilation, rendering, and request coalescing. Accepts both single-file strings and multi-file `Record<string, string>` maps.
- **`TypstFormatter`** is a standalone formatter powered by typstyle WASM. It runs on the main thread (typstyle is lightweight) and is independent of `TypstService`.
- **`codemirror-typst`** provides CodeMirror 6 extensions that consume `TypstService` and `TypstFormatter`. The `filePath` and `getFiles` options enable multi-file projects where each editor only shows diagnostics for its own file.
- Optional SVG preview is opt-in through renderer options; diagnostics-only usage does not require renderer initialization.

## License

MIT - see `LICENSE`.

This project bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See `THIRD_PARTY_LICENSES`.
