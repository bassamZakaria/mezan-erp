import { describe, expect, it } from "vitest";
import type { BranchDTO, WarehouseDTO } from "@mezan/contracts";
import { resolveDefaultBranch, resolveDefaultWarehouse } from "./working-location";

function branch(patch: Partial<BranchDTO>): BranchDTO {
  return {
    id: "b1",
    code: "B1",
    name: "Branch",
    parentBranchId: null,
    phone: null,
    email: null,
    address: null,
    isMain: false,
    active: true,
    ...patch,
  };
}

function warehouse(patch: Partial<WarehouseDTO>): WarehouseDTO {
  return {
    id: "w1",
    code: "W1",
    name: "Warehouse",
    nameEn: null,
    branchId: "b1",
    type: "MAIN",
    isDefault: false,
    active: true,
    projectId: null,
    custodianUserId: null,
    ...patch,
  };
}

describe("resolveDefaultBranch", () => {
  it("prefers the main branch", () => {
    const branches = [branch({ id: "b1" }), branch({ id: "b2", isMain: true })];
    expect(resolveDefaultBranch(branches)?.id).toBe("b2");
  });

  it("falls back to the first active branch when none is main", () => {
    const branches = [branch({ id: "b1", active: false }), branch({ id: "b2" })];
    expect(resolveDefaultBranch(branches)?.id).toBe("b2");
  });

  it("returns null with no active branch", () => {
    expect(resolveDefaultBranch([branch({ active: false })])).toBeNull();
  });
});

describe("resolveDefaultWarehouse", () => {
  it("prefers the default warehouse in the given branch", () => {
    const warehouses = [
      warehouse({ id: "w1", branchId: "b1" }),
      warehouse({ id: "w2", branchId: "b1", isDefault: true }),
      warehouse({ id: "w3", branchId: "b2", isDefault: true }),
    ];
    expect(resolveDefaultWarehouse(warehouses, "b1")?.id).toBe("w2");
  });

  it("ignores an inactive warehouse", () => {
    const warehouses = [warehouse({ id: "w1", branchId: "b1", isDefault: true, active: false }), warehouse({ id: "w2", branchId: "b1" })];
    expect(resolveDefaultWarehouse(warehouses, "b1")?.id).toBe("w2");
  });
});
