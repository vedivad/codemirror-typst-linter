import { createWorker, destroyWorker, workerRpc } from "./rpc.js";
import type {
  DiagnosticMessage,
  WorkerRequest,
  WorkerResponse,
} from "./types.js";

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

const TIMEOUT = { INIT: 60_000, RENDER: 60_000, DESTROY: 5_000 } as const;

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
  private idCounter: number;
  private worker: Worker;

  /** The most recent vector artifact from a compile, if any. */
  lastVector?: Uint8Array;

  private constructor(worker: Worker, idCounter: number) {
    this.worker = worker;
    this.idCounter = idCounter;
  }

  static async create(options: TypstCompilerOptions = {}): Promise<TypstCompiler> {
    const worker = options.worker ?? createWorker();
    let idCounter = 0;

    const res = await workerRpc<WorkerRequest, WorkerResponse>(
      worker,
      {
        type: "init",
        id: ++idCounter,
        wasmUrl: options.wasmUrl ?? DEFAULT_WASM_URL,
        fonts: options.fonts ?? DEFAULT_FONTS,
        packages: options.packages ?? true,
      },
      TIMEOUT.INIT,
    );
    if (res.type === "error")
      throw new Error(`TypstCompiler init failed: ${res.message}`);

    return new TypstCompiler(worker, idCounter);
  }

  /** Compile a single source string (treated as /main.typ) or a map of files. */
  async compile(
    source: string | Record<string, string>,
  ): Promise<CompileResult> {
    const id = ++this.idCounter;
    const files = toFiles(source);
    const response = await workerRpc<WorkerRequest, WorkerResponse>(
      this.worker,
      {
        type: "compile",
        id,
        files,
      },
    );
    if (response.type === "cancelled") return { diagnostics: [] };
    if (response.type === "result") {
      const vector = response.vector
        ? new Uint8Array(response.vector)
        : undefined;
      if (vector) this.lastVector = vector;
      return { diagnostics: response.diagnostics, vector };
    }
    if (response.type === "error") throw new Error(response.message);
    return { diagnostics: [] };
  }

  /** Compile to PDF from a single source string (treated as /main.typ) or a map of files. */
  async compilePdf(
    source: string | Record<string, string>,
  ): Promise<Uint8Array> {
    const id = ++this.idCounter;
    const files = toFiles(source);
    const response = await workerRpc<WorkerRequest, WorkerResponse>(
      this.worker,
      { type: "render", id, files },
      TIMEOUT.RENDER,
    );
    if (response.type === "cancelled") throw new Error("Render cancelled");
    if (response.type === "pdf") return new Uint8Array(response.data);
    if (response.type === "error") throw new Error(response.message);
    throw new Error("Unexpected response type");
  }

  destroy(): void {
    const id = ++this.idCounter;
    destroyWorker(
      this.worker,
      { type: "destroy" as const, id },
      TIMEOUT.DESTROY,
      "TypstCompiler",
    );
  }
}
