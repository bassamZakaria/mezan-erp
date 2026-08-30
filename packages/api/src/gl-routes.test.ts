import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account } from "@mezan/domain";
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
  await accounts.create(account("5000", { type: "expense" }));
  await accounts.create(account("3900", { type: "equity", naturalBalance: "credit" }));
  await accounts.create(account("1300-2", { status: "inactive" }));
  await periods.create({
    id: "fp-2026-06",
    year: 2026,
    periodNumber: 6,
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    status: "locked",
  });
  await periods.create({
    id: "fp-2026-07",
    year: 2026,
    periodNumber: 7,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    status: "closed",
  });
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });
  await periods.create({
    id: "fp-2026-12",
    year: 2026,
    periodNumber: 12,
    startDate: "2026-12-01",
    endDate: "2026-12-31",
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
  return { app: createGlRoutes(deps), ledger, accounts, periods };
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

async function accountBalance(app: Awaited<ReturnType<typeof newApp>>["app"], accountId: string): Promise<string> {
  const res = await app.fetch(req(`/accounts/${accountId}/ledger`, { permissions: "accounting.journal.view" }));
  const body = (await res.json()) as { balance: { balance: string } };
  return body.balance.balance;
}

describe("gl-routes — every posting moves the named accounts by the derived amount", () => {
  it("debits the asset and credits the revenue account by exactly 500, Σdebit = Σcredit", async () => {
    const { app } = await newApp();
    const res = await postBalanced(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      lines: Array<{ accountId: string; debit: string; credit: string }>;
    };
    const totalDebit = body.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = body.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(500);
    expect(await accountBalance(app, "1300-1")).toBe("500.000000");
    // 4000 is a revenue account: a 500 credit reads as balance = debit − credit = −500.
    expect(await accountBalance(app, "4000")).toBe("-500.000000");
  });

  it("422s posting to an account that does not exist, and posts nothing", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, lines: [{ accountId: "9999-none", debit: "500", credit: "0" }, { accountId: "4000", debit: "0", credit: "500" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("ACCOUNT_NOT_FOUND");
    const list = await app.fetch(req("/journal-entries", { permissions: "accounting.journal.view" }));
    expect((await list.json()) as unknown[]).toEqual([]);
  });

  it("422s posting to an inactive account, and posts nothing", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, lines: [{ accountId: "1300-2", debit: "500", credit: "0" }, { accountId: "4000", debit: "0", credit: "500" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("INACTIVE_ACCOUNT");
    expect(await accountBalance(app, "4000")).toBe("0.000000");
  });

  it("409s re-posting the same id, and the second attempt moves nothing", async () => {
    const { app } = await newApp();
    expect((await postBalanced(app)).status).toBe(201);
    const second = await postBalanced(app);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("DUPLICATE_JOURNAL_ENTRY");
    // Still exactly the one posting's worth of movement, not two.
    expect(await accountBalance(app, "1300-1")).toBe("500.000000");
    const list = (await (await app.fetch(req("/journal-entries", { permissions: "accounting.journal.view" }))).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("422s an unbalanced entry and leaves both accounts untouched", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, lines: [{ accountId: "1300-1", debit: "100", credit: "0" }, { accountId: "4000", debit: "0", credit: "90" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(await accountBalance(app, "1300-1")).toBe("0.000000");
    expect(await accountBalance(app, "4000")).toBe("0.000000");
  });
});

describe("gl-routes — reversal restores both accounts and never mutates the original", () => {
  it("nets both accounts back to zero and preserves the reversal's own dimensions", async () => {
    const { app } = await newApp();
    const withDims = {
      id: "je-dims",
      date: "2026-08-22",
      memo: "FX sale with cost centre and tax rate",
      lines: [
        {
          accountId: "1300-1",
          debit: "500.00",
          credit: "0",
          costCenterId: "CC-BRANCH-1",
          currency: "USD",
          fxRate: "48.500000",
          taxRatePercent: 14,
        },
        { accountId: "4000", debit: "0", credit: "500.00" },
      ],
    };
    const postRes = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(withDims) }),
    );
    expect(postRes.status).toBe(201);
    const beforeReversal = await (await app.fetch(req("/journal-entries/je-dims", { permissions: "accounting.journal.view" }))).json();

    expect(await accountBalance(app, "1300-1")).toBe("500.000000");
    expect(await accountBalance(app, "4000")).toBe("-500.000000");

    const reverseRes = await app.fetch(
      req("/journal-entries/je-dims/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(reverseRes.status).toBe(201);
    const body = (await reverseRes.json()) as {
      original: { lines: Array<{ accountId: string; debit: string; credit: string }> };
      reversal: {
        lines: Array<{
          accountId: string;
          debit: string;
          credit: string;
          costCenterId: string | null;
          currency: string | null;
          fxRate: string | null;
          taxRatePercent: number | null;
        }>;
      };
    };
    const reversedLine = body.reversal.lines.find((l) => l.accountId === "1300-1");
    expect(reversedLine).toBeDefined();
    expect(reversedLine?.debit).toBe("0.000000");
    expect(reversedLine?.credit).toBe("500.000000");
    expect(reversedLine?.costCenterId).toBe("CC-BRANCH-1");
    expect(reversedLine?.currency).toBe("USD");
    expect(reversedLine?.fxRate).toBe("48.500000");
    expect(reversedLine?.taxRatePercent).toBe(14);

    // Both accounts net back to exactly zero — the reversal restores them.
    expect(await accountBalance(app, "1300-1")).toBe("0.000000");
    expect(await accountBalance(app, "4000")).toBe("0.000000");

    // The original entry's own lines are byte-identical to before the reversal.
    const afterReversal = await (await app.fetch(req("/journal-entries/je-dims", { permissions: "accounting.journal.view" }))).json();
    expect((afterReversal as { lines: unknown }).lines).toEqual((beforeReversal as { lines: unknown }).lines);
    expect((afterReversal as { status: string }).status).toBe("reversed");
  });

  it("409s reversing an entry that is already reversed", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const first = await app.fetch(
      req("/journal-entries/je-1/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(first.status).toBe(201);
    const second = await app.fetch(
      req("/journal-entries/je-1/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("JOURNAL_ENTRY_ALREADY_REVERSED");
  });

  it("409s reversing an entry that was never posted (still a draft)", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    const res = await app.fetch(
      req("/journal-entries/je-1/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("JOURNAL_ENTRY_NOT_POSTED");
  });
});

describe("gl-routes — the period gate on every write path", () => {
  it("posts into an open period", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-08-15" }) }),
    );
    expect(res.status).toBe(201);
  });

  it("422s create+post into a closed period", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-07-15" }) }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
  });

  it("422s create+post into a locked period", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-06-15" }) }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
  });

  it("saves a draft into a closed period (drafts are not period-gated) but refuses to post it", async () => {
    const { app } = await newApp();
    const draftRes = await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify({ ...balanced, date: "2026-07-15" }) }),
    );
    expect(draftRes.status).toBe(201);
    expect(((await draftRes.json()) as { status: string }).status).toBe("draft");

    const postRes = await app.fetch(req("/journal-entries/je-1/post", { method: "POST", permissions: "accounting.journal.post" }));
    expect(postRes.status).toBe(422);
    expect(((await postRes.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
  });

  it("posts a draft, then 409s posting the same draft a second time", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    const first = await app.fetch(req("/journal-entries/je-1/post", { method: "POST", permissions: "accounting.journal.post" }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { status: string; entryNo: string }).entryNo).toBe("JE-000001");

    const second = await app.fetch(req("/journal-entries/je-1/post", { method: "POST", permissions: "accounting.journal.post" }));
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("JOURNAL_ENTRY_NOT_DRAFT");
    // Only the one posting's worth of movement happened.
    expect(await accountBalance(app, "1300-1")).toBe("500.000000");
  });

  it("422s reversing into a period that has since closed", async () => {
    const { app, periods } = await newApp();
    await postBalanced(app);
    const augPeriod = await periods.findByDate("2026-08-22");
    await periods.update({ ...augPeriod!, status: "closed" });

    const res = await app.fetch(
      req("/journal-entries/je-1/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
    // The original entry must still read exactly "posted" — the refused
    // reversal touched nothing.
    const entry = (await (await app.fetch(req("/journal-entries/je-1", { permissions: "accounting.journal.view" }))).json()) as { status: string };
    expect(entry.status).toBe("posted");
  });
});

describe("gl-routes — the account ledger's running balance, opening balance and ordering", () => {
  async function seededLedger() {
    const harness = await newApp();
    const postings = [
      { id: "je-a", date: "2026-08-01", amount: "100.00" },
      { id: "je-b", date: "2026-08-15", amount: "200.00" },
      { id: "je-c", date: "2026-08-30", amount: "300.00" },
    ];
    for (const p of postings) {
      const res = await harness.app.fetch(
        req("/journal-entries", {
          method: "POST",
          permissions: "accounting.journal.post",
          body: JSON.stringify({
            id: p.id,
            date: p.date,
            memo: `posting ${p.id}`,
            lines: [
              { accountId: "1300-1", debit: p.amount, credit: "0" },
              { accountId: "4000", debit: "0", credit: p.amount },
            ],
          }),
        }),
      );
      expect(res.status).toBe(201);
    }
    return harness;
  }

  it("reaches back to every posting up to asOf, in true chronological order — not sorted after the fact", async () => {
    const { app } = await seededLedger();
    const res = await app.fetch(req("/accounts/1300-1/ledger?asOf=2026-08-15", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balance: { balance: string }; lines: Array<{ entryId: string; debit: string }> };
    // Opening balance reaches back to the 08-01 posting even though asOf names
    // a later date and no fromDate was given at all.
    expect(body.balance.balance).toBe("300.000000");
    expect(body.lines.map((l) => l.entryId)).toEqual(["je-a", "je-b"]);
    expect(body.lines.map((l) => l.debit)).toEqual(["100.000000", "200.000000"]);
  });

  it("includes every posting, in order, once asOf is dropped entirely", async () => {
    const { app } = await seededLedger();
    const res = await app.fetch(req("/accounts/1300-1/ledger", { permissions: "accounting.journal.view" }));
    const body = (await res.json()) as { balance: { balance: string }; lines: Array<{ entryId: string }> };
    expect(body.balance.balance).toBe("600.000000");
    expect(body.lines.map((l) => l.entryId)).toEqual(["je-a", "je-b", "je-c"]);
  });

  it("excludes a posting dated after asOf from both the balance and the lines", async () => {
    const { app } = await seededLedger();
    const res = await app.fetch(req("/accounts/1300-1/ledger?asOf=2026-08-14", { permissions: "accounting.journal.view" }));
    const body = (await res.json()) as { balance: { balance: string }; lines: Array<{ entryId: string }> };
    expect(body.balance.balance).toBe("100.000000");
    expect(body.lines.map((l) => l.entryId)).toEqual(["je-a"]);
  });
});

describe("gl-routes — the journal register's own counts and totals tie to each other", () => {
  async function seededRegister() {
    const harness = await newApp();
    await harness.app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify({ ...balanced, id: "je-draft" }) }),
    );
    await postBalanced(harness.app); // je-1, posted
    await harness.app.fetch(
      req("/journal-entries/je-1/reverse", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({}) }),
    ); // je-1 -> reversed, rev-fixed -> posted
    return harness;
  }

  it("/journal-entries/counts drops its own status filter, so every chip still reports its true count", async () => {
    const { app } = await seededRegister();
    const res = await app.fetch(req("/journal-entries/counts?status=posted", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body).toEqual({ all: 3, draft: 1, pending: 0, posted: 1, reversed: 1 });
  });

  it("/journal-entries/stats honours the status filter and its debit/credit totals tie", async () => {
    const { app } = await seededRegister();
    const all = (await (await app.fetch(req("/journal-entries/stats", { permissions: "accounting.journal.view" }))).json()) as {
      count: number; draft: number; posted: number; reversed: number; totalDebit: string; totalCredit: string;
    };
    expect(all.count).toBe(3);
    expect(all.draft).toBe(1);
    expect(all.posted).toBe(1);
    expect(all.reversed).toBe(1);
    expect(all.totalDebit).toBe(all.totalCredit);
    expect(all.totalDebit).toBe("1500.000000");

    const postedOnly = (await (await app.fetch(req("/journal-entries/stats?status=posted", { permissions: "accounting.journal.view" }))).json()) as {
      count: number; totalDebit: string; totalCredit: string;
    };
    expect(postedOnly.count).toBe(1);
    expect(postedOnly.totalDebit).toBe("500.000000");
    expect(postedOnly.totalCredit).toBe("500.000000");
  });

  it("400s a malformed list-query filter", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries?status=not-a-status", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });
});

describe("gl-routes — balances by currency", () => {
  it("reports empty when no open-party-document source is wired", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/balances-by-currency", { permissions: "accounting.reports.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      baseCurrency: string;
      receivables: unknown[];
      payables: unknown[];
      receivableTotalBase: string;
      payableTotalBase: string;
    };
    expect(body.receivables).toEqual([]);
    expect(body.payables).toEqual([]);
    expect(body.receivableTotalBase).toBe("0.000000");
    expect(body.payableTotalBase).toBe("0.000000");
  });

  it("sums open receivables and payables per currency from the wired source", async () => {
    const ledger = createSqliteLedgerStore();
    const accounts = createSqliteAccountRepository();
    const periods = createSqliteFiscalPeriodRepository();
    closers.push(ledger, accounts, periods);
    const deps: GlRoutesDeps = {
      ledger,
      accounts,
      periods,
      numbering: ledger.numbering,
      openPartyDocuments: async () => [
        {
          kind: "receivable",
          documentId: "inv-1",
          documentNo: "INV-000001",
          partyId: "cust-1",
          partyName: "عميل تجريبي",
          date: "2026-08-01",
          currency: "EGP",
          fxRate: null,
          totalBase: Money.fromMajor("1000.00"),
          allocatedBase: Money.fromMajor("200.00"),
        },
        {
          kind: "payable",
          documentId: "pi-1",
          documentNo: "PI-000001",
          partyId: "sup-1",
          partyName: "مورد تجريبي",
          date: "2026-08-01",
          currency: "EGP",
          fxRate: null,
          totalBase: Money.fromMajor("500.00"),
          allocatedBase: Money.zero(),
        },
      ],
    };
    const app = createGlRoutes(deps);
    const res = await app.fetch(req("/balances-by-currency", { permissions: "accounting.reports.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      receivables: Array<{ currency: string; outstandingBase: string }>;
      payables: Array<{ currency: string; outstandingBase: string }>;
      receivableTotalBase: string;
      payableTotalBase: string;
    };
    expect(body.receivables).toHaveLength(1);
    expect(body.receivables[0]?.currency).toBe("EGP");
    expect(body.receivables[0]?.outstandingBase).toBe("800.000000"); // 1000 - 200
    expect(body.receivableTotalBase).toBe("800.000000");
    expect(body.payables).toHaveLength(1);
    expect(body.payables[0]?.outstandingBase).toBe("500.000000");
    expect(body.payableTotalBase).toBe("500.000000");
  });
});
