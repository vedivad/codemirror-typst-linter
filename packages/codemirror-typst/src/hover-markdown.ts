import MarkdownIt from "markdown-it";

export type CodeHighlighter = (code: string, language: string) => string;

export interface HoverSection {
  title: string;
  bodyHtml: string;
}

export interface HoverDoc {
  signature?: { code: string; language: string };
  summaryHtml?: string;
  openDocsUrl?: string;
  sections: HoverSection[];
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

function ensureSignatureFence(md: string): string {
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

function createParser(highlightCode?: CodeHighlighter): MarkdownIt {
  const mdParser: MarkdownIt = new MarkdownIt({
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
    ((tokens, idx, options, _env, self) =>
      self.renderToken(tokens, idx, options));

  mdParser.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return mdParser;
}

function parseHoverDocWithParser(
  mdParser: MarkdownIt,
  source: string,
): HoverDoc {
  const { markdown: withoutOpenDocs, href: openDocsUrl } =
    extractOpenDocs(source);
  const normalized = ensureSignatureFence(withoutOpenDocs).trim();

  const env = {};
  const tokens = mdParser.parse(normalized, env);
  const render = (subset: typeof tokens) =>
    mdParser.renderer.render(subset, mdParser.options, env);

  let i = 0;

  let signature: HoverDoc["signature"];
  if (tokens[0]?.type === "fence") {
    const language = canonicalCodeLanguage((tokens[0].info ?? "").trim());
    const code =
      language === "typst"
        ? normalizeTypstCode(tokens[0].content)
        : tokens[0].content;
    signature = { code, language };
    i = 1;
  }

  if (tokens[i]?.type === "hr") {
    i++;
  }

  const summaryTokens: typeof tokens = [];
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "heading_open" && token.tag === "h1") break;
    summaryTokens.push(token);
    i++;
  }
  const summaryHtml = summaryTokens.length
    ? render(summaryTokens).trim()
    : undefined;

  const sections: HoverSection[] = [];
  while (i < tokens.length) {
    const open = tokens[i];
    if (open.type !== "heading_open" || open.tag !== "h1") {
      i++;
      continue;
    }
    const title = tokens[i + 1]?.content?.trim() ?? "";
    i += 3;
    const bodyTokens: typeof tokens = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === "heading_open" && t.tag === "h1") break;
      bodyTokens.push(t);
      i++;
    }
    sections.push({
      title,
      bodyHtml: bodyTokens.length ? render(bodyTokens) : "",
    });
  }

  return { signature, summaryHtml, openDocsUrl, sections };
}

export function parseHoverDoc(source: string): HoverDoc {
  const mdParser = createParser();
  return parseHoverDocWithParser(mdParser, source);
}

function renderSignature(
  mdParser: MarkdownIt,
  signature: HoverDoc["signature"],
  highlightCode?: CodeHighlighter,
): string {
  if (!signature) return "";

  const { code, language } = signature;
  if (highlightCode && language) {
    return `<div class="cm-typst-hover-code">${highlightCode(code, language)}</div>`;
  }

  const escapedCode = mdParser.utils.escapeHtml(code);
  const escapedLang = language
    ? ` class="language-${mdParser.utils.escapeHtml(language)}"`
    : "";
  return `<pre class="cm-typst-hover-pre"><code${escapedLang}>${escapedCode}</code></pre>`;
}

function renderHoverDoc(
  mdParser: MarkdownIt,
  doc: HoverDoc,
  highlightCode?: CodeHighlighter,
): string {
  const { signature, summaryHtml, openDocsUrl, sections } = doc;

  const signatureBlock = signature
    ? `<div class="cm-typst-hover-signature">${renderSignature(mdParser, signature, highlightCode)}</div>`
    : "";
  const summaryBlock = summaryHtml
    ? `<div class="cm-typst-hover-summary">${summaryHtml}</div>`
    : "";
  const openDocsBlock = openDocsUrl
    ? `<a class="cm-typst-hover-open-docs" href="${mdParser.utils.escapeHtml(openDocsUrl)}" target="_blank" rel="noopener noreferrer">Open docs</a>`
    : "";

  const sectionHtml = sections
    .map((section, index) => {
      const escapedTitle = mdParser.utils.escapeHtml(section.title);
      return `<details class="cm-typst-hover-section"${index === 0 ? " open" : ""}><summary>${escapedTitle}</summary>${section.bodyHtml}</details>`;
    })
    .join("");

  const hasHeader = Boolean(signatureBlock || summaryBlock || openDocsBlock);
  const headerHtml = hasHeader
    ? `<div class="cm-typst-hover-header"><div class="cm-typst-hover-header-main">${signatureBlock}${summaryBlock}</div>${openDocsBlock ? `<div class="cm-typst-hover-header-actions">${openDocsBlock}</div>` : ""}</div>`
    : "";

  return `<div class="cm-typst-hover-content">${headerHtml}${sectionHtml}</div>`;
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
  const mdParser = createParser(highlightCode);
  const doc = parseHoverDocWithParser(mdParser, md);
  return renderHoverDoc(mdParser, doc, highlightCode);
}
