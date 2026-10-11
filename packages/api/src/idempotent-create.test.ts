import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, createAuthContext } from "@mezan/domain";
import { createSqliteAuditSink, createSqliteIdempotentRequestStore, type SqliteAuditSinkHandle } from "@mezan/persistence";
import { connectionTurn } from "./audit-boundary.js";
import { idempotentCreate, type IdempotentRequests } from "./idempotent-create.js";

const sinks: SqliteAuditSinkHandle[] = [];
afterEach(() => {
  for (const sink of sinks.splice(0)) sink.db.close();
});

function mounted(wrap: (store: IdempotentRequests) => IdempotentRequests = (store) => store, now: () => Date = () => new Date("2026-09-14T12:00:00.000Z")) {
  const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
  sinks.push(sink);
  sink.db.exec("CREATE TABLE doc (id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  const caller = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const app = new Hono();
  const idempotent = idempotentCreate({
    requests: wrap(createSqliteIdempotentRequestStore(sink.db)),
    resolveAuthContext: () => caller,
    audit: sink,
    now,
    creates: [{ path: "/docs", read: (id) => `/docs/${id}` }],
    readCurrent: (c, path) => app.fetch(new Request(new URL(path, c.req.url))),
  });
  app.use("/docs", idempotent.replay);
  app.use("*", connectionTurn(sink));
  app.use("/docs", idempotent.record);
  app.post("/docs", async (c) => {
    const body = (await c.req.json()) as { id: string };
    sink.db.prepare("INSERT INTO doc VALUES (?, 'draft')").run(body.id);
    return c.json({ id: body.id, status: "draft" }, 201);
  });
  app.get("/docs/:id", (c) => {
    const row = sink.db.prepare("SELECT id, status FROM doc WHERE id = ?").get(c.req.param("id"));
    return row ? c.json(row) : c.json({ error: "NOT_FOUND" }, 404);
  });
  const create = (body: unknown) => app.fetch(new Request("http://x/docs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const docs = () => (sink.db.prepare("SELECT COUNT(*) AS n FROM doc").get() as { n: number }).n;
  return { create, docs, db: sink.db };
}

describe("a create whose answer could not be kept", () => {
  it("is rolled back and refused in Arabic, so the resend creates it once and is never told 500 for a document that exists", async () => {
    let failing = true;
    const t = mounted((store) => ({
      ...store,
      record: (...args) => {
        if (failing) throw new Error("disk full");
        store.record(...args);
      },
    }));

    const refused = await t.create({ id: "doc-1" });

    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: "IDEMPOTENCY_NOT_RECORDED", message: expect.stringContaining("أعد المحاولة") });
    expect(refused.headers.get("retry-after")).not.toBeNull();
    expect(t.docs()).toBe(0);

    failing = false;
    const resent = await t.create({ id: "doc-1" });
    expect(resent.status).toBe(201);
    expect(t.docs()).toBe(1);
  });

  it("answers a resend with the document as it stands now, and says gone for one that was deleted", async () => {
    const t = mounted();
    await t.create({ id: "doc-1" });
    t.db.prepare("UPDATE doc SET status = 'confirmed' WHERE id = 'doc-1'").run();

    const resent = await t.create({ id: "doc-1" });
    expect(resent.status).toBe(201);
    expect(resent.headers.get("idempotent-replay")).toBe("true");
    expect(await resent.json()).toEqual({ id: "doc-1", status: "confirmed" });

    t.db.prepare("DELETE FROM doc WHERE id = 'doc-1'").run();
    expect((await t.create({ id: "doc-1" })).status).toBe(404);
    expect(t.docs()).toBe(0);
  });

  it("treats the same body with its keys in another order as the same create, and a changed value as another", async () => {
    const t = mounted();
    await t.create({ id: "doc-1", lines: [{ a: 1, b: 2 }], memo: "x" });

    expect((await t.create({ memo: "x", lines: [{ b: 2, a: 1 }], id: "doc-1" })).headers.get("idempotent-replay")).toBe("true");
    const changed = await t.create({ id: "doc-1", lines: [{ a: 1, b: 3 }], memo: "x" });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: "IDEMPOTENCY_KEY_REUSED" });
    const reorderedList = await t.create({ id: "doc-1", lines: [{ b: 2, a: 1 }, { a: 9, b: 9 }], memo: "x" });
    expect(reorderedList.status).toBe(409);
  });
});

describe("how long a recorded answer is kept", () => {
  it("forgets week-old answers on the first create after a start and again each hour, however few creates there are", async () => {
    let clock = new Date("2026-09-14T12:00:00.000Z");
    const forgotten: string[] = [];
    const t = mounted(
      (store) => ({
        ...store,
        forget: (before) => {
          forgotten.push(before);
          return store.forget(before);
        },
      }),
      () => clock,
    );

    await t.create({ id: "doc-1" });
    expect(forgotten).toEqual(["2026-09-07T12:00:00.000Z"]);

    clock = new Date("2026-09-14T12:59:00.000Z");
    await t.create({ id: "doc-2" });
    expect(forgotten).toHaveLength(1);

    clock = new Date("2026-09-14T13:00:01.000Z");
    await t.create({ id: "doc-3" });
    expect(forgotten).toEqual(["2026-09-07T12:00:00.000Z", "2026-09-07T13:00:01.000Z"]);
  });
});
