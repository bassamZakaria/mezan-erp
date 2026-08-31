import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { previewSupplierImport, type SupplierImportRowInput } from "./import-suppliers.js";

function row(overrides: Partial<SupplierImportRowInput> = {}): SupplierImportRowInput {
  return {
    rowNumber: 1,
    code: "SUP-001",
    nameAr: "مصنع النور للتوريدات",
    ...overrides,
  };
}

const idFor = (r: SupplierImportRowInput) => `id-${r.code.trim()}`;

describe("previewSupplierImport", () => {
  it("accepts a minimal row and builds a real supplier through the create path", () => {
    const preview = previewSupplierImport([row()], new Set(), idFor);
    expect(preview.errors).toEqual([]);
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0]?.supplier).toMatchObject({
      id: "id-SUP-001",
      code: "SUP-001",
      nameAr: "مصنع النور للتوريدات",
      paymentTermsDays: 30,
      currency: "EGP",
      active: true,
    });
  });

  it("carries every optional column through to the supplier record", () => {
    const preview = previewSupplierImport(
      [
        row({
          nameEn: "Al-Nour Supplies",
          phone: "01000000000",
          email: "sales@alnour.example",
          contactPerson: "أحمد",
          taxNumber: "100-200-300",
          category: "خامات",
          notes: "مورد رئيسي",
          paymentTermsDays: 45,
          currency: "USD",
          addressCity: "القاهرة",
          addressDistrict: "مدينة نصر",
          addressStreet: "شارع مصطفى النحاس",
        }),
      ],
      new Set(),
      idFor,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.valid[0]?.supplier).toMatchObject({
      nameEn: "Al-Nour Supplies",
      phone: "01000000000",
      email: "sales@alnour.example",
      contactPerson: "أحمد",
      taxNumber: "100-200-300",
      category: "خامات",
      notes: "مورد رئيسي",
      paymentTermsDays: 45,
      currency: "USD",
      addressCity: "القاهرة",
      addressDistrict: "مدينة نصر",
      addressStreet: "شارع مصطفى النحاس",
    });
  });

  it("carries the opening balance through as an exact amount", () => {
    const preview = previewSupplierImport([row({ openingBalance: Money.fromMajor("1250.50") })], new Set(), idFor);
    expect(preview.valid[0]?.supplier.openingBalance.toString()).toBe("1250.500000");
  });

  it("defaults an omitted opening balance to zero rather than leaving it undefined", () => {
    const preview = previewSupplierImport([row()], new Set(), idFor);
    expect(preview.valid[0]?.supplier.openingBalance.toString()).toBe("0.000000");
  });

  it("refuses a row with no code, in Arabic", () => {
    const preview = previewSupplierImport([row({ code: "   " })], new Set(), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons).toContain("كود المورد مطلوب");
  });

  it("refuses a row with no name, in Arabic", () => {
    const preview = previewSupplierImport([row({ nameAr: "  " })], new Set(), idFor);
    expect(preview.errors[0]?.reasons).toContain("اسم المورد مطلوب");
  });

  it("refuses a code the tenant already holds, naming it", () => {
    const preview = previewSupplierImport([row()], new Set(["SUP-001"]), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons[0]).toContain("SUP-001");
    expect(preview.errors[0]?.reasons[0]).toContain("مستخدم بالفعل");
  });

  it("refuses the same code twice inside one file, and keeps the first", () => {
    const preview = previewSupplierImport([row(), row({ rowNumber: 2 })], new Set(), idFor);
    expect(preview.valid.map((v) => v.rowNumber)).toEqual([1]);
    expect(preview.errors[0]?.reasons[0]).toContain("مكرر داخل الملف");
  });

  it("trims the code before comparing it, so a padded cell is still a duplicate", () => {
    const preview = previewSupplierImport([row({ code: "  SUP-001 " })], new Set(["SUP-001"]), idFor);
    expect(preview.errors).toHaveLength(1);
  });

  it("collects a missing code and a missing name as two reasons on one row", () => {
    const preview = previewSupplierImport([row({ code: "", nameAr: "" })], new Set(), idFor);
    expect(preview.errors[0]?.reasons).toHaveLength(2);
  });

  it("surfaces the create path's own validation as row reasons rather than throwing", () => {
    const preview = previewSupplierImport([row({ code: "SUP 001!" })], new Set(), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.rowNumber).toBe(1);
    expect(preview.errors[0]?.reasons[0]).toContain("الكود");
  });

  it("surfaces a negative payment term as a row reason, not a crash", () => {
    const preview = previewSupplierImport([row({ paymentTermsDays: -5 })], new Set(), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons).toContain("مدة السداد يجب أن تكون رقمًا صحيحًا غير سالب");
  });

  it("keeps the good rows when some are bad", () => {
    const preview = previewSupplierImport(
      [row({ rowNumber: 1 }), row({ rowNumber: 2, code: "" }), row({ rowNumber: 3, code: "SUP-003" })],
      new Set(),
      idFor,
    );
    expect(preview.valid.map((v) => v.rowNumber)).toEqual([1, 3]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([2]);
  });

  it("reports the file's own row number, so the operator can find the line", () => {
    const preview = previewSupplierImport([row({ rowNumber: 128, code: "" })], new Set(), idFor);
    expect(preview.errors[0]?.rowNumber).toBe(128);
  });

  it("returns nothing for an empty file", () => {
    expect(previewSupplierImport([], new Set(), idFor)).toEqual({ valid: [], errors: [] });
  });

  it("asks the caller for an id per row rather than inventing one", () => {
    const seen: string[] = [];
    previewSupplierImport([row(), row({ rowNumber: 2, code: "SUP-002" })], new Set(), (r) => {
      seen.push(r.code);
      return `id-${r.code}`;
    });
    expect(seen).toEqual(["SUP-001", "SUP-002"]);
  });
});
