import { EditorState } from "@codemirror/state";
import type { DiagnosticMessage } from "@vedivad/typst-web-service";
import { describe, expect, it, vi } from "vitest";
import { CompilerLintPlugin } from "../compiler-plugin.js";

function mockView(doc: string) {
  const state = EditorState.create({ doc });
  return { state, dispatch: vi.fn() } as any;
}

function mockProject(diagnostics: DiagnosticMessage[] = []) {
  return {
    hasAnalyzer: false,
    setText: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockResolvedValue({ diagnostics }),
  } as any;
}

function waitFor(fn: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      setTimeout(check, 5);
    };
    check();
  });
}

describe("CompilerLintPlugin", () => {
  it("returns project-wide diagnostics via onCompile", async () => {
    const diags: DiagnosticMessage[] = [
      {
        package: "",
        path: "/main.typ",
        severity: "Error",
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 3 },
        message: "bad",
      },
      {
        package: "",
        path: "/other.typ",
        severity: "Warning",
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
        message: "ignored",
      },
    ];
    const project = mockProject(diags);
    const onCompile = vi.fn();
    const view = mockView("abc");
    new CompilerLintPlugin({ project, onCompile }, view);

    await waitFor(() => onCompile.mock.calls.length > 0);
    expect(onCompile).toHaveBeenCalledWith(
      expect.objectContaining({ diagnostics: diags }),
    );
  });

  it("surfaces thrown compile errors via onCompile", async () => {
    const project = {
      hasAnalyzer: false,
      setText: vi.fn().mockResolvedValue(undefined),
      compile: vi.fn().mockRejectedValue(new Error("boom")),
    } as any;
    const onCompile = vi.fn();
    const view = mockView("x");
    new CompilerLintPlugin(
      { project, onCompile, filePath: () => "/main.typ" },
      view,
    );

    await waitFor(() => onCompile.mock.calls.length > 0);
    const result = onCompile.mock.calls[0][0];
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      path: "/main.typ",
      severity: "Error",
      message: "boom",
    });
  });

  it("pushes the editor's content to the project before compiling", async () => {
    const project = mockProject();
    const view = mockView("hello");
    new CompilerLintPlugin({ project, filePath: () => "/main.typ" }, view);

    await waitFor(() => project.compile.mock.calls.length > 0);
    expect(project.setText).toHaveBeenCalledWith("/main.typ", "hello");
    expect(project.setText).toHaveBeenCalledBefore(project.compile);
  });

  it("aborts previous compile when a new one starts", async () => {
    const onCompile = vi.fn();
    let resolveFirst: (v: any) => void;
    const project = {
      hasAnalyzer: false,
      setText: vi.fn().mockResolvedValue(undefined),
      compile: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce({
          diagnostics: [
            {
              path: "/main.typ",
              severity: "Error",
              range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
              message: "second",
              package: "",
            },
          ],
        }),
    } as any;

    const view = mockView("x");
    const plugin = new CompilerLintPlugin({ project, onCompile }, view);

    // Wait for first compile to start
    await waitFor(() => project.compile.mock.calls.length > 0);

    // Trigger second compile via update
    plugin.update({ docChanged: true, view } as any);

    // Wait for second compile
    await waitFor(() => project.compile.mock.calls.length > 1);

    // Resolve the first compile — its callback should not fire (aborted)
    resolveFirst!({
      diagnostics: [
        {
          path: "/main.typ",
          severity: "Error",
          range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
          message: "first",
          package: "",
        },
      ],
    });

    await waitFor(() => onCompile.mock.calls.length > 0);
    expect(onCompile).toHaveBeenCalledTimes(1);
    expect(onCompile).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ message: "second" }),
        ]),
      }),
    );
  });
});
