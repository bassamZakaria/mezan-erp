import { describe, it, expect } from "vitest";
import { createSqliteItemSpecificationStore } from "./item-specification-store.js";

function baseSpec() {
  return {
    code: "COLOR",
    nameAr: "اللون",
    nameEn: "Color",
    type: "select" as const,
    values: ["أحمر", "أزرق", "أخضر"],
    unit: null,
    filterable: true,
    status: "active" as const,
  };
}

describe("SqliteItemSpecificationRepository", () => {
  it("round-trips the values array exactly, in order", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      await store.specifications.create(baseSpec());
      const loaded = await store.specifications.findByCode("COLOR");
      expect(loaded?.values).toEqual(["أحمر", "أزرق", "أخضر"]);
    } finally {
      store.close();
    }
  });

  it("round-trips unit as null for a select type, and as a real unit for a number type", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      await store.specifications.create(baseSpec());
      expect((await store.specifications.findByCode("COLOR"))?.unit).toBeNull();

      await store.specifications.create({
        code: "WEIGHT",
        nameAr: "الوزن",
        nameEn: null,
        type: "number",
        values: [],
        unit: "kg",
        filterable: false,
        status: "active",
      });
      expect((await store.specifications.findByCode("WEIGHT"))?.unit).toBe("kg");
    } finally {
      store.close();
    }
  });

  it("round-trips an empty values array for a text/number type", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      await store.specifications.create({
        code: "NOTES",
        nameAr: "ملاحظات",
        nameEn: null,
        type: "text",
        values: [],
        unit: null,
        filterable: false,
        status: "active",
      });
      expect((await store.specifications.findByCode("NOTES"))?.values).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("round-trips filterable=false", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      await store.specifications.create({ ...baseSpec(), filterable: false });
      expect((await store.specifications.findByCode("COLOR"))?.filterable).toBe(false);
    } finally {
      store.close();
    }
  });

  it("findByCode returns null for an unregistered code", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      expect(await store.specifications.findByCode("DOES-NOT-EXIST")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("create() and update() both upsert keyed on code — no duplicate-code error, the row is overwritten", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      await store.specifications.create(baseSpec());
      await store.specifications.create({ ...baseSpec(), nameAr: "اللون معاد", values: ["أبيض"] });
      const loaded = await store.specifications.findByCode("COLOR");
      expect(loaded?.nameAr).toBe("اللون معاد");
      expect(loaded?.values).toEqual(["أبيض"]);
      expect(await store.specifications.list()).toHaveLength(1);

      await store.specifications.update({ ...baseSpec(), status: "inactive" });
      expect((await store.specifications.findByCode("COLOR"))?.status).toBe("inactive");
    } finally {
      store.close();
    }
  });

  it("delete() removes the specification, and it is gone from both findByCode and list()", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      await store.specifications.create(baseSpec());
      await store.specifications.create({ ...baseSpec(), code: "SIZE", nameAr: "المقاس" });
      await store.specifications.delete("COLOR");
      expect(await store.specifications.findByCode("COLOR")).toBeNull();
      expect((await store.specifications.list()).map((s) => s.code)).toEqual(["SIZE"]);
    } finally {
      store.close();
    }
  });

  it("list() orders by code, and an empty table is a real, correct state", async () => {
    const store = createSqliteItemSpecificationStore();
    try {
      expect(await store.specifications.list()).toEqual([]);
      await store.specifications.create({ ...baseSpec(), code: "Z_LAST" });
      await store.specifications.create({ ...baseSpec(), code: "A_FIRST" });
      const all = await store.specifications.list();
      expect(all.map((s) => s.code)).toEqual(["A_FIRST", "Z_LAST"]);
    } finally {
      store.close();
    }
  });
});
