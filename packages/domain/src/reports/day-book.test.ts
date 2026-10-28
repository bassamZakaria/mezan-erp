import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import { createDayBookReport } from "./day-book.js";

function account(id: string, nameAr: string): Account {
  return { id, code: id, nameAr, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" };
}

function dr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.fromMajor(major), credit: Money.zero() };
}
function cr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.zero(), credit: Money.fromMajor(major) };
}
function je(overrides: Partial<JournalEntry>): JournalEntry {
  return { id: "je", date: "2026-03-01", memo: "قيد", entryNo: "JE-000001", status: "posted", lines: [dr("1100", "100"), cr("4100", "100")], ...overrides };
}

const accounts = [account("1100", "النقدية"), account("4100", "المبيعات")];
const RANGE = { periodFrom: "2026-03-01", periodTo: "2026-03-31" };

function run(journalEntries: JournalEntry[]) {
  const outcome = runReport(createDayBookReport(RANGE), RANGE, { accounts, journalEntries });
  if (!outcome.ok) throw new Error("day book refused its params");
  return outcome;
}

describe("createDayBookReport (#126)", () => {
  it("orders entries by date, then by entry number numerically, and keeps each entry's lines together", () => {
    const outcome = run([
      je({ id: "c", date: "2026-03-05", entryNo: "JE-000010" }),
      je({ id: "b", date: "2026-03-02", entryNo: "JE-000009" }),
      je({ id: "a", date: "2026-03-05", entryNo: "JE-000002" }),
    ]);
    expect(outcome.groups.map((g) => g.key)).toEqual(["b", "a", "c"]);
    expect(outcome.rows.map((r) => r.entryId)).toEqual(["b", "b", "a", "a", "c", "c"]);
    expect(outcome.rows[0]).toMatchObject({ accountCode: "1100", accountNameAr: "النقدية", debit: "100.000000", credit: "0.000000" });
  });

  it("totals balance exactly, per entry and overall", () => {
    const outcome = run([
      je({ id: "a", lines: [dr("1100", "0.10"), dr("1100", "0.20"), cr("4100", "0.30")] }),
      je({ id: "b", entryNo: "JE-000002", lines: [dr("1100", "1250.50"), cr("4100", "1250.50")] }),
    ]);
    expect(outcome.grandTotals.debit).toBe(outcome.grandTotals.credit);
    expect(Money.fromMajor(String(outcome.grandTotals.debit)).toString()).toBe("1250.800000");
    for (const group of outcome.groups) expect(group.totals.debit).toBe(group.totals.credit);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
    expect(outcome.kpis.find((k) => k.key === "entryCount")?.value).toBe(2);
  });

  it("excludes drafts and out-of-range entries, and keeps both legs of a reversal", () => {
    const outcome = run([
      je({ id: "draft", status: "draft", entryNo: null }),
      je({ id: "before", date: "2026-02-28" }),
      je({ id: "orig", entryNo: "JE-000003", status: "reversed" }),
      je({ id: "rev", entryNo: "JE-000004", lines: [dr("4100", "100"), cr("1100", "100")] }),
    ]);
    expect(outcome.groups.map((g) => g.key)).toEqual(["orig", "rev"]);
    expect(outcome.grandTotals.debit).toBe(outcome.grandTotals.credit);
  });

  it("carries the line memo, falling back to the entry memo, and the source document number", () => {
    const outcome = run([
      je({ id: "a", memo: "فاتورة مبيعات", sourceDocNumber: "INV-000014", lines: [{ ...dr("1100", "5"), memo: "تحصيل" }, cr("4100", "5")] }),
    ]);
    expect(outcome.rows.map((r) => r.memo)).toEqual(["تحصيل", "فاتورة مبيعات"]);
    expect(outcome.rows.every((r) => r.sourceRef === "INV-000014")).toBe(true);
  });
});
