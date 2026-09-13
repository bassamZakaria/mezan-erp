import { describe, it, expect, afterEach } from "vitest";
import { Money, createAssetCategory, createAsset, type AssetCategory, type Asset, type DepreciationRun } from "@mezan/domain";
import {
  createSqliteAssetCategoryRepository,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
} from "./fixed-assets-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function category(overrides: Partial<AssetCategory> = {}): AssetCategory {
  return {
    id: "cat-1",
    code: "VEHICLES",
    nameAr: "سيارات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 12.5,
    assetAccountId: "1500",
    depreciationExpenseAccountId: "5400",
    accumulatedDepreciationAccountId: "1590",
    gainOnDisposalAccountId: "4500",
    lossOnDisposalAccountId: "5450",
    active: true,
    ...overrides,
  };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    code: "A-001",
    nameAr: "سيارة نقل",
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
    salvageValue: Money.fromMajor("1500.00"),
    accumulatedDepreciation: Money.zero(),
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
    projectId: null,
    ...overrides,
  };
}

function run(overrides: Partial<DepreciationRun> = {}): DepreciationRun {
  return {
    id: "run-1",
    period: "2026-03",
    branchId: null,
    status: "draft",
    lines: [
      { assetId: "a1", amount: Money.fromMajor("100.500000") },
      { assetId: "a2", amount: Money.fromMajor("50.25") },
    ],
    totalAmount: Money.fromMajor("150.75"),
    journalEntryId: null,
    createdAt: "2026-03-31T00:00:00.000Z",
    postedAt: null,
    ...overrides,
  };
}

describe("SqliteAssetCategoryRepository", () => {
  it("creates and retrieves a category by id and by code, round-tripping the salvage percent exactly", async () => {
    const repo = createSqliteAssetCategoryRepository();
    handles.push(repo);
    await createAssetCategory(
      { id: "cat-1", code: "VEHICLES", nameAr: "سيارات", defaultUsefulLifeMonths: 60, defaultSalvagePercent: 12.5 },
      repo,
    );
    const byId = await repo.findById("cat-1");
    expect(byId).toMatchObject({ code: "VEHICLES", defaultSalvagePercent: 12.5, defaultUsefulLifeMonths: 60 });
    const byCode = await repo.findByCode("VEHICLES");
    expect(byCode?.id).toBe("cat-1");
    expect(await repo.findById("nope")).toBeNull();
  });

  it("round-trips null optional fields", async () => {
    const repo = createSqliteAssetCategoryRepository();
    handles.push(repo);
    await repo.create(category({ nameEn: null, assetAccountId: null, gainOnDisposalAccountId: null }));
    const reloaded = await repo.findById("cat-1");
    expect(reloaded?.nameEn).toBeNull();
    expect(reloaded?.assetAccountId).toBeNull();
    expect(reloaded?.gainOnDisposalAccountId).toBeNull();
  });

  it("update() persists a full replace", async () => {
    const repo = createSqliteAssetCategoryRepository();
    handles.push(repo);
    await repo.create(category());
    await repo.update({ ...category(), active: false, defaultSalvagePercent: 5 });
    const reloaded = await repo.findById("cat-1");
    expect(reloaded?.active).toBe(false);
    expect(reloaded?.defaultSalvagePercent).toBe(5);
  });

  it("list() returns every persisted category", async () => {
    const repo = createSqliteAssetCategoryRepository();
    handles.push(repo);
    await repo.create(category());
    await repo.create(category({ id: "cat-2", code: "COMPUTERS" }));
    const all = await repo.list();
    expect(all.map((c) => c.id).sort()).toEqual(["cat-1", "cat-2"]);
  });
});

