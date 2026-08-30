import { describe, it, expect, afterEach } from "vitest";
import { Money, createTreasuryAccount, createTreasuryLedgerReader, postJournalEntry, type Account } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteBankReconciliationStore,
} from "@mezan/persistence";
import { createBankReconciliationRoutes, type BankReconciliationRoutesDeps } from "./bank-reconciliation-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

const RAW_CSV =
  "التاريخ,البيان,مدين,دائن,المرجع\n" +
  "01/08/2026,إيداع نقدي,0,1000.00,TX1\n" +
  "03/08/2026,سحب نقدي,400.00,0,TX2\n" +
  "05/08/2026,مصروفات بنكية,5.00,0,TX3\n";

const MAPPING = {
  dateColumn: "التاريخ",
  descriptionColumn: "البيان",
  debitColumn: "مدين",
  creditColumn: "دائن",
  referenceColumn: "المرجع",
  dateFormat: "DD/MM/YYYY" as const,
};

const IMPORT_BODY = {
  id: "stmt-1",
  treasuryAccountId: "ta-bank1",
  rawCsv: RAW_CSV,
  mapping: MAPPING,
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  openingBalance: "0.00",
  closingBalance: "595.00",
  statementNumber: "ST-001",
};

let idSeq = 0;

/**
 * Stands the routes up over REAL SQLite stores and the REAL GL ledger, so the
 * ledger reader resolves the treasury account's GL account and sees actually
 * posted entries — matching links to those, it never posts anything itself.
 */
async function newApp() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const treasuryAccounts = createSqliteTreasuryAccountRepository();
  const bankStatements = createSqliteBankReconciliationStore();
  closers.push(ledger, accounts, periods, treasuryAccounts, bankStatements);

  await accounts.create(account("1310"));
  await accounts.create(account("1100"));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await createTreasuryAccount({ id: "ta-bank1", code: "BANK-001", name: "بنك مصر", branchId: "b1", type: "bank", glAccountId: "1310" }, treasuryAccounts);

  idSeq = 0;
  const deps: BankReconciliationRoutesDeps = {
    statements: bankStatements.statements,
    mappings: bankStatements.mappings,
    ledgerReader: createTreasuryLedgerReader({ treasuryAccounts, ledger }),
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => `gen-${++idSeq}`,
  };
  return {
    app: createBankReconciliationRoutes(deps),
    gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
  };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? "*");
  headers.set("x-user-id", "tester");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

function importReq(body: Record<string, unknown> = {}) {
  return req("/import", { method: "POST", body: JSON.stringify({ ...IMPORT_BODY, ...body }) });
}

describe("bank reconciliation routes — permissions", () => {
  it("rejects listing without treasury.reconciliation.view", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/", { permissions: "" }))).status).toBe(403);
  });

  it("rejects importing with only the view permission", async () => {
    const { app } = await newApp();
    expect((await app.fetch(importReq({}))).status).toBe(201);
    const denied = await app.fetch(
      req("/import", { method: "POST", permissions: "treasury.reconciliation.view", body: JSON.stringify({ ...IMPORT_BODY, id: "stmt-2" }) }),
    );
    expect(denied.status).toBe(403);
  });

  it("rejects matching and finalizing without their own permissions", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    const match = await app.fetch(
      req("/stmt-1/lines/stmt-1:L0/match", { method: "POST", permissions: "treasury.reconciliation.view", body: JSON.stringify({ entryId: "je-1" }) }),
    );
    expect(match.status).toBe(403);
    const finalize = await app.fetch(req("/stmt-1/finalize", { method: "POST", permissions: "treasury.reconciliation.match" }));
    expect(finalize.status).toBe(403);
  });
});

