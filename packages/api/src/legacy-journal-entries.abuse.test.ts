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
 * in the app the desktop shell serves. These tests state exactly what it does
 * today, so the day it is gated or removed the suite says which expectation to
 * rewrite.
 */
describe("the legacy /journal-entries route (D99)", () => {
  it("LIMITATION (D99): posts a journal entry for a caller holding no permission at all", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(post("/journal-entries", balanced));

    expect(res.status).toBe(201);
    expect(await uow.journal.findById("JE-ABUSE-1")).not.toBeNull();
  });

  it("LIMITATION (D99): the gated sibling refuses the same caller, so the gap is this route's alone", async () => {
    const { app } = newApp();
    const gated = await app.fetch(post("/gl/journal-entries", balanced, ""));
    expect([401, 403, 404]).toContain(gated.status);
  });

  it("LIMITATION (D99): accepts a date in a period that was never opened, with no period gate at all", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(post("/journal-entries", { ...balanced, id: "JE-ABUSE-2", date: "1999-01-01" }));
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
      }),
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
      }),
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
      post("/journal-entries", { ...balanced, id: "JE-ABUSE-5", lines: [{ accountId: "1300-1", debit: "0", credit: "0" }] }),
    );
    expect(res.status).toBe(400);
    expect(await uow.journal.findById("JE-ABUSE-5")).toBeNull();
  });

  it("refuses a malformed body", async () => {
    const { app } = newApp();
    const res = await app.fetch(post("/journal-entries", { id: "x" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("LIMITATION (D99): reads any entry back to any caller, ungated as well", async () => {
    const { app } = newApp();
    await app.fetch(post("/journal-entries", { ...balanced, id: "JE-ABUSE-6" }));
    const res = await app.fetch(new Request("http://local/journal-entries/JE-ABUSE-6"));
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: "JE-ABUSE-6" });
  });
});
