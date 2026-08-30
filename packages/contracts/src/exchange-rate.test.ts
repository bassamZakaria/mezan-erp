import { describe, it, expect } from "vitest";
import {
  exchangeRateTypeSchema,
  exchangeRateSourceSchema,
  exchangeRateStatusSchema,
  exchangeRateSchema,
  createExchangeRateSchema,
} from "./exchange-rate.js";

describe("exchangeRateTypeSchema", () => {
  it("accepts each known rate type", () => {
    for (const type of ["standard", "buy", "sell"]) {
      expect(exchangeRateTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects a rate type outside the enum", () => {
    expect(exchangeRateTypeSchema.safeParse("mid").success).toBe(false);
  });
});

describe("exchangeRateSourceSchema", () => {
  it("accepts each known source", () => {
    for (const source of ["manual", "api"]) {
      expect(exchangeRateSourceSchema.safeParse(source).success).toBe(true);
    }
  });

  it("rejects a source outside the enum", () => {
    expect(exchangeRateSourceSchema.safeParse("import").success).toBe(false);
  });
});

describe("exchangeRateStatusSchema", () => {
  it("accepts each known status", () => {
    for (const status of ["pending", "approved", "locked"]) {
      expect(exchangeRateStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(exchangeRateStatusSchema.safeParse("rejected").success).toBe(false);
  });
});

describe("exchangeRateSchema", () => {
  const rate = {
    id: "fx-1",
    currency: "USD",
    rate: "49.123456",
    effectiveDate: "2026-08-30",
    rateType: "standard" as const,
    source: "manual" as const,
    status: "approved" as const,
  };

  it("accepts a minimal valid rate and preserves every field verbatim", () => {
    const result = exchangeRateSchema.safeParse(rate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(rate);
  });

  it("rejects a rate missing currency", () => {
    const { currency, ...rest } = rate;
    const result = exchangeRateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("currency");
  });

  it("rejects a rate missing rateType", () => {
    const { rateType, ...rest } = rate;
    const result = exchangeRateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rateType");
  });

  it("never coerces rate to a float — high-precision decimal string survives verbatim", () => {
    const result = exchangeRateSchema.safeParse({ ...rate, rate: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rate).toBe("0.100001");
  });

  it("rejects a rate sent as a JS number instead of a string", () => {
    const result = exchangeRateSchema.safeParse({ ...rate, rate: 49.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum rateType", () => {
    const result = exchangeRateSchema.safeParse({ ...rate, rateType: "mid" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = exchangeRateSchema.safeParse({ ...rate, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("createExchangeRateSchema", () => {
  const create = {
    id: "fx-1",
    currency: "USD",
    rate: "49.123456",
    effectiveDate: "2026-08-30",
  };

  it("accepts a minimal valid payload with optional fields omitted", () => {
    const result = createExchangeRateSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing rate", () => {
    const { rate, ...rest } = create;
    const result = createExchangeRateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rate");
  });

  it("rejects a payload missing effectiveDate", () => {
    const { effectiveDate, ...rest } = create;
    const result = createExchangeRateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("effectiveDate");
  });

  it("never coerces rate to a float — high-precision decimal string survives verbatim", () => {
    const result = createExchangeRateSchema.safeParse({ ...create, rate: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rate).toBe("0.100001");
  });

  it("rejects a rate sent as a JS number instead of a string", () => {
    const result = createExchangeRateSchema.safeParse({ ...create, rate: 49.12 });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit optional status alongside the required fields", () => {
    const result = createExchangeRateSchema.safeParse({ ...create, status: "pending" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("pending");
  });

  it("rejects an out-of-enum status when one is supplied", () => {
    const result = createExchangeRateSchema.safeParse({ ...create, status: "rejected" });
    expect(result.success).toBe(false);
  });
});
