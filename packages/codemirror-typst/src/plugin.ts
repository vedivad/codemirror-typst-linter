import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type {
    AnalyzerSession,
    CompileResult,
    LspDiagnostic,
    TypstCompiler,
} from "@vedivad/typst-web-service";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";
import { gatherFiles, toPathGetter } from "./utils.js";

// ---------------------------------------------------------------------------
// Shared debounce + throttle scheduler
// ---------------------------------------------------------------------------

interface CompileSchedulerOptions {
    debounceDelay?: number;
    throttleDelay?: number;
}

class CompileScheduler {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private throttleTimer: ReturnType<typeof setTimeout> | null = null;
    private lastFireTime = 0;

    constructor(private readonly options: CompileSchedulerOptions) { }

    schedule(callback: () => void, immediate: boolean): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        const delay = immediate ? 0 : Math.max(0, this.options.debounceDelay ?? 0);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.fire(callback);
        }, delay);

        const throttle = this.options.throttleDelay;
        if (!immediate && throttle != null && throttle > 0 && !this.throttleTimer) {
            const wait = Math.max(
                0,
                throttle - (performance.now() - this.lastFireTime),
            );
            this.throttleTimer = setTimeout(() => {
                this.throttleTimer = null;
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = null;
                    this.fire(callback);
                }
            }, wait);
        }
    }

    private fire(callback: () => void): void {
        this.lastFireTime = performance.now();
        callback();
    }

    dispose(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.throttleTimer) clearTimeout(this.throttleTimer);
    }
}

// ---------------------------------------------------------------------------
// Plugin driver — path tracking, scheduling, and abort via composition
// ---------------------------------------------------------------------------

interface PluginDriverOptions {
    filePath?: string | (() => string);
    debounceDelay?: number;
    throttleDelay?: number;
}

interface PluginDriverCallbacks {
    run(view: EditorView): Promise<void>;
    onPathChange?(view: EditorView): void;
}

class PluginDriver {
    private readonly getPath: () => string;
    currentPath: string;
    controller: AbortController | null = null;
    private readonly scheduler: CompileScheduler;
    private readonly callbacks: PluginDriverCallbacks;

    constructor(
        options: PluginDriverOptions,
        callbacks: PluginDriverCallbacks,
    ) {
        this.getPath = toPathGetter(options.filePath);
        this.currentPath = this.getPath();
        this.scheduler = new CompileScheduler(options);
        this.callbacks = callbacks;
    }

    /** Trigger an immediate run. Call once after construction when the view is available. */
    start(view: EditorView): void {
        this.scheduleRun(view, true);
    }

    update(update: ViewUpdate): void {
        const newPath = this.getPath();
        if (newPath !== this.currentPath) {
            this.currentPath = newPath;
            this.callbacks.onPathChange?.(update.view);
            this.scheduleRun(update.view, true);
            return;
        }
        if (update.docChanged) {
            this.scheduleRun(update.view, false);
        }
    }

    dispose(): void {
        this.controller?.abort();
        this.scheduler.dispose();
    }

    private scheduleRun(view: EditorView, immediate: boolean): void {
        this.scheduler.schedule(
            () => this.callbacks.run(view).catch((err) => console.error("[typst]", err)),
            immediate,
        );
    }
}

// ---------------------------------------------------------------------------
// Compiler-only plugin
// ---------------------------------------------------------------------------

interface BasePluginOptions {
    /** File path this editor represents, or a getter for dynamic paths. Default: "/main.typ" */
    filePath?: string | (() => string);
    /** Return all project files. The current editor's content is included automatically under filePath. */
    getFiles?: () => Record<string, string>;
    /** Called after each successful compile with the full result. */
    onCompile?: (result: CompileResult) => void;
    onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export interface CompilerLintPluginOptions extends BasePluginOptions {
    compiler: TypstCompiler;
    /** Debounce delay in ms before compile runs after doc changes. Default: 0. */
    debounceDelay?: number;
    /** Throttle delay in ms — guarantees a compile at least this often during continuous typing. */
    throttleDelay?: number;
}

export class CompilerLintPlugin {
    private readonly driver: PluginDriver;

