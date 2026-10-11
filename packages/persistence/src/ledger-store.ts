import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { childRowsByParent } from "./list-query.js";
import {
  JournalLineSide,
  Money,
  NextNumberService,
  type UntaggedJournalLineSelector,
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
} from "@mezan/domain";

/**
 * SQLite-backed {@link LedgerRepository} — the real GL ledger store.
 *
 * One connection owns `journal_entry`, `journal_line` and `sequence_counter`
 * together, because number allocation and the entry insert must be atomic:
 * `transaction()` opens `BEGIN IMMEDIATE` (SQLite's write lock at statement
 * start), and the numbering `increment` runs plain SQL *inside* that lock, so
 * two concurrent posts can never share or skip a JE number (docs/archive/plan.md §2.3
 * rule 5 / §3 rule 5). Money is stored as INTEGER at scale 1e-6 and read back
 * with `safeIntegers()` so a large ledger's sums never touch IEEE-754.
 */

const CREATE_TABLES = `
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
  debit         INTEGER NOT NULL,
  credit        INTEGER NOT NULL,
  memo          TEXT,
  cost_center_id TEXT,
  currency      TEXT,
  fx_rate       TEXT,
  tax_rate_percent REAL,
  tax_rate_id   TEXT,
  project_id    TEXT,
  cost_category TEXT,
  branch_id     TEXT,
  party_id      TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_line_entry ON journal_line(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_account ON journal_line(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_cost_center ON journal_line(cost_center_id);
CREATE TABLE IF NOT EXISTS sequence_counter (
  code   TEXT NOT NULL,
  period TEXT NOT NULL,
  value  INTEGER NOT NULL,
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
}

/**
 * A {@link SequenceStore} bound to a shared connection that does NOT open its
 * own transaction — it runs inside the ledger `transaction()`'s BEGIN IMMEDIATE.
 */
class SharedSequenceStore implements SequenceStore {
  private readonly upsert: Database.Statement;
  private readonly read: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO sequence_counter (code, period, value) VALUES (?, ?, 1)
       ON CONFLICT(code, period) DO UPDATE SET value = value + 1`,
    );
    this.read = sqlite.prepare(
      `SELECT value FROM sequence_counter WHERE code = ? AND period = ?`,
    );
  }

  async increment(code: string, period: number | null): Promise<number> {
    const p = period === null ? "" : String(period);
    this.upsert.run(code, p);
    const row = this.read.get(code, p) as { value: number };
    return row.value;
  }
}

