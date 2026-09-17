import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Asset } from "./asset.js";
import { createDepreciationRun, type CreateDepreciationRunCommand } from "./create-depreciation-run.js";
import { DuplicateDepreciationPeriodError, NoDepreciableAssetsError } from "./errors.js";
import {
  createInMemoryAssetRepository,
  createInMemoryDepreciationRunRepository,
} from "./test-helpers/in-memory-fixed-assets-repositories.js";

function asset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    categoryId: "cat-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2025-01-01",
    acquisitionCost: Money.fromMajor("12000.00"),
    depreciationStartDate: "2025-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 12,
    salvageValue: Money.zero(),
    accumulatedDepreciation: Money.zero(),
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
    projectId: null,
    internalHourlyRate: null,
    ...overrides,
  };
}

function command(overrides: Partial<CreateDepreciationRunCommand> = {}): CreateDepreciationRunCommand {
  return {
    id: "run-1",
    period: "2026-03",
    now: () => "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("createDepreciationRun", () => {
  it("builds a draft run with one line per eligible active asset with depreciation due", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("a1"));
    await assets.create(asset("a2"));

    const run = await createDepreciationRun(command(), { runs, assets });

    expect(run.status).toBe("draft");
    expect(run.lines).toHaveLength(2);
    expect(run.totalAmount.toString()).toBe("2000.000000");
    expect(run.journalEntryId).toBeNull();
    expect(run.postedAt).toBeNull();
  });

  it("excludes non-active assets", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("a1"));
    await assets.create(asset("a2", { status: "disposed" }));

    const run = await createDepreciationRun(command(), { runs, assets });

    expect(run.lines.map((l) => l.assetId)).toEqual(["a1"]);
  });

  it("excludes assets with zero depreciation due for the period", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("a1"));
    await assets.create(asset("a2", { status: "fully_depreciated" }));

    const run = await createDepreciationRun(command(), { runs, assets });

    expect(run.lines.map((l) => l.assetId)).toEqual(["a1"]);
  });

  it("when scoped to a branch: includes general-scope assets and matching branch-scope assets, excludes others", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("general-1", { scope: "general" }));
    await assets.create(asset("branch-1", { scope: "branch", branchId: "b1" }));
    await assets.create(asset("branch-2", { scope: "branch", branchId: "b2" }));
    await assets.create(asset("warehouse-1", { scope: "warehouse", warehouseId: "w1" }));

    const run = await createDepreciationRun(command({ id: "run-b1", branchId: "b1" }), { runs, assets });

    expect(run.lines.map((l) => l.assetId).sort()).toEqual(["branch-1", "general-1"]);
  });

  it("with no branch filter, includes assets of every scope", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("general-1", { scope: "general" }));
    await assets.create(asset("branch-1", { scope: "branch", branchId: "b1" }));
    await assets.create(asset("warehouse-1", { scope: "warehouse", warehouseId: "w1" }));

    const run = await createDepreciationRun(command(), { runs, assets });

    expect(run.lines.map((l) => l.assetId).sort()).toEqual(["branch-1", "general-1", "warehouse-1"]);
  });

  it("rejects a duplicate non-cancelled run for the same period + branch", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("a1"));
    await createDepreciationRun(command(), { runs, assets });

    await expect(createDepreciationRun(command({ id: "run-2" }), { runs, assets })).rejects.toBeInstanceOf(
      DuplicateDepreciationPeriodError,
    );
  });

  it("allows a new run for the same period once the prior run is cancelled", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();
    await assets.create(asset("a1"));
    const first = await createDepreciationRun(command(), { runs, assets });
    await runs.update({ ...first, status: "cancelled" });

    const second = await createDepreciationRun(command({ id: "run-2" }), { runs, assets });
    expect(second.status).toBe("draft");
  });

  it("rejects when there are zero eligible assets with depreciation due", async () => {
    const assets = createInMemoryAssetRepository();
    const runs = createInMemoryDepreciationRunRepository();

    await expect(createDepreciationRun(command(), { runs, assets })).rejects.toBeInstanceOf(
      NoDepreciableAssetsError,
    );
  });
});
