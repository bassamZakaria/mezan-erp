import type { Context, MiddlewareHandler } from "hono";
import { DEFAULT_TIME_ZONE, toTenantDay, type SettingsRepository } from "@mezan/domain";

/**
 * Narrowing a wire date to the tenant's calendar day, at the route boundary.
 *
 * The GL engine refuses anything but `YYYY-MM-DD` (`assertEntryDate`) and that
 * invariant stays: a stored instant sorts after the day it belongs to, so it
 * falls outside its own fiscal period and every report that filters on a day.
 * Clients, though, legitimately send instants. The wire schema
 * (`isoDateOrInstant`) accepts both shapes and the conversion happens HERE,
 * because which day an instant falls on depends on the tenant's timezone and
 * a zod `.transform` has no way to read settings.
 *
 * The timezone rides on the request context rather than each route's deps, so
 * it is wired once in `createApp` and a route factory used directly in a test
 * still works — it simply gets the Cairo default.
 */
type TenantDayEnv = { Variables: { tenantTimeZone?: () => Promise<string> } };

const KEY = "tenantTimeZone" as const;

/** Publishes the tenant's timezone to every downstream handler. */
export function tenantTimeZoneMiddleware(settings?: Pick<SettingsRepository, "get">): MiddlewareHandler {
  return async (c, next) => {
    let cached: string | undefined;
    (c as unknown as Context<TenantDayEnv>).set(KEY, async () => {
      cached ??= (await settings?.get())?.timezone || DEFAULT_TIME_ZONE;
      return cached;
    });
    await next();
  };
}

/** The tenant's calendar day for a wire date that may be a day or an instant. */
export async function tenantDay(c: Context, value: string): Promise<string>;
export async function tenantDay(c: Context, value: string | undefined): Promise<string | undefined>;
export async function tenantDay(c: Context, value: string | undefined): Promise<string | undefined> {
  if (value === undefined || value === null) return value;
  const resolve = (c as unknown as Context<TenantDayEnv>).get(KEY);
  return toTenantDay(value, (await resolve?.()) ?? DEFAULT_TIME_ZONE);
}

/** The default day every as-of report and its drill-down share (D281); they must not diverge. */
export async function tenantToday(c: Context, override?: () => string): Promise<string> {
  return override ? override() : tenantDay(c, new Date().toISOString());
}
