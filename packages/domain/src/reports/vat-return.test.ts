import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry, JournalLine } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { createVatReturnReport, vatNetPayable, type VatReturnContext } from "./vat-return.js";

const OUTPUT_VAT = "2200";
const INPUT_VAT = "1400";

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

const accounts: Account[] = [
  account({ id: "1100", code: "1100", nameAr: "النقدية", type: "asset" }),
  account({ id: "1300", code: "1300", nameAr: "المخزون", type: "asset" }),
  account({ id: INPUT_VAT, code: "1400", nameAr: "ض.ق.م مدخلات", type: "asset" }),
  account({ id: "2100", code: "2100", nameAr: "الموردون", type: "liability" }),
  account({ id: OUTPUT_VAT, code: "2200", nameAr: "ض.ق.م مخرجات", type: "liability" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue" }),
  account({ id: "5100", code: "5100", nameAr: "مشتريات", type: "expense" }),
];

function line(overrides: Partial<JournalLine>): JournalLine {
  return { accountId: "1100", debit: Money.zero(), credit: Money.zero(), ...overrides };
}

function je(overrides: Partial<JournalEntry> & { lines: JournalLine[] }): JournalEntry {
  const entry: JournalEntry = { id: "je-1", date: "2026-03-01", memo: "قيد", status: "posted", ...overrides };
  assertBalanced(entry.lines);
  return entry;
}

const ctx = (entries: JournalEntry[]): VatReturnContext => ({
  accounts,
  journalEntries: entries,
  outputVatAccountId: OUTPUT_VAT,
  inputVatAccountId: INPUT_VAT,
});

describe("createVatReturnReport — rate-tagged lines (current, correct path)", () => {
  it("buckets output tax by the RATE the lines actually carry, not a blended per-entry average", () => {
    // A single sales entry mixing 14% and 0% lines — the tagged path must keep
    // them in separate buckets rather than dividing total tax by total base.
    const entries = [
      je({
        id: "mixed-sale",
        date: "2026-03-01",
        lines: [
          line({ accountId: "1100", debit: Money.fromMajor("114") }),
          line({ accountId: "4100", credit: Money.fromMajor("100"), taxRatePercent: 14 }),
          line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("14"), taxRatePercent: 14 }),
          line({ accountId: "1100", debit: Money.fromMajor("50") }),
          line({ accountId: "4100", credit: Money.fromMajor("50"), taxRatePercent: 0 }),
        ],
      }),
    ];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = (id: string) => outcome.rows.find((r) => r.rowId === id);
    expect(row("output-14")).toMatchObject({ rate: 14, base: 100, tax: 14 });
    expect(row("output-0")).toMatchObject({ rate: 0, base: 50, tax: 0 });
  });

  it("buckets input tax the same way, by the tagged rate", () => {
    const entries = [
      je({
        id: "purchase",
        date: "2026-03-05",
        lines: [
          line({ accountId: "1300", debit: Money.fromMajor("200"), taxRatePercent: 14 }),
          line({ accountId: INPUT_VAT, debit: Money.fromMajor("28"), taxRatePercent: 14 }),
          line({ accountId: "2100", credit: Money.fromMajor("228") }),
        ],
      }),
    ];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.rowId === "input-14")).toMatchObject({ rate: 14, base: 200, tax: 28 });
  });
});

describe(
  "createVatReturnReport — LIMITATION: untagged entries fall back to deriving the rate by dividing tax by base",
  () => {
    it("an entry with no taxRatePercent on its lines is bucketed by tax/base rounded to the nearest whole percent", () => {
      const entries = [
        je({
          id: "untagged-sale",
          date: "2026-03-01",
          lines: [line({ accountId: "1100", debit: Money.fromMajor("114") }), line({ accountId: "4100", credit: Money.fromMajor("100") }), line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("14") })],
        }),
      ];
      const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
      const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // Independently: 14 / 100 = 14% exactly, so the fallback happens to agree
      // here — but it derives the rate arithmetically, it does not read one.
      expect(outcome.rows.find((r) => r.rowId === "output-14")).toMatchObject({ rate: 14, base: 100, tax: 14 });
    });

    it("a revenue entry with no VAT line at all falls into the 0% (zero-rated) bucket", () => {
      const entries = [
        je({ id: "zero-rated", date: "2026-03-01", lines: [line({ accountId: "1100", debit: Money.fromMajor("60") }), line({ accountId: "4100", credit: Money.fromMajor("60") })] }),
      ];
      const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
      const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.rows.find((r) => r.rowId === "output-0")).toMatchObject({ rate: 0, base: 60, tax: 0 });
    });
  },
);

