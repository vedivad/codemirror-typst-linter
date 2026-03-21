export type CodeHighlighter = (code: string, language: string) => string;

/**
 * Simple markdown-to-HTML converter for hover tooltips.
 * Handles: code blocks, inline code, headers, bold, italic, horizontal rules, paragraphs.
 */
export function renderHoverMarkdown(
  md: string,
  highlightCode?: CodeHighlighter,
): string {
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
        htmlParts.push(
          `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code)}</code></pre>`,
        );
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
      htmlParts.push(
        `<h${level}>${inlineMarkdown(headerMatch[2])}</h${level}>`,
      );
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
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("#") &&
      !/^---+\s*$/.test(lines[i])
    ) {
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