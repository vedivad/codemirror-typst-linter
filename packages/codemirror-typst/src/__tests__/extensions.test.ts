import { describe, expect, it, vi } from "vitest";

vi.mock("../shiki.js", () => ({
  createTypstShikiExtension: vi.fn(),
  createTypstShikiHighlighting: vi.fn().mockResolvedValue({
    extension: { kind: "shiki" },
    getTheme: vi.fn(),
    highlightCode: vi.fn(),
  }),
}));

vi.mock("../compile-sync.js", () => ({
  createTypstCompileSync: vi.fn(() => ({ kind: "compile-sync" })),
}));

vi.mock("../diagnostics-plugin.js", () => ({
  createTypstDiagnostics: vi.fn(() => ({ kind: "diagnostics" })),
}));

import { createTypstCompileSync } from "../compile-sync.js";
import { createTypstDiagnostics } from "../diagnostics-plugin.js";
import {
  createTypstExtensions,
  createTypstHover,
  editorSync,
  externalSync,
  typstCompletionSource,
} from "../index.js";

function mockProject() {
  return { hasAnalyzer: false };
}

describe("createTypstExtensions sync mode", () => {
  it("includes compile sync in editor sync mode", async () => {
    const project = mockProject();
    const extensions = await createTypstExtensions({
      project: project as any,
      sync: editorSync(),
    });

    expect(createTypstCompileSync).toHaveBeenCalledWith({ project });
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
  });

  it("omits compile sync in external sync mode while keeping diagnostics", async () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const extensions = await createTypstExtensions({
      project: project as any,
      sync: externalSync(),
    });

    expect(createTypstCompileSync).not.toHaveBeenCalled();
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).not.toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
  });

  it("accepts structural external sync handles", async () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const extensions = await createTypstExtensions({
      project: project as any,
      sync: { kind: "external", ready: Promise.resolve() },
    });

    expect(createTypstCompileSync).not.toHaveBeenCalled();
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).not.toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
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
