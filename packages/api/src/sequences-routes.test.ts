import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteSequenceStore,
  createSqliteSequenceConfigStore,
  type SqliteSequenceStoreHandle,
  type SqliteSequenceConfigStoreHandle,
} from "@mezan/persistence";
import type { AuditEvent, AuditSink } from "@mezan/domain";
import { createSequencesRoutes, type SequencesRoutesDeps } from "./sequences-routes.js";

const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function fakeAudit(): AuditSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async append(event) {
      events.push(event);
    },
    async query(stream, limit = 100) {
      return events.filter((e) => e.stream === stream).slice(0, limit);
    },
  };
}

function newApp(opts: { now?: () => Date } = {}) {
  const counters = createSqliteSequenceStore();
  const config = createSqliteSequenceConfigStore();
  handles.push(counters, config);
  const audit = fakeAudit();
  const deps: SequencesRoutesDeps = { counters, config, audit, now: opts.now };
  const app = createSequencesRoutes(deps);
  return { app, counters, config, audit };
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function json(res: Response) {
  return res.json();
}

describe("sequences router — permission gates", () => {
  it("refuses GET / to a caller with no permissions", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
  });

  it("refuses GET /:code to a caller holding an unrelated permission from a different module", async () => {
    const { app } = newApp();
    // The catalog grants tiers WITHIN admin.sequences (.edit implies .view), so
    // the genuine negative control has to come from outside that family.
    const res = await app.fetch(req("/SALES_INVOICE", { permissions: "admin.users.view" }));
    expect(res.status).toBe(403);
  });

  it("refuses PATCH to a caller holding only .view — a similar but different permission — and writes nothing", async () => {
    const { app, config } = newApp();
    const res = await app.fetch(
      req("/SALES_INVOICE", {
        method: "PATCH",
        permissions: "admin.sequences.view",
        body: JSON.stringify({ prefix: "XX-" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await config.getOverride("SALES_INVOICE")).toBeNull();
  });

  it("refuses POST /:code/counter to a caller holding only .edit — reset needs its own permission — and writes nothing", async () => {
    const { app, counters } = newApp();
    const before = await counters.peek("SALES_INVOICE", null);
    const res = await app.fetch(
      req("/SALES_INVOICE/counter", {
        method: "POST",
        permissions: "admin.sequences.edit",
        body: JSON.stringify({ value: 50, confirm: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await counters.peek("SALES_INVOICE", null)).toBe(before);
  });
});

describe("sequences router — list & read", () => {
  it("lists every compiled-in sequence with its live counter and formatted preview", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "admin.sequences.view" }));
    expect(res.status).toBe(200);
    const items = (await json(res)) as Array<{
      code: string;
      prefix: string;
      padLength: number;
      currentValue: number;
      nextNumber: string;
      isOverridden: boolean;
    }>;
    const invoice = items.find((i) => i.code === "SALES_INVOICE");
    expect(invoice).toMatchObject({
      code: "SALES_INVOICE",
      prefix: "INV-",
      padLength: 6,
      currentValue: 0,
      nextNumber: "INV-000001",
      isOverridden: false,
    });
  });

  it("404s a code that does not exist in the catalog", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/NOT_A_SEQUENCE", { permissions: "admin.sequences.view" }));
    expect(res.status).toBe(404);
  });

  it("GET /:code reflects a counter already advanced elsewhere", async () => {
    const { app, counters } = newApp();
    await counters.increment("SALES_INVOICE", null);
    await counters.increment("SALES_INVOICE", null);
    const res = await app.fetch(req("/SALES_INVOICE", { permissions: "admin.sequences.view" }));
    const body = (await json(res)) as { currentValue: number; nextNumber: string };
    expect(body.currentValue).toBe(2);
    expect(body.nextNumber).toBe("INV-000003");
  });
});

describe("sequences router — overrides (PATCH)", () => {
  it("rejects a malformed body (empty patch) with 400, and writes nothing", async () => {
    const { app, config } = newApp();
    const res = await app.fetch(
      req("/SALES_INVOICE", { method: "PATCH", permissions: "admin.sequences.edit", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(await config.getOverride("SALES_INVOICE")).toBeNull();
  });

  it("rejects a malformed prefix (over 20 chars) with 400, and writes nothing", async () => {
    const { app, config } = newApp();
    const res = await app.fetch(
      req("/SALES_INVOICE", {
        method: "PATCH",
        permissions: "admin.sequences.edit",
        body: JSON.stringify({ prefix: "X".repeat(21) }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await config.getOverride("SALES_INVOICE")).toBeNull();
  });

  it("rejects a padLength outside 1..12 with 400", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/SALES_INVOICE", {
        method: "PATCH",
        permissions: "admin.sequences.edit",
        body: JSON.stringify({ padLength: 13 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404s a PATCH against an unknown code", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/GHOST", { method: "PATCH", permissions: "admin.sequences.edit", body: JSON.stringify({ prefix: "G-" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("round-trips a prefix override, records an audit event, and reflects it on a later plain GET", async () => {
    const { app, config, audit } = newApp();
    const patchRes = await app.fetch(
      req("/SALES_INVOICE", {
        method: "PATCH",
        permissions: "admin.sequences.edit",
        userId: "u-admin",
        body: JSON.stringify({ prefix: "SI-" }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const patched = (await json(patchRes)) as { prefix: string; isOverridden: boolean; nextNumber: string };
    expect(patched.prefix).toBe("SI-");
    expect(patched.isOverridden).toBe(true);
    expect(patched.nextNumber).toBe("SI-000001");

    expect(await config.getOverride("SALES_INVOICE")).toEqual({ prefix: "SI-" });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ action: "SEQUENCE_CONFIG_UPDATED", actor: "u-admin", entityId: "SALES_INVOICE" });

    const getRes = await app.fetch(req("/SALES_INVOICE", { permissions: "admin.sequences.view" }));
    expect(((await json(getRes)) as { prefix: string }).prefix).toBe("SI-");
  });

  it("a PARTIAL override does not wipe a field set by an earlier PATCH", async () => {
    const { app, config } = newApp();
    await app.fetch(
      req("/SALES_INVOICE", { method: "PATCH", permissions: "admin.sequences.edit", body: JSON.stringify({ prefix: "SI-" }) }),
    );
    const second = await app.fetch(
      req("/SALES_INVOICE", { method: "PATCH", permissions: "admin.sequences.edit", body: JSON.stringify({ padLength: 8 }) }),
    );
    expect(second.status).toBe(200);
    const body = (await json(second)) as { prefix: string; padLength: number };
    // padLength changed; prefix from the FIRST patch must have survived.
    expect(body.padLength).toBe(8);
    expect(body.prefix).toBe("SI-");
    expect(await config.getOverride("SALES_INVOICE")).toEqual({ prefix: "SI-", padLength: 8 });
  });

  it("round-trips annualReset and branchScoped flags", async () => {
    const { app, config } = newApp();
    const res = await app.fetch(
      req("/PURCHASE_ORDER", {
        method: "PATCH",
        permissions: "admin.sequences.edit",
        body: JSON.stringify({ annualReset: true, branchScoped: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await json(res)) as { annualReset: boolean; branchScoped: boolean };
    expect(body.annualReset).toBe(true);
    expect(body.branchScoped).toBe(true);
    expect(await config.getOverride("PURCHASE_ORDER")).toEqual({ annualReset: true, branchScoped: true });
  });

  it("an annualReset override scopes the counter to the calendar year, independent of other years", async () => {
    const y2026 = () => new Date("2026-06-01T00:00:00.000Z");
    const y2027 = () => new Date("2027-01-15T00:00:00.000Z");
    const { app, counters, config } = newApp({ now: y2026 });
    await app.fetch(
      req("/PURCHASE_ORDER", { method: "PATCH", permissions: "admin.sequences.edit", body: JSON.stringify({ annualReset: true }) }),
    );
    // Two numbers drawn against the 2026 period.
    await counters.increment("PURCHASE_ORDER", 2026);
    await counters.increment("PURCHASE_ORDER", 2026);

    const res2026 = await app.fetch(req("/PURCHASE_ORDER", { permissions: "admin.sequences.view" }));
    expect(((await json(res2026)) as { currentValue: number }).currentValue).toBe(2);

    // The SAME app, but reporting "now" as 2027 (a fresh year), must read an
    // unrelated (empty) counter — the year is baked into the period key.
    const app2027 = createSequencesRoutes({ counters, config, now: y2027 });
    const res2027 = await app2027.fetch(req("/PURCHASE_ORDER", { permissions: "admin.sequences.view" }));
    expect(((await json(res2027)) as { currentValue: number; nextNumber: string }).currentValue).toBe(0);
  });
});

describe("sequences router — counter reset (POST /:code/counter)", () => {
  it("404s a reset against an unknown code", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/GHOST/counter", { method: "POST", permissions: "admin.sequences.reset", body: JSON.stringify({ value: 5, confirm: true }) }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a body missing confirm:true with 400, and writes nothing", async () => {
    const { app, counters } = newApp();
    const res = await app.fetch(
      req("/SALES_INVOICE/counter", { method: "POST", permissions: "admin.sequences.reset", body: JSON.stringify({ value: 5 }) }),
    );
    expect(res.status).toBe(400);
    expect(await counters.peek("SALES_INVOICE", null)).toBe(0);
  });

  it("rejects confirm:false explicitly, and a negative value, both with 400", async () => {
    const { app } = newApp();
    const resFalse = await app.fetch(
      req("/SALES_INVOICE/counter", { method: "POST", permissions: "admin.sequences.reset", body: JSON.stringify({ value: 5, confirm: false }) }),
    );
    expect(resFalse.status).toBe(400);
    const resNeg = await app.fetch(
      req("/SALES_INVOICE/counter", { method: "POST", permissions: "admin.sequences.reset", body: JSON.stringify({ value: -1, confirm: true }) }),
    );
    expect(resNeg.status).toBe(400);
  });

  it("refuses to roll the counter BELOW numbers already issued — the no-duplicate invariant", async () => {
    const { app, counters } = newApp();
    // Three documents already exist: INV-000001, INV-000002, INV-000003.
    await counters.increment("SALES_INVOICE", null);
    await counters.increment("SALES_INVOICE", null);
    await counters.increment("SALES_INVOICE", null);

    const res = await app.fetch(
      req("/SALES_INVOICE/counter", {
        method: "POST",
        permissions: "admin.sequences.reset",
        body: JSON.stringify({ value: 1, confirm: true }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)) as { error: string; currentValue: number }).toMatchObject({
      error: "COUNTER_ROLLBACK_REJECTED",
      currentValue: 3,
    });
    // The counter itself did not move, so the next number is still 4 — a
    // rollback to 1 would have made the NEXT draw reissue INV-000002.
    expect(await counters.peek("SALES_INVOICE", null)).toBe(3);
    const getRes = await app.fetch(req("/SALES_INVOICE", { permissions: "admin.sequences.view" }));
    expect(((await json(getRes)) as { nextNumber: string }).nextNumber).toBe("INV-000004");
  });

  it("accepts a reset to exactly the current value (a no-op that is still allowed) and to a higher value", async () => {
    const { app, counters, audit } = newApp();
    await counters.increment("SALES_INVOICE", null);
    await counters.increment("SALES_INVOICE", null);
    await counters.increment("SALES_INVOICE", null);

    const same = await app.fetch(
      req("/SALES_INVOICE/counter", { method: "POST", permissions: "admin.sequences.reset", userId: "u-owner", body: JSON.stringify({ value: 3, confirm: true }) }),
    );
    expect(same.status).toBe(200);
    expect(await counters.peek("SALES_INVOICE", null)).toBe(3);

    const higher = await app.fetch(
      req("/SALES_INVOICE/counter", { method: "POST", permissions: "admin.sequences.reset", body: JSON.stringify({ value: 100, confirm: true }) }),
    );
    expect(higher.status).toBe(200);
    expect(await counters.peek("SALES_INVOICE", null)).toBe(100);
    const body = (await json(higher)) as { nextNumber: string; currentValue: number };
    expect(body.currentValue).toBe(100);
    expect(body.nextNumber).toBe("INV-000101");

    expect(audit.events.filter((e) => e.action === "SEQUENCE_COUNTER_ADJUSTED")).toHaveLength(2);
    expect(audit.events.find((e) => e.actor === "u-owner")).toMatchObject({
      details: { code: "SALES_INVOICE", from: 3, to: 3 },
    });
  });
});

describe("sequences router — atomic draws never collide", () => {
  it("concurrent draws against the same counter each get a distinct, gap-free value", async () => {
    const { counters } = newApp();
    const draws = await Promise.all(Array.from({ length: 25 }, () => counters.increment("SALES_INVOICE", null)));
    const unique = new Set(draws);
    expect(unique.size).toBe(25);
    // Gap-free: the values are exactly 1..25 in some order.
    expect([...unique].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(await counters.peek("SALES_INVOICE", null)).toBe(25);
  });
});
