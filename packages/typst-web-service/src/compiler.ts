import * as Comlink from "comlink";
import { createWorker } from "./rpc.js";
import type { DiagnosticMessage } from "./types.js";
import type { CompilerWorker } from "./compiler-worker.js";

declare const __TYPST_TS_WEB_COMPILER_VERSION__: string;

export interface CompileResult {
  diagnostics: DiagnosticMessage[];
  /** Vector artifact bytes from the compiler, usable with TypstRenderer for SVG rendering. */
  vector?: Uint8Array;
}

export interface TypstCompilerOptions {
  /**
   * Explicit Worker instance. When omitted, an inlined blob worker is created automatically.
   * Use this for Vite apps to get proper source maps:
   *   `await TypstCompiler.create({ worker: new Worker(new URL('typst-web-service/compiler-worker', import.meta.url)) })`
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

const defaultWasmUrl = () =>
  `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@${__TYPST_TS_WEB_COMPILER_VERSION__}/pkg/typst_ts_web_compiler_bg.wasm`;

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
  private readonly proxy: Comlink.Remote<CompilerWorker>;
  private readonly worker: Worker;
  private readonly encoder = new TextEncoder();
  /** Last text content pushed per path. Drives own-RPC dedup. Invalidated by binary writes. */
  private readonly content = new Map<string, string>();

  private constructor(worker: Worker, proxy: Comlink.Remote<CompilerWorker>) {
    this.worker = worker;
    this.proxy = proxy;
  }

  static async create(
    options: TypstCompilerOptions = {},
  ): Promise<TypstCompiler> {
    const worker = options.worker ?? createWorker();
    const proxy = Comlink.wrap<CompilerWorker>(worker);

    await proxy.init(
      options.wasmUrl ?? defaultWasmUrl(),
      options.fonts ?? DEFAULT_FONTS,
      options.packages ?? true,
    );

    return new TypstCompiler(worker, proxy);
  }

  /**
   * Compile whatever is currently in the VFS (populated via
   * setText/setBinary/setJson/setMany). Defaults to compiling "/main.typ";
   * override with `entry`.
   */
  compile(entry?: string): Promise<CompileResult> {
    return this.proxy.compile(entry);
  }

  /**
   * Compile to PDF. Operates on whatever is currently in the VFS (populated
   * via setText/setBinary/setJson/setMany). Defaults to compiling "/main.typ";
   * override with `entry`.
   */
  compilePdf(entry?: string): Promise<Uint8Array> {
    return this.proxy.compilePdf(entry);
  }

  /**
   * Add or overwrite a text file in the virtual compiler filesystem. Skips
   * the worker RPC when `source` matches the last value pushed for `path`.
   */
  async setText(path: string, source: string): Promise<void> {
    if (this.content.get(path) === source) return;
    await this.proxy.mapShadow(path, this.encoder.encode(source));
    this.content.set(path, source);
  }

  /** Add or overwrite a JSON file in the virtual compiler filesystem. */
  setJson(
    path: string,
    value: unknown,
    replacer?: (this: unknown, key: string, value: unknown) => unknown,
    space?: string | number,
  ): Promise<void> {
    return this.setText(path, JSON.stringify(value, replacer, space));
  }

  /**
   * Add or overwrite multiple files in the virtual compiler filesystem in a
   * single worker roundtrip. Strings are UTF-8 encoded; Uint8Arrays are
   * passed through. Text entries unchanged since their last push are skipped;
   * binary entries always push and invalidate the text cache for their path.
   */
  async setMany(files: Record<string, string | Uint8Array>): Promise<void> {
    const encoded: Record<string, Uint8Array> = {};
    const textUpdates: Array<[string, string]> = [];
    const binaryInvalidations: string[] = [];
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === "string") {
        if (this.content.get(path) === content) continue;
        textUpdates.push([path, content]);
        encoded[path] = this.encoder.encode(content);
      } else {
        binaryInvalidations.push(path);
        encoded[path] = content;
      }
    }
    if (Object.keys(encoded).length === 0) return;
    await this.proxy.mapShadowMany(encoded);
    for (const [path, content] of textUpdates) this.content.set(path, content);
    for (const path of binaryInvalidations) this.content.delete(path);
  }

  /** Add or overwrite a binary file in the virtual compiler filesystem. */
  async setBinary(
    path: string,
    content: ArrayBuffer | ArrayBufferView,
  ): Promise<void> {
    const bytes =
      content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(
            content.buffer,
            content.byteOffset,
            content.byteLength,
          );
    await this.proxy.mapShadow(path, bytes);
    this.content.delete(path);
  }

  /** Remove a file from the virtual compiler filesystem. */
  async remove(path: string): Promise<void> {
    await this.proxy.unmapShadow(path);
    this.content.delete(path);
  }

  /** Clear all virtual files from the compiler filesystem. */
  async clear(): Promise<void> {
    await this.proxy.resetShadow();
    this.content.clear();
  }

  destroy(): void {
    this.proxy[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
