import { describe, it, expect } from "vitest";
import {
  fxRevaluationRequestSchema,
  fxRevaluationDetailSchema,
  fxRevaluationPreviewSchema,
  fxRevaluationPostResultSchema,
} from "./fx-revaluation.js";

describe("fxRevaluationRequestSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = fxRevaluationRequestSchema.safeParse({ date: "2026-08-31" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ date: "2026-08-31" });
  });

  it("accepts an explicit currency filter and autoReverse flag", () => {
    const payload = { date: "2026-08-31", currencies: ["USD", "EUR"], autoReverse: false };
    const result = fxRevaluationRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("rejects a payload missing date", () => {
    const result = fxRevaluationRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("date");
  });
});

describe("fxRevaluationDetailSchema", () => {
  const detail = {
    accountId: "acc-1",
    currency: "USD",
    label: "بنك أمريكي",
    foreignAmount: "1000.123456",
    bookedBase: "49000.000000",
    closingRate: "49.500000",
    revaluedBase: "49500.123456",
    delta: "500.123456",
    gainLoss: "500.123456",
  };

  it("accepts a minimal valid detail line and preserves every field verbatim", () => {
    const result = fxRevaluationDetailSchema.safeParse(detail);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(detail);
  });

  it("never coerces foreignAmount to a float — high-precision decimal string survives verbatim", () => {
    const result = fxRevaluationDetailSchema.safeParse({ ...detail, foreignAmount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.foreignAmount).toBe("0.100001");
  });

  it("rejects foreignAmount sent as a JS number instead of a string", () => {
    const result = fxRevaluationDetailSchema.safeParse({ ...detail, foreignAmount: 1000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a detail line missing gainLoss", () => {
    const { gainLoss, ...rest } = detail;
    const result = fxRevaluationDetailSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("gainLoss");
  });
});

describe("fxRevaluationPreviewSchema", () => {
  const preview = {
    date: "2026-08-31",
    autoReverse: true,
    reversalDate: "2026-09-01",
    details: [],
    totalGain: "500.123456",
    totalLoss: "0",
    hasImpact: true,
  };

  it("accepts a minimal valid preview and preserves every field verbatim", () => {
    const result = fxRevaluationPreviewSchema.safeParse(preview);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(preview);
  });

  it("rejects a preview missing hasImpact", () => {
    const { hasImpact, ...rest } = preview;
    const result = fxRevaluationPreviewSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("hasImpact");
  });

  it("never coerces totalGain to a float — high-precision decimal string survives verbatim", () => {
    const result = fxRevaluationPreviewSchema.safeParse({ ...preview, totalGain: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalGain).toBe("0.100001");
  });
});

describe("fxRevaluationPostResultSchema", () => {
  const result = {
    preview: {
      date: "2026-08-31",
      autoReverse: true,
      reversalDate: "2026-09-01",
      details: [],
      totalGain: "0",
      totalLoss: "0",
      hasImpact: false,
    },
    entryId: "je-1",
    entryNo: "JE-2026-100",
    reversalId: null,
    reversalNo: null,
  };

  it("accepts a minimal valid result and preserves every field verbatim", () => {
    const parsed = fxRevaluationPostResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("accepts a no-impact posting with null entryId", () => {
    const parsed = fxRevaluationPostResultSchema.safeParse({ ...result, entryId: null, entryNo: null });
    expect(parsed.success).toBe(true);
  });

  it("rejects a result missing preview", () => {
    const { preview, ...rest } = result;
    const parsed = fxRevaluationPostResultSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors).toHaveProperty("preview");
  });
});
