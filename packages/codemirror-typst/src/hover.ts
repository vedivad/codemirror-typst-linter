import type { EditorState } from "@codemirror/state";
import { type Tooltip, hoverTooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { AnalyzerSession } from "@vedivad/typst-web-service";

export interface TypstHoverOptions {
  session: AnalyzerSession;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
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
      dom.style.cssText = "max-width: 500px; white-space: pre-wrap; font-size: 0.9em; padding: 4px 8px;";

      // Render code blocks simply
      const rendered = text
        .replace(/```[\s\S]*?```/g, (block) => {
          const code = block.replace(/```\w*\n?/, "").replace(/\n?```$/, "");
          return code;
        })
        .replace(/`([^`]+)`/g, "$1");

      dom.textContent = rendered;
      return { dom };
    },
  };
}

/**
 * Create a CM6 hover tooltip extension backed by a tinymist AnalyzerSession.
 */
export function createTypstHover(options: TypstHoverOptions): Extension {
  const path = options.filePath ?? "/main.typ";

  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
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
      return lspHoverToCM(view.state, pos, result);
    } catch {
      return null;
    }
  });
}
