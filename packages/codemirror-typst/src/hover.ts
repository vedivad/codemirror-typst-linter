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

/**
 * Simple markdown-to-HTML converter for hover tooltips.
 * Handles: code blocks, inline code, headers, bold, italic, horizontal rules, paragraphs.
 */
function renderMarkdown(md: string, highlightCode?: (code: string, language: string) => string): string {
  const lines = md.split("\n");
  const htmlParts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join("\n");
      if (highlightCode && lang) {
        htmlParts.push(highlightCode(code, lang));
      } else {
        htmlParts.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      htmlParts.push("<hr>");
      i++;
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      htmlParts.push(`<h${level}>${inlineMarkdown(headerMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("```") && !lines[i].startsWith("#") && !/^---+\s*$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    htmlParts.push(`<p>${inlineMarkdown(paraLines.join("\n"))}</p>`);
  }

  return htmlParts.join("");
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      dom.innerHTML = renderMarkdown(text, highlightCode);
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
      return lspHoverToCM(view.state, pos, result, options.highlightCode);
    } catch {
      return null;
    }
  });
}
