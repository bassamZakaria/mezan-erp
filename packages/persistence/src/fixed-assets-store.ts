import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  type AssetCategory,
  type AssetCategoryRepository,
  type DepreciationMethod,
  type Asset,
  type AssetInternalRateHistoryRepository,
  type AssetInternalRateRow,
  type AssetRepository,
  type AssetScope,
  type AssetStatus,
  type DepreciationRun,
  type DepreciationRunLine,
  type DepreciationRunRepository,
  type DepreciationRunStatus,
  type CostCategory,
} from "@mezan/domain";

/**
 * SQLite-backed Fixed Assets stores (docs/archive/catalog/07-mfg-projects-assets.md
 * "الأصول الثابتة"): asset categories and the asset register are simple
 * single-table scalar-field repos (mirroring `cost-center-repository.ts`);
 * depreciation runs are document-shaped, so their per-asset lines are stored
 * as a JSON text column (mirroring `purchasing-stores.ts`) with Money
 * serialized as an EXACT decimal string via `.toString()`, round-tripped via
 * `Money.fromMajor` — never floats.
 */

// --- Asset Category ---------------------------------------------------------

const CREATE_ASSET_CATEGORY = `
CREATE TABLE IF NOT EXISTS asset_category (
  id                                   TEXT PRIMARY KEY,
  code                                 TEXT NOT NULL UNIQUE,
  name_ar                              TEXT NOT NULL,
  name_en                              TEXT,
  default_depreciation_method          TEXT NOT NULL,
  default_useful_life_months           INTEGER NOT NULL,
  default_salvage_percent              REAL NOT NULL,
  asset_account_id                     TEXT,
  depreciation_expense_account_id      TEXT,
  accumulated_depreciation_account_id  TEXT,
  gain_on_disposal_account_id          TEXT,
  loss_on_disposal_account_id          TEXT,
  active                               INTEGER NOT NULL
);
`;

interface AssetCategoryRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  default_depreciation_method: string;
  default_useful_life_months: bigint;
  default_salvage_percent: number;
  asset_account_id: string | null;
  depreciation_expense_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  gain_on_disposal_account_id: string | null;
  loss_on_disposal_account_id: string | null;
  active: bigint;
}

function toAssetCategory(row: AssetCategoryRow): AssetCategory {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    defaultDepreciationMethod: row.default_depreciation_method as DepreciationMethod,
    defaultUsefulLifeMonths: Number(row.default_useful_life_months),
    defaultSalvagePercent: row.default_salvage_percent,
    assetAccountId: row.asset_account_id,
    depreciationExpenseAccountId: row.depreciation_expense_account_id,
    accumulatedDepreciationAccountId: row.accumulated_depreciation_account_id,
    gainOnDisposalAccountId: row.gain_on_disposal_account_id,
    lossOnDisposalAccountId: row.loss_on_disposal_account_id,
    active: Number(row.active) === 1,
  };
}

const UPSERT_ASSET_CATEGORY = `
      INSERT INTO asset_category (
        id, code, name_ar, name_en, default_depreciation_method, default_useful_life_months,
        default_salvage_percent, asset_account_id, depreciation_expense_account_id,
        accumulated_depreciation_account_id, gain_on_disposal_account_id, loss_on_disposal_account_id, active
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        default_depreciation_method = excluded.default_depreciation_method,
        default_useful_life_months = excluded.default_useful_life_months,
        default_salvage_percent = excluded.default_salvage_percent,
        asset_account_id = excluded.asset_account_id,
        depreciation_expense_account_id = excluded.depreciation_expense_account_id,
        accumulated_depreciation_account_id = excluded.accumulated_depreciation_account_id,
        gain_on_disposal_account_id = excluded.gain_on_disposal_account_id,
        loss_on_disposal_account_id = excluded.loss_on_disposal_account_id,
        active = excluded.active
    `;

function assetCategoryParams(category: AssetCategory): SqlValue[] {
  return [
    category.id,
    category.code,
    category.nameAr,
    category.nameEn,
    category.defaultDepreciationMethod,
    category.defaultUsefulLifeMonths,
    category.defaultSalvagePercent,
    category.assetAccountId,
    category.depreciationExpenseAccountId,
    category.accumulatedDepreciationAccountId,
    category.gainOnDisposalAccountId,
    category.lossOnDisposalAccountId,
    category.active ? 1 : 0,
  ];
}

