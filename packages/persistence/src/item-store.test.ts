import { describe, it, expect } from "vitest";
import { Money, createItem } from "@mezan/domain";
import { createSqliteItemStore } from "./item-store.js";

describe("SqliteItemStore", () => {
  it("round-trips a saved item, including Money prices and JSON columns", async () => {
    const store = createSqliteItemStore();
    try {
      const item = await createItem(
        {
          id: "itm-1",
          code: "ITM-0001",
          nameAr: "طقم شاي",
          nameEn: "Tea Set",
          type: "stock",
          baseUnitCode: "PCS",
          alternateUnits: [{ code: "CTN", name: "كرتونة", factor: 24 }],
          barcodes: ["6221234567890", "6221234567891"],
          salePrice: Money.fromMajor("125.50"),
          costPrice: Money.fromMajor("80.00"),
          reorderPoint: 10,
          reorderQty: 50,
        },
        new InMemoryItemRepositoryForFixture(),
      );
      await store.create(item);
      const loaded = await store.findById("itm-1");
      expect(loaded).toEqual(item);
      expect(loaded?.salePrice?.toString()).toBe("125.500000");
      expect(loaded?.alternateUnits).toEqual([{ code: "CTN", name: "كرتونة", factor: 24 }]);
      expect(loaded?.barcodes).toEqual(["6221234567890", "6221234567891"]);
    } finally {
      store.close();
    }
  });

  it("round-trips a null salePrice/costPrice as null (not zero)", async () => {
    const store = createSqliteItemStore();
    try {
      await store.create({
        id: "itm-2",
        code: "ITM-0002",
        nameAr: "صنف بدون سعر",
        nameEn: null,
        type: "service",
        baseUnitCode: "SVC",
        alternateUnits: [],
        barcodes: [],
        categoryId: null,
        brandId: null, seasonId: null, specifications: [],
        costingMethod: "WAC",
        salePrice: null,
        costPrice: null,
        taxRatePercent: 14,
        trackInventory: false,
        trackBatches: false,
        trackExpiry: false,
        reorderPoint: null,
        reorderQty: null,
        revenueAccountId: null,
        cogsAccountId: null,
        inventoryAccountId: null,
        etaCodeType: null,
        etaItemCode: null,
        gpcCode: null,
        status: "active",
      });
      const loaded = await store.findById("itm-2");
      expect(loaded?.salePrice).toBeNull();
      expect(loaded?.costPrice).toBeNull();
    } finally {
      store.close();
    }
  });

  it("finds by code and enforces code uniqueness at the DB layer", async () => {
    const store = createSqliteItemStore();
    try {
      await store.create(minimalItem("itm-1", "ITM-0001"));
      expect((await store.findByCode("ITM-0001"))?.id).toBe("itm-1");
      expect(await store.findByCode("NOPE")).toBeNull();
      await expect(store.create(minimalItem("itm-2", "ITM-0001"))).rejects.toThrow();
    } finally {
      store.close();
    }
  });

  it("upserts on update", async () => {
    const store = createSqliteItemStore();
    try {
      const item = minimalItem("itm-1", "ITM-0001");
      await store.create(item);
      await store.update({ ...item, status: "inactive", nameAr: "اسم محدث" });
      const loaded = await store.findById("itm-1");
      expect(loaded?.status).toBe("inactive");
      expect(loaded?.nameAr).toBe("اسم محدث");
    } finally {
      store.close();
    }
  });

  it("list() returns every item", async () => {
    const store = createSqliteItemStore();
    try {
      await store.create(minimalItem("itm-1", "ITM-0001"));
      await store.create(minimalItem("itm-2", "ITM-0002"));
      const all = await store.list();
      expect(all.map((i) => i.code).sort()).toEqual(["ITM-0001", "ITM-0002"]);
    } finally {
      store.close();
    }
  });
});

// Local no-op repository just to satisfy createItem's `repo.list()` precheck in the fixture above.
class InMemoryItemRepositoryForFixture {
  async findById() {
    return null;
  }
  async findByCode() {
    return null;
  }
  async list() {
    return [];
  }
  async create() {}
  async update() {}
}

function minimalItem(id: string, code: string) {
  return {
    id,
    code,
    nameAr: "صنف",
    nameEn: null,
    type: "stock" as const,
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, specifications: [],
    costingMethod: "WAC" as const,
    salePrice: null,
    costPrice: null,
    taxRatePercent: 14,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active" as const,
  };
}
