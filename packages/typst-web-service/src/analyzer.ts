import * as Comlink from "comlink";
import type {
  LspCompletionResponse,
  LspHover,
  LspPosition,
} from "./analyzer-types.js";
import type { AnalyzerWorker } from "./analyzer-worker.js";
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

/**
 * Manages a tinymist language server in a Web Worker. Provides LSP-based
 * completion and hover for Typst documents.
 *
 *   const analyzer = await TypstAnalyzer.create({ wasmUrl: '...' });
 */
export class TypstAnalyzer {
  private readonly proxy: Comlink.Remote<AnalyzerWorker>;
  private readonly worker: Worker;
  private versionCounter = 0;
  /**
   * Last content pushed to the worker per URI. Presence is the source of
   * truth for "is this URI opened on the worker?"; value drives own-RPC dedup.
   */
  private readonly content = new Map<string, string>();

  private constructor(worker: Worker, proxy: Comlink.Remote<AnalyzerWorker>) {
    this.worker = worker;
    this.proxy = proxy;
  }

  static async create(options: TypstAnalyzerOptions): Promise<TypstAnalyzer> {
    const worker = options.worker ?? createAnalyzerWorker();
    const proxy = Comlink.wrap<AnalyzerWorker>(worker);
    const absoluteWasmUrl = new URL(options.wasmUrl, globalThis.location?.href)
      .href;

    const analyzer = new TypstAnalyzer(worker, proxy);

    await proxy.init(absoluteWasmUrl);

    return analyzer;
  }

  async didOpen(uri: string, content: string): Promise<void> {
    this.content.set(uri, content);
    await this.proxy.didOpen(uri, content);
  }

  async didClose(uri: string): Promise<void> {
    if (!this.content.delete(uri)) return;
    await this.proxy.didClose(uri);
  }

  /**
   * Notify the analyzer that a document has changed. Skips the RPC when the
   * content matches what the worker last saw.
   */
  async didChange(uri: string, content: string): Promise<void> {
    if (!this.content.has(uri)) {
      await this.didOpen(uri, content);
      return;
    }
    if (this.content.get(uri) === content) return;
    this.content.set(uri, content);
    const version = ++this.versionCounter;
    await this.proxy.didChange(uri, version, content);
  }

  /**
   * Batch document changes. Splits inputs into opens (first-time URIs) and
   * changes (already-open URIs) and sends them in a single worker roundtrip.
   * Skips unchanged documents; returns without an RPC if nothing is pending.
   */
  async didChangeMany(docs: Record<string, string>): Promise<void> {
    const opens: Array<{ uri: string; content: string }> = [];
    const changes: Array<{ uri: string; version: number; content: string }> =
      [];
    for (const [uri, content] of Object.entries(docs)) {
      if (!this.content.has(uri)) {
        opens.push({ uri, content });
        this.content.set(uri, content);
      } else if (this.content.get(uri) !== content) {
        changes.push({ uri, version: ++this.versionCounter, content });
        this.content.set(uri, content);
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
      if (this.content.delete(uri)) toClose.push(uri);
    }
    if (toClose.length === 0) return;
    await this.proxy.didCloseMany(toClose);
  }

  /**
   * Request completion at `position` for `uri`, with `content` as the current
   * document state. Bundles the didChange notification with the request in one
   * worker roundtrip; degrades to a plain completion request when the worker
   * already has this exact content.
   */
  async completion(
    uri: string,
    content: string,
    position: LspPosition,
  ): Promise<LspCompletionResponse> {
    if (this.content.get(uri) === content) {
      return this.proxy.completion(uri, position);
    }
    const isOpen = this.content.has(uri);
    this.content.set(uri, content);
    const version = ++this.versionCounter;
    return this.proxy.completionWithDoc(
      uri,
      version,
      content,
      position,
      isOpen ? "change" : "open",
    );
  }

  /**
   * Request hover at `position` for `uri`, with `content` as the current
   * document state. Bundles the didChange notification with the request in one
   * worker roundtrip; degrades to a plain hover request when the worker
   * already has this exact content.
   */
  async hover(
    uri: string,
    content: string,
    position: LspPosition,
  ): Promise<LspHover | null> {
    if (this.content.get(uri) === content) {
      return this.proxy.hover(uri, position);
    }
    const isOpen = this.content.has(uri);
    this.content.set(uri, content);
    const version = ++this.versionCounter;
    return this.proxy.hoverWithDoc(
      uri,
      version,
      content,
      position,
      isOpen ? "change" : "open",
    );
  }

  destroy(): void {
    this.proxy[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
