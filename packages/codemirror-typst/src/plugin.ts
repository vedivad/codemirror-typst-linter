import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { CompileResult, LspDiagnostic, TypstCompiler } from "@vedivad/typst-web-service";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";
import type { TypstWorkspaceController } from "./workspace-controller.js";

export interface TypstPluginOptions {
    compiler: TypstCompiler;
    workspaceController?: TypstWorkspaceController;
    /** File path this editor represents. Default: "/main.typ" */
    filePath?: string;
    /** Return all project files. The current editor's content is included automatically under filePath. */
    getFiles?: () => Record<string, string>;
    /** Called after each successful compile with the full result. */
    onCompile?: (result: CompileResult) => void;
    /** Delay in ms before analyzer-mode sync/compile runs after doc changes. Default: 0. */
    compileDelay?: number;
    onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export class TypstPlugin {
    private controller: AbortController | null = null;
    private readonly path: string;
    private unsubscribeDiagnostics?: () => void;
    private syncTimer: ReturnType<typeof setTimeout> | null = null;
    private lastDiagnosticsKey: string | null = null;
    private disposed = false;

    constructor(
        private readonly options: TypstPluginOptions,
        view?: EditorView,
    ) {
        this.path = options.filePath ?? "/main.typ";

        if (view && options.workspaceController) {
            this.bindPushDiagnostics(view);
            this.scheduleSync(view, true);
        }
    }

    update(update: ViewUpdate): void {
        if (!this.options.workspaceController) return;
        if (update.docChanged) this.scheduleSync(update.view, false);
    }

    private bindPushDiagnostics(view: EditorView): void {
        const controller = this.options.workspaceController;
        if (!controller || this.unsubscribeDiagnostics) return;

        this.unsubscribeDiagnostics = controller.subscribe(
            this.path,
            (lspDiags: LspDiagnostic[]) => {
                const cmDiags = lspDiags.map((d) => lspToCMDiagnostic(view.state, d));
                const nextKey = JSON.stringify(
                    cmDiags.map((d) => [d.from, d.to, d.severity, d.message, d.source]),
                );
                if (nextKey === this.lastDiagnosticsKey) return;

                this.lastDiagnosticsKey = nextKey;
                this.applyDiagnostics(view, cmDiags);
            },
        );
    }

    private applyDiagnostics(view: EditorView, diagnostics: Diagnostic[]): void {
        if (this.disposed) return;

        const dispatchDiagnostics = () => {
            if (this.disposed) return;
            view.dispatch(setDiagnostics(view.state, diagnostics));
            this.options.onDiagnostics?.(diagnostics);
        };

        try {
            dispatchDiagnostics();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("update are not allowed while an update is in progress")) {
                setTimeout(() => {
                    try {
                        dispatchDiagnostics();
                    } catch {
                        // View may already be replaced/destroyed.
                    }
                }, 0);
            }
        }
    }

    private scheduleSync(view: EditorView, immediate: boolean): void {
        if (!this.options.workspaceController) return;

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
        const controller = this.options.workspaceController;
        if (!controller) return;

        this.controller?.abort();
        this.controller = new AbortController();
        const { signal } = this.controller;

        const source = view.state.doc.toString();
        const files = { ...this.options.getFiles?.(), [this.path]: source };

        await controller.syncAndCompile(this.path, source, files, (result) => {
            if (signal.aborted) return;
            this.options.onCompile?.(result);
        });
    }

    async lint(view: EditorView): Promise<Diagnostic[]> {
        // Analyzer mode uses push diagnostics only.
        if (this.options.workspaceController) return [];

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
        this.disposed = true;
        this.controller?.abort();
        if (this.syncTimer) clearTimeout(this.syncTimer);
        this.unsubscribeDiagnostics?.();
    }
}
