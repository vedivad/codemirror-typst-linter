import type { LspDiagnostic } from "@vedivad/typst-web-service";
import { describe, expect, it, vi } from "vitest";
import { TypstWorkspaceController } from "../workspace-controller.js";

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

describe("TypstWorkspaceController", () => {
    it("replays cached diagnostics on subscribe", () => {
        let push: ((uri: string, diagnostics: LspDiagnostic[]) => void) | undefined;

        const analyzer = {
            onDiagnostics: vi.fn((listener) => {
                push = listener;
                return () => { };
            }),
        } as any;

        const compiler = {
            compile: vi.fn().mockResolvedValue({ diagnostics: [] }),
        } as any;

        const session = {
            toUri: vi.fn((path: string) => `untitled:project${path}`),
            sync: vi.fn().mockResolvedValue(undefined),
        } as any;

        const controller = new TypstWorkspaceController({
            analyzer,
            compiler,
            session,
        });

        push?.("untitled:project/main.typ", [diagnostic("missing symbol")]);

        const listener = vi.fn();
        controller.subscribe("/main.typ", listener);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0][0].message).toBe("missing symbol");
    });

    it("dedupes identical pushed diagnostics", () => {
        let push: ((uri: string, diagnostics: LspDiagnostic[]) => void) | undefined;

        const analyzer = {
            onDiagnostics: vi.fn((listener) => {
                push = listener;
                return () => { };
            }),
        } as any;

        const compiler = {
            compile: vi.fn().mockResolvedValue({ diagnostics: [] }),
        } as any;

        const session = {
            toUri: vi.fn((path: string) => `untitled:project${path}`),
            sync: vi.fn().mockResolvedValue(undefined),
        } as any;

        const controller = new TypstWorkspaceController({
            analyzer,
            compiler,
            session,
        });

        const listener = vi.fn();
        controller.subscribe("/main.typ", listener);

        const diagnostics = [diagnostic("same")];
        push?.("untitled:project/main.typ", diagnostics);
        push?.("untitled:project/main.typ", diagnostics);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
