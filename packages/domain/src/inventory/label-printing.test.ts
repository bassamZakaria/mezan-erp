import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { LABEL_TEMPLATES, getLabelTemplate, isLabelTemplateCode } from "./label-template.js";
import { BARCODE_FIT_ERROR_AR, checkBarcodeFit } from "./barcode-fit.js";
import { buildLabelBatch, type LabelBatchLineInput } from "./label-batch.js";

describe("LABEL_TEMPLATES", () => {
  it("ships exactly the 3 documented preset sizes", () => {
    expect(LABEL_TEMPLATES).toHaveLength(3);
    expect(LABEL_TEMPLATES.map((t) => t.code)).toEqual(["THERMAL_40x30", "SHELF_50x25", "PRODUCT_100x50"]);
    expect(getLabelTemplate("THERMAL_40x30")).toMatchObject({ widthMm: 40, heightMm: 30 });
    expect(getLabelTemplate("SHELF_50x25")).toMatchObject({ widthMm: 50, heightMm: 25 });
    expect(getLabelTemplate("PRODUCT_100x50")).toMatchObject({ widthMm: 100, heightMm: 50 });
  });

  it("isLabelTemplateCode narrows valid codes only", () => {
    expect(isLabelTemplateCode("THERMAL_40x30")).toBe(true);
    expect(isLabelTemplateCode("NOPE")).toBe(false);
  });

  it("getLabelTemplate throws on an unknown code", () => {
    // @ts-expect-error deliberately invalid at the type level to prove the runtime guard
    expect(() => getLabelTemplate("NOPE")).toThrow();
  });
});

describe("checkBarcodeFit", () => {
  it("fits a short barcode on the smallest template", () => {
    const result = checkBarcodeFit("12345", getLabelTemplate("THERMAL_40x30"));
    expect(result.fits).toBe(true);
    expect(result.messageAr).toBeNull();
  });

  it("rejects a long barcode on the smallest template with the exact Arabic message", () => {
    const result = checkBarcodeFit("1234567890123456789012345", getLabelTemplate("THERMAL_40x30"));
    expect(result.fits).toBe(false);
    expect(result.messageAr).toBe("الباركود لا يناسب هذا القالب");
    expect(result.messageAr).toBe(BARCODE_FIT_ERROR_AR);
  });

  it("the same barcode fits on a bigger template ('اختر قالباً أكبر')", () => {
    const barcode = "1234567890123456789012345";
    expect(checkBarcodeFit(barcode, getLabelTemplate("THERMAL_40x30")).fits).toBe(false);
    expect(checkBarcodeFit(barcode, getLabelTemplate("PRODUCT_100x50")).fits).toBe(true);
  });

  it("treats a blank barcode as always fitting (nothing to print)", () => {
    expect(checkBarcodeFit("", getLabelTemplate("THERMAL_40x30")).fits).toBe(true);
    expect(checkBarcodeFit("   ", getLabelTemplate("THERMAL_40x30")).fits).toBe(true);
  });
});

function line(overrides: Partial<LabelBatchLineInput> = {}): LabelBatchLineInput {
  return { itemId: "item-1", nameAr: "قميص", code: "ITM-001", barcode: "12345", price: Money.fromMajor("100.00"), copies: 2, ...overrides };
}

describe("buildLabelBatch", () => {
  it("computes per-line fit and the running total label count", () => {
    const batch = buildLabelBatch("THERMAL_40x30", [line({ copies: 2 }), line({ itemId: "item-2", copies: 3 })]);
    expect(batch.template.code).toBe("THERMAL_40x30");
    expect(batch.lines).toHaveLength(2);
    expect(batch.totalLabelCount).toBe(5);
    expect(batch.hasBlockingIssues).toBe(false);
  });

  it("flags hasBlockingIssues when any line's barcode doesn't fit, and carries the message on that line only", () => {
    const batch = buildLabelBatch("THERMAL_40x30", [
      line({ itemId: "item-ok", barcode: "123" }),
      line({ itemId: "item-too-long", barcode: "1234567890123456789012345" }),
    ]);
    expect(batch.hasBlockingIssues).toBe(true);
    const ok = batch.lines.find((l) => l.itemId === "item-ok")!;
    const bad = batch.lines.find((l) => l.itemId === "item-too-long")!;
    expect(ok.fits).toBe(true);
    expect(ok.messageAr).toBeNull();
    expect(bad.fits).toBe(false);
    expect(bad.messageAr).toBe(BARCODE_FIT_ERROR_AR);
  });

  it("ignores non-positive copies in the total but still reports the line", () => {
    const batch = buildLabelBatch("SHELF_50x25", [line({ copies: 0 }), line({ itemId: "item-2", copies: -1 })]);
    expect(batch.lines).toHaveLength(2);
    expect(batch.totalLabelCount).toBe(0);
  });
});