describe("bank reconciliation routes — CSV import", () => {
  it("parses the CSV through the supplied debit/credit mapping and persists it for the account", async () => {
    const { app } = await newApp();
    const res = await app.fetch(importReq());
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.status).toBe("imported");
    expect(body.statementNumber).toBe("ST-001");
    expect(body.openingBalance).toBe("0.000000");
    expect(body.closingBalance).toBe("595.000000");
    // credit − debit, so a deposit is positive and a withdrawal negative
    expect(body.lines.map((l: any) => l.amount)).toEqual(["1000.000000", "-400.000000", "-5.000000"]);
    // DD/MM/YYYY normalised to ISO
    expect(body.lines.map((l: any) => l.date)).toEqual(["2026-08-01", "2026-08-03", "2026-08-05"]);
    expect(body.lines.every((l: any) => l.status === "unmatched")).toBe(true);

    const mapping = await app.fetch(req("/column-mapping/ta-bank1"));
    expect(mapping.status).toBe(200);
    expect(await mapping.json()).toMatchObject({
      treasuryAccountId: "ta-bank1",
      dateColumn: "التاريخ",
      debitColumn: "مدين",
      creditColumn: "دائن",
      amountColumn: null,
      dateFormat: "DD/MM/YYYY",
    });
  });

  it("returns 404 for an account with no saved mapping yet", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/column-mapping/ta-unknown"))).status).toBe(404);
  });

  it("rejects a mapping naming a column the CSV header does not have with 422", async () => {
    const { app } = await newApp();
    const res = await app.fetch(importReq({ mapping: { ...MAPPING, dateColumn: "Date" } }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("COLUMN_NOT_FOUND");
  });

  it("rejects a malformed import body with 400", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/import", { method: "POST", body: JSON.stringify({ treasuryAccountId: "ta-bank1" }) }));
    expect(res.status).toBe(400);
  });
});

describe("bank reconciliation routes — listing", () => {
  it("returns the statement with its lines and match summary", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    const res = await app.fetch(req("/stmt-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.lines).toHaveLength(3);
    expect(body.matchSummary).toEqual({ total: 3, matched: 0, unmatched: 3, matchRate: 0 });
  });

  it("filters the list by treasury account and status", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    expect(((await (await app.fetch(req("/?treasuryAccountId=ta-bank1"))).json()) as any[]).map((s) => s.id)).toEqual(["stmt-1"]);
    expect(await (await app.fetch(req("/?treasuryAccountId=ta-other"))).json()).toEqual([]);
    expect(await (await app.fetch(req("/?status=completed"))).json()).toEqual([]);
  });

  it("returns 404 for an unknown statement", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/nope"))).status).toBe(404);
  });
});

