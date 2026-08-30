import { describe, it, expect } from "vitest";
import {
  barcodeSymbologySchema,
  itemBarcodeModeSchema,
  embeddedValueTypeSchema,
  embeddedBarcodeRuleSchema,
  barcodeConfigSchema,
  updateBarcodeConfigSchema,
  parseBarcodeRequestSchema,
} from "./barcode-config.js";

describe("barcodeSymbologySchema", () => {
  it("accepts each known symbology", () => {
    for (const s of ["EAN13", "EAN8", "UPC_A", "CODE128", "CODE39"]) {
      expect(barcodeSymbologySchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a symbology outside the enum", () => {
    expect(barcodeSymbologySchema.safeParse("QR").success).toBe(false);
  });
});

describe("embeddedBarcodeRuleSchema", () => {
  const rule = {
    id: "rule-1",
    nameAr: "قاعدة السعر",
    prefix: "20",
    totalLength: 13,
    itemCodeStart: 2,
    itemCodeLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueType: "PRICE" as const,
    valueDecimals: 2,
    active: true,
  };

  it("accepts a minimal valid rule and preserves every field verbatim", () => {
    const result = embeddedBarcodeRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(rule);
  });

  it("rejects a rule missing valueType", () => {
    const { valueType, ...rest } = rule;
    const result = embeddedBarcodeRuleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("valueType");
  });

  it("rejects a non-integer totalLength", () => {
    const result = embeddedBarcodeRuleSchema.safeParse({ ...rule, totalLength: 13.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum valueType", () => {
    const result = embeddedBarcodeRuleSchema.safeParse({ ...rule, valueType: "QTY" });
    expect(result.success).toBe(false);
  });
});

describe("barcodeConfigSchema", () => {
  const config = {
    defaultSymbology: "EAN13" as const,
    itemBarcodeMode: "AUTO" as const,
    autoGeneratePrefix: "20",
    embeddedRules: [],
  };

  it("accepts a minimal valid config and preserves every field verbatim", () => {
    const result = barcodeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(config);
  });

  it("accepts a null autoGeneratePrefix", () => {
    const result = barcodeConfigSchema.safeParse({ ...config, autoGeneratePrefix: null });
    expect(result.success).toBe(true);
  });

  it("rejects a config missing itemBarcodeMode", () => {
    const { itemBarcodeMode, ...rest } = config;
    const result = barcodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("itemBarcodeMode");
  });

  it("rejects an out-of-enum itemBarcodeMode", () => {
    const result = barcodeConfigSchema.safeParse({ ...config, itemBarcodeMode: "SEMI" });
    expect(result.success).toBe(false);
  });
});

describe("updateBarcodeConfigSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateBarcodeConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateBarcodeConfigSchema.safeParse({ itemBarcodeMode: "MANUAL" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ itemBarcodeMode: "MANUAL" });
  });

  it("rejects an out-of-enum defaultSymbology when supplied", () => {
    const result = updateBarcodeConfigSchema.safeParse({ defaultSymbology: "QR" });
    expect(result.success).toBe(false);
  });
});

describe("parseBarcodeRequestSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = parseBarcodeRequestSchema.safeParse({ code: "6221234567890" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ code: "6221234567890" });
  });

  it("rejects an empty code", () => {
    const result = parseBarcodeRequestSchema.safeParse({ code: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing code", () => {
    const result = parseBarcodeRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("code");
  });
});
