import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import { createWithholdingTaxReport, type WithholdingTaxContext } from "./withholding-tax.js";

function voucher(overrides: Partial<WithholdingTaxContext["rows"][number]> = {}): WithholdingTaxContext["rows"][number] {
  return {
    voucherId: "v1",
    voucherNo: "PV-000001",
    date: "2026-03-10",
    partyId: "sup-1",
    partyNameAr: "مورد أ",
    grossAmount: Money.fromMajor("1000.00"),
    ratePercent: 5,
    withheldAmount: Money.fromMajor("50.00"),
    ...overrides,
  };
}

describe("createWithholdingTaxReport", () => {
  it("computes net paid = gross − withheld, independently subtracted", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(
      definition,
      { fromDate: "2026-03-01", toDate: "2026-03-31" },
      { rows: [voucher({ grossAmount: Money.fromMajor("2000.00"), withheldAmount: Money.fromMajor("120.00") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.netPaidAmount).toBe(2000 - 120);
    expect(outcome.rows[0]?.grossAmount).toBe(2000);
    expect(outcome.rows[0]?.withheldAmount).toBe(120);
  });

  it("excludes a voucher with zero withheld amount — it was never a withholding event", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(
      definition,
      { fromDate: "2026-03-01", toDate: "2026-03-31" },
      { rows: [voucher({ withheldAmount: Money.zero() })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("includes a voucher dated exactly on fromDate/toDate and excludes one day outside each bound", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(
      definition,
      { fromDate: "2026-03-01", toDate: "2026-03-31" },
      {
        rows: [
          voucher({ voucherId: "before", date: "2026-02-28" }),
          voucher({ voucherId: "on-from", date: "2026-03-01" }),
          voucher({ voucherId: "on-to", date: "2026-03-31" }),
          voucher({ voucherId: "after", date: "2026-04-01" }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.voucherId).sort()).toEqual(["on-from", "on-to"]);
  });

  it("renders no rows, honestly, over a range with no withholding vouchers at all", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(definition, { fromDate: "2026-03-01", toDate: "2026-03-31" }, { rows: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.withheldAmount).toBe(0);
  });

  it("orders rows chronologically by date", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(
      definition,
      { fromDate: "2026-03-01", toDate: "2026-03-31" },
      { rows: [voucher({ voucherId: "later", date: "2026-03-20" }), voucher({ voucherId: "earlier", date: "2026-03-05" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.voucherId)).toEqual(["earlier", "later"]);
  });

  it("falls back to the voucher id as its number when voucherNo is null", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(definition, { fromDate: "2026-03-01", toDate: "2026-03-31" }, { rows: [voucher({ voucherId: "v-no-number", voucherNo: null })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.voucherNo).toBe("v-no-number");
  });

  it("defaults a null ratePercent to 0 rather than leaving it undefined/NaN", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(definition, { fromDate: "2026-03-01", toDate: "2026-03-31" }, { rows: [voucher({ ratePercent: null })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.ratePercent).toBe(0);
  });

  it("sums grossAmount and withheldAmount as its own independent KPI, agreeing with the column grand totals", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(
      definition,
      { fromDate: "2026-03-01", toDate: "2026-03-31" },
      { rows: [voucher({ voucherId: "a", grossAmount: Money.fromMajor("100"), withheldAmount: Money.fromMajor("5") }), voucher({ voucherId: "b", grossAmount: Money.fromMajor("200"), withheldAmount: Money.fromMajor("10") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const withheldKpi = outcome.kpis.find((k) => k.key === "withheldAmount")?.value;
    expect(withheldKpi).toBe(15);
    expect(outcome.grandTotals.withheldAmount).toBe(15);
    expect(outcome.grandTotals.grossAmount).toBe(300);
  });

  it("rejects fromDate after toDate via zod, not a throw", () => {
    const definition = createWithholdingTaxReport("2026-03-01", "2026-03-31");
    const outcome = runReport(definition, { fromDate: "2026-04-01", toDate: "2026-03-01" }, { rows: [] } satisfies WithholdingTaxContext);
    expect(outcome.ok).toBe(false);
  });
});