class SqlAssetCategoryRepository implements AssetCategoryRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<AssetCategory | null> {
    const row = await this.db.get<AssetCategoryRow>(`SELECT * FROM asset_category WHERE id = ?`, [id]);
    return row ? toAssetCategory(row) : null;
  }

  async findByCode(code: string): Promise<AssetCategory | null> {
    const row = await this.db.get<AssetCategoryRow>(`SELECT * FROM asset_category WHERE code = ?`, [code]);
    return row ? toAssetCategory(row) : null;
  }

  async list(): Promise<AssetCategory[]> {
    return (await this.db.all<AssetCategoryRow>(`SELECT * FROM asset_category`)).map(toAssetCategory);
  }

  async create(category: AssetCategory): Promise<void> {
    await insertNew(this.db, category.id, UPSERT_ASSET_CATEGORY, assetCategoryParams(category));
  }

  async update(category: AssetCategory): Promise<void> {
    await this.db.run(UPSERT_ASSET_CATEGORY, assetCategoryParams(category));
  }
}

export async function ensureAssetCategorySchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_ASSET_CATEGORY);
}

export function createAssetCategoryRepository(db: SqlDb): AssetCategoryRepository {
  return new SqlAssetCategoryRepository(db);
}

export interface SqliteAssetCategoryRepositoryHandle extends AssetCategoryRepository {
  close(): void;
}

/** Open a SQLite-backed AssetCategoryRepository. ":memory:" for tests, a path for real. */
export function createSqliteAssetCategoryRepository(path: SqliteConnectionInput = ":memory:"): SqliteAssetCategoryRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ASSET_CATEGORY);
  const repo = createAssetCategoryRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteAssetCategoryRepositoryHandle;
}

// --- Asset -------------------------------------------------------------------

const CREATE_ASSET = `
CREATE TABLE IF NOT EXISTS asset (
  id                                   TEXT PRIMARY KEY,
  code                                 TEXT NOT NULL UNIQUE,
  name_ar                              TEXT NOT NULL,
  name_en                              TEXT,
  category_id                          TEXT NOT NULL,
  scope                                TEXT NOT NULL,
  branch_id                            TEXT,
  warehouse_id                         TEXT,
  acquisition_date                     TEXT NOT NULL,
  acquisition_cost                     INTEGER NOT NULL,
  depreciation_start_date              TEXT NOT NULL,
  depreciation_method                  TEXT NOT NULL,
  useful_life_months                   INTEGER NOT NULL,
  salvage_value                        INTEGER NOT NULL,
  accumulated_depreciation             INTEGER NOT NULL,
  status                               TEXT NOT NULL,
  asset_account_id                     TEXT,
  depreciation_expense_account_id      TEXT,
  accumulated_depreciation_account_id  TEXT,
  notes                                TEXT,
  internal_hourly_rate                 INTEGER,
  project_id                           TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_category ON asset(category_id);
`;

/** `project_id` arrived after the table shipped; CREATE TABLE IF NOT EXISTS never widens an existing database. */
function addAssetProjectColumnIfMissing(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(asset)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "project_id")) {
    sqlite.exec(`ALTER TABLE asset ADD COLUMN project_id TEXT`);
  }
}

interface AssetRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  category_id: string;
  scope: string;
  branch_id: string | null;
  warehouse_id: string | null;
  acquisition_date: string;
  acquisition_cost: bigint;
  depreciation_start_date: string;
  depreciation_method: string;
  useful_life_months: bigint;
  salvage_value: bigint;
  accumulated_depreciation: bigint;
  status: string;
  asset_account_id: string | null;
  depreciation_expense_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  notes: string | null;
  project_id: string | null;
  internal_hourly_rate: bigint | null;
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    categoryId: row.category_id,
    scope: row.scope as AssetScope,
    branchId: row.branch_id,
    warehouseId: row.warehouse_id,
    acquisitionDate: row.acquisition_date,
    acquisitionCost: Money.fromScaled(row.acquisition_cost),
    depreciationStartDate: row.depreciation_start_date,
    depreciationMethod: row.depreciation_method as DepreciationMethod,
    usefulLifeMonths: Number(row.useful_life_months),
    salvageValue: Money.fromScaled(row.salvage_value),
    accumulatedDepreciation: Money.fromScaled(row.accumulated_depreciation),
    status: row.status as AssetStatus,
    assetAccountId: row.asset_account_id,
    depreciationExpenseAccountId: row.depreciation_expense_account_id,
    accumulatedDepreciationAccountId: row.accumulated_depreciation_account_id,
    notes: row.notes,
    projectId: row.project_id,
    internalHourlyRate: row.internal_hourly_rate === null ? null : Money.fromScaled(row.internal_hourly_rate),
  };
}

