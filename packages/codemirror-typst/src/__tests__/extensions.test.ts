import { describe, expect, it, vi } from "vitest";

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
  createTypstHover,
  createTypstSetup,
  typstCompletionSource,
} from "../index.js";

function mockProject(hasAnalyzer = false) {
  return { hasAnalyzer };
}

const stubHighlighting = {
  extension: { kind: "shiki" },
  theme: "dark",
  setTheme: vi.fn(),
  highlightCode: vi.fn(),
};

describe("createTypstSetup", () => {
  it('includes compile sync when sync is "editor-driven"', () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({
      project: project as any,
      sync: "editor-driven",
    });

    expect(createTypstCompileSync).toHaveBeenCalledWith({ project });
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
  });

  it('omits compile sync when sync is "external" but keeps diagnostics', () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({
      project: project as any,
      sync: "external",
    });

    expect(createTypstCompileSync).not.toHaveBeenCalled();
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).not.toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
  });

  it("omits highlighting and hover highlightCode when no controller is given", () => {
    vi.mocked(createTypstHoverImpl).mockClear();
    const project = mockProject(true);
    const extensions = createTypstSetup({
      project: project as any,
      sync: "editor-driven",
    });

    expect(extensions).not.toContainEqual({ kind: "shiki" });
    expect(createTypstHoverImpl).toHaveBeenCalledWith({
      project,
      highlightCode: undefined,
    });
  });

  it("wires the highlighting controller into the bundle and into hover", () => {
    vi.mocked(createTypstHoverImpl).mockClear();
    const project = mockProject(true);
    const extensions = createTypstSetup({
      project: project as any,
      sync: "editor-driven",
      highlighting: stubHighlighting as any,
    });

    expect(extensions).toContain(stubHighlighting.extension);
    expect(createTypstHoverImpl).toHaveBeenCalledWith({
      project,
      highlightCode: stubHighlighting.highlightCode,
    });
  });

  it("skips analyzer-only features when the project has no analyzer", () => {
    vi.mocked(createTypstHoverImpl).mockClear();
    const project = mockProject(false);
    createTypstSetup({ project: project as any, sync: "editor-driven" });

    expect(createTypstHoverImpl).not.toHaveBeenCalled();
  });
});

describe("granular public APIs", () => {
  it("exports hover and completion helpers from the package entrypoint", () => {
    expect(createTypstHover).toBeTypeOf("function");
    expect(typstCompletionSource).toBeTypeOf("function");
  });
});
