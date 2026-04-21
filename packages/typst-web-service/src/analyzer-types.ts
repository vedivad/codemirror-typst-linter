/** LSP Position (0-based line and character). */
export interface LspPosition {
  line: number;
  character: number;
}

/** LSP Range. */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** LSP Diagnostic as returned by tinymist. */
export interface LspDiagnostic {
  range: LspRange;
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string;
  source?: string;
}

/** LSP MarkupContent (markdown or plaintext). */
export interface LspMarkupContent {
  kind: "markdown" | "plaintext";
  value: string;
}

/** LSP CompletionItem (subset actually populated by tinymist). */
export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | LspMarkupContent;
  insertText?: string;
  /** LSP InsertTextFormat: 1 = PlainText, 2 = Snippet (TextMate syntax). */
  insertTextFormat?: number;
  filterText?: string;
  sortText?: string;
  textEdit?: {
    range: LspRange;
    newText: string;
  };
}

/** LSP CompletionList. */
export interface LspCompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

/** Response shape for `textDocument/completion`. */
export type LspCompletionResponse =
  | LspCompletionList
  | LspCompletionItem[]
  | null;

/** LSP Hover contents — legacy and current forms tinymist may emit. */
export type LspHoverContents =
  | string
  | LspMarkupContent
  | (string | { language: string; value: string })[];

/** Response shape for `textDocument/hover`. */
export interface LspHover {
  contents: LspHoverContents;
  range?: LspRange;
}
