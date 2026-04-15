import * as Comlink from "comlink";
import { createWorker } from "./rpc.js";
import type { DiagnosticMessage } from "./types.js";

interface CompilerWorkerAPI {
  init(wasmUrl: string, fontUrls: string[], packages: boolean): Promise<void>;
  compile(
    files: Record<string, string>,
  ): Promise<{ diagnostics: DiagnosticMessage[]; vector?: Uint8Array }>;
  compilePdf(files: Record<string, string>): Promise<Uint8Array>;
  addSource(path: string, source: string): void;
  mapShadow(path: string, content: Uint8Array): void;
  unmapShadow(path: string): void;
  resetShadow(): void;
  destroy(): void;
}

export interface CompileResult {
  diagnostics: DiagnosticMessage[];
  /** Vector artifact bytes from the compiler, usable with TypstRenderer for SVG rendering. */
  vector?: Uint8Array;
}

export interface TypstCompilerOptions {
  /**
   * Explicit Worker instance. When omitted, an inlined blob worker is created automatically.
   * Use this for Vite apps to get proper source maps:
   *   `await TypstCompiler.create({ worker: new Worker(new URL('typst-web-service/worker', import.meta.url)) })`
   */
  worker?: Worker;
  /**
   * URL to the typst-ts-web-compiler WASM binary.
   * Defaults to the matching version on jsDelivr CDN.
   * Override with a local asset URL for offline support or faster load:
   *   `new URL('@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', import.meta.url).href`
   */
  wasmUrl?: string;
  /** Font URLs to load into the Typst compiler. Defaults to Roboto from jsDelivr. */
  fonts?: string[];
  /**
   * Enable fetching @preview/ packages from packages.typst.org on demand.
   * Default: true.
   */
  packages?: boolean;
}

const DEFAULT_FONTS = [
  "https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-regular-webfont.ttf",
];

const DEFAULT_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm";

function toFiles(
  source: string | Record<string, string>,
): Record<string, string> {
  return typeof source === "string" ? { "/main.typ": source } : source;
}

/**
 * Manages a Typst compiler worker. Create one instance and share it across
 * all extensions (linter, autocomplete, preview, etc.).
 *
 *   await TypstCompiler.create()                                   // blob worker, defaults
 *   await TypstCompiler.create({ wasmUrl: '...' })                 // blob worker, custom WASM
 *   await TypstCompiler.create({ worker: myWorker })               // explicit Worker (Vite)
 *   await TypstCompiler.create({ worker: myWorker, fonts: [...] }) // explicit Worker + options
 */
export class TypstCompiler {
  private readonly proxy: Comlink.Remote<CompilerWorkerAPI>;
  private readonly worker: Worker;
  private readonly encoder = new TextEncoder();

  /** The most recent vector artifact from a compile, if any. */
  lastVector?: Uint8Array;

  private constructor(
    worker: Worker,
    proxy: Comlink.Remote<CompilerWorkerAPI>,
  ) {
    this.worker = worker;
    this.proxy = proxy;
  }

  static async create(
    options: TypstCompilerOptions = {},
  ): Promise<TypstCompiler> {
    const worker = options.worker ?? createWorker();
    const proxy = Comlink.wrap<CompilerWorkerAPI>(worker);

    await proxy.init(
      options.wasmUrl ?? DEFAULT_WASM_URL,
      options.fonts ?? DEFAULT_FONTS,
      options.packages ?? true,
    );

    return new TypstCompiler(worker, proxy);
  }

  /** Compile a single source string (treated as /main.typ) or a map of files. */
  async compile(
    source: string | Record<string, string>,
  ): Promise<CompileResult> {
    const result = await this.proxy.compile(toFiles(source));
    if (result.vector) this.lastVector = result.vector;
    return result;
  }

  /** Compile to PDF from a single source string (treated as /main.typ) or a map of files. */
  async compilePdf(
    source: string | Record<string, string>,
  ): Promise<Uint8Array> {
    return this.proxy.compilePdf(toFiles(source));
  }

  /** Add or overwrite a text source file. */
  async addSource(path: string, source: string): Promise<void> {
    await this.proxy.addSource(path, source);
  }

  /** Add or overwrite an in-memory shadow file (text or binary). */
  async mapShadow(path: string, content: Uint8Array): Promise<void> {
    await this.proxy.mapShadow(path, content);
  }

  /** Remove an in-memory shadow file by path. */
  async unmapShadow(path: string): Promise<void> {
    await this.proxy.unmapShadow(path);
  }

  /**
   * Clear all shadow files held by the compiler.
   * Note: this also clears files previously added via addSource in the compiler runtime.
   */
  async resetShadow(): Promise<void> {
    await this.proxy.resetShadow();
  }

  /** Add or overwrite a text file in the virtual compiler filesystem. */
  async setText(path: string, source: string): Promise<void> {
    await this.mapShadow(path, this.encoder.encode(source));
  }

  /** Add or overwrite a JSON file in the virtual compiler filesystem. */
  async setJson(
    path: string,
    value: unknown,
    replacer?: (this: unknown, key: string, value: unknown) => unknown,
    space?: string | number,
  ): Promise<void> {
    await this.setText(path, JSON.stringify(value, replacer, space));
  }

  /** Add or overwrite a binary file in the virtual compiler filesystem. */
  async setBinary(
    path: string,
    content: ArrayBuffer | ArrayBufferView,
  ): Promise<void> {
    const bytes =
      content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    await this.mapShadow(path, bytes);
  }

  /** Remove a file from the virtual compiler filesystem. */
  async remove(path: string): Promise<void> {
    await this.unmapShadow(path);
  }

  /** Clear all virtual files from the compiler filesystem. */
  async clear(): Promise<void> {
    await this.resetShadow();
  }

  destroy(): void {
    this.proxy[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
