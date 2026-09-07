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
