import type {
  AnalyzerDiagnosticEvent,
  AnalyzerMessage,
  AnalyzerRequest,
  AnalyzerResponse,
  LspDiagnostic,
} from "./analyzer-types.js";
import { createAnalyzerWorker, destroyWorker, workerRpc } from "./rpc.js";

export type { LspDiagnostic };

export type DiagnosticsListener = (
  uri: string,
  diagnostics: LspDiagnostic[],
) => void;

export interface TypstAnalyzerOptions {
  /**
   * Explicit Worker instance. When omitted, an inlined blob worker is created automatically.
   * Use this for Vite apps:
   *   `new TypstAnalyzer({ worker: new Worker(new URL('typst-web-service/analyzer-worker', import.meta.url), { type: 'module' }) })`
   */
  worker?: Worker;
  /**
   * URL to the tinymist WASM binary.
   * Required — there is no default CDN URL for tinymist-web.
   */
  wasmUrl: string;
}

const TIMEOUT = { INIT: 120_000, REQUEST: 30_000, DESTROY: 5_000 } as const;

function normalizeUntitledUri(uri: string): string {
  if (!uri.startsWith("untitled:")) return uri;
  return `untitled:${uri.slice("untitled:".length).replace(/^\/+/, "")}`;
}

/**
 * Manages a tinymist language server in a Web Worker. Provides LSP-based
 * diagnostics, completion, and hover for Typst documents.
 *
 * Diagnostics are push-based: call `didChange()` to notify the analyzer of
 * content changes, and receive diagnostics via `onDiagnostics()` listeners
 * whenever tinymist publishes them.
 *
 *   const analyzer = new TypstAnalyzer({ wasmUrl: '...' });
 *   analyzer.onDiagnostics((uri, diags) => { ... });
 */
export class TypstAnalyzer {
  readonly ready: Promise<void>;
  private idCounter = 0;
  private versionCounter = 0;
  private worker: Worker;
  private openedUris = new Set<string>();
  private diagnosticsListeners = new Set<DiagnosticsListener>();
  private latestDiagnosticsByUri = new Map<string, LspDiagnostic[]>();

  constructor(options: TypstAnalyzerOptions) {
    this.worker = options.worker ?? createAnalyzerWorker();
    const absoluteWasmUrl = new URL(options.wasmUrl, globalThis.location?.href)
      .href;

    // Listen for unsolicited diagnostic push notifications from the worker.
    this.worker.addEventListener(
      "message",
      (e: MessageEvent<AnalyzerMessage>) => {
        if (e.data.type === "diagnostics" && !("id" in e.data)) {
          const event = e.data as AnalyzerDiagnosticEvent;
          const normalizedUri = normalizeUntitledUri(event.uri);
          this.latestDiagnosticsByUri.set(normalizedUri, event.diagnostics);
          for (const listener of this.diagnosticsListeners) {
            listener(normalizedUri, event.diagnostics);
          }
        }
      },
    );

    this.ready = this.rpc(
      { type: "init", id: ++this.idCounter, wasmUrl: absoluteWasmUrl },
      TIMEOUT.INIT,
    ).then((res) => {
      if (res.type === "error")
        throw new Error(`TypstAnalyzer init failed: ${res.message}`);
    });
  }

  /**
   * Register a listener for push-based diagnostics.
   * Returns an unsubscribe function.
   */
  onDiagnostics(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  /** Returns the latest pushed diagnostics for a URI, if available. */
  getLatestDiagnostics(uri: string): LspDiagnostic[] | undefined {
    return this.latestDiagnosticsByUri.get(normalizeUntitledUri(uri));
  }

  private rpc(
    request: AnalyzerRequest,
    timeoutMs: number = TIMEOUT.REQUEST,
  ): Promise<AnalyzerResponse> {
    return workerRpc(this.worker, request, timeoutMs);
  }

  async didOpen(uri: string, content: string): Promise<void> {
    await this.ready;
    const res = await this.rpc({
      type: "didOpen",
      id: ++this.idCounter,
      uri,
      content,
    });
    if (res.type === "error") throw new Error(res.message);
    this.openedUris.add(uri);
  }

  /**
   * Notify the analyzer that a document has changed.
   * Diagnostics will arrive asynchronously via `onDiagnostics()` listeners.
   */
  async didChange(uri: string, content: string): Promise<void> {
    await this.ready;
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
    await this.ready;
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
    await this.ready;
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
    this.latestDiagnosticsByUri.clear();
    destroyWorker(
      this.worker,
      { type: "destroy" as const, id: ++this.idCounter },
      TIMEOUT.DESTROY,
      "TypstAnalyzer",
    );
  }
}
