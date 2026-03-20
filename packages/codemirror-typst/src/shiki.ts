import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface TypstShikiOptions {
  /** Shorthand: "dark" uses github-dark, "light" uses github-light. */
  theme?: "dark" | "light";
  /** Full theme map. Overrides `theme` shorthand if both are set. */
  themes?: Record<string, string>;
  /** Initial theme alias to use. Must exist in `themes`. */
  defaultColor?: string;
  /** Regex engine used by shiki. Default: "javascript". */
  engine?: "javascript" | "oniguruma";
}

export interface TypstShikiHighlighting {
  extension: Extension;
  getTheme: (name?: string, view?: EditorView) => Extension;
  /** Highlight a code string to HTML. Falls back to Typst highlighting for unknown languages. */
  highlightCode: (code: string, language: string) => string;
}

export async function createTypstShikiHighlighting(
  options: TypstShikiOptions = {},
): Promise<TypstShikiHighlighting> {
  const {
    createHighlighter,
    createJavaScriptRegexEngine,
    createOnigurumaEngine,
  } = await import("shiki");
  const { default: shiki } = await import("codemirror-shiki");

  let themes = options.themes;
  if (!themes) {
    if (options.theme === "light") {
      themes = { light: "github-light" };
    } else if (options.theme === "dark") {
      themes = { dark: "github-dark" };
    } else {
      themes = { light: "github-light", dark: "github-dark" };
    }
  }

  const fallbackAlias = Object.keys(themes)[0] ?? "dark";
  const defaultAlias = options.defaultColor ?? options.theme ?? (themes.dark ? "dark" : fallbackAlias);
  const resolveTheme = (alias?: string): string => {
    if (alias && themes[alias]) return themes[alias];
    return themes[defaultAlias] ?? themes[fallbackAlias] ?? "github-dark";
  };

  const uniqueThemes = Array.from(new Set(Object.values(themes)));

  const engine =
    options.engine === "oniguruma"
      ? createOnigurumaEngine(import("shiki/wasm"))
      : createJavaScriptRegexEngine();

  // Keep as a promise — codemirror-shiki resolves it asynchronously to avoid
  // re-entrant EditorView.update calls during construction.
  const highlighterPromise = createHighlighter({
    langs: ["typst"],
    themes: uniqueThemes,
    engine,
  });
  const highlighter = await highlighterPromise;

  const defaultTheme = resolveTheme(options.defaultColor);

  const buildExtension = (theme: string): Extension =>
    shiki({ highlighter: highlighterPromise, language: "typst", theme });

  const highlightCode = (code: string, language: string): string => {
    const lang = highlighter.getLoadedLanguages().includes(language) ? language : "typst";
    return highlighter.codeToHtml(code, { lang, theme: defaultTheme });
  };

  return {
    extension: buildExtension(defaultTheme),
    getTheme: (name?: string) => buildExtension(resolveTheme(name)),
    highlightCode,
  };
}

export async function createTypstShikiExtension(
  options: TypstShikiOptions = {},
): Promise<Extension> {
  return (await createTypstShikiHighlighting(options)).extension;
}
