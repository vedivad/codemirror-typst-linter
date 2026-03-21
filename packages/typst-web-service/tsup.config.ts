import { build } from "esbuild";
import { defineConfig } from "tsup";

const { outputFiles } = await build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  format: "iife",
  write: false,
  minify: true,
  external: ["@myriaddreamin/typst-ts-renderer"],
});

const workerCode = outputFiles[0].text;

const { outputFiles: analyzerOutputFiles } = await build({
  entryPoints: ["src/analyzer-worker.ts"],
  bundle: true,
  format: "iife",
  write: false,
  minify: true,
});

const analyzerWorkerCode = analyzerOutputFiles[0].text;

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    define: {
      __WORKER_CODE__: JSON.stringify(workerCode),
      __ANALYZER_WORKER_CODE__: JSON.stringify(analyzerWorkerCode),
    },
  },
  {
    entry: { worker: "src/worker.ts" },
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    noExternal: [
      "@myriaddreamin/typst.ts",
      "@myriaddreamin/typst-ts-web-compiler",
    ],
  },
  {
    entry: { "analyzer-worker": "src/analyzer-worker.ts" },
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    noExternal: ["tinymist-web"],
  },
]);
