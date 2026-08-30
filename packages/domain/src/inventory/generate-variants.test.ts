import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryItemRepository } from "../items/test-helpers/in-memory-item-repository.js";
import { InMemoryProductTemplates, InMemoryProductTemplateVariants } from "./test-helpers/in-memory-stores.js";
import { createProductTemplate } from "./create-product-template.js";
import { addTemplateAttribute } from "./template-attributes.js";
import { generateVariants } from "./generate-variants.js";
import {
  EmptyVariantSelectionError,
  InvalidVariantSelectionError,
  NoAttributesDefinedError,
  ProductTemplateNotFoundError,
} from "./errors.js";

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function harness() {
  const templates = new InMemoryProductTemplates();
  const variants = new InMemoryProductTemplateVariants();
  const items = new InMemoryItemRepository();
  await createProductTemplate(
    { id: "t1", code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS", defaultSalePrice: Money.fromMajor("150.00"), defaultCost: Money.fromMajor("80.00") },
    templates,
  );
  await addTemplateAttribute({ templateId: "t1", attributeId: "color", nameAr: "اللون", values: ["أحمر", "أزرق"] }, { templates, variants });
  await addTemplateAttribute({ templateId: "t1", attributeId: "size", nameAr: "المقاس", values: ["S", "M"] }, { templates, variants });
  return { templates, variants, items };
}

describe("generateVariants — refusals", () => {
  it("rejects an unknown template id", async () => {
    const { templates, variants, items } = await harness();
    await expect(
      generateVariants({ templateId: "missing", selections: [{ values: { color: "أحمر", size: "S" } }], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(ProductTemplateNotFoundError);
  });

  it("rejects a template with no attributes before even looking at selections", async () => {
    const templates = new InMemoryProductTemplates();
    const variants = new InMemoryProductTemplateVariants();
    const items = new InMemoryItemRepository();
    await createProductTemplate({ id: "t2", code: "PLAIN", nameAr: "بسيط", baseUnitCode: "PCS" }, templates);
    await expect(
      generateVariants({ templateId: "t2", selections: [], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(NoAttributesDefinedError);
  });

  it("rejects zero selections", async () => {
    const { templates, variants, items } = await harness();
    await expect(generateVariants({ templateId: "t1", selections: [], idGen: ids("id") }, { templates, variants, items })).rejects.toBeInstanceOf(
      EmptyVariantSelectionError,
    );
  });

  it("rejects a selection missing an attribute the template defines", async () => {
    const { templates, variants, items } = await harness();
    await expect(
      generateVariants({ templateId: "t1", selections: [{ values: { color: "أحمر" } }], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(InvalidVariantSelectionError);
  });

  it("rejects a selection naming a value the attribute doesn't define", async () => {
    const { templates, variants, items } = await harness();
    await expect(
      generateVariants({ templateId: "t1", selections: [{ values: { color: "بنفسجي", size: "S" } }], idGen: ids("id") }, { templates, variants, items }),
    ).rejects.toBeInstanceOf(InvalidVariantSelectionError);
  });

  it("rejects a selection naming an attribute id the template does not have", async () => {
    const { templates, variants, items } = await harness();
    await expect(
      generateVariants(
        { templateId: "t1", selections: [{ values: { color: "أحمر", size: "S", material: "قطن" } }], idGen: ids("id") },
        { templates, variants, items },
      ),
    ).rejects.toBeInstanceOf(InvalidVariantSelectionError);
  });

  it("validates every selection before creating anything — an early valid selection does not get created if a later one is invalid", async () => {
    const { templates, variants, items } = await harness();
    await expect(
      generateVariants(
        {
          templateId: "t1",
          selections: [{ values: { color: "أحمر", size: "S" } }, { values: { color: "بنفسجي", size: "S" } }],
          idGen: ids("id"),
        },
        { templates, variants, items },
      ),
    ).rejects.toBeInstanceOf(InvalidVariantSelectionError);
    expect(await items.list()).toHaveLength(0);
  });
});

describe("generateVariants — creation", () => {
  it("builds the item code/name from the template's own attribute order, not the selection's key order", async () => {
    const { templates, variants, items } = await harness();
    const result = await generateVariants(
      { templateId: "t1", selections: [{ values: { size: "S", color: "أحمر" } }], idGen: ids("id") }, // size given before color
      { templates, variants, items },
    );
    expect(result.created).toHaveLength(1);
    const item = (await items.list())[0]!;
    expect(item.code).toBe("TSHIRT-أحمر-S"); // color then size, matching template.attributes order
    expect(item.nameAr).toBe("تيشيرت - أحمر / S");
  });

  it("uses idGen once for the item id and once for the variant record id — they are different ids", async () => {
    const { templates, variants, items } = await harness();
    const gen = ids("id");
    await generateVariants({ templateId: "t1", selections: [{ values: { color: "أحمر", size: "S" } }], idGen: gen }, { templates, variants, items });
    const item = (await items.list())[0]!;
    const variant = (await variants.listByTemplate("t1"))[0]!;
    expect(item.id).toBe("id-1");
    expect(variant.id).toBe("id-2");
    expect(variant.itemId).toBe(item.id);
  });

  it("stamps createdAt from the injected now(), defaulting to the real clock when omitted", async () => {
    const { templates, variants, items } = await harness();
    await generateVariants(
      { templateId: "t1", selections: [{ values: { color: "أحمر", size: "S" } }], idGen: ids("id"), now: () => "2026-05-01T00:00:00.000Z" },
      { templates, variants, items },
    );
    const variant = (await variants.listByTemplate("t1"))[0]!;
    expect(variant.createdAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("seeds the new item's sale price and cost from the template's defaults", async () => {
    const { templates, variants, items } = await harness();
    await generateVariants({ templateId: "t1", selections: [{ values: { color: "أحمر", size: "S" } }], idGen: ids("id") }, { templates, variants, items });
    const item = (await items.list())[0]!;
    expect(item.salePrice!.toString()).toBe("150.000000");
    expect(item.costPrice!.toString()).toBe("80.000000");
    expect(item.type).toBe("stock");
  });

  it("is idempotent per exact value combination — re-selecting an existing combo skips it without creating a duplicate item", async () => {
    const { templates, variants, items } = await harness();
    await generateVariants({ templateId: "t1", selections: [{ values: { color: "أحمر", size: "S" } }], idGen: ids("id") }, { templates, variants, items });
    const second = await generateVariants(
      { templateId: "t1", selections: [{ values: { color: "أحمر", size: "S" } }, { values: { color: "أزرق", size: "M" } }], idGen: ids("id2") },
      { templates, variants, items },
    );
    expect(second.created).toHaveLength(1);
    expect(second.skippedExisting).toBe(1);
    expect(await items.list()).toHaveLength(2);
  });
});
