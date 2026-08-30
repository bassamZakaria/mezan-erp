import { describe, expect, it } from "vitest";
import {
  BARCODE_SYMBOLOGIES,
  InvalidBarcodeConfigError,
  createDefaultBarcodeConfig,
  parseEmbeddedBarcode,
  updateBarcodeConfig,
  validateBarcodeConfig,
  type BarcodeConfig,
  type EmbeddedBarcodeRule,
} from "./barcode-config.js";

/** A scale barcode: prefix "20", then a 5-digit item code, then a 5-digit price with two decimals. */
function priceRule(overrides: Partial<EmbeddedBarcodeRule> = {}): EmbeddedBarcodeRule {
  return {
    id: "rule-price",
    nameAr: "باركود سعر الميزان",
    prefix: "20",
    totalLength: 13,
    itemCodeStart: 2,
    itemCodeLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueType: "PRICE",
    valueDecimals: 2,
    active: true,
    ...overrides,
  };
}

function config(overrides: Partial<BarcodeConfig> = {}): BarcodeConfig {
  return { ...createDefaultBarcodeConfig(), ...overrides };
}

describe("the default configuration", () => {
  it("invents nothing beyond what is universal", () => {
    expect(createDefaultBarcodeConfig()).toEqual({
      defaultSymbology: "EAN13",
      itemBarcodeMode: "MANUAL",
      autoGeneratePrefix: null,
      embeddedRules: [],
    });
  });

  it("validates clean", () => {
    expect(validateBarcodeConfig(createDefaultBarcodeConfig())).toEqual([]);
  });
});