const UPSERT_ASSET = `
      INSERT INTO asset (
        id, code, name_ar, name_en, category_id, scope, branch_id, warehouse_id, acquisition_date,
        acquisition_cost, depreciation_start_date, depreciation_method, useful_life_months, salvage_value,
        accumulated_depreciation, status, asset_account_id, depreciation_expense_account_id,
        accumulated_depreciation_account_id, notes, project_id, internal_hourly_rate
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        category_id = excluded.category_id,
        scope = excluded.scope,
        branch_id = excluded.branch_id,
        warehouse_id = excluded.warehouse_id,
        acquisition_date = excluded.acquisition_date,
        acquisition_cost = excluded.acquisition_cost,
        depreciation_start_date = excluded.depreciation_start_date,
        depreciation_method = excluded.depreciation_method,
        useful_life_months = excluded.useful_life_months,
        salvage_value = excluded.salvage_value,
        accumulated_depreciation = excluded.accumulated_depreciation,
        status = excluded.status,
        asset_account_id = excluded.asset_account_id,
        depreciation_expense_account_id = excluded.depreciation_expense_account_id,
        accumulated_depreciation_account_id = excluded.accumulated_depreciation_account_id,
        notes = excluded.notes,
        project_id = excluded.project_id,
        internal_hourly_rate = excluded.internal_hourly_rate
    `;

function assetParams(asset: Asset): SqlValue[] {
  return [
    asset.id,
    asset.code,
    asset.nameAr,
    asset.nameEn,
    asset.categoryId,
    asset.scope,
    asset.branchId,
    asset.warehouseId,
    asset.acquisitionDate,
    asset.acquisitionCost.scaled,
    asset.depreciationStartDate,
    asset.depreciationMethod,
    asset.usefulLifeMonths,
    asset.salvageValue.scaled,
    asset.accumulatedDepreciation.scaled,
    asset.status,
    asset.assetAccountId,
    asset.depreciationExpenseAccountId,
    asset.accumulatedDepreciationAccountId,
    asset.notes,
    asset.projectId,
    asset.internalHourlyRate?.scaled ?? null,
  ];
}

class SqlAssetRepository implements AssetRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Asset | null> {
    const row = await this.db.get<AssetRow>(`SELECT * FROM asset WHERE id = ?`, [id]);
    return row ? toAsset(row) : null;
  }

  async findByCode(code: string): Promise<Asset | null> {
    const row = await this.db.get<AssetRow>(`SELECT * FROM asset WHERE code = ?`, [code]);
    return row ? toAsset(row) : null;
  }

  async list(): Promise<Asset[]> {
    return (await this.db.all<AssetRow>(`SELECT * FROM asset`)).map(toAsset);
  }

  async create(asset: Asset): Promise<void> {
    await insertNew(this.db, asset.id, UPSERT_ASSET, assetParams(asset));
  }

  async update(asset: Asset): Promise<void> {
    await this.db.run(UPSERT_ASSET, assetParams(asset));
  }
}

export async function ensureAssetSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_ASSET);
}

export function createAssetRepository(db: SqlDb): AssetRepository {
  return new SqlAssetRepository(db);
}

export interface SqliteAssetRepositoryHandle extends AssetRepository {
  close(): void;
}

/** Open a SQLite-backed AssetRepository. ":memory:" for tests, a path for real. */
export function createSqliteAssetRepository(path: SqliteConnectionInput = ":memory:"): SqliteAssetRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ASSET);
  addAssetProjectColumnIfMissing(sqlite);
  const repo = createAssetRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteAssetRepositoryHandle;
}

// --- Internal hourly-rate history -------------------------------------------

