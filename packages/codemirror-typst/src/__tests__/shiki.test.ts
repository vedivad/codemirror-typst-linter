import { describe, expect, it, vi } from "vitest";
import { createTypstHighlighting } from "../shiki.js";

const mocks = vi.hoisted(() => {
  const highlighter = {
    getLoadedLanguages: vi.fn(() => ["typst", "javascript"]),
    codeToHtml: vi.fn(
      (code: string, options: { lang: string; theme: string }) =>
        `<pre data-lang="${options.lang}" data-theme="${options.theme}">${code}</pre>`,
    ),
  };
  return {
    highlighter,
    shikiExtension: vi.fn((options: { theme: string }) => ({
      kind: "shiki-extension",
      theme: options.theme,
    })),
  };
});

vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue(mocks.highlighter),
  createJavaScriptRegexEngine: vi.fn(() => ({ kind: "javascript-engine" })),
  createOnigurumaEngine: vi.fn(() => ({ kind: "oniguruma-engine" })),
}));

vi.mock("codemirror-shiki", () => ({
  default: mocks.shikiExtension,
}));

describe("createTypstHighlighting", () => {
  it("updates the current theme and dispatches a compartment reconfigure", async () => {
    const highlighting = await createTypstHighlighting({
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      theme: "light",
    });
    const view = { dispatch: vi.fn() };

    expect(highlighting.theme).toBe("light");
    highlighting.setTheme(view as any, "dark");

    expect(highlighting.theme).toBe("dark");
    expect(view.dispatch).toHaveBeenCalledWith({
      effects: expect.any(Object),
    });
    expect(mocks.shikiExtension).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "github-dark-dimmed" }),
    );
  });

  it("uses the latest theme when highlighting hover code", async () => {
    const highlighting = await createTypstHighlighting({
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      theme: "light",
    });

    highlighting.highlightCode("#let x = 1", "typst");
    expect(mocks.highlighter.codeToHtml).toHaveBeenLastCalledWith(
      "#let x = 1",
      { lang: "typst", theme: "github-light" },
    );

    highlighting.setTheme({ dispatch: vi.fn() } as any, "dark");
    highlighting.highlightCode("const x = 1", "javascript");

    expect(mocks.highlighter.codeToHtml).toHaveBeenLastCalledWith(
      "const x = 1",
      { lang: "javascript", theme: "github-dark-dimmed" },
    );
  });
});
