/**
 * Return the given path getter, or a default that returns "/main.typ".
 */
export function toPathGetter(filePath?: () => string): () => string {
  return filePath ?? (() => "/main.typ");
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