describe("createVatReturnReport — net payable / refundable", () => {
  it("computes net payable = output tax − input tax, independently subtracted", () => {
    const entries = [
      je({ id: "sale", date: "2026-03-01", lines: [line({ accountId: "1100", debit: Money.fromMajor("114") }), line({ accountId: "4100", credit: Money.fromMajor("100"), taxRatePercent: 14 }), line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("14"), taxRatePercent: 14 })] }),
      je({ id: "purchase", date: "2026-03-02", lines: [line({ accountId: "1300", debit: Money.fromMajor("50"), taxRatePercent: 14 }), line({ accountId: INPUT_VAT, debit: Money.fromMajor("7"), taxRatePercent: 14 }), line({ accountId: "2100", credit: Money.fromMajor("57") })] }),
    ];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(vatNetPayable(outcome.rows)).toBe(14 - 7);
    expect(outcome.grandTotals.tax).toBe(14 - 7); // the grandTotal override is NET, not the plain sum
  });

  it("renders zero payable, honestly, over a period with no VAT activity at all", () => {
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx([]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(vatNetPayable(outcome.rows)).toBe(0);
    expect(Number.isNaN(vatNetPayable(outcome.rows))).toBe(false);
  });

  it("includes an entry exactly on periodFrom/periodTo and excludes one day outside each bound", () => {
    const mk = (id: string, date: string): JournalEntry =>
      je({ id, date, lines: [line({ accountId: "1100", debit: Money.fromMajor("114") }), line({ accountId: "4100", credit: Money.fromMajor("100"), taxRatePercent: 14 }), line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("14"), taxRatePercent: 14 })] });
    const entries = [mk("before", "2026-02-28"), mk("on-from", "2026-03-01"), mk("on-to", "2026-03-31"), mk("after", "2026-04-01")];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.rowId === "output-14")?.tax).toBe(28);
  });

  it("orders output rows before input rows, each sorted by rate descending", () => {
    const entries = [
      je({ id: "sale-14", date: "2026-03-01", lines: [line({ accountId: "1100", debit: Money.fromMajor("114") }), line({ accountId: "4100", credit: Money.fromMajor("100"), taxRatePercent: 14 }), line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("14"), taxRatePercent: 14 })] }),
      je({ id: "sale-5", date: "2026-03-02", lines: [line({ accountId: "1100", debit: Money.fromMajor("105") }), line({ accountId: "4100", credit: Money.fromMajor("100"), taxRatePercent: 5 }), line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("5"), taxRatePercent: 5 })] }),
      je({ id: "purchase-14", date: "2026-03-03", lines: [line({ accountId: "1300", debit: Money.fromMajor("50"), taxRatePercent: 14 }), line({ accountId: INPUT_VAT, debit: Money.fromMajor("7"), taxRatePercent: 14 }), line({ accountId: "2100", credit: Money.fromMajor("57") })] }),
    ];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.rowId)).toEqual(["output-14", "output-5", "input-14"]);
  });

  it("rejects a period where periodFrom is after periodTo, via zod, not a throw", () => {
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-04-01", periodTo: "2026-03-01" }, ctx([]));
    expect(outcome.ok).toBe(false);
  });
});

/**
 * guards C-10 — the statutory VAT return summed its buckets in IEEE-754. The
 * number that drifts is the one filed with the authority.
 */
describe("createVatReturnReport — exact arithmetic", () => {
  it("sums a rate bucket exactly across many small invoices", () => {
    const entries = ["0.10", "0.20", "0.10", "0.30", "0.20"].map((amount, i) =>
      je({
        id: `s${i}`,
        date: "2026-03-0" + String(i + 1),
        lines: [
          line({ accountId: "1100", debit: Money.fromMajor(amount) }),
          line({ accountId: "4100", credit: Money.fromMajor(amount), taxRatePercent: 14 }),
        ],
      }),
    );
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const bucket = outcome.rows.find((r) => r.side === "output" && r.rate === 14);
    // 0.10 + 0.20 + 0.10 + 0.30 + 0.20 = 0.90, exactly.
    expect(bucket?.base).toBe(0.9);
  });

  it("derives an untagged entry's rate from exact integers, not a float quotient", () => {
    const entries = [
      je({
        id: "legacy",
        date: "2026-03-01",
        lines: [
          line({ accountId: "1100", debit: Money.fromMajor("114.00") }),
          line({ accountId: "4100", credit: Money.fromMajor("100.00") }),
          line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("14.00") }),
        ],
      }),
    ];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.side === "output")).toMatchObject({ rate: 14, base: 100, tax: 14 });
  });

  it("nets output against input exactly", () => {
    const entries = [
      je({
        id: "sale",
        date: "2026-03-01",
        lines: [
          line({ accountId: "1100", debit: Money.fromMajor("0.57") }),
          line({ accountId: "4100", credit: Money.fromMajor("0.50"), taxRatePercent: 14 }),
          line({ accountId: OUTPUT_VAT, credit: Money.fromMajor("0.07"), taxRatePercent: 14 }),
        ],
      }),
      je({
        id: "purchase",
        date: "2026-03-02",
        lines: [
          line({ accountId: "5100", debit: Money.fromMajor("0.30"), taxRatePercent: 14 }),
          line({ accountId: INPUT_VAT, debit: Money.fromMajor("0.04"), taxRatePercent: 14 }),
          line({ accountId: "2100", credit: Money.fromMajor("0.34") }),
        ],
      }),
    ];
    const definition = createVatReturnReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, ctx(entries));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(vatNetPayable(outcome.rows)).toBeCloseTo(0.03, 10);
  });
});
