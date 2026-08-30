import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import {
  ACCOUNT_SECTION_LABELS,
  ACCOUNT_TYPE_LABELS,
  accountNet,
  classifyAccount,
  isCashAccount,
  isLedgerEffective,
  isYearEndClose,
  moneyToNumber,
  netBalancesByAccount,
} from "./gl-shared.js";
import { YEAR_END_CLOSE_DOC_TYPE } from "../journal.js";

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

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "je-1",
    date: "2026-03-01",
    memo: "قيد",
    status: "posted",
    lines: [dr("1100", "100"), cr("4100", "100")],
    ...overrides,
  };
}

describe("classifyAccount", () => {
  it("classifies an 11xx asset as cash by code convention", () => {
    expect(classifyAccount(account({ code: "1100", type: "asset" }))).toBe("cash");
  });

  it("classifies a 12xx-14xx asset as current-asset", () => {
    expect(classifyAccount(account({ code: "1200", type: "asset" }))).toBe("current-asset");
    expect(classifyAccount(account({ code: "1499", type: "asset" }))).toBe("current-asset");
  });

  it("classifies a 15xx+ asset as non-current-asset", () => {
    expect(classifyAccount(account({ code: "1500", type: "asset" }))).toBe("non-current-asset");
  });

  it("classifies a 21xx-24xx liability as current-liability", () => {
    expect(classifyAccount(account({ code: "2100", type: "liability" }))).toBe("current-liability");
    expect(classifyAccount(account({ code: "2499", type: "liability" }))).toBe("current-liability");
  });

  it("classifies a 25xx+ liability as non-current-liability", () => {
    expect(classifyAccount(account({ code: "2500", type: "liability" }))).toBe("non-current-liability");
  });

  it("classifies equity/revenue/expense directly off type, ignoring code", () => {
    expect(classifyAccount(account({ code: "9999", type: "equity" }))).toBe("equity");
    expect(classifyAccount(account({ code: "9999", type: "revenue" }))).toBe("revenue");
    expect(classifyAccount(account({ code: "9999", type: "expense" }))).toBe("expense");
  });

  it("prefers the authoritative cashAccountIds set over the 11xx code convention", () => {
    const nonConventional = account({ id: "9100", code: "9100", type: "asset" });
    expect(classifyAccount(nonConventional, ["9100"])).toBe("cash");
    expect(classifyAccount(nonConventional)).toBe("non-current-asset");
  });

  it("does not treat an 11xx account as cash when cashAccountIds is given but excludes it", () => {
    const conventional = account({ id: "1100", code: "1100", type: "asset" });
    expect(classifyAccount(conventional, ["9999"])).toBe("current-asset");
  });
});

describe("isCashAccount", () => {
  it("is true only for accounts classifyAccount resolves to cash", () => {
    expect(isCashAccount(account({ code: "1100", type: "asset" }))).toBe(true);
    expect(isCashAccount(account({ code: "1200", type: "asset" }))).toBe(false);
    expect(isCashAccount(account({ code: "2100", type: "liability" }))).toBe(false);
  });
});

describe("moneyToNumber", () => {
  it("converts an exact Money value to its major-unit number", () => {
    expect(moneyToNumber(Money.fromMajor("1250.50"))).toBe(1250.5);
    expect(moneyToNumber(Money.zero())).toBe(0);
  });
});

describe("isLedgerEffective", () => {
  it("is true for posted and reversed entries", () => {
    expect(isLedgerEffective(entry({ status: "posted" }))).toBe(true);
    expect(isLedgerEffective(entry({ status: "reversed" }))).toBe(true);
  });

  it("is false for draft and pending entries", () => {
    expect(isLedgerEffective(entry({ status: "draft" }))).toBe(false);
    expect(isLedgerEffective(entry({ status: "pending" }))).toBe(false);
  });
});

describe("isYearEndClose", () => {
  it("is true only for the year-end close doc type", () => {
    expect(isYearEndClose(entry({ sourceDocType: YEAR_END_CLOSE_DOC_TYPE }))).toBe(true);
    expect(isYearEndClose(entry({ sourceDocType: "SALES_INVOICE" }))).toBe(false);
    expect(isYearEndClose(entry({ sourceDocType: null }))).toBe(false);
    expect(isYearEndClose(entry({}))).toBe(false);
  });
});

