import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { createCashFlowReport } from "./cash-flow.js";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "1100",
    code: "1100",
    nameAr: "النقدية",
    nameEn: "Cash",
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

function dr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.fromMajor(major), credit: Money.zero() };
}
function cr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.zero(), credit: Money.fromMajor(major) };
}
function je(overrides: Partial<JournalEntry> = {}): JournalEntry {
  const entry: JournalEntry = {
    id: "je-1",
    date: "2026-03-01",
    memo: "قيد",
    status: "posted",
    lines: [dr("1100", "100"), cr("3100", "100")],
    ...overrides,
  };
  assertBalanced(entry.lines);
  return entry;
}

const accounts: Account[] = [
  account({ id: "1100", code: "1100", nameAr: "النقدية", type: "asset", naturalBalance: "debit" }),
  account({ id: "1200", code: "1200", nameAr: "المخزون", type: "asset", naturalBalance: "debit" }),
  account({ id: "1500", code: "1500", nameAr: "معدات", type: "asset", naturalBalance: "debit" }),
  account({ id: "2100", code: "2100", nameAr: "الموردون", type: "liability", naturalBalance: "credit" }),
  account({ id: "2500", code: "2500", nameAr: "قرض طويل الأجل", type: "liability", naturalBalance: "credit" }),
  account({ id: "3100", code: "3100", nameAr: "رأس المال", type: "equity", naturalBalance: "credit" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue", naturalBalance: "credit" }),
  account({ id: "5100", code: "5100", nameAr: "مصروفات", type: "expense", naturalBalance: "debit" }),
];

describe("cash-flow — current-asset accounts and working-capital labels", () => {
  it("routes a current-asset account's movement into the operating activity, labelled as a working-capital change", () => {
    const entries = [
      je({ id: "buy-stock", date: "2026-01-05", lines: [dr("1200", "60"), cr("1100", "60")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-01-01", periodTo: "2026-01-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-01-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.rows.find((r) => r.rowId === "1200");
    expect(row?.activity).toBe("operating");
    expect(row?.amount).toBe(-60);
    expect(row?.label).toBe("التغير في الأصول المتداولة — المخزون");
  });
});

describe("cash-flow — negative net change and negative operating flow tone", () => {
  it("reports a net cash decrease and a negative operating flow when cash is drained by working-capital payments", () => {
    const entries = [
      je({ id: "capital", date: "2026-01-01", lines: [dr("1100", "100"), cr("3100", "100")] }),
      je({ id: "pay-supplier", date: "2026-01-10", lines: [dr("2100", "500"), cr("1100", "500")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-01-01", periodTo: "2026-01-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-01-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const netChangeKpi = outcome.kpis.find((k) => k.key === "netChange");
    const operatingKpi = outcome.kpis.find((k) => k.key === "operating");
    expect(netChangeKpi?.value).toBe(-400);
    expect(netChangeKpi?.tone).toBe("danger");
    expect(operatingKpi?.value).toBe(-500);
    expect(operatingKpi?.tone).toBe("danger");
  });
});

describe("cash-flow — comparison-only lines", () => {
  it("still lists an account that moved only in the comparison window, at zero for the current period", () => {
    const entries = [
      je({ id: "prior-only", date: "2026-02-15", lines: [dr("2100", "70"), cr("1100", "70")] }),
      je({ id: "current-sale", date: "2026-03-05", lines: [dr("1100", "40"), cr("4100", "40")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const priorOnlyRow = outcome.rows.find((r) => r.rowId === "2100");
    expect(priorOnlyRow?.amount).toBe(0);
    expect(priorOnlyRow?.priorAmount).toBe(-70);
    expect(priorOnlyRow?.variance).toBe(70);
    expect(priorOnlyRow?.openingCash).toBe(outcome.rows[0]?.openingCash);
    expect(priorOnlyRow?.closingCash).toBe(outcome.rows[0]?.closingCash);
  });
});
