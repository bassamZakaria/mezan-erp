import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, createAuthContext, type AuditEvent, type AuditSink } from "@mezan/domain";
import {
  createSqliteAuditSink,
  createSqliteBranchStore,
  createSqliteCostCenterRepository,
  createSqliteUnitOfWork,
  type SqliteAuditSinkHandle,
} from "@mezan/persistence";
import { createApp } from "./app.js";
import { recordAdminEvent } from "./admin-audit.js";
import { AUDITED_MOUNTS, auditBoundary, beforeTheTurn, connectionTurn } from "./audit-boundary.js";

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
  readonly branches: ReturnType<typeof createSqliteBranchStore>;
  readonly users: ReturnType<typeof createSqliteUnitOfWork>["users"];
  failAppends(times: number): void;
  events(): number;
}

function harness(options: { readonly atomic?: boolean } = {}): Harness {
  const sink = openSink("k".repeat(64));
  const sqlite = sink.db;
  const costCenters = createSqliteCostCenterRepository(sqlite);
  const branches = createSqliteBranchStore(sqlite);
  const uow = createSqliteUnitOfWork(sqlite);
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
    ...(options.atomic === false
      ? {}
      : {
          atomic: <T>(fn: () => Promise<T>) => sink.atomic(fn),
          insideTransaction: () => sink.insideTransaction(),
          settled: () => sink.settled(),
          turn: <T>(fn: () => Promise<T>) => sink.turn(fn),
        }),
  };
  const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const app = createApp(uow, {
    resolveAuthContext: () => ctx,
    costCenterRepo: costCenters,
    branchStore: branches,
    auditSink: flaky,
  });
  return {
    app,
    sink,
    costCenters,
    branches,
    users: uow.users,
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

  const newUser = {
    nameAr: "محمد الشهابي", nameEn: null, email: "mohamed@cyag.test", phone: null, password: "TempPass123", roleId: null,
    isCompanyAdmin: true, employeeId: null, branchScope: "*", warehouseScope: "*", acknowledge: true, reason: "مدير المنشأة",
  };
  const branch = { id: "B-OVERLAP", code: "OVR", name: "فرع التداخل" };

  it("keeps another request's acknowledged write when an overlapping audited request rolls back", async () => {
    const h = harness();
    h.failAppends(1);

    const rolledBack = send(h.app, "POST", "/users", newUser);
    const overlapping = send(h.app, "POST", "/branches", branch);
    const [userRes, branchRes] = await Promise.all([rolledBack, overlapping]);

    expect(userRes.status).toBe(503);
    expect(await h.users.list()).toHaveLength(0);
    expect(branchRes.status).toBe(201);
    expect(await h.branches.findById("B-OVERLAP")).not.toBeNull();
  });

  it("creates a user without giving the event loop away inside the transaction", async () => {
    const h = harness();
    const res = await send(h.app, "POST", "/users", { ...newUser, pin: "482913" });

    expect(res.status).toBe(201);
    expect(await h.users.list()).toHaveLength(1);
    expect(h.events()).toBeGreaterThanOrEqual(1);
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

  it("rolls back a handler that writes and then throws, so a 500 never leaves half a change behind", async () => {
    const t = tiny((_sink, sqlite) => {
      const routes = new Hono();
      routes.post("/things", async () => {
        sqlite.prepare("INSERT INTO thing VALUES ('T1')").run();
        throw new Error("a bug further down the handler");
      });
      routes.onError((_err, c) => c.json({ error: "INTERNAL" }, 500));
      return routes;
    });
    const res = await t.app.fetch(new Request("http://x/things", { method: "POST" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL" });
    expect(t.count()).toBe(0);
    expect(t.sqlite.inTransaction).toBe(false);
  });

  it("rolls back a handler that writes and then answers 500 itself", async () => {
    const t = tiny((_sink, sqlite) => {
      const routes = new Hono();
      routes.post("/things", (c) => {
        sqlite.prepare("INSERT INTO thing VALUES ('T1')").run();
        return c.json({ error: "UPSTREAM" }, 502);
      });
      return routes;
    });
    const res = await t.app.fetch(new Request("http://x/things", { method: "POST" }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "UPSTREAM" });
    expect(t.count()).toBe(0);
  });

  it("rolls back when the app's own error handler, not the route's, answers the throw", async () => {
    const real = openSink();
    real.db.exec("CREATE TABLE thing (id TEXT PRIMARY KEY)");
    const app = new Hono();
    app.use("*", auditBoundary(real));
    app.post("/things", () => {
      real.db.prepare("INSERT INTO thing VALUES ('T1')").run();
      throw new Error("a bug further down the handler");
    });
    app.onError((_err, c) => c.json({ error: "INTERNAL" }, 500));

    const res = await app.fetch(new Request("http://x/things", { method: "POST" }));

    expect(res.status).toBe(500);
    expect(real.db.prepare("SELECT COUNT(*) AS c FROM thing").get()).toEqual({ c: 0 });
    expect(real.db.inTransaction).toBe(false);
  });

  const yieldingApp = (options: Parameters<typeof auditBoundary>[1], wrap: (sink: SqliteAuditSinkHandle) => AuditSink = (sink) => sink) => {
    const sink = openSink();
    const sqlite = sink.db;
    sqlite.exec("CREATE TABLE thing (id TEXT PRIMARY KEY)");
    const app = new Hono();
    const audit = wrap(sink);
    app.use("*", auditBoundary(audit, options));
    app.post("/slow", async (c) => {
      sqlite.prepare("INSERT INTO thing VALUES ('SLOW')").run();
      await new Promise((resolve) => setImmediate(resolve));
      return c.json({ ok: true });
    });
    app.post("/slow-and-unrecorded", async (c) => {
      sqlite.prepare("INSERT INTO thing VALUES ('SLOW')").run();
      await new Promise((resolve) => setImmediate(resolve));
      await recordAdminEvent(audit, c, entry).catch(() => undefined);
      return c.json({ ok: true });
    });
    app.post("/fast", async (c) => {
      sqlite.prepare("INSERT INTO thing VALUES ('FAST')").run();
      return c.json(await c.req.json());
    });
    const ids = () => (sqlite.prepare("SELECT id FROM thing ORDER BY id").all() as { id: string }[]).map((row) => row.id);
    return { app, ids };
  };

  it("refuses and rolls back a handler that gives the event loop away inside the transaction", async () => {
    const yields: string[] = [];
    const t = yieldingApp({ onYield: (c) => yields.push(c.req.path) });

    const res = await t.app.fetch(new Request("http://x/slow", { method: "POST" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "AUDIT_BOUNDARY_YIELDED" });
    expect(t.ids()).toEqual([]);
    expect(yields).toEqual(["/slow"]);
  });

  it("refuses a yield by default, so a test run goes red on it", async () => {
    const t = yieldingApp({ onYield: () => undefined });
    expect((await t.app.fetch(new Request("http://x/slow", { method: "POST" }))).status).toBe(500);
  });

  it("refuses a yield on a production build exactly as it does under test", async () => {
    const before = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const t = yieldingApp({ onYield: () => undefined });

      const res = await t.app.fetch(new Request("http://x/slow", { method: "POST" }));

      expect(res.status).toBe(500);
      expect(t.ids()).toEqual([]);
    } finally {
      if (before === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = before;
    }
  });

  it("reports the yield and answers 503 when a handler both yields and cannot be recorded", async () => {
    const yields: string[] = [];
    const failures: unknown[] = [];
    const t = yieldingApp(
      { onYield: (c) => yields.push(c.req.path), onAuditFailure: (err) => failures.push(err) },
      (sink) => ({
        append: async () => {
          throw new Error("audit sink unavailable");
        },
        query: (stream, limit) => sink.query(stream, limit),
        atomic: (fn) => sink.atomic(fn),
      }),
    );

    const res = await t.app.fetch(new Request("http://x/slow-and-unrecorded", { method: "POST" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "AUDIT_UNAVAILABLE" });
    expect(t.ids()).toEqual([]);
    expect(yields).toEqual(["/slow-and-unrecorded"]);
    expect(failures).toHaveLength(1);
  });

  it.each([
    ["a JSON body", { "content-type": "application/json" }],
    ["a body sent with no content type at all", {} as Record<string, string>],
    ["a body mislabelled as text", { "content-type": "text/plain" }],
  ])("reads %s before the transaction opens, so reading it is not a yield", async (_label, headers) => {
    const t = yieldingApp({ onYield: () => undefined });

    const res = await t.app.fetch(new Request("http://x/fast", { method: "POST", headers, body: JSON.stringify({ a: 1 }) }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
    expect(t.ids()).toEqual(["FAST"]);
  });

  it("runs a mount's preparation before the connection is taken and its release after the request", async () => {
    const sink = openSink();
    const order: string[] = [];
    let holdingTheTurn = false;
    const watched: AuditSink = {
      append: (event) => sink.append(event),
      query: (stream, limit) => sink.query(stream, limit),
      atomic: (fn) => sink.atomic(fn),
      settled: () => sink.settled(),
      turn: (fn) =>
        sink.turn(async () => {
          holdingTheTurn = true;
          try {
            return await fn();
          } finally {
            holdingTheTurn = false;
          }
        }),
    };
    const app = new Hono();
    app.use(
      "*",
      beforeTheTurn(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        order.push(`prepared holding the connection: ${holdingTheTurn}`);
        return () => order.push("released");
      }),
    );
    app.use("*", connectionTurn(watched));
    app.use("*", auditBoundary(watched));
    app.post("/things", (c) => {
      order.push(`handled holding the connection: ${holdingTheTurn}, in transaction: ${sink.db.inTransaction}`);
      return c.json({});
    });

    const res = await app.fetch(new Request("http://x/things", { method: "POST" }));

    expect(res.status).toBe(200);
    expect(order).toEqual([
      "prepared holding the connection: false",
      "handled holding the connection: true, in transaction: true",
      "released",
    ]);
  });

  it("matches a mount's sub-path from the mount, not from the first place its name appears", async () => {
    const sink = openSink();
    const seen: boolean[] = [];
    const app = new Hono();
    app.use("/items/*", auditBoundary(sink, { prefix: "/items", only: /^(\/[^/]*)?$/ }));
    app.post("/items/:id", (c) => {
      seen.push(sink.db.inTransaction);
      return c.json({});
    });
    app.post("/items/:id/items/:child", (c) => {
      seen.push(sink.db.inTransaction);
      return c.json({});
    });
    const based = new Hono().route("/items", app);

    await based.fetch(new Request("http://x/items/items/I1", { method: "POST" }));
    await based.fetch(new Request("http://x/items/items/I1/items/I2", { method: "POST" }));

    expect(seen).toEqual([true, false]);
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

describe("an audit event on a mutating request must share a transaction with its write", () => {
  const entry = { module: "admin", entityType: "THING", entityId: "T1", action: "CREATE" };

  function unguarded(register: (app: Hono, sink: SqliteAuditSinkHandle) => void) {
    const sink = openSink();
    const errors: unknown[] = [];
    const app = new Hono();
    register(app, sink);
    app.onError((err, c) => {
      errors.push(err);
      return c.json({ error: "INTERNAL" }, 500);
    });
    const events = () => (sink.db.prepare("SELECT COUNT(*) AS c FROM audit_event").get() as { c: number }).c;
    return { app, errors, events };
  }

  it("refuses the event from a handler that sits outside every boundary, and names the route", async () => {
    const t = unguarded((app, sink) => {
      app.post("/assets/:id/dispose", async (c) => {
        await recordAdminEvent(sink, c, entry);
        return c.json({}, 201);
      });
    });

    const res = await t.app.fetch(new Request("http://x/assets/A1/dispose", { method: "POST" }));

    expect(res.status).toBe(500);
    expect(t.events()).toBe(0);
    expect(String(t.errors[0])).toContain("POST /assets/A1/dispose recorded an audit event outside any transaction");
  });

  it("refuses it under a mount whose sub-path filter does not name the handler", async () => {
    const t = unguarded((app, sink) => {
      app.use("/assets/*", auditBoundary(sink, { prefix: "/assets", only: /^\/[^/]+\/internal-hourly-rate$/ }));
      app.post("/assets/:id/dispose", async (c) => {
        await recordAdminEvent(sink, c, entry);
        return c.json({}, 201);
      });
    });

    expect((await t.app.fetch(new Request("http://x/assets/A1/dispose", { method: "POST" }))).status).toBe(500);
    expect(t.events()).toBe(0);
  });

  it("accepts it inside the handler's own transaction on the sink's connection", async () => {
    const t = unguarded((app, sink) => {
      app.post("/things", async (c) => {
        await sink.atomic(() => recordAdminEvent(sink, c, entry));
        return c.json({}, 201);
      });
    });

    expect((await t.app.fetch(new Request("http://x/things", { method: "POST" }))).status).toBe(201);
    expect(t.events()).toBe(1);
  });

  it("accepts it on a read, which changes nothing to keep in step with", async () => {
    const t = unguarded((app, sink) => {
      app.get("/things", async (c) => {
        await recordAdminEvent(sink, c, entry);
        return c.json({});
      });
    });

    expect((await t.app.fetch(new Request("http://x/things"))).status).toBe(200);
    expect(t.events()).toBe(1);
  });

  it("registers no mount twice", () => {
    const prefixes = AUDITED_MOUNTS.map((mount) => mount.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("connectionTurn", () => {
  function gated(options: Parameters<typeof connectionTurn>[1] = {}) {
    const sink = openSink();
    const sqlite = sink.db;
    sqlite.exec("CREATE TABLE thing (id TEXT PRIMARY KEY)");
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const app = new Hono();
    app.get("/health", (c) => c.json({ ok: true }));
    app.use("*", connectionTurn(sink, options));
    app.use("/audited/*", auditBoundary(sink, { onYield: () => undefined, onAuditFailure: () => undefined }));
    app.post("/audited/slow", async (c) => {
      sqlite.prepare("INSERT INTO thing VALUES ('UNCOMMITTED')").run();
      await held;
      return c.json({});
    });
    app.post("/busy-without-a-transaction", async (c) => {
      await held;
      return c.json({});
    });
    app.post("/plain", (c) => {
      sqlite.prepare("INSERT INTO thing VALUES ('ACKNOWLEDGED')").run();
      return c.json({}, 201);
    });
    app.post("/plain-after-a-wait", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      sqlite.prepare("INSERT INTO thing VALUES ('ACKNOWLEDGED')").run();
      return c.json({}, 201);
    });
    app.post("/audited/unrecorded-after-a-wait", async (c) => {
      sqlite.prepare("INSERT INTO thing VALUES ('UNCOMMITTED')").run();
      await new Promise((resolve) => setTimeout(resolve, 25));
      await recordAdminEvent(broken(sink), c, { module: "admin", entityType: "THING", entityId: "T1", action: "CREATE" }).catch(() => undefined);
      return c.json({});
    });
    app.get("/things", (c) => c.json((sqlite.prepare("SELECT id FROM thing ORDER BY id").all() as { id: string }[]).map((row) => row.id)));
    app.onError((_err, c) => c.json({ error: "INTERNAL" }, 500));
    const post = (path: string) => Promise.resolve(app.fetch(new Request(`http://x${path}`, { method: "POST" })));
    const get = (path: string) => Promise.resolve(app.fetch(new Request(`http://x${path}`)));
    const list = async () => (await (await get("/things")).json()) as string[];
    const stored = () => (sqlite.prepare("SELECT id FROM thing ORDER BY id").all() as { id: string }[]).map((row) => row.id);
    return { sink, sqlite, post, get, list, stored, finish };
  }

  function broken(sink: SqliteAuditSinkHandle): AuditSink {
    return {
      append: async () => {
        throw new Error("audit sink unavailable");
      },
      query: (stream, limit) => sink.query(stream, limit),
      atomic: (fn) => sink.atomic(fn),
    };
  }

  const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
  const stillWaiting = (pending: Promise<unknown>) => Promise.race([pending.then(() => "answered"), nextTurn().then(() => "waiting")]);

  it("holds a read back until the open transaction ends, so it never lists an uncommitted row", async () => {
    const t = gated();
    const slow = t.post("/audited/slow");
    await nextTurn();
    expect(t.sqlite.inTransaction).toBe(true);

    let listed: string[] | undefined;
    const reading = t.list().then((ids) => {
      listed = ids;
    });
    await nextTurn();
    expect(listed).toBeUndefined();

    t.finish();
    await Promise.all([slow, reading]);
    expect(listed).toEqual([]);
  });

  it("holds a write back too, so it cannot land inside another request's transaction", async () => {
    const t = gated();
    const slow = t.post("/audited/slow");
    await nextTurn();

    const plain = t.post("/plain");
    await nextTurn();
    expect(await stillWaiting(plain)).toBe("waiting");

    t.finish();
    expect((await plain).status).toBe(201);
    expect((await slow).status).toBe(500);
    expect(t.stored()).toEqual(["ACKNOWLEDGED"]);
  });

  it.each(["test", "production"])(
    "keeps a write that got in first and then waited, when the transaction it overlapped rolls back (NODE_ENV=%s)",
    async (runtime) => {
      const before = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = runtime;
      try {
        const t = gated();

        const plain = t.post("/plain-after-a-wait");
        const audited = t.post("/audited/unrecorded-after-a-wait");
        const [plainRes, auditedRes] = await Promise.all([plain, audited]);

        expect(plainRes.status).toBe(201);
        expect(auditedRes.status).toBe(503);
        expect(t.stored()).toEqual(["ACKNOWLEDGED"]);
      } finally {
        if (before === undefined) delete process.env["NODE_ENV"];
        else process.env["NODE_ENV"] = before;
      }
    },
  );

  it("lets a read through while a write holds the connection with no transaction open", async () => {
    const t = gated();
    const busy = t.post("/busy-without-a-transaction");
    await nextTurn();

    expect(await t.list()).toEqual([]);

    t.finish();
    expect((await busy).status).toBe(200);
  });

  it("answers the liveness probe at once while a transaction is open", async () => {
    const t = gated();
    const slow = t.post("/audited/slow");
    await nextTurn();
    expect(t.sqlite.inTransaction).toBe(true);

    const res = await t.get("/health");

    expect(res.status).toBe(200);
    expect(t.sqlite.inTransaction).toBe(true);
    t.finish();
    await slow;
  });

  it("answers 503 in Arabic and English when the request ahead never finishes", async () => {
    const t = gated({ timeoutMs: 20 });
    const slow = t.post("/audited/slow");
    await nextTurn();

    const write = await t.post("/plain");
    const read = await t.get("/things");

    expect(write.status).toBe(503);
    expect(read.status).toBe(503);
    expect(await write.json()).toMatchObject({ error: "DATABASE_BUSY", message: expect.any(String), messageEn: expect.any(String) });
    expect(write.headers.get("x-busy-reason")).toBe("timed-out");
    t.finish();
    await slow;
    expect(t.stored()).toEqual([]);
  });

  it("never runs a write that gave up waiting, once the connection frees", async () => {
    const t = gated({ timeoutMs: 20 });
    const slow = t.post("/audited/slow");
    await nextTurn();
    expect((await t.post("/plain")).status).toBe(503);

    t.finish();
    await slow;
    await nextTurn();

    expect(t.stored()).toEqual([]);
    expect((await t.post("/plain")).status).toBe(201);
  });

  it("refuses at once, without queueing, past the bound on waiting requests", async () => {
    const t = gated({ maxWaiting: 2 });
    const slow = t.post("/audited/slow");
    await nextTurn();
    const first = t.post("/plain");
    const second = t.get("/things");
    await nextTurn();

    const overflow = await t.get("/things");

    expect(overflow.status).toBe(503);
    expect(overflow.headers.get("x-busy-reason")).toBe("queue-full");
    expect((await t.get("/health")).status).toBe(200);
    t.finish();
    expect((await first).status).toBe(201);
    expect((await second).status).toBe(200);
    await slow;
    expect((await t.get("/things")).status).toBe(200);
  });

  it("reports a request that has held the connection too long, naming it", async () => {
    const reported: string[] = [];
    const t = gated({ heldWarningMs: 5, onHeldTooLong: (c) => reported.push(`${c.req.method} ${c.req.path}`) });
    const slow = t.post("/audited/slow");

    await new Promise((resolve) => setTimeout(resolve, 30));
    t.finish();
    await slow;

    expect(reported[0]).toBe("POST /audited/slow");
  });

  it("lets a request made from inside the transaction straight through", async () => {
    const sink = openSink();
    const app = new Hono();
    app.use("*", connectionTurn(sink, { timeoutMs: 20 }));
    app.get("/inner", (c) => c.json({ inner: true }));
    app.post("/inner", (c) => c.json({ inner: true }));
    app.post("/outer", async (c) =>
      c.json(
        await sink.atomic(async () => [
          await (await app.fetch(new Request("http://x/inner"))).json(),
          await (await app.fetch(new Request("http://x/inner", { method: "POST" }))).json(),
        ]),
      ),
    );

    const res = await app.fetch(new Request("http://x/outer", { method: "POST" }));

    expect(await res.json()).toEqual([{ inner: true }, { inner: true }]);
  });
});
