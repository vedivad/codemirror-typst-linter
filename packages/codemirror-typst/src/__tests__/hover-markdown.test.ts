import { describe, expect, it } from "vitest";
import { parseHoverDoc, renderHoverMarkdown } from "../hover-markdown.js";

describe("parseHoverDoc", () => {
  it("extracts structured signature and open docs url", () => {
    const doc = parseHoverDoc(
      "```typc\nlet align(alignment: alignment, body: content);\n```\n\nAligns content.\n\n[Open docs](https://typst.app/docs/reference/layout/align/)",
    );

    expect(doc.signature?.language).toBe("typst");
    expect(doc.signature?.code).toContain("#let align");
    expect(doc.openDocsUrl).toBe(
      "https://typst.app/docs/reference/layout/align/",
    );
  });
});

describe("renderHoverMarkdown", () => {
  it("renders markdown links as anchors", () => {
    const html = renderHoverMarkdown(
      "[Open docs](https://typst.app/docs/reference/layout/align/)",
    );

    expect(html).toContain(
      'href="https://typst.app/docs/reference/layout/align/"',
    );
    expect(html).toContain('target="_blank"');
  });

  it("escapes raw HTML input", () => {
    const html = renderHoverMarkdown('<script>alert("x")</script>');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses custom highlighter for fenced code blocks", () => {
    const html = renderHoverMarkdown(
      "```typst\n#set page(height: 120pt)\n```",
      (code, language) => `<pre data-lang="${language}">${code}</pre>`,
    );

    expect(html).toContain('<pre data-lang="typst">#set page(height: 120pt)');
  });

  it("normalizes let in typst fenced code for custom highlighter", () => {
    const html = renderHoverMarkdown(
      "```typst\nlet align(alignment: alignment, body: content);\n```",
      (code, language) => `<pre data-lang="${language}">${code}</pre>`,
    );

    expect(html).toContain("#let align");
  });

  it("treats typc fences as typst", () => {
    const html = renderHoverMarkdown(
      "```typc\nlet align(alignment: alignment, body: content);\n```",
      (code, language) => `<pre data-lang="${language}">${code}</pre>`,
    );

    expect(html).toContain('data-lang="typst"');
    expect(html).toContain("#let align");
  });

  it("highlights leading plain typst signature blocks", () => {
    const html = renderHoverMarkdown(
      "let align(\n  alignment: alignment,\n  body: content,\n);",
      (code, language) => `<pre data-lang="${language}">${code}</pre>`,
    );

    expect(html).toContain('data-lang="typst"');
    expect(html).toContain("#let align(");
  });
});
