import type { LspDiagnostic } from "@vedivad/typst-web-service";
import { AnalyzerSession } from "@vedivad/typst-web-service";
import { describe, expect, it, vi } from "vitest";

function diagnostic(message: string): LspDiagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    severity: 1,
    message,
    source: "tinymist",
  };
}

function createSessionHarness() {
  let push: ((uri: string, diagnostics: LspDiagnostic[]) => void) | undefined;

  const analyzer = {
    ready: Promise.resolve(),
    didOpen: vi.fn().mockResolvedValue(undefined),
    didChange: vi.fn().mockResolvedValue(undefined),
    completion: vi.fn().mockResolvedValue(null),
    hover: vi.fn().mockResolvedValue(null),
    onDiagnostics: vi.fn((listener) => {
      push = listener;
      return () => { };
    }),
  };

  const session = new AnalyzerSession({ analyzer });

  return {
    session,
    analyzer,
    pushDiagnostics(uri: string, diagnostics: LspDiagnostic[]) {
      push?.(uri, diagnostics);
    },
  };
}

describe("AnalyzerSession subscriptions", () => {
  it("notifies subscriber when diagnostics are pushed", () => {
    const harness = createSessionHarness();

    const listener = vi.fn();
    harness.session.subscribe("/main.typ", listener);
    harness.pushDiagnostics("untitled:project/main.typ", [
      diagnostic("missing symbol"),
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0][0].message).toBe("missing symbol");
  });

  it("forwards every push to subscriber without deduplication", () => {
    const harness = createSessionHarness();

    const listener = vi.fn();
    harness.session.subscribe("/main.typ", listener);

    const diagnostics = [diagnostic("same")];
    harness.pushDiagnostics("untitled:project/main.typ", diagnostics);
    harness.pushDiagnostics("untitled:project/main.typ", diagnostics);

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("AnalyzerSession force sync", () => {
  it("uses didOpen on first sync", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", "hello", {});

    expect(analyzer.didOpen).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).not.toHaveBeenCalled();
  });

  it("uses didChange on subsequent sync when content differs", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", "hello", {});
    await session.sync("/main.typ", "world", {});

    expect(analyzer.didOpen).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).toHaveBeenCalledWith(
      expect.stringContaining("main.typ"),
      "world",
    );
  });

  it("skips network call on subsequent sync when content is unchanged", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", "hello", {});
    await session.sync("/main.typ", "hello", {});

    expect(analyzer.didOpen).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).not.toHaveBeenCalled();
  });

  it("force sync sends bump-then-restore didChange to bypass tinymist content-hash dedup", async () => {
    const { session, analyzer } = createSessionHarness();

    // First sync opens the file.
    await session.sync("/main.typ", "hello", {});

    analyzer.didOpen.mockClear();
    analyzer.didChange.mockClear();

    // Force sync with identical content — must still trigger re-analysis.
    await session.sync("/main.typ", "hello", {}, true);

    expect(analyzer.didOpen).not.toHaveBeenCalled();
    expect(analyzer.didChange).toHaveBeenCalledTimes(2);
    // First call: content + trailing comment (forces a content-hash change).
    expect(analyzer.didChange).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("main.typ"),
      "hello\n//",
    );
    // Second call: restores the real content.
    expect(analyzer.didChange).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("main.typ"),
      "hello",
    );
  });

  it("intermediate push from bump version does not overwrite final diagnostics if both arrive before rAF", () => {
    // This validates the subscriber fan-out ordering: the session always
    // forwards pushes in arrival order. The rAF coalescing in the plugin
    // (not tested here) ensures only the last-before-frame value is rendered.
    const { session, pushDiagnostics } = createSessionHarness();

    const received: LspDiagnostic[][] = [];
    session.subscribe("/main.typ", (diags) => received.push(diags));

    const bumpDiag = [diagnostic("bump version error")];
    const realDiag = [diagnostic("real error")];

    // Simulate tinymist pushing for the bump version, then the real version.
    pushDiagnostics("untitled:project/main.typ", bumpDiag);
    pushDiagnostics("untitled:project/main.typ", realDiag);

    expect(received).toHaveLength(2);
    expect(received[1][0].message).toBe("real error");
  });
});
