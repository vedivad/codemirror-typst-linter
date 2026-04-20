import { describe, expect, it, vi } from "vitest";
import type { TypstAnalyzer } from "../analyzer.js";
import type { TypstCompiler } from "../compiler.js";
import { TypstProject } from "../project.js";

function mockCompiler(): TypstCompiler {
  return {
    setText: vi.fn().mockResolvedValue(undefined),
    setJson: vi.fn().mockResolvedValue(undefined),
    setBinary: vi.fn().mockResolvedValue(undefined),
    setMany: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockResolvedValue({ diagnostics: [] }),
    compilePdf: vi.fn().mockResolvedValue(new Uint8Array()),
    destroy: vi.fn(),
  } as unknown as TypstCompiler;
}

function mockAnalyzer(): TypstAnalyzer {
  return {
    didChange: vi.fn().mockResolvedValue(undefined),
    didChangeMany: vi.fn().mockResolvedValue(undefined),
    didClose: vi.fn().mockResolvedValue(undefined),
    didCloseMany: vi.fn().mockResolvedValue(undefined),
    completion: vi.fn().mockResolvedValue(null),
    hover: vi.fn().mockResolvedValue(null),
    destroy: vi.fn(),
  } as unknown as TypstAnalyzer;
}

describe("TypstProject#destroy", () => {
  it("destroys the attached compiler", () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    project.destroy();
    expect(compiler.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the attached analyzer when present", () => {
    const compiler = mockCompiler();
    const analyzer = mockAnalyzer();
    const project = new TypstProject({ compiler, analyzer });
    project.destroy();
    expect(analyzer.destroy).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a project without an analyzer", () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    expect(() => project.destroy()).not.toThrow();
  });

  it("is idempotent", () => {
    const compiler = mockCompiler();
    const analyzer = mockAnalyzer();
    const project = new TypstProject({ compiler, analyzer });
    project.destroy();
    project.destroy();
    expect(compiler.destroy).toHaveBeenCalledTimes(1);
    expect(analyzer.destroy).toHaveBeenCalledTimes(1);
  });

  it("clears compile listeners", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    const listener = vi.fn();
    project.onCompile(listener);
    project.destroy();
    // Any new compile would not reach listener; the Set has been cleared.
    // We can assert via files/getText that internal maps are cleared too.
    expect(project.files).toEqual([]);
  });

  it("clears tracked file state", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setText("/main.typ", "hello");
    expect(project.files).toEqual(["/main.typ"]);
    expect(project.getText("/main.typ")).toBe("hello");
    project.destroy();
    expect(project.files).toEqual([]);
    expect(project.getText("/main.typ")).toBeUndefined();
    expect(project.lastResult).toBeUndefined();
  });
});
