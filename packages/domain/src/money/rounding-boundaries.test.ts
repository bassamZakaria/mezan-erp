/**
 * The four named rounding boundaries (money/rounding.ts ROUNDING_BOUNDARIES),
 * each exercised at its EXACT half-way value, in both signs.
 *
 * roundMoney is only the policy primitive. Each boundary has a real
 * implementation that has to obey it, and a negative amount rounding toward
 * zero where the positive one rounds away is the bug this file exists for.
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "./index.js";
import { ROUNDING_BOUNDARIES, allocate, allocateScaled, roundMoney } from "./rounding.js";
import { extend, unitCostOf } from "../inventory/wac-math.js";
import { computeInvoiceTotals } from "../sales-invoices/totals.js";
import type { SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";
import { distributeLandedCost } from "../landed-costs/distribution.js";

function invoiceLine(overrides: Partial<SalesInvoiceLine> & { lineId: string }): SalesInvoiceLine {
  return {
    itemId: overrides.lineId,
    itemNameAr: overrides.lineId,
    isStock: false,
    qty: Qty.fromMajor("1"),
    unitCode: "",
    unitFactor: 1,
    baseQty: overrides.qty ?? Qty.fromMajor("1"),
    unitPrice: Money.zero(),
    discountType: "percent",
    discountPercent: 0,
    discountAmount: Money.zero(),
    taxRatePercent: 0,
    revenueAccountId: "4000",
    cogsAccountId: null,
    inventoryAccountId: null,
    costCenterId: null,
    unitCost: null,
    ...overrides,
  };
}

describe("the four rounding boundaries are still exactly four, and still these four", () => {
  it("names them in the order plan.md documents", () => {
    expect([...ROUNDING_BOUNDARIES]).toEqual([
      "LINE_EXTENSION",
      "TAX_COMPUTATION",
      "DISCOUNT_ALLOCATION",
      "LANDED_COST_DISTRIBUTION",
    ]);
  });
});

describe("boundary 1 — LINE_EXTENSION (extend: qty × unit cost)", () => {
  /**
   * HALF_UP on the MAGNITUDE has to go away from zero on both signs, or a
   * reversing movement stops being the exact negative of the original and the
   * stock ledger drifts by a micro-unit per line.
   */
  it("rounds the exact half micro-unit away from zero, symmetrically", () => {
    const one = Money.fromScaled(1n);
    const half = Qty.fromMajor("0.5");
    expect(extend(half, one).toString()).toBe("0.000001");
    expect(extend(half.negate(), one).toString()).toBe("-0.000001");
    expect(extend(half, one).negate().equals(extend(half.negate(), one))).toBe(true);
  });

  it("picks HALF_UP over HALF_EVEN at a half where the two disagree", () => {
    const qty = Qty.fromMajor("2.5");
    const price = Money.fromScaled(1n);
    expect(extend(qty, price).toString()).toBe("0.000003");
    expect(extend(qty.negate(), price).toString()).toBe("-0.000003");
  });

  it("rounds unitCostOf at the half micro-unit away from zero in both signs", () => {
    const value = Money.fromScaled(25n);
    const qty = Qty.fromMajor("10");
    expect(unitCostOf(value, qty).toString()).toBe("0.000003");
    expect(unitCostOf(value.negate(), qty).toString()).toBe("-0.000003");
  });
});

describe("boundary 2 — TAX_COMPUTATION (taxable base × rate)", () => {
  it("rounds a tax landing exactly on the half piastre UP, not down", () => {
    const totals = computeInvoiceTotals(
      [invoiceLine({ lineId: "L1", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("0.05"), taxRatePercent: 10 })],
      { type: "amount", amount: Money.zero() },
    );
    expect(totals.lines[0]!.tax.toString()).toBe("0.010000");
    expect(totals.grandTotal.toString()).toBe("0.060000");
  });

  it("rounds the same half piastre away from zero on a credit (negative) line", () => {
    const totals = computeInvoiceTotals(
      [invoiceLine({ lineId: "L1", qty: Qty.fromMajor("-1"), unitPrice: Money.fromMajor("0.05"), taxRatePercent: 10 })],
      { type: "amount", amount: Money.zero() },
    );
    expect(totals.lines[0]!.gross.toString()).toBe("-0.050000");
    expect(totals.lines[0]!.tax.toString()).toBe("-0.010000");
  });

  it("rounds the tax INSIDE a tax-inclusive price away from zero too", () => {
    const inclusive = computeInvoiceTotals(
      [invoiceLine({ lineId: "L1", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("0.19"), taxRatePercent: 5 })],
      { type: "amount", amount: Money.zero() },
      { taxInclusive: true },
    );
    expect(inclusive.taxTotal.toString()).toBe("0.010000");
    expect(inclusive.taxableTotal.toString()).toBe("0.180000");
    expect(inclusive.grandTotal.toString()).toBe("0.190000");
  });
});

