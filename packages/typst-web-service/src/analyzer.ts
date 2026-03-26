import type {
  AnalyzerDiagnosticEvent,
  AnalyzerMessage,
  AnalyzerRequest,
  AnalyzerResponse,
  LspDiagnostic,
} from "./analyzer-types.js";
import { createAnalyzerWorker, destroyWorker, workerRpc } from "./rpc.js";
import { normalizeUntitledUri } from "./uri.js";

export type { LspDiagnostic };

export type DiagnosticsListener = (
  uri: string,
  diagnostics: LspDiagnostic[],
) => void;

export interface TypstAnalyzerOptions {
  /**
   * Explicit Worker instance. When omitted, an inlined blob worker is created automatically.
   * Use this for Vite apps:
   *   `await TypstAnalyzer.create({ worker: new Worker(new URL('typst-web-service/analyzer-worker', import.meta.url), { type: 'module' }) })`
   */
  worker?: Worker;
  /**
   * URL to the tinymist WASM binary.
   * Required — there is no default CDN URL for tinymist-web.
   */
  wasmUrl: string;
}

const TIMEOUT = { INIT: 120_000, REQUEST: 30_000, DESTROY: 5_000 } as const;

/**
 * Manages a tinymist language server in a Web Worker. Provides LSP-based
 * diagnostics, completion, and hover for Typst documents.
 *
 * Diagnostics are push-based: call `didChange()` to notify the analyzer of
 * content changes, and receive diagnostics via `onDiagnostics()` listeners
 * whenever tinymist publishes them.
 *
 *   const analyzer = await TypstAnalyzer.create({ wasmUrl: '...' });
 *   analyzer.onDiagnostics((uri, diags) => { ... });
 */
export class TypstAnalyzer {
  private idCounter: number;
  private versionCounter = 0;
  private worker: Worker;
  private openedUris = new Set<string>();
  private diagnosticsListeners = new Set<DiagnosticsListener>();

  private constructor(worker: Worker, idCounter: number) {
    this.worker = worker;
    this.idCounter = idCounter;

    // Listen for unsolicited diagnostic push notifications from the worker.
    this.worker.addEventListener(
      "message",
      (e: MessageEvent<AnalyzerMessage>) => {
        if (e.data.type === "diagnostics" && !("id" in e.data)) {
          const event = e.data as AnalyzerDiagnosticEvent;
          const normalizedUri = normalizeUntitledUri(event.uri);
          for (const listener of this.diagnosticsListeners) {
            listener(normalizedUri, event.diagnostics);
          }
        }
      },
    );
  }

  static async create(options: TypstAnalyzerOptions): Promise<TypstAnalyzer> {
    const worker = options.worker ?? createAnalyzerWorker();
    let idCounter = 0;
    const absoluteWasmUrl = new URL(options.wasmUrl, globalThis.location?.href)
      .href;

    const res = await workerRpc<AnalyzerRequest, AnalyzerResponse>(
      worker,
      { type: "init", id: ++idCounter, wasmUrl: absoluteWasmUrl },
      TIMEOUT.INIT,
    );
    if (res.type === "error")
      throw new Error(`TypstAnalyzer init failed: ${res.message}`);

    return new TypstAnalyzer(worker, idCounter);
  }

  /**
   * Register a listener for push-based diagnostics.
   * Returns an unsubscribe function.
   */
  onDiagnostics(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  private rpc(
    request: AnalyzerRequest,
    timeoutMs: number = TIMEOUT.REQUEST,
  ): Promise<AnalyzerResponse> {
    return workerRpc(this.worker, request, timeoutMs);
  }

  async didOpen(uri: string, content: string): Promise<void> {
    const res = await this.rpc({
      type: "didOpen",
      id: ++this.idCounter,
      uri,
      content,
    });
    if (res.type === "error") throw new Error(res.message);
    this.openedUris.add(uri);
  }

  async didClose(uri: string): Promise<void> {
    if (!this.openedUris.has(uri)) return;
    const res = await this.rpc({
      type: "didClose",
      id: ++this.idCounter,
      uri,
    });
    if (res.type === "error") throw new Error(res.message);
    this.openedUris.delete(uri);
  }

  /**
   * Notify the analyzer that a document has changed.
   * Diagnostics will arrive asynchronously via `onDiagnostics()` listeners.
   */
  async didChange(uri: string, content: string): Promise<void> {
    if (!this.openedUris.has(uri)) {
      await this.didOpen(uri, content);
      return;
    }

    const version = ++this.versionCounter;
    const res = await this.rpc({
      type: "didChange",
      id: ++this.idCounter,
      uri,
      version,
      content,
    });
    if (res.type === "error") throw new Error(res.message);
  }

  async completion(
    uri: string,
    line: number,
    character: number,
  ): Promise<unknown> {
    const res = await this.rpc({
      type: "completion",
      id: ++this.idCounter,
      uri,
      line,
      character,
    });
    if (res.type === "error") throw new Error(res.message);
    if (res.type === "completionResult") return res.result;
    return null;
  }

  async hover(uri: string, line: number, character: number): Promise<unknown> {
    const res = await this.rpc({
      type: "hover",
      id: ++this.idCounter,
      uri,
      line,
      character,
    });
    if (res.type === "error") throw new Error(res.message);
    if (res.type === "hoverResult") return res.result;
    return null;
  }

  destroy(): void {
    this.diagnosticsListeners.clear();
    destroyWorker(
      this.worker,
      { type: "destroy" as const, id: ++this.idCounter },
      TIMEOUT.DESTROY,
      "TypstAnalyzer",
    );
  }
}
