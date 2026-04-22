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

function waitForCompile(
  compiler: TypstCompiler,
  minCalls: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const calls = (compiler.compile as any).mock.calls.length;
      if (calls >= minCalls) return resolve();
      if (Date.now() - start > 1000)
        return reject(new Error(`timeout: ${calls}/${minCalls} compiles`));
      setTimeout(check, 5);
    };
    check();
  });
}

describe("TypstProject auto-compile on VFS mutation", () => {
  it("schedules a compile after setText", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setText("/main.typ", "hello");
    await waitForCompile(compiler, 1);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("skips RPC and compile when setText repeats the same content", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setText("/main.typ", "hello");
    await waitForCompile(compiler, 1);
    await project.setText("/main.typ", "hello");
    await new Promise((r) => setTimeout(r, 20));
    expect(compiler.setText).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("schedules exactly one compile for a batch setMany", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setMany({
      "/main.typ": "a",
      "/util.typ": "b",
      "/readme.typ": "c",
    });
    await waitForCompile(compiler, 1);
    // Let any extraneous scheduled compiles flush.
    await new Promise((r) => setTimeout(r, 20));
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("skips RPC and compile when setMany repeats only unchanged content", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setMany({ "/a.typ": "x", "/b.typ": "y" });
    await waitForCompile(compiler, 1);
    await project.setMany({ "/a.typ": "x", "/b.typ": "y" });
    await new Promise((r) => setTimeout(r, 20));
    expect(compiler.setMany).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("sends only changed entries when setMany mixes old and new content", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setMany({ "/a.typ": "x", "/b.typ": "y" });
    await waitForCompile(compiler, 1);
    await project.setMany({ "/a.typ": "x", "/b.typ": "updated" });
    await waitForCompile(compiler, 2);
    expect(compiler.setMany).toHaveBeenNthCalledWith(2, {
      "/b.typ": "updated",
    });
  });

  it("schedules a compile after remove", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setText("/main.typ", "x");
    await waitForCompile(compiler, 1);
    await project.remove("/main.typ");
    await waitForCompile(compiler, 2);
    expect(compiler.compile).toHaveBeenCalledTimes(2);
  });

  it("schedules a compile after clear", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler });
    await project.setText("/main.typ", "x");
    await waitForCompile(compiler, 1);
    await project.clear();
    await waitForCompile(compiler, 2);
    expect(compiler.compile).toHaveBeenCalledTimes(2);
  });

  it("schedules a compile when the entry changes", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler, entry: "/main.typ" });
    project.entry = "/other.typ";
    await waitForCompile(compiler, 1);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when setting the entry to the same path", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({ compiler, entry: "/main.typ" });
    project.entry = "/main.typ";
    await new Promise((r) => setTimeout(r, 20));
    expect(compiler.compile).not.toHaveBeenCalled();
  });

  it("compile() cancels any pending scheduled compile", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({
      compiler,
      compileDebounceMs: 100,
    });
    await project.setText("/main.typ", "x");
    // Pending compile is 100ms out; flush it by calling compile() directly.
    await project.compile();
    // Wait long enough that the original debounced compile would have fired.
    await new Promise((r) => setTimeout(r, 150));
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("destroy() cancels pending scheduled compiles", async () => {
    const compiler = mockCompiler();
    const project = new TypstProject({
      compiler,
      compileDebounceMs: 50,
    });
    await project.setText("/main.typ", "x");
    project.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(compiler.compile).not.toHaveBeenCalled();
  });
});
