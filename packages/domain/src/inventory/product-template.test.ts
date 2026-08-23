import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryItemRepository } from "../items/test-helpers/in-memory-item-repository.js";
import { InMemoryProductTemplates, InMemoryProductTemplateVariants } from "./test-helpers/in-memory-stores.js";
import { createProductTemplate } from "./create-product-template.js";
import {
  addAttributeValue,
  addTemplateAttribute,
  deleteAttributeValue,
  deleteTemplateAttribute,
} from "./template-attributes.js";
import { generateVariants } from "./generate-variants.js";
import {
  AttributeInUseError,
  AttributeValueInUseError,
  DuplicateAttributeNameError,
  DuplicateAttributeValueError,
  DuplicateProductTemplateCodeError,
  EmptyVariantSelectionError,
  InvalidVariantSelectionError,
  NoAttributesDefinedError,
} from "./errors.js";

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe("createProductTemplate", () => {
  it("creates a template with no attributes yet", async () => {
    const templates = new InMemoryProductTemplates();
    const template = await createProductTemplate(
      { id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS", defaultSalePrice: Money.fromMajor("100.00") },
      templates,
    );
    expect(template.attributes).toEqual([]);
    expect(template.status).toBe("active");
    expect(template.costingMethod).toBe("WAC");
  });

  it("rejects a duplicate code", async () => {
    const templates = new InMemoryProductTemplates();
    await createProductTemplate({ id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS" }, templates);
    await expect(createProductTemplate({ id: "t2", code: "TSHIRT", nameAr: "أخرى", baseUnitCode: "PCS" }, templates)).rejects.toBeInstanceOf(
      DuplicateProductTemplateCodeError,
    );
  });
});

describe("template attribute CRUD", () => {
  async function harness() {
    const templates = new InMemoryProductTemplates();
    const variants = new InMemoryProductTemplateVariants();
    await createProductTemplate({ id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS" }, templates);
    return { templates, variants };
  }

  it("adds an attribute with values", async () => {
    const { templates, variants } = await harness();
    const updated = await addTemplateAttribute(
      { templateId: "t1", attributeId: "attr-color", nameAr: "اللون", values: ["أحمر", "أزرق", " أخضر "] },
      { templates, variants },
    );
    expect(updated.attributes).toHaveLength(1);
    expect(updated.attributes[0]!.values).toEqual(["أحمر", "أزرق", "أخضر"]); // trimmed
  });

  it("rejects a duplicate attribute name", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await expect(
      addTemplateAttribute({ templateId: "t1", attributeId: "a2", nameAr: "اللون", values: ["أزرق"] }, { templates, variants }),
    ).rejects.toBeInstanceOf(DuplicateAttributeNameError);
  });

  it("adds a value to an existing attribute and rejects a duplicate value", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    const updated = await addAttributeValue({ templateId: "t1", attributeId: "a1", value: "أزرق" }, { templates, variants });
    expect(updated.attributes[0]!.values).toEqual(["أحمر", "أزرق"]);

    await expect(addAttributeValue({ templateId: "t1", attributeId: "a1", value: "أزرق" }, { templates, variants })).rejects.toBeInstanceOf(
      DuplicateAttributeValueError,
    );
  });

  it("deletes an attribute that has no generated variants", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    const updated = await deleteTemplateAttribute({ templateId: "t1", attributeId: "a1" }, { templates, variants });
    expect(updated.attributes).toEqual([]);
  });

  it("guards deleting an attribute in use by a generated variant", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر"] }, { templates, variants });
    await variants.create({ id: "v1", templateId: "t1", itemId: "item-1", itemCode: "TSHIRT-RED", values: { a1: "أحمر" }, createdAt: "2026-01-01T00:00:00.000Z" });

    await expect(deleteTemplateAttribute({ templateId: "t1", attributeId: "a1" }, { templates, variants })).rejects.toBeInstanceOf(
      AttributeInUseError,
    );
  });

  it("guards deleting an attribute value in use by a generated variant, but allows deleting an unused value", async () => {
    const { templates, variants } = await harness();
    await addTemplateAttribute({ templateId: "t1", attributeId: "a1", nameAr: "اللون", values: ["أحمر", "أزرق"] }, { templates, variants });
    await variants.create({ id: "v1", templateId: "t1", itemId: "item-1", itemCode: "TSHIRT-RED", values: { a1: "أحمر" }, createdAt: "2026-01-01T00:00:00.000Z" });

    await expect(deleteAttributeValue({ templateId: "t1", attributeId: "a1", value: "أحمر" }, { templates, variants })).rejects.toBeInstanceOf(
      AttributeValueInUseError,
    );

    const updated = await deleteAttributeValue({ templateId: "t1", attributeId: "a1", value: "أزرق" }, { templates, variants });
    expect(updated.attributes[0]!.values).toEqual(["أحمر"]);
  });
});

describe("generateVariants", () => {
  let templates: InMemoryProductTemplates;
  let variants: InMemoryProductTemplateVariants;
  let items: InMemoryItemRepository;

  beforeEach(async () => {
    templates = new InMemoryProductTemplates();
    variants = new InMemoryProductTemplateVariants();
    items = new InMemoryItemRepository();
    await createProductTemplate(
      { id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS", defaultSalePrice: Money.fromMajor("150.00"), defaultCost: Money.fromMajor("80.00") },
      templates,
    );
    await addTemplateAttribute({ templateId: "t1", attributeId: "color", nameAr: "اللون", values: ["أحمر", "أزرق"] }, { templates, variants });
    await addTemplateAttribute({ templateId: "t1", attributeId: "size", nameAr: "المقاس", values: ["S", "M"] }, { templates, variants });
  });

  it("creates one real Item per selected combination, seeded from the template's defaults", async () => {
    const result = await generateVariants(
      {
        templateId: "t1",
        selections: [
          { values: { color: "أحمر", size: "S" } },
          { values: { color: "أزرق", size: "M" } },
        ],
        idGen: ids("id"),
      },
      { templates, variants, items },
    );

    expect(result.created).toHaveLength(2);
    expect(result.skippedExisting).toBe(0);

    const allItems = await items.list();
    expect(allItems).toHaveLength(2);
    const red = allItems.find((i) => i.code === "TSHIRT-أحمر-S")!;
    expect(red.nameAr).toBe("تيشيرت - أحمر / S");
    expect(red.type).toBe("stock");
    expect(red.salePrice?.toString()).toBe("150.000000");
    expect(red.costPrice?.toString()).toBe("80.000000");

    const storedVariants = await variants.listByTemplate("t1");
    expect(storedVariants).toHaveLength(2);
    expect(storedVariants[0]!.itemId).toBe(red.id);
  });

  it("is idempotent — re-running the same selection skips already-generated combinations", async () => {
    await generateVariants({ templateId: "t1", selections: [{ values: { color: "أحمر", size: "S" } }], idGen: ids("id") }, { templates, variants, items });

    const second = await generateVariants(
      {
        templateId: "t1",
        selections: [{ values: { color: "أحمر", size: "S" } }, { values: { color: "أحمر", size: "M" } }],
        idGen: ids("id2"),
      },
      { templates, variants, items },
    );

    expect(second.created).toHaveLength(1);
    expect(second.skippedExisting).toBe(1);
    expect(await items.list()).toHaveLength(2);
  });

  it("rejects a selection with a missing attribute or an unknown value", async () => {
    await expect(
      generateVariants({ templateId: "t1", selections: [{ values: { color: "أحمر" } }], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(InvalidVariantSelectionError);

    await expect(
      generateVariants({ templateId: "t1", selections: [{ values: { color: "بنفسجي", size: "S" } }], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(InvalidVariantSelectionError);
  });

  it("rejects an empty selection", async () => {
    await expect(generateVariants({ templateId: "t1", selections: [], idGen: ids("id") }, { templates, variants, items })).rejects.toBeInstanceOf(
      EmptyVariantSelectionError,
    );
  });

  it("rejects generating variants for a template with no attributes", async () => {
    await createProductTemplate({ id: "t2", code: "PLAIN", nameAr: "بسيط", baseUnitCode: "PCS" }, templates);
    await expect(
      generateVariants({ templateId: "t2", selections: [{ values: {} }], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(NoAttributesDefinedError);
  });
});
