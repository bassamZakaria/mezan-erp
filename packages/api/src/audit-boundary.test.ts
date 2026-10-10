import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, createAuthContext, type AuditEvent, type AuditSink } from "@mezan/domain";
import {
  createSqliteAuditSink,
  createSqliteCostCenterRepository,
  createSqliteUnitOfWork,
  type SqliteAuditSinkHandle,
} from "@mezan/persistence";
import { createApp } from "./app.js";
import { recordAdminEvent } from "./admin-audit.js";
import { AUDITED_MOUNTS, auditBoundary } from "./audit-boundary.js";

type Sqlite = SqliteAuditSinkHandle["db"];

const connections: Sqlite[] = [];

function openSink(chainKey?: string): SqliteAuditSinkHandle {
  const sink = createSqliteAuditSink(":memory:", chainKey ? { chainKey } : {});
  connections.push(sink.db);
  return sink;
}
afterEach(() => {
  for (const sqlite of connections.splice(0)) sqlite.close();
});

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly sink: SqliteAuditSinkHandle;
  readonly costCenters: ReturnType<typeof createSqliteCostCenterRepository>;
  failAppends(times: number): void;
  events(): number;
}

function harness(options: { readonly atomic?: boolean } = {}): Harness {
  const sink = openSink("k".repeat(64));
  const sqlite = sink.db;
  const costCenters = createSqliteCostCenterRepository(sqlite);
  let failing = 0;
  const flaky: AuditSink = {
    async append(event: AuditEvent) {
      if (failing > 0) {
        failing -= 1;
        throw new Error("audit sink unavailable");
      }
      await sink.append(event);
    },
    query: (stream, limit) => sink.query(stream, limit),
    ...(options.atomic === false ? {} : { atomic: <T>(fn: () => Promise<T>) => sink.atomic(fn) }),
  };
  const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const app = createApp(createSqliteUnitOfWork(sqlite), {
    resolveAuthContext: () => ctx,
    costCenterRepo: costCenters,
    auditSink: flaky,
  });
  return {
    app,
    sink,
    costCenters,
    failAppends: (times) => {
      failing = times;
    },
    events: () => (sqlite.prepare("SELECT COUNT(*) AS c FROM audit_event").get() as { c: number }).c,
  };
}

