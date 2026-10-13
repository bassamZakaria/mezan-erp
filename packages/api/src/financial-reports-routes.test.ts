import { describe, it, expect, afterEach } from "vitest";
import { Money, postJournalEntry, type Account, type JournalPostingDeps } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
} from "@mezan/persistence";
import { createFinancialReportsRoutes, type FinancialReportsRoutesDeps } from "./financial-reports-routes.js";

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

function req(path: string, permissions?: string) {
  const headers = new Headers();
  if (permissions !== undefined) headers.set("x-permissions", permissions);
  return new Request(`http://local${path}`, { headers });
}

/**
 * One coherent posted ledger, dated so that OPEN1/JULSALE sit strictly before
 * `periodFrom` (2026-08-01) in every route test below, SALE1/SALE2 sit exactly
 * on the two period boundaries, and AFTER1 sits strictly after `periodTo`
 * (2026-08-31) — every date-range assertion in this file reads off this one
 * set, arithmetic done by hand in the test bodies rather than copied from a run.
 */
async function seed() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(ledger, accounts, periods);

  await accounts.create(account("1100", { nameAr: "النقدية" })); // cash
  await accounts.create(account("1200", { nameAr: "العملاء" })); // AR
  await accounts.create(account("1400", { nameAr: "ضريبة مدخلات" })); // input VAT (asset)
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit", nameAr: "الموردون" })); // AP
  await accounts.create(account("2200", { type: "liability", naturalBalance: "credit", nameAr: "ضريبة مخرجات" })); // output VAT
  await accounts.create(account("3100", { type: "equity", naturalBalance: "credit", nameAr: "رأس المال" })); // capital
  await accounts.create(account("4100", { type: "revenue", naturalBalance: "credit", nameAr: "المبيعات" })); // revenue
  await accounts.create(account("5100", { type: "expense", naturalBalance: "debit", nameAr: "تكلفة البضاعة" })); // cogs
  await accounts.create(account("5200", { type: "expense", naturalBalance: "debit", nameAr: "مصروفات تشغيلية" })); // opex

  await periods.create({ id: "fp-07", year: 2026, periodNumber: 7, startDate: "2026-07-01", endDate: "2026-07-31", status: "open" });
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await periods.create({ id: "fp-09", year: 2026, periodNumber: 9, startDate: "2026-09-01", endDate: "2026-09-30", status: "open" });

  const deps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };

  // Capital injected as cash, before the period entirely.
  await postJournalEntry({
    id: "je-open", date: "2026-07-01", memo: "افتتاح رأس المال",
    lines: [
      { accountId: "1100", debit: Money.fromMajor("10000"), credit: Money.zero() },
      { accountId: "3100", debit: Money.zero(), credit: Money.fromMajor("10000") },
    ],
  }, deps);

  // A cash sale in the PRIOR comparison window (July), no VAT.
  await postJournalEntry({
    id: "je-jul-sale", date: "2026-07-15", memo: "مبيعات يوليو",
    lines: [
      { accountId: "1100", debit: Money.fromMajor("800"), credit: Money.zero() },
      { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("800") },
    ],
  }, deps);

  // On periodFrom's boundary: a credit sale with 14% output VAT.
  await postJournalEntry({
    id: "je-sale1", date: "2026-08-01", memo: "مبيعات أول أغسطس",
    lines: [
      { accountId: "1200", debit: Money.fromMajor("1140"), credit: Money.zero() },
      { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("1000"), taxRatePercent: 14 },
      { accountId: "2200", debit: Money.zero(), credit: Money.fromMajor("140"), taxRatePercent: 14 },
    ],
  }, deps);

  // Mid-period: an opex purchase on credit with 14% input VAT.
  await postJournalEntry({
    id: "je-expense1", date: "2026-08-15", memo: "مصروف تشغيلي منتصف أغسطس",
    lines: [
      { accountId: "5200", debit: Money.fromMajor("500"), credit: Money.zero(), taxRatePercent: 14 },
      { accountId: "1400", debit: Money.fromMajor("70"), credit: Money.zero(), taxRatePercent: 14 },
      { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("570") },
    ],
  }, deps);

  // Mid-period: COGS paid from cash, no VAT.
  await postJournalEntry({
    id: "je-cogs1", date: "2026-08-20", memo: "تكلفة بضاعة مباعة",
    lines: [
      { accountId: "5100", debit: Money.fromMajor("300"), credit: Money.zero() },
      { accountId: "1100", debit: Money.zero(), credit: Money.fromMajor("300") },
    ],
  }, deps);

  // On periodTo's boundary: a zero-rated cash sale (no VAT line at all).
  await postJournalEntry({
    id: "je-sale2", date: "2026-08-31", memo: "مبيعات آخر أغسطس",
    lines: [
      { accountId: "1100", debit: Money.fromMajor("400"), credit: Money.zero() },
      { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("400") },
    ],
  }, deps);

  // Strictly after periodTo — must never appear in an August report.
  await postJournalEntry({
    id: "je-after1", date: "2026-09-05", memo: "مبيعات سبتمبر",
    lines: [
      { accountId: "1100", debit: Money.fromMajor("999"), credit: Money.zero() },
      { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("999") },
    ],
  }, deps);

  return { ledger, accounts, deps };
}