describe("bank reconciliation routes — matching", () => {
  it("matches a line manually, moving the statement to قيد التسوية, then unmatches it", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());

    const matched = await app.fetch(req("/stmt-1/lines/stmt-1:L0/match", { method: "POST", body: JSON.stringify({ entryId: "je-1" }) }));
    expect(matched.status).toBe(200);
    const line = (await matched.json()) as any;
    expect(line.status).toBe("matched");
    expect(line.matchedEntryId).toBe("je-1");
    expect(line.matchedAt).toBe("2026-08-22T10:00:00.000Z");

    const statement = (await (await app.fetch(req("/stmt-1"))).json()) as any;
    expect(statement.status).toBe("in_progress");
    expect(statement.matchSummary).toEqual({ total: 3, matched: 1, unmatched: 2, matchRate: 1 / 3 });

    const unmatched = await app.fetch(req("/stmt-1/lines/stmt-1:L0/unmatch", { method: "POST" }));
    expect(unmatched.status).toBe(200);
    expect((await unmatched.json()) as any).toMatchObject({ status: "unmatched", matchedEntryId: null, matchedAt: null });
  });

  it("rejects re-matching a matched line and unmatching an unmatched one with 409", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    await app.fetch(req("/stmt-1/lines/stmt-1:L0/match", { method: "POST", body: JSON.stringify({ entryId: "je-1" }) }));

    const remat = await app.fetch(req("/stmt-1/lines/stmt-1:L0/match", { method: "POST", body: JSON.stringify({ entryId: "je-2" }) }));
    expect(remat.status).toBe(409);
    expect(((await remat.json()) as any).error).toBe("LINE_ALREADY_MATCHED");

    const unmat = await app.fetch(req("/stmt-1/lines/stmt-1:L1/unmatch", { method: "POST" }));
    expect(unmat.status).toBe(409);
    expect(((await unmat.json()) as any).error).toBe("LINE_NOT_MATCHED");
  });

  it("returns 404 when matching a line that does not exist", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    const res = await app.fetch(req("/stmt-1/lines/nope/match", { method: "POST", body: JSON.stringify({ entryId: "je-1" }) }));
    expect(res.status).toBe(404);
  });

  it("auto-matches lines against the treasury account's real posted GL movements", async () => {
    const { app, gl } = await newApp();
    // A 1000 deposit into the bank GL account on the same day as the statement's first line,
    // and a 400 withdrawal two days after its second — inside the matcher's date tolerance.
    await postJournalEntry(
      { id: "je-in", date: "2026-08-01", memo: "إيداع", source: "system", lines: [
        { accountId: "1310", debit: Money.fromMajor("1000"), credit: Money.zero() },
        { accountId: "1100", debit: Money.zero(), credit: Money.fromMajor("1000") },
      ] },
      gl,
    );
    await postJournalEntry(
      { id: "je-out", date: "2026-08-05", memo: "سحب", source: "system", lines: [
        { accountId: "1100", debit: Money.fromMajor("400"), credit: Money.zero() },
        { accountId: "1310", debit: Money.zero(), credit: Money.fromMajor("400") },
      ] },
      gl,
    );

    await app.fetch(importReq());
    const res = await app.fetch(req("/stmt-1/auto-match", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matchedCount: 2 });

    const statement = (await (await app.fetch(req("/stmt-1"))).json()) as any;
    expect(statement.status).toBe("in_progress");
    expect(statement.matchSummary.matched).toBe(2);
    // the 5.00 bank fee has no GL counterpart and stays unmatched
    expect(statement.lines.find((l: any) => l.reference === "TX3").status).toBe("unmatched");
  });
});

describe("bank reconciliation routes — manual lines and finalize", () => {
  it("adds a line the CSV import missed", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    const res = await app.fetch(
      req("/stmt-1/lines", { method: "POST", body: JSON.stringify({ date: "2026-08-10", description: "فوائد دائنة", amount: "12.50" }) }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()) as any).toMatchObject({ id: "gen-1", amount: "12.500000", status: "unmatched" });
    expect(((await (await app.fetch(req("/stmt-1"))).json()) as any).lines).toHaveLength(4);
  });

  it("LIMITATION (D82): finalizes with lines still unmatched, then locks every mutation with 409", async () => {
    const { app } = await newApp();
    await app.fetch(importReq());
    // Every imported line is still unmatched at this point — the route never
    // checks, so the reconciliation closes over its own open differences.
    const lines = ((await (await app.fetch(req("/stmt-1"))).json()) as any).lines as { status: string }[];
    expect(lines.every((line) => line.status === "unmatched")).toBe(true);

    const res = await app.fetch(req("/stmt-1/finalize", { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toMatchObject({ status: "completed", finalizedAt: "2026-08-22T10:00:00.000Z" });

    expect((await app.fetch(req("/stmt-1/finalize", { method: "POST" }))).status).toBe(409);
    expect(
      (await app.fetch(req("/stmt-1/lines/stmt-1:L0/match", { method: "POST", body: JSON.stringify({ entryId: "je-1" }) }))).status,
    ).toBe(409);
    expect(
      (await app.fetch(req("/stmt-1/lines", { method: "POST", body: JSON.stringify({ date: "2026-08-10", description: "x", amount: "1.00" }) }))).status,
    ).toBe(409);
  });
});
