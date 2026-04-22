import * as Comlink from "comlink";
import init, { TinymistLanguageServer } from "tinymist-web";
import type {
  LspCompletionResponse,
  LspHover,
  LspPosition,
} from "./analyzer-types.js";

export class AnalyzerWorker {
  #server: TinymistLanguageServer | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- events are opaque values from WASM
  #events: any[] = [];

  #ensureServer(): TinymistLanguageServer {
    if (!this.#server) throw new Error("Analyzer not initialized");
    return this.#server;
  }

  #notifyDidOpen(uri: string, content: string): void {
    this.#ensureServer().on_notification("textDocument/didOpen", {
      textDocument: { uri, languageId: "typst", version: 1, text: content },
    });
  }

  #notifyDidClose(uri: string): void {
    this.#ensureServer().on_notification("textDocument/didClose", {
      textDocument: { uri },
    });
  }

  #notifyDidChange(uri: string, version: number, content: string): void {
    this.#ensureServer().on_notification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  #flushEvents(): void {
    if (!this.#server) return;
    while (this.#events.length > 0) {
      for (const event of this.#events.splice(0)) {
        this.#server.on_event(event);
      }
    }
  }

  async init(wasmUrl: string): Promise<void> {
    await init({ module_or_path: wasmUrl });

    this.#server = new TinymistLanguageServer({
      sendEvent: (event: any): void => {
        this.#events.push(event);
      },
      sendRequest: ({
        id,
      }: {
        id: number;
        method: string;
        params: unknown;
      }): void => {
        this.#server!.on_response({ id, result: null });
      },
      sendNotification: (): void => {},
      resolveFn: () => undefined,
    });

    const initResult = this.#server.on_request("initialize", {
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

    this.#flushEvents();
    this.#server.on_notification("initialized", {});
    this.#flushEvents();
  }

  async didOpen(uri: string, content: string): Promise<void> {
    this.#notifyDidOpen(uri, content);
    this.#flushEvents();
  }

  async didClose(uri: string): Promise<void> {
    this.#notifyDidClose(uri);
    this.#flushEvents();
  }

  async didChange(
    uri: string,
    version: number,
    content: string,
  ): Promise<void> {
    this.#notifyDidChange(uri, version, content);
    this.#flushEvents();
  }

  async didChangeMany(
    opens: Array<{ uri: string; content: string }>,
    changes: Array<{ uri: string; version: number; content: string }>,
  ): Promise<void> {
    this.#ensureServer();
    for (const { uri, content } of opens) {
      this.#notifyDidOpen(uri, content);
    }
    for (const { uri, version, content } of changes) {
      this.#notifyDidChange(uri, version, content);
    }
    this.#flushEvents();
  }

  async didCloseMany(uris: string[]): Promise<void> {
    this.#ensureServer();
    for (const uri of uris) {
      this.#notifyDidClose(uri);
    }
    this.#flushEvents();
  }

  async completion(
    uri: string,
    position: LspPosition,
  ): Promise<LspCompletionResponse> {
    const resolved = await this.#ensureServer().on_request(
      "textDocument/completion",
      { textDocument: { uri }, position },
    );
    this.#flushEvents();
    return (resolved ?? null) as LspCompletionResponse;
  }

  async hover(uri: string, position: LspPosition): Promise<LspHover | null> {
    const resolved = await this.#ensureServer().on_request(
      "textDocument/hover",
      { textDocument: { uri }, position },
    );
    this.#flushEvents();
    return (resolved ?? null) as LspHover | null;
  }

  async completionWithDoc(
    uri: string,
    version: number,
    content: string,
    position: LspPosition,
    kind: "open" | "change",
  ): Promise<LspCompletionResponse> {
    if (kind === "open") this.#notifyDidOpen(uri, content);
    else this.#notifyDidChange(uri, version, content);
    return this.completion(uri, position);
  }

  async hoverWithDoc(
    uri: string,
    version: number,
    content: string,
    position: LspPosition,
    kind: "open" | "change",
  ): Promise<LspHover | null> {
    if (kind === "open") this.#notifyDidOpen(uri, content);
    else this.#notifyDidChange(uri, version, content);
    return this.hover(uri, position);
  }

  destroy(): void {
    this.#server?.free();
    this.#server = null;
  }
}

Comlink.expose(new AnalyzerWorker());
