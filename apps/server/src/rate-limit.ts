/**
 * A small fixed-window rate limiter for public, unauthenticated endpoints —
 * the self-serve signup form, which has no session to hang a per-account
 * throttle off (that is `@mezan/api`'s `login-throttle.ts`, built for
 * sign-in guessing, not this).
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
import { createRateWindowStore } from "@mezan/persistence";
import { callerSource } from "./client-source.js";

const MAX_RECORDS = 10_000;

export interface RateWindow {
  readonly hits: number;
  readonly resetAt: number;
}

export interface RateWindowStore {
  read(key: string, at: number): Promise<RateWindow | null>;
  hit(key: string, at: number, windowMs: number): Promise<void>;
  sweep(at: number, maxRecords: number): Promise<void>;
}

export interface RateLimiter {
  /** Seconds the caller must wait before its next attempt may proceed, or 0. */
  retryAfter(key: string): Promise<number>;
  /** Records one attempt against `key`, whether or not the caller checked `retryAfter` first. */
  consume(key: string): Promise<void>;
}

export interface MemoryWindows {
  read(key: string, at: number): RateWindow | null;
  hit(key: string, at: number, windowMs: number): void;
  sweep(at: number, maxRecords: number): void;
}

export function createMemoryWindows(): MemoryWindows {
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

export function createMemoryRateWindowStore(): RateWindowStore {
  const windows = createMemoryWindows();
  return {
    read: async (key, at) => windows.read(key, at),
    hit: async (key, at, windowMs) => windows.hit(key, at, windowMs),
    sweep: async (at, maxRecords) => windows.sweep(at, maxRecords),
  };
}

function secondsLeft(w: RateWindow | null, at: number, limit: number): number {
  if (!w || at >= w.resetAt || w.hits < limit) return 0;
  return Math.ceil((w.resetAt - at) / 1000);
}

export interface RequestLimiter {
  /** Counts the request and answers 0, or answers the seconds to wait and counts nothing. */
  admit(key: string): number;
}

// REQUIRED: synchronous, so no other request runs between the check and the count and two requests on one key can never both slip under the limit.
export function createRequestLimiter(limit: number, windowMs: number, now: () => number = Date.now, maxRecords: number = MAX_RECORDS): RequestLimiter {
  const windows = createMemoryWindows();
  return {
    admit(key) {
      const at = now();
      const wait = secondsLeft(windows.read(key, at), at, limit);
      if (wait > 0) return wait;
      windows.hit(key, at, windowMs);
      windows.sweep(at, maxRecords);
      return 0;
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
    async retryAfter(key) {
      const at = now();
      return secondsLeft(await store.read(key, at), at, limit);
    },
    async consume(key) {
      const at = now();
      await store.hit(key, at, windowMs);
      await store.sweep(at, maxRecords);
    },
  };
}

// SECURITY: any bearer string gets a session window. At the default address cap a caller needs about
// 67 distinct addresses (or /64s) a minute to fill this store and evict real sessions' counts.
export const SESSION_CAP_MAX_RECORDS = 200_000;

export enum RequestCapRefusal {
  TooManyRequests = "TOO_MANY_REQUESTS",
}

export function requestCap(limiter: RequestLimiter, keyOf: (c: Context) => string | null): MiddlewareHandler {
  return async (c, next) => {
    const key = keyOf(c);
    if (key === null) return next();
    const wait = limiter.admit(key);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.json(
        { error: RequestCapRefusal.TooManyRequests, message: "طلبات كثيرة جدًا في وقت قصير، انتظر قليلًا ثم حاول مرة أخرى.", messageEn: "Too many requests in a short time. Wait a moment and try again." },
        429,
      );
    }
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
  return createRateLimiter(limit, windowMs, Date.now, createRateWindowStore(platform.stores.db, scope));
}
