import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { createAccountLedgerReport } from "./account-ledger.js";
import type { GlReportContext } from "./gl-shared.js";

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
    entryNo: "JE-000001",
    status: "posted",
    lines: [dr("1100", "100"), cr("4100", "100")],
    ...overrides,
  };
  assertBalanced(entry.lines);
  return entry;
}

const accounts: Account[] = [
  account({ id: "1100", code: "1100", nameAr: "النقدية", type: "asset" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue" }),
];

describe("createAccountLedgerReport", () => {
  it("produces a running debit-normal balance ending at the account's real net movement", () => {
    const entries = [
      je({ id: "je-1", entryNo: "JE-000001", date: "2026-03-01", lines: [dr("1100", "200"), cr("4100", "200")] }),
      je({ id: "je-2", entryNo: "JE-000002", date: "2026-03-05", lines: [dr("4100", "50"), cr("1100", "50")] }),
    ];
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]).toMatchObject({ isOpening: true, balance: 0 });
    expect(outcome.rows[1]?.balance).toBe(200);
    // Independently: 200 debit − 50 credit = 150.
    expect(outcome.rows[outcome.rows.length - 1]?.balance).toBe(150);
    expect(outcome.reconciliation).toMatchObject({ reportTotal: 150, referenceTotal: 150, withinTolerance: true });
  });

  it("carries an opening balance computed from postings strictly before periodFrom", () => {
    const entries = [
      je({ id: "before-1", date: "2026-01-01", lines: [dr("1100", "300"), cr("4100", "300")] }),
      je({ id: "before-2", date: "2026-02-15", lines: [dr("4100", "80"), cr("1100", "80")] }),
      je({ id: "in-period", date: "2026-03-10", lines: [dr("1100", "40"), cr("4100", "40")] }),
    ];
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Opening = 300 − 80 = 220, independently.
    expect(outcome.rows[0]).toMatchObject({ isOpening: true, balance: 220 });
    expect(outcome.rows[outcome.rows.length - 1]?.balance).toBe(260);
  });

  it("includes a line dated exactly on periodFrom/periodTo, excludes one day outside each bound", () => {
    const entries = [
      je({ id: "before", date: "2026-02-28", lines: [dr("1100", "999"), cr("4100", "999")] }),
      je({ id: "on-from", date: "2026-03-01", lines: [dr("1100", "10"), cr("4100", "10")] }),
      je({ id: "on-to", date: "2026-03-31", lines: [dr("1100", "20"), cr("4100", "20")] }),
      je({ id: "after", date: "2026-04-01", lines: [dr("1100", "888"), cr("4100", "888")] }),
    ];
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(3); // opening + 2 in-period movements
    expect(outcome.rows[0]).toMatchObject({ isOpening: true, balance: 999 });
    expect(outcome.rows[outcome.rows.length - 1]?.balance).toBe(999 + 30);
  });

  it("renders just the opening row (balance 0) over a period with no movement at all", () => {
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]).toMatchObject({ isOpening: true, balance: 0 });
    expect(Number.isNaN(outcome.rows[0]?.balance)).toBe(false);
  });

  it("orders in-period movements chronologically, then by entry number", () => {
    const entries = [
      je({ id: "je-2", entryNo: "JE-000002", date: "2026-03-01", lines: [dr("1100", "20"), cr("4100", "20")] }),
      je({ id: "je-1", entryNo: "JE-000001", date: "2026-03-01", lines: [dr("1100", "10"), cr("4100", "10")] }),
    ];
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.slice(1).map((r) => r.entryNo)).toEqual(["JE-000001", "JE-000002"]);
  });

  it("rejects an unknown account id via zod, not a throw", () => {
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "9999", periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: [] } satisfies GlReportContext);
    expect(outcome.ok).toBe(false);
  });

  it("rejects periodFrom after periodTo via zod, not a throw", () => {
    const definition = createAccountLedgerReport(accounts, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { accountId: "1100", periodFrom: "2026-04-01", periodTo: "2026-03-01" }, { accounts, journalEntries: [] } satisfies GlReportContext);
    expect(outcome.ok).toBe(false);
  });

  it("is on-demand and offers every postable (non-header) account as a picker option", () => {
    const withHeader: Account[] = [...accounts, account({ id: "9000", code: "9000", nameAr: "رئيسي", isHeader: true })];
    const definition = createAccountLedgerReport(withHeader, { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    expect(definition.onDemand).toBe(true);
    const picker = definition.paramFields.find((f) => f.kind === "select");
    expect(picker?.kind).toBe("select");
    if (picker?.kind !== "select") return;
    expect(picker.options.map((o) => o.value)).toEqual(["1100", "4100"]);
  });
});

/** guards C-10 — the running balance was a float accumulator down the whole ledger. */
describe("createAccountLedgerReport — exact arithmetic", () => {
  it("runs 0.10 + 0.20 + 0.10 to exactly 0.40, not 0.4000000000000001", () => {
    const entries = [
      je({ id: "a", entryNo: "JE-1", date: "2026-03-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "b", entryNo: "JE-2", date: "2026-03-02", lines: [dr("1100", "0.20"), cr("4100", "0.20")] }),
      je({ id: "c", entryNo: "JE-3", date: "2026-03-03", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
    ];
    const params = { accountId: "1100", periodFrom: "2026-03-01", periodTo: "2026-03-31" };
    const outcome = runReport(createAccountLedgerReport(accounts, params), params, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[outcome.rows.length - 1]?.balance).toBe(0.4);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });
});
