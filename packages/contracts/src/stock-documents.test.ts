import { describe, it, expect } from "vitest";
import {
  stockAdjustmentDocLineSchema,
  createStockAdjustmentSchema,
  stockAdjustmentDocumentSchema,
  stockTransferDocLineSchema,
  createStockTransferSchema,
  stockTransferDocumentSchema,
  physicalCountStatusSchema,
  physicalCountLineSchema,
  physicalCountVarianceSummarySchema,
  startPhysicalCountSchema,
  recordPhysicalCountEntrySchema,
  recordPhysicalCountEntriesSchema,
  generateAdjustmentFromCountSchema,
  physicalCountSchema,
  stockBalanceWarehouseRowSchema,
  stockBalanceRowSchema,
  stockBalanceListQuerySchema,
} from "./stock-documents.js";

describe("stockAdjustmentDocLineSchema", () => {
  const line = { itemId: "item-1", warehouseId: "wh-1", reason: "DAMAGE" as const, direction: "OUT" as const, qty: "5.000000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = stockAdjustmentDocLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a negative qty", () => {
    const result = stockAdjustmentDocLineSchema.safeParse({ ...line, qty: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a direction outside IN/OUT", () => {
    const result = stockAdjustmentDocLineSchema.safeParse({ ...line, direction: "SIDEWAYS" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-catalog reason", () => {
    const result = stockAdjustmentDocLineSchema.safeParse({ ...line, reason: "MADE_UP" });
    expect(result.success).toBe(false);
  });

  it("accepts a null unitCost", () => {
    const result = stockAdjustmentDocLineSchema.safeParse({ ...line, unitCost: null });
    expect(result.success).toBe(true);
  });

  it("never coerces unitCost to a float when supplied", () => {
    const result = stockAdjustmentDocLineSchema.safeParse({ ...line, unitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitCost).toBe("0.100001");
  });
});

describe("createStockAdjustmentSchema", () => {
  const create = {
    id: "sa-1",
    date: "2026-08-30",
    lines: [{ itemId: "item-1", warehouseId: "wh-1", reason: "DAMAGE" as const, direction: "OUT" as const, qty: "5.000000" }],
  };

  it("accepts a minimal valid payload with memo omitted", () => {
    const result = createStockAdjustmentSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("rejects an empty lines array", () => {
    const result = createStockAdjustmentSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });
});

describe("stockAdjustmentDocumentSchema", () => {
  const document = {
    id: "sa-1",
    docType: "STOCK_ADJUSTMENT" as const,
    docNo: "SA-2026-001",
    date: "2026-08-30",
    memo: "",
    status: "posted" as const,
    lines: [],
    createdAt: "2026-08-30T10:00:00.000Z",
    confirmedAt: "2026-08-30T10:05:00.000Z",
    journalEntryId: "je-1",
  };

  it("accepts a minimal valid document and preserves every field verbatim", () => {
    const result = stockAdjustmentDocumentSchema.safeParse(document);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });

  it("rejects a docType other than the literal STOCK_ADJUSTMENT", () => {
    const result = stockAdjustmentDocumentSchema.safeParse({ ...document, docType: "STOCK_TRANSFER" });
    expect(result.success).toBe(false);
  });
});

describe("stockTransferDocLineSchema", () => {
  const line = { itemId: "item-1", fromWarehouseId: "wh-1", toWarehouseId: "wh-2", qty: "5.000000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = stockTransferDocLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a negative qty", () => {
    const result = stockTransferDocLineSchema.safeParse({ ...line, qty: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects qty sent as a JS number instead of a string", () => {
    const result = stockTransferDocLineSchema.safeParse({ ...line, qty: 5 });
    expect(result.success).toBe(false);
  });
});

describe("createStockTransferSchema", () => {
  it("rejects an empty lines array", () => {
    const result = createStockTransferSchema.safeParse({ id: "st-1", date: "2026-08-30", lines: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid payload", () => {
    const result = createStockTransferSchema.safeParse({
      id: "st-1",
      date: "2026-08-30",
      lines: [{ itemId: "item-1", fromWarehouseId: "wh-1", toWarehouseId: "wh-2", qty: "5.000000" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("stockTransferDocumentSchema", () => {
  it("rejects a docType other than the literal STOCK_TRANSFER", () => {
    const document = {
      id: "st-1",
      docType: "STOCK_ADJUSTMENT",
      docNo: "ST-2026-001",
      date: "2026-08-30",
      memo: "",
      status: "posted",
      lines: [],
      createdAt: "2026-08-30T10:00:00.000Z",
      confirmedAt: null,
    };
    const result = stockTransferDocumentSchema.safeParse(document);
    expect(result.success).toBe(false);
  });
});

describe("physicalCountStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["IN_PROGRESS", "COMPLETED", "ADJUSTMENT_GENERATED", "CANCELLED"]) {
      expect(physicalCountStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(physicalCountStatusSchema.safeParse("DRAFT").success).toBe(false);
  });
});

describe("physicalCountLineSchema", () => {
  it("accepts a blind-count-in-progress line with every snapshot field null", () => {
    const line = { itemId: "item-1", systemQty: null, unitCost: null, countedQty: null, varianceQty: null, varianceValue: null };
    const result = physicalCountLineSchema.safeParse(line);
    expect(result.success).toBe(true);
  });

  it("accepts a fully-resolved line and preserves precision", () => {
    const line = { itemId: "item-1", systemQty: "0.100001", unitCost: "50.000000", countedQty: "0.100002", varianceQty: "0.000001", varianceValue: "0.00005" };
    const result = physicalCountLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.systemQty).toBe("0.100001");
  });

  it("rejects systemQty sent as a JS number instead of a string", () => {
    const result = physicalCountLineSchema.safeParse({ itemId: "item-1", systemQty: 100, unitCost: null, countedQty: null, varianceQty: null, varianceValue: null });
    expect(result.success).toBe(false);
  });
});

describe("physicalCountVarianceSummarySchema", () => {
  const summary = {
    totalLines: 100,
    countedLines: 90,
    uncountedLines: 10,
    matchedLines: 80,
    overLines: 5,
    shortLines: 5,
    overQty: "10.000000",
    shortQty: "8.000000",
    netQty: "2.000000",
    overValue: "500.000000",
    shortValue: "400.000000",
    netValue: "100.000000",
    absValue: "900.000000",
  };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = physicalCountVarianceSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("rejects a negative overLines", () => {
    const result = physicalCountVarianceSummarySchema.safeParse({ ...summary, overLines: -1 });
    expect(result.success).toBe(false);
  });
});

describe("startPhysicalCountSchema", () => {
  const start = { id: "pc-1", warehouseId: "wh-1", date: "2026-08-30", itemIds: ["item-1", "item-2"] };

  it("accepts a minimal valid payload with memo/blind omitted", () => {
    const result = startPhysicalCountSchema.safeParse(start);
    expect(result.success).toBe(true);
  });

  it("rejects an empty itemIds array", () => {
    const result = startPhysicalCountSchema.safeParse({ ...start, itemIds: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("itemIds");
  });

  it("accepts an explicit blind flag", () => {
    const result = startPhysicalCountSchema.safeParse({ ...start, blind: true });
    expect(result.success).toBe(true);
  });
});

describe("recordPhysicalCountEntriesSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = recordPhysicalCountEntriesSchema.safeParse({ entries: [{ itemId: "item-1", countedQty: "10.000000" }] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty entries array", () => {
    const result = recordPhysicalCountEntriesSchema.safeParse({ entries: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a negative countedQty in an entry", () => {
    const result = recordPhysicalCountEntriesSchema.safeParse({ entries: [{ itemId: "item-1", countedQty: "-1" }] });
    expect(result.success).toBe(false);
  });
});

describe("generateAdjustmentFromCountSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = generateAdjustmentFromCountSchema.safeParse({ adjustmentId: "sa-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing adjustmentId", () => {
    const result = generateAdjustmentFromCountSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("physicalCountSchema", () => {
  const count = {
    id: "pc-1",
    countNo: "PC-2026-001",
    warehouseId: "wh-1",
    date: "2026-08-30",
    memo: "",
    status: "IN_PROGRESS" as const,
    blind: true,
    lines: [],
    variance: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    completedAt: null,
    generatedAdjustmentId: null,
  };

  it("accepts a minimal valid count with a null variance during a blind count", () => {
    const result = physicalCountSchema.safeParse(count);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(count);
  });

  it("rejects an out-of-enum status", () => {
    const result = physicalCountSchema.safeParse({ ...count, status: "DRAFT" });
    expect(result.success).toBe(false);
  });
});

describe("stockBalanceWarehouseRowSchema", () => {
  const row = { warehouseId: "wh-1", onHand: "100.000000", totalValue: "5000.000000", averageCost: "50.000000", reserved: "10.000000", available: "90.000000" };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = stockBalanceWarehouseRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });
});

describe("stockBalanceRowSchema", () => {
  const row = {
    itemId: "item-1",
    onHand: "100.000000",
    totalValue: "5000.000000",
    averageCost: "50.000000",
    warehouseCount: 2,
    reserved: "10.000000",
    available: "90.000000",
    warehouses: [],
  };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = stockBalanceRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("never coerces averageCost to a float — high-precision decimal string survives verbatim", () => {
    const result = stockBalanceRowSchema.safeParse({ ...row, averageCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.averageCost).toBe("0.100001");
  });

  it("rejects averageCost sent as a JS number instead of a string", () => {
    const result = stockBalanceRowSchema.safeParse({ ...row, averageCost: 50 });
    expect(result.success).toBe(false);
  });
});

describe("stockBalanceListQuerySchema", () => {
  it("accepts an empty query", () => {
    const result = stockBalanceListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a warehouseId filter", () => {
    const result = stockBalanceListQuerySchema.safeParse({ warehouseId: "wh-1" });
    expect(result.success).toBe(true);
  });
});
