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

function post(path: string, body: unknown, permissions?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (permissions !== undefined) headers.set("x-permissions", permissions);
  return new Request(`http://local${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const balanced = {
  id: "JE-ABUSE-1",
  date: "2020-01-01",
  memo: "قيد من غير صلاحية",
  lines: [
    { accountId: "1300-1", debit: "100.00", credit: "0" },
    { accountId: "4000", debit: "0", credit: "100.00" },
  ],
};

/**
 * `POST /journal-entries` is the spike's original poster and is still mounted
 * in `createApp`. It is now permission-gated (D99) — these tests hold the gate,
 * and hold the invariants the route does own.
 *
 * STILL OPEN, and deliberately not blessed here: even gated, this route posts
 * through `postJournalEntrySpike`, which performs no fiscal-period check and no
 * account validation, and its line contract carries no cost centre, currency,
 * rate or tax rate. `POST /gl/journal-entries` does all of that. The remaining
 * fix is to DELETE this route and move its two callers (`dual-mount.test.ts`
 * and `apps/desktop/src/headless-demo.ts`) onto a `/gl`-mounted composition.
 */
describe("the legacy /journal-entries route (D99)", () => {
  it("refuses a caller holding no permission at all, and writes nothing", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(post("/journal-entries", balanced, ""));

    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string; permission: string }).toMatchObject({
      error: "PERMISSION_DENIED",
      permission: "accounting.journal.post",
    });
    // A 403 that still posted the entry would be the same hole wearing a nicer
    // status code. The books are what is being protected, not the response.
    expect(await uow.journal.findById("JE-ABUSE-1")).toBeNull();
  });

  it("refuses a caller holding a NEIGHBOURING journal permission but not the posting one", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(post("/journal-entries", balanced, "accounting.journal.view"));

    expect(res.status).toBe(403);
    expect(await uow.journal.findById("JE-ABUSE-1")).toBeNull();
  });

  it("posts for a caller who does hold accounting.journal.post (negative control)", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(post("/journal-entries", balanced, "accounting.journal.post"));

    expect(res.status).toBe(201);
    const stored = await uow.journal.findById("JE-ABUSE-1");
    expect(stored?.lines).toHaveLength(2);
    expect(stored?.lines[0]?.debit.toString()).toBe("100.000000");
  });

  it("runs the gate BEFORE the validator, so a stranger cannot use it as an oracle", async () => {
    const { app } = newApp();
    const res = await app.fetch(post("/journal-entries", { id: "x" }, ""));
    expect(res.status).toBe(403);
  });

  it("LIMITATION (D99): a permitted caller can still post into a period that was never opened", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(post("/journal-entries", { ...balanced, id: "JE-ABUSE-2", date: "1999-01-01" }, "accounting.journal.post"));
    expect(res.status).toBe(201);
    expect(await uow.journal.findById("JE-ABUSE-2")).not.toBeNull();
  });

  it("LIMITATION (D99): stores no cost centre, currency, rate or tax rate, because its line contract has none", async () => {
    const { app, uow } = newApp();
    await app.fetch(
      post("/journal-entries", {
        ...balanced,
        id: "JE-ABUSE-3",
        lines: [
          { accountId: "1300-1", debit: "100.00", credit: "0", costCenterId: "cc-1", currency: "USD", fxRate: "48.5", taxRatePercent: 14 },
          { accountId: "4000", debit: "0", credit: "100.00" },
        ],
      }, "accounting.journal.post"),
    );

    const entry = await uow.journal.findById("JE-ABUSE-3");
    const line = entry?.lines[0] as Record<string, unknown> | undefined;
    expect(line?.costCenterId ?? null).toBeNull();
    expect(line?.currency ?? null).toBeNull();
    expect(line?.fxRate ?? null).toBeNull();
    expect(line?.taxRatePercent ?? null).toBeNull();
  });

  it("still enforces the one invariant it does own: the entry must balance", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(
      post("/journal-entries", {
        ...balanced,
        id: "JE-ABUSE-4",
        lines: [
          { accountId: "1300-1", debit: "100.00", credit: "0" },
          { accountId: "4000", debit: "0", credit: "90.00" },
        ],
      }, "accounting.journal.post"),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; totalDebit: string; totalCredit: string };
    expect(body.error).toBe("UNBALANCED_ENTRY");
    expect(body.totalDebit).toBe("100.000000");
    expect(body.totalCredit).toBe("90.000000");
    expect(await uow.journal.findById("JE-ABUSE-4")).toBeNull();
  });

  it("still refuses an entry of fewer than two lines, and stores nothing", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(
      post(
        "/journal-entries",
        { ...balanced, id: "JE-ABUSE-5", lines: [{ accountId: "1300-1", debit: "0", credit: "0" }] },
        "accounting.journal.post",
      ),
    );
    expect(res.status).toBe(400);
    expect(await uow.journal.findById("JE-ABUSE-5")).toBeNull();
  });

  it("refuses a malformed body", async () => {
    const { app } = newApp();
    const res = await app.fetch(post("/journal-entries", { id: "x" }, "accounting.journal.post"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("gates the read back too: no permission, no entry", async () => {
    const { app } = newApp();
    await app.fetch(post("/journal-entries", { ...balanced, id: "JE-ABUSE-6" }, "accounting.journal.post"));

    const refused = await app.fetch(
      new Request("http://local/journal-entries/JE-ABUSE-6", { headers: { "x-permissions": "" } }),
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()) as { memo?: string }).not.toHaveProperty("memo");

    const allowed = await app.fetch(
      new Request("http://local/journal-entries/JE-ABUSE-6", { headers: { "x-permissions": "accounting.journal.view" } }),
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()) as { id: string }).toMatchObject({ id: "JE-ABUSE-6" });
  });
});
