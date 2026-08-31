import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  createConfigurableProduct,
  updateConfigurableProduct,
  deactivateConfigurableProduct,
  evaluateConfigurableProduct,
  type UpsertConfigurableProductCommand,
} from "./configurable-product.js";
import {
  InvalidManufacturingDocumentError,
  ConfigurableProductNotFoundError,
  DuplicateManufacturingDocumentError,
} from "./errors.js";
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

describe("configurable product — every validation reason fires on its own", () => {
  it("refuses a blank code", async () => {
    await expect(createConfigurableProduct({ ...base, code: " " }, deps())).rejects.toThrow(
      InvalidManufacturingDocumentError,
    );
  });

  it("refuses a blank Arabic name", async () => {
    await expect(createConfigurableProduct({ ...base, nameAr: " " }, deps())).rejects.toThrow(
      InvalidManufacturingDocumentError,
    );
  });

  it("refuses a blank output item id", async () => {
    await expect(createConfigurableProduct({ ...base, outputItemId: " " }, deps())).rejects.toThrow(
      InvalidManufacturingDocumentError,
    );
  });

  it("refuses a product with no configuration inputs at all", async () => {
    await expect(createConfigurableProduct({ ...base, inputs: [] }, deps())).rejects.toThrow(
      InvalidManufacturingDocumentError,
    );
  });

  it("refuses a product with no materials at all", async () => {
    await expect(createConfigurableProduct({ ...base, materials: [] }, deps())).rejects.toThrow(
      InvalidManufacturingDocumentError,
    );
  });

  it("refuses a material with a blank item id", async () => {
    await expect(
      createConfigurableProduct({ ...base, materials: [{ itemId: " ", qtyFormula: "width" }] }, deps()),
    ).rejects.toThrow(InvalidManufacturingDocumentError);
  });

  it("refuses to create a second product against an id already in use", async () => {
    const d = deps();
    await createConfigurableProduct(base, d);
    await expect(createConfigurableProduct(base, d)).rejects.toBeInstanceOf(DuplicateManufacturingDocumentError);
  });
});

describe("createConfigurableProduct — omitted optional fields fall back to their defaults", () => {
  it("defaults pricingMethod to manual when omitted", async () => {
    const { pricingMethod: _pricingMethod, priceFormula: _priceFormula, ...withoutPricingMethod } = base;
    const p = await createConfigurableProduct(
      { ...withoutPricingMethod, priceFormula: null },
      deps(),
    );
    expect(p.pricingMethod).toBe("manual");
  });

  it("defaults labour and overhead formulas to null when omitted", async () => {
    const { laborFormula: _labor, overheadFormula: _overhead, ...withoutCostFormulas } = base;
    const p = await createConfigurableProduct(withoutCostFormulas, deps());
    expect(p.laborFormula).toBeNull();
    expect(p.overheadFormula).toBeNull();
  });

  it("createdAt falls back to the wall clock when no `now` is supplied", async () => {
    const p = await createConfigurableProduct(base, { products: new InMemoryConfigurableProducts() });
    expect(() => new Date(p.createdAt).toISOString()).not.toThrow();
  });
});

describe("updateConfigurableProduct", () => {
  it("throws ConfigurableProductNotFoundError for an unknown id", async () => {
    await expect(updateConfigurableProduct(base, deps())).rejects.toBeInstanceOf(ConfigurableProductNotFoundError);
  });

  it("clears price/labour/overhead formulas and keeps the existing itemPolicy when the patch omits them", async () => {
    const d = deps();
    const created = await createConfigurableProduct({ ...base, itemPolicy: "per_spec" }, d);
    expect(created.itemPolicy).toBe("per_spec");
    const { priceFormula: _pf, laborFormula: _lf, overheadFormula: _of, itemPolicy: _ip, ...patch } = base;
    const updated = await updateConfigurableProduct({ ...patch, pricingMethod: "manual" }, d);
    expect(updated.priceFormula).toBeNull();
    expect(updated.laborFormula).toBeNull();
    expect(updated.overheadFormula).toBeNull();
    expect(updated.itemPolicy).toBe("per_spec");
  });
});

describe("deactivateConfigurableProduct is idempotent", () => {
  it("leaves an already-inactive product unchanged on a second call", async () => {
    const d = deps();
    await createConfigurableProduct(base, d);
    const first = await deactivateConfigurableProduct("cp-1", d);
    expect(first.status).toBe("inactive");
    const second = await deactivateConfigurableProduct("cp-1", d);
    expect(second).toEqual(first);
  });
});

describe("evaluateConfigurableProduct with no labour or overhead formula configured", () => {
  it("resolves labour and overhead cost to zero rather than throwing", async () => {
    const { laborFormula: _labor, overheadFormula: _overhead, ...withoutCostFormulas } = base;
    const p = await createConfigurableProduct(withoutCostFormulas, deps());
    const r = evaluateConfigurableProduct(p, { width: "10", height: "20" }, () => Money.fromMajor("1"));
    expect(r.laborCostPerUnit.toString()).toBe("0.000000");
    expect(r.overheadCostPerUnit.toString()).toBe("0.000000");
  });
});
