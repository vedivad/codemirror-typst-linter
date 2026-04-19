import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { CompileResult } from "@vedivad/typst-web-service";
import { toPathGetter } from "./utils.js";

export interface BasePluginOptions {
  /** File path this editor represents. Default: () => "/main.typ" */
  filePath?: () => string;
  /** Debounce delay in ms before compile/sync runs after doc changes. Default: 0. */
  debounceDelay?: number;
  /** Throttle delay in ms — guarantees a run at least this often during continuous typing. */
  throttleDelay?: number;
  /** Called after each successful compile with the full result (including project-wide diagnostics). */
  onCompile?: (result: CompileResult) => void;
}

interface PluginDriverCallbacks {
  run(view: EditorView): Promise<void>;
  onPathChange?(view: EditorView): void;
}

class CompileScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFireTime = 0;

  constructor(
    private readonly options: {
      debounceDelay?: number;
      throttleDelay?: number;
    },
  ) {}

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

export class PluginDriver {
  private readonly getPath: () => string;
  currentPath: string;
  controller: AbortController | null = null;
  private readonly scheduler: CompileScheduler;
  private readonly callbacks: PluginDriverCallbacks;

  constructor(
    options: {
      filePath?: () => string;
      debounceDelay?: number;
      throttleDelay?: number;
    },
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
      () =>
        this.callbacks.run(view).catch((err) => console.error("[typst]", err)),
      immediate,
    );
  }
}
