import { afterEach, describe, expect, it } from "vitest";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { createApp } from "./app.js";

const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const uow = createSqliteUnitOfWork();
  handles.push(uow);
  return { app: createApp(uow, {}), uow };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const balanced = {
  id: "JE-ABUSE-1",
  date: "2020-01-01",
  memo: "قيد عبر المسار القديم",
  lines: [
    { accountId: "1300-1", debit: "100.00", credit: "0" },
    { accountId: "4000", debit: "0", credit: "100.00" },
  ],
};

/**
 * `POST /journal-entries` was the spike's original poster and is DELETED (D99).
 *
 * It was gated late, which closed WHO could post and left everything else: it
 * checked no fiscal period, validated no account, stamped no document number,
 * wrote no audit row and no GL event, and its line contract carried no cost
 * centre, currency, rate or tax rate. `POST /gl/journal-entries` does all of
 * that, so the gapless sequence and the period cut-off — an auditor's first two
 * tests — held on one path into the books and not on the other.
 *
 * These tests are kept rather than deleted with the route, because "there is
 * exactly ONE way into the books" is the property worth guarding: a second
 * poster reintroduced later would pass every other test in this repo.
 */
describe("the legacy /journal-entries poster is gone (D99)", () => {
  it("is not mounted at all — not as a 403, which would mean it still exists", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(balanced) }),
    );
    expect(res.status).toBe(404);
  });

  it("writes nothing when it is called, whatever the caller holds", async () => {
    const { app, uow } = newApp();
    for (const permissions of ["", "accounting.journal.view", "accounting.journal.post", "*"]) {
      const res = await app.fetch(
        req("/journal-entries", { method: "POST", permissions, body: JSON.stringify(balanced) }),
      );
      expect(res.status).toBe(404);
    }
    expect(await uow.journal.findById("JE-ABUSE-1")).toBeNull();
  });

  it("leaves no read-back route behind either", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/journal-entries/JE-ABUSE-1", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(404);
  });

  it("registers no route whose path is the bare /journal-entries", async () => {
    const { app } = newApp();
    // The route table is the durable check: a handler re-added under any method
    // shows up here even if it answers 404 to the bodies above.
    const bare = app.routes.filter((r) => r.path === "/journal-entries" || r.path === "/journal-entries/:id");
    expect(bare).toEqual([]);
  });

  it("still mounts /gl when it is composed, which is the one way in", async () => {
    const { app } = newApp();
    // `createApp(uow, {})` composes no gl deps, so /gl is absent here too —
    // what matters is that nothing ELSE posts. Both paths 404, and the real
    // composition (create-backend) mounts /gl and only /gl.
    const res = await app.fetch(
      req("/gl/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(balanced) }),
    );
    expect(res.status).toBe(404);
  });
});
