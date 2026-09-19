/**
 * A small fixed-window rate limiter for public, unauthenticated endpoints —
 * the self-serve signup form, which has no session to hang a per-account
 * throttle off (that is `@mezan/api`'s `login-throttle.ts`, built for a
 * six-digit PIN's keyspace, not this).
 *
 * One window per key: the count resets `windowMs` after the key's FIRST
 * request in the current window, not on a rolling basis — simple, and good
 * enough for "N signups per hour per address/email", which is the whole ask.
 * The map is bounded the same way `login-throttle.ts` bounds its own: oldest
 * windows evicted first, so an unauthenticated flood cannot grow it forever.
 */

const MAX_RECORDS = 10_000;

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /** Seconds the caller must wait before its next attempt may proceed, or 0. */
  retryAfter(key: string): number;
  /** Records one attempt against `key`, whether or not the caller checked `retryAfter` first. */
  consume(key: string): void;
}

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>();

  function evict(at: number) {
    for (const [key, w] of windows) {
      if (at >= w.resetAt) windows.delete(key);
    }
    if (windows.size <= MAX_RECORDS) return;
    const oldestFirst = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldestFirst.slice(0, windows.size - MAX_RECORDS)) windows.delete(key);
  }

  return {
    retryAfter(key) {
      const at = now();
      const w = windows.get(key);
      if (!w || at >= w.resetAt) return 0;
      if (w.count < limit) return 0;
      return Math.ceil((w.resetAt - at) / 1000);
    },
    consume(key) {
      const at = now();
      const existing = windows.get(key);
      if (!existing || at >= existing.resetAt) {
        windows.set(key, { count: 1, resetAt: at + windowMs });
      } else {
        existing.count += 1;
      }
      evict(at);
    },
  };
}
