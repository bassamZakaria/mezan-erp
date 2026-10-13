import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  default_useful_life_months: number;
  default_salvage_percent: number;
  asset_account_id: string | null;
  depreciation_expense_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  gain_on_disposal_account_id: string | null;
  loss_on_disposal_account_id: string | null;
  active: number;
}

function toAssetCategory(row: AssetCategoryRow): AssetCategory {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    defaultDepreciationMethod: row.default_depreciation_method as DepreciationMethod,
    defaultUsefulLifeMonths: row.default_useful_life_months,
    defaultSalvagePercent: row.default_salvage_percent,
    assetAccountId: row.asset_account_id,
    depreciationExpenseAccountId: row.depreciation_expense_account_id,
    accumulatedDepreciationAccountId: row.accumulated_depreciation_account_id,
    gainOnDisposalAccountId: row.gain_on_disposal_account_id,
    lossOnDisposalAccountId: row.loss_on_disposal_account_id,
    active: row.active === 1,
  };
}

class SqliteAssetCategoryRepository implements AssetCategoryRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO asset_category (
        id, code, name_ar, name_en, default_depreciation_method, default_useful_life_months,
        default_salvage_percent, asset_account_id, depreciation_expense_account_id,
        accumulated_depreciation_account_id, gain_on_disposal_account_id, loss_on_disposal_account_id, active
      )
      VALUES (
        @id, @code, @name_ar, @name_en, @default_depreciation_method, @default_useful_life_months,
        @default_salvage_percent, @asset_account_id, @depreciation_expense_account_id,
        @accumulated_depreciation_account_id, @gain_on_disposal_account_id, @loss_on_disposal_account_id, @active
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
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM asset_category WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM asset_category WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM asset_category`);
  }

  async findById(id: string): Promise<AssetCategory | null> {
    const row = this.selectById.get(id) as AssetCategoryRow | undefined;
    return row ? toAssetCategory(row) : null;
  }

  async findByCode(code: string): Promise<AssetCategory | null> {
    const row = this.selectByCode.get(code) as AssetCategoryRow | undefined;
    return row ? toAssetCategory(row) : null;
  }

  async list(): Promise<AssetCategory[]> {
    return (this.selectAll.all() as AssetCategoryRow[]).map(toAssetCategory);
  }

  async create(category: AssetCategory): Promise<void> {
    this.write(category);
  }

  async update(category: AssetCategory): Promise<void> {
    this.write(category);
  }

  private write(category: AssetCategory): void {
    this.upsert.run({
      id: category.id,
      code: category.code,
      name_ar: category.nameAr,
      name_en: category.nameEn,
      default_depreciation_method: category.defaultDepreciationMethod,
      default_useful_life_months: category.defaultUsefulLifeMonths,
      default_salvage_percent: category.defaultSalvagePercent,
      asset_account_id: category.assetAccountId,
      depreciation_expense_account_id: category.depreciationExpenseAccountId,
      accumulated_depreciation_account_id: category.accumulatedDepreciationAccountId,
      gain_on_disposal_account_id: category.gainOnDisposalAccountId,
      loss_on_disposal_account_id: category.lossOnDisposalAccountId,
      active: category.active ? 1 : 0,
    });
  }
}

export interface SqliteAssetCategoryRepositoryHandle extends AssetCategoryRepository {
  close(): void;
}

/** Open a SQLite-backed AssetCategoryRepository. ":memory:" for tests, a path for real. */
export function createSqliteAssetCategoryRepository(path: SqliteConnectionInput = ":memory:"): SqliteAssetCategoryRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ASSET_CATEGORY);
  const repo = new SqliteAssetCategoryRepository(sqlite);
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
  internal_hourly_rate                 INTEGER
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
  acquisition_cost: number;
  depreciation_start_date: string;
  depreciation_method: string;
  useful_life_months: number;
  salvage_value: number;
  accumulated_depreciation: number;
  status: string;
  asset_account_id: string | null;
  depreciation_expense_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  notes: string | null;
  project_id: string | null;
  internal_hourly_rate: number | null;
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
    usefulLifeMonths: row.useful_life_months,
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

class SqliteAssetRepository implements AssetRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO asset (
        id, code, name_ar, name_en, category_id, scope, branch_id, warehouse_id, acquisition_date,
        acquisition_cost, depreciation_start_date, depreciation_method, useful_life_months, salvage_value,
        accumulated_depreciation, status, asset_account_id, depreciation_expense_account_id,
        accumulated_depreciation_account_id, notes, project_id, internal_hourly_rate
      )
      VALUES (
        @id, @code, @name_ar, @name_en, @category_id, @scope, @branch_id, @warehouse_id, @acquisition_date,
        @acquisition_cost, @depreciation_start_date, @depreciation_method, @useful_life_months, @salvage_value,
        @accumulated_depreciation, @status, @asset_account_id, @depreciation_expense_account_id,
        @accumulated_depreciation_account_id, @notes, @project_id, @internal_hourly_rate
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
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM asset WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM asset WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM asset`);
  }

  async findById(id: string): Promise<Asset | null> {
    const row = this.selectById.get(id) as AssetRow | undefined;
    return row ? toAsset(row) : null;
  }

  async findByCode(code: string): Promise<Asset | null> {
    const row = this.selectByCode.get(code) as AssetRow | undefined;
    return row ? toAsset(row) : null;
  }

  async list(): Promise<Asset[]> {
    return (this.selectAll.all() as AssetRow[]).map(toAsset);
  }

  async create(asset: Asset): Promise<void> {
    this.write(asset);
  }

  async update(asset: Asset): Promise<void> {
    this.write(asset);
  }

  private write(asset: Asset): void {
    this.upsert.run({
      id: asset.id,
      code: asset.code,
      name_ar: asset.nameAr,
      name_en: asset.nameEn,
      category_id: asset.categoryId,
      scope: asset.scope,
      branch_id: asset.branchId,
      warehouse_id: asset.warehouseId,
      acquisition_date: asset.acquisitionDate,
      acquisition_cost: asset.acquisitionCost.toScaledNumber(),
      depreciation_start_date: asset.depreciationStartDate,
      depreciation_method: asset.depreciationMethod,
      useful_life_months: asset.usefulLifeMonths,
      salvage_value: asset.salvageValue.toScaledNumber(),
      accumulated_depreciation: asset.accumulatedDepreciation.toScaledNumber(),
      status: asset.status,
      asset_account_id: asset.assetAccountId,
      depreciation_expense_account_id: asset.depreciationExpenseAccountId,
      accumulated_depreciation_account_id: asset.accumulatedDepreciationAccountId,
      notes: asset.notes,
      project_id: asset.projectId,
      internal_hourly_rate: asset.internalHourlyRate?.toScaledNumber() ?? null,
    });
  }
}

