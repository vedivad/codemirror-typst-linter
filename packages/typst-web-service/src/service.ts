import type { DiagnosticMessage } from "./types.js";
import { createWorker, workerRpc } from "./rpc.js";

export interface CompileResult {
  diagnostics: DiagnosticMessage[];
  /** Vector artifact bytes from the compiler, usable with typst-ts-renderer for SVG rendering. */
  vector?: Uint8Array;
}

/**
 * A dynamic `import()` expression that resolves to the `@myriaddreamin/typst-ts-renderer` module.
 * Keeps the renderer dependency opt-in — users who only need diagnostics never load the WASM.
 */
export type RendererModule = () => Promise<{
  default: (wasmUrl?: string) => Promise<unknown>;
  TypstRendererBuilder: new () => {
    build(): Promise<RendererInstance>;
  };
}>;

/** Minimal interface for the built TypstRenderer. */
export interface RendererInstance {
  create_session(): RendererSession;
  manipulate_data(session: RendererSession, action: string, data: Uint8Array): void;
  svg_data(session: RendererSession): string;
}

/** Minimal interface for a TypstRenderer session. */
export interface RendererSession {
  free(): void;
}

/** Options for the opt-in SVG renderer. */
export interface RendererOptions {
  /**
   * Dynamic import for the renderer module.
   * Example: () => import('@myriaddreamin/typst-ts-renderer')
   */
  module: RendererModule;
  /** URL to the typst-ts-renderer WASM binary. Defaults to jsDelivr CDN. */
  wasmUrl?: string;
  /** Called after each compile with the rendered SVG string. */
  onSvg: (svg: string) => void;
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
  /**
   * Opt-in SVG preview. When set, the renderer is initialized lazily and `onSvg`
   * is called after each successful compile.
   *
   * Example:
   *   renderer: {
   *     module: () => import('@myriaddreamin/typst-ts-renderer'),
   *     onSvg: (svg) => { previewEl.innerHTML = svg },
   *   }
   */
  renderer?: RendererOptions;
}

const DEFAULT_FONTS = [
  "https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-regular-webfont.ttf",
];

const DEFAULT_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm";

const DEFAULT_RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@0.7.0-rc2/pkg/typst_ts_renderer_bg.wasm";

/**
 * Manages a Typst compiler worker. Create one instance and share it across
 * all extensions (linter, autocomplete, preview, etc.).
 *
 * Prefer constructing with an explicit Worker for Vite apps:
 *   new TypstService(new Worker(new URL('typst-web-service/worker', import.meta.url)), options)
 *
 * Or use createTypstService() for a zero-config setup via an inlined blob worker.
 */
export class TypstService {
  readonly ready: Promise<void>;
  /** Resolves when the SVG renderer is ready, or rejects if it failed to initialize. Undefined if no renderer was configured. */
  readonly rendererReady?: Promise<void>;
  private idCounter = 0;

  private onSvg?: (svg: string) => void;
  private rendererInstance?: Promise<RendererInstance>;

  /** The most recent vector artifact from a compile, if any. */
  lastVector?: Uint8Array;

  constructor(
    private worker: Worker,
    options: TypstServiceOptions = {},
  ) {
    this.onSvg = options.renderer?.onSvg;

    if (options.renderer) {
      this.rendererInstance = this.#initRenderer(options.renderer.module, options.renderer.wasmUrl);
      this.rendererReady = this.rendererInstance.then(() => {});
    }

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

  async #initRenderer(
    loadModule: RendererModule,
    wasmUrl?: string,
  ): Promise<RendererInstance> {
    const mod = await loadModule();
    await mod.default(wasmUrl ?? DEFAULT_RENDERER_WASM_URL);
    return new mod.TypstRendererBuilder().build();
  }

  #vectorToSvg(renderer: RendererInstance, vector: Uint8Array): string {
    const session = renderer.create_session();
    try {
      renderer.manipulate_data(session, "reset", vector);
      return renderer.svg_data(session);
    } finally {
      session.free();
    }
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
      const vector = response.vector ? new Uint8Array(response.vector) : undefined;
      if (vector) {
        this.lastVector = vector;
        this.#emitSvg(vector);
      }
      return { diagnostics: response.diagnostics, vector };
    }
    if (response.type === "error") throw new Error(response.message);
    return { diagnostics: [] };
  }

  async #emitSvg(vector: Uint8Array): Promise<void> {
    if (!this.onSvg || !this.rendererInstance) return;
    try {
      const renderer = await this.rendererInstance;
      this.onSvg(this.#vectorToSvg(renderer, vector));
    } catch {
      // renderer init failed; observable via rendererReady
    }
  }

  /**
   * Render a vector artifact to an SVG string.
   * Requires the `renderer` option to be set. Returns null if the renderer is unavailable.
   */
  async renderSvg(vector: Uint8Array): Promise<string | null> {
    if (!this.rendererInstance) return null;
    const renderer = await this.rendererInstance;
    return this.#vectorToSvg(renderer, vector);
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

  /**
   * Create a TypstService using an inlined worker blob.
   * Works without any bundler configuration.
   *
   * For Vite apps, prefer the explicit Worker constructor to avoid the blob indirection:
   *   new TypstService(new Worker(new URL('typst-web-service/worker', import.meta.url)), options)
   */
  static create(options: TypstServiceOptions = {}): TypstService {
    return new TypstService(createWorker(), options);
  }

  destroy(): void {
    const id = ++this.idCounter;
    workerRpc(this.worker, { type: "destroy", id }, 5_000)
      .catch((err) => console.error("TypstService destroy failed:", err))
      .finally(() => this.worker.terminate());
  }
}

