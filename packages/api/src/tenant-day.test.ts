import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createDefaultSettings, type TenantSettings } from "@mezan/domain";
import { tenantDay, tenantTimeZoneMiddleware } from "./tenant-day.js";

function appWithZone(timezone: string | null) {
  const app = new Hono();
  const store = timezone === null
    ? undefined
    : { get: async (): Promise<TenantSettings> => ({ ...createDefaultSettings(), timezone }) };
  app.use("*", tenantTimeZoneMiddleware(store));
  app.get("/day", async (c) => c.json({ day: await tenantDay(c, c.req.query("at")!) }));
  return app;
}

async function day(timezone: string | null, at: string) {
  const res = await appWithZone(timezone).fetch(
    new Request(`http://local/day?at=${encodeURIComponent(at)}`),
  );
  return ((await res.json()) as { day: string }).day;
}

describe("tenantTimeZoneMiddleware + tenantDay", () => {
  it("resolves an instant in the tenant's configured zone", async () => {
    expect(await day("Africa/Cairo", "2026-09-30T23:59:59.999Z")).toBe("2026-10-01");
    expect(await day("America/New_York", "2026-09-30T23:59:59.999Z")).toBe("2026-09-30");
    expect(await day("Pacific/Auckland", "2026-09-30T23:59:59.999Z")).toBe("2026-10-01");
  });

  it("falls back to Cairo when no settings store is mounted", async () => {
    expect(await day(null, "2026-09-30T23:59:59.999Z")).toBe("2026-10-01");
    expect(await day(null, "2026-09-30T20:00:00.000Z")).toBe("2026-09-30");
  });

  it("leaves a day-shaped value untouched whatever the zone", async () => {
    expect(await day("Pacific/Auckland", "2026-09-30")).toBe("2026-09-30");
  });

  it("does not brick posting when the tenant's zone is a typo", async () => {
    expect(await day("Afrika/Kairo", "2026-09-30T23:59:59.999Z")).toBe("2026-09-30");
  });
});