describe("SqliteAssetRepository", () => {
  it("creates and retrieves an asset by id and by code, round-tripping Money fields exactly", async () => {
    const categories = createSqliteAssetCategoryRepository();
    const repo = createSqliteAssetRepository();
    handles.push(categories, repo);
    await categories.create(category());
    await createAsset(
      { id: "a1", code: "A-001", nameAr: "سيارة نقل", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: Money.fromMajor("12000.00") },
      { assets: repo, categories },
    );
    const byId = await repo.findById("a1");
    expect(byId?.acquisitionCost.toString()).toBe("12000.000000");
    expect(byId?.salvageValue.toString()).toBe("1500.000000");
    expect(byId?.usefulLifeMonths).toBe(60);
    const byCode = await repo.findByCode("A-001");
    expect(byCode?.id).toBe("a1");
    expect(await repo.findById("nope")).toBeNull();
  });

  it("round-trips null optional scope/account fields", async () => {
    const repo = createSqliteAssetRepository();
    handles.push(repo);
    await repo.create(asset());
    const reloaded = await repo.findById("a1");
    expect(reloaded?.branchId).toBeNull();
    expect(reloaded?.warehouseId).toBeNull();
    expect(reloaded?.assetAccountId).toBeNull();
    expect(reloaded?.notes).toBeNull();
  });

  it("update() persists a full replace (e.g. accumulatedDepreciation bump + status flip)", async () => {
    const repo = createSqliteAssetRepository();
    handles.push(repo);
    const created = asset();
    await repo.create(created);
    await repo.update({ ...created, accumulatedDepreciation: Money.fromMajor("10500.00"), status: "fully_depreciated" });
    const reloaded = await repo.findById("a1");
    expect(reloaded?.accumulatedDepreciation.toString()).toBe("10500.000000");
    expect(reloaded?.status).toBe("fully_depreciated");
  });

  it("list() returns every persisted asset", async () => {
    const repo = createSqliteAssetRepository();
    handles.push(repo);
    await repo.create(asset());
    await repo.create(asset({ id: "a2", code: "A-002" }));
    const all = await repo.list();
    expect(all.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
  });
});

describe("SqliteDepreciationRunRepository", () => {
  it("creates and retrieves a run by id, round-tripping the lines JSON exactly (2+ lines)", async () => {
    const repo = createSqliteDepreciationRunRepository();
    handles.push(repo);
    await repo.create(run());
    const reloaded = await repo.findById("run-1");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.lines).toHaveLength(2);
    expect(reloaded?.lines[0]).toEqual({
      assetId: "a1",
      amount: expect.anything(),
      projectId: null,
      costCategory: null,
    });
    expect(reloaded?.lines[0]?.amount.toString()).toBe("100.500000");
    expect(reloaded?.lines[1]?.amount.toString()).toBe("50.250000");
    expect(reloaded?.totalAmount.toString()).toBe("150.750000");
  });

  it("findByPeriod finds a run for a given period + branch (including null branch)", async () => {
    const repo = createSqliteDepreciationRunRepository();
    handles.push(repo);
    await repo.create(run());
    await repo.create(run({ id: "run-2", period: "2026-03", branchId: "b1" }));
    expect((await repo.findByPeriod("2026-03", null))?.id).toBe("run-1");
    expect((await repo.findByPeriod("2026-03", "b1"))?.id).toBe("run-2");
    expect(await repo.findByPeriod("2026-03", "b2")).toBeNull();
    expect(await repo.findByPeriod("2026-04", null)).toBeNull();
  });

  it("update() persists a full replace (e.g. posting: status/journalEntryId/postedAt)", async () => {
    const repo = createSqliteDepreciationRunRepository();
    handles.push(repo);
    await repo.create(run());
    await repo.update({ ...run(), status: "posted", journalEntryId: "je-1", postedAt: "2026-03-31T12:00:00.000Z" });
    const reloaded = await repo.findById("run-1");
    expect(reloaded?.status).toBe("posted");
    expect(reloaded?.journalEntryId).toBe("je-1");
    expect(reloaded?.postedAt).toBe("2026-03-31T12:00:00.000Z");
  });

  it("list() returns every persisted run", async () => {
    const repo = createSqliteDepreciationRunRepository();
    handles.push(repo);
    await repo.create(run());
    await repo.create(run({ id: "run-2", period: "2026-04" }));
    const all = await repo.list();
    expect(all.map((r) => r.id).sort()).toEqual(["run-1", "run-2"]);
  });
});
