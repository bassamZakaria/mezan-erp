import { describe, it, expect } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink } from "@mezan/persistence";
import type { AuditQueryFilter, AuditQueryPort, AuditQueryResult } from "@mezan/domain";
import { createAuditRoutes } from "./audit-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const VIEW = "audit.logs.view";

function req(path: string, permissions = VIEW) {
  return new Request(`http://local${path}`, { headers: { "x-permissions": permissions } });
}

function sink() {
  return createSqliteAuditSink(":memory:", { chainKey: "a".repeat(64) });
}

function event(action: string) {
  return createAuditEvent({
    stream: "security",
    module: "auth",
    entityType: "AUTH_USER",
    action,
    actor: "u1",
    severity: "CRITICAL",
    timestamp: "2026-09-07T10:00:00.000Z",
  });
}

/** guards S-3 — a restore used to replace the trail wholesale and nothing noticed. */
describe("GET /audit/verify", () => {
  it("reports an untouched trail as intact", async () => {
    const store = sink();
    try {
      await store.append(event("FIRST"));
      await store.append(event("SECOND"));
      const app = createAuditRoutes(store, insecureHeaderAuthContextResolver);

      const res = await app.fetch(req("/verify"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        checked: 2,
        unchained: 0,
        brokenRowId: null,
        reason: "OK",
      });
    } finally {
      store.close();
    }
  });

  it("names the first broken row after the append-only triggers are dropped", async () => {
    const store = sink();
    try {
      await store.append(event("FIRST"));
      await store.append(event("SECOND"));
      store.db.exec("DROP TRIGGER audit_event_no_update; DROP TRIGGER audit_event_no_delete;");
      store.db.exec("UPDATE audit_event SET actor = 'nobody' WHERE id = 2");

      const app = createAuditRoutes(store, insecureHeaderAuthContextResolver);
      const res = await app.fetch(req("/verify"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: false, reason: "ROW_ALTERED", brokenRowId: 2 });
    } finally {
      store.close();
    }
  });

  it("is gated on audit.logs.view, like the log itself", async () => {
    const store = sink();
    try {
      const app = createAuditRoutes(store, insecureHeaderAuthContextResolver);
      const res = await app.fetch(req("/verify", "sales.invoice.view"));
      expect(res.status).toBe(403);
    } finally {
      store.close();
    }
  });

  it("answers 501 rather than a green tick on a store that cannot verify", async () => {
    const queryOnly: AuditQueryPort = {
      async queryEvents(_filter: AuditQueryFilter): Promise<AuditQueryResult> {
        return { events: [], total: 0 };
      },
    };
    const app = createAuditRoutes(queryOnly, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/verify"));
    expect(res.status).toBe(501);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "UNSUPPORTED" });
  });

  it("does not shadow the filtered log read", async () => {
    const store = sink();
    try {
      await store.append(event("FIRST"));
      const app = createAuditRoutes(store, insecureHeaderAuthContextResolver);
      const res = await app.fetch(req("/?stream=security"));
      expect(res.status).toBe(200);
      expect((await res.json()) as { total: number }).toMatchObject({ total: 1 });
    } finally {
      store.close();
    }
  });
});

describe("GET /audit — item cost written into an event's details (#119)", () => {
  const costEvent = (entityType: string, details: Record<string, unknown>) =>
    createAuditEvent({ stream: "sensitive", module: "inventory", entityType, entityId: `${entityType}-1`, action: "CONFIRM", actor: "u1", severity: "INFO", timestamp: "2026-09-07T10:00:00.000Z", details });

  async function detailsSeenBy(permissions: string) {
    const store = sink();
    await store.append(costEvent("MATERIAL_CONSUMPTION", { docNo: "MC-1", totalCost: "120.000000" }));
    await store.append(costEvent("WRITEDOWN_RUN", { runId: "R-1", totalAmount: "40.000000" }));
    await store.append(costEvent("VAN_TRIP", { cashVariance: "5.000000", stockVariances: [{ itemId: "I-1", varianceQty: "-2", varianceValue: "-30.000000" }], steps: [{ kind: "cash_variance", value: "5.000000" }, { kind: "shortage_adjustment", value: "30.000000" }] }));
    const res = await createAuditRoutes(store, insecureHeaderAuthContextResolver).fetch(req("/", permissions));
    const body = (await res.json()) as { events: { entityType: string; details: Record<string, unknown> }[] };
    return new Map(body.events.map((e) => [e.entityType, e.details]));
  }

  it("drops the cost-valued keys for a reader without inventory.cost.view and keeps the rest", async () => {
    const seen = await detailsSeenBy(VIEW);
    expect(seen.get("MATERIAL_CONSUMPTION")).toEqual({ docNo: "MC-1" });
    expect(seen.get("WRITEDOWN_RUN")).toEqual({ runId: "R-1" });
    expect(seen.get("VAN_TRIP")).toEqual({
      cashVariance: "5.000000",
      stockVariances: [{ itemId: "I-1", varianceQty: "-2" }],
      steps: [{ kind: "cash_variance", value: "5.000000" }, { kind: "shortage_adjustment", value: null }],
    });
  });

  it("keeps them for a holder", async () => {
    const seen = await detailsSeenBy(`${VIEW},inventory.cost.view`);
    expect(seen.get("MATERIAL_CONSUMPTION")?.totalCost).toBe("120.000000");
    expect(seen.get("WRITEDOWN_RUN")?.totalAmount).toBe("40.000000");
    expect(JSON.stringify(seen.get("VAN_TRIP"))).toContain("varianceValue");
    expect(JSON.stringify(seen.get("VAN_TRIP"))).toContain("30.000000");
  });
});
