import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  BASE_CURRENCY,
  Money,
  type BankRuleDirection,
  type BankRuleMatchType,
  type BankStatementSource,
  type MatchSource,
  type SuggestionStatus,
  type BankRule,
  type BankRuleRepository,
  type MatchSuggestionRecord,
  type MatchSuggestionRepository,
  type BankStatement,
  type BankStatementListFilter,
  type BankStatementRepository,
  type BankStatementStatus,
  type StatementColumnMapping,
  type StatementColumnMappingRepository,
  type StatementDateFormat,
  type StatementLine,
  type StatementLineStatus,
} from "@mezan/domain";

/**
 * SQLite-backed persistence for Bank Statement Reconciliation (docs/archive/catalog/04
 * "تسوية كشوف البنك"): statements, their lines, and the per-treasury-account
 * column mapping ("يحفظ التعيين لكل حساب").
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS bank_statement (
  id                  TEXT PRIMARY KEY,
  treasury_account_id TEXT NOT NULL,
  branch_id           TEXT,
  currency            TEXT,
  import_fingerprint  TEXT,
  source              TEXT NOT NULL,
  statement_number    TEXT,
  period_start        TEXT NOT NULL,
  period_end          TEXT NOT NULL,
  opening_balance     INTEGER NOT NULL,
  closing_balance     INTEGER NOT NULL,
  status              TEXT NOT NULL,
  imported_at         TEXT NOT NULL,
  finalized_at        TEXT,
  unmatched_at_finalize      INTEGER,
  finalize_override_reason   TEXT,
  finalized_by               TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_statement_account ON bank_statement(treasury_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_status ON bank_statement(status);
CREATE INDEX IF NOT EXISTS idx_bank_statement_branch ON bank_statement(branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_statement_fingerprint ON bank_statement(treasury_account_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS statement_line (
  id               TEXT PRIMARY KEY,
  statement_id     TEXT NOT NULL,
  date             TEXT NOT NULL,
  description      TEXT NOT NULL,
  reference        TEXT,
  amount           INTEGER NOT NULL,
  status           TEXT NOT NULL,
  matched_entry_id TEXT,
  matched_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_statement_line_statement ON statement_line(statement_id);

CREATE TABLE IF NOT EXISTS statement_line_match (
  line_id             TEXT NOT NULL,
  entry_id            TEXT NOT NULL,
  statement_id        TEXT NOT NULL,
  treasury_account_id TEXT NOT NULL,
  PRIMARY KEY (line_id, entry_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_statement_line_match_entry ON statement_line_match(treasury_account_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_statement_line_match_statement ON statement_line_match(statement_id);

CREATE TABLE IF NOT EXISTS bank_match_suggestion (
  id                 TEXT PRIMARY KEY,
  statement_id       TEXT NOT NULL,
  line_id            TEXT NOT NULL,
  entry_ids          TEXT NOT NULL,
  rank               INTEGER NOT NULL,
  score              INTEGER NOT NULL,
  amount_score       INTEGER NOT NULL,
  date_score         INTEGER NOT NULL,
  reference_score    INTEGER NOT NULL,
  counterparty_score INTEGER NOT NULL,
  date_delta_days    INTEGER NOT NULL,
  status             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  decided_at         TEXT,
  decided_by         TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_match_suggestion_statement ON bank_match_suggestion(statement_id, status);

CREATE TABLE IF NOT EXISTS bank_rule (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  treasury_account_id TEXT,
  pattern             TEXT NOT NULL,
  match_type          TEXT NOT NULL,
  direction           TEXT NOT NULL,
  account_id          TEXT NOT NULL,
  cost_center_id      TEXT,
  priority            INTEGER NOT NULL,
  active              INTEGER NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS statement_column_mapping (
  treasury_account_id TEXT PRIMARY KEY,
  date_column         TEXT NOT NULL,
  description_column  TEXT NOT NULL,
  amount_column       TEXT,
  debit_column        TEXT,
  credit_column       TEXT,
  reference_column    TEXT,
  date_format         TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
`;

interface StatementRow {
  id: string;
  treasury_account_id: string;
  branch_id: string | null;
  currency: string | null;
  import_fingerprint: string | null;
  source: string;
  statement_number: string | null;
  period_start: string;
  period_end: string;
  opening_balance: bigint;
  closing_balance: bigint;
  status: string;
  imported_at: string;
  finalized_at: string | null;
  unmatched_at_finalize: bigint | number | null;
  finalize_override_reason: string | null;
  finalized_by: string | null;
  difference_at_finalize: bigint | number | null;
}

function toStatement(row: StatementRow): BankStatement {
  return {
    id: row.id,
    treasuryAccountId: row.treasury_account_id,
    branchId: row.branch_id,
    currency: row.currency ?? BASE_CURRENCY,
    importFingerprint: row.import_fingerprint,
    source: row.source as BankStatementSource,
    statementNumber: row.statement_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    openingBalance: Money.fromScaled(row.opening_balance),
    closingBalance: Money.fromScaled(row.closing_balance),
    status: row.status as BankStatementStatus,
    importedAt: row.imported_at,
    finalizedAt: row.finalized_at,
    unmatchedAtFinalize: row.unmatched_at_finalize === null ? null : Number(row.unmatched_at_finalize),
    finalizeOverrideReason: row.finalize_override_reason,
    finalizedBy: row.finalized_by,
    differenceAtFinalize: row.difference_at_finalize === null ? null : Money.fromScaled(BigInt(row.difference_at_finalize)),
  };
}

function statementParams(s: BankStatement) {
  return {
    id: s.id,
    treasury_account_id: s.treasuryAccountId,
    branch_id: s.branchId,
    currency: s.currency,
    import_fingerprint: s.importFingerprint,
    source: s.source,
    statement_number: s.statementNumber,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    opening_balance: s.openingBalance.toScaledNumber(),
    closing_balance: s.closingBalance.toScaledNumber(),
    status: s.status,
    imported_at: s.importedAt,
    finalized_at: s.finalizedAt,
    unmatched_at_finalize: s.unmatchedAtFinalize ?? null,
    finalize_override_reason: s.finalizeOverrideReason ?? null,
    finalized_by: s.finalizedBy ?? null,
    difference_at_finalize: s.differenceAtFinalize ? s.differenceAtFinalize.toScaledNumber() : null,
  };
}

interface LineRow {
  id: string;
  statement_id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: bigint;
  status: string;
  matched_entry_id: string | null;
  matched_at: string | null;
  counterparty: string | null;
  match_source: string | null;
}

function toLine(row: LineRow, entryIds?: readonly string[]): StatementLine {
  return {
    id: row.id,
    statementId: row.statement_id,
    date: row.date,
    description: row.description,
    reference: row.reference,
    amount: Money.fromScaled(row.amount),
    status: row.status as StatementLineStatus,
    matchedEntryId: row.matched_entry_id,
    matchedAt: row.matched_at,
    counterparty: row.counterparty,
    matchSource: (row.match_source as MatchSource | null) ?? null,
    matchedEntryIds: entryIds && entryIds.length > 0 ? entryIds : row.matched_entry_id ? [row.matched_entry_id] : [],
  };
}

function lineParams(l: StatementLine) {
  return {
    id: l.id,
    statement_id: l.statementId,
    date: l.date,
    description: l.description,
    reference: l.reference,
    amount: l.amount.toScaledNumber(),
    status: l.status,
    matched_entry_id: l.matchedEntryId,
    matched_at: l.matchedAt,
    counterparty: l.counterparty ?? null,
    match_source: l.matchSource ?? null,
  };
}

class SqliteBankStatementRepository implements BankStatementRepository {
  private readonly insertStatement: Database.Statement;
  private readonly updateStatement: Database.Statement;
  private readonly selectStatementById: Database.Statement;
  private readonly selectStatementByFingerprint: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly updateLineStmt: Database.Statement;
  private readonly selectLineById: Database.Statement;
  private readonly selectLinesByStatement: Database.Statement;
  private readonly selectMatchesByLine: Database.Statement;
  private readonly selectMatchesByStatement: Database.Statement;
  private readonly deleteMatchesByLine: Database.Statement;
  private readonly insertMatch: Database.Statement;
  private readonly selectTakenForAccount: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertStatement = sqlite.prepare(`
      INSERT INTO bank_statement (
        id, treasury_account_id, branch_id, currency, import_fingerprint, source, statement_number, period_start, period_end,
        opening_balance, closing_balance, status, imported_at, finalized_at,
        unmatched_at_finalize, finalize_override_reason, finalized_by, difference_at_finalize
      ) VALUES (
        @id, @treasury_account_id, @branch_id, @currency, @import_fingerprint, @source, @statement_number, @period_start, @period_end,
        @opening_balance, @closing_balance, @status, @imported_at, @finalized_at,
        @unmatched_at_finalize, @finalize_override_reason, @finalized_by, @difference_at_finalize
      )
    `);
    this.updateStatement = sqlite.prepare(`
      UPDATE bank_statement SET status = @status, finalized_at = @finalized_at,
        unmatched_at_finalize = @unmatched_at_finalize,
        finalize_override_reason = @finalize_override_reason,
        finalized_by = @finalized_by,
        difference_at_finalize = @difference_at_finalize
      WHERE id = @id
    `);
    this.selectStatementById = sqlite.prepare(`SELECT * FROM bank_statement WHERE id = ?`).safeIntegers();
    this.selectStatementByFingerprint = sqlite
      .prepare(`SELECT * FROM bank_statement WHERE treasury_account_id = ? AND import_fingerprint = ?`)
      .safeIntegers();

    this.insertLine = sqlite.prepare(`
      INSERT INTO statement_line (id, statement_id, date, description, reference, amount, status, matched_entry_id, matched_at, counterparty, match_source)
      VALUES (@id, @statement_id, @date, @description, @reference, @amount, @status, @matched_entry_id, @matched_at, @counterparty, @match_source)
    `);
    this.updateLineStmt = sqlite.prepare(`
      UPDATE statement_line SET status = @status, matched_entry_id = @matched_entry_id, matched_at = @matched_at,
        match_source = @match_source WHERE id = @id
    `);
    this.selectLineById = sqlite.prepare(`SELECT * FROM statement_line WHERE id = ?`).safeIntegers();
    this.selectLinesByStatement = sqlite.prepare(`SELECT * FROM statement_line WHERE statement_id = ? ORDER BY date, id`).safeIntegers();
    this.selectMatchesByLine = sqlite.prepare(`SELECT entry_id FROM statement_line_match WHERE line_id = ? ORDER BY rowid`);
    this.selectMatchesByStatement = sqlite.prepare(`SELECT line_id, entry_id FROM statement_line_match WHERE statement_id = ? ORDER BY rowid`);
    this.deleteMatchesByLine = sqlite.prepare(`DELETE FROM statement_line_match WHERE line_id = ?`);
    this.insertMatch = sqlite.prepare(
      `INSERT INTO statement_line_match (line_id, entry_id, statement_id, treasury_account_id) VALUES (?, ?, ?, ?)`,
    );
    this.selectTakenForAccount = sqlite.prepare(`
      SELECT entry_id FROM statement_line_match WHERE treasury_account_id = @account
      UNION
      SELECT l.matched_entry_id FROM statement_line l JOIN bank_statement s ON s.id = l.statement_id
       WHERE s.treasury_account_id = @account AND l.status = 'matched' AND l.matched_entry_id IS NOT NULL
    `);
  }

  async save(statement: BankStatement): Promise<void> {
    this.insertStatement.run(statementParams(statement));
  }
  async update(statement: BankStatement): Promise<void> {
    this.updateStatement.run(statementParams(statement));
  }
  async findById(id: string): Promise<BankStatement | null> {
    const row = this.selectStatementById.get(id) as StatementRow | undefined;
    return row ? toStatement(row) : null;
  }
  async findByFingerprint(treasuryAccountId: string, fingerprint: string): Promise<BankStatement | null> {
    const row = this.selectStatementByFingerprint.get(treasuryAccountId, fingerprint) as StatementRow | undefined;
    return row ? toStatement(row) : null;
  }
  async list(filter: BankStatementListFilter = {}): Promise<readonly BankStatement[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.treasuryAccountId) {
      clauses.push("treasury_account_id = ?");
      params.push(filter.treasuryAccountId);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.fromDate) {
      clauses.push("period_start >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("period_end <= ?");
      params.push(filter.toDate);
    }
    if (filter.branchIds) {
      // A statement carrying no branch is not attributable, so it stays
      // visible under a narrowed scope — the same rule `withinScope` applies.
      const placeholders = filter.branchIds.map(() => "?").join(", ");
      clauses.push(`(branch_id IS NULL OR branch_id IN (${placeholders || "NULL"}))`);
      params.push(...filter.branchIds);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM bank_statement ${where} ORDER BY imported_at DESC`)
      .safeIntegers()
      .all(...params) as StatementRow[];
    return rows.map(toStatement);
  }
  async saveLines(lines: readonly StatementLine[]): Promise<void> {
    for (const line of lines) this.insertLine.run(lineParams(line));
  }
  async saveLine(line: StatementLine): Promise<void> {
    this.insertLine.run(lineParams(line));
  }
  async updateLine(line: StatementLine): Promise<void> {
    this.updateLineStmt.run(lineParams(line));
  }
  async findLineById(id: string): Promise<StatementLine | null> {
    const row = this.selectLineById.get(id) as LineRow | undefined;
    if (!row) return null;
    const entryIds = (this.selectMatchesByLine.all(id) as { entry_id: string }[]).map((r) => r.entry_id);
    return toLine(row, entryIds);
  }
  async listLines(statementId: string): Promise<readonly StatementLine[]> {
    const links = new Map<string, string[]>();
    for (const row of this.selectMatchesByStatement.all(statementId) as { line_id: string; entry_id: string }[]) {
      const list = links.get(row.line_id) ?? [];
      list.push(row.entry_id);
      links.set(row.line_id, list);
    }
    return (this.selectLinesByStatement.all(statementId) as LineRow[]).map((row) => toLine(row, links.get(row.id)));
  }
  async replaceLineMatches(line: StatementLine, treasuryAccountId: string, entryIds: readonly string[]): Promise<void> {
    this.deleteMatchesByLine.run(line.id);
    for (const entryId of entryIds) this.insertMatch.run(line.id, entryId, line.statementId, treasuryAccountId);
  }
  async matchedEntryIdsForAccount(treasuryAccountId: string): Promise<ReadonlySet<string>> {
    const rows = this.selectTakenForAccount.all({ account: treasuryAccountId }) as { entry_id: string }[];
    return new Set(rows.map((r) => r.entry_id));
  }
  async lineCounts(statementIds: readonly string[]): Promise<ReadonlyMap<string, { total: number; matched: number }>> {
    const counts = new Map<string, { total: number; matched: number }>();
    if (statementIds.length === 0) return counts;
    const placeholders = statementIds.map(() => "?").join(",");
    const rows = this.sqlite
      .prepare(
        `SELECT statement_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched
           FROM statement_line
          WHERE statement_id IN (${placeholders})
          GROUP BY statement_id`,
      )
      .all(...statementIds) as Array<{ statement_id: string; total: number; matched: number }>;
    for (const row of rows) counts.set(row.statement_id, { total: Number(row.total), matched: Number(row.matched) });
    return counts;
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN");
  }
}

interface MappingRow {
  treasury_account_id: string;
  date_column: string;
  description_column: string;
  amount_column: string | null;
  debit_column: string | null;
  credit_column: string | null;
  reference_column: string | null;
  date_format: string;
  updated_at: string;
}

function toMapping(row: MappingRow): StatementColumnMapping {
  return {
    treasuryAccountId: row.treasury_account_id,
    dateColumn: row.date_column,
    descriptionColumn: row.description_column,
    amountColumn: row.amount_column,
    debitColumn: row.debit_column,
    creditColumn: row.credit_column,
    referenceColumn: row.reference_column,
    dateFormat: row.date_format as StatementDateFormat,
    updatedAt: row.updated_at,
  };
}

class SqliteColumnMappingRepository implements StatementColumnMappingRepository {
  private readonly upsertStmt: Database.Statement;
  private readonly selectByAccount: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsertStmt = sqlite.prepare(`
      INSERT INTO statement_column_mapping (
        treasury_account_id, date_column, description_column, amount_column, debit_column, credit_column, reference_column, date_format, updated_at
      ) VALUES (
        @treasury_account_id, @date_column, @description_column, @amount_column, @debit_column, @credit_column, @reference_column, @date_format, @updated_at
      )
      ON CONFLICT(treasury_account_id) DO UPDATE SET
        date_column = excluded.date_column, description_column = excluded.description_column,
        amount_column = excluded.amount_column, debit_column = excluded.debit_column,
        credit_column = excluded.credit_column, reference_column = excluded.reference_column,
        date_format = excluded.date_format, updated_at = excluded.updated_at
    `);
    this.selectByAccount = sqlite.prepare(`SELECT * FROM statement_column_mapping WHERE treasury_account_id = ?`);
  }

  async findByTreasuryAccount(treasuryAccountId: string): Promise<StatementColumnMapping | null> {
    const row = this.selectByAccount.get(treasuryAccountId) as MappingRow | undefined;
    return row ? toMapping(row) : null;
  }

  async upsert(mapping: StatementColumnMapping): Promise<void> {
    this.upsertStmt.run({
      treasury_account_id: mapping.treasuryAccountId,
      date_column: mapping.dateColumn,
      description_column: mapping.descriptionColumn,
      amount_column: mapping.amountColumn,
      debit_column: mapping.debitColumn,
      credit_column: mapping.creditColumn,
      reference_column: mapping.referenceColumn,
      date_format: mapping.dateFormat,
      updated_at: mapping.updatedAt,
    });
  }
}

interface SuggestionRow {
  id: string;
  statement_id: string;
  line_id: string;
  entry_ids: string;
  rank: number;
  score: number;
  amount_score: number;
  date_score: number;
  reference_score: number;
  counterparty_score: number;
  date_delta_days: number;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

function toSuggestion(row: SuggestionRow): MatchSuggestionRecord {
  return {
    id: row.id,
    statementId: row.statement_id,
    lineId: row.line_id,
    entryIds: JSON.parse(row.entry_ids) as string[],
    rank: Number(row.rank),
    score: Number(row.score),
    amountScore: Number(row.amount_score),
    dateScore: Number(row.date_score),
    referenceScore: Number(row.reference_score),
    counterpartyScore: Number(row.counterparty_score),
    dateDeltaDays: Number(row.date_delta_days),
    status: row.status as SuggestionStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
}

function suggestionParams(r: MatchSuggestionRecord) {
  return {
    id: r.id,
    statement_id: r.statementId,
    line_id: r.lineId,
    entry_ids: JSON.stringify(r.entryIds),
    rank: r.rank,
    score: r.score,
    amount_score: r.amountScore,
    date_score: r.dateScore,
    reference_score: r.referenceScore,
    counterparty_score: r.counterpartyScore,
    date_delta_days: r.dateDeltaDays,
    status: r.status,
    created_at: r.createdAt,
    decided_at: r.decidedAt,
    decided_by: r.decidedBy,
  };
}

class SqliteMatchSuggestionRepository implements MatchSuggestionRepository {
  private readonly insert: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly byStatement: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly deletePendingStmt: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO bank_match_suggestion (id, statement_id, line_id, entry_ids, rank, score, amount_score, date_score,
        reference_score, counterparty_score, date_delta_days, status, created_at, decided_at, decided_by)
      VALUES (@id, @statement_id, @line_id, @entry_ids, @rank, @score, @amount_score, @date_score,
        @reference_score, @counterparty_score, @date_delta_days, @status, @created_at, @decided_at, @decided_by)
    `);
    this.updateStmt = sqlite.prepare(
      `UPDATE bank_match_suggestion SET status = @status, decided_at = @decided_at, decided_by = @decided_by WHERE id = @id`,
    );
    this.byStatement = sqlite.prepare(`SELECT * FROM bank_match_suggestion WHERE statement_id = ? ORDER BY line_id, rank`);
    this.byId = sqlite.prepare(`SELECT * FROM bank_match_suggestion WHERE id = ?`);
    this.deletePendingStmt = sqlite.prepare(`DELETE FROM bank_match_suggestion WHERE statement_id = ? AND status = 'pending'`);
  }

  async listByStatement(statementId: string): Promise<readonly MatchSuggestionRecord[]> {
    return (this.byStatement.all(statementId) as SuggestionRow[]).map(toSuggestion);
  }
  async findById(id: string): Promise<MatchSuggestionRecord | null> {
    const row = this.byId.get(id) as SuggestionRow | undefined;
    return row ? toSuggestion(row) : null;
  }
  async saveMany(records: readonly MatchSuggestionRecord[]): Promise<void> {
    for (const record of records) this.insert.run(suggestionParams(record));
  }
  async update(record: MatchSuggestionRecord): Promise<void> {
    this.updateStmt.run({ id: record.id, status: record.status, decided_at: record.decidedAt, decided_by: record.decidedBy });
  }
  async deletePending(statementId: string): Promise<void> {
    this.deletePendingStmt.run(statementId);
  }
}

interface RuleRow {
  id: string;
  name: string;
  treasury_account_id: string | null;
  pattern: string;
  match_type: string;
  direction: string;
  account_id: string;
  cost_center_id: string | null;
  priority: number;
  active: number;
  created_at: string;
  updated_at: string;
}

function toRule(row: RuleRow): BankRule {
  return {
    id: row.id,
    name: row.name,
    treasuryAccountId: row.treasury_account_id,
    pattern: row.pattern,
    matchType: row.match_type as BankRuleMatchType,
    direction: row.direction as BankRuleDirection,
    accountId: row.account_id,
    costCenterId: row.cost_center_id,
    priority: Number(row.priority),
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ruleParams(rule: BankRule) {
  return {
    id: rule.id,
    name: rule.name,
    treasury_account_id: rule.treasuryAccountId,
    pattern: rule.pattern,
    match_type: rule.matchType,
    direction: rule.direction,
    account_id: rule.accountId,
    cost_center_id: rule.costCenterId,
    priority: rule.priority,
    active: rule.active ? 1 : 0,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
  };
}

class SqliteBankRuleRepository implements BankRuleRepository {
  private readonly insert: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly all: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly remove: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO bank_rule (id, name, treasury_account_id, pattern, match_type, direction, account_id, cost_center_id,
        priority, active, created_at, updated_at)
      VALUES (@id, @name, @treasury_account_id, @pattern, @match_type, @direction, @account_id, @cost_center_id,
        @priority, @active, @created_at, @updated_at)
    `);
    this.updateStmt = sqlite.prepare(`
      UPDATE bank_rule SET name = @name, treasury_account_id = @treasury_account_id, pattern = @pattern,
        match_type = @match_type, direction = @direction, account_id = @account_id, cost_center_id = @cost_center_id,
        priority = @priority, active = @active, updated_at = @updated_at
      WHERE id = @id
    `);
    this.all = sqlite.prepare(`SELECT * FROM bank_rule ORDER BY priority, created_at, id`);
    this.byId = sqlite.prepare(`SELECT * FROM bank_rule WHERE id = ?`);
    this.remove = sqlite.prepare(`DELETE FROM bank_rule WHERE id = ?`);
  }

  async list(): Promise<readonly BankRule[]> {
    return (this.all.all() as RuleRow[]).map(toRule);
  }
  async findById(id: string): Promise<BankRule | null> {
    const row = this.byId.get(id) as RuleRow | undefined;
    return row ? toRule(row) : null;
  }
  async save(rule: BankRule): Promise<void> {
    this.insert.run(ruleParams(rule));
  }
  async update(rule: BankRule): Promise<void> {
    this.updateStmt.run(ruleParams(rule));
  }
  async delete(id: string): Promise<void> {
    this.remove.run(id);
  }
}

export interface SqliteBankReconciliationStoreHandle {
  readonly statements: BankStatementRepository;
  readonly mappings: StatementColumnMappingRepository;
  readonly suggestions: MatchSuggestionRepository;
  readonly rules: BankRuleRepository;
  close(): void;
}

/** Open a SQLite-backed bank-reconciliation store (statements + lines + column mappings). ":memory:" for tests. */
export function createSqliteBankReconciliationStore(path: SqliteConnectionInput = ":memory:"): SqliteBankReconciliationStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  const statementColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(bank_statement)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of [
    ["unmatched_at_finalize", "INTEGER"],
    ["finalize_override_reason", "TEXT"],
    ["finalized_by", "TEXT"],
    ["difference_at_finalize", "INTEGER"],
    ["branch_id", "TEXT"],
    ["currency", "TEXT"],
    ["import_fingerprint", "TEXT"],
  ] as const) {
    if (!statementColumns.has(name)) sqlite.exec(`ALTER TABLE bank_statement ADD COLUMN ${name} ${type}`);
  }
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bank_statement_branch ON bank_statement(branch_id)`);
  sqlite.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_statement_fingerprint ON bank_statement(treasury_account_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL`,
  );
  const lineColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(statement_line)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of [
    ["counterparty", "TEXT"],
    ["match_source", "TEXT"],
  ] as const) {
    if (!lineColumns.has(name)) sqlite.exec(`ALTER TABLE statement_line ADD COLUMN ${name} ${type}`);
  }
  return {
    statements: new SqliteBankStatementRepository(sqlite),
    mappings: new SqliteColumnMappingRepository(sqlite),
    suggestions: new SqliteMatchSuggestionRepository(sqlite),
    rules: new SqliteBankRuleRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
