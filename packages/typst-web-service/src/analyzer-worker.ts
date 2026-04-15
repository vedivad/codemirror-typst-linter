import * as Comlink from "comlink";
import init, { TinymistLanguageServer } from "tinymist-web";
import type { LspDiagnostic } from "./analyzer-types.js";

type DiagnosticsCallback = (uri: string, diagnostics: LspDiagnostic[]) => void;

function normalizeUri(uri: string): string {
  return uri.startsWith("untitled:/")
    ? `untitled:${uri.slice("untitled:/".length)}`
    : uri;
}

class AnalyzerWorker {
  private server: TinymistLanguageServer | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- events are opaque values from WASM
  private events: any[] = [];
  private onDiagnostics?: DiagnosticsCallback;

  private flushEvents(): void {
    if (!this.server) return;
    while (this.events.length > 0) {
      for (const event of this.events.splice(0)) {
        this.server.on_event(event);
      }
    }
  }

  async init(
    wasmUrl: string,
    onDiagnostics: DiagnosticsCallback,
  ): Promise<void> {
    this.onDiagnostics = onDiagnostics;
    await init(wasmUrl);

    this.server = new TinymistLanguageServer({
      sendEvent: (event: any): void => {
        this.events.push(event);
      },
      sendRequest: ({
        id,
      }: {
        id: number;
        method: string;
        params: unknown;
      }): void => {
        this.server!.on_response({ id, result: null });
      },
      sendNotification: ({
        method,
        params,
      }: {
        method: string;
        params: unknown;
      }): void => {
        if (method === "textDocument/publishDiagnostics") {
          const { uri, diagnostics } = params as {
            uri: string;
            diagnostics: LspDiagnostic[];
          };
          this.onDiagnostics?.(normalizeUri(uri), diagnostics);
        }
      },
      resolveFn: () => undefined,
    });

    const initResult = this.server.on_request("initialize", {
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ["markdown", "plaintext"] },
        },
      },
      rootUri: "file:///",
    });

    if (initResult && typeof initResult === "object" && "then" in initResult) {
      await initResult;
    }

    this.flushEvents();
    this.server.on_notification("initialized", {});
    this.flushEvents();
  }

  async didOpen(uri: string, content: string): Promise<void> {
    if (!this.server) throw new Error("Analyzer not initialized");
    this.server.on_notification("textDocument/didOpen", {
      textDocument: { uri, languageId: "typst", version: 1, text: content },
    });
    this.flushEvents();
  }

  async didClose(uri: string): Promise<void> {
    if (!this.server) throw new Error("Analyzer not initialized");
    this.server.on_notification("textDocument/didClose", {
      textDocument: { uri },
    });
    this.flushEvents();
  }

  async didChange(
    uri: string,
    version: number,
    content: string,
  ): Promise<void> {
    if (!this.server) throw new Error("Analyzer not initialized");
    this.server.on_notification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
    this.flushEvents();
  }

  async completion(
    uri: string,
    line: number,
    character: number,
  ): Promise<unknown> {
    if (!this.server) throw new Error("Analyzer not initialized");
    const result = this.server.on_request("textDocument/completion", {
      textDocument: { uri },
      position: { line, character },
    });
    const resolved =
      result && typeof result === "object" && "then" in result
        ? await result
        : result;
    this.flushEvents();
    return resolved ?? null;
  }

  async hover(uri: string, line: number, character: number): Promise<unknown> {
    if (!this.server) throw new Error("Analyzer not initialized");
    const result = this.server.on_request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
    const resolved =
      result && typeof result === "object" && "then" in result
        ? await result
        : result;
    this.flushEvents();
    return resolved ?? null;
  }

  destroy(): void {
    this.server?.free();
    this.server = null;
  }
}

Comlink.expose(new AnalyzerWorker());
