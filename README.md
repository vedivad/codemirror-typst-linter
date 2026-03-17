# typst-web

Typst tooling for the web, split into small packages.

## Packages

| Package                      | Path                         | Purpose                                                               |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `@vedivad/typst-web-service` | `packages/typst-web-service` | Core worker-backed Typst compile/render service                       |
| `@vedivad/codemirror-typst`  | `packages/codemirror-typst`  | CodeMirror syntax highlighting and linter extension using the service |

## Usage

### `typst-web-service`

```ts
import { TypstService } from "@vedivad/typst-web-service";

const service = TypstService.create();
await service.ready;

const result = await service.compile("= Hello, Typst");
console.log(result.diagnostics);

service.destroy();
```

### `codemirror-typst`

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { createTypstExtensions } from "@vedivad/codemirror-typst";

const typstExtensions = await createTypstExtensions({
  highlighting: {
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: "dark",
  },
  compiler: {
    renderer: {
      module: () => import("@myriaddreamin/typst-ts-renderer"),
      onSvg: (svg) => {
        // Hook: called after successful compile with rendered SVG.
        document.querySelector("#preview")!.innerHTML = svg;
      },
    },
    onDiagnostics: (diagnostics) => {
      // Hook: called after each lint/compile pass.
      console.log(diagnostics);
    },
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

## Development

### Prerequisites

- Bun (workspace scripts and package builds use Bun)

### Install

```bash
make install
```

Or with Bun directly:

```bash
bun install
```

### Build

```bash
make build
```

Or with Bun directly:

```bash
bun run build
```

### Run demo

```bash
make dev
```

The demo serves from `demo/` and is useful for validating diagnostics + SVG preview behavior end to end.

## Architecture summary

- Compilation and rendering run inside a Web Worker (`typst-web-service/src/worker.ts`).
- `TypstService` manages worker lifecycle and request/response flow.
- `codemirror-typst` consumes `TypstService` and maps Typst diagnostics to CodeMirror diagnostics.
- Optional SVG preview is opt-in through renderer options; diagnostics-only usage does not require renderer initialization.

## License

MIT - see `LICENSE`.

This project bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See `THIRD_PARTY_LICENSES`.
