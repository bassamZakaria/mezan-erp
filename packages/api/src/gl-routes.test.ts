import { describe, it, expect, afterEach } from "vitest";
import type { Account } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
} from "@mezan/persistence";
import { createGlRoutes, type GlRoutesDeps } from "./gl-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

async function newApp() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(ledger, accounts, periods);
  await accounts.create(account("1300-1"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("1000", { isHeader: true }));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });
  const deps: GlRoutesDeps = {
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => "rev-fixed",
  };
  return { app: createGlRoutes(deps), ledger };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const balanced = {
  id: "je-1",
  date: "2026-08-22",
  memo: "Cash sale",
  lines: [
    { accountId: "1300-1", debit: "500.00", credit: "0" },
    { accountId: "4000", debit: "0", credit: "500.00" },
  ],
};

async function postBalanced(app: Awaited<ReturnType<typeof newApp>>["app"]) {
  return app.fetch(
    req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(balanced) }),
  );
}

describe("gl-routes — permission gates", () => {
  it("403s a create+post with no permissions", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries", { method: "POST", body: JSON.stringify(balanced) }));
    expect(res.status).toBe(403);
  });

  it("403s a post attempt holding only the create permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("gl-routes — create + post", () => {
  it("posts a balanced entry and assigns JE-000001", async () => {
    const { app } = await newApp();
    const res = await postBalanced(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; entryNo: string };
    expect(body.status).toBe("posted");
    expect(body.entryNo).toBe("JE-000001");
  });

  it("422s an unbalanced entry with totals", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({
          ...balanced,
          lines: [
            { accountId: "1300-1", debit: "100", credit: "0" },
            { accountId: "4000", debit: "0", credit: "90" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; totalDebit: string };
    expect(body.error).toBe("UNBALANCED_ENTRY");
    expect(body.totalDebit).toBe("100.000000");
  });

  it("422s posting to a header account", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({
          ...balanced,
          lines: [
            { accountId: "1000", debit: "500", credit: "0" },
            { accountId: "4000", debit: "0", credit: "500" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("HEADER_ACCOUNT_NOT_POSTABLE");
  });

  it("422s posting into a date with no fiscal period", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, date: "2025-01-01" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("NO_FISCAL_PERIOD_FOR_DATE");
  });
});

describe("gl-routes — draft, post, reverse, read", () => {
  it("saves a draft then posts it", async () => {
    const { app } = await newApp();
    const draftRes = await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(draftRes.status).toBe(201);
    expect(((await draftRes.json()) as { status: string }).status).toBe("draft");

    const postRes = await app.fetch(
      req("/journal-entries/je-1/post", { method: "POST", permissions: "accounting.journal.post" }),
    );
    expect(postRes.status).toBe(200);
    expect(((await postRes.json()) as { status: string; entryNo: string }).entryNo).toBe("JE-000001");
  });

  it("reverses a posted entry", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const res = await app.fetch(
      req("/journal-entries/je-1/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      original: { status: string; reversedByEntryId: string };
      reversal: { id: string; reversesEntryId: string; entryNo: string };
    };
    expect(body.original.status).toBe("reversed");
    expect(body.original.reversedByEntryId).toBe("rev-fixed");
    expect(body.reversal.id).toBe("rev-fixed");
    expect(body.reversal.reversesEntryId).toBe("je-1");
    expect(body.reversal.entryNo).toBe("JE-000002");
  });

  it("409s reversing a non-existent entry", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries/nope/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(404);
  });

  it("lists and gets journal entries (view gate)", async () => {
    const { app } = await newApp();
    await postBalanced(app);

    const listRes = await app.fetch(req("/journal-entries?status=posted", { permissions: "accounting.journal.view" }));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()) as unknown[]).toHaveLength(1);

    const getRes = await app.fetch(req("/journal-entries/je-1", { permissions: "accounting.journal.view" }));
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { id: string }).id).toBe("je-1");

    const missing = await app.fetch(req("/journal-entries/nope", { permissions: "accounting.journal.view" }));
    expect(missing.status).toBe(404);
  });

  it("returns an account ledger with its running balance", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const res = await app.fetch(req("/accounts/1300-1/ledger", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      balance: { balance: string };
      lines: Array<{ debit: string }>;
    };
    expect(body.balance.balance).toBe("500.000000");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]?.debit).toBe("500.000000");
  });

  it("403s the account ledger without the view permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/accounts/1300-1/ledger"));
    expect(res.status).toBe(403);
  });
});
