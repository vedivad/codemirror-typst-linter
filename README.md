# WORK IN PROGRESS

# codemirror-typst-linter

A CodeMirror 6 extension that shows Typst diagnostics as you type, using [@myriaddreamin/typst.ts](https://github.com/Myriad-Dreamin/typst.ts) for compilation in a Web Worker.

For syntax highlighting [codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst) can be used separately.

## Installation

```
npm install codemirror-typst-linter
```

Peer dependencies:

```
npm install @codemirror/lint @codemirror/state @codemirror/view
```

## Usage

```ts
import { typstLinter } from 'codemirror-typst-linter';

const view = new EditorView({
  state: EditorState.create({
    extensions: [
      typstLinter(),
    ],
  }),
});
```

## Options

```ts
typstLinter({
  // Font URLs passed to the Typst compiler.
  // Defaults to Roboto from jsDelivr.
  fonts: ['https://example.com/myfont.ttf'],

  // URL to the typst-ts-web-compiler WASM binary.
  // Defaults to the matching version on jsDelivr CDN.
  // Override for offline support or faster load:
  wasmUrl: new URL(
    '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
    import.meta.url,
  ).href,

  // Debounce delay in ms before linting fires after a change. Default: 0.
  delay: 300,

  // Include diagnostics from imported packages, not just the main file. Default: false.
  includePackageDiagnostics: false,
})
```

## Bundler setup

By default, the WASM binary is fetched from jsDelivr at runtime, so no bundler configuration is needed.

If you want to serve the WASM locally, pass `wasmUrl` as shown above and configure your bundler to handle `.wasm` files. With Vite:

```ts
// vite.config.ts
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default {
  plugins: [wasm(), topLevelAwait()],
};
```

## License

MIT — see [LICENSE](LICENSE).

This package bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
