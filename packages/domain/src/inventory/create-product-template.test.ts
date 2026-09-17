import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryProductTemplates } from "./test-helpers/in-memory-stores.js";
import { createProductTemplate } from "./create-product-template.js";
import { DuplicateProductTemplateCodeError, InvalidProductTemplateError } from "./errors.js";

describe("createProductTemplate", () => {
  it("applies the documented defaults for every omitted field", async () => {
    const templates = new InMemoryProductTemplates();
    const template = await createProductTemplate(
      { id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS" },
      templates,
    );
    expect(template.costingMethod).toBe("WAC");
    expect(template.taxRatePercent).toBe(14);
    expect(template.status).toBe("active");
    expect(template.attributes).toEqual([]);
    expect(template.nameEn).toBeNull();
    expect(template.categoryId).toBeNull();
    expect(template.brandId).toBeNull();
    expect(template.defaultSalePrice).toBeNull();
    expect(template.defaultCost).toBeNull();
  });

  it("persists every given field, including money defaults", async () => {
    const templates = new InMemoryProductTemplates();
    const template = await createProductTemplate(
      {
        id: "t1",
        code: "TSHIRT",
        nameAr: "تيشيرت",
        nameEn: "T-Shirt",
        baseUnitCode: "PCS",
        categoryId: "cat-1",
        brandId: "brand-1",
        costingMethod: "WAC",
        defaultSalePrice: Money.fromMajor("150.00"),
        defaultCost: Money.fromMajor("80.00"),
        taxRatePercent: 5,
      },
      templates,
    );
    expect(template.costingMethod).toBe("WAC");
    expect(template.taxRatePercent).toBe(5);
    expect(template.defaultSalePrice!.toString()).toBe("150.000000");
    expect(template.defaultCost!.toString()).toBe("80.000000");
    expect(await templates.findByCode("TSHIRT")).toEqual(template);
  });

  it("rejects a duplicate code before validating the rest of the command", async () => {
    const templates = new InMemoryProductTemplates();
    await createProductTemplate({ id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS" }, templates);
    await expect(
      createProductTemplate({ id: "t2", code: "TSHIRT", nameAr: "أخرى", baseUnitCode: "PCS" }, templates),
    ).rejects.toBeInstanceOf(DuplicateProductTemplateCodeError);
    expect(await templates.findById("t2")).toBeNull();
  });

  it("rejects an empty code, name, or base unit", async () => {
    const templates = new InMemoryProductTemplates();
    await expect(
      createProductTemplate({ id: "t1", code: "  ", nameAr: "تيشيرت", baseUnitCode: "PCS" }, templates),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
    await expect(
      createProductTemplate({ id: "t1", code: "TSHIRT", nameAr: "  ", baseUnitCode: "PCS" }, templates),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
    await expect(
      createProductTemplate({ id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "  " }, templates),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
  });

  it("rejects a tax rate outside 0-100, and accepts the boundaries", async () => {
    const templates = new InMemoryProductTemplates();
    await expect(
      createProductTemplate({ id: "t1", code: "T1", nameAr: "ت1", baseUnitCode: "PCS", taxRatePercent: -1 }, templates),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
    await expect(
      createProductTemplate({ id: "t1", code: "T1", nameAr: "ت1", baseUnitCode: "PCS", taxRatePercent: 101 }, templates),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);

    const zero = await createProductTemplate({ id: "t1", code: "T0", nameAr: "ت0", baseUnitCode: "PCS", taxRatePercent: 0 }, templates);
    expect(zero.taxRatePercent).toBe(0);
    const hundred = await createProductTemplate({ id: "t2", code: "T100", nameAr: "ت100", baseUnitCode: "PCS", taxRatePercent: 100 }, templates);
    expect(hundred.taxRatePercent).toBe(100);
  });

  it("collects every violated field rule into one error", async () => {
    const templates = new InMemoryProductTemplates();
    let caught: InvalidProductTemplateError | undefined;
    await createProductTemplate({ id: "t1", code: "", nameAr: "", baseUnitCode: "", taxRatePercent: 200 }, templates).catch((err) => {
      caught = err as InvalidProductTemplateError;
    });
    expect(caught).toBeInstanceOf(InvalidProductTemplateError);
    expect(caught!.reasons).toHaveLength(4);
  });
});
