import { describe, it, expect } from "vitest";
import { LABEL_TEMPLATES, getLabelTemplate, isLabelTemplateCode } from "./label-template.js";

describe("LABEL_TEMPLATES", () => {
  it("ships exactly the 3 documented preset sizes, each with the right geometry", () => {
    expect(LABEL_TEMPLATES).toHaveLength(3);
    expect(LABEL_TEMPLATES.map((t) => t.code)).toEqual(["THERMAL_40x30", "SHELF_50x25", "PRODUCT_100x50"]);
    expect(LABEL_TEMPLATES.find((t) => t.code === "THERMAL_40x30")).toMatchObject({ widthMm: 40, heightMm: 30 });
    expect(LABEL_TEMPLATES.find((t) => t.code === "SHELF_50x25")).toMatchObject({ widthMm: 50, heightMm: 25 });
    expect(LABEL_TEMPLATES.find((t) => t.code === "PRODUCT_100x50")).toMatchObject({ widthMm: 100, heightMm: 50 });
  });

  it("every preset carries a non-empty Arabic label", () => {
    for (const template of LABEL_TEMPLATES) {
      expect(template.labelAr.length).toBeGreaterThan(0);
    }
  });
});

describe("isLabelTemplateCode", () => {
  it("recognizes every shipped code", () => {
    for (const template of LABEL_TEMPLATES) {
      expect(isLabelTemplateCode(template.code)).toBe(true);
    }
  });

  it("rejects an unknown or empty code", () => {
    expect(isLabelTemplateCode("NOPE")).toBe(false);
    expect(isLabelTemplateCode("")).toBe(false);
    expect(isLabelTemplateCode("thermal_40x30")).toBe(false); // case-sensitive
  });
});

describe("getLabelTemplate", () => {
  it("returns the exact preset for each documented code", () => {
    expect(getLabelTemplate("THERMAL_40x30").widthMm).toBe(40);
    expect(getLabelTemplate("SHELF_50x25").widthMm).toBe(50);
    expect(getLabelTemplate("PRODUCT_100x50").widthMm).toBe(100);
  });

  it("throws a RangeError naming the unknown code", () => {
    // @ts-expect-error deliberately invalid at the type level to exercise the runtime guard
    expect(() => getLabelTemplate("NOPE")).toThrow(RangeError);
    // @ts-expect-error same as above
    expect(() => getLabelTemplate("NOPE")).toThrow('Unknown label template code: "NOPE"');
  });
});
