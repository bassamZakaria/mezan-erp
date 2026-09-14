import { describe, it, expect } from "vitest";
import { supplierSchema, createSupplierSchema, updateSupplierSchema } from "./suppliers.js";

describe("supplierSchema", () => {
  const supplier = {
    id: "sup-1",
    code: "SUP-001",
    nameAr: "شركة التوريدات المصرية",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "10000.123456",
    active: true,
    addressCity: null,
    addressDistrict: null,
    addressStreet: null,
    bankAccount: null,
  };

  it("accepts a minimal valid supplier and preserves every field verbatim", () => {
    const result = supplierSchema.safeParse(supplier);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(supplier);
  });

  it("rejects a supplier missing nameAr", () => {
    const { nameAr, ...rest } = supplier;
    const result = supplierSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("rejects a supplier missing currency", () => {
    const { currency, ...rest } = supplier;
    const result = supplierSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("currency");
  });

  it("never coerces openingBalance to a float — high-precision decimal string survives verbatim", () => {
    const result = supplierSchema.safeParse({ ...supplier, openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects openingBalance sent as a JS number instead of a string", () => {
    const result = supplierSchema.safeParse({ ...supplier, openingBalance: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative paymentTermsDays", () => {
    const result = supplierSchema.safeParse({ ...supplier, paymentTermsDays: -1 });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised withholdingTaxRateId — a real dimension a caller could lose", () => {
    const result = supplierSchema.safeParse({ ...supplier, withholdingTaxRateId: "wht-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("withholdingTaxRateId");
  });
});

describe("createSupplierSchema", () => {
  const create = { id: "sup-1", code: "SUP-001", nameAr: "شركة التوريدات المصرية" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createSupplierSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createSupplierSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("never coerces openingBalance to a float when supplied", () => {
    const result = createSupplierSchema.safeParse({ ...create, openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects a negative paymentTermsDays when supplied", () => {
    const result = createSupplierSchema.safeParse({ ...create, paymentTermsDays: -5 });
    expect(result.success).toBe(false);
  });
});

describe("updateSupplierSchema", () => {
  it("accepts a partial payload with a single field", () => {
    const result = updateSupplierSchema.safeParse({ category: "raw-materials" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ category: "raw-materials" });
  });

  it("accepts an empty payload — every field is optional on update", () => {
    const result = updateSupplierSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("strips id — id is omitted from the update schema entirely", () => {
    const result = updateSupplierSchema.safeParse({ id: "sup-2" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });
});
