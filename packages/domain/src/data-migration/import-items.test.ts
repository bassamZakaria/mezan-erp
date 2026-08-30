import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { previewItemImport, type ItemImportRowInput } from "./import-items.js";

function row(overrides: Partial<ItemImportRowInput> = {}): ItemImportRowInput {
  return {
    rowNumber: 1,
    code: "IT-001",
    nameAr: "أرز أبيض 5 كجم",
    baseUnitCode: "PCS",
    ...overrides,
  };
}

const idFor = (r: ItemImportRowInput) => `id-${r.code.trim()}`;

describe("previewItemImport", () => {
  it("accepts a minimal row and builds an active stock item", () => {
    const preview = previewItemImport([row()], new Set(), idFor);
    expect(preview.errors).toEqual([]);
    expect(preview.valid[0]?.item).toMatchObject({
      id: "id-IT-001",
      code: "IT-001",
      nameAr: "أرز أبيض 5 كجم",
      status: "active",
    });
  });

  it("trims the code it stores", () => {
    const preview = previewItemImport([row({ code: "  IT-001  " })], new Set(), idFor);
    expect(preview.valid[0]?.item.code).toBe("IT-001");
  });

  it("carries the prices through as exact amounts", () => {
    const preview = previewItemImport(
      [row({ salePrice: Money.fromMajor("125.50"), costPrice: Money.fromMajor("98.750000") })],
      new Set(),
      idFor,
    );
    expect(preview.valid[0]?.item.salePrice?.toString()).toBe("125.500000");
    expect(preview.valid[0]?.item.costPrice?.toString()).toBe("98.750000");
  });

  it("refuses a row with no code, in Arabic", () => {
    const preview = previewItemImport([row({ code: " " })], new Set(), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons).toContain("كود الصنف مطلوب");
  });

  it("refuses a code the tenant already holds, and a code repeated in the file", () => {
    const existing = previewItemImport([row()], new Set(["IT-001"]), idFor);
    expect(existing.errors[0]?.reasons[0]).toContain("مستخدم بالفعل");

    const repeated = previewItemImport([row(), row({ rowNumber: 2 })], new Set(), idFor);
    expect(repeated.valid.map((v) => v.rowNumber)).toEqual([1]);
    expect(repeated.errors[0]?.reasons[0]).toContain("مكرر داخل الملف");
  });

  it("applies the same field rules the single-item create path uses", () => {
    const preview = previewItemImport([row({ nameAr: "   " })], new Set(), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("reports a duplicate code and a field problem together, not one at a time", () => {
    const preview = previewItemImport([row({ code: "IT-001", nameAr: "" })], new Set(["IT-001"]), idFor);
    expect(preview.errors[0]?.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("defaults an unstated type to a stock item that tracks inventory", () => {
    const preview = previewItemImport([row()], new Set(), idFor);
    expect(preview.valid[0]?.item.type).toBe("stock");
    expect(preview.valid[0]?.item.trackInventory).toBe(true);
  });

  it("does not track inventory for a service item", () => {
    const preview = previewItemImport([row({ type: "service" })], new Set(), idFor);
    if (preview.errors.length === 0) {
      expect(preview.valid[0]?.item.trackInventory).toBe(false);
    }
  });

  it("keeps the ETA columns as given, since the authority matches on them", () => {
    const preview = previewItemImport(
      [row({ etaCodeType: "EGS", etaItemCode: "EG-123456789-001", gpcCode: "10000123" })],
      new Set(),
      idFor,
    );
    expect(preview.valid[0]?.item).toMatchObject({
      etaCodeType: "EGS",
      etaItemCode: "EG-123456789-001",
      gpcCode: "10000123",
    });
  });

  it("defaults the ETA columns to null rather than to an empty string", () => {
    const preview = previewItemImport([row()], new Set(), idFor);
    expect(preview.valid[0]?.item).toMatchObject({ etaCodeType: null, etaItemCode: null, gpcCode: null });
  });

  it("keeps the good rows when some are bad, and reports the file's row numbers", () => {
    const preview = previewItemImport(
      [row({ rowNumber: 5 }), row({ rowNumber: 6, code: "" }), row({ rowNumber: 7, code: "IT-007" })],
      new Set(),
      idFor,
    );
    expect(preview.valid.map((v) => v.rowNumber)).toEqual([5, 7]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([6]);
  });

  it("returns nothing for an empty file", () => {
    expect(previewItemImport([], new Set(), idFor)).toEqual({ valid: [], errors: [] });
  });
});
