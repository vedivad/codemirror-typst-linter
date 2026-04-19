import * as Comlink from "comlink";
import init, { TinymistLanguageServer } from "tinymist-web";

class AnalyzerWorker {
  private server: TinymistLanguageServer | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- events are opaque values from WASM
  private events: any[] = [];

  private flushEvents(): void {
    if (!this.server) return;
    while (this.events.length > 0) {
      for (const event of this.events.splice(0)) {
        this.server.on_event(event);
      }
    }
  }

  async init(wasmUrl: string): Promise<void> {
    await init({ module_or_path: wasmUrl });

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
        method: _method,
        params: _params,
      }: {
        method: string;
        params: unknown;
      }): void => {},
      resolveFn: () => undefined,
    });

    const initResult = this.server.on_request("initialize", {
      capabilities: {
        textDocument: {
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

  async didChangeMany(
    opens: Array<{ uri: string; content: string }>,
    changes: Array<{ uri: string; version: number; content: string }>,
  ): Promise<void> {
    if (!this.server) throw new Error("Analyzer not initialized");
    for (const { uri, content } of opens) {
      this.server.on_notification("textDocument/didOpen", {
        textDocument: { uri, languageId: "typst", version: 1, text: content },
      });
    }
    for (const { uri, version, content } of changes) {
      this.server.on_notification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
    }
    this.flushEvents();
  }

  async didCloseMany(uris: string[]): Promise<void> {
    if (!this.server) throw new Error("Analyzer not initialized");
    for (const uri of uris) {
      this.server.on_notification("textDocument/didClose", {
        textDocument: { uri },
      });
    }
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
