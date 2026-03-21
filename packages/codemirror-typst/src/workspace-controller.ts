import {
    AnalyzerSession,
    type CompileResult,
    type LspDiagnostic,
    type TypstAnalyzer,
    type TypstCompiler,
} from "@vedivad/typst-web-service";

export type DiagnosticsSubscriber = (diagnostics: LspDiagnostic[]) => void;

export interface TypstWorkspaceControllerOptions {
    analyzer: TypstAnalyzer;
    compiler: TypstCompiler;
    projectRootPath?: string;
    projectEntryPath?: string;
    session?: AnalyzerSession;
}

function normalizeUntitledUri(uri: string): string {
    if (!uri.startsWith("untitled:")) return uri;
    return `untitled:${uri.slice("untitled:".length).replace(/^\/+/, "")}`;
}

function diagnosticsHash(diagnostics: LspDiagnostic[]): string {
    return JSON.stringify(
        diagnostics.map((d) => [
            d.range.start.line,
            d.range.start.character,
            d.range.end.line,
            d.range.end.character,
            d.severity ?? 1,
            d.message,
            d.source ?? "",
        ]),
    );
}

export class TypstWorkspaceController {
    private readonly session: AnalyzerSession;
    private readonly compiler: TypstCompiler;
    private readonly listenersByUri = new Map<string, Set<DiagnosticsSubscriber>>();
    private readonly diagnosticsByUri = new Map<string, LspDiagnostic[]>();
    private readonly diagnosticsHashByUri = new Map<string, string>();
    private compileToken = 0;

    constructor(options: TypstWorkspaceControllerOptions) {
        this.compiler = options.compiler;
        this.session =
            options.session ??
            new AnalyzerSession({
                analyzer: options.analyzer,
                rootPath: options.projectRootPath,
                entryPath: options.projectEntryPath,
            });

        options.analyzer.onDiagnostics((uri, diagnostics) => {
            const normalizedUri = normalizeUntitledUri(uri);
            const nextHash = diagnosticsHash(diagnostics);
            if (this.diagnosticsHashByUri.get(normalizedUri) === nextHash) return;

            this.diagnosticsByUri.set(normalizedUri, diagnostics);
            this.diagnosticsHashByUri.set(normalizedUri, nextHash);

            const listeners = this.listenersByUri.get(normalizedUri);
            if (!listeners) return;
            for (const listener of listeners) listener(diagnostics);
        });
    }

    get analyzerSession(): AnalyzerSession {
        return this.session;
    }

    subscribe(path: string, listener: DiagnosticsSubscriber): () => void {
        const uri = normalizeUntitledUri(this.session.toUri(path));

        let listeners = this.listenersByUri.get(uri);
        if (!listeners) {
            listeners = new Set();
            this.listenersByUri.set(uri, listeners);
        }
        listeners.add(listener);

        const cached = this.diagnosticsByUri.get(uri);
        if (cached) listener(cached);

        return () => {
            const current = this.listenersByUri.get(uri);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.listenersByUri.delete(uri);
        };
    }

    async syncAndCompile(
        path: string,
        content: string,
        files: Record<string, string>,
        onCompile?: (result: CompileResult) => void,
    ): Promise<void> {
        await this.session.sync(path, content, files);

        const token = ++this.compileToken;
        try {
            const result = await this.compiler.compile(files);
            if (token !== this.compileToken) return;
            onCompile?.(result);
        } catch {
            // Analyzer push diagnostics are authoritative.
        }
    }
}
