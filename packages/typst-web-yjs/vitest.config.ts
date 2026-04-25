import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "typst-web-yjs",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