class SqliteLedgerRepository implements LedgerRepository {
  private readonly insertEntry: Database.Statement;
  private readonly updateEntry: Database.Statement;
  private readonly updateDraftEntry: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly deleteLinesByEntry: Database.Statement;
  private readonly retagTaxRate: Database.Statement;
  private readonly deleteEntryById: Database.Statement;
  private readonly selectEntryById: Database.Statement;
  private readonly selectEntryByNo: Database.Statement;
  private readonly selectLines: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertEntry = sqlite.prepare(`
      INSERT INTO journal_entry
        (id, entry_no, date, memo, status, source, created_at, posted_at, reverses_entry_id, reversed_by_entry_id, source_doc_type, source_doc_id, source_doc_number)
      VALUES
        (@id, @entry_no, @date, @memo, @status, @source, @created_at, @posted_at, @reverses_entry_id, @reversed_by_entry_id, @source_doc_type, @source_doc_id, @source_doc_number)
    `);
    this.updateEntry = sqlite.prepare(`
      UPDATE journal_entry SET
        entry_no = @entry_no,
        status = @status,
        posted_at = @posted_at,
        reversed_by_entry_id = @reversed_by_entry_id,
        source_doc_type = @source_doc_type,
        source_doc_id = @source_doc_id,
        source_doc_number = @source_doc_number
      WHERE id = @id
    `);
    this.updateDraftEntry = sqlite.prepare(`
      UPDATE journal_entry SET
        date = @date,
        memo = @memo,
        source = @source,
        source_doc_type = @source_doc_type,
        source_doc_id = @source_doc_id,
        source_doc_number = @source_doc_number
      WHERE id = @id AND status = 'draft'
    `);
    this.insertLine = sqlite.prepare(`
      INSERT INTO journal_line (entry_id, line_no, account_id, debit, credit, memo, cost_center_id, currency, fx_rate, tax_rate_percent, tax_rate_id, project_id, cost_category, branch_id, party_id)
      VALUES (@entry_id, @line_no, @account_id, @debit, @credit, @memo, @cost_center_id, @currency, @fx_rate, @tax_rate_percent, @tax_rate_id, @project_id, @cost_category, @branch_id, @party_id)
    `);
    this.retagTaxRate = sqlite.prepare(`
      UPDATE journal_line SET tax_rate_id = @tax_rate_id
      WHERE entry_id = @entry_id AND tax_rate_id IS NULL AND tax_rate_percent = @tax_rate_percent
        AND entry_id IN (SELECT id FROM journal_entry WHERE status <> 'draft')
    `);
    this.deleteLinesByEntry = sqlite.prepare(`DELETE FROM journal_line WHERE entry_id = ? AND entry_id IN (SELECT id FROM journal_entry WHERE status = 'draft')`);
    this.deleteEntryById = sqlite.prepare(`DELETE FROM journal_entry WHERE id = ? AND status = 'draft'`);
    this.selectEntryById = sqlite.prepare(`SELECT * FROM journal_entry WHERE id = ?`);
    this.selectEntryByNo = sqlite.prepare(`SELECT * FROM journal_entry WHERE entry_no = ?`);
    this.selectLines = sqlite
      .prepare(
        `SELECT line_no, account_id, debit, credit, memo, cost_center_id, currency, fx_rate, tax_rate_percent, tax_rate_id, project_id, cost_category, branch_id, party_id FROM journal_line WHERE entry_id = ? ORDER BY line_no`,
      )
      .safeIntegers();
  }

  private insertLines(entryId: string, lines: readonly JournalLine[]): void {
    lines.forEach((line, index) => {
      this.insertLine.run({
        entry_id: entryId,
        line_no: index,
        account_id: line.accountId,
        debit: line.debit.toScaledNumber(),
        credit: line.credit.toScaledNumber(),
        memo: line.memo ?? null,
        cost_center_id: line.costCenterId ?? null,
        currency: line.currency ?? null,
        fx_rate: line.fxRate ?? null,
        tax_rate_percent: line.taxRatePercent ?? null,
        tax_rate_id: line.taxRateId ?? null,
        project_id: line.projectId ?? null,
        cost_category: line.costCategory ?? null,
        branch_id: line.branchId ?? null,
        party_id: line.partyId ?? null,
      });
    });
  }

  async save(entry: JournalEntry): Promise<void> {
    this.insertEntry.run(entryParams(entry));
    this.insertLines(entry.id, entry.lines);
  }

  async update(entry: JournalEntry): Promise<void> {
    this.updateEntry.run({
      id: entry.id,
      entry_no: entry.entryNo ?? null,
      status: entry.status,
      posted_at: entry.postedAt ?? null,
      reversed_by_entry_id: entry.reversedByEntryId ?? null,
      source_doc_type: entry.sourceDocType ?? null,
      source_doc_id: entry.sourceDocId ?? null,
      source_doc_number: entry.sourceDocNumber ?? null,
    });
  }

  async retagUnnamedTaxRate(entryId: string, taxRatePercent: number, taxRateId: string): Promise<number> {
    return this.retagTaxRate.run({ entry_id: entryId, tax_rate_percent: taxRatePercent, tax_rate_id: taxRateId }).changes;
  }

  async retagUntaggedTaxRate(entryId: string, selector: UntaggedJournalLineSelector, taxRatePercent: number, taxRateId: string): Promise<number> {
    const clauses: string[] = [];
    const params: unknown[] = [taxRatePercent, taxRateId, entryId, entryId];
    if (selector.accountIds) {
      if (selector.accountIds.length === 0) return 0;
      clauses.push(`account_id IN (${selector.accountIds.map(() => "?").join(",")})`);
      params.push(...selector.accountIds);
    }
    if (selector.side === JournalLineSide.Debit) clauses.push("debit <> 0");
    if (selector.side === JournalLineSide.Credit) clauses.push("credit <> 0");
    return this.sqlite
      .prepare(
        `UPDATE journal_line SET tax_rate_percent = ?, tax_rate_id = ?
          WHERE entry_id = ? AND tax_rate_id IS NULL AND tax_rate_percent IS NULL
            AND entry_id IN (SELECT id FROM journal_entry WHERE status <> 'draft')
            AND NOT EXISTS (SELECT 1 FROM journal_line tagged WHERE tagged.entry_id = ? AND tagged.tax_rate_percent IS NOT NULL)
            ${clauses.map((clause) => `AND ${clause}`).join(" ")}`,
      )
      .run(...params).changes;
  }

  async replaceDraft(entry: JournalEntry): Promise<void> {
    const updated = this.updateDraftEntry.run({
      id: entry.id,
      date: entry.date,
      memo: entry.memo,
      source: entry.source ?? "manual",
      source_doc_type: entry.sourceDocType ?? null,
      source_doc_id: entry.sourceDocId ?? null,
      source_doc_number: entry.sourceDocNumber ?? null,
    });
    if (updated.changes === 0) return;
    this.deleteLinesByEntry.run(entry.id);
    this.insertLines(entry.id, entry.lines);
  }

  async deleteDraft(entryId: string): Promise<void> {
    this.deleteLinesByEntry.run(entryId);
    this.deleteEntryById.run(entryId);
  }

  async findById(id: string): Promise<JournalEntry | null> {
    const row = this.selectEntryById.get(id) as EntryRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async findByEntryNo(entryNo: string): Promise<JournalEntry | null> {
    const row = this.selectEntryByNo.get(entryNo) as EntryRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  /** The `WHERE` shared by `list` and `count`, so a page and its total agree. */
  private listWhere(filter: JournalListFilter): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
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
        clauses.push(`source_doc_type IN (${filter.sourceDocTypes.map(() => "?").join(",")})`);
        params.push(...filter.sourceDocTypes);
      }
    }
    const term = filter.search?.trim();
    if (term) {
      const like = `%${term.toLowerCase()}%`;
      clauses.push(
        "(LOWER(COALESCE(entry_no, '')) LIKE ? OR LOWER(memo) LIKE ? OR LOWER(COALESCE(source_doc_number, '')) LIKE ?)",
      );
      params.push(like, like, like);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  async count(filter: JournalListFilter = {}): Promise<number> {
    const { sql, params } = this.listWhere(filter);
    const row = this.sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry ${sql}`).get(...params) as {
      n: number | bigint;
    };
    return Number(row.n);
  }

  async list(filter: JournalListFilter = {}): Promise<readonly JournalEntry[]> {
    const { sql: where, params } = this.listWhere(filter);
    let sql = `SELECT * FROM journal_entry ${where} ORDER BY date, id`;
    if (filter.limit !== undefined) {
      // OFFSET is meaningless to SQLite without a LIMIT.
      sql += " LIMIT ? OFFSET ?";
      params.push(filter.limit, filter.offset ?? 0);
    }
    const rows = this.sqlite.prepare(sql).all(...params) as EntryRow[];
    // One query for the whole page's lines, not one per entry: a list of 500
    // entries used to issue 501 synchronous round trips on the UI thread.
    const linesByEntry = childRowsByParent<LineRow & { entry_id: string }>(this.sqlite, {
      table: "journal_line",
      parentColumn: "entry_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "entry_id, line_no",
      columns: "entry_id, line_no, account_id, debit, credit, memo, cost_center_id, currency, fx_rate, tax_rate_percent, tax_rate_id, project_id, cost_category, branch_id, party_id",
      safeIntegers: true,
    });
    return rows.map((row) => this.hydrate(row, linesByEntry.get(row.id) ?? []));
  }

  async accountBalance(accountId: string, asOfDate?: string): Promise<AccountBalance> {
    const params: unknown[] = [accountId];
    let dateClause = "";
    if (asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(asOfDate);
    }
    const row = this.sqlite
      .prepare(
        `SELECT COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE jl.account_id = ?
            AND je.status IN ('posted', 'reversed')
            ${dateClause}`,
      )
      .safeIntegers()
      .get(...params) as { debit: bigint; credit: bigint };
    return {
      accountId,
      debit: Money.fromScaled(row.debit),
      credit: Money.fromScaled(row.credit),
      balance: Money.fromScaled(row.debit - row.credit),
    };
  }

  async accountLedger(accountId: string, asOfDate?: string): Promise<readonly AccountLedgerLine[]> {
    const params: unknown[] = [accountId];
    let dateClause = "";
    if (asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(asOfDate);
    }
    const rows = this.sqlite
      .prepare(
        // A voucher/invoice posting carries its description on the ENTRY, not on
        // the line, so a line-only memo reads blank for most of the ledger — and
        // a bank-reconciliation picker offering blank rows is a picker of UUIDs.
        `SELECT je.id AS entry_id, je.entry_no AS entry_no, je.date AS date,
                COALESCE(jl.memo, je.memo) AS memo, jl.debit AS debit, jl.credit AS credit
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE jl.account_id = ?
            AND je.status IN ('posted', 'reversed')
            ${dateClause}
          ORDER BY je.date, je.id, jl.line_no`,
      )
      .safeIntegers()
      .all(...params) as Array<{
      entry_id: string;
      entry_no: string | null;
      date: string;
      memo: string | null;
      debit: bigint;
      credit: bigint;
    }>;
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
  private aggregateWhere(filter: LedgerAggregateFilter): { sql: string; params: unknown[] } {
    const statuses = filter.statuses ?? (["posted", "reversed"] as const);
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (statuses.length === 0) clauses.push("0 = 1");
    else {
      clauses.push(`je.status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
    if (filter.fromDate) { clauses.push("je.date >= ?"); params.push(filter.fromDate); }
    if (filter.toDate) { clauses.push("je.date <= ?"); params.push(filter.toDate); }
    if (filter.sourceDocTypes) {
      if (filter.sourceDocTypes.length === 0) clauses.push("0 = 1");
      else {
        clauses.push(`je.source_doc_type IN (${filter.sourceDocTypes.map(() => "?").join(",")})`);
        params.push(...filter.sourceDocTypes);
      }
    }
    if (filter.excludeSourceDocTypes && filter.excludeSourceDocTypes.length > 0) {
      clauses.push(
        `(je.source_doc_type IS NULL OR je.source_doc_type NOT IN (${filter.excludeSourceDocTypes.map(() => "?").join(",")}))`,
      );
      params.push(...filter.excludeSourceDocTypes);
    }
    if (filter.accountIds) {
      if (filter.accountIds.length === 0) clauses.push("0 = 1");
      else {
        clauses.push(`jl.account_id IN (${filter.accountIds.map(() => "?").join(",")})`);
        params.push(...filter.accountIds);
      }
    }
    return { sql: clauses.join(" AND "), params };
  }

  async accountBalances(filter: LedgerAggregateFilter = {}): Promise<ReadonlyMap<string, Money>> {
    const { sql, params } = this.aggregateWhere(filter);
    const rows = this.sqlite
      .prepare(
        `SELECT jl.account_id AS account_id, SUM(jl.debit) - SUM(jl.credit) AS net
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE ${sql}
          GROUP BY jl.account_id`,
      )
      .safeIntegers()
      .all(...params) as { account_id: string; net: bigint }[];
    return new Map(rows.map((r) => [r.account_id, Money.fromScaled(r.net)]));
  }

  async sumLines(filter: LedgerAggregateFilter = {}): Promise<{ debit: Money; credit: Money }> {
    const { sql, params } = this.aggregateWhere(filter);
    const row = this.sqlite
      .prepare(
        `SELECT COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE ${sql}`,
      )
      .safeIntegers()
      .get(...params) as { debit: bigint; credit: bigint };
    return { debit: Money.fromScaled(row.debit), credit: Money.fromScaled(row.credit) };
  }

  async listLines(filter: PostedLineFilter = {}): Promise<readonly PostedLine[]> {
    const clauses = ["je.status IN ('posted', 'reversed')"];
    const params: unknown[] = [];
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
      clauses.push(`jl.account_id IN (${filter.accountIds.map(() => "?").join(", ")})`);
      params.push(...filter.accountIds);
    }
    const rows = this.sqlite
      .prepare(
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
      )
      .safeIntegers()
      .all(...params) as Array<{
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
    }>;
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

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }

  private hydrate(row: EntryRow, preloadedLines?: readonly LineRow[]): JournalEntry {
    const lineRows = preloadedLines ?? (this.selectLines.all(row.id) as LineRow[]);
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

function entryParams(entry: JournalEntry) {
  return {
    id: entry.id,
    entry_no: entry.entryNo ?? null,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    source: entry.source ?? "manual",
    created_at: entry.createdAt ?? new Date().toISOString(),
    posted_at: entry.postedAt ?? null,
    reverses_entry_id: entry.reversesEntryId ?? null,
    reversed_by_entry_id: entry.reversedByEntryId ?? null,
    source_doc_type: entry.sourceDocType ?? null,
    source_doc_id: entry.sourceDocId ?? null,
    source_doc_number: entry.sourceDocNumber ?? null,
  };
}

export interface SqliteLedgerStoreHandle extends LedgerRepository {
  /** JE numbering engine bound to the SAME connection — pass as `deps.numbering`. */
  readonly numbering: NextNumberService;
  close(): void;
}

/**
 * Open a SQLite-backed ledger store. ":memory:" for tests, a file path for a
 * real (WAL) desktop database. The returned handle is both the
 * {@link LedgerRepository} and the connection-bound numbering engine, so the
 * GL engine's `deps.ledger` and `deps.numbering` share one transaction.
 */
/**
 * `configStore` is optional and additive: pass a {@link SequenceConfigStore}
 * (e.g. `createSqliteSequenceConfigStore(sqlite)` on the SAME shared
 * connection) so `deps.numbering` picks up admin prefix/pad-length/
 * annual-reset overrides from `/settings/sequences` on every allocation.
 * Omitted, this behaves exactly as before — the compiled-in defaults only.
 */
export function createSqliteLedgerStore(
  path: SqliteConnectionInput = ":memory:",
  configStore?: SequenceConfigStore,
): SqliteLedgerStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  // journal_line predates the tax-rate dimension (D28); an existing books file
  // has the table already, so CREATE TABLE IF NOT EXISTS alone never adds it.
  const lineColumns = new Set((sqlite.prepare(`PRAGMA table_info(journal_line)`).all() as { name: string }[]).map((c) => c.name));
  if (!lineColumns.has("tax_rate_percent")) sqlite.exec(`ALTER TABLE journal_line ADD COLUMN tax_rate_percent REAL`);
  if (!lineColumns.has("tax_rate_id")) sqlite.exec(`ALTER TABLE journal_line ADD COLUMN tax_rate_id TEXT`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_line_tax_rate ON journal_line(tax_rate_id) WHERE tax_rate_id IS NOT NULL`);
  // The two contracting dimensions (D-01) arrived later still.
  if (!lineColumns.has("project_id")) sqlite.exec(`ALTER TABLE journal_line ADD COLUMN project_id TEXT`);
  if (!lineColumns.has("cost_category")) sqlite.exec(`ALTER TABLE journal_line ADD COLUMN cost_category TEXT`);
  // بُعد الفرع (DEC-20) arrived after all of them. Nullable by design: every
  // line already in an existing books file reads back with no branch, which is
  // exactly the «غير مخصص» bucket the branch statements always show.
  if (!lineColumns.has("branch_id")) sqlite.exec(`ALTER TABLE journal_line ADD COLUMN branch_id TEXT`);
  if (!lineColumns.has("party_id")) sqlite.exec(`ALTER TABLE journal_line ADD COLUMN party_id TEXT`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_line_project ON journal_line(project_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_line_branch ON journal_line(branch_id)`);
  const repo = new SqliteLedgerRepository(sqlite);
  const numbering = new NextNumberService(new SharedSequenceStore(sqlite), configStore);
  return Object.assign(repo, {
    numbering,
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteLedgerStoreHandle;
}
