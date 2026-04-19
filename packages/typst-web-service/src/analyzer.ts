import * as Comlink from "comlink";
import type { LspDiagnostic } from "./analyzer-types.js";
import { createAnalyzerWorker } from "./rpc.js";
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

interface AnalyzerWorkerAPI {
  init(
    wasmUrl: string,
    onDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void,
  ): Promise<void>;
  didOpen(uri: string, content: string): Promise<void>;
  didClose(uri: string): Promise<void>;
  didChange(uri: string, version: number, content: string): Promise<void>;
  didChangeMany(
    opens: Array<{ uri: string; content: string }>,
    changes: Array<{ uri: string; version: number; content: string }>,
  ): Promise<void>;
  didCloseMany(uris: string[]): Promise<void>;
  completion(uri: string, line: number, character: number): Promise<unknown>;
  hover(uri: string, line: number, character: number): Promise<unknown>;
  destroy(): void;
}

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
  private readonly proxy: Comlink.Remote<AnalyzerWorkerAPI>;
  private readonly worker: Worker;
  private versionCounter = 0;
  private openedUris = new Set<string>();
  private diagnosticsListeners = new Set<DiagnosticsListener>();

  private constructor(
    worker: Worker,
    proxy: Comlink.Remote<AnalyzerWorkerAPI>,
  ) {
    this.worker = worker;
    this.proxy = proxy;
  }

  static async create(options: TypstAnalyzerOptions): Promise<TypstAnalyzer> {
    const worker = options.worker ?? createAnalyzerWorker();
    const proxy = Comlink.wrap<AnalyzerWorkerAPI>(worker);
    const absoluteWasmUrl = new URL(options.wasmUrl, globalThis.location?.href)
      .href;

    const analyzer = new TypstAnalyzer(worker, proxy);

    await proxy.init(
      absoluteWasmUrl,
      Comlink.proxy((uri: string, diagnostics: LspDiagnostic[]) => {
        const normalizedUri = normalizeUntitledUri(uri);
        for (const listener of analyzer.diagnosticsListeners) {
          listener(normalizedUri, diagnostics);
        }
      }),
    );

    return analyzer;
  }

  /**
   * Register a listener for push-based diagnostics.
   * Returns an unsubscribe function.
   */
  onDiagnostics(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  async didOpen(uri: string, content: string): Promise<void> {
    await this.proxy.didOpen(uri, content);
    this.openedUris.add(uri);
  }

  async didClose(uri: string): Promise<void> {
    if (!this.openedUris.has(uri)) return;
    await this.proxy.didClose(uri);
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
    await this.proxy.didChange(uri, version, content);
  }

  /**
   * Batch document changes. Splits inputs into opens (first-time URIs) and
   * changes (already-open URIs) and sends them in a single worker roundtrip.
   */
  async didChangeMany(docs: Record<string, string>): Promise<void> {
    const opens: Array<{ uri: string; content: string }> = [];
    const changes: Array<{ uri: string; version: number; content: string }> =
      [];
    for (const [uri, content] of Object.entries(docs)) {
      if (this.openedUris.has(uri)) {
        changes.push({ uri, version: ++this.versionCounter, content });
      } else {
        opens.push({ uri, content });
      }
    }
    if (opens.length === 0 && changes.length === 0) return;
    await this.proxy.didChangeMany(opens, changes);
    for (const { uri } of opens) this.openedUris.add(uri);
  }

  /**
   * Batch document closes. Filters to currently-open URIs and sends the set
   * in a single worker roundtrip.
   */
  async didCloseMany(uris: string[]): Promise<void> {
    const toClose = uris.filter((uri) => this.openedUris.has(uri));
    if (toClose.length === 0) return;
    await this.proxy.didCloseMany(toClose);
    for (const uri of toClose) this.openedUris.delete(uri);
  }

  async completion(
    uri: string,
    line: number,
    character: number,
  ): Promise<unknown> {
    return this.proxy.completion(uri, line, character);
  }

  async hover(uri: string, line: number, character: number): Promise<unknown> {
    return this.proxy.hover(uri, line, character);
  }

  destroy(): void {
    this.diagnosticsListeners.clear();
    this.proxy[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
