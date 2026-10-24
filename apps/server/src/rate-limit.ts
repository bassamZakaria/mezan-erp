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

import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { readSessionToken } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import { createSqliteRateWindowStore } from "@mezan/persistence";
import { callerSource } from "./client-source.js";

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
  // REQUIRED: a key whose window restarts is re-inserted, so with one windowMs per store the Map's
  // order is resetAt order and both sweeps stop at the first live entry instead of scanning all.
  const windows = new Map<string, { hits: number; resetAt: number }>();
  return {
    read: (key) => windows.get(key) ?? null,
    hit(key, at, windowMs) {
      const existing = windows.get(key);
      if (existing && at < existing.resetAt) {
        existing.hits += 1;
        return;
      }
      windows.delete(key);
      windows.set(key, { hits: 1, resetAt: at + windowMs });
    },
    sweep(at, maxRecords) {
      for (const [key, w] of windows) {
        if (at < w.resetAt && windows.size <= maxRecords) return;
        windows.delete(key);
      }
    },
  };
}

export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
  store: RateWindowStore = createMemoryRateWindowStore(),
  maxRecords: number = MAX_RECORDS,
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
      store.sweep(at, maxRecords);
    },
  };
}

// SECURITY: any bearer string gets a session window. At the default address cap a caller needs about
// 67 distinct addresses (or /64s) a minute to fill this store and evict real sessions' counts.
export const SESSION_CAP_MAX_RECORDS = 200_000;

export enum RequestCapRefusal {
  TooManyRequests = "TOO_MANY_REQUESTS",
}

// No await between the check and the count, so concurrent requests on one key can never both slip under the limit.
export function requestCap(limiter: RateLimiter, keyOf: (c: Context) => string | null): MiddlewareHandler {
  return async (c, next) => {
    const key = keyOf(c);
    if (key === null) return next();
    const wait = limiter.retryAfter(key);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.json(
        { error: RequestCapRefusal.TooManyRequests, message: "طلبات كثيرة جدًا في وقت قصير، انتظر قليلًا ثم حاول مرة أخرى.", messageEn: "Too many requests in a short time. Wait a moment and try again." },
        429,
      );
    }
    limiter.consume(key);
    return next();
  };
}

// canonicalOrigin writes IPv6 as 16 byte groups; one subscriber holds a whole /64 and could rotate through it.
export function addressKey(c: Context): string {
  const groups = callerSource(c).split(":");
  return groups.length === 16 ? groups.slice(0, 8).join(":") : groups.join(":");
}

// The token is hashed so the limiter's memory never holds a live credential.
export function sessionKey(c: Context): string | null {
  // REQUIRED: the backend's own reader, so the key is always the credential the backend authenticates.
  const token = readSessionToken(c);
  if (!token) return null;
  return createHash("sha256").update(token).digest("base64url");
}

export function platformRateLimiter(platform: PlatformHandle, scope: string, limit: number, windowMs: number): RateLimiter {
  return createRateLimiter(limit, windowMs, Date.now, createSqliteRateWindowStore(platform.stores.sqlite, scope));
}
