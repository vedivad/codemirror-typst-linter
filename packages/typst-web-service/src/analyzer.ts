import * as Comlink from "comlink";
import type { LspCompletionResponse, LspHover } from "./analyzer-types.js";
import { createAnalyzerWorker } from "./rpc.js";

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
  init(wasmUrl: string): Promise<void>;
  didOpen(uri: string, content: string): Promise<void>;
  didClose(uri: string): Promise<void>;
  didChange(uri: string, version: number, content: string): Promise<void>;
  didChangeMany(
    opens: Array<{ uri: string; content: string }>,
    changes: Array<{ uri: string; version: number; content: string }>,
  ): Promise<void>;
  didCloseMany(uris: string[]): Promise<void>;
  completion(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspCompletionResponse>;
  hover(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspHover | null>;
  destroy(): void;
}

/**
 * Manages a tinymist language server in a Web Worker. Provides LSP-based
 * completion and hover for Typst documents.
 *
 *   const analyzer = await TypstAnalyzer.create({ wasmUrl: '...' });
 */
export class TypstAnalyzer {
  private readonly proxy: Comlink.Remote<AnalyzerWorkerAPI>;
  private readonly worker: Worker;
  private versionCounter = 0;
  private openedUris = new Set<string>();

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

    await proxy.init(absoluteWasmUrl);

    return analyzer;
  }

  async didOpen(uri: string, content: string): Promise<void> {
    this.openedUris.add(uri);
    await this.proxy.didOpen(uri, content);
  }

  async didClose(uri: string): Promise<void> {
    if (!this.openedUris.delete(uri)) return;
    await this.proxy.didClose(uri);
  }

  /**
   * Notify the analyzer that a document has changed.
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
        this.openedUris.add(uri);
      }
    }
    if (opens.length === 0 && changes.length === 0) return;
    await this.proxy.didChangeMany(opens, changes);
  }

  /**
   * Batch document closes. Filters to currently-open URIs and sends the set
   * in a single worker roundtrip.
   */
  async didCloseMany(uris: string[]): Promise<void> {
    const toClose: string[] = [];
    for (const uri of uris) {
      if (this.openedUris.delete(uri)) toClose.push(uri);
    }
    if (toClose.length === 0) return;
    await this.proxy.didCloseMany(toClose);
  }

  async completion(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspCompletionResponse> {
    return this.proxy.completion(uri, line, character);
  }

  async hover(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspHover | null> {
    return this.proxy.hover(uri, line, character);
  }

  destroy(): void {
    this.proxy[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
