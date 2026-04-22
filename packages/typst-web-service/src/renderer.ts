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

const DEFAULT_RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@0.7.0-rc2/pkg/typst_ts_renderer_bg.wasm";

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
  index: number;
  width: number;
  height: number;
  svg: string;
}

const SVG_SIZING_ATTRS = new Set([
  "width",
  "height",
  "viewBox",
  "data-width",
  "data-height",
]);

function requireSvgDomApi<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`TypstRenderer.${name} requires browser SVG DOM APIs`);
  }
  return value;
}

function readLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasClass(element: Element, className: string): boolean {
  const classAttr = element.getAttribute("class");
  if (!classAttr) return false;
  return classAttr.split(/\s+/).includes(className);
}

interface ParsedSvgDocument {
  root: SVGSVGElement;
  width: number;
  height: number;
}

function readSvgDimensions(root: SVGSVGElement): { width: number; height: number } {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  return {
    width:
      readLength(root.getAttribute("data-width")) ??
      readLength(root.getAttribute("width")) ??
      (viewBox && viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : 0),
    height:
      readLength(root.getAttribute("data-height")) ??
      readLength(root.getAttribute("height")) ??
      (viewBox && viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : 0),
  };
}

function parseSvgDocument(svg: string): ParsedSvgDocument | null {
  const DOMParserCtor = requireSvgDomApi(globalThis.DOMParser, "renderSvgPages");
  const parser = new DOMParserCtor();
  const doc = parser.parseFromString(svg, "text/html");
  const root = doc.querySelector("svg");
  if (!(root instanceof SVGSVGElement)) return null;

  const { width, height } = readSvgDimensions(root);
  if (width <= 0 || height <= 0) return null;

  return { root, width, height };
}

function readPageOffset(group: Element): number {
  const transform = group.getAttribute("transform");
  const match = transform?.match(
    /translate\(\s*-?\d*\.?\d+(?:e[+-]?\d+)?[\s,]+(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*\)/i,
  );
  return match ? Number.parseFloat(match[1]) : 0;
}

function splitSvgPages(svg: string): RenderedSvgPage[] {
  const parsed = parseSvgDocument(svg);
  if (!parsed) return [];

  const { root, width: rootWidth, height: rootHeight } = parsed;
  // Typst's merged SVG output wraps each physical page in a top-level
  // `<g class="typst-page">...</g>` translated to its page offset.
  const pageGroups = Array.from(root.children).filter(
    (child) => child.tagName.toLowerCase() === "g" && hasClass(child, "typst-page"),
  );
  if (pageGroups.length <= 1) return [];

  const shared = Array.from(root.children)
    .filter((child) => !pageGroups.includes(child))
    .map((child) => child.outerHTML)
    .join("");

  const attrs = Array.from(root.attributes)
    .filter((attr) => !SVG_SIZING_ATTRS.has(attr.name))
    .map((attr) => `${attr.name}="${attr.value}"`)
    .join(" ");

  return pageGroups.flatMap((pageGroup, index) => {
    const width = readLength(pageGroup.getAttribute("data-page-width")) ?? rootWidth;
    const height =
      readLength(pageGroup.getAttribute("data-page-height")) ??
      (() => {
        const currentY = readPageOffset(pageGroup);
        const next = pageGroups[index + 1];
        if (!next) return rootHeight - currentY;
        const nextY = readPageOffset(next) || rootHeight;
        return nextY - currentY;
      })();

    if (width <= 0 || height <= 0) return [];

    const clone = pageGroup.cloneNode(true) as Element;
    clone.removeAttribute("transform");

    return [
      {
        index,
        width,
        height,
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
          `data-width="${width}" data-height="${height}" viewBox="0 0 ${width} ${height}" ${attrs}>` +
          `${shared}${clone.outerHTML}</svg>`,
      },
    ];
  });
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
   * Render a Typst vector artifact into per-page SVG strings when the merged
   * SVG preserves page grouping. Falls back to a single page when splitting
   * isn't possible.
   */
  async renderSvgPages(vector: Uint8Array): Promise<RenderedSvgPage[]> {
    const svg = await this.renderSvg(vector);
    const pages = splitSvgPages(svg);
    if (pages.length > 0) {
      return pages;
    }

    const parsed = parseSvgDocument(svg);
    return [
      {
        index: 0,
        width: parsed?.width ?? 0,
        height: parsed?.height ?? 0,
        svg,
      },
    ];
  }
}
