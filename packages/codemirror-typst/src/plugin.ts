import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { AnalyzerSession, CompileResult, LspDiagnostic, TypstCompiler } from "@vedivad/typst-web-service";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";

interface BasePluginOptions {
    /** File path this editor represents. Default: "/main.typ" */
    filePath?: string;
    /** Return all project files. The current editor's content is included automatically under filePath. */
    getFiles?: () => Record<string, string>;
    /** Called after each successful compile with the full result. */
    onCompile?: (result: CompileResult) => void;
    onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export interface CompilerLintPluginOptions extends BasePluginOptions {
    compiler: TypstCompiler;
}

export class CompilerLintPlugin {
    private controller: AbortController | null = null;
    private readonly path: string;

    constructor(private readonly options: CompilerLintPluginOptions) {
        this.path = options.filePath ?? "/main.typ";
    }

    async lint(view: EditorView): Promise<Diagnostic[]> {
        this.controller?.abort();
        this.controller = new AbortController();
        const { signal } = this.controller;

        const source = view.state.doc.toString();
        const files = { ...this.options.getFiles?.(), [this.path]: source };

        try {
            const result = await this.options.compiler.compile(files);
            if (signal.aborted) return [];

            this.options.onCompile?.(result);
            const diagnostics = result.diagnostics
                .filter((d) => d.path === this.path)
                .map((d) => toCMDiagnostic(view.state, d));

            this.options.onDiagnostics?.(diagnostics);
            return diagnostics;
        } catch (err) {
            if (signal.aborted) return [];

            const diagnostics: Diagnostic[] = [
                {
                    from: 0,
                    to: Math.min(1, view.state.doc.length),
                    severity: "error",
                    message: err instanceof Error ? err.message : String(err),
                    source: "typst",
                },
            ];

            this.options.onDiagnostics?.(diagnostics);
            return diagnostics;
        }
    }

    destroy(): void {
        this.controller?.abort();
    }
}

export interface PushDiagnosticsPluginOptions extends BasePluginOptions {
    session: AnalyzerSession;
    /** Whether this plugin owns the session and should destroy it on teardown. Default: true. */
    ownsSession?: boolean;
    compiler: TypstCompiler;
    /** Delay in ms before analyzer-mode sync/compile runs after doc changes. Default: 0. */
    compileDelay?: number;
}

export class PushDiagnosticsPlugin {
    private controller: AbortController | null = null;
    private readonly path: string;
    private unsubscribeDiagnostics?: () => void;
    private syncTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(
        private readonly options: PushDiagnosticsPluginOptions,
        view?: EditorView,
    ) {
        this.path = options.filePath ?? "/main.typ";

        if (view) {
            this.bindPushDiagnostics(view);
            this.scheduleSync(view, true);
        }
    }

    update(update: ViewUpdate): void {
        if (update.docChanged) this.scheduleSync(update.view, false);
    }

    async lint(_view: EditorView): Promise<Diagnostic[]> {
        return [];
    }

    private bindPushDiagnostics(view: EditorView): void {
        if (this.unsubscribeDiagnostics) return;

        this.unsubscribeDiagnostics = this.options.session.subscribe(
            this.path,
            (lspDiags: LspDiagnostic[]) => {
                const cmDiags = lspDiags.map((d) => lspToCMDiagnostic(view.state, d));
                this.applyDiagnostics(view, cmDiags);
            },
        );
    }

    private pendingDiagnostics: Diagnostic[] | null = null;
    private rafId: number | null = null;

    private applyDiagnostics(view: EditorView, diagnostics: Diagnostic[]): void {
        if (this.disposed) return;

        this.pendingDiagnostics = diagnostics;
        if (this.rafId != null) return;

        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (this.disposed || !this.pendingDiagnostics) return;
            const diags = this.pendingDiagnostics;
            this.pendingDiagnostics = null;
            try {
                view.dispatch(setDiagnostics(view.state, diags));
                this.options.onDiagnostics?.(diags);
            } catch {
                // View may already be replaced/destroyed.
            }
        });
    }

    private scheduleSync(view: EditorView, immediate: boolean): void {
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }

        const delay = immediate ? 0 : Math.max(0, this.options.compileDelay ?? 0);
        this.syncTimer = setTimeout(() => {
            this.syncTimer = null;
            void this.runSync(view);
        }, delay);
    }

    private async runSync(view: EditorView): Promise<void> {
        if (this.controller) {
            this.controller.abort();
        }
        this.controller = new AbortController();
        const { signal } = this.controller;

        const source = view.state.doc.toString();
        const files = { ...this.options.getFiles?.(), [this.path]: source };

        await this.options.session.syncAndCompile(
            this.path,
            source,
            files,
            this.options.compiler,
            (result) => {
                if (signal.aborted) return;
                this.options.onCompile?.(result);
            },
            signal,
        );
    }

    destroy(): void {
        this.disposed = true;
        this.controller?.abort();
        if (this.syncTimer) clearTimeout(this.syncTimer);
        if (this.rafId != null) cancelAnimationFrame(this.rafId);
        this.unsubscribeDiagnostics?.();
        if (this.options.ownsSession !== false) {
            this.options.session.destroy();
        }
    }
}
