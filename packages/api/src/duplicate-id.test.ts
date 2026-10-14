import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DuplicateRecordIdError, RecordErrorCode } from "@mezan/domain";
import type { ConfigTransactor } from "./config-transactor.js";
import { duplicateIdRefusal, refusedCreateRollsBack } from "./duplicate-id.js";

const CREATE_ROUTES: ReadonlySet<string> = new Set(["/made", "/refused", "/thrown", "/invalid", "/forbidden", "/half-done", "/half-done-then-failed", "/forbidden-after-a-number", "/numbered-then-failed"]);

const INJECTED_IDS: readonly (readonly [string, unknown])[] = [
  ["no id", {}],
  ["an id key", { id: "x" }],
  ["an id key one object down", { z: { id: "x" } }],
];

function harness() {
  const rows = new Map<string, string>();
  let transactions = 0;
  const transactor: ConfigTransactor = {
    async run(fn) {
      transactions += 1;
      const before = new Map(rows);
      try {
        return await fn();
      } catch (err) {
        rows.clear();
        for (const [key, value] of before) rows.set(key, value);
        throw err;
      }
    },
  };
  const app = new Hono();
  app.use("*", refusedCreateRollsBack(transactor, () => rows.get("number") ?? "", CREATE_ROUTES));
  app.post("/users/:id/deactivate", async (c) => {
    rows.set("audit", "refused: outside the caller's branches");
    return c.json({ error: "USER_NOT_FOUND" }, 404);
  });
  app.post("/documents/:id/confirm", async (c) => {
    rows.set("confirmed", "after a call to the tax authority");
    return c.json({ ok: true }, 200);
  });
  app.post("/made", async (c) => {
    rows.set("number", "DOC-0001");
    return c.json({ ok: true }, 201);
  });
  app.post("/refused", async (c) => {
    rows.set("number", "DOC-0001");
    return duplicateIdRefusal(c, new DuplicateRecordIdError("X-1"));
  });
  app.post("/thrown", async () => {
    rows.set("number", "DOC-0001");
    throw new DuplicateRecordIdError("X-1");
  });
  app.post("/invalid", async (c) => {
    rows.set("number", "DOC-0001");
    rows.set("document", "half-written");
    const { status } = (await c.req.json()) as { status: 400 | 403 | 404 | 409 | 422 };
    return c.json({ error: "REFUSED" }, status);
  });
  app.post("/forbidden", async (c) => {
    rows.set("audit", "refused: outside the caller's branches");
    return c.json({ error: "FORBIDDEN" }, 403);
  });
  app.post("/half-done", async (c) => {
    rows.set("stock", "moved to the van");
    const { status } = (await c.req.json()) as { status: 400 | 404 | 409 | 422 };
    return c.json({ error: "REFUSED" }, status);
  });
  app.post("/half-done-then-failed", async () => {
    rows.set("stock", "moved to the van");
    throw new Error("the server faulted");
  });
  app.post("/forbidden-after-a-number", async (c) => {
    rows.set("number", "DOC-0001");
    rows.set("audit", "refused");
    return c.json({ error: "FORBIDDEN" }, 403);
  });
  app.post("/numbered-then-failed", async () => {
    rows.set("number", "DOC-0001");
    throw new Error("the server faulted");
  });
  app.onError((err, c) => (err instanceof DuplicateRecordIdError ? duplicateIdRefusal(c, err) : c.json({ error: "INTERNAL" }, 500)));
  const post = (path: string, body: unknown) => app.fetch(new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { rows, post, transactions: () => transactions };
}

describe("a create refused for a taken id leaves nothing behind", () => {
  it("keeps what a successful create wrote", async () => {
    const { rows, post } = harness();
    expect((await post("/made", { id: "X-1" })).status).toBe(201);
    expect(rows.get("number")).toBe("DOC-0001");
  });

  it("undoes everything the handler wrote before it answered the refusal", async () => {
    const { rows, post } = harness();
    const res = await post("/refused", { id: "X-1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(RecordErrorCode.DuplicateId);
    expect(rows.size).toBe(0);
  });

  it("undoes it when the store's refusal is thrown and mapped by the last net", async () => {
    const { rows, post } = harness();
    expect((await post("/thrown", { id: "X-1" })).status).toBe(409);
    expect(rows.size).toBe(0);
  });

  it("covers an id named one object down", async () => {
    const { rows, post } = harness();
    expect((await post("/refused", { newCheque: { id: "X-1" } })).status).toBe(409);
    expect(rows.size).toBe(0);
  });

  it.each([422, 400, 404, 403, 409])("a create refused %i after it drew a document number gives the number back with everything else it wrote", async (status) => {
    const { rows, post } = harness();
    expect((await post("/invalid", { id: "X-1", status })).status).toBe(status);
    expect(rows.size).toBe(0);
  });

  it("a create that faulted after it drew a number gives it back too, and the fault still reaches the last net", async () => {
    const { rows, post } = harness();
    expect((await post("/numbered-then-failed", { id: "X-1" })).status).toBe(500);
    expect(rows.size).toBe(0);
  });

  it.each([400, 404, 409, 422])("a create refused %i with no number drawn still leaves nothing of what it had begun", async (status) => {
    const { rows, post } = harness();
    expect((await post("/half-done", { id: "X-1", status })).status).toBe(status);
    expect(rows.size).toBe(0);
  });

  it("a create that faulted half-way leaves nothing either", async () => {
    const { rows, post } = harness();
    expect((await post("/half-done-then-failed", { id: "X-1" })).status).toBe(500);
    expect(rows.size).toBe(0);
  });

  it("keeps the audit row of an attempt refused for want of permission — a refusal that drew no number", async () => {
    const { rows, post } = harness();
    expect((await post("/forbidden", { id: "X-1" })).status).toBe(403);
    expect(rows.get("audit")).toBe("refused: outside the caller's branches");
  });

  it("but a forbidden answer that had already drawn a number gives everything back", async () => {
    const { rows, post } = harness();
    expect((await post("/forbidden-after-a-number", { id: "X-1" })).status).toBe(403);
    expect(rows.size).toBe(0);
  });

  it("a create route runs in its transaction whatever its body names", async () => {
    const { rows, post, transactions } = harness();
    const opened = transactions();
    expect((await post("/half-done", { status: 422 })).status).toBe(422);
    expect(transactions()).toBe(opened + 1);
    expect(rows.size).toBe(0);
  });
});

describe("the route decides whether a request runs in the create transaction, never its body", () => {
  it.each(INJECTED_IDS)("a refusal on a route that creates nothing keeps its audit row — %s", async (_label, body) => {
    const { rows, post, transactions } = harness();
    expect((await post("/users/U-1/deactivate", body)).status).toBe(404);
    expect(transactions()).toBe(0);
    expect(rows.get("audit")).toBe("refused: outside the caller's branches");
  });

  it.each(INJECTED_IDS)("a confirm is never pulled into the create transaction — %s", async (_label, body) => {
    const { rows, post, transactions } = harness();
    expect((await post("/documents/D-1/confirm", body)).status).toBe(200);
    expect(transactions()).toBe(0);
    expect(rows.get("confirmed")).toBe("after a call to the tax authority");
  });
});
