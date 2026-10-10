import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardCheckoutSweepResult } from "./card-checkout.js";
import { startCardCheckoutSweepTimer } from "./card-checkout-sweep.js";

const nothing: CardCheckoutSweepResult = {
  examined: 0, paid: 0, declined: 0, unapplied: 0, expired: 0, stillPending: 0, alreadySettled: 0,
  needsAttention: 0, unavailable: 0, failed: 0, deferred: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("startCardCheckoutSweepTimer", () => {
  it("sweeps once at boot, again on every interval, and not after stop()", async () => {
    vi.useFakeTimers();
    let sweeps = 0;
    const timer = startCardCheckoutSweepTimer(
      { sweepPending: async () => { sweeps += 1; return nothing; } },
      { intervalMs: 10, onResult: () => undefined },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(sweeps).toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    expect(sweeps).toBe(3);

    timer.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(sweeps).toBe(3);
  });

  it("passes its thresholds to the sweep and hands each result to onResult", async () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    const results: CardCheckoutSweepResult[] = [];
    const timer = startCardCheckoutSweepTimer(
      { sweepPending: async (options) => { seen.push(options); return { ...nothing, examined: 2, paid: 1 }; } },
      { intervalMs: 1000, pendingAfterMs: 5, expireAfterMs: 50, onResult: (result) => results.push(result) },
    );
    await vi.advanceTimersByTimeAsync(0);
    timer.stop();

    expect(seen).toEqual([{ pendingAfterMs: 5, expireAfterMs: 50 }]);
    expect(results).toEqual([{ ...nothing, examined: 2, paid: 1 }]);
  });

  it("reports a failed sweep through onError and keeps the interval alive", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let sweeps = 0;
    const timer = startCardCheckoutSweepTimer(
      { sweepPending: async () => { sweeps += 1; throw new Error("platform database is locked"); } },
      { intervalMs: 10, onError: (err) => errors.push(err) },
    );

    await vi.advanceTimersByTimeAsync(15);
    timer.stop();

    expect(sweeps).toBe(2);
    expect(errors).toHaveLength(2);
  });
});
