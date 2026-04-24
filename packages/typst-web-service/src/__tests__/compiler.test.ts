import { describe, expect, it, vi } from "vitest";
import { TypstCompiler } from "../compiler.js";

function mockProxy(): any {
  return {
    mapShadow: vi.fn().mockResolvedValue(undefined),
    mapShadowMany: vi.fn().mockResolvedValue(undefined),
    unmapShadow: vi.fn().mockResolvedValue(undefined),
    resetShadow: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockResolvedValue({ diagnostics: [] }),
    compilePdf: vi.fn().mockResolvedValue(new Uint8Array()),
  };
}

function makeCompiler(): { compiler: TypstCompiler; proxy: any } {
  const proxy = mockProxy();
  const worker = { terminate: vi.fn() } as unknown as Worker;
  // Private constructor — bypass at runtime for unit testing.
  const compiler = new (TypstCompiler as any)(worker, proxy);
  return { compiler, proxy };
}

describe("TypstCompiler retries after transient worker failure", () => {
  it("setText retry still reaches the worker after a failed call", async () => {
    const { compiler, proxy } = makeCompiler();
    proxy.mapShadow
      .mockRejectedValueOnce(new Error("worker boom"))
      .mockResolvedValue(undefined);
    await expect(compiler.setText("/main.typ", "hello")).rejects.toThrow(
      "worker boom",
    );
    await compiler.setText("/main.typ", "hello");
    expect(proxy.mapShadow).toHaveBeenCalledTimes(2);
  });

  it("remove retry still reaches the worker after a failed call", async () => {
    const { compiler, proxy } = makeCompiler();
    await compiler.setText("/main.typ", "hello");
    proxy.unmapShadow
      .mockRejectedValueOnce(new Error("worker boom"))
      .mockResolvedValue(undefined);
    await expect(compiler.remove("/main.typ")).rejects.toThrow("worker boom");
    await compiler.remove("/main.typ");
    expect(proxy.unmapShadow).toHaveBeenCalledTimes(2);
  });

  it("setText dedup skips RPC only after a successful call", async () => {
    const { compiler, proxy } = makeCompiler();
    proxy.mapShadow
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    await expect(compiler.setText("/a.typ", "x")).rejects.toThrow();
    // Cache should not hold "x" yet — retry must go through.
    await compiler.setText("/a.typ", "x");
    // Third call with same content should now dedup.
    await compiler.setText("/a.typ", "x");
    expect(proxy.mapShadow).toHaveBeenCalledTimes(2);
  });
});
