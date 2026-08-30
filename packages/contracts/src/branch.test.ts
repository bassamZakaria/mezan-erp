import { describe, it, expect } from "vitest";
import { branchSchema, createBranchSchema, updateBranchSchema } from "./branch.js";

describe("branchSchema", () => {
  const branch = {
    id: "branch-1",
    code: "CAI-01",
    name: "الفرع الرئيسي",
    parentBranchId: null,
    phone: null,
    email: null,
    address: null,
    isMain: true,
    active: true,
  };

  it("accepts a minimal valid branch and preserves every field verbatim", () => {
    const result = branchSchema.safeParse(branch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(branch);
  });

  it("rejects a branch missing name", () => {
    const { name, ...rest } = branch;
    const result = branchSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });

  it("rejects a branch missing isMain", () => {
    const { isMain, ...rest } = branch;
    const result = branchSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("isMain");
  });

  it("rejects a lowercase code — the code must be upper-case alphanumeric with - or _", () => {
    const result = branchSchema.safeParse({ ...branch, code: "cai-01" });
    expect(result.success).toBe(false);
  });

  it("rejects a code with a space", () => {
    const result = branchSchema.safeParse({ ...branch, code: "CAI 01" });
    expect(result.success).toBe(false);
  });

  it("rejects a code longer than 20 characters", () => {
    const result = branchSchema.safeParse({ ...branch, code: "A".repeat(21) });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised currency — a real dimension a caller could lose", () => {
    const result = branchSchema.safeParse({ ...branch, currency: "EGP" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("currency");
  });
});

describe("createBranchSchema", () => {
  const create = { id: "branch-1", code: "CAI-01", name: "الفرع الرئيسي" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createBranchSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing id", () => {
    const { id, ...rest } = create;
    const result = createBranchSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("id");
  });

  it("rejects a payload missing code", () => {
    const { code, ...rest } = create;
    const result = createBranchSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("code");
  });

  it("accepts omitting optional fields like isMain and active", () => {
    const result = createBranchSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isMain).toBeUndefined();
      expect(result.data.active).toBeUndefined();
    }
  });

  it("rejects an invalid code even though other fields are optional", () => {
    const result = createBranchSchema.safeParse({ ...create, code: "bad code" });
    expect(result.success).toBe(false);
  });
});

describe("updateBranchSchema", () => {
  it("accepts a partial payload with a single field", () => {
    const result = updateBranchSchema.safeParse({ name: "الفرع الجديد" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: "الفرع الجديد" });
  });

  it("accepts an empty payload — every field is optional on update", () => {
    const result = updateBranchSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects id — id is omitted from the update schema entirely", () => {
    const result = updateBranchSchema.safeParse({ id: "branch-2" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });

  it("rejects an invalid code when one is supplied", () => {
    const result = updateBranchSchema.safeParse({ code: "invalid code!" });
    expect(result.success).toBe(false);
  });
});
