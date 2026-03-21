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
        pushDiagnostics(uri: string, diagnostics: LspDiagnostic[]) {
            push?.(uri, diagnostics);
        },
    };
}

describe("AnalyzerSession subscriptions", () => {
    it("replays cached diagnostics on subscribe", () => {
        const harness = createSessionHarness();
        harness.pushDiagnostics("untitled:project/main.typ", [diagnostic("missing symbol")]);

        const listener = vi.fn();
        harness.session.subscribe("/main.typ", listener);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0][0].message).toBe("missing symbol");
    });

    it("dedupes identical pushed diagnostics", () => {
        const harness = createSessionHarness();

        const listener = vi.fn();
        harness.session.subscribe("/main.typ", listener);

        const diagnostics = [diagnostic("same")];
        harness.pushDiagnostics("untitled:project/main.typ", diagnostics);
        harness.pushDiagnostics("untitled:project/main.typ", diagnostics);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
