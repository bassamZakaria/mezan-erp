import { describe, it, expect } from "vitest";
import {
  taxCalculationTypeSchema,
  taxRateStatusSchema,
  etaVatSubTypeSchema,
  taxRateSchema,
  createTaxRateSchema,
  updateTaxRateSchema,
  taxGroupMemberSchema,
  upsertTaxGroupSchema,
  taxGroupComponentSchema,
  taxGroupSchema,
} from "./tax-rate.js";

describe("taxCalculationTypeSchema", () => {
  it("accepts exclusive and inclusive", () => {
    expect(taxCalculationTypeSchema.safeParse("exclusive").success).toBe(true);
    expect(taxCalculationTypeSchema.safeParse("inclusive").success).toBe(true);
  });

  it("rejects a type outside the enum", () => {
    expect(taxCalculationTypeSchema.safeParse("zero_rated").success).toBe(false);
  });
});

describe("etaVatSubTypeSchema", () => {
  it("accepts auto and each Vnnn code", () => {
    for (const code of ["auto", "V001", "V009"]) {
      expect(etaVatSubTypeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("rejects a code outside the enum", () => {
    expect(etaVatSubTypeSchema.safeParse("V010").success).toBe(false);
  });
});

describe("taxRateSchema", () => {
  const taxRate = {
    id: "tax-1",
    code: "VAT14",
    name: "ضريبة القيمة المضافة 14%",
    rate: 14,
    calculationType: "exclusive" as const,
    isDefault: true,
    outputTaxAccountId: null,
    inputTaxAccountId: null,
    etaSubType: "V001" as const,
    status: "active" as const,
  };

  it("accepts a minimal valid tax rate and preserves every field verbatim", () => {
    const result = taxRateSchema.safeParse(taxRate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(taxRate);
  });

  it("rejects a tax rate missing rate", () => {
    const { rate, ...rest } = taxRate;
    const result = taxRateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rate");
  });

  it("accepts a rate outside 0-100 — range is enforced by the domain (InvalidTaxRateError), not this wire schema", () => {
    expect(taxRateSchema.safeParse({ ...taxRate, rate: 150 }).success).toBe(true);
    expect(taxRateSchema.safeParse({ ...taxRate, rate: -5 }).success).toBe(true);
  });

  it("rejects rate sent as a decimal string instead of a number — unlike money fields, tax rate is a plain number", () => {
    const result = taxRateSchema.safeParse({ ...taxRate, rate: "14" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum etaSubType", () => {
    const result = taxRateSchema.safeParse({ ...taxRate, etaSubType: "V010" });
    expect(result.success).toBe(false);
  });
});

describe("createTaxRateSchema", () => {
  const create = { id: "tax-1", code: "VAT14", name: "ضريبة القيمة المضافة 14%", rate: 14 };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createTaxRateSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing rate", () => {
    const { rate, ...rest } = create;
    const result = createTaxRateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rate");
  });
});

describe("updateTaxRateSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateTaxRateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateTaxRateSchema.safeParse({ rate: 15 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ rate: 15 });
  });

  it("rejects an out-of-enum status when supplied", () => {
    const result = updateTaxRateSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("taxGroupMemberSchema", () => {
  it("accepts a minimal valid member and defaults compounding to false", () => {
    const result = taxGroupMemberSchema.safeParse({ taxRateId: "tax-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.compounding).toBe(false);
  });

  it("preserves an explicit compounding:true", () => {
    const result = taxGroupMemberSchema.safeParse({ taxRateId: "tax-1", compounding: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.compounding).toBe(true);
  });

  it("rejects a member missing taxRateId", () => {
    const result = taxGroupMemberSchema.safeParse({ compounding: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("taxRateId");
  });
});

describe("upsertTaxGroupSchema", () => {
  const group = {
    id: "tg-1",
    code: "VAT+WHT",
    nameAr: "ضريبة مركبة",
    members: [{ taxRateId: "tax-1", compounding: false }],
  };

  it("accepts a minimal valid group and preserves every field verbatim", () => {
    const result = upsertTaxGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(group);
  });

  it("rejects a group with zero members", () => {
    const result = upsertTaxGroupSchema.safeParse({ ...group, members: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("members");
  });

  it("rejects a group missing code", () => {
    const { code, ...rest } = group;
    const result = upsertTaxGroupSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("code");
  });
});

describe("taxGroupComponentSchema", () => {
  const component = { taxRateId: "tax-1", ratePercent: 14, compounding: false, effectivePercent: 14 };

  it("accepts a minimal valid component and preserves every field verbatim", () => {
    const result = taxGroupComponentSchema.safeParse(component);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(component);
  });

  it("rejects a component missing effectivePercent", () => {
    const { effectivePercent, ...rest } = component;
    const result = taxGroupComponentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("effectivePercent");
  });
});

describe("taxGroupSchema", () => {
  const group = {
    id: "tg-1",
    code: "VAT+WHT",
    nameAr: "ضريبة مركبة",
    nameEn: null,
    members: [{ taxRateId: "tax-1", compounding: false }],
    status: "active" as const,
    components: [{ taxRateId: "tax-1", ratePercent: 14, compounding: false, effectivePercent: 14 }],
    effectivePercent: 14,
  };

  it("accepts a minimal valid group and preserves every field verbatim, never melting components into one total", () => {
    const result = taxGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(group);
      expect(result.data.components).toHaveLength(1);
    }
  });

  it("rejects a group missing components", () => {
    const { components, ...rest } = group;
    const result = taxGroupSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("components");
  });
});

describe("the closed sets a tax rate is described in have one listing (D79 round 5)", () => {
  it("accepts on the wire exactly the values the enums hold, and nothing else", async () => {
    const { EtaVatSubTypeCode, TaxCalculationTypeCode, TaxRateStatusCode, etaVatSubTypeSchema, taxCalculationTypeSchema, taxRateStatusSchema } = await import("./tax-rate.js");
    expect(etaVatSubTypeSchema.options).toEqual(Object.values(EtaVatSubTypeCode));
    expect(taxRateStatusSchema.options).toEqual(Object.values(TaxRateStatusCode));
    expect(taxCalculationTypeSchema.options).toEqual(Object.values(TaxCalculationTypeCode));
    expect(etaVatSubTypeSchema.safeParse("V010").success).toBe(false);
  });

  it("is the same enum object the domain exports", async () => {
    const contracts = await import("./tax-rate.js");
    const domain = await import("@mezan/domain");
    expect(domain.EtaVatSubTypeCode).toBe(contracts.EtaVatSubTypeCode);
    expect(domain.TaxRateStatusCode).toBe(contracts.TaxRateStatusCode);
    expect(domain.TaxClassificationFilingOutcome).toBe(contracts.TaxClassificationFilingOutcomeCode);
  });
});
