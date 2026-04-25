import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface TypstHighlightingOptions {
  /** Initial theme alias to use. Defaults to "dark" when available. */
  theme?: string;
  /** Full theme map. Overrides `theme` shorthand if both are set. */
  themes?: Record<string, string>;
  /** Regex engine used by shiki. Default: "javascript". */
  engine?: "javascript" | "oniguruma";
}

export interface TypstHighlightingController {
  extension: Extension;
  readonly theme: string;
  setTheme(view: EditorView, theme: string): void;
  /** Highlight a code string to HTML. Falls back to Typst highlighting for unknown languages. */
  highlightCode(code: string, language: string): string;
}

export async function createTypstHighlighting(
  options: TypstHighlightingOptions = {},
): Promise<TypstHighlightingController> {
  const {
    createHighlighter,
    createJavaScriptRegexEngine,
    createOnigurumaEngine,
  } = await import("shiki");
  const { default: shiki, synchronousHighlightEffect } =
    await import("codemirror-shiki");

  const themes = options.themes ?? {
    light: "github-light",
    dark: "github-dark",
  };
  let currentAlias =
    options.theme ?? (themes.dark ? "dark" : Object.keys(themes)[0]);
  if (!themes[currentAlias]) {
    throw new Error(
      `theme alias "${currentAlias}" not found in themes (${Object.keys(themes).join(", ")})`,
    );
  }

  const engine =
    options.engine === "oniguruma"
      ? createOnigurumaEngine(import("shiki/wasm"))
      : createJavaScriptRegexEngine();

  // Keep as a promise — codemirror-shiki resolves it asynchronously to avoid
  // re-entrant EditorView.update calls during construction.
  const highlighterPromise = createHighlighter({
    langs: ["typst"],
    themes: Array.from(new Set(Object.values(themes))),
    engine,
  });
  const highlighter = await highlighterPromise;

  const compartment = new Compartment();

  const buildExtension = (theme: string): Extension =>
    shiki({ highlighter: highlighterPromise, language: "typst", theme });

  const highlightCode = (code: string, language: string): string => {
    const lang = highlighter.getLoadedLanguages().includes(language)
      ? language
      : "typst";
    return highlighter.codeToHtml(code, { lang, theme: themes[currentAlias] });
  };

  return {
    extension: compartment.of(buildExtension(themes[currentAlias])),
    get theme() {
      return currentAlias;
    },
    setTheme(view, theme) {
      if (!themes[theme]) {
        throw new Error(
          `theme alias "${theme}" not found in themes (${Object.keys(themes).join(", ")})`,
        );
      }
      currentAlias = theme;
      view.dispatch({
        effects: [
          compartment.reconfigure(buildExtension(themes[theme])),
          synchronousHighlightEffect.of(null),
        ],
      });
    },
    highlightCode,
  };
}
