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

  return { ledger, accounts };
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

  it("LIMITATION (D98): a date-shaped impossible date passes validation and silently matches nothing", async () => {
    const { ledger, accounts } = await seed();
    const app = makeApp({ ledger, accounts });

    // 2026-13-45 has no thirteenth month and no forty-fifth day, but it matches
    // the regex the parameter is checked against, so the route accepts it and
    // answers with an empty report rather than refusing the request.
    const res = await app.fetch(
      req("/general-ledger?periodFrom=2026-13-45&periodTo=2026-13-45", "accounting.reports.view"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });
});
