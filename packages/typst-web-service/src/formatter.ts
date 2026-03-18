export interface FormatConfig {
  /** Number of spaces per indentation level. Default: 2 */
  tab_spaces?: number;
  /** Maximum line width. Default: 80 */
  max_width?: number;
  /** Maximum consecutive blank lines allowed. */
  blank_lines_upper_bound?: number;
  /** Collapse consecutive whitespace in markup to a single space. */
  collapse_markup_spaces?: boolean;
  /** Sort import items alphabetically. */
  reorder_import_items?: boolean;
  /** Wrap text in markup to fit within max_width. Implies collapse_markup_spaces. */
  wrap_text?: boolean;
}

export interface FormatRangeResult {
  /** Start index (UTF-16) of the actual formatted range. */
  start: number;
  /** End index (UTF-16) of the actual formatted range. */
  end: number;
  /** The formatted text for the range. */
  text: string;
}

type TypstyleModule = typeof import("@typstyle/typstyle-wasm-bundler");

let typstylePromise: Promise<TypstyleModule> | null = null;

function getTypstyle(): Promise<TypstyleModule> {
  if (!typstylePromise) {
    typstylePromise = import("@typstyle/typstyle-wasm-bundler").catch((err) => {
      // Reset so subsequent calls can retry
      typstylePromise = null;
      throw err;
    });
  }
  return typstylePromise;
}

/**
 * Typst code formatter powered by typstyle.
 *
 * Runs on the main thread — typstyle is lightweight and fast.
 * The WASM module is loaded lazily on first format call.
 *
 *   const formatter = new TypstFormatter({ tab_spaces: 2, max_width: 80 });
 *   const formatted = await formatter.format(source);
 */
export class TypstFormatter {
  private config: FormatConfig;

  constructor(config: FormatConfig = {}) {
    this.config = config;
    // Eagerly start loading WASM so it's ready by first use.
    // Swallow preload errors — they'll surface on first format() call.
    getTypstyle().catch(() => {});
  }

  /** Format an entire Typst source string. */
  async format(source: string): Promise<string> {
    const typstyle = await getTypstyle();
    return typstyle.format(source, this.config);
  }

  /** Format a range within a Typst source string. Indices are UTF-16 code units. */
  async formatRange(
    source: string,
    start: number,
    end: number,
  ): Promise<FormatRangeResult> {
    const typstyle = await getTypstyle();
    const result = typstyle.format_range(source, start, end, this.config);
    return { start: result.start, end: result.end, text: result.text };
  }
}
