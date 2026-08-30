import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { previewOpeningBalanceImport, type OpeningBalanceImportRowInput } from "./import-opening-balances.js";

function row(overrides: Partial<OpeningBalanceImportRowInput> = {}): OpeningBalanceImportRowInput {
  return {
    rowNumber: 1,
    itemCode: "IT-001",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("125.500000"),
    ...overrides,
  };
}

describe("previewOpeningBalanceImport", () => {
  it("accepts a well-formed row and keeps its quantity and cost exactly", () => {
    const preview = previewOpeningBalanceImport([row()]);
    expect(preview.errors).toEqual([]);
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0]?.qty.toString()).toBe("10.000000");
    expect(preview.valid[0]?.unitCost.toString()).toBe("125.500000");
  });

  it("trims the item code it stores, so a padded cell does not become a different item", () => {
    const preview = previewOpeningBalanceImport([row({ itemCode: "  IT-001  " })]);
    expect(preview.valid[0]?.itemCode).toBe("IT-001");
  });

  it("refuses a row with no item code, in Arabic", () => {
    const preview = previewOpeningBalanceImport([row({ itemCode: "   " })]);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.rowNumber).toBe(1);
    expect(preview.errors[0]?.reasons).toContain("كود الصنف مطلوب");
  });

  it("refuses the same item twice in one file, naming the code", () => {
    const preview = previewOpeningBalanceImport([row(), row({ rowNumber: 2 })]);
    expect(preview.valid).toHaveLength(1);
    expect(preview.errors[0]?.rowNumber).toBe(2);
    expect(preview.errors[0]?.reasons[0]).toContain("IT-001");
  });

  it("refuses a zero or negative quantity — an opening balance has to put stock in", () => {
    const zero = previewOpeningBalanceImport([row({ qty: Qty.zero() })]);
    expect(zero.errors[0]?.reasons).toContain("الكمية يجب أن تكون موجبة");

    const negative = previewOpeningBalanceImport([row({ qty: Qty.fromMajor("-1") })]);
    expect(negative.errors[0]?.reasons).toContain("الكمية يجب أن تكون موجبة");
  });

  it("accepts a zero cost but refuses a negative one", () => {
    expect(previewOpeningBalanceImport([row({ unitCost: Money.zero() })]).errors).toEqual([]);

    const negative = previewOpeningBalanceImport([row({ unitCost: Money.fromMajor("-0.000001") })]);
    expect(negative.errors[0]?.reasons).toContain("سعر التكلفة لا يمكن أن يكون سالبًا");
  });

  it("accepts a fractional quantity and a six-decimal cost without rounding either", () => {
    const preview = previewOpeningBalanceImport([
      row({ qty: Qty.fromMajor("0.001"), unitCost: Money.fromMajor("0.000001") }),
    ]);
    expect(preview.errors).toEqual([]);
    expect(preview.valid[0]?.qty.toString()).toBe("0.001000");
    expect(preview.valid[0]?.unitCost.toString()).toBe("0.000001");
  });

  it("collects every reason for one row rather than stopping at the first", () => {
    const preview = previewOpeningBalanceImport([
      row({ itemCode: "", qty: Qty.zero(), unitCost: Money.fromMajor("-5") }),
    ]);
    expect(preview.errors[0]?.reasons).toHaveLength(3);
  });

  it("keeps the good rows when some are bad, so a partial file is still useful", () => {
    const preview = previewOpeningBalanceImport([
      row({ rowNumber: 1, itemCode: "IT-001" }),
      row({ rowNumber: 2, itemCode: "", qty: Qty.zero() }),
      row({ rowNumber: 3, itemCode: "IT-003" }),
    ]);
    expect(preview.valid.map((v) => v.itemCode)).toEqual(["IT-001", "IT-003"]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([2]);
  });

  it("reports the row number the file used, so the operator can find the line", () => {
    const preview = previewOpeningBalanceImport([row({ rowNumber: 47, qty: Qty.zero() })]);
    expect(preview.errors[0]?.rowNumber).toBe(47);
  });

  it("returns nothing for an empty file rather than failing", () => {
    expect(previewOpeningBalanceImport([])).toEqual({ valid: [], errors: [] });
  });

  it("does not let a rejected row reserve its code against a later good one", () => {
    const preview = previewOpeningBalanceImport([
      row({ rowNumber: 1, itemCode: "IT-009", qty: Qty.zero() }),
      row({ rowNumber: 2, itemCode: "IT-009" }),
    ]);
    expect(preview.valid.map((v) => v.rowNumber)).toEqual([2]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([1]);
  });
});
