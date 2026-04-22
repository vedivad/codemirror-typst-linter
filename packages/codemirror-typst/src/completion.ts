import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
} from "@codemirror/autocomplete";
import type {
  LspCompletionItem,
  LspCompletionResponse,
  LspMarkupContent,
  TypstProject,
} from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";

export interface TypstCompletionOptions {
  project: TypstProject;
}

/** LSP CompletionItemKind → CM6 completion type */
const LSP_KIND_TO_TYPE: Record<number, string> = {
  1: "text", // Text
  2: "method", // Method
  3: "function", // Function
  4: "method", // Constructor
  5: "property", // Field
  6: "variable", // Variable
  7: "class", // Class
  8: "interface", // Interface
  9: "namespace", // Module
  10: "property", // Property
  11: "constant", // Unit
  12: "constant", // Value
  13: "enum", // Enum
  14: "keyword", // Keyword
  15: "keyword", // Snippet
  16: "constant", // Color
  17: "text", // File
  18: "text", // Reference
  19: "text", // Folder
  20: "enum", // EnumMember
  21: "constant", // Constant
  22: "class", // Struct
  23: "keyword", // Event
  24: "keyword", // Operator
  25: "type", // TypeParameter
};

function getDocString(
  doc: string | LspMarkupContent | undefined,
): string | undefined {
  if (!doc) return undefined;
  if (typeof doc === "string") return doc;
  return doc.value;
}

/** LSP InsertTextFormat.Snippet */
const LSP_SNIPPET_FORMAT = 2;

/**
 * Translate an LSP TextMate snippet (`${1:default}`, `$1`, `$0`, `\$`, `\}`,
 * `\\`) into CM6's snippet template syntax (`#{label}` placeholders, `\#` and
 * `\\` escapes). LSP escapes are stashed behind sentinels first so the
 * translation regexes don't see them.
 */
function lspSnippetToCMTemplate(src: string): string {
  const TMP_BS = "\x00";
  const TMP_DOLLAR = "\x01";
  const TMP_RBRACE = "\x02";
  let s = src
    .replace(/\\\\/g, TMP_BS)
    .replace(/\\\$/g, TMP_DOLLAR)
    .replace(/\\\}/g, TMP_RBRACE);
  // Escape CM6's placeholder marker in surrounding user text.
  s = s.replace(/#/g, "\\#");
  // $0 / ${0:...} is the final cursor — CM6 lands there after the last tab
  // stop, so we drop it.
  s = s.replace(/\$\{0(?::[^}]*)?\}|\$0/g, "");
  // ${N:default} → #{default}; ${N} and $N → #{}
  s = s
    .replace(/\$\{\d+:([^}]*)\}/g, "#{$1}")
    .replace(/\$\{\d+\}/g, "#{}")
    .replace(/\$\d+/g, "#{}");
  return s
    .replaceAll(TMP_BS, "\\\\")
    .replaceAll(TMP_DOLLAR, "$")
    .replaceAll(TMP_RBRACE, "}");
}

function lspCompletionToCM(
  ctx: CompletionContext,
  result: LspCompletionResponse,
): CompletionResult | null {
  const items: LspCompletionItem[] | undefined = Array.isArray(result)
    ? result
    : (result?.items ?? undefined);

  if (!items?.length) return null;

  // Determine the completion range start.
  // Use the first item's textEdit range if available, otherwise find the word start.
  let from = ctx.pos;
  const firstEdit = items[0]?.textEdit;
  if (firstEdit) {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const editLine = firstEdit.range.start.line;
    if (editLine === line.number - 1) {
      from = line.from + firstEdit.range.start.character;
    }
  } else {
    // Walk back to find the start of the current word/token
    const line = ctx.state.doc.lineAt(ctx.pos);
    const textBefore = line.text.slice(0, ctx.pos - line.from);
    const match = textBefore.match(/[#\w.-]+$/);
    if (match) {
      from = ctx.pos - match[0].length;
    }
  }

  const options: Completion[] = items.map((item) => {
    const insertText = item.textEdit?.newText ?? item.insertText;
    const apply =
      insertText !== undefined && item.insertTextFormat === LSP_SNIPPET_FORMAT
        ? snippet(lspSnippetToCMTemplate(insertText))
        : insertText;
    const completion: Completion = {
      label: item.label,
      type: item.kind ? LSP_KIND_TO_TYPE[item.kind] : undefined,
      detail: item.detail ?? undefined,
      info: getDocString(item.documentation) ?? undefined,
      apply,
    };
    if (item.sortText) completion.sortText = item.sortText;
    if (item.filterText) completion.displayLabel = item.label;
    return completion;
  });

  return { from, options, validFor: /^[#\w.-]*$/ };
}

/**
 * Create a CM6 CompletionSource backed by a TypstProject. The editor's current
 * content is attached to the completion request in a single analyzer roundtrip,
 * so the analyzer always sees the latest buffer state without an extra RTT.
 */
export function typstCompletionSource(
  options: TypstCompletionOptions,
): (ctx: CompletionContext) => Promise<CompletionResult | null> {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // Only trigger on explicit activation or after typing a trigger character
    if (!ctx.explicit && !ctx.matchBefore(/[#\w.]/)) return null;

    const path = ctx.state.facet(typstFilePath);
    const source = ctx.state.doc.toString();

    const line = ctx.state.doc.lineAt(ctx.pos);
    const position = { line: line.number - 1, character: ctx.pos - line.from };

    try {
      const result = await options.project.completion(path, source, position);
      if (!result) return null;
      return lspCompletionToCM(ctx, result);
    } catch (err) {
      console.debug("[typst] completion request failed", {
        path,
        position,
        error: err,
      });
      return null;
    }
  };
}
