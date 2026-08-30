import { describe, it, expect } from "vitest";
import {
  historicalPurchaseDocTypeSchema,
  historicalImportRowSchema,
  historicalImportBatchSchema,
  historicalImportRowErrorSchema,
  historicalImportGroupPreviewSchema,
  historicalImportResultSchema,
  historicalPurchaseArchiveLineSchema,
  historicalPurchaseArchiveSchema,
} from "./historical-import.js";

describe("historicalPurchaseDocTypeSchema", () => {
  it("accepts PURCHASE_INVOICE and PURCHASE_RETURN", () => {
    expect(historicalPurchaseDocTypeSchema.safeParse("PURCHASE_INVOICE").success).toBe(true);
    expect(historicalPurchaseDocTypeSchema.safeParse("PURCHASE_RETURN").success).toBe(true);
  });

  it("rejects a doc type outside the enum", () => {
    expect(historicalPurchaseDocTypeSchema.safeParse("SALES_INVOICE").success).toBe(false);
  });
});

describe("historicalImportRowSchema", () => {
  const row = {
    rowNumber: 1,
    docType: "PURCHASE_INVOICE" as const,
    documentNumber: "PI-2025-001",
    supplierId: "sup-1",
    date: "2025-01-15",
    qty: "10.000000",
    unitCost: "50.123456",
    amountPaid: "501.234560",
  };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = historicalImportRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("never coerces unitCost to a float — high-precision decimal string survives verbatim", () => {
    const result = historicalImportRowSchema.safeParse({ ...row, unitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitCost).toBe("0.100001");
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = historicalImportRowSchema.safeParse({ ...row, unitCost: 50.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative qty", () => {
    const result = historicalImportRowSchema.safeParse({ ...row, qty: "-10" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative rowNumber", () => {
    expect(historicalImportRowSchema.safeParse({ ...row, rowNumber: 0 }).success).toBe(false);
    expect(historicalImportRowSchema.safeParse({ ...row, rowNumber: -1 }).success).toBe(false);
  });

  it("rejects a row missing supplierId", () => {
    const { supplierId, ...rest } = row;
    const result = historicalImportRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("supplierId");
  });
});

describe("historicalImportBatchSchema", () => {
  const row = {
    rowNumber: 1,
    docType: "PURCHASE_INVOICE" as const,
    documentNumber: "PI-2025-001",
    supplierId: "sup-1",
    date: "2025-01-15",
    qty: "10.000000",
    unitCost: "50.123456",
    amountPaid: "501.234560",
  };

  it("accepts a batch with at least one row", () => {
    const result = historicalImportBatchSchema.safeParse({ rows: [row] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty rows array", () => {
    const result = historicalImportBatchSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rows");
  });
});

describe("historicalImportRowErrorSchema", () => {
  it("accepts a minimal valid error and preserves it verbatim", () => {
    const error = { rowNumber: 3, reasons: ["missing supplierId"] };
    const result = historicalImportRowErrorSchema.safeParse(error);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(error);
  });

  it("rejects a zero rowNumber", () => {
    const result = historicalImportRowErrorSchema.safeParse({ rowNumber: 0, reasons: [] });
    expect(result.success).toBe(false);
  });
});

describe("historicalImportGroupPreviewSchema", () => {
  const group = {
    documentNumber: "PI-2025-001",
    docType: "PURCHASE_INVOICE" as const,
    supplierId: "sup-1",
    date: "2025-01-15",
    dueDate: null,
    lineCount: 3,
    total: "1500.123456",
    amountPaid: "500.000000",
    remainingBalance: "1000.123456",
    settled: false,
  };

  it("accepts a minimal valid group and preserves every field verbatim", () => {
    const result = historicalImportGroupPreviewSchema.safeParse(group);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(group);
  });

  it("never coerces total to a float — high-precision decimal string survives verbatim", () => {
    const result = historicalImportGroupPreviewSchema.safeParse({ ...group, total: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.total).toBe("0.100001");
  });

  it("accepts a negative remainingBalance — an overpayment is representable, unlike qty/unitCost fields", () => {
    const result = historicalImportGroupPreviewSchema.safeParse({ ...group, remainingBalance: "-50.00" });
    expect(result.success).toBe(true);
  });
});

describe("historicalImportResultSchema", () => {
  it("accepts a minimal valid result with archivedIds omitted (preview mode)", () => {
    const result = historicalImportResultSchema.safeParse({ groups: [], errors: [] });
    expect(result.success).toBe(true);
  });

  it("accepts archivedIds when present (commit mode)", () => {
    const result = historicalImportResultSchema.safeParse({ groups: [], errors: [], archivedIds: ["arc-1"] });
    expect(result.success).toBe(true);
  });

  it("rejects a result missing errors", () => {
    const result = historicalImportResultSchema.safeParse({ groups: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("errors");
  });
});

describe("historicalPurchaseArchiveLineSchema", () => {
  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const line = { itemId: "item-1", description: null, qty: "10.000000", unitCost: "50.123456" };
    const result = historicalPurchaseArchiveLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = historicalPurchaseArchiveLineSchema.safeParse({ itemId: null, description: null, qty: "1", unitCost: 50 });
    expect(result.success).toBe(false);
  });
});

describe("historicalPurchaseArchiveSchema", () => {
  const archive = {
    id: "arc-1",
    docType: "PURCHASE_INVOICE" as const,
    originalNumber: "PI-2025-001",
    supplierId: "sup-1",
    date: "2025-01-15",
    dueDate: null,
    lines: [{ itemId: "item-1", description: null, qty: "10.000000", unitCost: "50.123456" }],
    total: "501.234560",
    amountPaid: "501.234560",
    remainingBalance: "0",
    settled: true,
    importBatchId: "batch-1",
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid archive and preserves every field verbatim", () => {
    const result = historicalPurchaseArchiveSchema.safeParse(archive);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(archive);
  });

  it("rejects an archive missing importBatchId", () => {
    const { importBatchId, ...rest } = archive;
    const result = historicalPurchaseArchiveSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("importBatchId");
  });
});
