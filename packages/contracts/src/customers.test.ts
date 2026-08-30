import { describe, it, expect } from "vitest";
import { etaBuyerTypeSchema, customerSchema, createCustomerSchema, updateCustomerSchema } from "./customers.js";

describe("etaBuyerTypeSchema", () => {
  it("accepts each known buyer type", () => {
    for (const type of ["auto", "business", "individual"]) {
      expect(etaBuyerTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects a buyer type outside the enum", () => {
    expect(etaBuyerTypeSchema.safeParse("government").success).toBe(false);
  });
});

describe("customerSchema", () => {
  const customer = {
    id: "cust-1",
    code: "CUST-001",
    nameAr: "شركة النور للتجارة",
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
    priceListId: null,
    creditLimit: "50000.000000",
    taxExempt: false,
    etaBuyerType: "business" as const,
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  };

  it("accepts a minimal valid customer and preserves every field verbatim", () => {
    const result = customerSchema.safeParse(customer);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(customer);
  });

  it("rejects a customer missing nameAr", () => {
    const { nameAr, ...rest } = customer;
    const result = customerSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("rejects a customer missing etaBuyerType", () => {
    const { etaBuyerType, ...rest } = customer;
    const result = customerSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("etaBuyerType");
  });

  it("never coerces creditLimit to a float — high-precision decimal string survives verbatim", () => {
    const result = customerSchema.safeParse({ ...customer, creditLimit: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.creditLimit).toBe("0.100001");
  });

  it("rejects creditLimit sent as a JS number instead of a string", () => {
    const result = customerSchema.safeParse({ ...customer, creditLimit: 50000 });
    expect(result.success).toBe(false);
  });

  it("never coerces openingBalance to a float — high-precision decimal string survives verbatim", () => {
    const result = customerSchema.safeParse({ ...customer, openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects a negative paymentTermsDays", () => {
    const result = customerSchema.safeParse({ ...customer, paymentTermsDays: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum etaBuyerType", () => {
    const result = customerSchema.safeParse({ ...customer, etaBuyerType: "government" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised salesRepId — a real dimension a caller could lose", () => {
    const result = customerSchema.safeParse({ ...customer, salesRepId: "rep-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("salesRepId");
  });
});

describe("createCustomerSchema", () => {
  const create = { id: "cust-1", code: "CUST-001", nameAr: "شركة النور للتجارة" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createCustomerSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createCustomerSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("never coerces creditLimit to a float when supplied", () => {
    const result = createCustomerSchema.safeParse({ ...create, creditLimit: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.creditLimit).toBe("0.100001");
  });

  it("rejects creditLimit sent as a JS number instead of a string", () => {
    const result = createCustomerSchema.safeParse({ ...create, creditLimit: 100 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum etaBuyerType when supplied", () => {
    const result = createCustomerSchema.safeParse({ ...create, etaBuyerType: "government" });
    expect(result.success).toBe(false);
  });
});

describe("updateCustomerSchema", () => {
  it("accepts a partial payload with a single field", () => {
    const result = updateCustomerSchema.safeParse({ creditLimit: "60000.000000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ creditLimit: "60000.000000" });
  });

  it("accepts an empty payload — every field is optional on update", () => {
    const result = updateCustomerSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("strips id — id is omitted from the update schema entirely", () => {
    const result = updateCustomerSchema.safeParse({ id: "cust-2" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });

  it("rejects creditLimit sent as a JS number instead of a string", () => {
    const result = updateCustomerSchema.safeParse({ creditLimit: 100 });
    expect(result.success).toBe(false);
  });
});
