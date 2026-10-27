import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { SqlDialect, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  RecurringJournalFrequency,
  RecurringJournalTemplateStatus,
  type CostCategory,
  type RecurringJournalRun,
  type RecurringJournalRunRepository,
  type RecurringJournalSkip,
  type RecurringJournalSkipRepository,
  type RecurringJournalTemplate,
  type RecurringJournalTemplateLine,
  type RecurringJournalTemplateRepository,
} from "@mezan/domain";

/**
 * SQLite persistence for ENH-E2-02 (recurring & template journal automation).
 * Two small tables on the shared tenant database: the templates, and the
 * generation history that makes `generate-due` idempotent per (template,
 * period) — `UNIQUE(template_id, period)` is the backstop against a
 * concurrent double-call racing the domain layer's own check.
 */

const CREATE_TEMPLATE = `
CREATE TABLE IF NOT EXISTS recurring_journal_template (
  id                      TEXT PRIMARY KEY,
  name_ar                 TEXT NOT NULL,
  name_en                 TEXT,
  memo                    TEXT NOT NULL,
  frequency               TEXT NOT NULL,
  day_of_period           INTEGER NOT NULL,
  yearly_month            INTEGER,
  start_date              TEXT NOT NULL,
  end_date                TEXT,
  auto_reverse_next_period INTEGER NOT NULL,
  status                  TEXT NOT NULL,
  lines                   TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
`;

const CREATE_RUN = `
CREATE TABLE IF NOT EXISTS recurring_journal_run (
  id                          TEXT PRIMARY KEY,
  template_id                 TEXT NOT NULL,
  period                      TEXT NOT NULL,
  generation                  INTEGER NOT NULL DEFAULT 1,
  journal_entry_id            TEXT NOT NULL,
  journal_entry_no            TEXT,
  reversal_journal_entry_id   TEXT,
  reversal_journal_entry_no   TEXT,
  generated_at                TEXT NOT NULL,
  generated_by                TEXT NOT NULL,
  UNIQUE(template_id, period, generation)
);
CREATE INDEX IF NOT EXISTS idx_recurring_journal_run_template ON recurring_journal_run(template_id);
`;

const RUN_COLUMNS_BEFORE_GENERATIONS = "id, template_id, period, journal_entry_id, journal_entry_no, reversal_journal_entry_id, reversal_journal_entry_no, generated_at, generated_by";

/** INVARIANT: a file written before generations keys a period by (template_id, period) alone, which SQLite cannot widen in place — the table is rebuilt under the new key with every row as generation 1, in one transaction, and a file already keyed by generation is left alone. */
function keyRunsByGeneration(sqlite: Database.Database): void {
  const table = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_journal_run'`).get();
  if (!table) return;
  const uniqueKeys = (sqlite.pragma(`index_list('recurring_journal_run')`) as { name: string; unique: number; origin: string }[])
    .filter((index) => index.unique === 1 && index.origin === "u")
    .map((index) => (sqlite.pragma(`index_info('${index.name}')`) as { name: string }[]).map((column) => column.name));
  if (uniqueKeys.some((columns) => columns.includes("generation"))) return;
  sqlite.transaction(() => {
    sqlite.exec(`ALTER TABLE recurring_journal_run RENAME TO recurring_journal_run_before_generations`);
    sqlite.exec(`DROP INDEX IF EXISTS idx_recurring_journal_run_template`);
    sqlite.exec(CREATE_RUN);
    sqlite.exec(`INSERT INTO recurring_journal_run (${RUN_COLUMNS_BEFORE_GENERATIONS}, generation) SELECT ${RUN_COLUMNS_BEFORE_GENERATIONS}, 1 FROM recurring_journal_run_before_generations`);
    sqlite.exec(`DROP TABLE recurring_journal_run_before_generations`);
  })();
}

const CREATE_SKIP = `
CREATE TABLE IF NOT EXISTS recurring_journal_skip (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL,
  period       TEXT NOT NULL,
  note         TEXT,
  skipped_at   TEXT NOT NULL,
  skipped_by   TEXT NOT NULL,
  UNIQUE(template_id, period)
);
CREATE INDEX IF NOT EXISTS idx_recurring_journal_skip_template ON recurring_journal_skip(template_id);
`;

interface TemplateLineWire {
  accountId: string;
  debit: string;
  credit: string;
  memo?: string | null;
  costCenterId?: string | null;
  branchId?: string | null;
  partyId?: string | null;
  projectId?: string | null;
  costCategory?: CostCategory | null;
}

function serializeLines(lines: readonly RecurringJournalTemplateLine[]): string {
  const wire: TemplateLineWire[] = lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit.toString(),
    credit: l.credit.toString(),
    memo: l.memo ?? null,
    costCenterId: l.costCenterId ?? null,
    branchId: l.branchId ?? null,
    partyId: l.partyId ?? null,
    projectId: l.projectId ?? null,
    costCategory: l.costCategory ?? null,
  }));
  return JSON.stringify(wire);
}