function makeApp(overrides: Partial<FinancialReportsRoutesDeps> & Pick<FinancialReportsRoutesDeps, "ledger" | "accounts">) {
  const deps: FinancialReportsRoutesDeps = { today: () => "2026-08-31", ...overrides };
  return createFinancialReportsRoutes(deps, insecureHeaderAuthContextResolver);
}

const ROUTES: readonly (readonly [string, string])[] = [
  ["/trial-balance", "asOfDate=2026-08-31"],
  ["/income-statement", "periodFrom=2026-08-01&periodTo=2026-08-31"],
  ["/balance-sheet", "asOfDate=2026-08-31"],
  ["/cash-flow", "periodFrom=2026-08-01&periodTo=2026-08-31"],
  ["/vat-return", "periodFrom=2026-08-01&periodTo=2026-08-31&outputVatAccountId=2200&inputVatAccountId=1400"],
  ["/general-ledger", "periodFrom=2026-08-01&periodTo=2026-08-31"],
  ["/account-ledger", "accountId=1100&periodFrom=2026-08-01&periodTo=2026-08-31"],
];

describe("financial reports routes — permission gate", () => {
  it("refuses every one of the seven statements to a caller with no permission at all", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    for (const [path, query] of ROUTES) {
      const res = await app.fetch(req(`${path}?${query}`));
      expect(res.status, path).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error, path).toBe("PERMISSION_DENIED");
    }
  });

  it("refuses every one of the seven statements to a caller holding an unrelated permission", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    for (const [path, query] of ROUTES) {
      const res = await app.fetch(req(`${path}?${query}`, "accounting.coa.view"));
      expect(res.status, path).toBe(403);
    }
  });

  it("answers every one of the seven statements 200 for the right permission", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    for (const [path, query] of ROUTES) {
      const res = await app.fetch(req(`${path}?${query}`, "accounting.reports.view"));
      expect(res.status, path).toBe(200);
    }
  });
});

describe("GET /trial-balance", () => {
  it("balances debit and credit as of 2026-08-31, over the six entries posted on or before it", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(req("/trial-balance?asOfDate=2026-08-31", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { accountId: string; debit: number; credit: number }[];
      kpis: { key: string; value: number }[];
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };

    // je-after1 (2026-09-05) must not be counted: cash is 10000+800-300+400=10900, not 11899.
    const cash = body.rows.find((r) => r.accountId === "1100")!;
    expect(cash.debit).toBe(10900);
    expect(cash.credit).toBe(0);

    const ap = body.rows.find((r) => r.accountId === "2100")!;
    expect(ap.debit).toBe(0);
    expect(ap.credit).toBe(570);

    const revenue = body.rows.find((r) => r.accountId === "4100")!;
    expect(revenue.credit).toBe(2200); // 800 (Jul) + 1000 (Aug 1) + 400 (Aug 31)

    const debitKpi = body.kpis.find((k) => k.key === "debit")!.value;
    const creditKpi = body.kpis.find((k) => k.key === "credit")!.value;
    expect(debitKpi).toBe(12910);
    expect(creditKpi).toBe(12910);
    expect(body.kpis.find((k) => k.key === "difference")!.value).toBe(0);

    expect(body.reconciliation.reportTotal).toBe(12910);
    expect(body.reconciliation.referenceTotal).toBe(12910);
    expect(body.reconciliation.diff).toBe(0);
    expect(body.reconciliation.withinTolerance).toBe(true);
  });
});

