import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@codemirror/lint",
    "@codemirror/state",
    "@codemirror/view",
    "typst-web-service",
  ],
});
