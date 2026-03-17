import type { DiagnosticMessage } from "./types.js";
import { createWorker, workerRpc } from "./rpc.js";

export interface CompileResult {
  diagnostics: DiagnosticMessage[];
  /** Vector artifact bytes from the compiler, usable with typst-ts-renderer for SVG rendering. */
  vector?: Uint8Array;
}

export interface TypstServiceOptions {
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

/**
 * Manages a Typst compiler worker. Create one instance and share it across
 * all extensions (linter, autocomplete, preview, etc.).
 *
 * Prefer constructing with an explicit Worker for Vite apps:
 *   new TypstService(new Worker(new URL('codemirror-typst-linter/worker', import.meta.url)), options)
 *
 * Or use createTypstService() for a zero-config setup via an inlined blob worker.
 */
export class TypstService {
  readonly ready: Promise<void>;
  private idCounter = 0;

  constructor(
    private worker: Worker,
    options: TypstServiceOptions = {},
  ) {
    this.ready = workerRpc(
      this.worker,
      {
        type: "init",
        id: ++this.idCounter,
        wasmUrl: options.wasmUrl ?? DEFAULT_WASM_URL,
        fonts: options.fonts ?? DEFAULT_FONTS,
        packages: options.packages ?? true,
      },
      60_000,
    ).then((res) => {
      if (res.type === "error")
        throw new Error(`TypstService init failed: ${res.message}`);
    });
  }

  async compile(source: string): Promise<CompileResult> {
    await this.ready;
    const id = ++this.idCounter;
    const response = await workerRpc(this.worker, {
      type: "compile",
      id,
      source,
    });
    if (response.type === "cancelled") return { diagnostics: [] };
    if (response.type === "result") {
      return {
        diagnostics: response.diagnostics,
        vector: response.vector ? new Uint8Array(response.vector) : undefined,
      };
    }
    if (response.type === "error") throw new Error(response.message);
    return { diagnostics: [] };
  }

  async renderPdf(source: string): Promise<Uint8Array> {
    await this.ready;
    const id = ++this.idCounter;
    const response = await workerRpc(this.worker, { type: "render", id, source }, 60_000);
    if (response.type === "cancelled") throw new Error("Render cancelled");
    if (response.type === "pdf") return new Uint8Array(response.data);
    if (response.type === "error") throw new Error(response.message);
    throw new Error("Unexpected response type");
  }

  destroy(): void {
    const id = ++this.idCounter;
    workerRpc(this.worker, { type: "destroy", id }, 5_000)
      .catch(() => {})
      .finally(() => this.worker.terminate());
  }
}

/**
 * Create a TypstService using an inlined worker blob.
 * Works without any bundler configuration.
 *
 * For Vite apps, the explicit Worker form avoids the blob indirection:
 *   new TypstService(new Worker(new URL('codemirror-typst-linter/worker', import.meta.url)), options)
 */
export function createTypstService(
  options: TypstServiceOptions = {},
): TypstService {
  return new TypstService(createWorker(), options);
}