    constructor(
        private readonly options: CompilerLintPluginOptions,
        view?: EditorView,
    ) {
        this.driver = new PluginDriver(options, { run: (v) => this.run(v) });
        if (view) this.driver.start(view);
    }

    update(update: ViewUpdate): void {
        this.driver.update(update);
    }

    destroy(): void {
        this.driver.dispose();
    }

    private async run(view: EditorView): Promise<void> {
        this.driver.controller?.abort();
        this.driver.controller = new AbortController();
        const { signal } = this.driver.controller;

        const source = view.state.doc.toString();
        const files = gatherFiles(this.options.getFiles, this.driver.currentPath, source);

        try {
            const result = await this.options.compiler.compile(files);
            if (signal.aborted) return;

            this.options.onCompile?.(result);
            const diagnostics = result.diagnostics
                .filter((d) => d.path === this.driver.currentPath)
                .map((d) => toCMDiagnostic(view.state, d));

            this.options.onDiagnostics?.(diagnostics);
            try {
                view.dispatch(setDiagnostics(view.state, diagnostics));
            } catch {
                // View may already be replaced/destroyed.
            }
        } catch (err) {
            if (signal.aborted) return;

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
            try {
                view.dispatch(setDiagnostics(view.state, diagnostics));
            } catch {
                // View may already be replaced/destroyed.
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Push diagnostics plugin (analyzer session + compiler)
// ---------------------------------------------------------------------------

export interface PushDiagnosticsPluginOptions extends BasePluginOptions {
    session: AnalyzerSession;
    /** Whether this plugin owns the session and should destroy it on teardown. Default: true. */
    ownsSession?: boolean;
    compiler: TypstCompiler;
    /** Debounce delay in ms before sync/compile runs after doc changes. Default: 0. */
    debounceDelay?: number;
    /** Throttle delay in ms — guarantees a compile at least this often during continuous typing. */
    throttleDelay?: number;
}

export class PushDiagnosticsPlugin {
    private readonly driver: PluginDriver;
    private unsubscribeDiagnostics?: () => void;
    private disposed = false;
    private pendingDiagnostics: Diagnostic[] | null = null;
    private rafId: number | null = null;

    constructor(
        private readonly options: PushDiagnosticsPluginOptions,
        view?: EditorView,
    ) {
        this.driver = new PluginDriver(options, {
            run: (v) => this.run(v),
            onPathChange: (v) => this.onPathChange(v),
        });

        if (view) {
            // Bind before starting so cached diagnostics replay synchronously.
            this.bindPushDiagnostics(view);
            this.driver.start(view);
        }
    }

    update(update: ViewUpdate): void {
        this.driver.update(update);
    }

    destroy(): void {
        this.disposed = true;
        this.driver.dispose();
        if (this.rafId != null) cancelAnimationFrame(this.rafId);
        this.unsubscribeDiagnostics?.();
        if (this.options.ownsSession !== false) {
            this.options.session.destroy();
        }
    }

    private onPathChange(view: EditorView): void {
        this.unsubscribeDiagnostics?.();
        this.unsubscribeDiagnostics = undefined;
        this.bindPushDiagnostics(view);
    }

    private async run(view: EditorView): Promise<void> {
        this.driver.controller?.abort();
        this.driver.controller = new AbortController();
        const { signal } = this.driver.controller;

        const source = view.state.doc.toString();
        const files = gatherFiles(this.options.getFiles, this.driver.currentPath, source);

        await this.options.session.sync(this.driver.currentPath, files);
        if (signal.aborted) return;

        try {
            const result = await this.options.compiler.compile(files);
            if (signal.aborted) return;
            this.options.onCompile?.(result);
        } catch (err) {
            if (!signal.aborted) console.error("[typst] compile failed:", err);
        }
    }

    private bindPushDiagnostics(view: EditorView): void {
        if (this.unsubscribeDiagnostics) return;

        this.unsubscribeDiagnostics = this.options.session.subscribe(
            this.driver.currentPath,
            (lspDiags: LspDiagnostic[]) => {
                const cmDiags = lspDiags.map((d) => lspToCMDiagnostic(view.state, d));
                this.applyDiagnostics(view, cmDiags);
            },
        );
    }

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
}
