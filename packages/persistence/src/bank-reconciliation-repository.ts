import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
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
 * SQLite-backed persistence for Bank Statement Reconciliation (docs/catalog/04
 * "تسوية كشوف البنك"): statements, their lines, and the per-treasury-account
 * column mapping ("يحفظ التعيين لكل حساب").
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS bank_statement (
  id                  TEXT PRIMARY KEY,
  treasury_account_id TEXT NOT NULL,
  source              TEXT NOT NULL,
  statement_number    TEXT,
  period_start        TEXT NOT NULL,
  period_end          TEXT NOT NULL,
  opening_balance     INTEGER NOT NULL,
  closing_balance     INTEGER NOT NULL,
  status              TEXT NOT NULL,
  imported_at         TEXT NOT NULL,
  finalized_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_statement_account ON bank_statement(treasury_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_status ON bank_statement(status);

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
  source: string;
  statement_number: string | null;
  period_start: string;
  period_end: string;
  opening_balance: bigint;
  closing_balance: bigint;
  status: string;
  imported_at: string;
  finalized_at: string | null;
}

function toStatement(row: StatementRow): BankStatement {
  return {
    id: row.id,
    treasuryAccountId: row.treasury_account_id,
    source: row.source as "csv",
    statementNumber: row.statement_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    openingBalance: Money.fromScaled(row.opening_balance),
    closingBalance: Money.fromScaled(row.closing_balance),
    status: row.status as BankStatementStatus,
    importedAt: row.imported_at,
    finalizedAt: row.finalized_at,
  };
}

function statementParams(s: BankStatement) {
  return {
    id: s.id,
    treasury_account_id: s.treasuryAccountId,
    source: s.source,
    statement_number: s.statementNumber,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    opening_balance: s.openingBalance.toScaledNumber(),
    closing_balance: s.closingBalance.toScaledNumber(),
    status: s.status,
    imported_at: s.importedAt,
    finalized_at: s.finalizedAt,
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
}

function toLine(row: LineRow): StatementLine {
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
  };
}

class SqliteBankStatementRepository implements BankStatementRepository {
  private readonly insertStatement: Database.Statement;
  private readonly updateStatement: Database.Statement;
  private readonly selectStatementById: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly updateLineStmt: Database.Statement;
  private readonly selectLineById: Database.Statement;
  private readonly selectLinesByStatement: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertStatement = sqlite.prepare(`
      INSERT INTO bank_statement (
        id, treasury_account_id, source, statement_number, period_start, period_end,
        opening_balance, closing_balance, status, imported_at, finalized_at
      ) VALUES (
        @id, @treasury_account_id, @source, @statement_number, @period_start, @period_end,
        @opening_balance, @closing_balance, @status, @imported_at, @finalized_at
      )
    `);
    this.updateStatement = sqlite.prepare(`
      UPDATE bank_statement SET status = @status, finalized_at = @finalized_at WHERE id = @id
    `);
    this.selectStatementById = sqlite.prepare(`SELECT * FROM bank_statement WHERE id = ?`).safeIntegers();

    this.insertLine = sqlite.prepare(`
      INSERT INTO statement_line (id, statement_id, date, description, reference, amount, status, matched_entry_id, matched_at)
      VALUES (@id, @statement_id, @date, @description, @reference, @amount, @status, @matched_entry_id, @matched_at)
    `);
    this.updateLineStmt = sqlite.prepare(`
      UPDATE statement_line SET status = @status, matched_entry_id = @matched_entry_id, matched_at = @matched_at WHERE id = @id
    `);
    this.selectLineById = sqlite.prepare(`SELECT * FROM statement_line WHERE id = ?`).safeIntegers();
    this.selectLinesByStatement = sqlite.prepare(`SELECT * FROM statement_line WHERE statement_id = ? ORDER BY date, id`).safeIntegers();
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
    return row ? toLine(row) : null;
  }
  async listLines(statementId: string): Promise<readonly StatementLine[]> {
    return (this.selectLinesByStatement.all(statementId) as LineRow[]).map(toLine);
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

export interface SqliteBankReconciliationStoreHandle {
  readonly statements: BankStatementRepository;
  readonly mappings: StatementColumnMappingRepository;
  close(): void;
}

/** Open a SQLite-backed bank-reconciliation store (statements + lines + column mappings). ":memory:" for tests. */
export function createSqliteBankReconciliationStore(path: SqliteConnectionInput = ":memory:"): SqliteBankReconciliationStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  return {
    statements: new SqliteBankStatementRepository(sqlite),
    mappings: new SqliteColumnMappingRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