export interface SqliteAssetRepositoryHandle extends AssetRepository {
  close(): void;
}

/** Open a SQLite-backed AssetRepository. ":memory:" for tests, a path for real. */
export function createSqliteAssetRepository(path: SqliteConnectionInput = ":memory:"): SqliteAssetRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ASSET);
  addAssetProjectColumnIfMissing(sqlite);
  const repo = new SqliteAssetRepository(sqlite);
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
  hourly_rate: number;
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

class SqliteAssetInternalRateHistoryRepository implements AssetInternalRateHistoryRepository {
  private readonly upsert: Database.Statement;
  private readonly selectByAsset: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO asset_internal_rate_history (asset_id, effective_from, hourly_rate, set_by, set_at)
      VALUES (@asset_id, @effective_from, @hourly_rate, @set_by, @set_at)
      ON CONFLICT(asset_id, effective_from) DO UPDATE SET
        hourly_rate = excluded.hourly_rate,
        set_by = excluded.set_by,
        set_at = excluded.set_at
    `);
    this.selectByAsset = sqlite.prepare(
      `SELECT * FROM asset_internal_rate_history WHERE asset_id = ? ORDER BY effective_from, set_at`,
    );
    this.selectAll = sqlite.prepare(
      `SELECT * FROM asset_internal_rate_history ORDER BY asset_id, effective_from, set_at`,
    );
  }

  async list(assetId: string): Promise<readonly AssetInternalRateRow[]> {
    return (this.selectByAsset.all(assetId) as AssetInternalRateHistoryRow[]).map(toRateRow);
  }

  async listAll(): Promise<readonly AssetInternalRateRow[]> {
    return (this.selectAll.all() as AssetInternalRateHistoryRow[]).map(toRateRow);
  }

  async append(row: AssetInternalRateRow): Promise<void> {
    this.upsert.run({
      asset_id: row.assetId,
      effective_from: row.effectiveFrom,
      hourly_rate: row.hourlyRate.toScaledNumber(),
      set_by: row.setBy,
      set_at: row.setAt,
    });
  }
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
  const repo = new SqliteAssetInternalRateHistoryRepository(sqlite);
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
  total_amount: number;
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

class SqliteDepreciationRunRepository implements DepreciationRunRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByPeriodBranch: Database.Statement;
  private readonly selectByPeriodNullBranch: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO depreciation_run (id, period, branch_id, status, lines, total_amount, journal_entry_id, created_at, posted_at, skipped_lines)
      VALUES (@id, @period, @branch_id, @status, @lines, @total_amount, @journal_entry_id, @created_at, @posted_at, @skipped_lines)
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
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM depreciation_run WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM depreciation_run`);
    this.selectByPeriodBranch = sqlite.prepare(`SELECT * FROM depreciation_run WHERE period = ? AND branch_id = ?`);
    this.selectByPeriodNullBranch = sqlite.prepare(
      `SELECT * FROM depreciation_run WHERE period = ? AND branch_id IS NULL`,
    );
  }

  async findById(id: string): Promise<DepreciationRun | null> {
    const row = this.selectById.get(id) as DepreciationRunRow | undefined;
    return row ? toDepreciationRun(row) : null;
  }

  async findByPeriod(period: string, branchId: string | null): Promise<DepreciationRun | null> {
    const row = (
      branchId === null
        ? this.selectByPeriodNullBranch.get(period)
        : this.selectByPeriodBranch.get(period, branchId)
    ) as DepreciationRunRow | undefined;
    return row ? toDepreciationRun(row) : null;
  }

  async list(): Promise<DepreciationRun[]> {
    return (this.selectAll.all() as DepreciationRunRow[]).map(toDepreciationRun);
  }

  async create(run: DepreciationRun): Promise<void> {
    this.write(run);
  }

  async update(run: DepreciationRun): Promise<void> {
    this.write(run);
  }

  private write(run: DepreciationRun): void {
    this.upsert.run({
      id: run.id,
      period: run.period,
      branch_id: run.branchId,
      status: run.status,
      lines: JSON.stringify(
        run.lines.map((l) => ({
          assetId: l.assetId,
          amount: l.amount.toString(),
          projectId: l.projectId ?? null,
          costCategory: l.costCategory ?? null,
        })),
      ),
      total_amount: run.totalAmount.toScaledNumber(),
      journal_entry_id: run.journalEntryId,
      created_at: run.createdAt,
      posted_at: run.postedAt,
      skipped_lines: JSON.stringify((run.skippedLines ?? []).map((l) => ({ assetId: l.assetId, assetCode: l.assetCode, amount: l.amount.toString() }))),
    });
  }
}

export interface SqliteDepreciationRunRepositoryHandle extends DepreciationRunRepository {
  close(): void;
}

/** Open a SQLite-backed DepreciationRunRepository. ":memory:" for tests, a path for real. */
export function createSqliteDepreciationRunRepository(path: SqliteConnectionInput = ":memory:"): SqliteDepreciationRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_DEPRECIATION_RUN);
  addRunSkippedLinesColumnIfMissing(sqlite);
  const repo = new SqliteDepreciationRunRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteDepreciationRunRepositoryHandle;
}
