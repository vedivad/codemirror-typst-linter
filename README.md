# typst-web

Typst tooling for the web, split into small packages:

- `typst-web-service`: an editor-agnostic Web Worker service that compiles Typst and returns diagnostics, vectors, and PDF output.
- `codemirror-typst`: a CodeMirror 6 extension built on top of `typst-web-service`.
- `demo`: a Vite demo that wires diagnostics and SVG preview together.

## Packages

| Package             | Path                         | Purpose                                         |
| ------------------- | ---------------------------- | ----------------------------------------------- |
| `typst-web-service` | `packages/typst-web-service` | Core worker-backed Typst compile/render service |
| `codemirror-typst`  | `packages/codemirror-typst`  | CodeMirror linter extension using the service   |

## Quickstart

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

## Minimal usage

### `typst-web-service`

```ts
import { TypstService } from "typst-web-service";

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
import { typst } from "codemirror-lang-typst";
import { typstLinter } from "codemirror-typst";

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: "= Typst",
    extensions: [basicSetup, typst(), typstLinter()],
  }),
});
```

## Architecture summary

- Compilation and rendering run inside a Web Worker (`typst-web-service/src/worker.ts`).
- `TypstService` manages worker lifecycle and request/response flow.
- `codemirror-typst` consumes `TypstService` and maps Typst diagnostics to CodeMirror diagnostics.
- Optional SVG preview is opt-in through renderer options; diagnostics-only usage does not require renderer initialization.

## License

MIT - see `LICENSE`.

This project bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See `THIRD_PARTY_LICENSES`.
