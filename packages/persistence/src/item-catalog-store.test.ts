import { describe, it, expect } from "vitest";
import { createSqliteItemCatalogStore } from "./item-catalog-store.js";

describe("SqliteItemCatalogStore — units", () => {
  it("round-trips by code and null nameEn", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.units.create({ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" });
      const loaded = await store.units.findByCode("PCS");
      expect(loaded).toEqual({ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" });
      expect(await store.units.findByCode("NOPE")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("create() is an upsert keyed on code — a second create() for the same code overwrites rather than throwing", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.units.create({ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" });
      await store.units.create({ code: "PCS", nameAr: "قطعة معدلة", nameEn: "Piece", status: "inactive" });
      const loaded = await store.units.findByCode("PCS");
      expect(loaded?.nameAr).toBe("قطعة معدلة");
      expect(loaded?.status).toBe("inactive");
      expect(await store.units.list()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("update() changes fields for an existing code", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.units.create({ code: "KG", nameAr: "كيلوجرام", nameEn: null, status: "active" });
      await store.units.update({ code: "KG", nameAr: "كيلوجرام", nameEn: "Kilogram", status: "inactive" });
      const loaded = await store.units.findByCode("KG");
      expect(loaded?.nameEn).toBe("Kilogram");
      expect(loaded?.status).toBe("inactive");
    } finally {
      store.close();
    }
  });

  it("list() orders by code", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.units.create({ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" });
      await store.units.create({ code: "CTN", nameAr: "كرتونة", nameEn: null, status: "active" });
      const all = await store.units.list();
      expect(all.map((u) => u.code)).toEqual(["CTN", "PCS"]);
    } finally {
      store.close();
    }
  });
});

describe("SqliteItemCatalogStore — categories", () => {
  it("round-trips parentId as null (root category) and as a real id (nested)", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.categories.create({ id: "cat-root", nameAr: "مشروبات", nameEn: null, parentId: null, status: "active" });
      await store.categories.create({ id: "cat-child", nameAr: "عصائر", nameEn: "Juices", parentId: "cat-root", status: "active" });
      const root = await store.categories.findById("cat-root");
      const child = await store.categories.findById("cat-child");
      expect(root?.parentId).toBeNull();
      expect(child?.parentId).toBe("cat-root");
      expect(await store.categories.findById("does-not-exist")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("update() changes name/status/parentId via upsert on id", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.categories.create({ id: "cat-1", nameAr: "أ", nameEn: null, parentId: null, status: "active" });
      await store.categories.create({ id: "cat-2", nameAr: "ب", nameEn: null, parentId: null, status: "active" });
      await store.categories.update({ id: "cat-1", nameAr: "أ محدثة", nameEn: null, parentId: "cat-2", status: "inactive" });
      const loaded = await store.categories.findById("cat-1");
      expect(loaded?.nameAr).toBe("أ محدثة");
      expect(loaded?.parentId).toBe("cat-2");
      expect(loaded?.status).toBe("inactive");
    } finally {
      store.close();
    }
  });

  it("list() orders by name_ar", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.categories.create({ id: "cat-z", nameAr: "ياسمين", nameEn: null, parentId: null, status: "active" });
      await store.categories.create({ id: "cat-a", nameAr: "أحذية", nameEn: null, parentId: null, status: "active" });
      const all = await store.categories.list();
      expect(all.map((c) => c.id)).toEqual(["cat-a", "cat-z"]);
    } finally {
      store.close();
    }
  });
});

describe("SqliteItemCatalogStore — brands", () => {
  it("round-trips by id and null nameEn", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.brands.create({ id: "brand-1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });
      const loaded = await store.brands.findById("brand-1");
      expect(loaded).toEqual({ id: "brand-1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });
      expect(await store.brands.findById("does-not-exist")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("permits two brands to share a code — item_brand.code carries no uniqueness constraint at this layer", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.brands.create({ id: "brand-1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });
      await store.brands.create({ id: "brand-2", code: "NESTLE", nameAr: "نستله ٢", nameEn: null, status: "active" });
      const all = await store.brands.list();
      expect(all.map((b) => b.id).sort()).toEqual(["brand-1", "brand-2"]);
      expect(all.every((b) => b.code === "NESTLE")).toBe(true);
    } finally {
      store.close();
    }
  });

  it("update() changes fields via upsert on id", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.brands.create({ id: "brand-1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });
      await store.brands.update({ id: "brand-1", code: "NESTLE-NEW", nameAr: "نستله جديد", nameEn: "Nestle", status: "inactive" });
      const loaded = await store.brands.findById("brand-1");
      expect(loaded?.code).toBe("NESTLE-NEW");
      expect(loaded?.nameEn).toBe("Nestle");
      expect(loaded?.status).toBe("inactive");
    } finally {
      store.close();
    }
  });

  it("delete() removes the brand, and it is gone from both findById and list()", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.brands.create({ id: "brand-1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });
      await store.brands.create({ id: "brand-2", code: "OTHER", nameAr: "أخرى", nameEn: null, status: "active" });
      await store.brands.delete("brand-1");
      expect(await store.brands.findById("brand-1")).toBeNull();
      expect((await store.brands.list()).map((b) => b.id)).toEqual(["brand-2"]);
    } finally {
      store.close();
    }
  });

  it("list() orders by name_ar", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.brands.create({ id: "brand-z", code: "Z", nameAr: "ياسمين", nameEn: null, status: "active" });
      await store.brands.create({ id: "brand-a", code: "A", nameAr: "أحذية", nameEn: null, status: "active" });
      const all = await store.brands.list();
      expect(all.map((b) => b.id)).toEqual(["brand-a", "brand-z"]);
    } finally {
      store.close();
    }
  });
});

describe("SqliteItemCatalogStore — seasons", () => {
  it("round-trips startDate/endDate, and as null for an undated season", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.seasons.create({
        id: "season-1",
        code: "SUMMER26",
        nameAr: "صيف ٢٠٢٦",
        nameEn: null,
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        status: "active",
      });
      const dated = await store.seasons.findById("season-1");
      expect(dated?.startDate).toBe("2026-06-01");
      expect(dated?.endDate).toBe("2026-08-31");

      await store.seasons.create({
        id: "season-2",
        code: "ALLYEAR",
        nameAr: "كل السنة",
        nameEn: null,
        startDate: null,
        endDate: null,
        status: "active",
      });
      const undated = await store.seasons.findById("season-2");
      expect(undated?.startDate).toBeNull();
      expect(undated?.endDate).toBeNull();
    } finally {
      store.close();
    }
  });

  it("update() changes fields via upsert on id", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.seasons.create({
        id: "season-1",
        code: "SUMMER26",
        nameAr: "صيف ٢٠٢٦",
        nameEn: null,
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        status: "active",
      });
      await store.seasons.update({
        id: "season-1",
        code: "SUMMER26",
        nameAr: "صيف ٢٠٢٦ محدث",
        nameEn: "Summer 2026",
        startDate: "2026-06-15",
        endDate: "2026-09-15",
        status: "inactive",
      });
      const loaded = await store.seasons.findById("season-1");
      expect(loaded?.nameAr).toBe("صيف ٢٠٢٦ محدث");
      expect(loaded?.startDate).toBe("2026-06-15");
      expect(loaded?.status).toBe("inactive");
    } finally {
      store.close();
    }
  });

  it("delete() removes the season", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.seasons.create({
        id: "season-1",
        code: "SUMMER26",
        nameAr: "صيف ٢٠٢٦",
        nameEn: null,
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        status: "active",
      });
      await store.seasons.delete("season-1");
      expect(await store.seasons.findById("season-1")).toBeNull();
      expect(await store.seasons.list()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("list() orders by start_date DESC, then name_ar", async () => {
    const store = createSqliteItemCatalogStore();
    try {
      await store.seasons.create({
        id: "season-summer",
        code: "SUMMER26",
        nameAr: "صيف",
        nameEn: null,
        startDate: "2026-06-01",
        endDate: null,
        status: "active",
      });
      await store.seasons.create({
        id: "season-winter",
        code: "WINTER26",
        nameAr: "شتاء",
        nameEn: null,
        startDate: "2026-12-01",
        endDate: null,
        status: "active",
      });
      const all = await store.seasons.list();
      expect(all.map((s) => s.id)).toEqual(["season-winter", "season-summer"]);
    } finally {
      store.close();
    }
  });
});
