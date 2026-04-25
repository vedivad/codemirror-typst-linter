import { describe, expect, it, vi } from "vitest";

vi.mock("../shiki.js", () => ({
  createTypstHighlighting: vi.fn().mockResolvedValue({
    extension: { kind: "shiki" },
    theme: "dark",
    setTheme: vi.fn(),
    highlightCode: vi.fn(),
  }),
}));

vi.mock("../compile-sync.js", () => ({
  createTypstCompileSync: vi.fn(() => ({ kind: "compile-sync" })),
}));

vi.mock("../diagnostics-plugin.js", () => ({
  createTypstDiagnostics: vi.fn(() => ({ kind: "diagnostics" })),
}));

vi.mock("../hover.js", () => ({
  createTypstHover: vi.fn(() => ({ kind: "hover" })),
}));

import { createTypstCompileSync } from "../compile-sync.js";
import { createTypstDiagnostics } from "../diagnostics-plugin.js";
import { createTypstHover as createTypstHoverImpl } from "../hover.js";
import {
  createTypstEditor,
  createTypstHover,
  editorSync,
  externalSync,
  typstCompletionSource,
} from "../index.js";
import { createTypstHighlighting } from "../shiki.js";

function mockProject(hasAnalyzer = false) {
  return { hasAnalyzer };
}

describe("createTypstEditor sync mode", () => {
  it("includes compile sync in editor sync mode", async () => {
    const project = mockProject();
    const editor = await createTypstEditor({
      project: project as any,
      sync: editorSync(),
    });

    expect(createTypstCompileSync).toHaveBeenCalledWith({ project });
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(editor.extension).toContainEqual({ kind: "compile-sync" });
    expect(editor.extension).toContainEqual({ kind: "diagnostics" });
  });

  it("omits compile sync in external sync mode while keeping diagnostics", async () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const editor = await createTypstEditor({
      project: project as any,
      sync: externalSync(),
    });

    expect(createTypstCompileSync).not.toHaveBeenCalled();
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(editor.extension).not.toContainEqual({ kind: "compile-sync" });
    expect(editor.extension).toContainEqual({ kind: "diagnostics" });
  });

  it("accepts structural external sync handles", async () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const editor = await createTypstEditor({
      project: project as any,
      sync: { kind: "external", ready: Promise.resolve() },
    });

    expect(createTypstCompileSync).not.toHaveBeenCalled();
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(editor.extension).not.toContainEqual({ kind: "compile-sync" });
    expect(editor.extension).toContainEqual({ kind: "diagnostics" });
  });

  it("disables highlighting and hover code highlighting with highlighting false", async () => {
    vi.mocked(createTypstHighlighting).mockClear();
    vi.mocked(createTypstHoverImpl).mockClear();
    const project = mockProject(true);
    const editor = await createTypstEditor({
      project: project as any,
      sync: editorSync(),
      highlighting: false,
    });

    expect(createTypstHighlighting).not.toHaveBeenCalled();
    expect(editor.highlighting).toBeUndefined();
    expect(editor.extension).not.toContainEqual({ kind: "shiki" });
    expect(createTypstHoverImpl).toHaveBeenCalledWith({
      project,
      highlightCode: undefined,
    });
  });

  it("reuses an existing highlighting controller", async () => {
    vi.mocked(createTypstHighlighting).mockClear();
    const project = mockProject();
    const highlighting = {
      extension: { kind: "custom-shiki" },
      theme: "light",
      setTheme: vi.fn(),
      highlightCode: vi.fn(),
    };
    const editor = await createTypstEditor({
      project: project as any,
      sync: editorSync(),
      highlighting: highlighting as any,
    });

    expect(createTypstHighlighting).not.toHaveBeenCalled();
    expect(editor.highlighting).toBe(highlighting);
    expect(editor.extension).toContain(highlighting.extension);
  });
});

describe("granular public APIs", () => {
  it("exports hover and completion helpers from the package entrypoint", () => {
    expect(createTypstHover).toBeTypeOf("function");
    expect(editorSync).toBeTypeOf("function");
    expect(externalSync).toBeTypeOf("function");
    expect(typstCompletionSource).toBeTypeOf("function");
  });
});
