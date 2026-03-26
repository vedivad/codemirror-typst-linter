import { describe, expect, it, vi } from "vitest";

vi.mock("@typstyle/typstyle-wasm-bundler", () => ({
  format(source: string, config: { tab_spaces?: number; max_width?: number }) {
    // Naive formatting: collapse whitespace in `#let` assignments
    const tabSpaces = config?.tab_spaces ?? 2;
    const indent = " ".repeat(tabSpaces);
    let result = source.replace(/#let\s+(\w+)\s*=\s*/g, "#let $1 = ");
    // Indent lines inside braces
    result = result.replace(/\{\n([^}]+)\n\}/g, (_m, body: string) => {
      const lines = body
        .split("\n")
        .map((l: string) => indent + l.trim())
        .join("\n");
      return `{\n${lines}\n}`;
    });
    return result;
  },
  format_range(
    source: string,
    start: number,
    end: number,
    _config: Record<string, unknown>,
  ) {
    const slice = source.slice(start, end);
    const text = slice.replace(/#let\s+(\w+)\s*=\s*/g, "#let $1 = ");
    return { start, end, text };
  },
}));

import { TypstFormatter } from "../formatter.js";

describe("TypstFormatter", () => {
  it("formats typst source code", async () => {
    const formatter = TypstFormatter.create({ max_width: 80 });
    const input = "#let   x  =  1";
    const result = await formatter.format(input);
    expect(result.trim()).toBe("#let x = 1");
  });

  it("formats a range within source", async () => {
    const formatter = TypstFormatter.create();
    const source = "#let   x = 1\n#let   y = 2\n";
    const result = await formatter.formatRange(source, 0, 13);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("start");
    expect(result).toHaveProperty("end");
    expect(typeof result.text).toBe("string");
    expect(typeof result.start).toBe("number");
    expect(typeof result.end).toBe("number");
  });

  it("returns unchanged source when already formatted", async () => {
    const formatter = TypstFormatter.create();
    const source = "#let x = 1\n";
    const result = await formatter.format(source);
    expect(result).toBe(source);
  });

  it("respects tab_spaces config", async () => {
    const two = TypstFormatter.create({ tab_spaces: 2 });
    const four = TypstFormatter.create({ tab_spaces: 4 });
    const source = "#let f(x) = {\nx\n}";
    const twoResult = await two.format(source);
    const fourResult = await four.format(source);
    expect(twoResult).toContain("  x");
    expect(fourResult).toContain("    x");
  });
});
