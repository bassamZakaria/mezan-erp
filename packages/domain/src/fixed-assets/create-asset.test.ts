import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { createAsset, type CreateAssetCommand } from "./create-asset.js";
import { createAssetCategory, type AssetCategory } from "./asset-category.js";
import { AssetCategoryNotFoundError, DuplicateAssetCodeError, InvalidAssetError } from "./errors.js";
import {
  createInMemoryAssetCategoryRepository,
  createInMemoryAssetRepository,
} from "./test-helpers/in-memory-fixed-assets-repositories.js";

async function seedCategory(
  categories: ReturnType<typeof createInMemoryAssetCategoryRepository>,
  overrides: Partial<Parameters<typeof createAssetCategory>[0]> = {},
): Promise<AssetCategory> {
  return createAssetCategory(
    {
      id: "cat-1",
      code: "VEHICLES",
      nameAr: "سيارات",
      defaultUsefulLifeMonths: 60,
      defaultSalvagePercent: 10,
      ...overrides,
    },
    categories,
  );
}

function command(overrides: Partial<CreateAssetCommand> = {}): CreateAssetCommand {
  return {
    id: "asset-1",
    code: "AST-000001",
    nameAr: "سيارة تويوتا",
    categoryId: "cat-1",
    acquisitionDate: "2026-01-15",
    acquisitionCost: Money.fromMajor("10000.00"),
    ...overrides,
  };
}

describe("createAsset", () => {
  it("creates an asset, defaulting scope to general, status active, and zero accumulated depreciation", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories);

    const asset = await createAsset(command(), { assets, categories });

    expect(asset.scope).toBe("general");
    expect(asset.status).toBe("active");
    expect(asset.accumulatedDepreciation.scaled).toBe(0n);
    expect(await assets.findById("asset-1")).toEqual(asset);
  });

  it("applies the category's defaults for depreciation method and useful life when omitted", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories, { defaultUsefulLifeMonths: 48, defaultSalvagePercent: 5 });

    const asset = await createAsset(command(), { assets, categories });

    expect(asset.depreciationMethod).toBe("straight_line");
    expect(asset.usefulLifeMonths).toBe(48);
  });

  it("defaults depreciationStartDate to acquisitionDate when omitted", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories);

    const asset = await createAsset(command({ acquisitionDate: "2026-03-10" }), { assets, categories });

    expect(asset.depreciationStartDate).toBe("2026-03-10");
  });

  it("computes salvage value from the category's defaultSalvagePercent with exact bigint math", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories, { defaultSalvagePercent: 10 });

    const asset = await createAsset(
      command({ acquisitionCost: Money.fromMajor("10000.00") }),
      { assets, categories },
    );

    expect(asset.salvageValue.toString()).toBe("1000.000000");
  });

  it("uses an explicit salvageValue instead of computing one from the category", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories, { defaultSalvagePercent: 10 });

    const asset = await createAsset(
      command({ acquisitionCost: Money.fromMajor("10000.00"), salvageValue: Money.fromMajor("500.00") }),
      { assets, categories },
    );

    expect(asset.salvageValue.toString()).toBe("500.000000");
  });

  it("rejects a duplicate asset code", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories);
    await createAsset(command(), { assets, categories });

    await expect(createAsset(command({ id: "asset-2" }), { assets, categories })).rejects.toBeInstanceOf(
      DuplicateAssetCodeError,
    );
  });

  it("rejects a branch-scoped asset with no branchId", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories);

    await expect(
      createAsset(command({ scope: "branch" }), { assets, categories }),
    ).rejects.toBeInstanceOf(InvalidAssetError);
  });

  it("rejects a warehouse-scoped asset with no warehouseId", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories);

    await expect(
      createAsset(command({ scope: "warehouse" }), { assets, categories }),
    ).rejects.toBeInstanceOf(InvalidAssetError);
  });

  it("accepts a branch-scoped asset with a branchId", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();
    await seedCategory(categories);

    const asset = await createAsset(command({ scope: "branch", branchId: "branch-1" }), {
      assets,
      categories,
    });
    expect(asset.scope).toBe("branch");
    expect(asset.branchId).toBe("branch-1");
  });

  it("rejects an unknown category id", async () => {
    const assets = createInMemoryAssetRepository();
    const categories = createInMemoryAssetCategoryRepository();

    await expect(
      createAsset(command({ categoryId: "does-not-exist" }), { assets, categories }),
    ).rejects.toBeInstanceOf(AssetCategoryNotFoundError);
  });
});
