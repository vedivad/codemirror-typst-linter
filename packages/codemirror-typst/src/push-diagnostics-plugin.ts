import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type {
  AnalyzerSession,
  LspDiagnostic,
  TypstCompiler,
} from "@vedivad/typst-web-service";
import { lspToCMDiagnostic } from "./diagnostics.js";
import { type BasePluginOptions, PluginDriver } from "./plugin-driver.js";
import { gatherFiles } from "./utils.js";

export interface PushDiagnosticsPluginOptions extends BasePluginOptions {
  session: AnalyzerSession;
  /** Whether this plugin owns the session and should destroy it on teardown. Default: true. */
  ownsSession?: boolean;
  compiler: TypstCompiler;
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
    const files = gatherFiles(
      this.options.getFiles,
      this.driver.currentPath,
      source,
    );

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
