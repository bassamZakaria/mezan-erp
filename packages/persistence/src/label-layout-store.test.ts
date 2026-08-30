import { describe, it, expect } from "vitest";
import { createSqliteLabelLayoutStore } from "./label-layout-store.js";

function baseLayout() {
  return {
    id: "layout-1",
    code: "STICKER-40x20",
    nameAr: "ملصق ٤٠×٢٠",
    pageSize: "A4" as const,
    columns: 3,
    rows: 8,
    labelWidthMm: 40.5,
    labelHeightMm: 20.25,
    columnGapMm: 2,
    rowGapMm: 1.5,
    marginBlockMm: 5,
    marginInlineMm: 5,
    showItemName: true,
    showItemCode: true,
    showPrice: false,
    showUnit: false,
    showBarcode: true,
    showBarcodeText: false,
    barcodeHeightMm: 10.5,
    active: true,
  };
}

describe("SqliteLabelLayoutStore", () => {
  it("round-trips every field, including fractional mm dimensions and each boolean flag independently", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save(baseLayout());
      const loaded = await store.findById("layout-1");
      expect(loaded).toEqual(baseLayout());
    } finally {
      store.close();
    }
  });

  it("round-trips a layout with every show* flag false and page size A5", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save({
        ...baseLayout(),
        pageSize: "A5",
        showItemName: false,
        showItemCode: false,
        showPrice: false,
        showUnit: false,
        showBarcode: false,
        showBarcodeText: false,
        active: false,
      });
      const loaded = await store.findById("layout-1");
      expect(loaded?.pageSize).toBe("A5");
      expect(loaded?.showItemName).toBe(false);
      expect(loaded?.showBarcode).toBe(false);
      expect(loaded?.active).toBe(false);
    } finally {
      store.close();
    }
  });

  it("findByCode returns null for a code with no layout, and finds an existing one", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save(baseLayout());
      expect((await store.findByCode("STICKER-40x20"))?.id).toBe("layout-1");
      expect(await store.findByCode("NOPE")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("enforces uniqueness of the layout code", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save(baseLayout());
      await expect(store.save({ ...baseLayout(), id: "layout-2" })).rejects.toThrow();
      expect(await store.list()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("save() upserts an existing id's fields rather than duplicating the row", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save(baseLayout());
      await store.save({ ...baseLayout(), nameAr: "ملصق محدث", columns: 4, active: false });
      const loaded = await store.findById("layout-1");
      expect(loaded?.nameAr).toBe("ملصق محدث");
      expect(loaded?.columns).toBe(4);
      expect(loaded?.active).toBe(false);
      expect(await store.list()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("delete() removes the layout, and it is gone from both findById and list()", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save(baseLayout());
      await store.save({ ...baseLayout(), id: "layout-2", code: "OTHER" });
      await store.delete("layout-1");
      expect(await store.findById("layout-1")).toBeNull();
      expect((await store.list()).map((l) => l.id)).toEqual(["layout-2"]);
    } finally {
      store.close();
    }
  });

  it("list() orders by code ascending", async () => {
    const store = createSqliteLabelLayoutStore();
    try {
      await store.save({ ...baseLayout(), id: "layout-z", code: "Z-STICKER" });
      await store.save({ ...baseLayout(), id: "layout-a", code: "A-STICKER" });
      const all = await store.list();
      expect(all.map((l) => l.code)).toEqual(["A-STICKER", "Z-STICKER"]);
    } finally {
      store.close();
    }
  });
});
