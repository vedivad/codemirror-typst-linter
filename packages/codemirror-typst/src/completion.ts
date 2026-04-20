import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type {
  LspCompletionItem,
  LspCompletionResponse,
  LspMarkupContent,
  TypstProject,
} from "@vedivad/typst-web-service";
import { toPathGetter } from "./utils.js";

export interface TypstCompletionOptions {
  project: TypstProject;
  /** File path this editor represents. Default: () => "/main.typ" */
  filePath?: () => string;
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
    const completion: Completion = {
      label: item.label,
      type: item.kind ? LSP_KIND_TO_TYPE[item.kind] : undefined,
      detail: item.detail ?? undefined,
      info: getDocString(item.documentation) ?? undefined,
      apply: item.textEdit?.newText ?? item.insertText ?? undefined,
    };
    if (item.sortText) completion.sortText = item.sortText;
    if (item.filterText) completion.displayLabel = item.label;
    return completion;
  });

  return { from, options, validFor: /^[#\w.-]*$/ };
}

/**
 * Create a CM6 CompletionSource backed by a TypstProject. The editor's current
 * content is pushed via `setText` before requesting completions, so the
 * analyzer always sees the latest buffer state.
 */
export function typstCompletionSource(
  options: TypstCompletionOptions,
): (ctx: CompletionContext) => Promise<CompletionResult | null> {
  const getPath = toPathGetter(options.filePath);

  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // Only trigger on explicit activation or after typing a trigger character
    if (!ctx.explicit && !ctx.matchBefore(/[#\w.]/)) return null;

    const path = getPath();
    const source = ctx.state.doc.toString();

    const line = ctx.state.doc.lineAt(ctx.pos);
    const lspLine = line.number - 1;
    const lspChar = ctx.pos - line.from;

    try {
      await options.project.setText(path, source);
      const result = await options.project.completion(path, lspLine, lspChar);
      if (!result) return null;
      return lspCompletionToCM(ctx, result);
    } catch {
      return null;
    }
  };
}