const CREATE_ASSET_INTERNAL_RATE_HISTORY = `
CREATE TABLE IF NOT EXISTS asset_internal_rate_history (
  asset_id       TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  hourly_rate    INTEGER NOT NULL,
  set_by         TEXT,
  set_at         TEXT NOT NULL,
  PRIMARY KEY (asset_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_asset_internal_rate_history ON asset_internal_rate_history(asset_id, effective_from);
`;

interface AssetInternalRateHistoryRow {
  asset_id: string;
  effective_from: string;
  hourly_rate: bigint;
  set_by: string | null;
  set_at: string;
}

function toRateRow(row: AssetInternalRateHistoryRow): AssetInternalRateRow {
  return {
    assetId: row.asset_id,
    effectiveFrom: row.effective_from,
    hourlyRate: Money.fromScaled(row.hourly_rate),
    setBy: row.set_by,
    setAt: row.set_at,
  };
}

const UPSERT_RATE = `
      INSERT INTO asset_internal_rate_history (asset_id, effective_from, hourly_rate, set_by, set_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, effective_from) DO UPDATE SET
        hourly_rate = excluded.hourly_rate,
        set_by = excluded.set_by,
        set_at = excluded.set_at
    `;

function rateParams(row: AssetInternalRateRow): SqlValue[] {
  return [
    row.assetId,
    row.effectiveFrom,
    row.hourlyRate.scaled,
    row.setBy,
    row.setAt,
  ];
}

class SqlAssetInternalRateHistoryRepository implements AssetInternalRateHistoryRepository {
  constructor(private readonly db: SqlDb) {}

  async list(assetId: string): Promise<readonly AssetInternalRateRow[]> {
    const rows = await this.db.all<AssetInternalRateHistoryRow>(
      `SELECT * FROM asset_internal_rate_history WHERE asset_id = ? ORDER BY effective_from, set_at`,
      [assetId],
    );
    return rows.map(toRateRow);
  }

  async listAll(): Promise<readonly AssetInternalRateRow[]> {
    const rows = await this.db.all<AssetInternalRateHistoryRow>(
      `SELECT * FROM asset_internal_rate_history ORDER BY asset_id, effective_from, set_at`,
    );
    return rows.map(toRateRow);
  }

  async append(row: AssetInternalRateRow): Promise<void> {
    await this.db.run(UPSERT_RATE, rateParams(row));
  }
}

export async function ensureAssetInternalRateHistorySchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_ASSET_INTERNAL_RATE_HISTORY);
}

export function createAssetInternalRateHistoryRepository(db: SqlDb): AssetInternalRateHistoryRepository {
  return new SqlAssetInternalRateHistoryRepository(db);
}

export interface SqliteAssetInternalRateHistoryRepositoryHandle extends AssetInternalRateHistoryRepository {
  close(): void;
}

/** Open a SQLite-backed rate-history repository. ":memory:" for tests, a path for real. */
export function createSqliteAssetInternalRateHistoryRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteAssetInternalRateHistoryRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ASSET_INTERNAL_RATE_HISTORY);
  const repo = createAssetInternalRateHistoryRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteAssetInternalRateHistoryRepositoryHandle;
}

// --- Depreciation Run ---------------------------------------------------------

const CREATE_DEPRECIATION_RUN = `
CREATE TABLE IF NOT EXISTS depreciation_run (
  id               TEXT PRIMARY KEY,
  period           TEXT NOT NULL,
  branch_id        TEXT,
  status           TEXT NOT NULL,
  lines            TEXT NOT NULL,
  total_amount     INTEGER NOT NULL,
  journal_entry_id TEXT,
  created_at       TEXT NOT NULL,
  posted_at        TEXT,
  skipped_lines    TEXT
);
CREATE INDEX IF NOT EXISTS idx_depreciation_run_period ON depreciation_run(period, branch_id);
`;

function addRunSkippedLinesColumnIfMissing(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(depreciation_run)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "skipped_lines")) {
    sqlite.exec(`ALTER TABLE depreciation_run ADD COLUMN skipped_lines TEXT`);
  }
}

interface DepreciationRunRow {
  id: string;
  period: string;
  branch_id: string | null;
  status: string;
  lines: string;
  total_amount: bigint;
  journal_entry_id: string | null;
  created_at: string;
  posted_at: string | null;
  skipped_lines: string | null;
}