describe("GET /income-statement", () => {
  it("computes August's net income and the July comparison window — a comment in the route says this was silently zero before", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/income-statement?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { accountId: string; amount: number; priorAmount: number; variance: number }[];
      kpis: { key: string; value: number }[];
    };

    const revenue = body.rows.find((r) => r.accountId === "4100")!;
    expect(revenue.amount).toBe(1400); // 1000 (je-sale1) + 400 (je-sale2)
    // je-jul-sale (2026-07-15) is the only revenue in the comparison window —
    // if the route stopped loading the ledger at periodFrom (2026-08-01) as it
    // once did, this would read 0 instead of the true prior-period figure.
    expect(revenue.priorAmount).toBe(800);
    expect(revenue.variance).toBe(600);

    const cogs = body.rows.find((r) => r.accountId === "5100")!;
    expect(cogs.amount).toBe(-300);
    expect(cogs.priorAmount).toBe(0);

    const opex = body.rows.find((r) => r.accountId === "5200")!;
    expect(opex.amount).toBe(-500);
    expect(opex.priorAmount).toBe(0);

    expect(body.kpis.find((k) => k.key === "revenue")!.value).toBe(1400);
    expect(body.kpis.find((k) => k.key === "expenses")!.value).toBe(800);
    expect(body.kpis.find((k) => k.key === "netIncome")!.value).toBe(600); // 1400 - 300 - 500
    expect(body.kpis.find((k) => k.key === "variance")!.value).toBe(-200); // 600 - 800
  });
});

describe("GET /balance-sheet", () => {
  it("balances assets against liabilities + equity as of 2026-08-31, life-to-date net income folded into retained earnings", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(req("/balance-sheet?asOfDate=2026-08-31", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { rowId: string; accountId?: string; amount: number; sectionKey: string; side: string }[];
      kpis: { key: string; value: number }[];
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };

    const cash = body.rows.find((r) => r.rowId === "1100")!;
    expect(cash.amount).toBe(10900);
    expect(cash.sectionKey).toBe("cash");
    expect(cash.side).toBe("asset");

    const ar = body.rows.find((r) => r.rowId === "1200")!;
    expect(ar.amount).toBe(1140);
    expect(ar.sectionKey).toBe("current-asset");

    const ap = body.rows.find((r) => r.rowId === "2100")!;
    expect(ap.amount).toBe(570);
    expect(ap.side).toBe("liability-equity");

    const capital = body.rows.find((r) => r.rowId === "3100")!;
    expect(capital.amount).toBe(10000);

    // Life-to-date net income: revenue 2200 (800 + 1000 + 400) − cogs 300 − opex 500 = 1400.
    const retained = body.rows.find((r) => r.rowId === "_retained-earnings")!;
    expect(retained.amount).toBe(1400);

    expect(body.kpis.find((k) => k.key === "totalAssets")!.value).toBe(12110);
    expect(body.kpis.find((k) => k.key === "totalLiabilitiesEquity")!.value).toBe(12110);
    expect(body.kpis.find((k) => k.key === "difference")!.value).toBe(0);
    expect(body.reconciliation.withinTolerance).toBe(true);
    expect(body.reconciliation.diff).toBe(0);
  });
});

describe("GET /cash-flow", () => {
  it("reaches the ledger back before periodFrom for the opening cash balance", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/cash-flow?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { key: string; value: number }[] };

    // Opening cash is the balance as of 2026-07-31: je-open (10000) + je-jul-sale (800).
    // A route that only bounded the ledger query at periodFrom would read this as 0.
    expect(body.kpis.find((k) => k.key === "openingCash")!.value).toBe(10800);
    // Closing cash: 10800 - 300 (je-cogs1) + 400 (je-sale2) = 10900.
    expect(body.kpis.find((k) => k.key === "closingCash")!.value).toBe(10900);
    expect(body.kpis.find((k) => k.key === "netChange")!.value).toBe(100);
    // No investing/financing activity touched this period, so operating carries the whole change.
    expect(body.kpis.find((k) => k.key === "operating")!.value).toBe(100);
  });

  it("ties the reconciliation banner: opening + net change = closing", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/cash-flow?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    const body = (await res.json()) as {
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };
    expect(body.reconciliation.reportTotal).toBe(10900);
    expect(body.reconciliation.referenceTotal).toBe(10900);
    expect(body.reconciliation.diff).toBe(0);
    expect(body.reconciliation.withinTolerance).toBe(true);
  });
});

