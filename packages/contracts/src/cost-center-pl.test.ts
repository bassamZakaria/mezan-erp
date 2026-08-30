import { describe, it, expect } from "vitest";
import { costCenterPnLRowSchema, costCenterPnLReportSchema } from "./cost-center-pl.js";

describe("costCenterPnLRowSchema", () => {
  const row = {
    costCenterId: "cc-1",
    code: "CC-001",
    name: "التسويق",
    revenue: "10000.123456",
    expense: "4000.000001",
    profit: "6000.123455",
  };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = costCenterPnLRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("accepts a null costCenterId for the unassigned bucket", () => {
    const result = costCenterPnLRowSchema.safeParse({ ...row, costCenterId: null });
    expect(result.success).toBe(true);
  });

  it("rejects a row missing revenue", () => {
    const { revenue, ...rest } = row;
    const result = costCenterPnLRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("revenue");
  });

  it("rejects a row missing name", () => {
    const { name, ...rest } = row;
    const result = costCenterPnLRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });

  it("never coerces revenue to a float — high-precision decimal string survives verbatim", () => {
    const result = costCenterPnLRowSchema.safeParse({ ...row, revenue: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.revenue).toBe("0.100001");
  });

  it("rejects a revenue sent as a JS number instead of a string", () => {
    const result = costCenterPnLRowSchema.safeParse({ ...row, revenue: 10000.12 });
    expect(result.success).toBe(false);
  });
});

describe("costCenterPnLReportSchema", () => {
  const row = {
    costCenterId: "cc-1",
    code: "CC-001",
    name: "التسويق",
    revenue: "10000.123456",
    expense: "4000.000001",
    profit: "6000.123455",
  };
  const report = {
    rows: [row],
    totals: { revenue: "10000.123456", expense: "4000.000001", profit: "6000.123455" },
  };

  it("accepts a minimal valid report and preserves every field verbatim", () => {
    const result = costCenterPnLReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(report);
  });

  it("accepts an empty rows array with zeroed totals", () => {
    const result = costCenterPnLReportSchema.safeParse({
      rows: [],
      totals: { revenue: "0", expense: "0", profit: "0" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a report missing totals", () => {
    const { totals, ...rest } = report;
    const result = costCenterPnLReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("totals");
  });

  it("rejects a report missing rows", () => {
    const { rows, ...rest } = report;
    const result = costCenterPnLReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rows");
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = costCenterPnLReportSchema.safeParse({ ...report, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
