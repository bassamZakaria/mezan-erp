import { describe, it, expect } from "vitest";
import {
  dashboardCountsSchema,
  dashboardGlSchema,
  dashboardActivitySchema,
  dashboardSummarySchema,
} from "./dashboard.js";

describe("dashboardCountsSchema", () => {
  const counts = { accounts: 10, customers: 20, suppliers: 5, items: 100, users: 3, journalEntries: 50 };

  it("accepts a minimal valid counts object and preserves every field verbatim", () => {
    const result = dashboardCountsSchema.safeParse(counts);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(counts);
  });

  it("accepts an all-zero tenant", () => {
    const zeros = { accounts: 0, customers: 0, suppliers: 0, items: 0, users: 0, journalEntries: 0 };
    expect(dashboardCountsSchema.safeParse(zeros).success).toBe(true);
  });

  it("rejects a missing field", () => {
    const { accounts, ...rest } = counts;
    const result = dashboardCountsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("accounts");
  });

  it("rejects a negative count", () => {
    const result = dashboardCountsSchema.safeParse({ ...counts, accounts: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer count", () => {
    const result = dashboardCountsSchema.safeParse({ ...counts, accounts: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("dashboardGlSchema", () => {
  const gl = {
    revenue: "100000.123456",
    expenses: "40000.000001",
    netProfit: "60000.123455",
    cash: "20000.000000",
    receivables: "15000.000000",
    payables: "5000.000000",
    inventoryValue: "30000.000000",
  };

  it("accepts a minimal valid gl summary and preserves every field verbatim", () => {
    const result = dashboardGlSchema.safeParse(gl);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(gl);
  });

  it("never coerces revenue to a float — high-precision decimal string survives verbatim", () => {
    const result = dashboardGlSchema.safeParse({ ...gl, revenue: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.revenue).toBe("0.100001");
  });

  it("rejects revenue sent as a JS number instead of a string", () => {
    const result = dashboardGlSchema.safeParse({ ...gl, revenue: 100000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a gl summary missing netProfit", () => {
    const { netProfit, ...rest } = gl;
    const result = dashboardGlSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("netProfit");
  });
});

describe("dashboardActivitySchema", () => {
  const activity = { id: "je-1", entryNo: "JE-2026-001", date: "2026-08-30", memo: "sales invoice posted" };

  it("accepts a minimal valid activity row and preserves every field verbatim", () => {
    const result = dashboardActivitySchema.safeParse(activity);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(activity);
  });

  it("accepts a null entryNo", () => {
    const result = dashboardActivitySchema.safeParse({ ...activity, entryNo: null });
    expect(result.success).toBe(true);
  });

  it("rejects an activity row missing memo", () => {
    const { memo, ...rest } = activity;
    const result = dashboardActivitySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("memo");
  });
});

describe("dashboardSummarySchema", () => {
  const summary = {
    generatedAt: "2026-08-30T10:00:00.000Z",
    counts: { accounts: 10, customers: 20, suppliers: 5, items: 100, users: 3, journalEntries: 50 },
    gl: {
      revenue: "100000.000000",
      expenses: "40000.000000",
      netProfit: "60000.000000",
      cash: "20000.000000",
      receivables: "15000.000000",
      payables: "5000.000000",
      inventoryValue: "30000.000000",
    },
    recentActivity: [{ id: "je-1", entryNo: "JE-2026-001", date: "2026-08-30", memo: "sales invoice posted" }],
  };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = dashboardSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("accepts an empty recentActivity array for an empty tenant", () => {
    const result = dashboardSummarySchema.safeParse({ ...summary, recentActivity: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a summary missing counts", () => {
    const { counts, ...rest } = summary;
    const result = dashboardSummarySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("counts");
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = dashboardSummarySchema.safeParse({ ...summary, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
