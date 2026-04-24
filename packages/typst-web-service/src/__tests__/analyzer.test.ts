import { describe, expect, it, vi } from "vitest";
import { TypstAnalyzer } from "../analyzer.js";

function mockProxy(): any {
  return {
    didOpen: vi.fn().mockResolvedValue(undefined),
    didClose: vi.fn().mockResolvedValue(undefined),
    didChange: vi.fn().mockResolvedValue(undefined),
    didChangeMany: vi.fn().mockResolvedValue(undefined),
    didCloseMany: vi.fn().mockResolvedValue(undefined),
    completion: vi.fn().mockResolvedValue(null),
    completionWithDoc: vi.fn().mockResolvedValue(null),
    hover: vi.fn().mockResolvedValue(null),
    hoverWithDoc: vi.fn().mockResolvedValue(null),
  };
}

function makeAnalyzer(): { analyzer: TypstAnalyzer; proxy: any } {
  const proxy = mockProxy();
  const worker = { terminate: vi.fn() } as unknown as Worker;
  const analyzer = new (TypstAnalyzer as any)(worker, proxy);
  return { analyzer, proxy };
}

const pos = { line: 0, character: 0 };

describe("TypstAnalyzer retries after transient worker failure", () => {
  it("didChange retry still reaches the worker after a failure", async () => {
    const { analyzer, proxy } = makeAnalyzer();
    await analyzer.didOpen("file:///a.typ", "hello");
    proxy.didChange
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    await expect(analyzer.didChange("file:///a.typ", "world")).rejects.toThrow(
      "boom",
    );
    await analyzer.didChange("file:///a.typ", "world");
    expect(proxy.didChange).toHaveBeenCalledTimes(2);
  });

  it("didClose retry still reaches the worker after a failure", async () => {
    const { analyzer, proxy } = makeAnalyzer();
    await analyzer.didOpen("file:///a.typ", "hello");
    proxy.didClose
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    await expect(analyzer.didClose("file:///a.typ")).rejects.toThrow("boom");
    await analyzer.didClose("file:///a.typ");
    expect(proxy.didClose).toHaveBeenCalledTimes(2);
  });

  it("didChange after a failed completion still fires the RPC", async () => {
    const { analyzer, proxy } = makeAnalyzer();
    await analyzer.didOpen("file:///a.typ", "hello");
    proxy.completionWithDoc.mockRejectedValueOnce(new Error("boom"));
    await expect(
      analyzer.completion("file:///a.typ", "world", pos),
    ).rejects.toThrow("boom");
    // Cache must still reflect "hello" (pre-failure state), so didChange("world") proceeds.
    await analyzer.didChange("file:///a.typ", "world");
    expect(proxy.didChange).toHaveBeenCalledTimes(1);
    expect(proxy.didChange).toHaveBeenCalledWith(
      "file:///a.typ",
      expect.any(Number),
      "world",
    );
  });

  it("didChange dedup only fires after a successful didChange", async () => {
    const { analyzer, proxy } = makeAnalyzer();
    await analyzer.didOpen("file:///a.typ", "hello");
    proxy.didChange
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    await expect(analyzer.didChange("file:///a.typ", "world")).rejects.toThrow(
      "boom",
    );
    await analyzer.didChange("file:///a.typ", "world");
    // Third call with same content dedups.
    await analyzer.didChange("file:///a.typ", "world");
    expect(proxy.didChange).toHaveBeenCalledTimes(2);
  });
});