describe("netBalancesByAccount", () => {
  it("nets debit minus credit per account across posted entries", () => {
    const entries = [
      entry({ id: "je-1", date: "2026-01-01", lines: [dr("1100", "200"), cr("4100", "200")] }),
      entry({ id: "je-2", date: "2026-01-02", lines: [dr("4100", "50"), cr("1100", "50")] }),
    ];
    const balances = netBalancesByAccount(entries);
    expect(moneyToNumber(balances.get("1100")!)).toBe(150);
    expect(moneyToNumber(balances.get("4100")!)).toBe(-150);
  });

  it("excludes draft and pending entries from the net", () => {
    const entries = [
      entry({ id: "je-1", status: "draft", lines: [dr("1100", "999"), cr("4100", "999")] }),
      entry({ id: "je-2", status: "pending", lines: [dr("1100", "999"), cr("4100", "999")] }),
    ];
    const balances = netBalancesByAccount(entries);
    expect(balances.has("1100")).toBe(false);
  });

  it("includes reversed entries (reversal posts a mirror entry, never mutates)", () => {
    const entries = [entry({ id: "je-1", status: "reversed", lines: [dr("1100", "100"), cr("4100", "100")] })];
    const balances = netBalancesByAccount(entries);
    expect(moneyToNumber(balances.get("1100")!)).toBe(100);
  });

  it("filters by inclusive from/to date range", () => {
    const entries = [
      entry({ id: "je-1", date: "2026-01-05", lines: [dr("1100", "10"), cr("4100", "10")] }),
      entry({ id: "je-2", date: "2026-01-10", lines: [dr("1100", "20"), cr("4100", "20")] }),
      entry({ id: "je-3", date: "2026-01-15", lines: [dr("1100", "40"), cr("4100", "40")] }),
    ];
    const balances = netBalancesByAccount(entries, { from: "2026-01-05", to: "2026-01-10" });
    expect(moneyToNumber(balances.get("1100")!)).toBe(30);
  });

  it("excludes an entry exactly one day outside each range bound", () => {
    const entries = [
      entry({ id: "before", date: "2026-01-04", lines: [dr("1100", "10"), cr("4100", "10")] }),
      entry({ id: "on-from", date: "2026-01-05", lines: [dr("1100", "20"), cr("4100", "20")] }),
      entry({ id: "on-to", date: "2026-01-10", lines: [dr("1100", "40"), cr("4100", "40")] }),
      entry({ id: "after", date: "2026-01-11", lines: [dr("1100", "80"), cr("4100", "80")] }),
    ];
    const balances = netBalancesByAccount(entries, { from: "2026-01-05", to: "2026-01-10" });
    expect(moneyToNumber(balances.get("1100")!)).toBe(60);
  });

  it("returns an empty map over a range with no matching entries", () => {
    const entries = [entry({ date: "2026-01-05" })];
    const balances = netBalancesByAccount(entries, { from: "2026-06-01", to: "2026-06-30" });
    expect(balances.size).toBe(0);
  });

  it("excludes the year-end close entry only when asked to", () => {
    const entries = [
      entry({ id: "close", date: "2026-12-31", sourceDocType: YEAR_END_CLOSE_DOC_TYPE, lines: [dr("3200", "500"), cr("3100", "500")] }),
    ];
    expect(netBalancesByAccount(entries, {}, { excludeYearEndClose: true }).has("3200")).toBe(false);
    expect(moneyToNumber(netBalancesByAccount(entries, {}, { excludeYearEndClose: false }).get("3200")!)).toBe(500);
  });
});

describe("accountNet", () => {
  it("returns the net for one account as a plain number", () => {
    const entries = [entry({ lines: [dr("1100", "75.25"), cr("4100", "75.25")] })];
    expect(accountNet(entries, "1100")).toBe(75.25);
    expect(accountNet(entries, "4100")).toBe(-75.25);
  });

  it("returns 0 for an account with no movement at all", () => {
    const entries = [entry()];
    expect(accountNet(entries, "9999")).toBe(0);
  });
});

describe("label maps", () => {
  it("has an Arabic label for every AccountType", () => {
    expect(ACCOUNT_TYPE_LABELS).toEqual({
      asset: "الأصول",
      liability: "الالتزامات",
      equity: "حقوق الملكية",
      revenue: "الإيرادات",
      expense: "المصروفات",
    });
  });

  it("has an Arabic label for every AccountSection", () => {
    expect(ACCOUNT_SECTION_LABELS).toEqual({
      cash: "النقدية وما في حكمها",
      "current-asset": "الأصول المتداولة",
      "non-current-asset": "الأصول غير المتداولة",
      "current-liability": "الالتزامات المتداولة",
      "non-current-liability": "الالتزامات غير المتداولة",
      equity: "حقوق الملكية",
      revenue: "الإيرادات",
      expense: "المصروفات",
    });
  });
});
