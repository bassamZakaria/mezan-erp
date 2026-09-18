import { describe, expect, it } from "vitest";
import { orderChartOfAccountsRows, previewChartOfAccountsImport } from "./import-chart-of-accounts.js";

/** guards P-5 — a migration that cannot bring the customer's own chart across is not a migration. */

function row(overrides: Partial<Parameters<typeof previewChartOfAccountsImport>[0][number]> = {}) {
  return {
    rowNumber: 1,
    code: "1100",
    nameAr: "الصندوق",
    type: "asset",
    ...overrides,
  };
}

describe("previewChartOfAccountsImport", () => {
  it("accepts a minimal row and derives the natural balance from the type", () => {
    const result = previewChartOfAccountsImport([row(), row({ rowNumber: 2, code: "4100", nameAr: "المبيعات", type: "revenue" })]);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.naturalBalance).toBe("debit");
    expect(result.valid[1]!.naturalBalance).toBe("credit");
  });

  it("accepts the Arabic type names an Egyptian chart is actually written in", () => {
    const result = previewChartOfAccountsImport([
      row({ type: "أصول" }),
      row({ rowNumber: 2, code: "2100", nameAr: "الموردون", type: "التزامات" }),
      row({ rowNumber: 3, code: "3100", nameAr: "رأس المال", type: "حقوق ملكية" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.valid.map((r) => r.type)).toEqual(["asset", "liability", "equity"]);
  });

  it("refuses an unknown type in Arabic, naming the accepted values", () => {
    const result = previewChartOfAccountsImport([row({ type: "بند" })]);
    expect(result.valid).toEqual([]);
    expect(result.errors[0]!.reasons[0]).toContain("نوع الحساب");
    expect(result.errors[0]!.reasons[0]).toContain("أصول");
  });

  it("refuses a code that is duplicated in the file and one already in the chart", () => {
    const duplicated = previewChartOfAccountsImport([row(), row({ rowNumber: 2 })]);
    expect(duplicated.errors[0]!.reasons[0]).toContain("مكرر داخل الملف");

    const existing = previewChartOfAccountsImport([row()], new Set(["1100"]));
    expect(existing.errors[0]!.reasons[0]).toContain("مسجل بالفعل");
  });

  it("refuses a parent that exists in neither the file nor the chart", () => {
    const result = previewChartOfAccountsImport([row({ parentCode: "1000" })]);
    expect(result.errors[0]!.reasons[0]).toContain("الحساب الأب");
  });

  it("refuses a parent that is a DETAIL account in the existing chart", () => {
    const result = previewChartOfAccountsImport([row({ parentCode: "1000" })], new Set(["1000"]), new Set());
    expect(result.errors[0]!.reasons[0]).toContain("تفصيلي");
  });

  it("marks a row referenced as a parent inside the file as a header account", () => {
    const result = previewChartOfAccountsImport([
      row({ rowNumber: 1, code: "1000", nameAr: "الأصول المتداولة" }),
      row({ rowNumber: 2, code: "1100", parentCode: "1000" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.isHeader).toBe(true);
    expect(result.valid[1]!.isHeader).toBe(false);
  });

  it("refuses a row that declares itself a detail account while owning children in the same file", () => {
    const result = previewChartOfAccountsImport([
      row({ rowNumber: 1, code: "1000", nameAr: "الأصول المتداولة", isHeader: "لا" }),
      row({ rowNumber: 2, code: "1100", parentCode: "1000" }),
    ]);
    expect(result.errors[0]!.reasons[0]).toContain("حساباً رئيسياً");
  });

  it("refuses an account that names itself as its own parent", () => {
    const result = previewChartOfAccountsImport([row({ parentCode: "1100" })]);
    expect(result.errors[0]!.reasons[0]).toContain("أباً لنفسه");
  });
});

describe("orderChartOfAccountsRows", () => {
  it("puts every parent before its children so one pass can resolve every parent id", () => {
    const { valid } = previewChartOfAccountsImport([
      row({ rowNumber: 1, code: "1110", nameAr: "نقدية بالخزينة", parentCode: "1100" }),
      row({ rowNumber: 2, code: "1100", nameAr: "النقدية", parentCode: "1000" }),
      row({ rowNumber: 3, code: "1000", nameAr: "الأصول المتداولة" }),
    ]);
    expect(orderChartOfAccountsRows(valid).map((r) => r.code)).toEqual(["1000", "1100", "1110"]);
  });
});
