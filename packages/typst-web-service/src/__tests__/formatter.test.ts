import { describe, expect, it } from "vitest";
import { TypstFormatter } from "../formatter.js";

describe("TypstFormatter", () => {
  it("formats typst source code", async () => {
    const formatter = new TypstFormatter({ max_width: 80 });
    const input = "#let   x  =  1";
    const result = await formatter.format(input);
    expect(result.trim()).toBe("#let x = 1");
  });

  it("formats a range within source", async () => {
    const formatter = new TypstFormatter();
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
    const formatter = new TypstFormatter();
    const source = "#let x = 1\n";
    const result = await formatter.format(source);
    expect(result).toBe(source);
  });

  it("respects tab_spaces config", async () => {
    const two = new TypstFormatter({ tab_spaces: 2 });
    const four = new TypstFormatter({ tab_spaces: 4 });
    const source = "#let f(x) = {\nx\n}";
    const twoResult = await two.format(source);
    const fourResult = await four.format(source);
    expect(twoResult).toContain("  x");
    expect(fourResult).toContain("    x");
  });
});
