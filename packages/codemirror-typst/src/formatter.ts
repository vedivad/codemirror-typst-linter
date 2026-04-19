import type { ChangeSpec, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import type { TypstFormatter } from "@vedivad/typst-web-service";

export interface TypstFormatterOptions {
  /** TypstFormatter instance to use for formatting. */
  instance: TypstFormatter;
  /** Keybinding for format. Default: "Shift-Alt-f" */
  keybinding?: string;
  /**
   * Format the document on Ctrl+S / Cmd+S.
   *
   * - `true` — format on save, no callback.
   * - A function — format on save, then call the function with the formatted content.
   *
   * Omit or set to `false` to disable.
   */
  formatOnSave?: boolean | ((content: string) => void);
  /**
   * Called when formatting fails (e.g. WASM failed to load or typstyle threw).
   * If omitted, errors are logged to `console.warn`.
   */
  onError?: (error: Error) => void;
}

function handleError(error: unknown, onError?: (error: Error) => void): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (onError) {
    onError(err);
  } else {
    console.warn("[typst-formatter]", err.message);
  }
}

/**
 * Compute minimal changes between two strings using common prefix/suffix.
 * Returns ChangeSpec[] that only touch the differing region, preserving
 * cursor position and undo granularity for unchanged parts.
 */
export function diffChanges(oldStr: string, newStr: string): ChangeSpec[] {
  // Find common prefix
  let from = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (from < minLen && oldStr[from] === newStr[from]) {
    from++;
  }

  // Find common suffix (not overlapping with prefix)
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (
    oldEnd > from &&
    newEnd > from &&
    oldStr[oldEnd - 1] === newStr[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  if (from === oldEnd && from === newEnd) return [];

  return [{ from, to: oldEnd, insert: newStr.slice(from, newEnd) }];
}

async function formatDocument(
  view: EditorView,
  formatter: TypstFormatter,
): Promise<void> {
  const doc = view.state.doc.toString();
  const formatted = await formatter.format(doc);
  const changes = diffChanges(doc, formatted);
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
}

interface RunFormatOptions {
  selectionOnlyWhenActive: boolean;
  onFormatted?: () => void;
  onError?: (error: Error) => void;
}

async function runFormat(
  view: EditorView,
  formatter: TypstFormatter,
  options: RunFormatOptions,
): Promise<void> {
  try {
    const { from, to } = view.state.selection.main;

    if (options.selectionOnlyWhenActive && from !== to) {
      const doc = view.state.doc.toString();
      const result = await formatter.formatRange(doc, from, to);
      view.dispatch({
        changes: { from: result.start, to: result.end, insert: result.text },
      });
    } else {
      await formatDocument(view, formatter);
      options.onFormatted?.();
    }
  } catch (error) {
    handleError(error, options.onError);
  }
}

/**
 * Create a CodeMirror extension that formats Typst code via a TypstFormatter.
 *
 * Binds Shift+Alt+F by default. Formats the selection if one exists,
 * otherwise formats the entire document.
 *
 * When `formatOnSave` is enabled, Ctrl+S / Cmd+S formats the full document
 * and optionally calls a callback with the formatted content.
 */
export function createTypstFormatter(
  options: TypstFormatterOptions,
): Extension {
  const {
    instance: formatter,
    keybinding = "Shift-Alt-f",
    formatOnSave,
    onError,
  } = options;

  const keys = [
    {
      key: keybinding,
      run: (view: EditorView) => {
        runFormat(view, formatter, {
          selectionOnlyWhenActive: true,
          onError,
        });
        return true;
      },
    },
  ];

  if (formatOnSave) {
    keys.push({
      key: "Mod-s",
      run: (view: EditorView) => {
        runFormat(view, formatter, {
          selectionOnlyWhenActive: false,
          onFormatted:
            typeof formatOnSave === "function"
              ? () => formatOnSave(view.state.doc.toString())
              : undefined,
          onError,
        });
        return true;
      },
    });
  }

  return keymap.of(keys);
}
