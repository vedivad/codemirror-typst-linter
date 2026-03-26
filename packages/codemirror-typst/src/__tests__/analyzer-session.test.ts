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
      return () => {};
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

  it("replays cached diagnostics to a new subscriber immediately", () => {
    const harness = createSessionHarness();

    // Push before any subscriber is registered.
    harness.pushDiagnostics("untitled:project/main.typ", [
      diagnostic("error A"),
    ]);

    // Late subscriber should get the cached value immediately.
    const listener = vi.fn();
    harness.session.subscribe("/main.typ", listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0][0].message).toBe("error A");
  });

  it("does not replay if no push has arrived for that URI", () => {
    const harness = createSessionHarness();

    // Push for a different file.
    harness.pushDiagnostics("untitled:project/template.typ", [
      diagnostic("error"),
    ]);

    const listener = vi.fn();
    harness.session.subscribe("/main.typ", listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it("replays the most recent push, not an older one", () => {
    const harness = createSessionHarness();

    harness.pushDiagnostics("untitled:project/main.typ", [
      diagnostic("error A"),
    ]);
    harness.pushDiagnostics("untitled:project/main.typ", [
      diagnostic("error B"),
    ]);

    const listener = vi.fn();
    harness.session.subscribe("/main.typ", listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0][0].message).toBe("error B");
  });
});

describe("AnalyzerSession sync", () => {
  it("uses didOpen on first sync", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", { "/main.typ": "hello" });

    expect(analyzer.didOpen).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).not.toHaveBeenCalled();
  });

  it("uses didChange on subsequent sync when content differs", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", { "/main.typ": "hello" });
    await session.sync("/main.typ", { "/main.typ": "world" });

    expect(analyzer.didOpen).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).toHaveBeenCalledWith(
      expect.stringContaining("main.typ"),
      "world",
    );
  });

  it("skips network call on subsequent sync when content is unchanged", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", { "/main.typ": "hello" });
    await session.sync("/main.typ", { "/main.typ": "hello" });

    expect(analyzer.didOpen).toHaveBeenCalledTimes(1);
    expect(analyzer.didChange).not.toHaveBeenCalled();
  });

  it("triggers hover when active file content is unchanged to force diagnostics", async () => {
    const { session, analyzer } = createSessionHarness();

    await session.sync("/main.typ", { "/main.typ": "hello" });

    analyzer.didOpen.mockClear();
    analyzer.didChange.mockClear();
    analyzer.hover.mockClear();

    // Sync again with identical content — hover forces fresh analysis.
    await session.sync("/main.typ", { "/main.typ": "hello" });

    expect(analyzer.didOpen).not.toHaveBeenCalled();
    expect(analyzer.didChange).not.toHaveBeenCalled();
    expect(analyzer.hover).toHaveBeenCalledTimes(1);
    expect(analyzer.hover).toHaveBeenCalledWith(
      expect.stringContaining("main.typ"),
      0,
      0,
    );
  });
});
