import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: [
      '@codemirror/lint',
      '@codemirror/state',
      '@codemirror/view',
    ],
  },
  {
    entry: { worker: 'src/worker.ts' },
    format: ['esm'],
    sourcemap: true,
    splitting: false,
    noExternal: [
      '@myriaddreamin/typst.ts',
      '@myriaddreamin/typst-ts-web-compiler',
    ],
  },
]);
