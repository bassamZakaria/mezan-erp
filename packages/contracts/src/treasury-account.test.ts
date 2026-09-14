import { describe, it, expect } from "vitest";
import {
  treasuryAccountTypeSchema,
  treasuryAccountStatusSchema,
  treasuryAccountSchema,
  createTreasuryAccountSchema,
  updateTreasuryAccountSchema,
} from "./treasury-account.js";

describe("treasuryAccountTypeSchema", () => {
  it("accepts cash and bank", () => {
    expect(treasuryAccountTypeSchema.safeParse("cash").success).toBe(true);
    expect(treasuryAccountTypeSchema.safeParse("bank").success).toBe(true);
  });

  it("rejects a type outside the enum", () => {
    expect(treasuryAccountTypeSchema.safeParse("wallet").success).toBe(false);
  });
});

describe("treasuryAccountSchema", () => {
  const account = {
    id: "ta-1",
    code: "CASH-01",
    name: "خزينة رئيسية",
    nameEn: null,
    type: "cash" as const,
    currency: "EGP",
    branchId: "branch-1",
    glAccountId: null,
    openingBalance: "10000.123456",
    openingBalanceDate: "2026-01-01",
    guaranteeFacilityLimit: null,
    status: "active" as const,
  };

  it("accepts a minimal valid account and preserves every field verbatim", () => {
    const result = treasuryAccountSchema.safeParse(account);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(account);
  });

  it("rejects an account missing branchId", () => {
    const { branchId, ...rest } = account;
    const result = treasuryAccountSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("rejects an account missing type", () => {
    const { type, ...rest } = account;
    const result = treasuryAccountSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("never coerces openingBalance to a float — high-precision decimal string survives verbatim", () => {
    const result = treasuryAccountSchema.safeParse({ ...account, openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects openingBalance sent as a JS number instead of a string", () => {
    const result = treasuryAccountSchema.safeParse({ ...account, openingBalance: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = treasuryAccountSchema.safeParse({ ...account, status: "frozen" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised costCenterId — a real dimension a caller could lose", () => {
    const result = treasuryAccountSchema.safeParse({ ...account, costCenterId: "cc-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });
});

describe("createTreasuryAccountSchema", () => {
  const create = { id: "ta-1", code: "CASH-01", name: "خزينة رئيسية", branchId: "branch-1" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createTreasuryAccountSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing branchId", () => {
    const { branchId, ...rest } = create;
    const result = createTreasuryAccountSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("never coerces openingBalance to a float when supplied", () => {
    const result = createTreasuryAccountSchema.safeParse({ ...create, openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects openingBalance sent as a JS number instead of a string", () => {
    const result = createTreasuryAccountSchema.safeParse({ ...create, openingBalance: 100 });
    expect(result.success).toBe(false);
  });
});

describe("updateTreasuryAccountSchema", () => {
  it("accepts a partial payload with a single field", () => {
    const result = updateTreasuryAccountSchema.safeParse({ name: "خزينة الفرع" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: "خزينة الفرع" });
  });

  it("accepts an empty payload — every field is optional on update", () => {
    const result = updateTreasuryAccountSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("never coerces openingBalance to a float when supplied", () => {
    const result = updateTreasuryAccountSchema.safeParse({ openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });

  it("rejects an out-of-enum status when supplied", () => {
    const result = updateTreasuryAccountSchema.safeParse({ status: "frozen" });
    expect(result.success).toBe(false);
  });
});
