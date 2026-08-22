import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  createConfigurableProduct,
  updateConfigurableProduct,
  deactivateConfigurableProduct,
  evaluateConfigurableProduct,
  type UpsertConfigurableProductCommand,
} from "./configurable-product.js";
import { InvalidManufacturingDocumentError, ConfigurableProductNotFoundError } from "./errors.js";
import { InMemoryConfigurableProducts } from "./test-helpers.js";

const base: UpsertConfigurableProductCommand = {
  id: "cp-1",
  code: "WINDOW",
  nameAr: "نافذة مخصصة",
  outputItemId: "FG-WINDOW",
  unit: "PCS",
  inputs: [
    { id: "width", labelAr: "العرض", min: 1, max: 100 },
    { id: "height", labelAr: "الطول", min: 1, max: 100 },
  ],
  materials: [
    { itemId: "m1", qtyFormula: "2*(width+height)/100", wastePercent: 0 },
    { itemId: "m2", qtyFormula: "width", wastePercent: 0 },
  ],
  pricingMethod: "formula",
  priceFormula: "width*height*3.5",
  laborFormula: "2*width",
  overheadFormula: "width",
};

function deps() {
  return { products: new InMemoryConfigurableProducts(), now: () => "2026-08-22T00:00:00.000Z" };
}

describe("configurable product — validation", () => {
  it("creates an active product with valid formulas", async () => {
    const p = await createConfigurableProduct(base, deps());
    expect(p.status).toBe("active");
    expect(p.pricingMethod).toBe("formula");
    expect(p.inputs).toHaveLength(2);
  });

  it("rejects an invalid material formula (parse error surfaced as a reason)", async () => {
    const bad = { ...base, materials: [{ itemId: "m1", qtyFormula: "2 *" }] };
    await expect(createConfigurableProduct(bad, deps())).rejects.toBeInstanceOf(
      InvalidManufacturingDocumentError,
    );
  });

  it("rejects a formula that reaches for a JS global", async () => {
    // "process" is not a declared input, but the formula is still syntactically
    // valid, so it passes parse-time validation and only fails at evaluation.
    const p = await createConfigurableProduct(
      { ...base, materials: [{ itemId: "m1", qtyFormula: "process" }] },
      deps(),
    );
    expect(() =>
      evaluateConfigurableProduct(p, { width: "1", height: "1" }, () => Money.fromMajor("1")),
    ).toThrow();
  });

  it("requires a price formula when pricing method is formula", async () => {
    const bad = { ...base, priceFormula: null };
    await expect(createConfigurableProduct(bad, deps())).rejects.toBeInstanceOf(
      InvalidManufacturingDocumentError,
    );
  });

  it("rejects an input id that is not a valid variable name", async () => {
    const bad = { ...base, inputs: [{ id: "2width", labelAr: "x" }], materials: base.materials };
    await expect(createConfigurableProduct(bad, deps())).rejects.toBeInstanceOf(
      InvalidManufacturingDocumentError,
    );
  });
});

describe("configurable product — evaluation", () => {
  it("resolves materials, price, labour and overhead from a spec", async () => {
    const p = await createConfigurableProduct(base, deps());
    const cost: Record<string, Money> = { m1: Money.fromMajor("50"), m2: Money.fromMajor("5") };
    const r = evaluateConfigurableProduct(p, { width: "10", height: "20" }, (id) => cost[id] ?? Money.zero());
    // m1: 2*(10+20)/100 = 0.6 → × 50 = 30 ; m2: 10 → × 5 = 50 ; material = 80.
    expect(r.materialCostPerUnit.toString()).toBe("80.000000");
    expect(r.laborCostPerUnit.toString()).toBe("20.000000"); // 2*width
    expect(r.overheadCostPerUnit.toString()).toBe("10.000000"); // width
    expect(r.unitPrice?.toString()).toBe("700.000000"); // 10*20*3.5
  });

  it("validates spec values against min/max and presence", async () => {
    const p = await createConfigurableProduct(base, deps());
    const one = () => Money.fromMajor("1");
    expect(() => evaluateConfigurableProduct(p, { width: "10" }, one)).toThrow(
      InvalidManufacturingDocumentError,
    );
    expect(() => evaluateConfigurableProduct(p, { width: "0", height: "5" }, one)).toThrow(
      InvalidManufacturingDocumentError,
    );
    expect(() => evaluateConfigurableProduct(p, { width: "1000", height: "5" }, one)).toThrow(
      InvalidManufacturingDocumentError,
    );
    expect(() => evaluateConfigurableProduct(p, { width: "abc", height: "5" }, one)).toThrow(
      InvalidManufacturingDocumentError,
    );
  });

  it("returns null unit price for manual pricing", async () => {
    const p = await createConfigurableProduct(
      { ...base, pricingMethod: "manual", priceFormula: null },
      deps(),
    );
    const r = evaluateConfigurableProduct(p, { width: "10", height: "20" }, () => Money.fromMajor("1"));
    expect(r.unitPrice).toBeNull();
  });
});

describe("configurable product — lifecycle", () => {
  it("updates and deactivates", async () => {
    const d = deps();
    await createConfigurableProduct(base, d);
    const updated = await updateConfigurableProduct({ ...base, nameAr: "نافذة ألمنيوم" }, d);
    expect(updated.nameAr).toBe("نافذة ألمنيوم");
    const off = await deactivateConfigurableProduct("cp-1", d);
    expect(off.status).toBe("inactive");
    await expect(deactivateConfigurableProduct("nope", d)).rejects.toBeInstanceOf(
      ConfigurableProductNotFoundError,
    );
  });
});
