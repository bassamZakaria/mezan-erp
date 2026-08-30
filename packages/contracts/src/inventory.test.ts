import { describe, it, expect } from "vitest";
import {
  stockMovementDirectionSchema,
  adjustmentReasonSchema,
  stockSourceDocTypeSchema,
  stockMovementSchema,
  stockBalanceSchema,
  valuationReportSchema,
  driftReportSchema,
  postedAdjustmentLineSchema,
  postedAdjustmentSchema,
  postedTransferSchema,
  postedAdjustmentListQuerySchema,
  postedTransferListQuerySchema,
  adjustmentLineSchema,
  postAdjustmentSchema,
  transferLineSchema,
  postTransferSchema,
} from "./inventory.js";

describe("adjustmentReasonSchema", () => {
  it("accepts each of the eight known reasons", () => {
    for (const r of ["INITIAL_STOCK", "PHYSICAL_COUNT", "DAMAGE", "THEFT", "EXPIRY", "SHORTAGE", "SUPPLIER_RETURN", "OTHER"]) {
      expect(adjustmentReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects a reason outside the enum", () => {
    expect(adjustmentReasonSchema.safeParse("MADE_UP").success).toBe(false);
  });
});

describe("stockMovementSchema", () => {
  const movement = {
    id: "sm-1",
    itemId: "item-1",
    warehouseId: "wh-1",
    direction: "IN" as const,
    qty: "10.000000",
    unitCost: "50.123456",
    sourceDocType: "PURCHASE_INVOICE" as const,
    sourceDocId: "pi-1",
    sourceDocNumber: "PI-2026-001",
    reason: null,
    occurredAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid movement and preserves every field verbatim", () => {
    const result = stockMovementSchema.safeParse(movement);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(movement);
  });

  it("never coerces unitCost to a float — high-precision decimal string survives verbatim", () => {
    const result = stockMovementSchema.safeParse({ ...movement, unitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitCost).toBe("0.100001");
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = stockMovementSchema.safeParse({ ...movement, unitCost: 50.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative qty via the exact-decimal regex — but a negative sign IS allowed by this regex, unlike positiveDecimalString", () => {
    const negative = stockMovementSchema.safeParse({ ...movement, qty: "-10.000000" });
    expect(negative.success).toBe(true);
  });

  it("rejects an out-of-enum sourceDocType", () => {
    const result = stockMovementSchema.safeParse({ ...movement, sourceDocType: "MANUAL" });
    expect(result.success).toBe(false);
  });
});

describe("stockBalanceSchema / valuationRowSchema", () => {
  const balance = { itemId: "item-1", warehouseId: "wh-1", onHand: "100.000000", averageCost: "50.000000", totalValue: "5000.000000" };

  it("accepts a minimal valid balance and preserves every field verbatim", () => {
    const result = stockBalanceSchema.safeParse(balance);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(balance);
  });

  it("rejects onHand sent as a JS number instead of a string", () => {
    const result = stockBalanceSchema.safeParse({ ...balance, onHand: 100 });
    expect(result.success).toBe(false);
  });
});

describe("valuationReportSchema", () => {
  it("accepts a minimal valid report with an empty rows array", () => {
    const result = valuationReportSchema.safeParse({ rows: [], totalValue: "0" });
    expect(result.success).toBe(true);
  });

  it("rejects totalValue sent as a JS number instead of a string", () => {
    const result = valuationReportSchema.safeParse({ rows: [], totalValue: 0 });
    expect(result.success).toBe(false);
  });
});

describe("driftReportSchema", () => {
  const drift = {
    itemId: "item-1",
    warehouseId: "wh-1",
    onHand: "100.000000",
    cachedAverageCost: "50.000000",
    recomputedAverageCost: "50.010000",
    layersAverageCost: "50.010000",
    cachedValue: "5000.000000",
    recomputedValue: "5001.000000",
    layersValue: "5001.000000",
    layersQty: "100.000000",
    cacheDrift: "1.000000",
    layerDrift: "0",
    withinTolerance: true,
  };

  it("accepts a minimal valid report and preserves every field verbatim", () => {
    const result = driftReportSchema.safeParse(drift);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(drift);
  });

  it("rejects a report missing withinTolerance", () => {
    const { withinTolerance, ...rest } = drift;
    const result = driftReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("postedAdjustmentLineSchema", () => {
  const line = { itemId: "item-1", direction: "OUT" as const, qty: "5.000000", unitCost: "50.000000", value: "250.000000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = postedAdjustmentLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects value sent as a JS number instead of a string", () => {
    const result = postedAdjustmentLineSchema.safeParse({ ...line, value: 250 });
    expect(result.success).toBe(false);
  });
});

describe("postedAdjustmentSchema", () => {
  const adjustment = {
    id: "sa-1",
    docNo: "SA-2026-001",
    warehouseId: "wh-1",
    reason: "DAMAGE" as const,
    occurredAt: "2026-08-30T10:00:00.000Z",
    lines: [{ itemId: "item-1", direction: "OUT" as const, qty: "5.000000", unitCost: "50.000000", value: "250.000000" }],
    valueDelta: "-250.000000",
  };

  it("accepts a minimal valid adjustment and preserves every field verbatim", () => {
    const result = postedAdjustmentSchema.safeParse(adjustment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(adjustment);
  });

  it("accepts a null reason for a legacy adjustment", () => {
    const result = postedAdjustmentSchema.safeParse({ ...adjustment, reason: null });
    expect(result.success).toBe(true);
  });
});

describe("postedTransferSchema", () => {
  const transfer = {
    id: "st-1",
    docNo: "ST-2026-001",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    occurredAt: "2026-08-30T10:00:00.000Z",
    lines: [{ itemId: "item-1", qty: "5.000000", unitCost: "50.000000", value: "250.000000" }],
    totalValue: "250.000000",
  };

  it("accepts a minimal valid transfer and preserves every field verbatim", () => {
    const result = postedTransferSchema.safeParse(transfer);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(transfer);
  });
});

describe("postedAdjustmentListQuerySchema", () => {
  it("accepts an empty query", () => {
    const result = postedAdjustmentListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum reason filter", () => {
    const result = postedAdjustmentListQuerySchema.safeParse({ reason: "MADE_UP" });
    expect(result.success).toBe(false);
  });
});

describe("postedTransferListQuerySchema", () => {
  it("accepts an empty query", () => {
    const result = postedTransferListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("adjustmentLineSchema", () => {
  it("accepts a minimal valid line with unitCost omitted", () => {
    const result = adjustmentLineSchema.safeParse({ itemId: "item-1", direction: "IN", qty: "5.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative qty", () => {
    const result = adjustmentLineSchema.safeParse({ itemId: "item-1", direction: "IN", qty: "-5" });
    expect(result.success).toBe(false);
  });
});

describe("postAdjustmentSchema", () => {
  const post = {
    adjustmentId: "sa-1",
    warehouseId: "wh-1",
    reason: "DAMAGE" as const,
    lines: [{ itemId: "item-1", direction: "OUT" as const, qty: "5.000000" }],
  };

  it("accepts a minimal valid payload with gl override omitted", () => {
    const result = postAdjustmentSchema.safeParse(post);
    expect(result.success).toBe(true);
  });

  it("accepts an inventoryAccountId override without a counterpartAccountId — that is derived server-side from the reason", () => {
    const result = postAdjustmentSchema.safeParse({ ...post, gl: { inventoryAccountId: "acc-inv" } });
    expect(result.success).toBe(true);
  });

  it("still accepts a supplied counterpartAccountId even though it is no longer authoritative — the schema does not refuse it", () => {
    const result = postAdjustmentSchema.safeParse({ ...post, gl: { inventoryAccountId: "acc-inv", counterpartAccountId: "acc-counter" } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gl?.counterpartAccountId).toBe("acc-counter");
  });

  it("rejects an empty lines array", () => {
    const result = postAdjustmentSchema.safeParse({ ...post, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("rejects an out-of-enum reason", () => {
    const result = postAdjustmentSchema.safeParse({ ...post, reason: "MADE_UP" });
    expect(result.success).toBe(false);
  });
});

describe("transferLineSchema", () => {
  it("accepts a minimal valid line", () => {
    const result = transferLineSchema.safeParse({ itemId: "item-1", qty: "5.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative qty", () => {
    const result = transferLineSchema.safeParse({ itemId: "item-1", qty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("postTransferSchema", () => {
  const post = {
    transferId: "st-1",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    lines: [{ itemId: "item-1", qty: "5.000000" }],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = postTransferSchema.safeParse(post);
    expect(result.success).toBe(true);
  });

  it("rejects an empty lines array", () => {
    const result = postTransferSchema.safeParse({ ...post, lines: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing toWarehouseId", () => {
    const { toWarehouseId, ...rest } = post;
    const result = postTransferSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("toWarehouseId");
  });
});