function toDepreciationRun(row: DepreciationRunRow): DepreciationRun {
  const lines = (
    JSON.parse(row.lines) as {
      assetId: string;
      amount: string;
      projectId?: string | null;
      costCategory?: CostCategory | null;
    }[]
  ).map<DepreciationRunLine>((l) => ({
    assetId: l.assetId,
    amount: Money.fromMajor(l.amount),
    projectId: l.projectId ?? null,
    costCategory: l.costCategory ?? null,
  }));
  return {
    id: row.id,
    period: row.period,
    branchId: row.branch_id,
    status: row.status as DepreciationRunStatus,
    lines,
    skippedLines: (JSON.parse(row.skipped_lines ?? "[]") as { assetId: string; assetCode: string; amount: string }[]).map((l) => ({
      assetId: l.assetId,
      assetCode: l.assetCode,
      amount: Money.fromMajor(l.amount),
    })),
    totalAmount: Money.fromScaled(row.total_amount),
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
    postedAt: row.posted_at,
  };
}

const UPSERT_DEPRECIATION_RUN = `
      INSERT INTO depreciation_run (id, period, branch_id, status, lines, total_amount, journal_entry_id, created_at, posted_at, skipped_lines)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        period = excluded.period,
        branch_id = excluded.branch_id,
        status = excluded.status,
        lines = excluded.lines,
        total_amount = excluded.total_amount,
        journal_entry_id = excluded.journal_entry_id,
        created_at = excluded.created_at,
        posted_at = excluded.posted_at,
        skipped_lines = excluded.skipped_lines
    `;

function depreciationRunParams(run: DepreciationRun): SqlValue[] {
  return [
    run.id,
    run.period,
    run.branchId,
    run.status,
    JSON.stringify(
        run.lines.map((l) => ({
          assetId: l.assetId,
          amount: l.amount.toString(),
          projectId: l.projectId ?? null,
          costCategory: l.costCategory ?? null,
        })),
      ),
    run.totalAmount.scaled,
    run.journalEntryId,
    run.createdAt,
    run.postedAt,
    JSON.stringify((run.skippedLines ?? []).map((l) => ({ assetId: l.assetId, assetCode: l.assetCode, amount: l.amount.toString() }))),
  ];
}

class SqlDepreciationRunRepository implements DepreciationRunRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<DepreciationRun | null> {
    const row = await this.db.get<DepreciationRunRow>(`SELECT * FROM depreciation_run WHERE id = ?`, [id]);
    return row ? toDepreciationRun(row) : null;
  }

  async findByPeriod(period: string, branchId: string | null): Promise<DepreciationRun | null> {
    const row =
      branchId === null
        ? await this.db.get<DepreciationRunRow>(`SELECT * FROM depreciation_run WHERE period = ? AND branch_id IS NULL`, [period])
        : await this.db.get<DepreciationRunRow>(`SELECT * FROM depreciation_run WHERE period = ? AND branch_id = ?`, [period, branchId]);
    return row ? toDepreciationRun(row) : null;
  }

  async list(): Promise<DepreciationRun[]> {
    return (await this.db.all<DepreciationRunRow>(`SELECT * FROM depreciation_run`)).map(toDepreciationRun);
  }

  async create(run: DepreciationRun): Promise<void> {
    await insertNew(this.db, run.id, UPSERT_DEPRECIATION_RUN, depreciationRunParams(run));
  }

  async update(run: DepreciationRun): Promise<void> {
    await this.db.run(UPSERT_DEPRECIATION_RUN, depreciationRunParams(run));
  }
}

export async function ensureDepreciationRunSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_DEPRECIATION_RUN);
}

export function createDepreciationRunRepository(db: SqlDb): DepreciationRunRepository {
  return new SqlDepreciationRunRepository(db);
}

export interface SqliteDepreciationRunRepositoryHandle extends DepreciationRunRepository {
  close(): void;
}

/** Open a SQLite-backed DepreciationRunRepository. ":memory:" for tests, a path for real. */
export function createSqliteDepreciationRunRepository(path: SqliteConnectionInput = ":memory:"): SqliteDepreciationRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_DEPRECIATION_RUN);
  addRunSkippedLinesColumnIfMissing(sqlite);
  const repo = createDepreciationRunRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteDepreciationRunRepositoryHandle;
}