describe("GET /vat-return", () => {
  it("splits output/input tax by rate and nets the amount payable", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts, vatAccounts: { outputVatAccountId: "2200", inputVatAccountId: "1400" } });
    const res = await app.fetch(
      req("/vat-return?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { rowId: string; side: string; rate: number; base: number; tax: number }[];
      kpis: { key: string; value: number }[];
    };

    const output14 = body.rows.find((r) => r.rowId === "output-14")!;
    expect(output14.base).toBe(1000);
    expect(output14.tax).toBe(140); // 14% of 1000

    // je-sale2 carries no VAT line at all — the zero-rated bucket.
    const output0 = body.rows.find((r) => r.rowId === "output-0")!;
    expect(output0.base).toBe(400);
    expect(output0.tax).toBe(0);

    const input14 = body.rows.find((r) => r.rowId === "input-14")!;
    expect(input14.base).toBe(500);
    expect(input14.tax).toBe(70); // 14% of 500

    expect(body.kpis.find((k) => k.key === "outputTax")!.value).toBe(140);
    expect(body.kpis.find((k) => k.key === "inputTax")!.value).toBe(70);
    expect(body.kpis.find((k) => k.key === "netPayable")!.value).toBe(70); // 140 - 70
    expect(body.kpis.find((k) => k.key === "taxableBase")!.value).toBe(1400); // 1000 + 400
  });

  it("falls back to the tenant's configured VAT accounts when the query gives none", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts, vatAccounts: { outputVatAccountId: "2200", inputVatAccountId: "1400" } });
    const res = await app.fetch(req("/vat-return?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { key: string; value: number }[] };
    expect(body.kpis.find((k) => k.key === "netPayable")!.value).toBe(70);
  });

  it("resolves the VAT accounts from query params alone when the tenant has none configured", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req(
        "/vat-return?periodFrom=2026-08-01&periodTo=2026-08-31&outputVatAccountId=2200&inputVatAccountId=1400",
        "accounting.reports.view",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { key: string; value: number }[] };
    expect(body.kpis.find((k) => k.key === "netPayable")!.value).toBe(70);
  });

  it("400s naming outputVatAccountId when neither the tenant nor the query resolves any VAT account", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(req("/vat-return?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: { field: string; message: string }[] };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.errors[0]?.field).toBe("outputVatAccountId");
    expect(body.errors[0]?.message).toBe("حدد حسابي ضريبة المخرجات والمدخلات");
  });

  it("400s naming inputVatAccountId when only the output account resolves", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/vat-return?periodFrom=2026-08-01&periodTo=2026-08-31&outputVatAccountId=2200", "accounting.reports.view"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { field: string; message: string }[] };
    expect(body.errors[0]?.field).toBe("inputVatAccountId");
  });
});

describe("GET /general-ledger", () => {
  it("keeps a document dated on each boundary of the range and drops the ones outside it", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/general-ledger?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { memo: string; debit: number; credit: number }[] };

    const memos = new Set(body.rows.map((r) => r.memo));
    expect(memos).toEqual(
      new Set(["مبيعات أول أغسطس", "مصروف تشغيلي منتصف أغسطس", "تكلفة بضاعة مباعة", "مبيعات آخر أغسطس"]),
    );
    expect(memos.has("افتتاح رأس المال")).toBe(false); // 2026-07-01, before periodFrom
    expect(memos.has("مبيعات يوليو")).toBe(false); // 2026-07-15, before periodFrom
    expect(memos.has("مبيعات سبتمبر")).toBe(false); // 2026-09-05, after periodTo

    // 4 entries: je-sale1 (3 lines) + je-expense1 (3) + je-cogs1 (2) + je-sale2 (2) = 10.
    expect(body.rows).toHaveLength(10);
  });

  it("ties debit to credit and reports 8 distinct accounts touched", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/general-ledger?periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    const body = (await res.json()) as {
      kpis: { key: string; value: number }[];
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number };
    };
    expect(body.kpis.find((k) => k.key === "lineCount")!.value).toBe(10);
    expect(body.kpis.find((k) => k.key === "accountCount")!.value).toBe(8);
    expect(body.reconciliation.reportTotal).toBe(body.reconciliation.referenceTotal);
    expect(body.reconciliation.diff).toBe(0);
  });

  it("renders a range that contains nothing as zero honestly, not blank or NaN", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/general-ledger?periodFrom=2030-01-01&periodTo=2030-01-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("NaN");
    const body = JSON.parse(text) as {
      rows: unknown[];
      kpis: { key: string; value: number }[];
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };
    expect(body.rows).toEqual([]);
    expect(body.kpis.find((k) => k.key === "lineCount")!.value).toBe(0);
    expect(body.kpis.find((k) => k.key === "accountCount")!.value).toBe(0);
    expect(body.reconciliation.reportTotal).toBe(0);
    expect(body.reconciliation.referenceTotal).toBe(0);
    expect(body.reconciliation.diff).toBe(0);
    expect(body.reconciliation.withinTolerance).toBe(true);
  });
});