describe("validateBarcodeConfig", () => {
  it("accepts every symbology it lists, and refuses one it does not", () => {
    for (const symbology of BARCODE_SYMBOLOGIES) {
      expect(validateBarcodeConfig(config({ defaultSymbology: symbology }))).toEqual([]);
    }
    const reasons = validateBarcodeConfig(config({ defaultSymbology: "QR" as never }));
    expect(reasons).toContain("نوع الباركود الافتراضي غير صالح");
  });

  it("refuses a non-numeric auto-generate prefix, but only in automatic mode", () => {
    expect(
      validateBarcodeConfig(config({ itemBarcodeMode: "AUTO", autoGeneratePrefix: "AB" })),
    ).toContain("بادئة الترقيم التلقائي يجب أن تتكون من أرقام فقط");

    expect(validateBarcodeConfig(config({ itemBarcodeMode: "MANUAL", autoGeneratePrefix: "AB" }))).toEqual([]);
    expect(validateBarcodeConfig(config({ itemBarcodeMode: "AUTO", autoGeneratePrefix: "200" }))).toEqual([]);
    expect(validateBarcodeConfig(config({ itemBarcodeMode: "AUTO", autoGeneratePrefix: null }))).toEqual([]);
  });

  it("accepts a well-formed embedded rule", () => {
    expect(validateBarcodeConfig(config({ embeddedRules: [priceRule()] }))).toEqual([]);
  });

  it("refuses a rule whose prefix is not digits", () => {
    const reasons = validateBarcodeConfig(config({ embeddedRules: [priceRule({ prefix: "2A" })] }));
    expect(reasons.some((r) => r.includes("البادئة"))).toBe(true);
  });

  it("refuses zero or negative lengths", () => {
    for (const patch of [{ totalLength: 0 }, { itemCodeLength: 0 }, { valueLength: 0 }] as const) {
      expect(validateBarcodeConfig(config({ embeddedRules: [priceRule(patch)] })).length).toBeGreaterThan(0);
    }
    expect(
      validateBarcodeConfig(config({ embeddedRules: [priceRule({ valueDecimals: -1 })] })).length,
    ).toBeGreaterThan(0);
  });

  it("refuses fields that overlap: the item code inside the prefix, the value inside the item code", () => {
    const insidePrefix = validateBarcodeConfig(config({ embeddedRules: [priceRule({ itemCodeStart: 1 })] }));
    expect(insidePrefix.some((r) => r.includes("بداية كود الصنف"))).toBe(true);

    const insideItemCode = validateBarcodeConfig(config({ embeddedRules: [priceRule({ valueStart: 5 })] }));
    expect(insideItemCode.some((r) => r.includes("بداية القيمة"))).toBe(true);
  });

  it("refuses a rule whose fields run past the barcode's own length", () => {
    const reasons = validateBarcodeConfig(config({ embeddedRules: [priceRule({ totalLength: 10 })] }));
    expect(reasons.some((r) => r.includes("يتجاوز الطول الكلي") || r.includes("تتجاوز الطول الكلي"))).toBe(true);
  });

  it("refuses two rules sharing an id, naming it", () => {
    const reasons = validateBarcodeConfig(config({ embeddedRules: [priceRule(), priceRule()] }));
    expect(reasons.some((r) => r.includes("rule-price") && r.includes("مكرر"))).toBe(true);
  });

  it("reports every violation at once rather than stopping at the first", () => {
    const reasons = validateBarcodeConfig(
      config({ embeddedRules: [priceRule({ prefix: "X", totalLength: 0, valueLength: 0 })] }),
    );
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("names every reason in Arabic, since the settings screen shows them verbatim", () => {
    const reasons = validateBarcodeConfig(config({ embeddedRules: [priceRule({ prefix: "X" })] }));
    for (const reason of reasons) expect(/[؀-ۿ]/.test(reason)).toBe(true);
  });
});

describe("updateBarcodeConfig", () => {
  it("merges a patch and returns the new config", () => {
    const next = updateBarcodeConfig(createDefaultBarcodeConfig(), { defaultSymbology: "CODE128" });
    expect(next.defaultSymbology).toBe("CODE128");
    expect(next.itemBarcodeMode).toBe("MANUAL");
  });

  it("throws with every reason when the result would be invalid, and changes nothing", () => {
    const current = createDefaultBarcodeConfig();
    expect(() => updateBarcodeConfig(current, { defaultSymbology: "QR" as never })).toThrow(
      InvalidBarcodeConfigError,
    );
    expect(current).toEqual(createDefaultBarcodeConfig());
  });

  it("carries the reasons on the error, so the screen can list them", () => {
    try {
      updateBarcodeConfig(createDefaultBarcodeConfig(), { embeddedRules: [priceRule({ prefix: "X" })] });
      throw new Error("expected the update to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidBarcodeConfigError);
      expect((error as InvalidBarcodeConfigError).code).toBe("INVALID_BARCODE_CONFIG");
      expect((error as InvalidBarcodeConfigError).reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("parseEmbeddedBarcode", () => {
  const rules = [priceRule()];

  it("reads the item code and the price out of a scale barcode", () => {
    // 20 | 12345 | 01250 | 6  →  item 12345 at 12.50
    expect(parseEmbeddedBarcode(rules, "2012345012506")).toEqual({
      matched: true,
      ruleId: "rule-price",
      itemCode: "12345",
      value: 12.5,
      valueType: "PRICE",
    });
  });

  it("applies the rule's decimal places", () => {
    const threeDecimals = [priceRule({ valueDecimals: 3, valueType: "WEIGHT" })];
    expect(parseEmbeddedBarcode(threeDecimals, "2012345012506")).toMatchObject({
      value: 1.25,
      valueType: "WEIGHT",
    });

    const noDecimals = [priceRule({ valueDecimals: 0 })];
    expect(parseEmbeddedBarcode(noDecimals, "2012345012506")).toMatchObject({ value: 1250 });
  });

  it("ignores a code of the wrong length", () => {
    expect(parseEmbeddedBarcode(rules, "201234501250")).toEqual({ matched: false });
    expect(parseEmbeddedBarcode(rules, "20123450125067")).toEqual({ matched: false });
  });

  it("ignores a code with the wrong prefix", () => {
    expect(parseEmbeddedBarcode(rules, "2112345012506")).toEqual({ matched: false });
  });

  it("ignores a rule that is switched off", () => {
    expect(parseEmbeddedBarcode([priceRule({ active: false })], "2012345012506")).toEqual({ matched: false });
  });

  it("never throws on whatever a scanner sends", () => {
    for (const scanned of ["", "ABC", "20-12345-01250", "٢٠١٢٣٤٥٠١٢٥٠٦", " 2012345012506 "]) {
      expect(parseEmbeddedBarcode(rules, scanned)).toEqual({ matched: false });
    }
  });

  it("takes the first matching rule, in the order they are configured", () => {
    const first = priceRule({ id: "first" });
    const second = priceRule({ id: "second", valueType: "WEIGHT" });
    expect(parseEmbeddedBarcode([first, second], "2012345012506")).toMatchObject({ ruleId: "first" });
    expect(parseEmbeddedBarcode([second, first], "2012345012506")).toMatchObject({ ruleId: "second" });
  });

  it("skips an inactive rule and matches a later active one", () => {
    const off = priceRule({ id: "off", active: false });
    const on = priceRule({ id: "on" });
    expect(parseEmbeddedBarcode([off, on], "2012345012506")).toMatchObject({ ruleId: "on" });
  });

  it("matches nothing when no rules are configured", () => {
    expect(parseEmbeddedBarcode([], "2012345012506")).toEqual({ matched: false });
  });

  it("reads a zero value as zero rather than as no match", () => {
    expect(parseEmbeddedBarcode(rules, "2012345000006")).toMatchObject({ matched: true, value: 0 });
  });
});
