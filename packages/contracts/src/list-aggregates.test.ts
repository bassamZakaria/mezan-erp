import { describe, it, expect } from "vitest";
import { listCountsSchema, listStatsSchema } from "./list-aggregates.js";

describe("listCountsSchema", () => {
  it("accepts a record of status code to count and preserves it verbatim", () => {
    const counts = { draft: 3, posted: 12, void: 0 };
    const result = listCountsSchema.safeParse(counts);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(counts);
  });

  it("accepts an empty record", () => {
    const result = listCountsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects a count sent as a decimal-string instead of a number", () => {
    const result = listCountsSchema.safeParse({ draft: "3" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object payload", () => {
    const result = listCountsSchema.safeParse([1, 2, 3]);
    expect(result.success).toBe(false);
  });
});

describe("listStatsSchema", () => {
  it("accepts a numeric stat and preserves it verbatim", () => {
    const stats = { openOrders: 7 };
    const result = listStatsSchema.safeParse(stats);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(stats);
  });

  it("accepts a money total as a decimal string and never coerces it to a float", () => {
    const stats = { totalDue: "10000.123456" };
    const result = listStatsSchema.safeParse(stats);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalDue).toBe("10000.123456");
  });

  it("keeps a '0.1'-style decimal string exact, never Number()-parsed", () => {
    const result = listStatsSchema.safeParse({ average: "0.1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.average).toBe("0.1");
  });

  it("rejects a stat value that is neither a number nor a string", () => {
    const result = listStatsSchema.safeParse({ totalDue: { amount: 100 } });
    expect(result.success).toBe(false);
  });
});