describe("GET /account-ledger", () => {
  it("reaches the ledger back before periodFrom for the account's opening balance", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/account-ledger?accountId=1100&periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { isOpening: boolean; balance: number; debit: number; credit: number }[];
      kpis: { key: string; value: number }[];
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };

    const opening = body.rows.find((r) => r.isOpening)!;
    // je-open (10000) + je-jul-sale (800), both dated before 2026-08-01.
    expect(opening.balance).toBe(10800);

    const closing = body.rows[body.rows.length - 1]!;
    // 10800 - 300 (je-cogs1, 2026-08-20) + 400 (je-sale2, 2026-08-31) = 10900.
    expect(closing.balance).toBe(10900);

    expect(body.kpis.find((k) => k.key === "openingBalance")!.value).toBe(10800);
    expect(body.kpis.find((k) => k.key === "closingBalance")!.value).toBe(10900);

    // The running total must agree with a fresh as-of aggregate off the same ledger.
    expect(body.reconciliation.reportTotal).toBe(10900);
    expect(body.reconciliation.referenceTotal).toBe(10900);
    expect(body.reconciliation.withinTolerance).toBe(true);
  });

  it("refuses an account id that is not in the chart of accounts", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/account-ledger?accountId=does-not-exist&periodFrom=2026-08-01&periodTo=2026-08-31", "accounting.reports.view"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { field: string; message: string }[] };
    expect(body.errors[0]?.field).toBe("accountId");
    expect(body.errors[0]?.message).toBe("اختر حساباً");
  });
});

describe("the same posted ledger, seen from three financial statements", () => {
  it("ties the trial balance, the balance sheet's retained earnings and the income statement's net income together", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });

    const tb = (await (
      await app.fetch(req("/trial-balance?asOfDate=2026-08-31", "accounting.reports.view"))
    ).json()) as { reconciliation: { diff: number } };
    expect(tb.reconciliation.diff).toBe(0);

    const bs = (await (
      await app.fetch(req("/balance-sheet?asOfDate=2026-08-31", "accounting.reports.view"))
    ).json()) as { rows: { rowId: string; amount: number }[]; reconciliation: { diff: number } };
    expect(bs.reconciliation.diff).toBe(0);
    const retainedEarnings = bs.rows.find((r) => r.rowId === "_retained-earnings")!.amount;

    // A period wide enough to cover every posted entry with revenue/expense activity.
    const income = (await (
      await app.fetch(
        req("/income-statement?periodFrom=2026-07-01&periodTo=2026-08-31", "accounting.reports.view"),
      )
    ).json()) as { kpis: { key: string; value: number }[] };
    const netIncome = income.kpis.find((k) => k.key === "netIncome")!.value;

    expect(netIncome).toBe(1400);
    expect(retainedEarnings).toBe(netIncome);
  });
});

