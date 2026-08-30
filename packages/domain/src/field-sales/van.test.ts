import { describe, expect, it } from "vitest";
import {
  createVan,
  resolveVanCascade,
  InvalidVanError,
  VanCascadeMismatchError,
  type Van,
} from "./van.js";

function vanInput(overrides: Partial<Parameters<typeof createVan>[0]> = {}) {
  return {
    id: "VAN-1",
    code: "V1",
    nameAr: "سيارة التوزيع 1",
    branchId: "BR1",
    warehouseId: "WH-VAN-1",
    treasuryAccountId: "TRSY-VAN-1",
    ...overrides,
  };
}

describe("createVan", () => {
  it("creates a van with defaults filled in", () => {
    const van = createVan(vanInput());
    expect(van).toEqual({
      id: "VAN-1",
      code: "V1",
      nameAr: "سيارة التوزيع 1",
      nameEn: null,
      plateNumber: null,
      branchId: "BR1",
      warehouseId: "WH-VAN-1",
      treasuryAccountId: "TRSY-VAN-1",
      active: true,
    });
  });

  it("keeps an explicit active:false rather than defaulting it to true", () => {
    const van = createVan(vanInput({ active: false }));
    expect(van.active).toBe(false);
  });

  it("rejects a blank required field and reports which one", () => {
    expect(() => createVan(vanInput({ nameAr: "   " }))).toThrow(InvalidVanError);
    try {
      createVan(vanInput({ nameAr: "  ", warehouseId: " " }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidVanError);
      const reasons = (err as InvalidVanError).reasons;
      expect(reasons).toContain("اسم المركبة بالعربية مطلوب");
      expect(reasons).toContain("مستودع المركبة مطلوب");
      // Only the two blank fields are reported — not every field.
      expect(reasons).toHaveLength(2);
    }
  });

  it("rejects every required field blank at once, collecting all reasons", () => {
    try {
      createVan({ id: " ", code: " ", nameAr: " ", branchId: " ", warehouseId: " ", treasuryAccountId: " " });
      expect.unreachable();
    } catch (err) {
      expect((err as InvalidVanError).reasons).toHaveLength(6);
    }
  });
});

function van(overrides: Partial<Van> = {}): Van {
  return {
    id: "VAN-1",
    code: "V1",
    nameAr: "سيارة التوزيع 1",
    nameEn: null,
    plateNumber: null,
    branchId: "BR1",
    warehouseId: "WH-VAN-1",
    treasuryAccountId: "TRSY-VAN-1",
    active: true,
    ...overrides,
  };
}

describe("resolveVanCascade", () => {
  it("fills in the van's own warehouse and treasury when the caller claims neither", () => {
    const resolved = resolveVanCascade(van(), {});
    expect(resolved).toEqual({ warehouseId: "WH-VAN-1", treasuryAccountId: "TRSY-VAN-1", branchId: "BR1" });
  });

  it("accepts a claim that agrees with the registry", () => {
    const resolved = resolveVanCascade(van(), { warehouseId: "WH-VAN-1", treasuryAccountId: "TRSY-VAN-1" });
    expect(resolved.warehouseId).toBe("WH-VAN-1");
    expect(resolved.treasuryAccountId).toBe("TRSY-VAN-1");
  });

  it("refuses a warehouse claim that does not belong to this van — never silently substitutes it", () => {
    expect(() => resolveVanCascade(van(), { warehouseId: "WH-OTHER" })).toThrow(VanCascadeMismatchError);
    try {
      resolveVanCascade(van(), { warehouseId: "WH-OTHER" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VanCascadeMismatchError);
      expect((err as VanCascadeMismatchError).vanId).toBe("VAN-1");
      expect((err as VanCascadeMismatchError).field).toBe("warehouse");
    }
  });

  it("refuses a treasury claim that does not belong to this van", () => {
    try {
      resolveVanCascade(van(), { treasuryAccountId: "TRSY-OTHER" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VanCascadeMismatchError);
      expect((err as VanCascadeMismatchError).field).toBe("treasury");
    }
  });

  it("checks the warehouse before the treasury when both are wrong — the caller sees the first mismatch, not a generic failure", () => {
    try {
      resolveVanCascade(van(), { warehouseId: "WH-OTHER", treasuryAccountId: "TRSY-OTHER" });
      expect.unreachable();
    } catch (err) {
      expect((err as VanCascadeMismatchError).field).toBe("warehouse");
    }
  });

  it("null claims are treated the same as absent — filled in from the registry, not refused", () => {
    const resolved = resolveVanCascade(van(), { warehouseId: null, treasuryAccountId: null });
    expect(resolved).toEqual({ warehouseId: "WH-VAN-1", treasuryAccountId: "TRSY-VAN-1", branchId: "BR1" });
  });

  it("resolves the branchId from the van, not from any caller input — there is no branchId claim in the input shape", () => {
    const resolved = resolveVanCascade(van({ branchId: "BR2" }), {});
    expect(resolved.branchId).toBe("BR2");
  });
});
