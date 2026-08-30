import { describe, it, expect } from "vitest";
import {
  accountTypeSchema,
  naturalBalanceSchema,
  accountStatusSchema,
  accountSchema,
  createAccountSchema,
  updateAccountSchema,
  latePenaltyTreatmentSchema,
  accountRoutingOptionsSchema,
  accountRoutingSlotSchema,
  accountRoutingSchema,
  updateAccountRoutingSchema,
} from "./accounts.js";

describe("accountTypeSchema", () => {
  it("accepts each known account type", () => {
    for (const t of ["asset", "liability", "equity", "revenue", "expense"]) {
      expect(accountTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(accountTypeSchema.safeParse("contra").success).toBe(false);
  });
});

describe("accountSchema", () => {
  const account = {
    id: "acc-1",
    code: "1000",
    nameAr: "النقدية",
    nameEn: null,
    type: "asset" as const,
    naturalBalance: "debit" as const,
    parentId: null,
    isHeader: false,
    status: "active" as const,
  };

  it("accepts a minimal valid account and preserves every field verbatim", () => {
    const result = accountSchema.safeParse(account);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(account);
  });

  it("rejects an account missing naturalBalance", () => {
    const { naturalBalance, ...rest } = account;
    const result = accountSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("naturalBalance");
  });

  it("rejects an out-of-enum naturalBalance", () => {
    const result = accountSchema.safeParse({ ...account, naturalBalance: "both" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = accountSchema.safeParse({ ...account, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("createAccountSchema", () => {
  const create = { id: "acc-1", code: "1000", nameAr: "النقدية", type: "asset" as const, naturalBalance: "debit" as const, isHeader: false };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createAccountSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing isHeader", () => {
    const { isHeader, ...rest } = create;
    const result = createAccountSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("isHeader");
  });
});

describe("updateAccountSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateAccountSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status when supplied", () => {
    const result = updateAccountSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("accountRoutingOptionsSchema", () => {
  const options = { latePenaltyTreatment: "expense" as const, useSeparateDiscountAccount: true, applyDiscountAccountToLines: false };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = accountRoutingOptionsSchema.safeParse(options);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(options);
  });

  it("rejects an out-of-enum latePenaltyTreatment", () => {
    const result = accountRoutingOptionsSchema.safeParse({ ...options, latePenaltyTreatment: "ignore" });
    expect(result.success).toBe(false);
  });
});

describe("accountRoutingSlotSchema", () => {
  const slot = {
    key: "tax.output",
    section: "tax" as const,
    labelAr: "ضريبة المخرجات",
    labelEn: "Output Tax",
    defaultAccountId: "acc-tax-default",
    accountId: "acc-tax-default",
    overridden: false,
  };

  it("accepts a minimal valid slot and preserves every field verbatim", () => {
    const result = accountRoutingSlotSchema.safeParse(slot);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(slot);
  });

  it("rejects an out-of-enum section", () => {
    const result = accountRoutingSlotSchema.safeParse({ ...slot, section: "manufacturing" });
    expect(result.success).toBe(false);
  });
});

describe("accountRoutingSchema", () => {
  const routing = {
    slots: [
      {
        key: "tax.output",
        section: "tax" as const,
        labelAr: "ضريبة المخرجات",
        labelEn: "Output Tax",
        defaultAccountId: "acc-tax-default",
        accountId: "acc-tax-default",
        overridden: false,
      },
    ],
    options: { latePenaltyTreatment: "expense" as const, useSeparateDiscountAccount: true, applyDiscountAccountToLines: false },
  };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = accountRoutingSchema.safeParse(routing);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(routing);
  });

  it("rejects a payload missing options", () => {
    const { options, ...rest } = routing;
    const result = accountRoutingSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("options");
  });
});

describe("updateAccountRoutingSchema", () => {
  it("accepts an empty payload — both fields are optional", () => {
    const result = updateAccountRoutingSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a slot override mapped to null to clear it", () => {
    const result = updateAccountRoutingSchema.safeParse({ overrides: { "tax.output": null } });
    expect(result.success).toBe(true);
  });

  it("accepts a partial options patch", () => {
    const result = updateAccountRoutingSchema.safeParse({ options: { useSeparateDiscountAccount: true } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.options).toEqual({ useSeparateDiscountAccount: true });
  });

  it("rejects an overrides value that is not a string or null", () => {
    const result = updateAccountRoutingSchema.safeParse({ overrides: { "tax.output": 123 } });
    expect(result.success).toBe(false);
  });
});
