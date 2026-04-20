import { Facet } from "@codemirror/state";

/**
 * CodeMirror Facet carrying the Typst file path an `EditorState` represents.
 *
 * Attach per-editor via extensions:
 *
 *   EditorState.create({
 *     doc,
 *     extensions: [...sharedTypstExtensions, typstFilePath.of("/main.typ")],
 *   })
 *
 * Completion, hover, and the compiler plugin read this facet to know which
 * project path the editor's buffer corresponds to. Switching tabs via
 * `view.setState(states[path])` carries the new path along with the state —
 * no external closures or thunks needed.
 *
 * If unset, defaults to `/main.typ`. Latest-wins when multiple values are
 * provided.
 */
export const typstFilePath = Facet.define<string, string>({
  combine: (values) => values[values.length - 1] ?? "/main.typ",
});
