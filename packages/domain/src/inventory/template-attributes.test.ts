import { describe, it, expect } from "vitest";
import { InMemoryProductTemplates, InMemoryProductTemplateVariants } from "./test-helpers/in-memory-stores.js";
import { createProductTemplate } from "./create-product-template.js";
import {
  addAttributeValue,
  addTemplateAttribute,
  deleteAttributeValue,
  deleteTemplateAttribute,
} from "./template-attributes.js";
import {
  AttributeInUseError,
  AttributeNotFoundError,
  AttributeValueInUseError,
  DuplicateAttributeNameError,
  DuplicateAttributeValueError,
  InvalidProductTemplateError,
  ProductTemplateNotFoundError,
} from "./errors.js";

async function harness() {
  const templates = new InMemoryProductTemplates();
  const variants = new InMemoryProductTemplateVariants();
  await createProductTemplate({ id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS" }, templates);
  return { templates, variants };
}

describe("addTemplateAttribute", () => {
  it("rejects an unknown template", async () => {
    const { templates, variants } = await harness();
    await expect(
      addTemplateAttribute({ templateId: "missing", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants }),
    ).rejects.toBeInstanceOf(ProductTemplateNotFoundError);
  });

  it("rejects an empty attribute name", async () => {
    const { templates, variants } = await harness();
    await expect(
      addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "  ", values: ["أحمر"] }, { templates, variants }),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
  });

  it("rejects zero values, after trimming blanks away", async () => {
    const { templates, variants } = await harness();
    await expect(
      addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["   ", ""] }, { templates, variants }),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
  });

  it("rejects duplicate values within the same add call", async () => {
    const { templates, variants } = await harness();
    await expect(
      addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر", "أحمر"] }, { templates, variants }),
    ).rejects.toBeInstanceOf(InvalidProductTemplateError);
  });

  it("rejects a duplicate attribute name against an existing attribute", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await expect(
      addTemplateAttribute({ templateId: "t1", attributeId: "a2", nameAr: "اللون", values: ["أزرق"] }, { templates, variants }),
    ).rejects.toBeInstanceOf(DuplicateAttributeNameError);
  });

  it("carries the optional specificationCode through, defaulting to null", async () => {
    const { templates, variants } = await harness();
    const withCode = await addTemplateAttribute(
      { templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"], specificationCode: "COLOR" },
      { templates, variants },
    );
    expect(withCode.attributes[0]!.specificationCode).toBe("COLOR");

    const templates2 = new InMemoryProductTemplates();
    await createProductTemplate({ id: "t2", code: "T2", nameAr: "ت2", baseUnitCode: "PCS" }, templates2);
    const withoutCode = await addTemplateAttribute(
      { templateId: "t2", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] },
      { templates: templates2, variants },
    );
    expect(withoutCode.attributes[0]!.specificationCode).toBeNull();
  });
});

describe("addAttributeValue", () => {
  it("rejects an unknown template or an unknown attribute", async () => {
    const { templates, variants } = await harness();
    await expect(addAttributeValue({ templateId: "missing", attributeId: "a1", value: "x" }, { templates, variants })).rejects.toBeInstanceOf(
      ProductTemplateNotFoundError,
    );
    await expect(addAttributeValue({ templateId: "t1", attributeId: "missing", value: "x" }, { templates, variants })).rejects.toBeInstanceOf(
      AttributeNotFoundError,
    );
  });

  it("rejects a blank value", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await expect(addAttributeValue({ templateId: "t1", attributeId: "a1", value: "   " }, { templates, variants })).rejects.toBeInstanceOf(
      InvalidProductTemplateError,
    );
  });

  it("rejects a value that already exists on the attribute", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await expect(addAttributeValue({ templateId: "t1", attributeId: "a1", value: "أحمر" }, { templates, variants })).rejects.toBeInstanceOf(
      DuplicateAttributeValueError,
    );
  });

  it("appends the trimmed value to the end of the attribute's value list, leaving other attributes untouched", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await addTemplateAttribute({ templateId: "t1", attributeId: "a2", nameAr: "المقاس", values: ["S"] }, { templates, variants });
    const updated = await addAttributeValue({ templateId: "t1", attributeId: "a1", value: "  أزرق  " }, { templates, variants });
    expect(updated.attributes.find((a) => a.id === "a1")!.values).toEqual(["أحمر", "أزرق"]);
    expect(updated.attributes.find((a) => a.id === "a2")!.values).toEqual(["S"]);
  });
});