describe("financial reports routes — deps edge cases", () => {
  it("still answers when the caller supplies no `today` override, falling back to the real clock", async () => {
    const { ledger, accounts } = await seed();
    const app = createFinancialReportsRoutes({ ledger, accounts }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/trial-balance?asOfDate=2026-08-31", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { key: string; value: number }[] };
    expect(body.kpis.find((k) => k.key === "debit")!.value).toBe(12910);
  });

  it("refuses /account-ledger's default account id (empty chart of accounts) rather than crashing", async () => {
    const ledger = createSqliteLedgerStore();
    const accounts = createSqliteAccountRepository();
    closers.push(ledger, accounts);
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(req("/account-ledger", "accounting.reports.view"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { field: string; message: string }[] };
    expect(body.errors[0]?.field).toBe("accountId");
  });
});

describe("financial reports routes — malformed and impossible dates", () => {
  it("refuses a date that is not a date at all, with 400 VALIDATION_ERROR", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });

    const tb = await app.fetch(req("/trial-balance?asOfDate=not-a-date", "accounting.reports.view"));
    expect(tb.status).toBe(400);
    expect(((await tb.json()) as { error: string }).error).toBe("VALIDATION_ERROR");

    const gl = await app.fetch(req("/general-ledger?periodFrom=not-a-date&periodTo=2026-08-31", "accounting.reports.view"));
    expect(gl.status).toBe(400);
  });

  it("refuses periodFrom after periodTo", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(
      req("/general-ledger?periodFrom=2026-08-31&periodTo=2026-08-01", "accounting.reports.view"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { field: string; message: string }[] };
    expect(body.errors[0]?.field).toBe("periodFrom");
    expect(body.errors[0]?.message).toBe("تاريخ البداية يجب أن يسبق تاريخ النهاية");
  });

  it("refuses an impossible date rather than answering with an empty report (D98)", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });

    // 2026-13-45 has no thirteenth month and no forty-fifth day. It used to
    // match the regex the parameter was checked against, so the route accepted
    // it and answered empty — indistinguishable, on screen, from a period that
    // genuinely had no entries.
    const res = await app.fetch(
      req("/general-ledger?periodFrom=2026-13-45&periodTo=2026-13-45", "accounting.reports.view"),
    );
    expect(res.status).toBe(400);
  });

  it("refuses the 30th of February on a statement too", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(req("/trial-balance?asOfDate=2026-02-30", "accounting.reports.view"));
    expect(res.status).toBe(400);
  });

  it("still runs on a real date, so the check is not refusing everything", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(req("/trial-balance?asOfDate=2026-08-22", "accounting.reports.view"));
    expect(res.status).toBe(200);
  });
});

/**
 * DEC-20 — the branch dimension the statements were denied under D111, now that
 * the posted journal LINE carries one. These assertions replace D111's pinned
 * LIMITATION pair: the parameter used to be stripped and a branch-scoped caller
 * used to receive the whole company, and neither is true any more.
 */
