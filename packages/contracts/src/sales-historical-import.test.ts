import { describe, it, expect } from "vitest";
import {
  historicalSalesDocTypeSchema,
  historicalSalesImportRowSchema,
  historicalSalesImportBatchSchema,
  historicalSalesImportRowErrorSchema,
  historicalSalesImportGroupPreviewSchema,
  historicalSalesImportResultSchema,
  historicalSalesArchiveLineSchema,
  historicalSalesArchiveSchema,
} from "./sales-historical-import.js";

describe("historicalSalesDocTypeSchema", () => {
  it("accepts SALES_INVOICE and SALES_RETURN", () => {
    expect(historicalSalesDocTypeSchema.safeParse("SALES_INVOICE").success).toBe(true);
    expect(historicalSalesDocTypeSchema.safeParse("SALES_RETURN").success).toBe(true);
  });

  it("rejects a doc type outside the enum", () => {
    expect(historicalSalesDocTypeSchema.safeParse("PURCHASE_INVOICE").success).toBe(false);
  });
});

describe("historicalSalesImportRowSchema", () => {
  const row = {
    rowNumber: 1,
    docType: "SALES_INVOICE" as const,
    documentNumber: "SI-2025-001",
    customerId: "cust-1",
    date: "2025-01-15",
    qty: "10.000000",
    unitCost: "50.123456",
    amountPaid: "501.234560",
  };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = historicalSalesImportRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("never coerces unitCost to a float — high-precision decimal string survives verbatim", () => {
    const result = historicalSalesImportRowSchema.safeParse({ ...row, unitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitCost).toBe("0.100001");
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = historicalSalesImportRowSchema.safeParse({ ...row, unitCost: 50.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative qty", () => {
    const result = historicalSalesImportRowSchema.safeParse({ ...row, qty: "-10" });
    expect(result.success).toBe(false);
  });

  it("rejects a row missing customerId", () => {
    const { customerId, ...rest } = row;
    const result = historicalSalesImportRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("customerId");
  });
});

describe("historicalSalesImportBatchSchema", () => {
  const row = {
    rowNumber: 1,
    docType: "SALES_INVOICE" as const,
    documentNumber: "SI-2025-001",
    customerId: "cust-1",
    date: "2025-01-15",
    qty: "10.000000",
    unitCost: "50.123456",
    amountPaid: "501.234560",
  };

  it("accepts a batch with at least one row", () => {
    const result = historicalSalesImportBatchSchema.safeParse({ rows: [row] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty rows array", () => {
    const result = historicalSalesImportBatchSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rows");
  });
});

describe("historicalSalesImportRowErrorSchema", () => {
  it("accepts a minimal valid error and preserves it verbatim", () => {
    const error = { rowNumber: 3, reasons: ["missing customerId"] };
    const result = historicalSalesImportRowErrorSchema.safeParse(error);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(error);
  });
});

describe("historicalSalesImportGroupPreviewSchema", () => {
  const group = {
    documentNumber: "SI-2025-001",
    docType: "SALES_INVOICE" as const,
    customerId: "cust-1",
    date: "2025-01-15",
    dueDate: null,
    lineCount: 3,
    total: "1500.123456",
    amountPaid: "500.000000",
    remainingBalance: "1000.123456",
    settled: false,
  };

  it("accepts a minimal valid group and preserves every field verbatim", () => {
    const result = historicalSalesImportGroupPreviewSchema.safeParse(group);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(group);
  });

  it("never coerces total to a float — high-precision decimal string survives verbatim", () => {
    const result = historicalSalesImportGroupPreviewSchema.safeParse({ ...group, total: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.total).toBe("0.100001");
  });
});

describe("historicalSalesImportResultSchema", () => {
  it("accepts a minimal valid result with archivedIds omitted (preview mode)", () => {
    const result = historicalSalesImportResultSchema.safeParse({ groups: [], errors: [] });
    expect(result.success).toBe(true);
  });

  it("accepts archivedIds when present (commit mode)", () => {
    const result = historicalSalesImportResultSchema.safeParse({ groups: [], errors: [], archivedIds: ["arc-1"] });
    expect(result.success).toBe(true);
  });
});

describe("historicalSalesArchiveLineSchema", () => {
  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const line = { itemId: "item-1", description: null, qty: "10.000000", unitCost: "50.123456" };
    const result = historicalSalesArchiveLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = historicalSalesArchiveLineSchema.safeParse({ itemId: null, description: null, qty: "1", unitCost: 50 });
    expect(result.success).toBe(false);
  });
});

describe("historicalSalesArchiveSchema", () => {
  const archive = {
    id: "arc-1",
    docType: "SALES_INVOICE" as const,
    originalNumber: "SI-2025-001",
    customerId: "cust-1",
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
    const result = historicalSalesArchiveSchema.safeParse(archive);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(archive);
  });

  it("rejects an archive missing customerId", () => {
    const { customerId, ...rest } = archive;
    const result = historicalSalesArchiveSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("customerId");
  });
});
