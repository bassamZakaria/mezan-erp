import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Asset } from "./asset.js";
import { computeMonthlyDepreciation, depreciableBase, periodBounds, straightLineMonthlyAmount } from "./depreciation.js";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    code: "AST-000001",
    nameAr: "أصل تجريبي",
    nameEn: null,
    categoryId: "cat-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2025-01-01",
    acquisitionCost: Money.fromMajor("12000.00"),
    depreciationStartDate: "2025-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 12,
    salvageValue: Money.zero(),
    accumulatedDepreciation: Money.zero(),
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
    projectId: null,
    internalHourlyRate: null,
    ...overrides,
  };
}

describe("periodBounds", () => {
  it("returns 29 days for February in a leap year", () => {
    expect(periodBounds({ year: 2028, month: 2 })).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
      daysInPeriod: 29,
    });
  });

  it("returns 28 days for February in a non-leap year", () => {
    expect(periodBounds({ year: 2029, month: 2 })).toEqual({
      start: "2029-02-01",
      end: "2029-02-28",
      daysInPeriod: 28,
    });
  });

  it("returns 31 days for a 31-day month", () => {
    expect(periodBounds({ year: 2026, month: 1 })).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
      daysInPeriod: 31,
    });
  });
});

describe("depreciableBase / straightLineMonthlyAmount", () => {
  it("subtracts salvage from acquisition cost exactly", () => {
    const a = asset({ acquisitionCost: Money.fromMajor("10000.00"), salvageValue: Money.fromMajor("1000.00") });
    expect(depreciableBase(a).toString()).toBe("9000.000000");
  });

  it("divides the depreciable base by useful-life months (bigint floor)", () => {
    const a = asset({
      acquisitionCost: Money.fromMajor("10000.00"),
      salvageValue: Money.fromMajor("1000.00"),
      usefulLifeMonths: 9,
    });
    // 9000 / 9 = 1000 exactly
    expect(straightLineMonthlyAmount(a).toString()).toBe("1000.000000");
  });
});

describe("computeMonthlyDepreciation", () => {
  it("(a) mid-life, in service the whole period -> full month amount, factor 1", () => {
    const a = asset({
      acquisitionCost: Money.fromMajor("12000.00"),
      salvageValue: Money.zero(),
      usefulLifeMonths: 12,
      depreciationStartDate: "2025-01-01",
      accumulatedDepreciation: Money.fromMajor("2000.00"),
    });
    const result = computeMonthlyDepreciation(a, { year: 2026, month: 3 });
    expect(result.amount.toString()).toBe("1000.000000");
    expect(result.fullyDepreciatedAfter).toBe(false);
  });

  it("(b) depreciationStartDate mid-period (day 15 of a 30-day month) -> exact proration", () => {
    const a = asset({
      acquisitionCost: Money.fromMajor("12000.00"),
      salvageValue: Money.zero(),
      usefulLifeMonths: 12,
      depreciationStartDate: "2026-04-15",
      accumulatedDepreciation: Money.zero(),
    });
    const result = computeMonthlyDepreciation(a, { year: 2026, month: 4 });
    // monthly = 1000.000000 (scaled 1_000_000_000n); daysInService = 16, daysInPeriod = 30
    const expectedScaled = (1_000_000_000n * 16n) / 30n;
    expect(result.amount.scaled).toBe(expectedScaled);
    expect(result.amount.toString()).toBe("533.333333");
    expect(result.fullyDepreciatedAfter).toBe(false);
  });

  it("(c) caps at the remaining depreciable base and flips fullyDepreciatedAfter", () => {
    const a = asset({
      acquisitionCost: Money.fromMajor("12000.00"),
      salvageValue: Money.zero(),
      usefulLifeMonths: 12,
      depreciationStartDate: "2025-01-01",
      accumulatedDepreciation: Money.fromMajor("11500.00"),
    });
    const result = computeMonthlyDepreciation(a, { year: 2026, month: 3 });
    expect(result.amount.toString()).toBe("500.000000");
    expect(result.fullyDepreciatedAfter).toBe(true);
  });

  it("(d) an already fully_depreciated asset returns zero", () => {
    const a = asset({ status: "fully_depreciated" });
    const result = computeMonthlyDepreciation(a, { year: 2026, month: 3 });
    expect(result.amount.scaled).toBe(0n);
    expect(result.fullyDepreciatedAfter).toBe(true);
  });

  it("returns zero when the asset has not started depreciating yet this period", () => {
    const a = asset({ depreciationStartDate: "2026-05-01" });
    const result = computeMonthlyDepreciation(a, { year: 2026, month: 3 });
    expect(result.amount.scaled).toBe(0n);
    expect(result.fullyDepreciatedAfter).toBe(false);
  });

  it("a non-active, non-fully_depreciated status (e.g. disposed) also returns zero and false", () => {
    const a = asset({ status: "disposed" });
    const result = computeMonthlyDepreciation(a, { year: 2026, month: 3 });
    expect(result.amount.scaled).toBe(0n);
    expect(result.fullyDepreciatedAfter).toBe(false);
  });
});
