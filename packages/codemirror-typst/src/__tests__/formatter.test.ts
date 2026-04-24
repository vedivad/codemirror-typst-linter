import { EditorState } from "@codemirror/state";
import type { TypstFormatter } from "@vedivad/typst-web-service";
import { describe, expect, it, vi } from "vitest";
import { createTypstFormatter, diffChanges } from "../formatter.js";

function mockFormatter(
  overrides: Partial<TypstFormatter> = {},
): TypstFormatter {
  return {
    format: vi.fn().mockResolvedValue("formatted"),
    formatRange: vi.fn().mockResolvedValue({ start: 0, end: 3, text: "fmt" }),
    ...overrides,
  } as any;
}

function mockView(doc: string, selFrom = 0, selTo = 0) {
  const state = EditorState.create({ doc });
  const dispatch = vi.fn();
  return {
    state: {
      ...state,
      doc: state.doc,
      selection: { main: { from: selFrom, to: selTo } },
    },
    dispatch,
  } as any;
}

function mutableMockView(doc: string, selFrom = 0, selTo = 0) {
  const dispatch = vi.fn();
  const view = {
    state: {
      doc: EditorState.create({ doc }).doc,
      selection: { main: { from: selFrom, to: selTo } },
    },
    dispatch,
    setDoc(next: string) {
      view.state.doc = EditorState.create({ doc: next }).doc;
    },
  };
  return view as any;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Extract the `run` function for a given key from a keymap extension. */
function getKeyRun(
  ext: any,
  key: string,
): ((view: any) => boolean) | undefined {
  // keymap.of returns a Facet value; walk through to find the binding
  const flat = Array.isArray(ext) ? ext.flat(Infinity) : [ext];
  for (const entry of flat) {
    if (entry?.value) {
      const bindings = Array.isArray(entry.value) ? entry.value : [entry.value];
      for (const b of bindings) {
        if (b.key === key) return b.run;
      }
    }
  }
  return undefined;
}

describe("diffChanges", () => {
  it("returns empty array for identical strings", () => {
    expect(diffChanges("hello\nworld", "hello\nworld")).toEqual([]);
  });

  it("produces a single change for a modified middle line", () => {
    const old = "aaa\nbbb\nccc";
    const now = "aaa\nBBB\nccc";
    const changes = diffChanges(old, now);
    expect(changes).toEqual([{ from: 4, to: 7, insert: "BBB" }]);
  });

  it("handles added lines", () => {
    const old = "aaa\nccc";
    const now = "aaa\nbbb\nccc";
    const changes = diffChanges(old, now);
    expect(changes).toHaveLength(1);
    // Applying the change to old should produce now
    const result =
      old.slice(0, changes[0].from) +
      changes[0].insert +
      old.slice(changes[0].to);
    expect(result).toBe(now);
  });

  it("handles removed lines", () => {
    const old = "aaa\nbbb\nccc";
    const now = "aaa\nccc";
    const changes = diffChanges(old, now);
    expect(changes).toHaveLength(1);
    const result =
      old.slice(0, changes[0].from) +
      changes[0].insert +
      old.slice(changes[0].to);
    expect(result).toBe(now);
  });

  it("handles change at the beginning", () => {
    const old = "aaa\nbbb";
    const now = "AAA\nbbb";
    const changes = diffChanges(old, now);
    expect(changes).toEqual([{ from: 0, to: 3, insert: "AAA" }]);
  });

  it("handles change at the end", () => {
    const old = "aaa\nbbb";
    const now = "aaa\nBBB";
    const changes = diffChanges(old, now);
    expect(changes).toEqual([{ from: 4, to: 7, insert: "BBB" }]);
  });

  it("handles complete replacement", () => {
    const old = "aaa\nbbb";
    const now = "xxx\nyyy";
    const changes = diffChanges(old, now);
    expect(changes).toHaveLength(1);
    const result =
      old.slice(0, changes[0].from) +
      changes[0].insert +
      old.slice(changes[0].to);
    expect(result).toBe(now);
  });

  it("handles empty to non-empty", () => {
    const changes = diffChanges("", "hello");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ from: 0, to: 0, insert: "hello" });
  });

  it("handles non-empty to empty", () => {
    const changes = diffChanges("hello", "");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ from: 0, to: 5, insert: "" });
  });
});

