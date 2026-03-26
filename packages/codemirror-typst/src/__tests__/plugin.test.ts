import { EditorState } from "@codemirror/state";
import type { DiagnosticMessage } from "@vedivad/typst-web-service";
import { describe, expect, it, vi } from "vitest";
import { CompilerLintPlugin } from "../compiler-plugin.js";

function mockView(doc: string) {
  const state = EditorState.create({ doc });
  return { state, dispatch: vi.fn() } as any;
}

function mockCompiler(diagnostics: DiagnosticMessage[] = []) {
  return {
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
  it("returns diagnostics filtered by file path", async () => {
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
    const compiler = mockCompiler(diags);
    const onDiagnostics = vi.fn();
    const view = mockView("abc");
    new CompilerLintPlugin({ compiler, onDiagnostics }, view);

    await waitFor(() => onDiagnostics.mock.calls.length > 0);
    expect(onDiagnostics).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ message: "bad" })]),
    );
    expect(onDiagnostics.mock.calls[0][0]).toHaveLength(1);
  });

  it("returns error diagnostic when compile throws", async () => {
    const compiler = {
      compile: vi.fn().mockRejectedValue(new Error("boom")),
    } as any;
    const onDiagnostics = vi.fn();
    const view = mockView("x");
    new CompilerLintPlugin({ compiler, onDiagnostics }, view);

    await waitFor(() => onDiagnostics.mock.calls.length > 0);
    const result = onDiagnostics.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].message).toBe("boom");
  });

  it("passes merged files to compiler.compile", async () => {
    const compiler = mockCompiler();
    const getFiles = () => ({ "/lib.typ": "// lib" });
    const view = mockView("hello");
    new CompilerLintPlugin({ compiler, filePath: () => "/main.typ", getFiles }, view);

    await waitFor(() => compiler.compile.mock.calls.length > 0);
    expect(compiler.compile).toHaveBeenCalledWith({
      "/lib.typ": "// lib",
      "/main.typ": "hello",
    });
  });

  it("aborts previous compile when a new one starts", async () => {
    const onCompile = vi.fn();
    let resolveFirst: (v: any) => void;
    const compiler = {
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
    const plugin = new CompilerLintPlugin({ compiler, onCompile }, view);

    // Wait for first compile to start
    await waitFor(() => compiler.compile.mock.calls.length > 0);

    // Trigger second compile via update
    plugin.update({ docChanged: true, view } as any);

    // Wait for second compile
    await waitFor(() => compiler.compile.mock.calls.length > 1);

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