describe("financial reports — بُعد الفرع on the statements (DEC-20)", () => {
  /** A branch-tagged sale on top of the seed, whose every line names فرع القاهرة. */
  async function seedWithBranch() {
    const seeded = await seed();
    await postJournalEntry(
      {
        id: "je-branch-sale",
        date: "2026-08-10",
        memo: "مبيعات فرع القاهرة",
        lines: [
          { accountId: "1100", debit: Money.fromMajor("250"), credit: Money.zero(), branchId: "br-1" },
          { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("250"), branchId: "br-1" },
        ],
      },
      seeded.deps,
    );
    return seeded;
  }

  function scopedReq(path: string, branchScope: string, extraPermission?: string) {
    return new Request(`http://local${path}`, {
      headers: {
        "x-permissions": ["accounting.reports.view", ...(extraPermission ? [extraPermission] : [])].join(","),
        "x-branch-scope": branchScope,
      },
    });
  }

  async function trialBalance(app: ReturnType<typeof makeApp>, request: Request) {
    const res = await app.fetch(request);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      params: Record<string, unknown>;
      rows: { accountId: string; debit: number; credit: number; unattributed: number }[];
      grandTotals: Record<string, number>;
    };
  }

  it("honours the branchId parameter instead of stripping it", async () => {
    const { ledger, accounts } = await seedWithBranch();
    const app = makeApp({ ledger, accounts });
    const body = await trialBalance(app, req("/trial-balance?asOfDate=2026-08-31&branchId=br-1", "accounting.reports.view"));

    expect(body.params.branchId).toBe("br-1");
    // Only the branch-tagged sale: 250 of cash against 250 of revenue.
    expect(body.grandTotals.debit).toBe(250);
    expect(body.grandTotals.credit).toBe(250);
  });

  it("reports «غير مخصص» on every run, unchanged by the branch asked for", async () => {
    const { ledger, accounts } = await seedWithBranch();
    const app = makeApp({ ledger, accounts });
    const wide = await trialBalance(app, req("/trial-balance?asOfDate=2026-08-31", "accounting.reports.view"));
    const branch = await trialBalance(app, req("/trial-balance?asOfDate=2026-08-31&branchId=br-1", "accounting.reports.view"));

    // The reconciling item is a column, not something the filter can remove:
    // branch + unattributed is what adds back up to the entity, and a reader
    // who could hide it would be reading a branch P&L that does not sum.
    const unattributedOf = (body: { rows: { accountId: string; unattributed: number }[] }, accountId: string) =>
      body.rows.find((r) => r.accountId === accountId)?.unattributed ?? 0;
    expect(unattributedOf(branch, "4100")).toBe(unattributedOf(wide, "4100"));
    // Revenue is credit-normal, so its unattributed net reads negative: the
    // seed's own sales (800 + 1000 + 400 through 31 August) carry no branch at all.
    expect(unattributedOf(wide, "4100")).toBe(-2200);
  });

  it("selects the «غير مخصص» bucket on its own", async () => {
    const { ledger, accounts } = await seedWithBranch();
    const app = makeApp({ ledger, accounts });
    const body = await trialBalance(
      app,
      req("/trial-balance?asOfDate=2026-08-31&branchId=__unattributed__", "accounting.reports.view"),
    );
    // Everything the seed posted, and none of the branch-tagged sale.
    expect(body.rows.find((r) => r.accountId === "4100")?.credit).toBe(2200);
  });

  it("refuses another branch's figures to a scoped caller, parameter or not", async () => {
    const { ledger, accounts } = await seedWithBranch();
    const app = makeApp({ ledger, accounts });

    // Granted a branch that posted nothing: the branch-tagged sale is out of
    // reach, and so are the unattributed lines — on a books file older than
    // the branch fill they are the company's whole history (D111).
    const scoped = await trialBalance(app, scopedReq("/trial-balance?asOfDate=2026-08-31", "br-9"));
    expect(scoped.rows.find((r) => r.accountId === "4100")?.credit).toBe(0);

    // The right to read them is its own permission, and brings them back.
    const trusted = await trialBalance(
      app,
      scopedReq("/trial-balance?asOfDate=2026-08-31", "br-9", "accounting.reports.view_unattributed"),
    );
    expect(trusted.rows.find((r) => r.accountId === "4100")?.credit).toBe(2200);

    // Asking for br-1 by name does not widen the scope back out.
    const asking = await trialBalance(app, scopedReq("/trial-balance?asOfDate=2026-08-31&branchId=br-1", "br-9"));
    expect(asking.grandTotals.debit).toBe(0);
    expect(asking.grandTotals.credit).toBe(0);
  });
});

/**
 * The income statement honours بُعد الفرع, tagged where it actually lives.
 *
 * This suite used to resolve an entry's branch through the DOCUMENT that
 * posted it, because the ledger carried no branch of its own. DEC-20 made that
 * false — `journal_line.branch_id` exists and main narrows at the LINE — and
 * keeping the old entry-level pre-filter alongside it narrowed twice: it
 * deleted every entry it could not attribute before the line-level logic saw
 * them, which zeroed the mandatory «غير مخصص» column and could leave debits
 * and credits unequal for a branch-scoped caller. So the mechanism is gone and
 * these assertions are made against the line.
 *
 * The sibling suite above proves the same property on the trial balance; this
 * one exists because the income statement is a different route.
 */
