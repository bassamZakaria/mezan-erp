import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  type Cheque,
  type ChequeDirection,
  type ChequeListFilter,
  type ChequeRepository,
  type ChequeStoredStatus,
} from "@mezan/domain";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS cheque (
  id                                    TEXT PRIMARY KEY,
  direction                             TEXT NOT NULL,
  status                                TEXT NOT NULL,
  cheque_number                         TEXT NOT NULL,
  bank_name                             TEXT NOT NULL,
  bank_branch_name                      TEXT,
  bank_account_number                   TEXT,
  amount                                INTEGER NOT NULL,
  currency                              TEXT NOT NULL,
  issue_date                            TEXT NOT NULL,
  due_date                              TEXT NOT NULL,
  branch_id                             TEXT NOT NULL,
  notes                                 TEXT,
  party_id                              TEXT NOT NULL,
  counterparty_gl_account_id            TEXT NOT NULL,
  control_under_collection_account_id   TEXT NOT NULL,
  control_bounced_account_id            TEXT,
  bank_treasury_account_id              TEXT,
  created_at                            TEXT NOT NULL,
  deposited_at                          TEXT,
  collected_at                          TEXT,
  bounced_at                            TEXT,
  replaces_cheque_id                    TEXT,
  replaced_by_cheque_id                 TEXT,
  creation_journal_entry_id             TEXT,
  collection_journal_entry_id           TEXT,
  bounce_journal_entry_id               TEXT,
  UNIQUE(direction, cheque_number)
);
CREATE INDEX IF NOT EXISTS idx_cheque_status ON cheque(status);
CREATE INDEX IF NOT EXISTS idx_cheque_due_date ON cheque(due_date);
`;

interface ChequeRow {
  id: string;
  direction: string;
  status: string;
  cheque_number: string;
  bank_name: string;
  bank_branch_name: string | null;
  bank_account_number: string | null;
  amount: bigint;
  currency: string;
  issue_date: string;
  due_date: string;
  branch_id: string;
  notes: string | null;
  party_id: string;
  counterparty_gl_account_id: string;
  control_under_collection_account_id: string;
  control_bounced_account_id: string | null;
  bank_treasury_account_id: string | null;
  created_at: string;
  deposited_at: string | null;
  collected_at: string | null;
  bounced_at: string | null;
  replaces_cheque_id: string | null;
  replaced_by_cheque_id: string | null;
  creation_journal_entry_id: string | null;
  collection_journal_entry_id: string | null;
  bounce_journal_entry_id: string | null;
}

function toCheque(row: ChequeRow): Cheque {
  return {
    id: row.id,
    direction: row.direction as ChequeDirection,
    status: row.status as ChequeStoredStatus,
    chequeNumber: row.cheque_number,
    bankName: row.bank_name,
    bankBranchName: row.bank_branch_name,
    bankAccountNumber: row.bank_account_number,
    amount: Money.fromScaled(row.amount),
    currency: row.currency,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    branchId: row.branch_id,
    notes: row.notes,
    partyId: row.party_id,
    counterpartyGlAccountId: row.counterparty_gl_account_id,
    controlAccounts: {
      underCollectionAccountId: row.control_under_collection_account_id,
      bouncedAccountId: row.control_bounced_account_id,
    },
    bankTreasuryAccountId: row.bank_treasury_account_id,
    createdAt: row.created_at,
    depositedAt: row.deposited_at,
    collectedAt: row.collected_at,
    bouncedAt: row.bounced_at,
    replacesChequeId: row.replaces_cheque_id,
    replacedByChequeId: row.replaced_by_cheque_id,
    creationJournalEntryId: row.creation_journal_entry_id,
    collectionJournalEntryId: row.collection_journal_entry_id,
    bounceJournalEntryId: row.bounce_journal_entry_id,
  };
}

function chequeParams(cheque: Cheque): Record<string, SqlValue> {
  return {
    id: cheque.id,
    direction: cheque.direction,
    status: cheque.status,
    cheque_number: cheque.chequeNumber,
    bank_name: cheque.bankName,
    bank_branch_name: cheque.bankBranchName,
    bank_account_number: cheque.bankAccountNumber,
    amount: cheque.amount.scaled,
    currency: cheque.currency,
    issue_date: cheque.issueDate,
    due_date: cheque.dueDate,
    branch_id: cheque.branchId,
    notes: cheque.notes,
    party_id: cheque.partyId,
    counterparty_gl_account_id: cheque.counterpartyGlAccountId,
    control_under_collection_account_id: cheque.controlAccounts.underCollectionAccountId,
    control_bounced_account_id: cheque.controlAccounts.bouncedAccountId ?? null,
    bank_treasury_account_id: cheque.bankTreasuryAccountId,
    created_at: cheque.createdAt,
    deposited_at: cheque.depositedAt,
    collected_at: cheque.collectedAt,
    bounced_at: cheque.bouncedAt,
    replaces_cheque_id: cheque.replacesChequeId,
    replaced_by_cheque_id: cheque.replacedByChequeId,
    creation_journal_entry_id: cheque.creationJournalEntryId,
    collection_journal_entry_id: cheque.collectionJournalEntryId,
    bounce_journal_entry_id: cheque.bounceJournalEntryId,
  };
}

const COLUMNS = [
  "id", "direction", "status", "cheque_number", "bank_name", "bank_branch_name", "bank_account_number",
  "amount", "currency", "issue_date", "due_date", "branch_id", "notes", "party_id",
  "counterparty_gl_account_id", "control_under_collection_account_id", "control_bounced_account_id",
  "bank_treasury_account_id", "created_at", "deposited_at", "collected_at", "bounced_at",
  "replaces_cheque_id", "replaced_by_cheque_id", "creation_journal_entry_id",
  "collection_journal_entry_id", "bounce_journal_entry_id",
] as const;

const UPDATED_COLUMNS = [
  "status", "bank_treasury_account_id", "deposited_at", "collected_at", "bounced_at",
  "replaces_cheque_id", "replaced_by_cheque_id", "creation_journal_entry_id",
  "collection_journal_entry_id", "bounce_journal_entry_id",
] as const;

class SqlChequeRepository implements ChequeRepository {
  constructor(private readonly db: SqlDb) {}

  async save(cheque: Cheque): Promise<void> {
    const row = chequeParams(cheque);
    const inserted = await this.db.run(
      `INSERT INTO cheque (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")}) ON CONFLICT (id) DO NOTHING`,
      COLUMNS.map((column) => row[column] ?? null),
    );
    refuseUnlessInserted(cheque.id, inserted.changes);
  }

  async update(cheque: Cheque): Promise<void> {
    const row = chequeParams(cheque);
    await this.db.run(
      `UPDATE cheque SET ${UPDATED_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...UPDATED_COLUMNS.map((column) => row[column] ?? null), cheque.id],
    );
  }

  async findById(id: string): Promise<Cheque | null> {
    const row = await this.db.get<ChequeRow>(`SELECT * FROM cheque WHERE id = ?`, [id]);
    return row ? toCheque(row) : null;
  }

  async findByChequeNumber(direction: ChequeDirection, chequeNumber: string): Promise<Cheque | null> {
    const row = await this.db.get<ChequeRow>(`SELECT * FROM cheque WHERE direction = ? AND cheque_number = ?`, [direction, chequeNumber]);
    return row ? toCheque(row) : null;
  }

  async list(filter: ChequeListFilter = {}): Promise<readonly Cheque[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.direction) {
      clauses.push("direction = ?");
      params.push(filter.direction);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.fromDate) {
      clauses.push("due_date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("due_date <= ?");
      params.push(filter.toDate);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (await this.db.all<ChequeRow>(`SELECT * FROM cheque ${where} ORDER BY due_date, created_at`, params)).map(toCheque);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
}

export interface SqliteChequeRepositoryHandle extends ChequeRepository {
  close(): void;
}

export async function ensureChequeSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createChequeRepository(db: SqlDb): ChequeRepository {
  return new SqlChequeRepository(db);
}

export function createSqliteChequeRepository(path: SqliteConnectionInput = ":memory:"): SqliteChequeRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createChequeRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteChequeRepositoryHandle;
}
