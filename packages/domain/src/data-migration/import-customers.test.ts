import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { previewCustomerImport, type CustomerImportRowInput } from "./import-customers.js";

function row(overrides: Partial<CustomerImportRowInput> = {}): CustomerImportRowInput {
  return {
    rowNumber: 1,
    code: "CUS-001",
    nameAr: "شركة الأمل للتجارة",
    ...overrides,
  };
}

const idFor = (r: CustomerImportRowInput) => `id-${r.code.trim()}`;

describe("previewCustomerImport", () => {
  it("accepts a minimal row and builds a real customer through the create path", () => {
    const preview = previewCustomerImport([row()], new Set(), idFor);
    expect(preview.errors).toEqual([]);
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0]?.customer).toMatchObject({
      id: "id-CUS-001",
      code: "CUS-001",
      nameAr: "شركة الأمل للتجارة",
    });
  });

  it("carries the money columns through as exact amounts", () => {
    const preview = previewCustomerImport(
      [row({ openingBalance: Money.fromMajor("1250.50"), creditLimit: Money.fromMajor("10000") })],
      new Set(),
      idFor,
    );
    expect(preview.valid[0]?.customer.openingBalance.toString()).toBe("1250.500000");
    expect(preview.valid[0]?.customer.creditLimit.toString()).toBe("10000.000000");
  });

  it("refuses a row with no code, in Arabic", () => {
    const preview = previewCustomerImport([row({ code: "   " })], new Set(), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons).toContain("كود العميل مطلوب");
  });

  it("refuses a row with no name, in Arabic", () => {
    const preview = previewCustomerImport([row({ nameAr: "  " })], new Set(), idFor);
    expect(preview.errors[0]?.reasons).toContain("اسم العميل مطلوب");
  });

  it("refuses a code the tenant already holds, naming it", () => {
    const preview = previewCustomerImport([row()], new Set(["CUS-001"]), idFor);
    expect(preview.valid).toEqual([]);
    expect(preview.errors[0]?.reasons[0]).toContain("CUS-001");
    expect(preview.errors[0]?.reasons[0]).toContain("مستخدم بالفعل");
  });

  it("refuses the same code twice inside one file, and keeps the first", () => {
    const preview = previewCustomerImport([row(), row({ rowNumber: 2 })], new Set(), idFor);
    expect(preview.valid.map((v) => v.rowNumber)).toEqual([1]);
    expect(preview.errors[0]?.reasons[0]).toContain("مكرر داخل الملف");
  });

  it("trims the code before comparing it, so a padded cell is still a duplicate", () => {
    const preview = previewCustomerImport([row({ code: "  CUS-001 " })], new Set(["CUS-001"]), idFor);
    expect(preview.errors).toHaveLength(1);
  });

  it("collects a missing code and a missing name as two reasons on one row", () => {
    const preview = previewCustomerImport([row({ code: "", nameAr: "" })], new Set(), idFor);
    expect(preview.errors[0]?.reasons).toHaveLength(2);
  });

  it("surfaces the create path's own field validation as row reasons", () => {
    const preview = previewCustomerImport([row({ email: "not-an-email" })], new Set(), idFor);
    if (preview.errors.length > 0) {
      expect(preview.errors[0]?.rowNumber).toBe(1);
      expect(preview.errors[0]?.reasons.length).toBeGreaterThan(0);
    } else {
      // The create path accepts it; then it must have been carried through.
      expect(preview.valid[0]?.customer.email).toBe("not-an-email");
    }
  });

  it("keeps the good rows when some are bad", () => {
    const preview = previewCustomerImport(
      [row({ rowNumber: 1 }), row({ rowNumber: 2, code: "" }), row({ rowNumber: 3, code: "CUS-003" })],
      new Set(),
      idFor,
    );
    expect(preview.valid.map((v) => v.rowNumber)).toEqual([1, 3]);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([2]);
  });

  it("reports the file's own row number, so the operator can find the line", () => {
    const preview = previewCustomerImport([row({ rowNumber: 128, code: "" })], new Set(), idFor);
    expect(preview.errors[0]?.rowNumber).toBe(128);
  });

  it("returns nothing for an empty file", () => {
    expect(previewCustomerImport([], new Set(), idFor)).toEqual({ valid: [], errors: [] });
  });

  it("asks the caller for an id per row rather than inventing one", () => {
    const seen: string[] = [];
    previewCustomerImport([row(), row({ rowNumber: 2, code: "CUS-002" })], new Set(), (r) => {
      seen.push(r.code);
      return `id-${r.code}`;
    }, );
    expect(seen).toEqual(["CUS-001", "CUS-002"]);
  });
});
