interface CompileSchedulerOptions {
  /** Minimum idle time (ms) after the last request before firing. Default: 0. */
  debounceDelay?: number;
  /**
   * Maximum time (ms) between fires during continuous requests. Guarantees
   * a run at least this often so users see progress while typing. Default: 0
   * (no throttle).
   */
  throttleDelay?: number;
}

/**
 * Debounce + throttle helper for coalescing compile requests. A burst of
 * `schedule(cb)` calls within `debounceDelay` collapses into one fire; during
 * sustained bursts, `throttleDelay` guarantees a fire no less often than that.
 */
export class CompileScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFireTime = 0;

  constructor(private readonly options: CompileSchedulerOptions = {}) {}

  schedule(callback: () => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const delay = Math.max(0, this.options.debounceDelay ?? 0);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fire(callback);
    }, delay);

    const throttle = this.options.throttleDelay;
    if (throttle != null && throttle > 0 && !this.throttleTimer) {
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

  /** Cancel any pending scheduled fire without calling the callback. */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  private fire(callback: () => void): void {
    this.lastFireTime = performance.now();
    callback();
  }
}