describe("financial reports routes — the income statement narrows by branch (DEC-20)", () => {
  /** Two branch-tagged sales on top of the seed: 1,000 to فرع ١ and 400 to فرع ٢. */
  async function seedTwoBranches() {
    const seeded = await seed();
    await postJournalEntry(
      {
        id: "je-br1-sale",
        date: "2026-08-05",
        memo: "مبيعات فرع ١",
        lines: [
          { accountId: "1100", debit: Money.fromMajor("1000"), credit: Money.zero(), branchId: "br-1" },
          { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("1000"), branchId: "br-1" },
        ],
      },
      seeded.deps,
    );
    await postJournalEntry(
      {
        id: "je-br2-sale",
        date: "2026-08-20",
        memo: "مبيعات فرع ٢",
        lines: [
          { accountId: "1100", debit: Money.fromMajor("400"), credit: Money.zero(), branchId: "br-2" },
          { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("400"), branchId: "br-2" },
        ],
      },
      seeded.deps,
    );
    return seeded;
  }

  function scoped(path: string, branchScope?: string, extraPermission?: string): Request {
    return new Request(`http://local${path}`, {
      headers: {
        "x-permissions": ["accounting.reports.view", ...(extraPermission ? [extraPermission] : [])].join(","),
        ...(branchScope ? { "x-branch-scope": branchScope } : {}),
      },
    });
  }

  const PERIOD = "periodFrom=2026-08-01&periodTo=2026-08-31";

  it("counts only the branch's own lines when the session is scoped to one branch", async () => {
    const { ledger, accounts } = await seedTwoBranches();
    const app = makeApp({ ledger, accounts });
    const amountFor = async (extraPermission?: string) => {
      const res = await app.fetch(scoped(`/income-statement?${PERIOD}`, "br-1", extraPermission));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: { accountId: string; amount: number }[] };
      return body.rows.find((r) => r.accountId === "4100")?.amount;
    };
    /*
     * فرع ١'s own 1,000 — NOT فرع ٢'s 400, and not the 1,400 no branch owns.
     *
     * «غير مخصص» is a reconciling item for whoever reads the whole company. A
     * branch-granted session reads it only with its own permission (D111): on
     * a books file older than the branch fill it is every posting ever made.
     */
    expect(await amountFor()).toBe(1000);
    expect(await amountFor("accounting.reports.view_unattributed")).toBe(2400);
  });

  it("?branchId= narrows an unscoped caller, and can never widen a scoped one", async () => {
    const { ledger, accounts } = await seedTwoBranches();
    const app = makeApp({ ledger, accounts });

    const narrowed = await app.fetch(scoped(`/income-statement?${PERIOD}&branchId=br-2`));
    const narrowedBody = (await narrowed.json()) as { rows: { accountId: string; amount: number }[] };
    expect(narrowedBody.rows.find((r) => r.accountId === "4100")?.amount).toBe(400);

    // Scoped to فرع ١, asking for فرع ٢ by name returns فرع ٢ nothing.
    const widened = await app.fetch(scoped(`/income-statement?${PERIOD}&branchId=br-2`, "br-1"));
    const widenedBody = (await widened.json()) as { rows: { accountId: string; amount: number }[] };
    expect(widenedBody.rows.find((r) => r.accountId === "4100")?.amount ?? 0).toBe(0);
  });

  it("leaves the company-wide statement untouched when no branch narrowing is asked for", async () => {
    const { ledger, accounts } = await seedTwoBranches();
    const app = makeApp({ ledger, accounts });
    const res = await app.fetch(scoped(`/income-statement?${PERIOD}`));
    const body = (await res.json()) as { rows: { accountId: string; amount: number }[] };
    // The seed's own 1,400 plus both branch sales — nothing is excluded.
    expect(body.rows.find((r) => r.accountId === "4100")?.amount).toBe(2800);
  });
});

describe("financial reports — trial balance: the SQL aggregate equals the JS fold (guards Q-6)", () => {
  it("returns the same body whether or not the ledger can aggregate", async () => {
    const { ledger, accounts } = await seed();
    const aggregating = makeApp({ ledger, accounts });
    // Same store, with the aggregate hidden: the route then loads the entries
    // and the report folds them, exactly as it did before Q-6.
    const folding = makeApp({
      ledger: { list: (filter) => ledger.list(filter) },
      accounts,
    });

    for (const asOfDate of ["2026-07-15", "2026-08-31", "2026-09-30", "2027-01-01"]) {
      const [a, b] = await Promise.all([
        aggregating.fetch(req(`/trial-balance?asOfDate=${asOfDate}`, "accounting.reports.view")),
        folding.fetch(req(`/trial-balance?asOfDate=${asOfDate}`, "accounting.reports.view")),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(await a.json()).toEqual(await b.json());
    }
  });
});
