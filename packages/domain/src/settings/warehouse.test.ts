import { describe, expect, it } from "vitest";
import {
  createWarehouse,
  updateWarehouse,
  InvalidWarehouseError,
  WAREHOUSE_TYPES,
  WAREHOUSE_TYPE_DEFINITIONS,
  getWarehouseTypeLabel,
} from "./warehouse.js";

describe("warehouse type catalog", () => {
  it("has exactly the 5 documented types, in catalog order", () => {
    expect(WAREHOUSE_TYPES).toEqual(["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN"]);
    expect(WAREHOUSE_TYPE_DEFINITIONS).toHaveLength(5);
  });

  it("resolves the Arabic label for each type", () => {
    expect(getWarehouseTypeLabel("VAN")).toBe("ڤان (سيارة توزيع)");
    expect(getWarehouseTypeLabel("MAIN")).toBe("رئيسي");
  });
});

describe("createWarehouse", () => {
  it("creates a warehouse defaulting to type MAIN, matching the add-dialog default", () => {
    const wh = createWarehouse({ id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "b1" });
    expect(wh.type).toBe("MAIN");
    expect(wh.active).toBe(true);
    expect(wh.isDefault).toBe(false);
  });

  it("creates a VAN-type warehouse (field-sales vehicle stock)", () => {
    const wh = createWarehouse({ id: "w2", code: "VAN", name: "سياره نقل", branchId: "b1", type: "VAN" });
    expect(wh.type).toBe("VAN");
  });

  it("rejects an unknown type", () => {
    expect(() =>
      createWarehouse({ id: "w1", code: "WH", name: "x", branchId: "b1", type: "COLD_STORE" as never }),
    ).toThrow(InvalidWarehouseError);
  });

  it("rejects a missing branchId", () => {
    expect(() => createWarehouse({ id: "w1", code: "WH", name: "x", branchId: "" })).toThrow(InvalidWarehouseError);
  });
});

describe("updateWarehouse", () => {
  it("applies a patch and re-validates", () => {
    const wh = createWarehouse({ id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "b1" });
    const updated = updateWarehouse(wh, { isDefault: true, active: false });
    expect(updated.isDefault).toBe(true);
    expect(updated.active).toBe(false);
  });
});
