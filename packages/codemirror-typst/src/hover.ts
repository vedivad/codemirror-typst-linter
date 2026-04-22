import { forEachDiagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type {
  LspHover,
  LspHoverContents,
  TypstProject,
} from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";
import { renderHoverMarkdown, type CodeHighlighter } from "./hover-markdown.js";

export interface TypstHoverOptions {
  project: TypstProject;
  /** Optional function to syntax-highlight code blocks. Receives code and language, returns HTML string. */
  highlightCode?: CodeHighlighter;
}

function extractHoverText(contents: LspHoverContents): string {
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
  hover: LspHover | null,
  highlightCode?: CodeHighlighter,
): Tooltip | null {
  if (!hover?.contents) return null;

  const text = extractHoverText(hover.contents);
  if (!text.trim()) return null;

  let from = pos;
  let to = pos;
  if (hover.range) {
    const startLine = state.doc.line(hover.range.start.line + 1);
    const endLine = state.doc.line(hover.range.end.line + 1);
    from = startLine.from + hover.range.start.character;
    to = endLine.from + hover.range.end.character;
  }

  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-typst-hover";
      dom.innerHTML = renderHoverMarkdown(text, highlightCode);
      dom.style.maxHeight = "26rem";
      dom.style.overflow = "auto";
      return { dom };
    },
  };
}

/**
 * Create a CM6 hover tooltip extension backed by a TypstProject. The editor's
 * current content is attached to the hover request in a single analyzer
 * roundtrip, so the analyzer sees the latest buffer state without an extra RTT.
 */
export function createTypstHover(options: TypstHoverOptions): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    // If a lint diagnostic covers this position, let the lint tooltip handle it.
    let hasDiagnostic = false;
    forEachDiagnostic(view.state, (_d, from, to) => {
      if (pos >= from && pos <= to) hasDiagnostic = true;
    });
    if (hasDiagnostic) return null;

    const path = view.state.facet(typstFilePath);
    const source = view.state.doc.toString();

    const line = view.state.doc.lineAt(pos);
    const position = { line: line.number - 1, character: pos - line.from };

    try {
      const result = await options.project.hover(path, source, position);
      if (!result) return null;
      return lspHoverToCM(view.state, pos, result, options.highlightCode);
    } catch (err) {
      console.debug("[typst] hover request failed", {
        path,
        position,
        error: err,
      });
      return null;
    }
  });
}
