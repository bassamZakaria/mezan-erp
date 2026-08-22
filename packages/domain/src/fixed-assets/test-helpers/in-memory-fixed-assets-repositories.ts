import type { AssetCategory, AssetCategoryRepository } from "../asset-category.js";
import type { Asset, AssetRepository } from "../asset.js";
import type { DepreciationRun, DepreciationRunRepository } from "../depreciation-run.js";

/** A trivial in-memory {@link AssetCategoryRepository} fake for domain-layer unit tests. */
export function createInMemoryAssetCategoryRepository(): AssetCategoryRepository {
  const rows = new Map<string, AssetCategory>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByCode(code) {
      for (const row of rows.values()) {
        if (row.code === code) return row;
      }
      return null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(category) {
      rows.set(category.id, category);
    },
    async update(category) {
      rows.set(category.id, category);
    },
  };
}

/** A trivial in-memory {@link AssetRepository} fake for domain-layer unit tests. */
export function createInMemoryAssetRepository(): AssetRepository {
  const rows = new Map<string, Asset>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByCode(code) {
      for (const row of rows.values()) {
        if (row.code === code) return row;
      }
      return null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(asset) {
      rows.set(asset.id, asset);
    },
    async update(asset) {
      rows.set(asset.id, asset);
    },
  };
}

/** A trivial in-memory {@link DepreciationRunRepository} fake for domain-layer unit tests. */
export function createInMemoryDepreciationRunRepository(): DepreciationRunRepository {
  const rows = new Map<string, DepreciationRun>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByPeriod(period, branchId) {
      for (const row of rows.values()) {
        if (row.period === period && row.branchId === branchId) return row;
      }
      return null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(run) {
      rows.set(run.id, run);
    },
    async update(run) {
      rows.set(run.id, run);
    },
  };
}
