import { describe, it, expect } from "vitest";
import { fiscalPeriodStatusSchema, fiscalPeriodSchema, generateFiscalYearSchema } from "./fiscal-period.js";

describe("fiscalPeriodStatusSchema", () => {
  it("accepts each of the three known statuses", () => {
    for (const status of ["open", "closed", "locked"]) {
      expect(fiscalPeriodStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    const result = fiscalPeriodStatusSchema.safeParse("archived");
    expect(result.success).toBe(false);
  });
});

describe("fiscalPeriodSchema", () => {
  const period = {
    id: "fp-1",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open" as const,
  };

  it("accepts a minimal valid period and preserves every field verbatim", () => {
    const result = fiscalPeriodSchema.safeParse(period);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(period);
  });

  it("rejects a period missing year", () => {
    const { year, ...rest } = period;
    const result = fiscalPeriodSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("year");
  });

  it("rejects a period missing status", () => {
    const { status, ...rest } = period;
    const result = fiscalPeriodSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("status");
  });

  it("rejects periodNumber 0 and 13 — outside the 1-12 month range", () => {
    expect(fiscalPeriodSchema.safeParse({ ...period, periodNumber: 0 }).success).toBe(false);
    expect(fiscalPeriodSchema.safeParse({ ...period, periodNumber: 13 }).success).toBe(false);
  });

  it("rejects a non-integer year", () => {
    const result = fiscalPeriodSchema.safeParse({ ...period, year: 2026.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a status outside the enum", () => {
    const result = fiscalPeriodSchema.safeParse({ ...period, status: "archived" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = fiscalPeriodSchema.safeParse({ ...period, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("generateFiscalYearSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = generateFiscalYearSchema.safeParse({ year: 2027 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ year: 2027 });
  });

  it("rejects a payload missing year", () => {
    const result = generateFiscalYearSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("year");
  });

  it("rejects a non-integer year", () => {
    const result = generateFiscalYearSchema.safeParse({ year: 2027.1 });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised key", () => {
    const result = generateFiscalYearSchema.safeParse({ year: 2027, unknownField: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("unknownField");
  });
});
