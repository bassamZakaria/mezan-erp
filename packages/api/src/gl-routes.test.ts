import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account, type VatFiling, type VatFilingRepository } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
} from "@mezan/persistence";
import { createGlRoutes, type GlRoutesDeps } from "./gl-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
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
  return { app: createGlRoutes(deps, insecureHeaderAuthContextResolver), ledger, accounts, periods };
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

  it("400s a structurally invalid entry: a line that is both a debit and a credit", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({
          ...balanced,
          lines: [
            { accountId: "1300-1", debit: "10", credit: "10" },
            { accountId: "4000", debit: "0", credit: "0" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_JOURNAL_ENTRY");
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

async function newAppWithPartyControls() {
  const harness = await newApp();
  const deps: GlRoutesDeps = {
    ledger: harness.ledger,
    accounts: harness.accounts,
    periods: harness.periods,
    numbering: harness.ledger.numbering,
    resolvePartyControlAccounts: async () => new Map([["1300-1", "customer" as const]]),
    partyExists: async (kind, id) => kind === "customer" && id === "CUST-1",
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => "rev-fixed",
  };
  return { app: createGlRoutes(deps, insecureHeaderAuthContextResolver), ledger: harness.ledger };
}

/**
 * A "legacy" draft with a party-less line on what is now a control account —
 * saved straight through the ledger repository the way a book from before
 * D205 existed holds one, bypassing the create-time check entirely (D226).
 */
async function saveLegacyDraft(ledger: Awaited<ReturnType<typeof newApp>>["ledger"]) {
  await ledger.save({
    id: "je-1",
    entryNo: null,
    date: balanced.date,
    memo: balanced.memo,
    status: "draft",
    source: "manual",
    lines: balanced.lines.map((l) => ({
      accountId: l.accountId,
      debit: Money.fromMajor(l.debit),
      credit: Money.fromMajor(l.credit),
      memo: null,
      costCenterId: null,
      currency: null,
      fxRate: null,
      taxRatePercent: null,
      projectId: null,
      costCategory: null,
      branchId: null,
      partyId: null,
    })),
    createdAt: "2026-08-20T10:00:00.000Z",
    postedAt: null,
    reversesEntryId: null,
    reversedByEntryId: null,
    sourceDocType: null,
    sourceDocId: null,
    sourceDocNumber: null,
  });
}

describe("gl-routes — editing and deleting a draft (D226)", () => {
  it("edits a draft's date, memo and lines, keeping it a draft with no JE number", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    const res = await app.fetch(
      req("/journal-entries/je-1", {
        method: "PUT",
        permissions: "accounting.journal.create",
        body: JSON.stringify({
          date: "2026-08-23",
          memo: "Cash sale (corrected)",
          lines: [
            { accountId: "1300-1", debit: "800.00", credit: "0" },
            { accountId: "4000", debit: "0", credit: "800.00" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; entryNo: string | null; date: string; memo: string; lines: unknown[] };
    expect(body.id).toBe("je-1");
    expect(body.status).toBe("draft");
    expect(body.entryNo).toBeNull();
    expect(body.date).toBe("2026-08-23");
    expect(body.memo).toBe("Cash sale (corrected)");
    expect(body.lines).toHaveLength(2);

    const getRes = await app.fetch(req("/journal-entries/je-1", { permissions: "accounting.journal.view" }));
    expect(((await getRes.json()) as { date: string }).date).toBe("2026-08-23");
  });

  it("409s editing a posted entry, in Arabic", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const res = await app.fetch(
      req("/journal-entries/je-1", { method: "PUT", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("JOURNAL_ENTRY_NOT_DRAFT");
    expect(body.message).toMatch(/مسودة/);
  });

  it("404s editing an unknown draft", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries/nope", { method: "PUT", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(res.status).toBe(404);
  });

  it("400s a malformed edit body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries/je-1", { method: "PUT", permissions: "accounting.journal.create", body: JSON.stringify({ memo: "x" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("403s editing without the create permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries/je-1", { method: "PUT", body: JSON.stringify(balanced) }));
    expect(res.status).toBe(403);
  });

  it("422s editing a party-less line onto a control account, in Arabic and English (D205 x D226)", async () => {
    const { app, ledger } = await newAppWithPartyControls();
    await saveLegacyDraft(ledger);
    const res = await app.fetch(
      req("/journal-entries/je-1", { method: "PUT", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string; messageEn: string; accountId: string };
    expect(body.error).toBe("PARTY_REQUIRED_ON_CONTROL_ACCOUNT");
    expect(body.accountId).toBe("1300-1");
    expect(body.message).toMatch(/العميل/);
    expect(body.messageEn).toMatch(/customer/);
  });

  it("edits in the missing party and the entry then posts (the legacy D226 path)", async () => {
    const { app, ledger } = await newAppWithPartyControls();
    await saveLegacyDraft(ledger);
    const editRes = await app.fetch(
      req("/journal-entries/je-1", {
        method: "PUT",
        permissions: "accounting.journal.create",
        body: JSON.stringify({
          ...balanced,
          lines: balanced.lines.map((l) => (l.accountId === "1300-1" ? { ...l, partyId: "CUST-1" } : l)),
        }),
      }),
    );
    expect(editRes.status).toBe(200);
    const postRes = await app.fetch(
      req("/journal-entries/je-1/post", { method: "POST", permissions: "accounting.journal.post" }),
    );
    expect(postRes.status).toBe(200);
    expect(((await postRes.json()) as { status: string }).status).toBe("posted");
  });

  it("deletes a draft outright", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    const res = await app.fetch(
      req("/journal-entries/je-1", { method: "DELETE", permissions: "accounting.journal.create" }),
    );
    expect(res.status).toBe(204);

    const getRes = await app.fetch(req("/journal-entries/je-1", { permissions: "accounting.journal.view" }));
    expect(getRes.status).toBe(404);
  });

  it("409s deleting a posted entry, in Arabic", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const res = await app.fetch(
      req("/journal-entries/je-1", { method: "DELETE", permissions: "accounting.journal.create" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("JOURNAL_ENTRY_NOT_DRAFT");
    expect(body.message).toMatch(/مسودة/);
  });

  it("404s deleting an unknown draft", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries/nope", { method: "DELETE", permissions: "accounting.journal.create" }));
    expect(res.status).toBe(404);
  });

  it("403s deleting without the create permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries/je-1", { method: "DELETE" }));
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
    expect(((await second.json()) as { error: string }).error).toBe("DUPLICATE_ID");
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
    const app = createGlRoutes(deps, insecureHeaderAuthContextResolver);
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

describe("gl-routes — validation errors that must not reach the domain layer", () => {
  it("400s a malformed create+post body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ id: "bad" }) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("400s a malformed draft body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify({ id: "bad" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a domain error surfaced through the DRAFT path (duplicate id)", async () => {
    const { app } = await newApp();
    const first = await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(first.status).toBe(201);
    const second = await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(balanced) }),
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("DUPLICATE_ID");
  });

  it("400s a malformed reversal body (wrong type for reversalId)", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const res = await app.fetch(
      req("/journal-entries/je-1/reverse", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ reversalId: 12345 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("tolerates an unparseable JSON reversal body by falling back to defaults", async () => {
    const { app } = await newApp();
    await postBalanced(app);
    const res = await app.fetch(
      new Request("http://local/journal-entries/je-1/reverse", {
        method: "POST",
        headers: { "x-permissions": "accounting.journal.post", "content-type": "application/json" },
        body: "not json at all",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { reversal: { id: string } };
    expect(body.reversal.id).toBe("rev-fixed");
  });

  it("400s a malformed list-query filter on /counts", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries/counts?status=not-a-status", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(400);
  });

  it("400s a malformed list-query filter on /stats", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/journal-entries/stats?status=not-a-status", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(400);
  });
});

describe("gl-routes — search narrows the register", () => {
  it("search matches the memo and excludes the non-matching entry", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, id: "je-alpha", memo: "دفعة عميل ألفا" }),
      }),
    );
    await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, id: "je-beta", memo: "دفعة مورد بيتا" }),
      }),
    );
    const res = await app.fetch(req("/journal-entries?search=ألفا", { permissions: "accounting.journal.view" }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["je-alpha"]);
  });
});

function inMemoryVatFilings(): VatFilingRepository {
  const store = new Map<string, VatFiling>();
  return {
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list() {
      return [...store.values()];
    },
    async save(filing) {
      store.set(filing.id, filing);
    },
    async insert(filing) {
      store.set(filing.id, filing);
    },
    async findCovering(date) {
      return [...store.values()].filter((f) => f.periodFrom <= date && date <= f.periodTo);
    },
  };
}

async function newAppWithVatFilings() {
  const harness = await newApp();
  const vatFilings = inMemoryVatFilings();
  const deps: GlRoutesDeps = {
    ledger: harness.ledger,
    accounts: harness.accounts,
    periods: harness.periods,
    numbering: harness.ledger.numbering,
    vatFilings,
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => "rev-fixed",
  };
  return { app: createGlRoutes(deps, insecureHeaderAuthContextResolver), vatFilings, ledger: harness.ledger };
}

describe("gl-routes — VAT filings lock the period they cover (D29)", () => {
  it("reports an empty list when no vatFilings port is wired, rather than erroring", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/vat-filings", { permissions: "accounting.reports.view" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("404s recording a filing when no vatFilings port is wired", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "1000" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400s a malformed filing body", async () => {
    const { app } = await newAppWithVatFilings();
    const res = await app.fetch(
      req("/vat-filings", { method: "POST", permissions: "accounting.period.close", body: JSON.stringify({ id: "vf-1" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("records a filing, lists it, and refuses a second filing over the same period", async () => {
    const { app } = await newAppWithVatFilings();
    const res = await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "1250.50", referenceNo: "ETA-991" }),
      }),
    );
    expect(res.status).toBe(201);
    const filing = (await res.json()) as { id: string; netAmount: string; status: string };
    expect(filing.netAmount).toBe("1250.500000");
    expect(filing.status).toBe("filed");

    const listRes = await app.fetch(req("/vat-filings", { permissions: "accounting.reports.view" }));
    const list = (await listRes.json()) as { id: string }[];
    expect(list.map((f) => f.id)).toEqual(["vf-1"]);

    const dup = await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-2", periodFrom: "2026-08-15", periodTo: "2026-08-31", netAmount: "1"} ),
      }),
    );
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("VAT_PERIOD_ALREADY_HAS_FILING");
  });

  it("refuses a posting dated inside a filed period, and posts nothing", async () => {
    const { app } = await newAppWithVatFilings();
    await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "1000" }),
      }),
    );
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-08-15" }) }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("VAT_PERIOD_ALREADY_FILED");
    const list = await app.fetch(req("/journal-entries", { permissions: "accounting.journal.view" }));
    expect((await list.json()) as unknown[]).toEqual([]);
  });

  it("posting outside the filed window is unaffected", async () => {
    const { app } = await newAppWithVatFilings();
    await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-15", netAmount: "1000" }),
      }),
    );
    const res = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-08-22" }) }),
    );
    expect(res.status).toBe(201);
  });

  it("404s amending a filing that does not exist", async () => {
    const { app } = await newAppWithVatFilings();
    const res = await app.fetch(
      req("/vat-filings/ghost/amend", { method: "POST", permissions: "accounting.period.close", body: JSON.stringify({ reason: "correction" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("400s amending with no reason", async () => {
    const { app } = await newAppWithVatFilings();
    await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "1000" }),
      }),
    );
    const res = await app.fetch(
      req("/vat-filings/vf-1/amend", { method: "POST", permissions: "accounting.period.close", body: JSON.stringify({ reason: "" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("404s amending when no vatFilings port is wired", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/vat-filings/vf-1/amend", { method: "POST", permissions: "accounting.period.close", body: JSON.stringify({ reason: "x" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("amending a filing reopens its window for posting", async () => {
    const { app } = await newAppWithVatFilings();
    await app.fetch(
      req("/vat-filings", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "1000" }),
      }),
    );
    const blocked = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-08-15" }) }),
    );
    expect(blocked.status).toBe(422);

    const amendRes = await app.fetch(
      req("/vat-filings/vf-1/amend", { method: "POST", permissions: "accounting.period.close", body: JSON.stringify({ reason: "correction after audit" }) }),
    );
    expect(amendRes.status).toBe(200);
    const amended = (await amendRes.json()) as { status: string; amendmentReason: string };
    expect(amended.status).toBe("amended");
    expect(amended.amendmentReason).toBe("correction after audit");

    const allowed = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify({ ...balanced, date: "2026-08-15" }) }),
    );
    expect(allowed.status).toBe(201);
  });
});

