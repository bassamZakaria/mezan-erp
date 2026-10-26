import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import { childRowsByParentAsync, MAX_BOUND_PARAMS } from "./list-query.js";
import { escapeLike, placeholders, TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  NextNumberService,
  type JournalEntry,
  type JournalEntrySource,
  type JournalEntryStatus,
  type JournalLine,
  type SequenceStore,
  type SequenceConfigStore,
  type AccountBalance,
  type AccountLedgerLine,
  type JournalListFilter,
  type LedgerAggregateFilter,
  type LedgerRepository,
  type PostedLine,
  type PostedLineFilter,
  type TreasuryBalanceQuery,
} from "@mezan/domain";

// INVARIANT: number allocation and the entry insert are one atomic unit.
// `transaction()` takes the tenant's write lock (BEGIN IMMEDIATE on SQLite, the
// per-tenant advisory lock on Postgres) and the counter increment runs inside
// it, so two concurrent posts can never share or skip a JE number. Money is a
// scaled bigint end to end; it never passes through a JS number.

// branch_id is nullable by design: a line from before the branch dimension reads
// back with no branch, which is the «غير مخصص» bucket the branch statements show.
const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS journal_entry (
  id                   TEXT PRIMARY KEY,
  entry_no             TEXT UNIQUE,
  date                 TEXT NOT NULL,
  memo                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  source               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  posted_at            TEXT,
  reverses_entry_id    TEXT REFERENCES journal_entry(id),
  reversed_by_entry_id TEXT REFERENCES journal_entry(id),
  source_doc_type      TEXT,
  source_doc_id        TEXT,
  source_doc_number    TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_entry_date ON journal_entry(date);
CREATE INDEX IF NOT EXISTS idx_journal_entry_status ON journal_entry(status);
CREATE TABLE IF NOT EXISTS journal_line (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      TEXT NOT NULL REFERENCES journal_entry(id),
  line_no       INTEGER NOT NULL,
  account_id    TEXT NOT NULL,
  debit         BIGINT NOT NULL,
  credit        BIGINT NOT NULL,
  memo          TEXT,
  cost_center_id TEXT,
  currency      TEXT,
  fx_rate       TEXT,
  tax_rate_percent DOUBLE PRECISION,
  tax_rate_id   TEXT,
  project_id    TEXT,
  cost_category TEXT,
  branch_id     TEXT,
  party_id      TEXT,
  treasury_account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_line_entry ON journal_line(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_account ON journal_line(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_cost_center ON journal_line(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_tax_rate ON journal_line(tax_rate_id) WHERE tax_rate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_line_treasury_account ON journal_line(treasury_account_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_project ON journal_line(project_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_branch ON journal_line(branch_id);
CREATE TABLE IF NOT EXISTS sequence_counter (
  code   TEXT NOT NULL,
  period TEXT NOT NULL,
  value  BIGINT NOT NULL,
  PRIMARY KEY (code, period)
);
`;

interface EntryRow {
  id: string;
  entry_no: string | null;
  date: string;
  memo: string;
  status: string;
  source: string;
  created_at: string;
  posted_at: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  source_doc_type: string | null;
  source_doc_id: string | null;
  source_doc_number: string | null;
}

interface LineRow {
  line_no: bigint;
  account_id: string;
  debit: bigint;
  credit: bigint;
  memo: string | null;
  cost_center_id: string | null;
  currency: string | null;
  fx_rate: string | null;
  tax_rate_percent: number | null;
  tax_rate_id: string | null;
  project_id: string | null;
  cost_category: string | null;
  branch_id: string | null;
  party_id: string | null;
  treasury_account_id: string | null;
}

const LINE_COLUMNS = "line_no, account_id, debit, credit, memo, cost_center_id, currency, fx_rate, tax_rate_percent, tax_rate_id, project_id, cost_category, branch_id, party_id, treasury_account_id";

const LINE_INSERT_WIDTH = 16;

const POSTED = "je.status IN ('posted', 'reversed')";

/** Runs inside the ledger `transaction()`'s write lock; never opens its own. */
class SharedSequenceStore implements SequenceStore {
  constructor(private readonly db: SqlDb) {}

  async increment(code: string, period: number | null): Promise<number> {
    const row = await this.db.get<{ value: bigint }>(
      `INSERT INTO sequence_counter (code, period, value) VALUES (?, ?, 1)
       ON CONFLICT(code, period) DO UPDATE SET value = sequence_counter.value + 1
       RETURNING value`,
      [code, period === null ? "" : String(period)],
    );
    return Number(row!.value);
  }
}

function inList(values: readonly SqlValue[]): string {
  return `(${placeholders(values.length)})`;
}

class SqlLedgerRepository implements LedgerRepository {
  constructor(private readonly db: SqlDb) {}

  private async insertLines(entryId: string, lines: readonly JournalLine[]): Promise<void> {
    const rows = lines.map((line, index): SqlValue[] => [
          entryId,
          index,
          line.accountId,
          line.debit.scaled,
          line.credit.scaled,
          line.memo ?? null,
          line.costCenterId ?? null,
          line.currency ?? null,
          line.fxRate ?? null,
          line.taxRatePercent ?? null,
          line.taxRateId ?? null,
          line.projectId ?? null,
          line.costCategory ?? null,
          line.branchId ?? null,
          line.partyId ?? null,
          line.treasuryAccountId ?? null,
    ]);
    const perStatement = Math.floor(MAX_BOUND_PARAMS / LINE_INSERT_WIDTH);
    for (let start = 0; start < rows.length; start += perStatement) {
      const chunk = rows.slice(start, start + perStatement);
      await this.db.run(
        `INSERT INTO journal_line (entry_id, ${LINE_COLUMNS}) VALUES ${chunk.map(() => `(${placeholders(LINE_INSERT_WIDTH)})`).join(", ")}`,
        chunk.flat(),
      );
    }
  }

  async save(entry: JournalEntry): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO journal_entry
         (id, entry_no, date, memo, status, source, created_at, posted_at, reverses_entry_id, reversed_by_entry_id, source_doc_type, source_doc_id, source_doc_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      entryParams(entry),
    );
    refuseUnlessInserted(entry.id, inserted.changes);
    await this.insertLines(entry.id, entry.lines);
  }

  async update(entry: JournalEntry): Promise<void> {
    await this.db.run(
      `UPDATE journal_entry SET entry_no = ?, status = ?, posted_at = ?, reversed_by_entry_id = ?, source_doc_type = ?, source_doc_id = ?, source_doc_number = ?
        WHERE id = ?`,
      [
        entry.entryNo ?? null,
        entry.status,
        entry.postedAt ?? null,
        entry.reversedByEntryId ?? null,
        entry.sourceDocType ?? null,
        entry.sourceDocId ?? null,
        entry.sourceDocNumber ?? null,
        entry.id,
      ],
    );
  }

  async retagUnnamedTaxRate(entryId: string, taxRatePercent: number, taxRateId: string): Promise<number> {
    const result = await this.db.run(
      `UPDATE journal_line SET tax_rate_id = ?
        WHERE entry_id = ? AND tax_rate_id IS NULL AND tax_rate_percent = ?
          AND entry_id IN (SELECT id FROM journal_entry WHERE status <> 'draft')`,
      [taxRateId, entryId, taxRatePercent],
    );
    return result.changes;
  }

  async tagJournalLines(entryId: string, lineIndexes: readonly number[], taxRatePercent: number, taxRateId: string): Promise<number> {
    if (lineIndexes.length === 0) return 0;
    const result = await this.db.run(
      `UPDATE journal_line SET tax_rate_percent = ?, tax_rate_id = ?
        WHERE entry_id = ? AND tax_rate_id IS NULL AND (tax_rate_percent IS NULL OR tax_rate_percent = ?)
          AND entry_id IN (SELECT id FROM journal_entry WHERE status <> 'draft')
          AND line_no IN ${inList(lineIndexes)}`,
      [taxRatePercent, taxRateId, entryId, taxRatePercent, ...lineIndexes],
    );
    return result.changes;
  }

  async replaceDraft(entry: JournalEntry): Promise<void> {
    const updated = await this.db.run(
      `UPDATE journal_entry SET date = ?, memo = ?, source = ?, source_doc_type = ?, source_doc_id = ?, source_doc_number = ?
        WHERE id = ? AND status = 'draft'`,
      [entry.date, entry.memo, entry.source ?? "manual", entry.sourceDocType ?? null, entry.sourceDocId ?? null, entry.sourceDocNumber ?? null, entry.id],
    );
    if (updated.changes === 0) return;
    await this.deleteDraftLines(entry.id);
    await this.insertLines(entry.id, entry.lines);
  }

  private async deleteDraftLines(entryId: string): Promise<void> {
    await this.db.run(`DELETE FROM journal_line WHERE entry_id = ? AND entry_id IN (SELECT id FROM journal_entry WHERE status = 'draft')`, [entryId]);
  }

  async deleteDraft(entryId: string): Promise<void> {
    await this.deleteDraftLines(entryId);
    await this.db.run(`DELETE FROM journal_entry WHERE id = ? AND status = 'draft'`, [entryId]);
  }

  async findById(id: string): Promise<JournalEntry | null> {
    const row = await this.db.get<EntryRow>(`SELECT * FROM journal_entry WHERE id = ?`, [id]);
    return row ? this.hydrate(row) : null;
  }

  async entryDates(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const dates = new Map<string, string>();
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += MAX_BOUND_PARAMS) {
      const chunk = unique.slice(start, start + MAX_BOUND_PARAMS);
      const rows = await this.db.all<{ id: string; date: string }>(`SELECT id, date FROM journal_entry WHERE id IN ${inList(chunk)}`, chunk);
      for (const row of rows) dates.set(row.id, row.date);
    }
    return dates;
  }

  async findByEntryNo(entryNo: string): Promise<JournalEntry | null> {
    const row = await this.db.get<EntryRow>(`SELECT * FROM journal_entry WHERE entry_no = ?`, [entryNo]);
    return row ? this.hydrate(row) : null;
  }

  /** The `WHERE` shared by `list` and `count`, so a page and its total agree. */
  private listWhere(filter: JournalListFilter): { sql: string; params: SqlValue[] } {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.source) {
      clauses.push("source = ?");
      params.push(filter.source);
    }
    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    if (filter.sourceDocId) {
      clauses.push("source_doc_id = ?");
      params.push(filter.sourceDocId);
    }
    if (filter.sourceDocTypes) {
      // An empty set matches nothing, exactly as asked.
      if (filter.sourceDocTypes.length === 0) clauses.push("0 = 1");
      else {
        clauses.push(`source_doc_type IN ${inList(filter.sourceDocTypes)}`);
        params.push(...filter.sourceDocTypes);
      }
    }
    const term = filter.search?.trim();
    if (term) {
      const like = `%${escapeLike(term.toLowerCase())}%`;
      clauses.push(
        "(LOWER(COALESCE(entry_no, '')) LIKE ? ESCAPE '\\' OR LOWER(memo) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(source_doc_number, '')) LIKE ? ESCAPE '\\')",
      );
      params.push(like, like, like);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  async count(filter: JournalListFilter = {}): Promise<number> {
    const { sql, params } = this.listWhere(filter);
    const row = await this.db.get<{ n: bigint }>(`SELECT COUNT(*) AS n FROM journal_entry ${sql}`, params);
    return Number(row!.n);
  }

  async list(filter: JournalListFilter = {}): Promise<readonly JournalEntry[]> {
    const { sql: where, params } = this.listWhere(filter);
    let sql = `SELECT * FROM journal_entry ${where} ORDER BY date, id`;
    if (filter.limit !== undefined) {
      sql += " LIMIT ? OFFSET ?";
      params.push(filter.limit, filter.offset ?? 0);
    }
    const rows = await this.db.all<EntryRow>(sql, params);
    const linesByEntry = await childRowsByParentAsync<LineRow & { entry_id: string }>(this.db, {
      table: "journal_line",
      parentColumn: "entry_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "entry_id, line_no",
      columns: `entry_id, ${LINE_COLUMNS}`,
    });
    return Promise.all(rows.map((row) => this.hydrate(row, linesByEntry.get(row.id) ?? [])));
  }

  async treasuryAccountBalance(query: TreasuryBalanceQuery): Promise<Money> {
    const params: SqlValue[] = [query.accountId, query.treasuryAccountId];
    const attribution = query.withUnattributed
      ? "(jl.treasury_account_id = ? OR jl.treasury_account_id IS NULL)"
      : "jl.treasury_account_id = ?";
    let dateClause = "";
    if (query.asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(query.asOfDate);
    }
    const row = await this.db.get<{ net: bigint }>(
      `SELECT COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS net
         FROM journal_line jl
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE jl.account_id = ? AND ${POSTED} AND ${attribution} ${dateClause}`,
      params,
    );
    return Money.fromScaled(row!.net);
  }

  async accountBalance(accountId: string, asOfDate?: string): Promise<AccountBalance> {
    const params: SqlValue[] = [accountId];
    let dateClause = "";
    if (asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(asOfDate);
    }
    const row = await this.db.get<{ debit: bigint; credit: bigint }>(
      `SELECT COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
         FROM journal_line jl
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE jl.account_id = ? AND ${POSTED} ${dateClause}`,
      params,
    );
    return {
      accountId,
      debit: Money.fromScaled(row!.debit),
      credit: Money.fromScaled(row!.credit),
      balance: Money.fromScaled(row!.debit - row!.credit),
    };
  }

  async accountLedger(accountId: string, asOfDate?: string): Promise<readonly AccountLedgerLine[]> {
    const params: SqlValue[] = [accountId];
    let dateClause = "";
    if (asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(asOfDate);
    }
    // A voucher/invoice posting carries its description on the ENTRY, not on
    // the line, so a line-only memo reads blank for most of the ledger.
    const rows = await this.db.all<{ entry_id: string; entry_no: string | null; date: string; memo: string | null; debit: bigint; credit: bigint }>(
      `SELECT je.id AS entry_id, je.entry_no AS entry_no, je.date AS date,
              COALESCE(jl.memo, je.memo) AS memo, jl.debit AS debit, jl.credit AS credit
         FROM journal_line jl
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE jl.account_id = ? AND ${POSTED} ${dateClause}
        ORDER BY je.date, je.id, jl.line_no`,
      params,
    );
    return rows.map((r) => ({
      entryId: r.entry_id,
      entryNo: r.entry_no,
      date: r.date,
      memo: r.memo,
      debit: Money.fromScaled(r.debit),
      credit: Money.fromScaled(r.credit),
    }));
  }

  /** The shared `WHERE` for the two aggregates below. */
  private aggregateWhere(filter: LedgerAggregateFilter): { sql: string; params: SqlValue[] } {
    const statuses = filter.statuses ?? (["posted", "reversed"] as const);
    const params: SqlValue[] = [];
    const clauses: string[] = [];
    if (statuses.length === 0) clauses.push("0 = 1");
    else {
      clauses.push(`je.status IN ${inList(statuses)}`);
      params.push(...statuses);
    }
    if (filter.fromDate) { clauses.push("je.date >= ?"); params.push(filter.fromDate); }
    if (filter.toDate) { clauses.push("je.date <= ?"); params.push(filter.toDate); }
    if (filter.sourceDocTypes) {
      if (filter.sourceDocTypes.length === 0) clauses.push("0 = 1");
      else {
        clauses.push(`je.source_doc_type IN ${inList(filter.sourceDocTypes)}`);
        params.push(...filter.sourceDocTypes);
      }
    }
    if (filter.excludeSourceDocTypes && filter.excludeSourceDocTypes.length > 0) {
      clauses.push(`(je.source_doc_type IS NULL OR je.source_doc_type NOT IN ${inList(filter.excludeSourceDocTypes)})`);
      params.push(...filter.excludeSourceDocTypes);
    }
    if (filter.accountIds) {
      if (filter.accountIds.length === 0) clauses.push("0 = 1");
      else {
        clauses.push(`jl.account_id IN ${inList(filter.accountIds)}`);
        params.push(...filter.accountIds);
      }
    }
    return { sql: clauses.join(" AND "), params };
  }

  async accountBalances(filter: LedgerAggregateFilter = {}): Promise<ReadonlyMap<string, Money>> {
    const { sql, params } = this.aggregateWhere(filter);
    const rows = await this.db.all<{ account_id: string; net: bigint }>(
      `SELECT jl.account_id AS account_id, SUM(jl.debit) - SUM(jl.credit) AS net
         FROM journal_line jl
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE ${sql}
        GROUP BY jl.account_id`,
      params,
    );
    return new Map(rows.map((r) => [r.account_id, Money.fromScaled(r.net)]));
  }

  async sumLines(filter: LedgerAggregateFilter = {}): Promise<{ debit: Money; credit: Money }> {
    const { sql, params } = this.aggregateWhere(filter);
    const row = await this.db.get<{ debit: bigint; credit: bigint }>(
      `SELECT COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
         FROM journal_line jl
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE ${sql}`,
      params,
    );
    return { debit: Money.fromScaled(row!.debit), credit: Money.fromScaled(row!.credit) };
  }

  async listLines(filter: PostedLineFilter = {}): Promise<readonly PostedLine[]> {
    const clauses = [POSTED];
    const params: SqlValue[] = [];
    if (filter.fromDate) {
      clauses.push("je.date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("je.date <= ?");
      params.push(filter.toDate);
    }
    if (filter.costCenterId !== undefined) {
      clauses.push("jl.cost_center_id = ?");
      params.push(filter.costCenterId);
    }
    if (filter.projectId !== undefined) {
      clauses.push("jl.project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.branchId !== undefined) {
      clauses.push("jl.branch_id = ?");
      params.push(filter.branchId);
    }
    if (filter.accountIds && filter.accountIds.length > 0) {
      clauses.push(`jl.account_id IN ${inList(filter.accountIds)}`);
      params.push(...filter.accountIds);
    }
    const rows = await this.db.all<{
      entry_id: string;
      entry_no: string | null;
      date: string;
      source: string;
      account_id: string;
      cost_center_id: string | null;
      project_id: string | null;
      cost_category: string | null;
      branch_id: string | null;
      party_id: string | null;
      source_doc_type: string | null;
      source_doc_id: string | null;
      currency: string | null;
      fx_rate: string | null;
      memo: string | null;
      debit: bigint;
      credit: bigint;
    }>(
      `SELECT je.id AS entry_id, je.entry_no AS entry_no, je.date AS date, je.source AS source,
              jl.account_id AS account_id, jl.cost_center_id AS cost_center_id,
              jl.project_id AS project_id, jl.cost_category AS cost_category, jl.branch_id AS branch_id,
              jl.party_id AS party_id, je.source_doc_type AS source_doc_type, je.source_doc_id AS source_doc_id,
              jl.currency AS currency, jl.fx_rate AS fx_rate, jl.memo AS memo,
              jl.debit AS debit, jl.credit AS credit
         FROM journal_line jl
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY je.date, je.id, jl.line_no`,
      params,
    );
    return rows.map((r) => ({
      entryId: r.entry_id,
      entryNo: r.entry_no,
      date: r.date,
      source: r.source as PostedLine["source"],
      accountId: r.account_id,
      costCenterId: r.cost_center_id,
      projectId: r.project_id,
      costCategory: r.cost_category as PostedLine["costCategory"],
      branchId: r.branch_id,
      partyId: r.party_id,
      sourceDocType: r.source_doc_type,
      sourceDocId: r.source_doc_id,
      currency: r.currency,
      fxRate: r.fx_rate,
      memo: r.memo,
      debit: Money.fromScaled(r.debit),
      credit: Money.fromScaled(r.credit),
    }));
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn, TransactionMode.Immediate);
  }

  private async hydrate(row: EntryRow, preloadedLines?: readonly LineRow[]): Promise<JournalEntry> {
    const lineRows = preloadedLines ?? (await this.db.all<LineRow>(`SELECT ${LINE_COLUMNS} FROM journal_line WHERE entry_id = ? ORDER BY line_no`, [row.id]));
    const lines: JournalLine[] = lineRows.map((l) => ({
      accountId: l.account_id,
      debit: Money.fromScaled(l.debit),
      credit: Money.fromScaled(l.credit),
      memo: l.memo,
      costCenterId: l.cost_center_id,
      projectId: l.project_id,
      costCategory: l.cost_category as JournalLine["costCategory"],
      branchId: l.branch_id,
      partyId: l.party_id,
      treasuryAccountId: l.treasury_account_id,
      taxRatePercent: l.tax_rate_percent === null ? null : Number(l.tax_rate_percent),
      taxRateId: l.tax_rate_id,
      currency: l.currency,
      fxRate: l.fx_rate,
    }));
    return {
      id: row.id,
      entryNo: row.entry_no,
      date: row.date,
      memo: row.memo,
      status: row.status as JournalEntryStatus,
      source: row.source as JournalEntrySource,
      lines,
      createdAt: row.created_at,
      postedAt: row.posted_at,
      reversesEntryId: row.reverses_entry_id,
      reversedByEntryId: row.reversed_by_entry_id,
      sourceDocType: row.source_doc_type,
      sourceDocId: row.source_doc_id,
      sourceDocNumber: row.source_doc_number,
    };
  }
}

function entryParams(entry: JournalEntry): SqlValue[] {
  return [
    entry.id,
    entry.entryNo ?? null,
    entry.date,
    entry.memo,
    entry.status,
    entry.source ?? "manual",
    entry.createdAt ?? new Date().toISOString(),
    entry.postedAt ?? null,
    entry.reversesEntryId ?? null,
    entry.reversedByEntryId ?? null,
    entry.sourceDocType ?? null,
    entry.sourceDocId ?? null,
    entry.sourceDocNumber ?? null,
  ];
}

export interface LedgerStoreHandle extends LedgerRepository {
  /** JE numbering engine bound to the SAME connection — pass as `deps.numbering`. */
  readonly numbering: NextNumberService;
}

export interface SqliteLedgerStoreHandle extends LedgerStoreHandle {
  close(): void;
}

export async function ensureLedgerSchema(db: SqlDb): Promise<void> {
  await db.applySchema(LEDGER_DDL);
}

export function createLedgerStore(db: SqlDb, configStore?: SequenceConfigStore): LedgerStoreHandle {
  const repo = new SqlLedgerRepository(db);
  const numbering = new NextNumberService(new SharedSequenceStore(db), configStore);
  return Object.assign(repo, { numbering }) as LedgerStoreHandle;
}

/**
 * Open a SQLite-backed ledger store. ":memory:" for tests, a file path for a
 * real (WAL) desktop database. The returned handle is both the
 * {@link LedgerRepository} and the connection-bound numbering engine, so the
 * GL engine's `deps.ledger` and `deps.numbering` share one transaction.
 */
export function createSqliteLedgerStore(
  path: SqliteConnectionInput = ":memory:",
  configStore?: SequenceConfigStore,
): SqliteLedgerStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(LEDGER_DDL);
  return Object.assign(createLedgerStore(sqliteDb(sqlite), configStore), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteLedgerStoreHandle;
}