describe("boundary 3 — DISCOUNT_ALLOCATION (largest remainder)", () => {
  it("hands the indivisible residue to the lowest index, deterministically", () => {
    expect(allocateScaled(1n, [1n, 1n]).map(String)).toEqual(["1", "0"]);
    expect(allocateScaled(3n, [1n, 1n]).map(String)).toEqual(["2", "1"]);
  });

  it("mirrors the split for a negative total — a reversal is the same parts negated", () => {
    const positive = allocateScaled(7n, [3n, 3n, 1n]);
    const negative = allocateScaled(-7n, [3n, 3n, 1n]);
    expect(positive.map(String)).toEqual(["3", "3", "1"]);
    expect(negative.map(String)).toEqual(["-3", "-3", "-1"]);
    expect(negative.map((p) => -p)).toEqual(positive);
  });

  it("reconciles a Money discount that does not divide evenly, in both signs", () => {
    const parts = allocate(Money.fromMajor("0.10"), [1n, 1n, 1n]);
    expect(parts.map((p) => p.toString())).toEqual(["0.033334", "0.033333", "0.033333"]);
    expect(Money.sum(parts).toString()).toBe("0.100000");

    const reversed = allocate(Money.fromMajor("-0.10"), [1n, 1n, 1n]);
    expect(reversed.map((p) => p.toString())).toEqual(["-0.033334", "-0.033333", "-0.033333"]);
    expect(Money.sum(reversed).toString()).toBe("-0.100000");
  });

  it("spreads an invoice-level discount so the per-line parts sum EXACTLY to the header figure", () => {
    const totals = computeInvoiceTotals(
      [
        invoiceLine({ lineId: "L1", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("10") }),
        invoiceLine({ lineId: "L2", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("10") }),
        invoiceLine({ lineId: "L3", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("10") }),
      ],
      { type: "amount", amount: Money.fromMajor("0.01") },
    );
    expect(totals.invoiceDiscountTotal.toString()).toBe("0.010000");
    expect(totals.lines.map((l) => l.invoiceDiscount.toString())).toEqual(["0.010000", "0.000000", "0.000000"]);
    expect(Money.sum(totals.lines.map((l) => l.invoiceDiscount)).toString()).toBe("0.010000");
  });
});

describe("boundary 4 — LANDED_COST_DISTRIBUTION", () => {
  function target(itemId: string, qty: string, unitCost: string) {
    return {
      itemId,
      warehouseId: "WH1",
      sourceInvoiceId: "PI-1",
      sourceInvoiceNumber: "PI-000001",
      qty: Qty.fromMajor(qty),
      unitCost: Money.fromMajor(unitCost),
      weight: Qty.zero(),
    };
  }

  it("hands the indivisible residue to the lowest index and still sums to the entered freight exactly", () => {
    const lines = distributeLandedCost(
      [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("0.01") }],
      "BY_VALUE",
      [target("A", "1", "100"), target("B", "1", "100"), target("C", "1", "100")],
    );
    expect(lines.map((l) => l.allocatedAmount.toString())).toEqual(["0.003334", "0.003333", "0.003333"]);
    expect(Money.sum(lines.map((l) => l.allocatedAmount)).toString()).toBe("0.010000");
  });

  it("mirrors a negative landed cost (a credit note on the freight) part for part", () => {
    const debit = distributeLandedCost(
      [{ costType: "CUSTOMS", description: "جمارك", amount: Money.fromMajor("100") }],
      "BY_QUANTITY",
      [target("A", "3", "10"), target("B", "1", "10")],
    );
    const credit = distributeLandedCost(
      [{ costType: "CUSTOMS", description: "جمارك", amount: Money.fromMajor("-100") }],
      "BY_QUANTITY",
      [target("A", "3", "10"), target("B", "1", "10")],
    );
    expect(debit.map((l) => l.allocatedAmount.toString())).toEqual(["75.000000", "25.000000"]);
    expect(credit.map((l) => l.allocatedAmount.toString())).toEqual(["-75.000000", "-25.000000"]);
    expect(Money.sum(credit.map((l) => l.allocatedAmount)).toString()).toBe("-100.000000");
  });

  it("raises the unit cost by the allocated share, rounding the half micro-unit away from zero on both signs", () => {
    const up = distributeLandedCost(
      [{ costType: "OTHER", description: "أخرى", amount: Money.fromScaled(5n) }],
      "BY_QUANTITY",
      [target("A", "10", "50")],
    );
    expect(up[0]!.allocatedAmount.toString()).toBe("0.000005");
    expect(up[0]!.newUnitCost.toString()).toBe("50.000001");

    const down = distributeLandedCost(
      [{ costType: "OTHER", description: "أخرى", amount: Money.fromScaled(-5n) }],
      "BY_QUANTITY",
      [target("A", "10", "50")],
    );
    expect(down[0]!.newUnitCost.toString()).toBe("49.999999");
  });
});

describe("roundMoney itself, at the half, in both signs", () => {
  it("HALF_UP moves away from zero on a negative amount, never toward it", () => {
    expect(roundMoney(Money.fromMajor("-2.345"), 2).toString()).toBe("-2.350000");
    expect(roundMoney(Money.fromMajor("2.345"), 2).toString()).toBe("2.350000");
  });

  it("FLOOR and CEIL are the asymmetric modes, asymmetric in the documented direction", () => {
    expect(roundMoney(Money.fromMajor("-2.345"), 2, "FLOOR").toString()).toBe("-2.350000");
    expect(roundMoney(Money.fromMajor("2.345"), 2, "FLOOR").toString()).toBe("2.340000");
    expect(roundMoney(Money.fromMajor("-2.345"), 2, "CEIL").toString()).toBe("-2.340000");
    expect(roundMoney(Money.fromMajor("2.345"), 2, "CEIL").toString()).toBe("2.350000");
  });

  it("HALF_EVEN breaks the exact half toward the even neighbour in both signs", () => {
    expect(roundMoney(Money.fromMajor("-2.345"), 2, "HALF_EVEN").toString()).toBe("-2.340000");
    expect(roundMoney(Money.fromMajor("-2.355"), 2, "HALF_EVEN").toString()).toBe("-2.360000");
    expect(roundMoney(Money.fromMajor("2.345"), 2, "HALF_EVEN").toString()).toBe("2.340000");
  });
});