describe("gl-routes — year-end close", () => {
  async function withPnlActivity() {
    const harness = await newApp();
    // Revenue 4000 credited 8,000; expense 5000 debited 3,000 — both dated inside 2026.
    await harness.app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({
          id: "je-rev",
          date: "2026-08-10",
          memo: "sale",
          lines: [
            { accountId: "1300-1", debit: "8000", credit: "0" },
            { accountId: "4000", debit: "0", credit: "8000" },
          ],
        }),
      }),
    );
    await harness.app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({
          id: "je-exp",
          date: "2026-08-10",
          memo: "rent",
          lines: [
            { accountId: "5000", debit: "3000", credit: "0" },
            { accountId: "1300-1", debit: "0", credit: "3000" },
          ],
        }),
      }),
    );
    return harness;
  }

  it("previews the close without posting anything", async () => {
    const { app } = await withPnlActivity();
    const res = await app.fetch(req("/year-end-close/2026/preview", { permissions: "accounting.period.close" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      netResult: string;
      revenueClosed: string;
      expensesClosed: string;
      lines: Array<{ accountId: string; debit: string; credit: string }>;
    };
    expect(body.revenueClosed).toBe("8000.000000");
    expect(body.expensesClosed).toBe("3000.000000");
    expect(body.netResult).toBe("5000.000000");
    expect(body.lines).toHaveLength(2);

    // A preview posts nothing.
    const list = (await (await app.fetch(req("/journal-entries", { permissions: "accounting.journal.view" }))).json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("answers whether a year is closed with 200 either way, naming the entry once it is", async () => {
    const { app } = await withPnlActivity();
    const before = await app.fetch(req("/year-end-close/2026", { permissions: "accounting.journal.view" }));
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ year: 2026, closed: false, entry: null });

    await app.fetch(
      req("/year-end-close", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ year: 2026, retainedEarningsAccountId: "3900" }),
      }),
    );
    const after = await app.fetch(req("/year-end-close/2026", { permissions: "accounting.journal.view" }));
    expect(after.status).toBe(200);
    const body = (await after.json()) as { closed: boolean; entry: { id: string } | null };
    expect(body.closed).toBe(true);
    expect(body.entry?.id).toBe("YEAR-CLOSE:2026");
  });

  it("400s an invalid year on the preview", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/year-end-close/not-a-year/preview", { permissions: "accounting.period.close" }));
    expect(res.status).toBe(400);
  });

  it("422s previewing a year with no P&L activity at all", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/year-end-close/2026/preview", { permissions: "accounting.period.close" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("NOTHING_TO_CLOSE");
  });

  it("closes the year, posting a balanced entry that rolls the exact net result into retained earnings", async () => {
    const { app } = await withPnlActivity();
    const res = await app.fetch(
      req("/year-end-close", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ year: 2026, retainedEarningsAccountId: "3900" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      journalEntryId: string;
      netResult: string;
      revenueClosed: string;
      expensesClosed: string;
      accountsClosed: number;
    };
    expect(body.netResult).toBe("5000.000000");
    expect(body.revenueClosed).toBe("8000.000000");
    expect(body.expensesClosed).toBe("3000.000000");
    expect(body.accountsClosed).toBe(2);

    const entry = await app.fetch(req(`/journal-entries/${body.journalEntryId}`, { permissions: "accounting.journal.view" }));
    const entryBody = (await entry.json()) as { lines: Array<{ accountId: string; debit: string; credit: string }> };
    const retained = entryBody.lines.find((l) => l.accountId === "3900");
    expect(retained?.credit).toBe("5000.000000");
    const totalDebit = entryBody.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = entryBody.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);

    // Closing the same year again is refused, not posted a second time.
    const again = await app.fetch(
      req("/year-end-close", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ year: 2026, retainedEarningsAccountId: "3900" }),
      }),
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("YEAR_ALREADY_CLOSED");

    // The preview after closing reports the same refusal.
    const previewAfter = await app.fetch(req("/year-end-close/2026/preview", { permissions: "accounting.period.close" }));
    expect(previewAfter.status).toBe(409);
  });

  it("422s closing a year with no revenue or expense balances", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/year-end-close", {
        method: "POST",
        permissions: "accounting.period.close",
        body: JSON.stringify({ year: 2026, retainedEarningsAccountId: "3900" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("NOTHING_TO_CLOSE");
  });

  it("400s a malformed close-year body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/year-end-close", { method: "POST", permissions: "accounting.period.close", body: JSON.stringify({ year: "not-a-number" }) }),
    );
    expect(res.status).toBe(400);
  });
});

