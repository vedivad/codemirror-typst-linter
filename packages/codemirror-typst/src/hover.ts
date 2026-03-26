import { forEachDiagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { AnalyzerSession } from "@vedivad/typst-web-service";
import { renderHoverMarkdown } from "./hover-markdown.js";

export interface TypstHoverOptions {
  session: AnalyzerSession;
  /** File path this editor represents, or a getter for dynamic paths. Default: "/main.typ" */
  filePath?: string | (() => string);
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Optional function to syntax-highlight code blocks. Receives code and language, returns HTML string. */
  highlightCode?: (code: string, language: string) => string;
}

interface LspHoverResult {
  contents:
  | string
  | { kind: string; value: string }
  | (string | { language: string; value: string })[];
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

function extractHoverText(contents: LspHoverResult["contents"]): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n\n");
  }
  return contents.value;
}

function lspHoverToCM(
  state: EditorState,
  pos: number,
  result: unknown,
  highlightCode?: (code: string, language: string) => string,
): Tooltip | null {
  const hover = result as LspHoverResult | null;
  if (!hover?.contents) return null;

  const text = extractHoverText(hover.contents);
  if (!text.trim()) return null;

  let from = pos;
  if (hover.range) {
    const line = state.doc.line(hover.range.start.line + 1);
    from = line.from + hover.range.start.character;
  }

  return {
    pos: from,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-typst-hover";
      dom.innerHTML = renderHoverMarkdown(text, highlightCode);
      return { dom };
    },
  };
}

/**
 * Create a CM6 hover tooltip extension backed by a tinymist AnalyzerSession.
 */
export function createTypstHover(options: TypstHoverOptions): Extension {
  const fp = options.filePath;
  const getPath: () => string =
    typeof fp === "function" ? fp : () => fp ?? "/main.typ";

  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    // If a lint diagnostic covers this position, let the lint tooltip handle it.
    let hasDiagnostic = false;
    forEachDiagnostic(view.state, (d, from, to) => {
      if (pos >= from && pos <= to) hasDiagnostic = true;
    });
    if (hasDiagnostic) return null;

    const path = getPath();
    const source = view.state.doc.toString();
    const files = { ...options.getFiles?.(), [path]: source };

    const line = view.state.doc.lineAt(pos);
    const lspLine = line.number - 1;
    const lspChar = pos - line.from;

    try {
      const result = await options.session.hover(
        path,
        source,
        files,
        lspLine,
        lspChar,
      );
      if (!result) return null;
      return lspHoverToCM(view.state, pos, result, options.highlightCode);
    } catch {
      return null;
    }
  });
}
