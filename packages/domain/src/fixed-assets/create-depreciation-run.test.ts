import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Asset } from "./asset.js";
import { createDepreciationRun, depreciationRunsCoverPeriod, type CreateDepreciationRunCommand } from "./create-depreciation-run.js";
import type { DepreciationRun } from "./depreciation-run.js";
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

describe("depreciationRunsCoverPeriod — the reminder behind «تشغيلات إهلاك مستحقة»", () => {
  const assets = [asset("general-1"), asset("main-1", { scope: "branch", branchId: "BR-MAIN" })];
  const run = (id: string, branchId: string | null, assetIds: string[], status: DepreciationRun["status"] = "draft"): DepreciationRun => ({
    id,
    period: "2025-06",
    branchId,
    status,
    lines: assetIds.map((assetId) => ({ assetId, amount: Money.fromMajor("1000.00") })),
    totalAmount: Money.sum(assetIds.map(() => Money.fromMajor("1000.00"))),
    journalEntryId: null,
    createdAt: "2025-07-01T08:00:00.000Z",
    postedAt: null,
  });

  it("one branch's run does not silence the reminder for the assets of another", () => {
    expect(depreciationRunsCoverPeriod(assets, [run("r-main", "BR-MAIN", ["main-1"])], "2025-06")).toBe(false);
    expect(depreciationRunsCoverPeriod(assets, [run("r-main", "BR-MAIN", ["main-1"]), run("r-general", null, ["general-1"])], "2025-06")).toBe(true);
  });

  it("a cancelled run covers nothing, a run of another month covers nothing, and no run at all is not coverage", () => {
    expect(depreciationRunsCoverPeriod(assets, [run("r-all", null, ["general-1", "main-1"], "cancelled")], "2025-06")).toBe(false);
    expect(depreciationRunsCoverPeriod(assets, [{ ...run("r-all", null, ["general-1", "main-1"]), period: "2025-05" }], "2025-06")).toBe(false);
    expect(depreciationRunsCoverPeriod(assets, [], "2025-06")).toBe(false);
  });

  it("an asset with nothing to depreciate in the month — fully depreciated, or not in service — does not keep the reminder up", () => {
    const spent = asset("spent-1", { accumulatedDepreciation: Money.fromMajor("12000.00") });
    const sold = asset("sold-1", { status: "disposed" });
    expect(depreciationRunsCoverPeriod([...assets, spent, sold], [run("r-all", null, ["general-1", "main-1"])], "2025-06")).toBe(true);
  });
});
