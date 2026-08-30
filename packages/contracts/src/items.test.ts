import { describe, it, expect } from "vitest";
import {
  itemTypeSchema,
  costingMethodSchema,
  itemStatusSchema,
  etaCodeTypeSchema,
  alternateUnitSchema,
  itemSchema,
  createItemSchema,
  updateItemSchema,
  itemCatalogStatusSchema,
  upsertItemBrandSchema,
  upsertItemSeasonSchema,
  itemBrandSchema,
  itemSeasonSchema,
} from "./items.js";

describe("itemTypeSchema", () => {
  it("accepts each of the six known item types", () => {
    for (const t of ["stock", "service", "raw_material", "finished_good", "consumable", "recipe"]) {
      expect(itemTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(itemTypeSchema.safeParse("bundle").success).toBe(false);
  });
});

describe("costingMethodSchema", () => {
  it("accepts WAC and FIFO", () => {
    expect(costingMethodSchema.safeParse("WAC").success).toBe(true);
    expect(costingMethodSchema.safeParse("FIFO").success).toBe(true);
  });

  it("rejects a method outside the enum", () => {
    expect(costingMethodSchema.safeParse("LIFO").success).toBe(false);
  });
});

describe("itemStatusSchema", () => {
  it("accepts active and inactive", () => {
    expect(itemStatusSchema.safeParse("active").success).toBe(true);
    expect(itemStatusSchema.safeParse("inactive").success).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    expect(itemStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("etaCodeTypeSchema", () => {
  it("accepts EGS and GPC", () => {
    expect(etaCodeTypeSchema.safeParse("EGS").success).toBe(true);
    expect(etaCodeTypeSchema.safeParse("GPC").success).toBe(true);
  });

  it("rejects a code type outside the enum", () => {
    expect(etaCodeTypeSchema.safeParse("SKU").success).toBe(false);
  });
});

describe("itemCatalogStatusSchema", () => {
  it("accepts active and inactive", () => {
    expect(itemCatalogStatusSchema.safeParse("active").success).toBe(true);
    expect(itemCatalogStatusSchema.safeParse("inactive").success).toBe(true);
  });
});

describe("alternateUnitSchema", () => {
  it("accepts a minimal valid unit and preserves every field verbatim", () => {
    const unit = { code: "BOX", name: "كرتونة", factor: 12 };
    const result = alternateUnitSchema.safeParse(unit);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(unit);
  });

  it("rejects a zero or negative factor — factor is a plain ratio, not a ledger amount, but must still be positive", () => {
    expect(alternateUnitSchema.safeParse({ code: "BOX", name: "كرتونة", factor: 0 }).success).toBe(false);
    expect(alternateUnitSchema.safeParse({ code: "BOX", name: "كرتونة", factor: -1 }).success).toBe(false);
  });
});

describe("itemSchema", () => {
  const item = {
    id: "item-1",
    code: "ITM-1",
    nameAr: "قميص قطن",
    nameEn: null,
    type: "stock" as const,
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: ["6221234567890"],
    categoryId: null,
    brandId: null,
    seasonId: null,
    description: null,
    defaultSupplierId: null,
    specifications: [],
    costingMethod: "WAC" as const,
    salePrice: "199.990000",
    costPrice: "99.990000",
    taxRatePercent: 14,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active" as const,
  };

  it("accepts a minimal valid item and preserves every field verbatim", () => {
    const result = itemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(item);
  });

  it("accepts onHand and stockState when present on a list row", () => {
    const result = itemSchema.safeParse({ ...item, onHand: "50.000000", stockState: "low" as const });
    expect(result.success).toBe(true);
  });

  it("accepts a null onHand for a service item that holds no stock", () => {
    const result = itemSchema.safeParse({ ...item, onHand: null, stockState: null });
    expect(result.success).toBe(true);
  });

  it("never coerces salePrice to a float — high-precision decimal string survives verbatim", () => {
    const result = itemSchema.safeParse({ ...item, salePrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.salePrice).toBe("0.100001");
  });

  it("rejects salePrice sent as a JS number instead of a string", () => {
    const result = itemSchema.safeParse({ ...item, salePrice: 199.99 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum costingMethod", () => {
    const result = itemSchema.safeParse({ ...item, costingMethod: "LIFO" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum etaCodeType", () => {
    const result = itemSchema.safeParse({ ...item, etaCodeType: "SKU" });
    expect(result.success).toBe(false);
  });

  it("rejects an item missing baseUnitCode", () => {
    const { baseUnitCode, ...rest } = item;
    const result = itemSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("baseUnitCode");
  });
});

describe("createItemSchema", () => {
  const create = { id: "item-1", code: "ITM-1", nameAr: "قميص قطن", type: "stock" as const, baseUnitCode: "PCS" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createItemSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing type", () => {
    const { type, ...rest } = create;
    const result = createItemSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("silently strips onHand and stockState — these are server-derived, never caller-supplied", () => {
    const result = createItemSchema.safeParse({ ...create, onHand: "999", stockState: "ok" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("onHand");
      expect(result.data).not.toHaveProperty("stockState");
    }
  });

  it("never coerces costPrice to a float when supplied", () => {
    const result = createItemSchema.safeParse({ ...create, costPrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.costPrice).toBe("0.100001");
  });
});

describe("updateItemSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateItemSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("strips id and code — both are immutable, omitted from the update schema", () => {
    const result = updateItemSchema.safeParse({ id: "item-2", code: "NEW-CODE", nameAr: "قميص" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("id");
      expect(result.data).not.toHaveProperty("code");
    }
  });

  it("rejects an out-of-enum status when supplied", () => {
    const result = updateItemSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("upsertItemBrandSchema", () => {
  const brand = { id: "brand-1", code: "NIKE", nameAr: "نايك" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = upsertItemBrandSchema.safeParse(brand);
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status when supplied", () => {
    const result = upsertItemBrandSchema.safeParse({ ...brand, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("upsertItemSeasonSchema", () => {
  const season = { id: "season-1", code: "SUMMER26", nameAr: "صيف 2026" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = upsertItemSeasonSchema.safeParse(season);
    expect(result.success).toBe(true);
  });

  it("accepts an explicit startDate/endDate range", () => {
    const result = upsertItemSeasonSchema.safeParse({ ...season, startDate: "2026-06-01", endDate: "2026-08-31" });
    expect(result.success).toBe(true);
  });
});

describe("itemBrandSchema", () => {
  const brand = { id: "brand-1", code: "NIKE", nameAr: "نايك", nameEn: null, status: "active" as const };

  it("accepts a minimal valid brand and preserves every field verbatim", () => {
    const result = itemBrandSchema.safeParse(brand);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(brand);
  });

  it("rejects an out-of-enum status", () => {
    const result = itemBrandSchema.safeParse({ ...brand, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("itemSeasonSchema", () => {
  const season = { id: "season-1", code: "SUMMER26", nameAr: "صيف 2026", nameEn: null, startDate: "2026-06-01", endDate: "2026-08-31", status: "active" as const };

  it("accepts a minimal valid season and preserves every field verbatim", () => {
    const result = itemSeasonSchema.safeParse(season);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(season);
  });
});
