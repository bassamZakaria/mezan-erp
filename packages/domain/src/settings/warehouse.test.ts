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
  it("has the 5 documented types in catalog order, plus the contracting site store", () => {
    expect(WAREHOUSE_TYPES).toEqual(["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN", "SITE"]);
    expect(WAREHOUSE_TYPE_DEFINITIONS).toHaveLength(6);
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
    const wh = createWarehouse({ id: "w2", code: "VAN", name: "سياره نقل", nameEn: null, branchId: "b1", type: "VAN" });
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

  it("creates a SITE warehouse carrying its project and its custodian", () => {
    const wh = createWarehouse({
      id: "w3",
      code: "WH-SITE",
      name: "مستودع موقع برج الأمل",
      branchId: "b1",
      type: "SITE",
      projectId: "PRJ-1",
      custodianUserId: "u-7",
    });
    expect(wh.type).toBe("SITE");
    expect(wh.projectId).toBe("PRJ-1");
    expect(wh.custodianUserId).toBe("u-7");
  });

  it("rejects a SITE warehouse with no project or no custodian", () => {
    expect(() =>
      createWarehouse({ id: "w4", code: "WH-SITE2", name: "موقع", branchId: "b1", type: "SITE", custodianUserId: "u-7" }),
    ).toThrow(InvalidWarehouseError);
    expect(() =>
      createWarehouse({ id: "w5", code: "WH-SITE3", name: "موقع", branchId: "b1", type: "SITE", projectId: "PRJ-1" }),
    ).toThrow(InvalidWarehouseError);
  });

  it("rejects a project or a custodian on a warehouse that is not a site store", () => {
    expect(() =>
      createWarehouse({ id: "w6", code: "WH-X", name: "رئيسي", branchId: "b1", projectId: "PRJ-1" }),
    ).toThrow(InvalidWarehouseError);
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
