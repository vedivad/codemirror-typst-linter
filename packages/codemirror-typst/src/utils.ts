/**
 * Normalize a `filePath` option (static string or getter) into a stable getter.
 * Defaults to "/main.typ" when omitted.
 */
export function toPathGetter(
  filePath?: string | (() => string),
): () => string {
  return typeof filePath === "function"
    ? filePath
    : () => filePath ?? "/main.typ";
}

/**
 * Build a complete project file map by merging extra files with the current
 * editor content under its path.
 */
export function gatherFiles(
  getFiles: (() => Record<string, string>) | undefined,
  path: string,
  source: string,
): Record<string, string> {
  return { ...getFiles?.(), [path]: source };
}