/**
 * Q-8: `GET /gl/journal-entries` answered with every entry ever posted. The
 * register is now a page, and the search that used to be a JS filter over the
 * whole ledger is SQL — so a searched page is still a page.
 */
describe("gl-routes — the journal register is a page (guards Q-8)", () => {
  async function seed(ledger: Awaited<ReturnType<typeof newApp>>["ledger"], n: number) {
    await ledger.transaction(async () => {
      for (let i = 0; i < n; i++) {
        await ledger.save({
          id: `seed-${i}`,
          entryNo: `JE-${String(i).padStart(6, "0")}`,
          date: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}`,
          memo: i % 3 === 0 ? "قيد مبيعات" : "قيد آخر",
          status: "posted",
          source: "manual",
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("10"), credit: Money.zero(), memo: null, costCenterId: null, taxRatePercent: null, currency: null, fxRate: null },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("10"), memo: null, costCenterId: null, taxRatePercent: null, currency: null, fxRate: null },
          ],
          createdAt: "2026-08-22T10:00:00.000Z",
          postedAt: "2026-08-22T10:00:00.000Z",
          reversesEntryId: null,
          reversedByEntryId: null,
          sourceDocType: null,
          sourceDocId: null,
          sourceDocNumber: null,
        });
      }
    });
  }

  it("answers 25 entries when the caller asks for no page at all", async () => {
    const { app, ledger } = await newApp();
    await seed(ledger, 60);
    const res = await app.fetch(req("/journal-entries", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toHaveLength(25);
  });

  it("pages a SEARCHED register too, and the page holds only matching rows", async () => {
    const { app, ledger } = await newApp();
    await seed(ledger, 60);
    const page = (await (
      await app.fetch(req("/journal-entries?search=مبيعات&page=1&pageSize=5", { permissions: "accounting.journal.view" }))
    ).json()) as { memo: string }[];
    expect(page).toHaveLength(5);
    expect(page.every((e) => e.memo.includes("مبيعات"))).toBe(true);

    // The chips still count the whole filtered set, not the page.
    const counts = (await (
      await app.fetch(req("/journal-entries/counts?search=مبيعات", { permissions: "accounting.journal.view" }))
    ).json()) as Record<string, number>;
    expect(counts.all).toBe(20);
  });

  it("no entry appears on two pages", async () => {
    const { app, ledger } = await newApp();
    await seed(ledger, 60);
    const ids: string[] = [];
    for (const page of [1, 2, 3]) {
      const rows = (await (
        await app.fetch(req(`/journal-entries?page=${page}&pageSize=20`, { permissions: "accounting.journal.view" }))
      ).json()) as { id: string }[];
      expect(rows).toHaveLength(20);
      ids.push(...rows.map((r) => r.id));
    }
    expect(new Set(ids).size).toBe(60);
  });
});

describe("gl-routes — an instant on the wire lands on the tenant's calendar day", () => {
  /**
   * The engine keeps refusing instants (`assertEntryDate`), because a stored
   * instant sorts after the day it belongs to and falls outside its own fiscal
   * period. Clients still send them, so the ROUTE narrows one to the tenant's
   * day first. With no app-level middleware the default tenant is Cairo.
   */
  async function post(date: string) {
    const { app, ledger } = await newApp();
    const res = await app.fetch(
      req("/journal-entries", {
        method: "POST",
        permissions: "accounting.journal.post",
        body: JSON.stringify({ ...balanced, id: `je-${date}`, date }),
      }),
    );
    return { res, body: (await res.json()) as any, ledger };
  }

  it("posts an instant on the last day of a 31-day month — the day the old defect refused", async () => {
    const { res, body } = await post("2026-08-31T03:10:33.016Z");
    expect(res.status).toBe(201);
    expect(body.date).toBe("2026-08-31");
    expect(body.status).toBe("posted");
  });

  it("stores the day, never the instant, so a date-range report still finds it", async () => {
    const { res, body } = await post("2026-08-22T10:00:00.000Z");
    expect(res.status).toBe(201);
    expect(body.date).toBe("2026-08-22");
    expect(body.date <= "2026-08-31").toBe(true);
  });

  it("rolls an instant that is ALREADY TOMORROW in Cairo onto the next day", async () => {
    // 23:59:59Z on the 30th of November is the 1st of December in Egypt. The
    // honest answer is the 1st; pretending otherwise would be a UTC tenant.
    const { res, body } = await post("2026-11-30T23:59:59.999Z");
    expect(res.status).toBe(201);
    expect(body.date).toBe("2026-12-01");
  });

  it("leaves a day-shaped date exactly as sent", async () => {
    const { res, body } = await post("2026-08-15");
    expect(res.status).toBe(201);
    expect(body.date).toBe("2026-08-15");
  });

  it("400s a date that is neither a day nor an instant, before the engine sees it", async () => {
    for (const date of ["31/08/2026", "2026-8-3", "2026-02-30", "today"]) {
      const { res, body } = await post(date);
      expect(res.status, date).toBe(400);
      expect(body.error).toBe("VALIDATION_ERROR");
    }
  });
});
