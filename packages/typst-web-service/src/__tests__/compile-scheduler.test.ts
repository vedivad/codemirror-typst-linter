import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CompileScheduler } from "../compile-scheduler.js";

describe("CompileScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after debounceMs", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({ debounceMs: 100 });

    scheduler.schedule(cb);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("resets debounce on repeated schedule calls", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({ debounceMs: 100 });

    scheduler.schedule(cb);
    vi.advanceTimersByTime(50);
    scheduler.schedule(cb);
    vi.advanceTimersByTime(99);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("caps a sustained burst with maxWaitMs from the first schedule", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({
      debounceMs: 300,
      maxWaitMs: 100,
    });

    scheduler.schedule(cb);
    expect(cb).not.toHaveBeenCalled();

    // Keep rescheduling every 50ms — without maxWait this would never fire.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50);
      scheduler.schedule(cb);
    }

    // maxWait is anchored to the first schedule (t=0), so it fires at t=100.
    // After that fire, a new burst starts, anchored to t=100, so next fire at t=200, etc.
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it("starts a fresh burst after an idle gap longer than maxWaitMs", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({
      debounceMs: 10000,
      maxWaitMs: 500,
    });

    // First burst.
    scheduler.schedule(cb);
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);

    // Idle gap of 2.5s — well past maxWaitMs.
    vi.advanceTimersByTime(2500);

    // New burst should get a full debounce, NOT fire instantly.
    scheduler.schedule(cb);
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(499);
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("debounce wins when the burst ends before maxWaitMs", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({
      debounceMs: 200,
      maxWaitMs: 500,
    });

    scheduler.schedule(cb);
    vi.advanceTimersByTime(100);
    scheduler.schedule(cb);

    // User stops typing. Debounce fires at t=300, before maxWait at t=500.
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);

    // maxWaitTimer should have cleaned itself up; no extra fire at t=500.
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not schedule maxWaitTimer when maxWaitMs is 0", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({ debounceMs: 100, maxWaitMs: 0 });

    scheduler.schedule(cb);
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not schedule maxWaitTimer when maxWaitMs is undefined", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({ debounceMs: 100 });

    scheduler.schedule(cb);
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents pending fires", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({
      debounceMs: 100,
      maxWaitMs: 200,
    });

    scheduler.schedule(cb);
    scheduler.cancel();
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it("creates at most one maxWaitTimer per burst", () => {
    const cb = vi.fn();
    const scheduler = new CompileScheduler({
      debounceMs: 50,
      maxWaitMs: 100,
    });

    scheduler.schedule(cb);
    const timersAfterFirst = vi.getTimerCount();

    scheduler.schedule(cb);
    scheduler.schedule(cb);
    expect(vi.getTimerCount()).toBe(timersAfterFirst);
  });
});
