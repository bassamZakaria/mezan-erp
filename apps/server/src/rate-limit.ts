/**
 * A small fixed-window rate limiter for public, unauthenticated endpoints —
 * the self-serve signup form, which has no session to hang a per-account
 * throttle off (that is `@mezan/api`'s `login-throttle.ts`, built for a
 * six-digit PIN's keyspace, not this).
 *
 * One window per key: the count resets `windowMs` after the key's FIRST
 * request in the current window, not on a rolling basis — simple, and good
 * enough for "N signups per hour per address/email", which is the whole ask.
 * The store is bounded the same way `login-throttle.ts` bounds its own: oldest
 * windows evicted first, so an unauthenticated flood cannot grow it forever.
 *
 * SECURITY: the cloud passes a store in the platform database. With the
 * in-process default, N server instances each grant a caller the full limit.
 */

import type { PlatformHandle } from "@mezan/backend";
import { createSqliteRateWindowStore } from "@mezan/persistence";

const MAX_RECORDS = 10_000;

export interface RateWindow {
  readonly hits: number;
  readonly resetAt: number;
}

export interface RateWindowStore {
  read(key: string, at: number): RateWindow | null;
  hit(key: string, at: number, windowMs: number): void;
  sweep(at: number, maxRecords: number): void;
}

export interface RateLimiter {
  /** Seconds the caller must wait before its next attempt may proceed, or 0. */
  retryAfter(key: string): number;
  /** Records one attempt against `key`, whether or not the caller checked `retryAfter` first. */
  consume(key: string): void;
}

export function createMemoryRateWindowStore(): RateWindowStore {
  const windows = new Map<string, { hits: number; resetAt: number }>();
  return {
    read: (key) => windows.get(key) ?? null,
    hit(key, at, windowMs) {
      const existing = windows.get(key);
      if (!existing || at >= existing.resetAt) windows.set(key, { hits: 1, resetAt: at + windowMs });
      else existing.hits += 1;
    },
    sweep(at, maxRecords) {
      for (const [key, w] of windows) {
        if (at >= w.resetAt) windows.delete(key);
      }
      if (windows.size <= maxRecords) return;
      const oldestFirst = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (const [key] of oldestFirst.slice(0, windows.size - maxRecords)) windows.delete(key);
    },
  };
}

export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
  store: RateWindowStore = createMemoryRateWindowStore(),
): RateLimiter {
  return {
    retryAfter(key) {
      const at = now();
      const w = store.read(key, at);
      if (!w || at >= w.resetAt) return 0;
      if (w.hits < limit) return 0;
      return Math.ceil((w.resetAt - at) / 1000);
    },
    consume(key) {
      const at = now();
      store.hit(key, at, windowMs);
      store.sweep(at, MAX_RECORDS);
    },
  };
}

export function platformRateLimiter(platform: PlatformHandle, scope: string, limit: number, windowMs: number): RateLimiter {
  return createRateLimiter(limit, windowMs, Date.now, createSqliteRateWindowStore(platform.stores.sqlite, scope));
}
