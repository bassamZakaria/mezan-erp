import { describe, it, expect } from "vitest";
import {
  depreciationMethodSchema,
  assetScopeSchema,
  assetStatusSchema,
  assetCategorySchema,
  createAssetCategorySchema,
  assetSchema,
  createAssetSchema,
  depreciationRunStatusSchema,
  depreciationRunLineSchema,
  depreciationRunSchema,
  createDepreciationRunSchema,
  disposeAssetSchema,
} from "./fixed-assets.js";

describe("depreciationMethodSchema", () => {
  it("accepts straight_line", () => {
    expect(depreciationMethodSchema.safeParse("straight_line").success).toBe(true);
  });

  it("rejects a method outside the enum", () => {
    expect(depreciationMethodSchema.safeParse("declining_balance").success).toBe(false);
  });
});

describe("assetCategorySchema", () => {
  const category = {
    id: "cat-1",
    code: "VEHICLES",
    nameAr: "مركبات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line" as const,
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 10,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: true,
  };

  it("accepts a minimal valid category and preserves every field verbatim", () => {
    const result = assetCategorySchema.safeParse(category);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(category);
  });

  it("rejects a zero or negative defaultUsefulLifeMonths", () => {
    expect(assetCategorySchema.safeParse({ ...category, defaultUsefulLifeMonths: 0 }).success).toBe(false);
    expect(assetCategorySchema.safeParse({ ...category, defaultUsefulLifeMonths: -1 }).success).toBe(false);
  });

  it("rejects a defaultSalvagePercent outside 0-100", () => {
    expect(assetCategorySchema.safeParse({ ...category, defaultSalvagePercent: -1 }).success).toBe(false);
    expect(assetCategorySchema.safeParse({ ...category, defaultSalvagePercent: 101 }).success).toBe(false);
  });
});

describe("createAssetCategorySchema", () => {
  const create = { id: "cat-1", code: "VEHICLES", nameAr: "مركبات", defaultUsefulLifeMonths: 60, defaultSalvagePercent: 10 };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createAssetCategorySchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing defaultUsefulLifeMonths — unlike the update flow, this is required on create", () => {
    const { defaultUsefulLifeMonths, ...rest } = create;
    const result = createAssetCategorySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("defaultUsefulLifeMonths");
  });
});

describe("assetSchema", () => {
  const asset = {
    id: "asset-1",
    code: "VEH-001",
    nameAr: "سيارة توزيع",
    nameEn: null,
    categoryId: "cat-1",
    scope: "branch" as const,
    branchId: "branch-1",
    warehouseId: null,
    acquisitionDate: "2024-01-15",
    acquisitionCost: "500000.000000",
    depreciationStartDate: "2024-02-01",
    depreciationMethod: "straight_line" as const,
    usefulLifeMonths: 60,
    salvageValue: "50000.000000",
    accumulatedDepreciation: "150000.000000",
    status: "active" as const,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
    projectId: null,
    internalHourlyRate: null,
  };

  it("accepts a minimal valid asset and preserves every field verbatim", () => {
    const result = assetSchema.safeParse(asset);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(asset);
  });

  it("never coerces acquisitionCost to a float — high-precision decimal string survives verbatim", () => {
    const result = assetSchema.safeParse({ ...asset, acquisitionCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.acquisitionCost).toBe("0.100001");
  });

  it("rejects acquisitionCost sent as a JS number instead of a string", () => {
    const result = assetSchema.safeParse({ ...asset, acquisitionCost: 500000 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum scope", () => {
    const result = assetSchema.safeParse({ ...asset, scope: "company" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative usefulLifeMonths", () => {
    expect(assetSchema.safeParse({ ...asset, usefulLifeMonths: 0 }).success).toBe(false);
  });
});

describe("createAssetSchema", () => {
  const create = { id: "asset-1", code: "VEH-001", nameAr: "سيارة توزيع", categoryId: "cat-1", acquisitionDate: "2024-01-15", acquisitionCost: "500000.000000" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createAssetSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing categoryId", () => {
    const { categoryId, ...rest } = create;
    const result = createAssetSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("categoryId");
  });

  it("silently strips accumulatedDepreciation and status — a new asset starts fresh at the server default", () => {
    const result = createAssetSchema.safeParse({ ...create, accumulatedDepreciation: "999999", status: "disposed" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("accumulatedDepreciation");
      expect(result.data).not.toHaveProperty("status");
    }
  });
});

describe("depreciationRunLineSchema", () => {
  it("accepts a minimal valid line and never coerces amount to a float", () => {
    const line = { assetId: "asset-1", amount: "0.100001" };
    const result = depreciationRunLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = depreciationRunLineSchema.safeParse({ assetId: "asset-1", amount: 100 });
    expect(result.success).toBe(false);
  });
});

describe("depreciationRunSchema", () => {
  const run = {
    id: "dr-1",
    period: "2026-08",
    branchId: null,
    status: "draft" as const,
    lines: [],
    totalAmount: "0",
    journalEntryId: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    postedAt: null,
  };

  it("accepts a minimal valid run and preserves every field verbatim", () => {
    const result = depreciationRunSchema.safeParse(run);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(run);
  });

  it("rejects a malformed period", () => {
    const result = depreciationRunSchema.safeParse({ ...run, period: "August 2026" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = depreciationRunSchema.safeParse({ ...run, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("createDepreciationRunSchema", () => {
  it("accepts a minimal valid payload with branchId omitted", () => {
    const result = createDepreciationRunSchema.safeParse({ period: "2026-08" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed period", () => {
    const result = createDepreciationRunSchema.safeParse({ period: "2026/08" });
    expect(result.success).toBe(false);
  });
});

describe("disposeAssetSchema", () => {
  it("accepts a minimal valid payload for a scrapped asset (no proceeds)", () => {
    const result = disposeAssetSchema.safeParse({ date: "2026-08-30" });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with proceeds and a proceedsAccountId", () => {
    const result = disposeAssetSchema.safeParse({ date: "2026-08-30", proceeds: "10000.000000", proceedsAccountId: "acc-cash" });
    expect(result.success).toBe(true);
  });

  it("rejects proceeds sent as a JS number instead of a string", () => {
    const result = disposeAssetSchema.safeParse({ date: "2026-08-30", proceeds: 10000 });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing date", () => {
    const result = disposeAssetSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("date");
  });
});