describe("deleteTemplateAttribute", () => {
  it("rejects an unknown template or an unknown attribute", async () => {
    const { templates, variants } = await harness();
    await expect(deleteTemplateAttribute({ templateId: "missing", attributeId: "a1" }, { templates, variants })).rejects.toBeInstanceOf(
      ProductTemplateNotFoundError,
    );
    await expect(deleteTemplateAttribute({ templateId: "t1", attributeId: "missing" }, { templates, variants })).rejects.toBeInstanceOf(
      AttributeNotFoundError,
    );
  });

  it("deletes an attribute with no generated variants, leaving other attributes in place", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await addTemplateAttribute({ templateId: "t1", attributeId: "a2", nameAr: "المقاس", values: ["S"] }, { templates, variants });
    const updated = await deleteTemplateAttribute({ templateId: "t1", attributeId: "a1" }, { templates, variants });
    expect(updated.attributes.map((a) => a.id)).toEqual(["a2"]);
  });

  it("recomputes 'in use' from the actual generated variants, not a caller-supplied count", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر", "أزرق"] }, { templates, variants });
    await variants.create({ id: "v1", templateId: "t1", itemId: "item-1", itemCode: "TSHIRT-RED", values: { a1: "أحمر" }, createdAt: "2026-01-01T00:00:00.000Z" });
    await variants.create({ id: "v2", templateId: "t1", itemId: "item-2", itemCode: "TSHIRT-BLUE", values: { a1: "أزرق" }, createdAt: "2026-01-01T00:00:00.000Z" });

    let caught: AttributeInUseError | undefined;
    await deleteTemplateAttribute({ templateId: "t1", attributeId: "a1" }, { templates, variants }).catch((err) => {
      caught = err as AttributeInUseError;
    });
    expect(caught).toBeInstanceOf(AttributeInUseError);
    expect(caught!.variantCount).toBe(2); // recomputed from the 2 real variant rows, not asserted by the caller
  });

  it("a variant belonging to a DIFFERENT template does not block deletion", async () => {
    const { templates, variants } = await harness();
    await createProductTemplate({ id: "t2", code: "PANTS", nameAr: "بنطلون", baseUnitCode: "PCS" }, templates);
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await addTemplateAttribute({ templateId: "t2", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await variants.create({ id: "v1", templateId: "t2", itemId: "item-1", itemCode: "PANTS-RED", values: { a1: "أحمر" }, createdAt: "2026-01-01T00:00:00.000Z" });

    const updated = await deleteTemplateAttribute({ templateId: "t1", attributeId: "a1" }, { templates, variants });
    expect(updated.attributes).toEqual([]);
  });
});

describe("deleteAttributeValue", () => {
  it("rejects an unknown template or an unknown attribute", async () => {
    const { templates, variants } = await harness();
    await expect(deleteAttributeValue({ templateId: "missing", attributeId: "a1", value: "أحمر" }, { templates, variants })).rejects.toBeInstanceOf(
      ProductTemplateNotFoundError,
    );
    await expect(deleteAttributeValue({ templateId: "t1", attributeId: "missing", value: "أحمر" }, { templates, variants })).rejects.toBeInstanceOf(
      AttributeNotFoundError,
    );
  });

  it("blocks deleting a value a generated variant references, with the recomputed count", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر", "أزرق"] }, { templates, variants });
    await variants.create({ id: "v1", templateId: "t1", itemId: "item-1", itemCode: "TSHIRT-RED", values: { a1: "أحمر" }, createdAt: "2026-01-01T00:00:00.000Z" });

    let caught: AttributeValueInUseError | undefined;
    await deleteAttributeValue({ templateId: "t1", attributeId: "a1", value: "أحمر" }, { templates, variants }).catch((err) => {
      caught = err as AttributeValueInUseError;
    });
    expect(caught).toBeInstanceOf(AttributeValueInUseError);
    expect(caught!.variantCount).toBe(1);
  });

  it("allows deleting an unused value while another value of the same attribute is in use", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر", "أزرق"] }, { templates, variants });
    await variants.create({ id: "v1", templateId: "t1", itemId: "item-1", itemCode: "TSHIRT-RED", values: { a1: "أحمر" }, createdAt: "2026-01-01T00:00:00.000Z" });

    const updated = await deleteAttributeValue({ templateId: "t1", attributeId: "a1", value: "أزرق" }, { templates, variants });
    expect(updated.attributes[0]!.values).toEqual(["أحمر"]);
  });

  it("deleting a value that isn't in the attribute's list is a silent no-op, not an error", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    const updated = await deleteAttributeValue({ templateId: "t1", attributeId: "a1", value: "أخضر" }, { templates, variants });
    expect(updated.attributes[0]!.values).toEqual(["أحمر"]);
  });
});
