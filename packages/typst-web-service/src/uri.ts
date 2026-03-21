export function normalizeUntitledUri(uri: string): string {
    if (!uri.startsWith("untitled:")) return uri;
    return `untitled:${uri.slice("untitled:".length).replace(/^\/+/, "")}`;
}

export function normalizePath(path: string): string {
    return path.startsWith("/") ? path : `/${path}`;
}

export function normalizeRoot(rootPath: string): string {
    const root = normalizePath(rootPath);
    return root === "/" ? "" : root.replace(/\/+$/, "");
}