import { describe, it, expect } from "vitest";
import { BARCODE_FIT_ERROR_AR, checkBarcodeFit } from "./barcode-fit.js";
import { LABEL_TEMPLATES, getLabelTemplate } from "./label-template.js";
import type { LabelTemplate } from "./label-template.js";

describe("checkBarcodeFit", () => {
  it("fits a short barcode with room to spare and reports the required width", () => {
    const result = checkBarcodeFit("12345", getLabelTemplate("THERMAL_40x30"));
    expect(result.fits).toBe(true);
    expect(result.requiredWidthMm).toBeCloseTo(5 * 1.5 + 6, 6); // 13.5mm
    expect(result.messageAr).toBeNull();
  });

  it("rejects a barcode one character over the fit boundary, with the exact Arabic message", () => {
    const template: LabelTemplate = { code: "THERMAL_40x30", labelAr: "x", widthMm: 40, heightMm: 30 };
    // required = len*1.5 + 6; solve for the barcode that lands exactly on 40mm.
    // len=22 -> 22*1.5+6 = 39mm (fits); len=23 -> 40.5mm (over by 0.5mm).
    const fitsExactly = checkBarcodeFit("1234567890123456789012", template); // 22 chars
    expect(fitsExactly.fits).toBe(true);
    expect(fitsExactly.requiredWidthMm).toBe(39);

    const oneOver = checkBarcodeFit("12345678901234567890123", template); // 23 chars
    expect(oneOver.fits).toBe(false);
    expect(oneOver.requiredWidthMm).toBe(40.5);
    expect(oneOver.messageAr).toBe(BARCODE_FIT_ERROR_AR);
  });

  it("fits exactly at the boundary when requiredWidthMm equals the template width", () => {
    const template: LabelTemplate = { code: "THERMAL_40x30", labelAr: "x", widthMm: 45, heightMm: 30 };
    // 26 chars -> 26*1.5+6 = 45mm exactly.
    const result = checkBarcodeFit("12345678901234567890123456", template);
    expect(result.requiredWidthMm).toBe(45);
    expect(result.fits).toBe(true);
    expect(result.messageAr).toBeNull();
  });

  it("a blank or whitespace-only barcode always fits — nothing to print", () => {
    const template = getLabelTemplate("THERMAL_40x30");
    expect(checkBarcodeFit("", template)).toEqual({ fits: true, requiredWidthMm: 0, messageAr: null, messageEn: null });
    expect(checkBarcodeFit("   ", template)).toEqual({ fits: true, requiredWidthMm: 0, messageAr: null, messageEn: null });
    expect(checkBarcodeFit("\t\n", template)).toEqual({ fits: true, requiredWidthMm: 0, messageAr: null, messageEn: null });
  });

  it("the same long barcode that fails the smallest preset fits the largest one", () => {
    const barcode = "1234567890123456789012345";
    const smallest = LABEL_TEMPLATES[0]!;
    const largest = LABEL_TEMPLATES[LABEL_TEMPLATES.length - 1]!;
    expect(checkBarcodeFit(barcode, smallest).fits).toBe(false);
    expect(checkBarcodeFit(barcode, largest).fits).toBe(true);
  });

  it("trims surrounding whitespace before measuring", () => {
    const template = getLabelTemplate("THERMAL_40x30");
    const padded = checkBarcodeFit("  12345  ", template);
    const bare = checkBarcodeFit("12345", template);
    expect(padded.requiredWidthMm).toBe(bare.requiredWidthMm);
  });
});
