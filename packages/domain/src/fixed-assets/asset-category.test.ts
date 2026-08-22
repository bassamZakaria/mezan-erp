import { describe, it, expect } from "vitest";
import { createAssetCategory, type CreateAssetCategoryCommand } from "./asset-category.js";
import { DuplicateAssetCategoryCodeError, InvalidAssetCategoryError } from "./errors.js";
import { createInMemoryAssetCategoryRepository } from "./test-helpers/in-memory-fixed-assets-repositories.js";

function command(overrides: Partial<CreateAssetCategoryCommand> = {}): CreateAssetCategoryCommand {
  return {
    id: "cat-1",
    code: "VEHICLES",
    nameAr: "سيارات",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 10,
    ...overrides,
  };
}

describe("createAssetCategory", () => {
  it("creates a new active category with straight_line default depreciation method", async () => {
    const repo = createInMemoryAssetCategoryRepository();
    const category = await createAssetCategory(command(), repo);

    expect(category.active).toBe(true);
    expect(category.defaultDepreciationMethod).toBe("straight_line");
    expect(await repo.findById("cat-1")).toEqual(category);
  });

  it("applies null defaults for optional GL account overrides", async () => {
    const repo = createInMemoryAssetCategoryRepository();
    const category = await createAssetCategory(command(), repo);

    expect(category.assetAccountId).toBeNull();
    expect(category.depreciationExpenseAccountId).toBeNull();
    expect(category.accumulatedDepreciationAccountId).toBeNull();
    expect(category.gainOnDisposalAccountId).toBeNull();
    expect(category.lossOnDisposalAccountId).toBeNull();
  });

  it("rejects a duplicate category code", async () => {
    const repo = createInMemoryAssetCategoryRepository();
    await createAssetCategory(command(), repo);
    await expect(createAssetCategory(command({ id: "cat-2" }), repo)).rejects.toBeInstanceOf(
      DuplicateAssetCategoryCodeError,
    );
  });

  it("rejects a salvage percent outside [0,100]", async () => {
    const repo = createInMemoryAssetCategoryRepository();
    await expect(
      createAssetCategory(command({ defaultSalvagePercent: 150 }), repo),
    ).rejects.toBeInstanceOf(InvalidAssetCategoryError);
    await expect(
      createAssetCategory(command({ defaultSalvagePercent: -1 }), repo),
    ).rejects.toBeInstanceOf(InvalidAssetCategoryError);
  });

  it("rejects a non-positive useful life", async () => {
    const repo = createInMemoryAssetCategoryRepository();
    await expect(
      createAssetCategory(command({ defaultUsefulLifeMonths: 0 }), repo),
    ).rejects.toBeInstanceOf(InvalidAssetCategoryError);
  });
});