function send(app: Harness["app"], method: string, url: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request(`http://x${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
  );
}

const costCenter = { id: "CC1", code: "CC-100", nameAr: "مركز الإدارة" };

describe("an audited write and its event are one transaction", () => {
  it("records exactly one event for a successful create", async () => {
    const h = harness();
    const res = await send(h.app, "POST", "/cost-centers", costCenter);

    expect(res.status).toBe(201);
    expect(await h.costCenters.list()).toHaveLength(1);
    expect(h.events()).toBe(1);
    expect(await h.sink.verifyChain()).toMatchObject({ ok: true, checked: 1 });
  });

  it("saves nothing and answers 503 when the sink refuses the event", async () => {
    const h = harness();
    h.failAppends(1);
    const res = await send(h.app, "POST", "/cost-centers", costCenter);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "AUDIT_UNAVAILABLE" });
    expect(await h.costCenters.list()).toHaveLength(0);
    expect(h.events()).toBe(0);
  });

  it("leaves an existing entity exactly as it was when the edit cannot be recorded", async () => {
    const h = harness();
    const created = (await (await send(h.app, "POST", "/cost-centers", costCenter)).json()) as { id: string };
    h.failAppends(1);
    const res = await send(h.app, "PATCH", `/cost-centers/${created.id}`, { nameAr: "اسم جديد" });

    expect(res.status).toBe(503);
    expect((await h.costCenters.findById(created.id))?.nameAr).toBe("مركز الإدارة");
    expect(h.events()).toBe(1);
  });

  it("keeps the hash chain valid across a rolled-back attempt", async () => {
    const h = harness();
    await send(h.app, "POST", "/cost-centers", costCenter);
    h.failAppends(1);
    await send(h.app, "POST", "/cost-centers", { ...costCenter, id: "CC2", code: "CC-200" });
    const retried = await send(h.app, "POST", "/cost-centers", { ...costCenter, id: "CC2", code: "CC-200" });

    expect(retried.status).toBe(201);
    expect(await h.costCenters.list()).toHaveLength(2);
    expect(await h.sink.verifyChain()).toEqual({ ok: true, checked: 2, unchained: 0, brokenRowId: null, reason: "OK" });
  });

  it("does not open a transaction for a read", async () => {
    const h = harness();
    h.failAppends(1);
    const res = await h.app.fetch(new Request("http://x/cost-centers"));
    expect(res.status).toBe(200);
  });

  it("still fails the request when the sink cannot share a transaction", async () => {
    const h = harness({ atomic: false });
    h.failAppends(1);
    const res = await send(h.app, "POST", "/cost-centers", costCenter);
    expect(res.status).toBe(500);
  });
});

describe("auditBoundary", () => {
  function tiny(handler: (sink: AuditSink, sqlite: Sqlite) => Hono) {
    const real = openSink();
    const sqlite = real.db;
    sqlite.exec("CREATE TABLE thing (id TEXT PRIMARY KEY)");
    const broken: AuditSink = {
      append: async () => {
        throw new Error("audit sink unavailable");
      },
      query: (stream, limit) => real.query(stream, limit),
      atomic: (fn) => real.atomic(fn),
    };
    const app = new Hono();
    app.use("*", auditBoundary(broken, { onAuditFailure: () => undefined }));
    app.route("/", handler(broken, sqlite));
    const count = () => (sqlite.prepare("SELECT COUNT(*) AS c FROM thing").get() as { c: number }).c;
    return { app, sqlite, count };
  }

  const entry = { module: "admin", entityType: "THING", entityId: "T1", action: "CREATE" };

  it("rolls back and answers 503 even when the handler swallows the audit failure", async () => {
    const t = tiny((sink, sqlite) => {
      const routes = new Hono();
      routes.post("/things", async (c) => {
        sqlite.prepare("INSERT INTO thing VALUES ('T1')").run();
        await recordAdminEvent(sink, c, entry).catch(() => undefined);
        return c.json({ ok: true }, 201);
      });
      return routes;
    });
    const res = await t.app.fetch(new Request("http://x/things", { method: "POST" }));

    expect(res.status).toBe(503);
    expect(t.count()).toBe(0);
  });

  it("keeps a write whose handler failed for a reason other than the audit", async () => {
    const t = tiny((_sink, sqlite) => {
      const routes = new Hono();
      routes.post("/things", async (c) => {
        sqlite.prepare("INSERT INTO thing VALUES ('T1')").run();
        return c.json({ error: "REFUSED" }, 409);
      });
      return routes;
    });
    const res = await t.app.fetch(new Request("http://x/things", { method: "POST" }));

    expect(res.status).toBe(409);
    expect(t.count()).toBe(1);
  });

  it("reports a handler that awaited real I/O inside the transaction", async () => {
    const sink = openSink();
    const sqlite = sink.db;
    const yields: string[] = [];
    const app = new Hono();
    app.use("*", auditBoundary(sink, { onYield: (c) => yields.push(c.req.path) }));
    app.post("/slow", async (c) => {
      await new Promise((resolve) => setImmediate(resolve));
      return c.json({ ok: true });
    });
    app.post("/fast", async (c) => c.json(await c.req.json()));

    await app.fetch(new Request("http://x/slow", { method: "POST" }));
    await app.fetch(
      new Request("http://x/fast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) }),
    );

    expect(yields).toEqual(["/slow"]);
  });

  it("honours a mount's sub-path filter", async () => {
    const sink = openSink();
    const sqlite = sink.db;
    const seen: boolean[] = [];
    const app = new Hono();
    const mount = { prefix: "/eta", only: /^\/item-mappings\// };
    app.use("/eta/*", auditBoundary(sink, mount));
    app.post("/eta/item-mappings/:id", (c) => {
      seen.push(sqlite.inTransaction);
      return c.json({});
    });
    app.post("/eta/submissions/:id/submit", (c) => {
      seen.push(sqlite.inTransaction);
      return c.json({});
    });

    await app.fetch(new Request("http://x/eta/item-mappings/I1", { method: "POST" }));
    await app.fetch(new Request("http://x/eta/submissions/S1/submit", { method: "POST" }));

    expect(seen).toEqual([true, false]);
  });
});

describe("every route file that writes an audit event is under a boundary", () => {
  const MOUNT_OF: Readonly<Record<string, readonly string[]>> = {
    "accounts.ts": ["/accounts"],
    "bank-reconciliation-routes.ts": ["/bank-statements"],
    "cash-forecast-routes.ts": ["/cash-forecast"],
    "cheques-routes.ts": ["/cheques"],
    "cost-centers-routes.ts": ["/cost-centers"],
    "crm-routes.ts": ["/crm"],
    "customers-routes.ts": ["/customers"],
    "data-migration-routes.ts": ["/data-migration"],
    "eta-routes.ts": ["/eta"],
    "exchange-rates-routes.ts": ["/exchange-rates"],
    "fiscal-periods-routes.ts": ["/fiscal-periods"],
    "fixed-assets-routes.ts": ["/assets"],
    "hr-payroll-routes.ts": ["/hr"],
    "hr-self-routes.ts": ["/hr"],
    "hr-time-leave-routes.ts": ["/hr"],
    "item-catalog-routes.ts": ["/item-brands", "/item-seasons"],
    "items-routes.ts": ["/items"],
    "notification-rules-routes.ts": ["/notification-rules"],
    "price-lists-routes.ts": ["/price-lists"],
    "promotions-routes.ts": ["/promotions"],
    "roles-routes.ts": ["/roles"],
    "sales-invoices-routes.ts": ["/sales-invoices"],
    "settings-routes.ts": ["/settings"],
    "suppliers-routes.ts": ["/suppliers"],
    "tax-rates-routes.ts": ["/tax-rates"],
    "treasury-accounts-routes.ts": ["/treasury-accounts"],
    "users-routes.ts": ["/users"],
    "workflow-routes.ts": ["/workflow"],
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const callers = readdirSync(here, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !["admin-audit.ts", "audit-boundary.ts"].includes(file))
    .filter((file) => /\b(recordAdminEvent|recordFieldChanges|recordSecurityAdminEvent)\(/.test(readFileSync(path.join(here, file), "utf8")));

  it("finds the callers it is meant to guard", () => {
    expect(callers.length).toBeGreaterThan(20);
  });

  it.each(callers)("%s is mounted under an audited prefix", (file) => {
    const mounts = MOUNT_OF[file];
    expect(mounts, `${file} records audit events: add its mount to AUDITED_MOUNTS and to this map`).toBeDefined();
    const audited = new Set(AUDITED_MOUNTS.map((mount) => mount.prefix));
    for (const mount of mounts ?? []) expect(audited.has(mount)).toBe(true);
  });
});
