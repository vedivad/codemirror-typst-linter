/**
 * Return the given path getter, or a default that returns "/main.typ".
 */
export function toPathGetter(filePath?: () => string): () => string {
  return filePath ?? (() => "/main.typ");
}