function deserializeLines(json: string): RecurringJournalTemplateLine[] {
  return (JSON.parse(json) as TemplateLineWire[]).map((l) => ({
    accountId: l.accountId,
    debit: Money.fromMajor(l.debit),
    credit: Money.fromMajor(l.credit),
    memo: l.memo ?? null,
    costCenterId: l.costCenterId ?? null,
    branchId: l.branchId ?? null,
    partyId: l.partyId ?? null,
    projectId: l.projectId ?? null,
    costCategory: l.costCategory ?? null,
  }));
}

interface TemplateRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  memo: string;
  frequency: string;
  day_of_period: bigint;
  yearly_month: bigint | null;
  start_date: string;
  end_date: string | null;
  auto_reverse_next_period: bigint;
  status: string;
  lines: string;
  created_at: string;
  updated_at: string;
}

function toTemplate(row: TemplateRow): RecurringJournalTemplate {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    memo: row.memo,
    frequency: row.frequency as RecurringJournalFrequency,
    dayOfPeriod: Number(row.day_of_period),
    yearlyMonth: row.yearly_month === null ? null : Number(row.yearly_month),
    startDate: row.start_date,
    endDate: row.end_date,
    autoReverseNextPeriod: Number(row.auto_reverse_next_period) === 1,
    status: row.status as RecurringJournalTemplateStatus,
    lines: deserializeLines(row.lines),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TEMPLATE_UPSERT = `
  INSERT INTO recurring_journal_template
    (id, name_ar, name_en, memo, frequency, day_of_period, yearly_month, start_date, end_date, auto_reverse_next_period, status, lines, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    memo = excluded.memo,
    frequency = excluded.frequency,
    day_of_period = excluded.day_of_period,
    yearly_month = excluded.yearly_month,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    auto_reverse_next_period = excluded.auto_reverse_next_period,
    status = excluded.status,
    lines = excluded.lines,
    updated_at = excluded.updated_at`;

function templateParams(template: RecurringJournalTemplate): SqlValue[] {
  return [
    template.id,
    template.nameAr,
    template.nameEn,
    template.memo,
    template.frequency,
    template.dayOfPeriod,
    template.yearlyMonth,
    template.startDate,
    template.endDate,
    template.autoReverseNextPeriod ? 1 : 0,
    template.status,
    serializeLines(template.lines),
    template.createdAt,
    template.updatedAt,
  ];
}

class SqlRecurringJournalTemplateRepository implements RecurringJournalTemplateRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<RecurringJournalTemplate | null> {
    const row = await this.db.get<TemplateRow>(`SELECT * FROM recurring_journal_template WHERE id = ?`, [id]);
    return row ? toTemplate(row) : null;
  }

  async list(): Promise<readonly RecurringJournalTemplate[]> {
    return (await this.db.all<TemplateRow>(`SELECT * FROM recurring_journal_template ORDER BY created_at ASC`)).map(toTemplate);
  }

  async save(template: RecurringJournalTemplate): Promise<void> {
    await this.db.run(TEMPLATE_UPSERT, templateParams(template));
  }

  async insert(template: RecurringJournalTemplate): Promise<void> {
    await insertNew(this.db, template.id, TEMPLATE_UPSERT, templateParams(template));
  }
}

function inTemplateIds(db: SqlDb): string {
  return db.dialect === SqlDialect.Postgres
    ? "template_id IN (SELECT jsonb_array_elements_text(CAST(? AS jsonb)))"
    : "template_id IN (SELECT value FROM json_each(?))";
}

interface RunRow {
  id: string;
  template_id: string;
  period: string;
  generation: bigint;
  journal_entry_id: string;
  journal_entry_no: string | null;
  reversal_journal_entry_id: string | null;
  reversal_journal_entry_no: string | null;
  generated_at: string;
  generated_by: string;
}

function toRun(row: RunRow): RecurringJournalRun {
  return {
    id: row.id,
    templateId: row.template_id,
    period: row.period,
    generation: Number(row.generation),
    journalEntryId: row.journal_entry_id,
    journalEntryNo: row.journal_entry_no,
    reversalJournalEntryId: row.reversal_journal_entry_id,
    reversalJournalEntryNo: row.reversal_journal_entry_no,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}

class SqlRecurringJournalRunRepository implements RecurringJournalRunRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<RecurringJournalRun | null> {
    const row = await this.db.get<RunRow>(`SELECT * FROM recurring_journal_run WHERE id = ?`, [id]);
    return row ? toRun(row) : null;
  }

  async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalRun | null> {
    const row = await this.db.get<RunRow>(
      `SELECT * FROM recurring_journal_run WHERE template_id = ? AND period = ? ORDER BY generation DESC LIMIT 1`,
      [templateId, period],
    );
    return row ? toRun(row) : null;
  }

  async listByTemplate(templateId: string): Promise<readonly RecurringJournalRun[]> {
    return (await this.db.all<RunRow>(`SELECT * FROM recurring_journal_run WHERE template_id = ? ORDER BY period DESC, generation DESC`, [templateId])).map(toRun);
  }

  async list(limit = 200, templateIds?: readonly string[]): Promise<readonly RecurringJournalRun[]> {
    const rows = templateIds
      ? await this.db.all<RunRow>(
          `SELECT * FROM recurring_journal_run WHERE ${inTemplateIds(this.db)} ORDER BY generated_at DESC, generation DESC LIMIT ?`,
          [JSON.stringify(templateIds), limit],
        )
      : await this.db.all<RunRow>(`SELECT * FROM recurring_journal_run ORDER BY generated_at DESC, generation DESC LIMIT ?`, [limit]);
    return rows.map(toRun);
  }

  // ON CONFLICT DO NOTHING is the DB-level half of the idempotency guarantee:
  // `false` means another call already claimed this generation of the period.
  async save(run: RecurringJournalRun): Promise<boolean> {
    const info = await this.db.run(
      `INSERT INTO recurring_journal_run
         (id, template_id, period, generation, journal_entry_id, journal_entry_no, reversal_journal_entry_id, reversal_journal_entry_no, generated_at, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(template_id, period, generation) DO NOTHING`,
      [
        run.id,
        run.templateId,
        run.period,
        run.generation,
        run.journalEntryId,
        run.journalEntryNo,
        run.reversalJournalEntryId,
        run.reversalJournalEntryNo,
        run.generatedAt,
        run.generatedBy,
      ],
    );
    return info.changes > 0;
  }
}

