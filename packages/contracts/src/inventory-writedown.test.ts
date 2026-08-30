import { describe, it, expect } from "vitest";
import { writedownRunStatusSchema, writedownRunLineSchema, writedownRunSchema, createWritedownRunSchema } from "./inventory-writedown.js";

describe("writedownRunStatusSchema", () => {
  it("accepts draft, posted and cancelled", () => {
    for (const s of ["draft", "posted", "cancelled"]) {
      expect(writedownRunStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(writedownRunStatusSchema.safeParse("reversed").success).toBe(false);
  });
});

describe("writedownRunLineSchema", () => {
  const line = {
    itemId: "item-1",
    warehouseId: "wh-1",
    onHandQty: "50.000000",
    unitCost: "20.123456",
    agingDays: 180,
    writedownRateBps: 500,
    amount: "201.234560",
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = writedownRunLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = writedownRunLineSchema.safeParse({ ...line, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = writedownRunLineSchema.safeParse({ ...line, amount: 201.23 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative agingDays", () => {
    const result = writedownRunLineSchema.safeParse({ ...line, agingDays: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative writedownRateBps", () => {
    const result = writedownRunLineSchema.safeParse({ ...line, writedownRateBps: -1 });
    expect(result.success).toBe(false);
  });
});

describe("writedownRunSchema", () => {
  const run = {
    id: "wr-1",
    period: "2026-08",
    warehouseId: null,
    status: "draft" as const,
    lines: [],
    totalAmount: "0",
    journalEntryId: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    postedAt: null,
  };

  it("accepts a minimal valid run and preserves every field verbatim", () => {
    const result = writedownRunSchema.safeParse(run);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(run);
  });

  it("rejects a malformed period — must be YYYY-MM", () => {
    expect(writedownRunSchema.safeParse({ ...run, period: "2026-8" }).success).toBe(false);
    expect(writedownRunSchema.safeParse({ ...run, period: "August 2026" }).success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = writedownRunSchema.safeParse({ ...run, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("createWritedownRunSchema", () => {
  it("accepts a minimal valid payload with warehouseId omitted (all warehouses)", () => {
    const result = createWritedownRunSchema.safeParse({ period: "2026-08" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ period: "2026-08" });
  });

  it("accepts an explicit warehouseId filter", () => {
    const result = createWritedownRunSchema.safeParse({ period: "2026-08", warehouseId: "wh-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed period", () => {
    const result = createWritedownRunSchema.safeParse({ period: "2026/08" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing period", () => {
    const result = createWritedownRunSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("period");
  });
});
