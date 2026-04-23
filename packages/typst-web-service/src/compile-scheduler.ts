interface CompileSchedulerOptions {
  /** Minimum idle time (ms) after the last request before firing. Default: 0. */
  debounceMs?: number;
  /**
   * Maximum time (ms) the debounce may keep deferring during continuous
   * requests. Guarantees a fire at least this often so users see progress
   * while typing. Default: 0 (no cap).
   */
  maxWaitMs?: number;
}

/**
 * Debounce helper with a max-wait ceiling for coalescing compile requests. A
 * burst of `schedule(cb)` calls within `debounceMs` collapses into one fire;
 * during sustained bursts, `maxWaitMs` caps how long the debounce may keep
 * deferring.
 */
export class CompileScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: CompileSchedulerOptions = {}) {}

  schedule(callback: () => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const delay = Math.max(0, this.options.debounceMs ?? 0);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.clearMaxWait();
      callback();
    }, delay);

    const maxWait = this.options.maxWaitMs;
    if (maxWait != null && maxWait > 0 && !this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
          callback();
        }
      }, maxWait);
    }
  }

  /** Cancel any pending scheduled fire without calling the callback. */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.clearMaxWait();
  }

  private clearMaxWait(): void {
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }
}
