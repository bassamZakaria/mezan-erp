import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  day_of_period: number;
  yearly_month: number | null;
  start_date: string;
  end_date: string | null;
  auto_reverse_next_period: number;
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
    dayOfPeriod: row.day_of_period,
    yearlyMonth: row.yearly_month,
    startDate: row.start_date,
    endDate: row.end_date,
    autoReverseNextPeriod: row.auto_reverse_next_period === 1,
    status: row.status as RecurringJournalTemplateStatus,
    lines: deserializeLines(row.lines),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteRecurringJournalTemplateRepository implements RecurringJournalTemplateRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO recurring_journal_template
        (id, name_ar, name_en, memo, frequency, day_of_period, yearly_month, start_date, end_date, auto_reverse_next_period, status, lines, created_at, updated_at)
      VALUES
        (@id, @name_ar, @name_en, @memo, @frequency, @day_of_period, @yearly_month, @start_date, @end_date, @auto_reverse_next_period, @status, @lines, @created_at, @updated_at)
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
        updated_at = excluded.updated_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM recurring_journal_template WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM recurring_journal_template ORDER BY created_at ASC`);
  }

  async findById(id: string): Promise<RecurringJournalTemplate | null> {
    const row = this.selectById.get(id) as TemplateRow | undefined;
    return row ? toTemplate(row) : null;
  }

  async list(): Promise<readonly RecurringJournalTemplate[]> {
    return (this.selectAll.all() as TemplateRow[]).map(toTemplate);
  }

  async save(template: RecurringJournalTemplate): Promise<void> {
    this.upsert.run({
      id: template.id,
      name_ar: template.nameAr,
      name_en: template.nameEn,
      memo: template.memo,
      frequency: template.frequency,
      day_of_period: template.dayOfPeriod,
      yearly_month: template.yearlyMonth,
      start_date: template.startDate,
      end_date: template.endDate,
      auto_reverse_next_period: template.autoReverseNextPeriod ? 1 : 0,
      status: template.status,
      lines: serializeLines(template.lines),
      created_at: template.createdAt,
      updated_at: template.updatedAt,
    });
  }
}

interface RunRow {
  id: string;
  template_id: string;
  period: string;
  generation: number;
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
    generation: row.generation,
    journalEntryId: row.journal_entry_id,
    journalEntryNo: row.journal_entry_no,
    reversalJournalEntryId: row.reversal_journal_entry_id,
    reversalJournalEntryNo: row.reversal_journal_entry_no,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}

class SqliteRecurringJournalRunRepository implements RecurringJournalRunRepository {
  private readonly insert: Database.Statement;
  private readonly selectByTemplateAndPeriod: Database.Statement;
  private readonly selectByTemplate: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    // ON CONFLICT DO NOTHING is the DB-level half of the idempotency
    // guarantee: even a concurrent double-call for the same generation of a
    // (template, period) leaves only the first run's row.
    this.insert = sqlite.prepare(`
      INSERT INTO recurring_journal_run
        (id, template_id, period, generation, journal_entry_id, journal_entry_no, reversal_journal_entry_id, reversal_journal_entry_no, generated_at, generated_by)
      VALUES
        (@id, @template_id, @period, @generation, @journal_entry_id, @journal_entry_no, @reversal_journal_entry_id, @reversal_journal_entry_no, @generated_at, @generated_by)
      ON CONFLICT(template_id, period, generation) DO NOTHING
    `);
    this.selectByTemplateAndPeriod = sqlite.prepare(
      `SELECT * FROM recurring_journal_run WHERE template_id = ? AND period = ? ORDER BY generation DESC LIMIT 1`,
    );
    this.selectByTemplate = sqlite.prepare(
      `SELECT * FROM recurring_journal_run WHERE template_id = ? ORDER BY period DESC, generation DESC`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM recurring_journal_run ORDER BY generated_at DESC, generation DESC LIMIT ?`);
  }

  async findById(id: string): Promise<RecurringJournalRun | null> {
    const row = this.sqlite.prepare(`SELECT * FROM recurring_journal_run WHERE id = ?`).get(id) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalRun | null> {
    const row = this.selectByTemplateAndPeriod.get(templateId, period) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  async listByTemplate(templateId: string): Promise<readonly RecurringJournalRun[]> {
    return (this.selectByTemplate.all(templateId) as RunRow[]).map(toRun);
  }

  async list(limit = 200): Promise<readonly RecurringJournalRun[]> {
    return (this.selectAll.all(limit) as RunRow[]).map(toRun);
  }

  async save(run: RecurringJournalRun): Promise<boolean> {
    return this.insertRun(run);
  }

  private insertRun(run: RecurringJournalRun): boolean {
    // `changes === 0` is exactly the ON CONFLICT DO NOTHING path: another
    // call already claimed this (template, period) first.
    const info = this.insert.run({
      id: run.id,
      template_id: run.templateId,
      period: run.period,
      generation: run.generation,
      journal_entry_id: run.journalEntryId,
      journal_entry_no: run.journalEntryNo,
      reversal_journal_entry_id: run.reversalJournalEntryId,
      reversal_journal_entry_no: run.reversalJournalEntryNo,
      generated_at: run.generatedAt,
      generated_by: run.generatedBy,
    });
    return info.changes > 0;
  }
}

export interface SqliteRecurringJournalTemplateRepositoryHandle extends RecurringJournalTemplateRepository {
  close(): void;
}

export function createSqliteRecurringJournalTemplateRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteRecurringJournalTemplateRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TEMPLATE);
  const repo = new SqliteRecurringJournalTemplateRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } });
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
  const repo = new SqliteRecurringJournalRunRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } });
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

class SqliteRecurringJournalSkipRepository implements RecurringJournalSkipRepository {
  private readonly insert: Database.Statement;
  private readonly selectByTemplateAndPeriod: Database.Statement;
  private readonly selectByTemplate: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    // ON CONFLICT DO NOTHING mirrors the run repository's claim: a concurrent
    // double-call for the same (template, period) leaves only the first skip.
    this.insert = sqlite.prepare(`
      INSERT INTO recurring_journal_skip
        (id, template_id, period, note, skipped_at, skipped_by)
      VALUES
        (@id, @template_id, @period, @note, @skipped_at, @skipped_by)
      ON CONFLICT(template_id, period) DO NOTHING
    `);
    this.selectByTemplateAndPeriod = sqlite.prepare(
      `SELECT * FROM recurring_journal_skip WHERE template_id = ? AND period = ?`,
    );
    this.selectByTemplate = sqlite.prepare(
      `SELECT * FROM recurring_journal_skip WHERE template_id = ? ORDER BY period DESC`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM recurring_journal_skip ORDER BY skipped_at DESC LIMIT ?`);
  }

  async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalSkip | null> {
    const row = this.selectByTemplateAndPeriod.get(templateId, period) as SkipRow | undefined;
    return row ? toSkip(row) : null;
  }

  async listByTemplate(templateId: string): Promise<readonly RecurringJournalSkip[]> {
    return (this.selectByTemplate.all(templateId) as SkipRow[]).map(toSkip);
  }

  async list(limit = 200): Promise<readonly RecurringJournalSkip[]> {
    return (this.selectAll.all(limit) as SkipRow[]).map(toSkip);
  }

  async save(skip: RecurringJournalSkip): Promise<boolean> {
    const info = this.insert.run({
      id: skip.id,
      template_id: skip.templateId,
      period: skip.period,
      note: skip.note,
      skipped_at: skip.skippedAt,
      skipped_by: skip.skippedBy,
    });
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
  const repo = new SqliteRecurringJournalSkipRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } });
}