describe("createTypstFormatter", () => {
  it("calls format on the whole document when no selection", async () => {
    const formatter = mockFormatter();
    const ext = createTypstFormatter({ instance: formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");
    expect(run).toBeDefined();

    const view = mockView("hello");
    run!(view);
    await vi.waitFor(() => {
      expect(formatter.format).toHaveBeenCalledWith("hello");
    });
  });

  it("calls formatRange when selection exists", async () => {
    const formatter = mockFormatter();
    const ext = createTypstFormatter({ instance: formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");

    const view = mockView("hello world", 0, 5);
    run!(view);
    await vi.waitFor(() => {
      expect(formatter.formatRange).toHaveBeenCalledWith("hello world", 0, 5);
    });
  });

  it("skips full-document dispatch when the document changes before formatting resolves", async () => {
    const pending = deferred<string>();
    const formatter = mockFormatter({
      format: vi.fn().mockReturnValue(pending.promise),
    });
    const ext = createTypstFormatter({ instance: formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");
    const view = mutableMockView("original");

    run!(view);
    await vi.waitFor(() => {
      expect(formatter.format).toHaveBeenCalledWith("original");
    });
    view.setDoc("original plus typing");
    pending.resolve("formatted");
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("skips range dispatch when the document changes before formatting resolves", async () => {
    const pending = deferred<{ start: number; end: number; text: string }>();
    const formatter = mockFormatter({
      formatRange: vi.fn().mockReturnValue(pending.promise),
    });
    const ext = createTypstFormatter({ instance: formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");
    const view = mutableMockView("hello world", 0, 5);

    run!(view);
    await vi.waitFor(() => {
      expect(formatter.formatRange).toHaveBeenCalledWith("hello world", 0, 5);
    });
    view.setDoc("hello brave world");
    pending.resolve({ start: 0, end: 5, text: "HELLO" });
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("calls onError when formatter rejects", async () => {
    const onError = vi.fn();
    const formatter = mockFormatter({
      format: vi.fn().mockRejectedValue(new Error("wasm broke")),
    });
    const ext = createTypstFormatter({ instance: formatter, onError });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "wasm broke" }),
      );
    });
  });

  it("falls back to console.warn when no onError", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const formatter = mockFormatter({
      format: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const ext = createTypstFormatter({ instance: formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[typst-formatter]", "boom");
    });
    warnSpy.mockRestore();
  });

  it("wraps non-Error throws in an Error", async () => {
    const onError = vi.fn();
    const formatter = mockFormatter({
      format: vi.fn().mockRejectedValue("string error"),
    });
    const ext = createTypstFormatter({ instance: formatter, onError });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("string error");
    });
  });

  it("adds Mod-s binding when formatOnSave is enabled", () => {
    const formatter = mockFormatter();
    const ext = createTypstFormatter({
      instance: formatter,
      formatOnSave: true,
    });
    const run = getKeyRun(ext, "Mod-s");
    expect(run).toBeDefined();
  });

  it("calls save callback after formatting on Mod-s", async () => {
    const onSave = vi.fn();
    const formatter = mockFormatter({
      format: vi.fn().mockResolvedValue("saved content"),
    });
    const ext = createTypstFormatter({
      instance: formatter,
      formatOnSave: onSave,
    });
    const run = getKeyRun(ext, "Mod-s");

    const view = mockView("original");
    run!(view);
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });

  it("does not call save callback when the document changes before formatting resolves", async () => {
    const onSave = vi.fn();
    const pending = deferred<string>();
    const formatter = mockFormatter({
      format: vi.fn().mockReturnValue(pending.promise),
    });
    const ext = createTypstFormatter({
      instance: formatter,
      formatOnSave: onSave,
    });
    const run = getKeyRun(ext, "Mod-s");
    const view = mutableMockView("original");

    run!(view);
    await vi.waitFor(() => {
      expect(formatter.format).toHaveBeenCalledWith("original");
    });
    view.setDoc("changed");
    pending.resolve("formatted");
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
