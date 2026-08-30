import { describe, it, expect } from "vitest";
import {
  vanTripStatusSchema,
  vanTripCrewRoleSchema,
  vanTripCashMovementKindSchema,
  vanTripCrewMemberSchema,
  vanTripStockLineSchema,
  vanTripCashMovementSchema,
  vanTripSettlementSchema,
  vanSchema,
  createVanSchema,
  vanTripSchema,
  openVanTripSchema,
  recordVanCashMovementSchema,
  settleVanTripSchema,
} from "./field-sales.js";

describe("vanTripStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["ongoing", "settled", "cancelled"]) {
      expect(vanTripStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(vanTripStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("vanTripStockLineSchema", () => {
  it("accepts a minimal valid line", () => {
    const result = vanTripStockLineSchema.safeParse({ itemId: "item-1", qty: "10.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative qty", () => {
    const result = vanTripStockLineSchema.safeParse({ itemId: "item-1", qty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("vanTripCashMovementSchema", () => {
  const movement = { id: "cm-1", kind: "sale" as const, amount: "500.123456", occurredAt: "2026-08-30T10:00:00.000Z", notes: null };

  it("accepts a minimal valid movement and preserves every field verbatim", () => {
    const result = vanTripCashMovementSchema.safeParse(movement);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(movement);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = vanTripCashMovementSchema.safeParse({ ...movement, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = vanTripCashMovementSchema.safeParse({ ...movement, amount: 500.12 });
    expect(result.success).toBe(false);
  });

  it("accepts a negative amount — a collection reversal is representable, unlike positive-only qty fields", () => {
    const result = vanTripCashMovementSchema.safeParse({ ...movement, amount: "-100.000000" });
    expect(result.success).toBe(true);
  });
});

describe("vanTripSettlementSchema", () => {
  const settlement = { expectedCash: "5000.000000", countedCash: "4980.000000", cashVariance: "-20.000000", stockCounts: [], settledAt: "2026-08-30T18:00:00.000Z" };

  it("accepts a minimal valid settlement and preserves every field verbatim", () => {
    const result = vanTripSettlementSchema.safeParse(settlement);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(settlement);
  });

  it("accepts a negative cashVariance for a shortage", () => {
    const result = vanTripSettlementSchema.safeParse({ ...settlement, cashVariance: "-500.000000" });
    expect(result.success).toBe(true);
  });
});

describe("vanSchema", () => {
  const van = {
    id: "van-1",
    code: "VAN-01",
    nameAr: "سيارة التوزيع 1",
    nameEn: null,
    plateNumber: null,
    branchId: "branch-1",
    warehouseId: "wh-van-1",
    treasuryAccountId: "acc-van-1",
    active: true,
  };

  it("accepts a minimal valid van and preserves every field verbatim", () => {
    const result = vanSchema.safeParse(van);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(van);
  });

  it("rejects a van missing treasuryAccountId — every van owns a till", () => {
    const { treasuryAccountId, ...rest } = van;
    const result = vanSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("treasuryAccountId");
  });
});

describe("createVanSchema", () => {
  const create = { code: "VAN-01", nameAr: "سيارة التوزيع 1", branchId: "branch-1", warehouseId: "wh-van-1", treasuryAccountId: "acc-van-1" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createVanSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing warehouseId", () => {
    const { warehouseId, ...rest } = create;
    const result = createVanSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("warehouseId");
  });
});

describe("vanTripSchema", () => {
  const trip = {
    id: "trip-1",
    tripNo: "VT-2026-001",
    date: "2026-08-30",
    branchId: "branch-1",
    vanId: "van-1",
    vanWarehouseId: "wh-van-1",
    vanTreasuryAccountId: "acc-van-1",
    sourceWarehouseId: "wh-main",
    sourceTreasuryAccountId: "acc-main",
    openingCashFloat: "1000.000000",
    crew: [{ employeeId: "emp-1", role: "driver" as const }],
    loadedStock: [],
    cashMovements: [],
    status: "ongoing" as const,
    openedAt: "2026-08-30T07:00:00.000Z",
    settledAt: null,
    settlement: null,
    notes: null,
  };

  it("accepts a minimal valid trip and preserves every field verbatim", () => {
    const result = vanTripSchema.safeParse(trip);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(trip);
  });

  it("rejects an out-of-enum crew role", () => {
    const result = vanTripSchema.safeParse({ ...trip, crew: [{ employeeId: "emp-1", role: "manager" }] });
    expect(result.success).toBe(false);
  });
});

describe("openVanTripSchema", () => {
  const open = {
    id: "trip-1",
    date: "2026-08-30",
    sourceWarehouseId: "wh-main",
    sourceTreasuryAccountId: "acc-main",
    crew: [{ employeeId: "emp-1", role: "driver" as const }],
  };

  it("accepts a minimal valid payload — naming the van is enough, warehouse/till are optional", () => {
    const result = openVanTripSchema.safeParse(open);
    expect(result.success).toBe(true);
  });

  it("rejects an empty crew array — at least one crew member is required to open a trip", () => {
    const result = openVanTripSchema.safeParse({ ...open, crew: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("crew");
  });

  it("rejects a payload missing sourceTreasuryAccountId", () => {
    const { sourceTreasuryAccountId, ...rest } = open;
    const result = openVanTripSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("sourceTreasuryAccountId");
  });
});

describe("recordVanCashMovementSchema", () => {
  const movement = { id: "cm-1", kind: "collection" as const, amount: "500.000000", occurredAt: "2026-08-30T12:00:00.000Z" };

  it("accepts a minimal valid payload with notes omitted", () => {
    const result = recordVanCashMovementSchema.safeParse(movement);
    expect(result.success).toBe(true);
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = recordVanCashMovementSchema.safeParse({ ...movement, amount: 500 });
    expect(result.success).toBe(false);
  });
});

describe("settleVanTripSchema", () => {
  const settle = { countedCash: "4980.000000", stockCounts: [{ itemId: "item-1", countedQty: "5.000000" }] };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = settleVanTripSchema.safeParse(settle);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(settle);
  });

  it("rejects countedCash sent as a JS number instead of a string", () => {
    const result = settleVanTripSchema.safeParse({ ...settle, countedCash: 4980 });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing stockCounts", () => {
    const { stockCounts, ...rest } = settle;
    const result = settleVanTripSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("stockCounts");
  });
});
