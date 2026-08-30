import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildLabelBatch, type LabelBatchLineInput } from "./label-batch.js";
import { BARCODE_FIT_ERROR_AR } from "./barcode-fit.js";

function line(overrides: Partial<LabelBatchLineInput> = {}): LabelBatchLineInput {
  return { itemId: "item-1", nameAr: "قميص", code: "ITM-001", barcode: "12345", price: Money.fromMajor("100.00"), copies: 2, ...overrides };
}

describe("buildLabelBatch", () => {
  it("resolves the named template and computes the running total across lines", () => {
    const batch = buildLabelBatch("SHELF_50x25", [line({ copies: 2 }), line({ itemId: "item-2", copies: 3 })]);
    expect(batch.template.code).toBe("SHELF_50x25");
    expect(batch.totalLabelCount).toBe(5);
    expect(batch.hasBlockingIssues).toBe(false);
  });

  it("an empty input list is a valid, unblocked batch of zero labels", () => {
    const batch = buildLabelBatch("THERMAL_40x30", []);
    expect(batch.lines).toEqual([]);
    expect(batch.totalLabelCount).toBe(0);
    expect(batch.hasBlockingIssues).toBe(false);
  });

  it("carries the barcode-fit result onto each line without mutating the barcode-fit logic", () => {
    const batch = buildLabelBatch("THERMAL_40x30", [line({ barcode: "1234567890123456789012345" })]);
    expect(batch.hasBlockingIssues).toBe(true);
    expect(batch.lines[0]!.fits).toBe(false);
    expect(batch.lines[0]!.messageAr).toBe(BARCODE_FIT_ERROR_AR);
  });

  it("truncates a fractional copies count down before summing (Math.trunc)", () => {
    const batch = buildLabelBatch("SHELF_50x25", [line({ copies: 2.9 })]);
    expect(batch.totalLabelCount).toBe(2);
  });

  it("a zero or negative copies count contributes nothing to the total but the line still appears", () => {
    const batch = buildLabelBatch("SHELF_50x25", [line({ copies: 0 }), line({ itemId: "item-2", copies: -5 })]);
    expect(batch.lines).toHaveLength(2);
    expect(batch.totalLabelCount).toBe(0);
  });

  it("preserves every input field on the output line alongside the computed fit fields", () => {
    const input = line({ price: Money.fromMajor("249.99") });
    const batch = buildLabelBatch("PRODUCT_100x50", [input]);
    expect(batch.lines[0]).toMatchObject({
      itemId: input.itemId,
      nameAr: input.nameAr,
      code: input.code,
      barcode: input.barcode,
      copies: input.copies,
    });
    expect(batch.lines[0]!.price.toString()).toBe("249.990000");
  });
});
