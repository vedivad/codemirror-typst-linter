/** Minimal interface for the built TypstRenderer instance. */
export interface RendererInstance {
  free(): void;
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

type RendererWasmModule = typeof import("@myriaddreamin/typst-ts-renderer");

declare const __TYPST_TS_RENDERER_VERSION__: string;

const DEFAULT_RENDERER_WASM_URL =
  `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@${__TYPST_TS_RENDERER_VERSION__}/pkg/typst_ts_renderer_bg.wasm`;

let rendererModulePromise: Promise<RendererWasmModule> | null = null;

function getRendererModule(): Promise<RendererWasmModule> {
  if (!rendererModulePromise) {
    rendererModulePromise = import("@myriaddreamin/typst-ts-renderer").catch(
      (err) => {
        rendererModulePromise = null;
        throw err;
      },
    );
  }
  return rendererModulePromise;
}

export interface TypstRendererOptions {
  /** URL to the typst-ts-renderer WASM binary. Defaults to jsDelivr CDN. */
  wasmUrl?: string;
}

export interface RenderedSvgPage {
  /** Zero-based page index within the document. */
  index: number;
  /** Page width in typographic points. */
  width: number;
  /** Page height in typographic points. */
  height: number;
  /** Standalone SVG string for just this page. */
  svg: string;
}

/**
 * Converts Typst vector artifacts to SVG strings.
 *
 * The renderer WASM module is loaded lazily on first use.
 *
 *   const renderer = TypstRenderer.create();
 *   const svg = await renderer.renderSvg(vector);
 */
export class TypstRenderer {
  private wasmUrl: string;
  private instance: Promise<RendererInstance> | null = null;

  private constructor(options: TypstRendererOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? DEFAULT_RENDERER_WASM_URL;
    // Eagerly start loading the WASM module so it's ready by first use.
    getRendererModule().catch(() => {});
  }

  static create(options: TypstRendererOptions = {}): TypstRenderer {
    return new TypstRenderer(options);
  }

  private getInstance(): Promise<RendererInstance> {
    if (!this.instance) {
      this.instance = this.#init().catch((err) => {
        this.instance = null;
        throw err;
      });
    }
    return this.instance;
  }

  async #init(): Promise<RendererInstance> {
    const mod = await getRendererModule();
    await mod.default({ module_or_path: this.wasmUrl });
    return new mod.TypstRendererBuilder().build();
  }

  /** Free the underlying WASM renderer instance. */
  async destroy(): Promise<void> {
    const instance = this.instance;
    this.instance = null;
    if (instance) {
      (await instance).free();
    }
  }

  /** Render a Typst vector artifact to an SVG string. */
  async renderSvg(vector: Uint8Array): Promise<string> {
    const renderer = await this.getInstance();
    const session = renderer.create_session();
    try {
      renderer.manipulate_data(session, "reset", vector);
      return renderer.svg_data(session);
    } finally {
      session.free();
    }
  }

  /**
   * Render a Typst vector artifact into one self-contained SVG string per
   * physical page. The merged SVG is split by `<g class="typst-page">`
   * children; each group's `data-page-width` / `data-page-height` give the
   * page-local viewBox. Shared `<defs>` / `<style>` are duplicated into each
   * page so the output SVGs render independently. Returns an empty array if
   * the document has no page groups.
   */
  async renderSvgPages(vector: Uint8Array): Promise<RenderedSvgPage[]> {
    return splitMergedSvgPages(await this.renderSvg(vector));
  }
}

// Parsing must use "text/html", not "image/svg+xml": Typst's merged SVG
// output has repeatedly failed XML-strict parsing. HTML mode tolerates it
// and still produces real SVGSVGElement nodes for inline SVG.
function splitMergedSvgPages(svg: string): RenderedSvgPage[] {
  const doc = new DOMParser().parseFromString(svg, "text/html");
  const root = doc.querySelector("svg");
  if (!root) return [];

  const children = Array.from(root.children);
  const pageGroups = children.filter(
    (el) =>
      el.tagName.toLowerCase() === "g" && el.classList.contains("typst-page"),
  );
  if (pageGroups.length === 0) return [];

  const sharedHtml = children
    .filter((el) => !el.classList.contains("typst-page"))
    .map((el) => el.outerHTML)
    .join("");

  const namespaceAttrs = Array.from(root.attributes)
    .filter((attr) => attr.name === "xmlns" || attr.name.startsWith("xmlns:"))
    .map((attr) => `${attr.name}="${attr.value}"`)
    .join(" ");

  return pageGroups.flatMap((group, index) => {
    const width = Number(group.getAttribute("data-page-width")) || 0;
    const height = Number(group.getAttribute("data-page-height")) || 0;
    if (width <= 0 || height <= 0) return [];

    const clone = group.cloneNode(true) as Element;
    clone.removeAttribute("transform");

    return [
      {
        index,
        width,
        height,
        svg:
          `<svg ${namespaceAttrs} viewBox="0 0 ${width} ${height}" ` +
          `width="${width}" height="${height}">` +
          `${sharedHtml}${clone.outerHTML}</svg>`,
      },
    ];
  });
}
