import { describe, it, expect } from "vitest";
import { STOCK_SOURCE_DOC_TYPES, type StockSourceDocType } from "../inventory/movement.js";
import { STOCK_SOURCE_DOC_TYPE_LABELS_AR } from "./inventory-source-doc-labels.js";

describe("STOCK_SOURCE_DOC_TYPE_LABELS_AR", () => {
  it("has an Arabic label for every StockSourceDocType, with none missing or extra", () => {
    const labelled = Object.keys(STOCK_SOURCE_DOC_TYPE_LABELS_AR).sort();
    const declared = [...STOCK_SOURCE_DOC_TYPES].sort();
    expect(labelled).toEqual(declared);
  });

  it("every label is non-empty Arabic text", () => {
    for (const type of STOCK_SOURCE_DOC_TYPES) {
      const label = STOCK_SOURCE_DOC_TYPE_LABELS_AR[type as StockSourceDocType];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("carries the exact Arabic text for the two document reversal/void types", () => {
    expect(STOCK_SOURCE_DOC_TYPE_LABELS_AR.SALES_RETURN).toBe("مرتجع مبيعات");
    expect(STOCK_SOURCE_DOC_TYPE_LABELS_AR.PURCHASE_CANCELLATION).toBe("إلغاء استلام/فاتورة مشتريات");
  });
});
