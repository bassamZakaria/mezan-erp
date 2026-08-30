import { describe, it, expect } from "vitest";
import {
  sequenceDefinitionSchema,
  nextNumberRequestSchema,
  nextNumberResponseSchema,
  sequenceOverrideSchema,
  sequenceListItemSchema,
  sequenceListResponseSchema,
  resetSequenceCounterSchema,
} from "./numbering.js";

describe("sequenceDefinitionSchema", () => {
  const def = { code: "SI", labelAr: "فواتير البيع", prefix: "SI-", padLength: 5, annualReset: true };

  it("accepts a minimal valid definition and preserves every field verbatim", () => {
    const result = sequenceDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(def);
  });

  it("rejects a definition missing padLength", () => {
    const { padLength, ...rest } = def;
    const result = sequenceDefinitionSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("padLength");
  });

  it("rejects a zero or negative padLength", () => {
    expect(sequenceDefinitionSchema.safeParse({ ...def, padLength: 0 }).success).toBe(false);
    expect(sequenceDefinitionSchema.safeParse({ ...def, padLength: -1 }).success).toBe(false);
  });
});

describe("nextNumberRequestSchema", () => {
  it("accepts a minimal valid payload with year omitted", () => {
    const result = nextNumberRequestSchema.safeParse({ code: "SI" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ code: "SI" });
  });

  it("rejects a payload missing code", () => {
    const result = nextNumberRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("code");
  });
});

describe("nextNumberResponseSchema", () => {
  const response = { code: "SI", value: 42, formatted: "SI-00042" };

  it("accepts a minimal valid response and preserves every field verbatim", () => {
    const result = nextNumberResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(response);
  });

  it("rejects a negative value", () => {
    const result = nextNumberResponseSchema.safeParse({ ...response, value: -1 });
    expect(result.success).toBe(false);
  });
});

describe("sequenceOverrideSchema", () => {
  it("accepts a payload with at least one field", () => {
    const result = sequenceOverrideSchema.safeParse({ prefix: "SI-" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty payload — the refine requires at least one field", () => {
    const result = sequenceOverrideSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().formErrors[0]).toContain("At least one field");
    }
  });

  it("rejects a prefix longer than 20 characters", () => {
    const result = sequenceOverrideSchema.safeParse({ prefix: "A".repeat(21) });
    expect(result.success).toBe(false);
  });

  it("rejects a padLength above 12", () => {
    const result = sequenceOverrideSchema.safeParse({ padLength: 13 });
    expect(result.success).toBe(false);
  });
});

describe("sequenceListItemSchema", () => {
  const item = {
    code: "SI",
    labelAr: "فواتير البيع",
    prefix: "SI-",
    padLength: 5,
    annualReset: true,
    currentValue: 41,
    nextNumber: "SI-00042",
    isOverridden: false,
  };

  it("accepts a minimal valid item and preserves every field verbatim", () => {
    const result = sequenceListItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(item);
  });

  it("rejects a negative currentValue", () => {
    const result = sequenceListItemSchema.safeParse({ ...item, currentValue: -1 });
    expect(result.success).toBe(false);
  });
});

describe("sequenceListResponseSchema", () => {
  it("accepts an array of sequence list items", () => {
    const item = {
      code: "SI",
      labelAr: "فواتير البيع",
      prefix: "SI-",
      padLength: 5,
      annualReset: true,
      currentValue: 41,
      nextNumber: "SI-00042",
      isOverridden: false,
    };
    const result = sequenceListResponseSchema.safeParse([item]);
    expect(result.success).toBe(true);
  });

  it("accepts an empty array", () => {
    const result = sequenceListResponseSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects a non-array payload", () => {
    const result = sequenceListResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("resetSequenceCounterSchema", () => {
  it("accepts a valid payload with confirm:true", () => {
    const result = resetSequenceCounterSchema.safeParse({ value: 100, confirm: true });
    expect(result.success).toBe(true);
  });

  it("rejects confirm:false — the literal must be true, this guards against a stray click", () => {
    const result = resetSequenceCounterSchema.safeParse({ value: 100, confirm: false });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing confirm entirely", () => {
    const result = resetSequenceCounterSchema.safeParse({ value: 100 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("confirm");
  });

  it("rejects a negative value", () => {
    const result = resetSequenceCounterSchema.safeParse({ value: -1, confirm: true });
    expect(result.success).toBe(false);
  });
});