export interface SqliteRecurringJournalTemplateRepositoryHandle extends RecurringJournalTemplateRepository {
  close(): void;
}

export async function ensureRecurringJournalSchema(db: SqlDb): Promise<void> {
  await db.applySchema(`${CREATE_TEMPLATE}${CREATE_RUN}${CREATE_SKIP}`);
}

export function createRecurringJournalTemplateRepository(db: SqlDb): RecurringJournalTemplateRepository {
  return new SqlRecurringJournalTemplateRepository(db);
}

export function createRecurringJournalRunRepository(db: SqlDb): RecurringJournalRunRepository {
  return new SqlRecurringJournalRunRepository(db);
}

export function createRecurringJournalSkipRepository(db: SqlDb): RecurringJournalSkipRepository {
  return new SqlRecurringJournalSkipRepository(db);
}

export function createSqliteRecurringJournalTemplateRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteRecurringJournalTemplateRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TEMPLATE);
  return Object.assign(createRecurringJournalTemplateRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}

export interface SqliteRecurringJournalRunRepositoryHandle extends RecurringJournalRunRepository {
  close(): void;
}

export function createSqliteRecurringJournalRunRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteRecurringJournalRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  keyRunsByGeneration(sqlite);
  sqlite.exec(CREATE_RUN);
  return Object.assign(createRecurringJournalRunRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}

interface SkipRow {
  id: string;
  template_id: string;
  period: string;
  note: string | null;
  skipped_at: string;
  skipped_by: string;
}

function toSkip(row: SkipRow): RecurringJournalSkip {
  return {
    id: row.id,
    templateId: row.template_id,
    period: row.period,
    note: row.note,
    skippedAt: row.skipped_at,
    skippedBy: row.skipped_by,
  };
}

class SqlRecurringJournalSkipRepository implements RecurringJournalSkipRepository {
  constructor(private readonly db: SqlDb) {}

  async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalSkip | null> {
    const row = await this.db.get<SkipRow>(`SELECT * FROM recurring_journal_skip WHERE template_id = ? AND period = ?`, [templateId, period]);
    return row ? toSkip(row) : null;
  }

  async listByTemplate(templateId: string): Promise<readonly RecurringJournalSkip[]> {
    return (await this.db.all<SkipRow>(`SELECT * FROM recurring_journal_skip WHERE template_id = ? ORDER BY period DESC`, [templateId])).map(toSkip);
  }

  async list(limit = 200, templateIds?: readonly string[]): Promise<readonly RecurringJournalSkip[]> {
    const rows = templateIds
      ? await this.db.all<SkipRow>(
          `SELECT * FROM recurring_journal_skip WHERE ${inTemplateIds(this.db)} ORDER BY skipped_at DESC LIMIT ?`,
          [JSON.stringify(templateIds), limit],
        )
      : await this.db.all<SkipRow>(`SELECT * FROM recurring_journal_skip ORDER BY skipped_at DESC LIMIT ?`, [limit]);
    return rows.map(toSkip);
  }

  // Mirrors the run repository's claim: a concurrent double-call for the same
  // (template, period) leaves only the first skip.
  async save(skip: RecurringJournalSkip): Promise<boolean> {
    const info = await this.db.run(
      `INSERT INTO recurring_journal_skip (id, template_id, period, note, skipped_at, skipped_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(template_id, period) DO NOTHING`,
      [skip.id, skip.templateId, skip.period, skip.note, skip.skippedAt, skip.skippedBy],
    );
    return info.changes > 0;
  }
}

export interface SqliteRecurringJournalSkipRepositoryHandle extends RecurringJournalSkipRepository {
  close(): void;
}

export function createSqliteRecurringJournalSkipRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteRecurringJournalSkipRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_SKIP);
  return Object.assign(createRecurringJournalSkipRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}
