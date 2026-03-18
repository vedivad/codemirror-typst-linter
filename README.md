# typst-web

Typst tooling for the web, split into small packages.

## Packages

| Package                      | Path                         | Purpose                                                               |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `@vedivad/typst-web-service` | `packages/typst-web-service` | Core worker-backed Typst compile/render service                       |
| `@vedivad/codemirror-typst`  | `packages/codemirror-typst`  | CodeMirror syntax highlighting and linter extension using the service |

## Usage

### `typst-web-service`

Single file:

```ts
import { TypstService } from "@vedivad/typst-web-service";

const service = TypstService.create();
await service.ready;

const result = await service.compile("= Hello, Typst");
console.log(result.diagnostics);

service.destroy();
```

Multi-file:

```ts
const result = await service.compile({
  "/main.typ": '#import "template.typ": greet\n#greet("World")',
  "/template.typ": "#let greet(name) = [Hello, #name!]",
});
```

### `codemirror-typst`

Single-file editor (zero-config):

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { createTypstExtensions } from "@vedivad/codemirror-typst";

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
import { createTypstLinter, createTypstShikiExtension, TypstService } from "@vedivad/codemirror-typst";

const files: Record<string, string> = {
  "/main.typ": "...",
  "/template.typ": "...",
};

const service = TypstService.create({ renderer: { /* ... */ } });

// Each editor declares its file path and provides a getter for all project files.
// The editor's own content is included automatically — getFiles provides the rest.
createTypstLinter({
  service,
  filePath: "/main.typ",
  getFiles: () => files,
  onDiagnostics: (d) => console.log(d),
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

- Compilation and rendering run inside a Web Worker (`typst-web-service/src/worker.ts`).
- `TypstService` manages worker lifecycle and request/response flow. It accepts both single-file strings and multi-file `Record<string, string>` maps.
- `codemirror-typst` consumes `TypstService` and maps Typst diagnostics to CodeMirror diagnostics. The `filePath` and `getFiles` options enable multi-file projects where each editor only shows diagnostics for its own file.
- Optional SVG preview is opt-in through renderer options; diagnostics-only usage does not require renderer initialization.

## License

MIT - see `LICENSE`.

This project bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See `THIRD_PARTY_LICENSES`.
