/**
 * Two addressing schemes live in this codebase. This file is the only place
 * that knows how they relate. Keeping the vocabulary and conversions colocated
 * means a new contributor can read one file and understand the model.
 *
 * 1. Path          — "/main.typ". Always leading-slash, always forward slashes.
 *                    Used by the compiler VFS, the `TypstProject` public API,
 *                    and the `typstFilePath` facet. Addresses a file within
 *                    the project.
 *
 * 2. AnalyzerUri   — "untitled:project/main.typ". What tinymist's LSP expects.
 *                    Derived from a Path plus the analyzer URI root.
 *
 * The types below are type aliases, not branded/opaque types. That's
 * deliberate: callers can pass string literals where a Path is expected
 * without wrapping, and the aliases only serve as self-documenting
 * signatures. Ingress points still need to call `normalizePath` to defend
 * against un-normalized input — the alias does not imply the string has
 * been normalized.
 */

/** `/path/to/file.typ` — leading-slash, forward slashes only. */
export type Path = string;

/** `untitled:project/path/to/file.typ` — what tinymist's LSP consumes. */
export type AnalyzerUri = string;

/** Ensure a path starts with a leading slash. Idempotent. */
export function normalizePath(path: string): Path {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Normalize an analyzer URI root. Ensures leading slash, strips trailing
 * slashes. Special-cases "/" → "" so URIs don't end up with a leading
 * `untitled://`.
 */
export function normalizeRoot(rootPath: string): string {
  const root = normalizePath(rootPath);
  return root === "/" ? "" : root.replace(/\/+$/, "");
}

/**
 * Build the analyzer URI for a given project path. `root` is expected to
 * already be normalized (see `normalizeRoot`).
 *
 *   pathToAnalyzerUri("/main.typ", "/project") -> "untitled:project/main.typ"
 */
export function pathToAnalyzerUri(path: Path, root: string): AnalyzerUri {
  const bare = root.replace(/^\//, "");
  return `untitled:${bare}${normalizePath(path)}`;
}
