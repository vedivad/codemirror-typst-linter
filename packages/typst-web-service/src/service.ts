import { createWorker, workerRpc } from "./rpc.js";
import type { DiagnosticMessage } from "./types.js";

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
  manipulate_data(
    session: RendererSession,
    action: string,
    data: Uint8Array,
  ): void;
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
  /** Debounce delay (ms) for auto-compilation after setFile(). Default: 150. */
  compileDelay?: number;
}

type DiagnosticListener = (diagnostics: DiagnosticMessage[]) => void;

const DEFAULT_FONTS = [
  "https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-regular-webfont.ttf",
];

const DEFAULT_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm";

const DEFAULT_RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@0.7.0-rc2/pkg/typst_ts_renderer_bg.wasm";

const TIMEOUT = { INIT: 60_000, RENDER: 60_000, DESTROY: 5_000 } as const;

/**
 * Manages a Typst compiler worker and project file state.
 *
 * Use `setFile` / `deleteFile` to update project files. The service
 * auto-recompiles (debounced) and dispatches diagnostics to subscribers.
 *
 * Subscribe to per-file diagnostics with `onDiagnostics(path, callback)`.
 */
export class TypstService {
  readonly ready: Promise<void>;
  /** Resolves when the SVG renderer is ready, or rejects if it failed to initialize. Undefined if no renderer was configured. */
  readonly rendererReady?: Promise<void>;
  private idCounter = 0;

  private onSvgCallback?: (svg: string) => void;
  private rendererInstance?: Promise<RendererInstance>;

  /** The most recent vector artifact from a compile, if any. */
  lastVector?: Uint8Array;

  // --- File store ---
  private files = new Map<string, string>();
  private listeners = new Map<string, Set<DiagnosticListener>>();
  private compileTimer: ReturnType<typeof setTimeout> | null = null;
  private compileDelay: number;

  constructor(
    private worker: Worker,
    options: TypstServiceOptions = {},
  ) {
    this.onSvgCallback = options.renderer?.onSvg;
    this.compileDelay = options.compileDelay ?? 150;

    if (options.renderer) {
      this.rendererInstance = this.#initRenderer(
        options.renderer.module,
        options.renderer.wasmUrl,
      );
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
      TIMEOUT.INIT,
    ).then((res) => {
      if (res.type === "error")
        throw new Error(`TypstService init failed: ${res.message}`);
    });
  }

  // --- File management ---

  /** Update or add a file. Triggers a debounced auto-compile. */
  setFile(path: string, content: string): void {
    if (this.files.get(path) === content) return;
    this.files.set(path, content);
    this.#scheduleCompile();
  }

  /** Remove a file. Triggers a debounced auto-compile. */
  deleteFile(path: string): void {
    if (!this.files.has(path)) return;
    this.files.delete(path);
    this.#scheduleCompile();
  }

  /** Get content of a stored file. */
  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /** Snapshot of all stored files. */
  getFiles(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  // --- Diagnostic subscriptions ---

  /** Subscribe to diagnostics for a file path. Returns an unsubscribe function. */
  onDiagnostics(path: string, callback: DiagnosticListener): () => void {
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
    }
    set.add(callback);
    return () => set.delete(callback);
  }

  #dispatchDiagnostics(diagnostics: DiagnosticMessage[]): void {
    // Group diagnostics by path
    const byPath = new Map<string, DiagnosticMessage[]>();
    for (const d of diagnostics) {
      let arr = byPath.get(d.path);
      if (!arr) {
        arr = [];
        byPath.set(d.path, arr);
      }
      arr.push(d);
    }

    // Notify all subscribers — send [] for files with no diagnostics
    for (const [path, set] of this.listeners) {
      const diags = byPath.get(path) ?? [];
      for (const cb of set) cb(diags);
    }
  }

  // --- Auto-compilation ---

  #scheduleCompile(): void {
    if (this.compileTimer) clearTimeout(this.compileTimer);
    this.compileTimer = setTimeout(
      () => this.#autoCompile(),
      this.compileDelay,
    );
  }

  async #autoCompile(): Promise<void> {
    try {
      const result = await this.compile();
      this.#dispatchDiagnostics(result.diagnostics);
    } catch {
      // compile errors (timeouts, worker crashes) are not dispatched
    }
  }

  // --- Compilation ---

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

  /**
   * Compile stored files (no args) or a one-off source/file map.
   * When called without arguments, uses the file store and dispatches diagnostics to subscribers.
   */
  async compile(
    source?: string | Record<string, string>,
  ): Promise<CompileResult> {
    await this.ready;
    const id = ++this.idCounter;
    const files =
      source === undefined
        ? this.getFiles()
        : typeof source === "string"
          ? { "/main.typ": source }
          : source;
    const response = await workerRpc(this.worker, {
      type: "compile",
      id,
      files,
    });
    if (response.type === "cancelled") return { diagnostics: [] };
    if (response.type === "result") {
      const vector = response.vector
        ? new Uint8Array(response.vector)
        : undefined;
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
    if (!this.onSvgCallback || !this.rendererInstance) return;
    try {
      const renderer = await this.rendererInstance;
      this.onSvgCallback(this.#vectorToSvg(renderer, vector));
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

  /** Render stored files (no args) or a one-off source/file map to PDF. */
  async renderPdf(
    source?: string | Record<string, string>,
  ): Promise<Uint8Array> {
    await this.ready;
    const id = ++this.idCounter;
    const files =
      source === undefined
        ? this.getFiles()
        : typeof source === "string"
          ? { "/main.typ": source }
          : source;
    const response = await workerRpc(
      this.worker,
      { type: "render", id, files },
      TIMEOUT.RENDER,
    );
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
    if (this.compileTimer) clearTimeout(this.compileTimer);
    const id = ++this.idCounter;
    workerRpc(this.worker, { type: "destroy", id }, TIMEOUT.DESTROY)
      .catch((err) => console.error("TypstService destroy failed:", err))
      .finally(() => this.worker.terminate());
  }
}
