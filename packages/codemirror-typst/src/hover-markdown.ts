import MarkdownIt from "markdown-it";

export type CodeHighlighter = (code: string, language: string) => string;

interface MarkdownSection {
  title: string;
  body: string;
}

// The helpers below reshape tinymist's hover markdown into something we can
// render: tinymist emits an unfenced `let name(...)` signature as the first
// line, uses `typ`/`typc` as code-fence languages, omits the `#` prefix on
// `let`/`set`/`show`/`import`/`include`/`context` keywords inside those
// fences, appends a trailing `[Open docs](url)` link, and uses `# Heading`
// for collapsible sections. These shapes are specific to tinymist's output —
// keep the workarounds together so they're easy to revisit when upstream
// changes.

function canonicalCodeLanguage(lang: string): string {
  const lower = lang.toLowerCase();
  if (lower === "typ" || lower === "typst" || lower === "typc") {
    return "typst";
  }
  return lower;
}

function normalizeTypstCode(code: string): string {
  return code.replace(
    /(^|\n)(\s*)(let|set|show|import|include|context)\b/g,
    "$1$2#$3",
  );
}

function fenceLeadingTypstSignature(md: string): string {
  const lines = md.split("\n");
  const first = lines[0]?.trimStart() ?? "";
  if (!/^let\s+[a-zA-Z_]\w*\s*\(/.test(first)) {
    return md;
  }

  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().endsWith(";")) {
      end = i;
      break;
    }
  }
  if (end < 0) return md;

  const signature = lines.slice(0, end + 1).join("\n");
  const rest = lines.slice(end + 1).join("\n");
  const fenced = `\`\`\`typst\n${signature}\n\`\`\``;
  return rest ? `${fenced}\n${rest}` : fenced;
}

function extractOpenDocs(md: string): { markdown: string; href?: string } {
  const match = md.match(/\n?\[Open docs\]\((https?:\/\/[^\s)]+)\)\s*$/);
  if (!match) return { markdown: md };
  return {
    markdown: md.slice(0, match.index).trimEnd(),
    href: match[1],
  };
}

function extractLeadingFence(md: string): {
  signatureMd?: string;
  restMd: string;
} {
  const match = md.match(/^```[^\n]*\n[\s\S]*?\n```\s*/);
  if (!match) return { restMd: md };
  return {
    signatureMd: match[0].trim(),
    restMd: md.slice(match[0].length),
  };
}

function splitTopLevelSections(md: string): {
  summary: string;
  sections: MarkdownSection[];
} {
  const lines = md.split("\n");
  const firstHeading = lines.findIndex((line) => /^#\s+/.test(line));

  if (firstHeading < 0) {
    return {
      summary: md.trim(),
      sections: [],
    };
  }

  const summary = lines.slice(0, firstHeading).join("\n").trim();
  const sections: MarkdownSection[] = [];

  let i = firstHeading;
  while (i < lines.length) {
    const heading = lines[i].match(/^#\s+(.+)$/);
    if (!heading) {
      i++;
      continue;
    }

    const title = heading[1].trim();
    i++;
    const bodyLines: string[] = [];

    while (i < lines.length && !/^#\s+/.test(lines[i])) {
      bodyLines.push(lines[i]);
      i++;
    }

    sections.push({ title, body: bodyLines.join("\n").trim() });
  }

  return { summary, sections };
}

/**
 * Render markdown for hover tooltips using markdown-it.
 *
 * Security: raw HTML is disabled (`html: false`) so input docs cannot inject
 * arbitrary markup into the tooltip.
 */
export function renderHoverMarkdown(
  md: string,
  highlightCode?: CodeHighlighter,
): string {
  const normalizedMd = fenceLeadingTypstSignature(md).trim();

  const mdParser = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(code, lang) {
      const language = canonicalCodeLanguage(lang.trim());
      const normalizedCode =
        language === "typst" ? normalizeTypstCode(code) : code;
      if (highlightCode && language) {
        return `<div class="cm-typst-hover-code">${highlightCode(normalizedCode, language)}</div>`;
      }

      const escapedCode = mdParser.utils.escapeHtml(normalizedCode);
      const escapedLang = language
        ? ` class="language-${mdParser.utils.escapeHtml(language)}"`
        : "";
      return `<pre class="cm-typst-hover-pre"><code${escapedLang}>${escapedCode}</code></pre>`;
    },
  });

  const defaultLinkOpen =
    mdParser.renderer.rules.link_open ??
    ((tokens, idx, options, env, self) =>
      self.renderToken(tokens, idx, options));

  mdParser.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  const { markdown: withoutOpenDocs, href: openDocsHref } =
    extractOpenDocs(normalizedMd);
  const { signatureMd, restMd } = extractLeadingFence(withoutOpenDocs);
  const cleanedRest = restMd.replace(/^\s*---+\s*\n?/, "").trim();
  const { summary, sections } = splitTopLevelSections(cleanedRest);

  const signatureHtml = signatureMd
    ? `<div class="cm-typst-hover-signature">${mdParser.render(signatureMd)}</div>`
    : "";
  const summaryHtml = summary
    ? `<div class="cm-typst-hover-summary">${mdParser.render(summary)}</div>`
    : "";
  const openDocsHtml = openDocsHref
    ? `<a class="cm-typst-hover-open-docs" href="${mdParser.utils.escapeHtml(openDocsHref)}" target="_blank" rel="noopener noreferrer">Open docs</a>`
    : "";

  const sectionHtml = sections
    .map((section, index) => {
      const escapedTitle = mdParser.utils.escapeHtml(section.title);
      const bodyHtml = section.body ? mdParser.render(section.body) : "";
      return `<details class="cm-typst-hover-section"${index === 0 ? " open" : ""}><summary>${escapedTitle}</summary>${bodyHtml}</details>`;
    })
    .join("");

  const hasHeader = Boolean(signatureHtml || summaryHtml || openDocsHtml);
  const fallbackBody = hasHeader ? "" : mdParser.render(withoutOpenDocs);
  const headerHtml = hasHeader
    ? `<div class="cm-typst-hover-header"><div class="cm-typst-hover-header-main">${signatureHtml}${summaryHtml}</div>${openDocsHtml ? `<div class="cm-typst-hover-header-actions">${openDocsHtml}</div>` : ""}</div>`
    : "";

  return `<div class="cm-typst-hover-content">${headerHtml}${sectionHtml}${fallbackBody}</div>`;
}
