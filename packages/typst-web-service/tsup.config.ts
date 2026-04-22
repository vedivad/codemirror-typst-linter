import { build } from "esbuild";
import { defineConfig } from "tsup";
import packageJson from "./package.json";

function resolveDependencyVersion(
  name: keyof typeof packageJson.dependencies,
): string {
  const raw = packageJson.dependencies[name];
  const match = raw.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  if (!match) {
    throw new Error(`Could not derive a CDN version from ${name}: ${raw}`);
  }
  return match[0];
}

const typstCompilerVersion = resolveDependencyVersion(
  "@myriaddreamin/typst-ts-web-compiler",
);
const typstRendererVersion = resolveDependencyVersion(
  "@myriaddreamin/typst-ts-renderer",
);

const versionDefine = {
  __TYPST_TS_WEB_COMPILER_VERSION__: JSON.stringify(typstCompilerVersion),
  __TYPST_TS_RENDERER_VERSION__: JSON.stringify(typstRendererVersion),
};

const { outputFiles } = await build({
  entryPoints: ["src/compiler-worker.ts"],
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
      ...versionDefine,
    },
  },
  {
    entry: { "compiler-worker": "src/compiler-worker.ts" },
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    define: versionDefine,
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
    define: versionDefine,
    noExternal: ["tinymist-web"],
  },
]);
