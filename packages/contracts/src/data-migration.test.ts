import { describe, it, expect } from "vitest";
import {
  dataMigrationRowErrorSchema,
  dataMigrationResultSchema,
  customerImportRowSchema,
  customerImportBatchSchema,
  supplierImportRowSchema,
  itemImportRowSchema,
  itemImportBatchSchema,
  openingBalanceImportRowSchema,
  openingBalanceImportBatchSchema,
} from "./data-migration.js";

describe("dataMigrationResultSchema", () => {
  const result = { validCount: 8, total: 10, errors: [{ rowNumber: 9, reasons: ["missing code"] }] };

  it("accepts a minimal valid preview result with archivedIds/createdIds omitted", () => {
    const parsed = dataMigrationResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("accepts createdIds when present (commit mode)", () => {
    const parsed = dataMigrationResultSchema.safeParse({ ...result, createdIds: ["cust-1"] });
    expect(parsed.success).toBe(true);
  });

  it("rejects a negative validCount", () => {
    const parsed = dataMigrationResultSchema.safeParse({ ...result, validCount: -1 });
    expect(parsed.success).toBe(false);
  });
});

describe("customerImportRowSchema", () => {
  it("accepts a row with a blank code and name — content problems are reported per-row, not rejected at the schema", () => {
    const result = customerImportRowSchema.safeParse({ rowNumber: 1, code: "", nameAr: "" });
    expect(result.success).toBe(true);
  });

  it("never coerces openingBalance to a float when supplied", () => {
    const result = customerImportRowSchema.safeParse({ rowNumber: 1, code: "C1", nameAr: "عميل", openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects openingBalance sent as a JS number instead of a string", () => {
    const result = customerImportRowSchema.safeParse({ rowNumber: 1, code: "C1", nameAr: "عميل", openingBalance: 100 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative rowNumber", () => {
    expect(customerImportRowSchema.safeParse({ rowNumber: 0, code: "C1", nameAr: "عميل" }).success).toBe(false);
  });

  it("rejects an out-of-enum etaBuyerType when supplied", () => {
    const result = customerImportRowSchema.safeParse({ rowNumber: 1, code: "C1", nameAr: "عميل", etaBuyerType: "government" });
    expect(result.success).toBe(false);
  });
});

describe("customerImportBatchSchema", () => {
  it("rejects an empty rows array", () => {
    const result = customerImportBatchSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a batch with one minimal row", () => {
    const result = customerImportBatchSchema.safeParse({ rows: [{ rowNumber: 1, code: "C1", nameAr: "عميل" }] });
    expect(result.success).toBe(true);
  });
});

describe("supplierImportRowSchema", () => {
  it("accepts a minimal row with a blank code and name", () => {
    const result = supplierImportRowSchema.safeParse({ rowNumber: 1, code: "", nameAr: "" });
    expect(result.success).toBe(true);
  });

  it("rejects openingBalance sent as a JS number instead of a string", () => {
    const result = supplierImportRowSchema.safeParse({ rowNumber: 1, code: "S1", nameAr: "مورد", openingBalance: 100 });
    expect(result.success).toBe(false);
  });
});

describe("itemImportRowSchema", () => {
  const row = { rowNumber: 1, code: "ITM-1", nameAr: "منتج", baseUnitCode: "PCS" };

  it("accepts a minimal valid row with optionals omitted", () => {
    const result = itemImportRowSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it("never coerces salePrice to a float when supplied", () => {
    const result = itemImportRowSchema.safeParse({ ...row, salePrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.salePrice).toBe("0.100001");
  });

  it("rejects salePrice sent as a JS number instead of a string", () => {
    const result = itemImportRowSchema.safeParse({ ...row, salePrice: 100 });
    expect(result.success).toBe(false);
  });

  it("accepts a null salePrice for a service item with no price yet", () => {
    const result = itemImportRowSchema.safeParse({ ...row, salePrice: null });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum costingMethod", () => {
    const result = itemImportRowSchema.safeParse({ ...row, costingMethod: "LIFO" });
    expect(result.success).toBe(false);
  });

  it("rejects a row missing baseUnitCode", () => {
    const { baseUnitCode, ...rest } = row;
    const result = itemImportRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("baseUnitCode");
  });
});

describe("itemImportBatchSchema", () => {
  it("rejects an empty rows array", () => {
    const result = itemImportBatchSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
  });
});

describe("openingBalanceImportRowSchema", () => {
  const row = { rowNumber: 1, itemCode: "ITM-1", qty: "10.000000", unitCost: "50.000000" };

  it("accepts a minimal valid row — qty/unitCost ARE schema-level concerns here, unlike code/nameAr above", () => {
    const result = openingBalanceImportRowSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it("rejects a negative qty", () => {
    const result = openingBalanceImportRowSchema.safeParse({ ...row, qty: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = openingBalanceImportRowSchema.safeParse({ ...row, unitCost: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects a row missing itemCode", () => {
    const { itemCode, ...rest } = row;
    const result = openingBalanceImportRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("itemCode");
  });
});

describe("openingBalanceImportBatchSchema", () => {
  const batch = {
    warehouseId: "wh-1",
    date: "2026-08-30",
    rows: [{ rowNumber: 1, itemCode: "ITM-1", qty: "10.000000", unitCost: "50.000000" }],
  };

  it("accepts a minimal valid batch and preserves every field verbatim", () => {
    const result = openingBalanceImportBatchSchema.safeParse(batch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(batch);
  });

  it("rejects a batch missing warehouseId — one warehouse per batch is required", () => {
    const { warehouseId, ...rest } = batch;
    const result = openingBalanceImportBatchSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("warehouseId");
  });

  it("rejects an empty rows array", () => {
    const result = openingBalanceImportBatchSchema.safeParse({ ...batch, rows: [] });
    expect(result.success).toBe(false);
  });
});
