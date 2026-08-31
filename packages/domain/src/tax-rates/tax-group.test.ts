import { describe, expect, it } from "vitest";
import { InvalidTaxGroupError } from "./errors.js";
import {
  collectTaxGroupErrors,
  taxGroupBreakdown,
  validateTaxGroup,
  type TaxGroup,
  type TaxGroupRateView,
} from "./tax-group.js";

function group(overrides: Partial<TaxGroup> = {}): TaxGroup {
  return {
    id: "tg-1",
    code: "VAT-TABLE",
    nameAr: "قيمة مضافة + ضريبة جدول",
    nameEn: null,
    members: [{ taxRateId: "vat-14", compounding: false }],
    status: "active",
    ...overrides,
  };
}

const rates: Record<string, TaxGroupRateView> = {
  "vat-14": { id: "vat-14", ratePercent: 14 },
  "table-5": { id: "table-5", ratePercent: 5 },
  "levy-10": { id: "levy-10", ratePercent: 10 },
};
const rateById = (id: string) => rates[id] ?? null;

describe("collectTaxGroupErrors", () => {
  it("accepts a group with a code, a name and at least one member", () => {
    expect(collectTaxGroupErrors(group())).toEqual([]);
  });

  it("refuses a group with no code and one with only whitespace for a code", () => {
    expect(collectTaxGroupErrors(group({ code: "" }))).toContain("كود المجموعة مطلوب");
    expect(collectTaxGroupErrors(group({ code: "   " }))).toContain("كود المجموعة مطلوب");
  });

  it("refuses a group with no Arabic name", () => {
    expect(collectTaxGroupErrors(group({ nameAr: "  " }))).toContain("اسم المجموعة مطلوب");
  });

  it("refuses an empty group, which would charge no tax at all", () => {
    expect(collectTaxGroupErrors(group({ members: [] }))).toContain(
      "المجموعة يجب أن تحتوي على ضريبة واحدة على الأقل",
    );
  });

  it("refuses a member with no rate id", () => {
    expect(collectTaxGroupErrors(group({ members: [{ taxRateId: "  ", compounding: false }] }))).toContain(
      "معرف الضريبة مطلوب",
    );
  });

  it("refuses the same rate twice, which would double-charge it invisibly", () => {
    const reasons = collectTaxGroupErrors(
      group({
        members: [
          { taxRateId: "vat-14", compounding: false },
          { taxRateId: "vat-14", compounding: true },
        ],
      }),
    );
    expect(reasons).toContain("الضريبة vat-14 مكررة داخل المجموعة");
  });

  it("collects every reason at once rather than stopping at the first", () => {
    expect(collectTaxGroupErrors(group({ code: "", nameAr: "", members: [] }))).toHaveLength(3);
  });
});

describe("validateTaxGroup", () => {
  it("passes a valid group silently", () => {
    expect(() => validateTaxGroup(group())).not.toThrow();
  });

  it("throws InvalidTaxGroupError carrying every reason", () => {
    try {
      validateTaxGroup(group({ code: "", members: [] }));
      throw new Error("expected InvalidTaxGroupError");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTaxGroupError);
      expect((err as InvalidTaxGroupError).reasons).toHaveLength(2);
    }
  });
});

describe("taxGroupBreakdown", () => {
  it("charges a single non-compounding member on the base alone", () => {
    const breakdown = taxGroupBreakdown(group(), rateById);
    expect(breakdown.effectivePercent).toBe(14);
    expect(breakdown.components).toEqual([
      { taxRateId: "vat-14", ratePercent: 14, compounding: false, effectivePercent: 14 },
    ]);
  });

  it("charges two non-compounding members on the same base", () => {
    const breakdown = taxGroupBreakdown(
      group({
        members: [
          { taxRateId: "vat-14", compounding: false },
          { taxRateId: "table-5", compounding: false },
        ],
      }),
      rateById,
    );
    expect(breakdown.components.map((c) => c.effectivePercent)).toEqual([14, 5]);
    expect(breakdown.effectivePercent).toBe(19);
  });

  it("charges a compounding member on the running total, not the base", () => {
    const breakdown = taxGroupBreakdown(
      group({
        members: [
          { taxRateId: "vat-14", compounding: false },
          { taxRateId: "table-5", compounding: true },
        ],
      }),
      rateById,
    );
    // 5% of (100 + 14) = 5.7 of the ORIGINAL base, not 5.
    expect(breakdown.components[1]?.effectivePercent).toBeCloseTo(5.7, 10);
    expect(breakdown.effectivePercent).toBeCloseTo(19.7, 10);
  });

  it("compounds in the order the members are listed", () => {
    const vatFirst = taxGroupBreakdown(
      group({
        members: [
          { taxRateId: "vat-14", compounding: false },
          { taxRateId: "levy-10", compounding: true },
        ],
      }),
      rateById,
    );
    const levyFirst = taxGroupBreakdown(
      group({
        members: [
          { taxRateId: "levy-10", compounding: false },
          { taxRateId: "vat-14", compounding: true },
        ],
      }),
      rateById,
    );
    expect(vatFirst.effectivePercent).toBeCloseTo(25.4, 10);
    expect(levyFirst.effectivePercent).toBeCloseTo(25.4, 10);
    // Same total, different split — which is exactly why the parts are kept.
    expect(vatFirst.components[0]?.effectivePercent).toBe(14);
    expect(levyFirst.components[0]?.effectivePercent).toBe(10);
  });

  it("skips a member whose rate the chart no longer holds rather than charging zero", () => {
    const breakdown = taxGroupBreakdown(
      group({
        members: [
          { taxRateId: "vat-14", compounding: false },
          { taxRateId: "deleted-rate", compounding: false },
        ],
      }),
      rateById,
    );
    expect(breakdown.components).toHaveLength(1);
    expect(breakdown.effectivePercent).toBe(14);
  });

  it("returns nothing for a group whose members have all gone", () => {
    const breakdown = taxGroupBreakdown(group({ members: [{ taxRateId: "gone", compounding: true }] }), rateById);
    expect(breakdown).toEqual({ components: [], effectivePercent: 0 });
  });

  it("reports a zero-rated member as costing nothing without dropping it", () => {
    const breakdown = taxGroupBreakdown(group({ members: [{ taxRateId: "zero", compounding: false }] }), (id) =>
      id === "zero" ? { id, ratePercent: 0 } : null,
    );
    expect(breakdown.components).toHaveLength(1);
    expect(breakdown.effectivePercent).toBe(0);
  });
});
