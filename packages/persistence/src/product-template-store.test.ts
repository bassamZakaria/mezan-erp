import { describe, it, expect, afterEach } from "vitest";
import { Money, type ProductTemplate, type ProductTemplateVariant } from "@mezan/domain";
import { createSqliteProductTemplateStore } from "./product-template-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function template(overrides: Partial<ProductTemplate> = {}): ProductTemplate {
  return {
    id: "t1",
    code: "TSHIRT",
    nameAr: "تيشيرت",
    nameEn: null,
    baseUnitCode: "PCS",
    categoryId: null,
    brand: null,
    costingMethod: "WAC",
    defaultSalePrice: Money.fromMajor("150.00"),
    defaultCost: Money.fromMajor("80.00"),
    taxRatePercent: 14,
    attributes: [
      { id: "color", nameAr: "اللون", nameEn: null, values: ["أحمر", "أزرق"] },
      { id: "size", nameAr: "المقاس", nameEn: null, values: ["S", "M"] },
    ],
    status: "active",
    ...overrides,
  };
}

function variant(overrides: Partial<ProductTemplateVariant> = {}): ProductTemplateVariant {
  return {
    id: "v1",
    templateId: "t1",
    itemId: "item-1",
    itemCode: "TSHIRT-أحمر-S",
    values: { color: "أحمر", size: "S" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteProductTemplateRepository", () => {
  it("creates and retrieves a template by id and by code, round-tripping attributes and Money exactly", async () => {
    const store = createSqliteProductTemplateStore();
    handles.push(store);
    await store.templates.create(template());

    const byId = await store.templates.findById("t1");
    expect(byId?.attributes).toHaveLength(2);
    expect(byId?.attributes[0]).toEqual({
      id: "color",
      nameAr: "اللون",
      nameEn: null,
      specificationCode: null,
      values: ["أحمر", "أزرق"],
    });
    expect(byId?.defaultSalePrice?.toString()).toBe("150.000000");
    expect(byId?.defaultCost?.toString()).toBe("80.000000");

    const byCode = await store.templates.findByCode("TSHIRT");
    expect(byCode?.id).toBe("t1");
    expect(await store.templates.findByCode("NOPE")).toBeNull();
  });

  it("round-trips null default price/cost", async () => {
    const store = createSqliteProductTemplateStore();
    handles.push(store);
    await store.templates.create(template({ defaultSalePrice: null, defaultCost: null }));
    const reloaded = await store.templates.findById("t1");
    expect(reloaded?.defaultSalePrice).toBeNull();
    expect(reloaded?.defaultCost).toBeNull();
  });

  it("update() persists a full replace (e.g. adding an attribute)", async () => {
    const store = createSqliteProductTemplateStore();
    handles.push(store);
    await store.templates.create(template({ attributes: [] }));
    await store.templates.update(template());
    const reloaded = await store.templates.findById("t1");
    expect(reloaded?.attributes).toHaveLength(2);
  });

  it("list() returns every persisted template", async () => {
    const store = createSqliteProductTemplateStore();
    handles.push(store);
    await store.templates.create(template());
    await store.templates.create(template({ id: "t2", code: "PANTS" }));
    const all = await store.templates.list();
    expect(all.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });
});

describe("SqliteProductTemplateVariantRepository", () => {
  it("creates and lists variants scoped to a template, round-tripping the values map", async () => {
    const store = createSqliteProductTemplateStore();
    handles.push(store);
    await store.variants.create(variant());
    await store.variants.create(variant({ id: "v2", itemId: "item-2", itemCode: "TSHIRT-أزرق-M", values: { color: "أزرق", size: "M" } }));
    await store.variants.create(variant({ id: "v3", templateId: "t2", itemId: "item-3", itemCode: "OTHER" }));

    const forT1 = await store.variants.listByTemplate("t1");
    expect(forT1.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
    expect(forT1.find((v) => v.id === "v1")?.values).toEqual({ color: "أحمر", size: "S" });

    const forT2 = await store.variants.listByTemplate("t2");
    expect(forT2).toHaveLength(1);

    expect(await store.variants.listByTemplate("nope")).toEqual([]);
  });
});
