import { describe, it, expect } from "vitest";
import { createWarehouse } from "@mezan/domain";
import { createSqliteWarehouseStore } from "./warehouse-store.js";

describe("SqliteWarehouseStore", () => {
  it("round-trips a saved warehouse", async () => {
    const store = createSqliteWarehouseStore();
    try {
      const wh = createWarehouse({
        id: "w1",
        code: "WH-MAIN",
        name: "مستودع الفرع الرئيسي",
        branchId: "b1",
        isDefault: true,
      });
      await store.save(wh);
      expect(await store.findById("w1")).toEqual(wh);
    } finally {
      store.close();
    }
  });

  it("scopes findByBranch to the given branch and preserves the 5 types", async () => {
    const store = createSqliteWarehouseStore();
    try {
      await store.save(createWarehouse({ id: "w1", code: "WH-MAIN", name: "مستودع رئيسي", nameEn: null, branchId: "b1", type: "MAIN" }));
      await store.save(createWarehouse({ id: "w2", code: "VAN", name: "سياره نقل", nameEn: null, branchId: "b1", type: "VAN" }));
      await store.save(createWarehouse({ id: "w3", code: "WH-B2", name: "مستودع فرع 2", nameEn: null, branchId: "b2", type: "TRANSIT" }));

      const b1Warehouses = await store.findByBranch("b1");
      expect(b1Warehouses.map((w) => w.code).sort()).toEqual(["VAN", "WH-MAIN"]);

      const all = await store.findAll();
      expect(new Set(all.map((w) => w.type))).toEqual(new Set(["MAIN", "VAN", "TRANSIT"]));
    } finally {
      store.close();
    }
  });

  it("upserts on save", async () => {
    const store = createSqliteWarehouseStore();
    try {
      const wh = createWarehouse({ id: "w1", code: "WH-MAIN", name: "مستودع رئيسي", branchId: "b1" });
      await store.save(wh);
      await store.save({ ...wh, active: false, type: "RETURNS" });
      const loaded = await store.findById("w1");
      expect(loaded?.active).toBe(false);
      expect(loaded?.type).toBe("RETURNS");
    } finally {
      store.close();
    }
  });
});
