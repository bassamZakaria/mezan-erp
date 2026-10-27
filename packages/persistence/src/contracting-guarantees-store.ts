import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  type GuaranteeKind,
  type GuaranteeReduction,
  type GuaranteeStatus,
  type LetterOfGuarantee,
  type LetterOfGuaranteeRepository,
} from "@mezan/domain";

/**
 * SQLite-backed letters-of-guarantee register (خطابات الضمان,
 * docs/artifacts/mezan-contracting-designs.html §05). Its own table rather
 * than the generic framework document, because the register is queried by
 * bank, by project and by expiry date — reporting the contractor's real
 * ceiling is the whole point, and that has to be indexable.
 *
 * `reductions` is an append-only JSON array: each step down the face value
 * with its date, reason and the document behind it.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS contracting_guarantee (
  id                       TEXT PRIMARY KEY,
  doc_no                   TEXT UNIQUE,
  kind                     TEXT NOT NULL,
  project_id               TEXT,
  contract_id              TEXT,
  tender_ref               TEXT,
  beneficiary_name_ar      TEXT NOT NULL,
  bank_treasury_account_id TEXT NOT NULL,
  bank_name_ar             TEXT NOT NULL,
  face_value               INTEGER NOT NULL,
  percent_of_contract      TEXT,
  cash_margin_percent      TEXT NOT NULL,
  cash_margin_amount       INTEGER NOT NULL,
  issue_date               TEXT NOT NULL,
  expiry_date              TEXT NOT NULL,
  status                   TEXT NOT NULL,
  current_value            INTEGER NOT NULL,
  reductions               TEXT NOT NULL DEFAULT '[]',
  restorations             TEXT NOT NULL DEFAULT '[]',
  closed_date              TEXT,
  closed_by                TEXT,
  closed_amount            INTEGER NOT NULL DEFAULT 0,
  notes                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_guarantee_project ON contracting_guarantee (project_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_bank ON contracting_guarantee (bank_treasury_account_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_expiry ON contracting_guarantee (status, expiry_date);
`;

interface GuaranteeRow {
  id: string;
  doc_no: string | null;
  kind: string;
  project_id: string | null;
  contract_id: string | null;
  tender_ref: string | null;
  beneficiary_name_ar: string;
  bank_treasury_account_id: string;
  bank_name_ar: string;
  face_value: bigint;
  percent_of_contract: string | null;
  cash_margin_percent: string;
  cash_margin_amount: bigint;
  issue_date: string;
  expiry_date: string;
  status: string;
  current_value: bigint;
  reductions: string;
  restorations: string;
  closed_date: string | null;
  closed_by: string | null;
  closed_amount: bigint;
  notes: string | null;
}

interface ReductionJson {
  date: string;
  amount: number;
  reason: string;
  sourceRef: string | null;
  userId?: string | null;
}

function toReductions(json: string): GuaranteeReduction[] {
  const parsed = JSON.parse(json) as ReductionJson[];
  return parsed.map((r) => ({
    date: r.date,
    amount: Money.fromScaled(r.amount),
    reason: r.reason,
    sourceRef: r.sourceRef ?? null,
    userId: r.userId ?? null,
  }));
}

function toGuarantee(row: GuaranteeRow): LetterOfGuarantee {
  return {
    id: row.id,
    docNo: row.doc_no,
    kind: row.kind as GuaranteeKind,
    projectId: row.project_id,
    contractId: row.contract_id,
    tenderRef: row.tender_ref,
    beneficiaryNameAr: row.beneficiary_name_ar,
    bankTreasuryAccountId: row.bank_treasury_account_id,
    bankNameAr: row.bank_name_ar,
    faceValue: Money.fromScaled(row.face_value),
    percentOfContract: row.percent_of_contract,
    cashMarginPercent: row.cash_margin_percent,
    cashMarginAmount: Money.fromScaled(row.cash_margin_amount),
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    status: row.status as GuaranteeStatus,
    currentValue: Money.fromScaled(row.current_value),
    reductions: toReductions(row.reductions),
    restorations: toReductions(row.restorations ?? "[]"),
    closedDate: row.closed_date,
    closedBy: row.closed_by ?? null,
    closedAmount: Money.fromScaled(row.closed_amount),
    notes: row.notes,
  };
}

const UPSERT = `
      INSERT INTO contracting_guarantee (
        id, doc_no, kind, project_id, contract_id, tender_ref, beneficiary_name_ar,
        bank_treasury_account_id, bank_name_ar, face_value, percent_of_contract,
        cash_margin_percent, cash_margin_amount, issue_date, expiry_date, status,
        current_value, reductions, restorations, closed_date, closed_by, closed_amount, notes
      ) VALUES (${placeholders(23)})
      ON CONFLICT(id) DO UPDATE SET
        doc_no = excluded.doc_no,
        kind = excluded.kind,
        project_id = excluded.project_id,
        contract_id = excluded.contract_id,
        tender_ref = excluded.tender_ref,
        beneficiary_name_ar = excluded.beneficiary_name_ar,
        bank_treasury_account_id = excluded.bank_treasury_account_id,
        bank_name_ar = excluded.bank_name_ar,
        face_value = excluded.face_value,
        percent_of_contract = excluded.percent_of_contract,
        cash_margin_percent = excluded.cash_margin_percent,
        cash_margin_amount = excluded.cash_margin_amount,
        issue_date = excluded.issue_date,
        expiry_date = excluded.expiry_date,
        status = excluded.status,
        current_value = excluded.current_value,
        reductions = excluded.reductions,
        restorations = excluded.restorations,
        closed_date = excluded.closed_date,
        closed_by = excluded.closed_by,
        closed_amount = excluded.closed_amount,
        notes = excluded.notes
    `;

function reductionsJson(reductions: readonly GuaranteeReduction[]): string {
  return JSON.stringify(
    reductions.map((r) => ({
      date: r.date,
      amount: r.amount.toScaledNumber(),
      reason: r.reason,
      sourceRef: r.sourceRef,
      userId: r.userId,
    })),
  );
}

function guaranteeParams(guarantee: LetterOfGuarantee): SqlValue[] {
  return [
    guarantee.id,
    guarantee.docNo,
    guarantee.kind,
    guarantee.projectId,
    guarantee.contractId,
    guarantee.tenderRef,
    guarantee.beneficiaryNameAr,
    guarantee.bankTreasuryAccountId,
    guarantee.bankNameAr,
    guarantee.faceValue.scaled,
    guarantee.percentOfContract,
    guarantee.cashMarginPercent,
    guarantee.cashMarginAmount.scaled,
    guarantee.issueDate,
    guarantee.expiryDate,
    guarantee.status,
    guarantee.currentValue.scaled,
    reductionsJson(guarantee.reductions),
    reductionsJson(guarantee.restorations),
    guarantee.closedDate,
    guarantee.closedBy,
    guarantee.closedAmount.scaled,
    guarantee.notes,
  ];
}

class SqlLetterOfGuaranteeRepository implements LetterOfGuaranteeRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<LetterOfGuarantee | null> {
    const row = await this.db.get<GuaranteeRow>(`SELECT * FROM contracting_guarantee WHERE id = ?`, [id]);
    return row ? toGuarantee(row) : null;
  }

  async findByDocNo(docNo: string): Promise<LetterOfGuarantee | null> {
    const row = await this.db.get<GuaranteeRow>(`SELECT * FROM contracting_guarantee WHERE doc_no = ?`, [docNo]);
    return row ? toGuarantee(row) : null;
  }

  async list(): Promise<LetterOfGuarantee[]> {
    return (await this.db.all<GuaranteeRow>(`SELECT * FROM contracting_guarantee ORDER BY issue_date DESC, id DESC`)).map(toGuarantee);
  }

  async create(guarantee: LetterOfGuarantee): Promise<void> {
    await insertNew(this.db, guarantee.id, UPSERT, guaranteeParams(guarantee));
  }

  async update(guarantee: LetterOfGuarantee): Promise<void> {
    await this.db.run(UPSERT, guaranteeParams(guarantee));
  }
}

export async function ensureGuaranteeSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createGuaranteeStore(db: SqlDb): LetterOfGuaranteeRepository {
  return new SqlLetterOfGuaranteeRepository(db);
}

export interface SqliteGuaranteeStoreHandle extends LetterOfGuaranteeRepository {
  close(): void;
}

/** Open a SQLite-backed guarantee register. ":memory:" for tests, a path for real. */
export function createSqliteGuaranteeStore(path: SqliteConnectionInput = ":memory:"): SqliteGuaranteeStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  if (
    !(sqlite.prepare(`PRAGMA table_info(contracting_guarantee)`).all() as { name: string }[]).some(
      (c) => c.name === "restorations",
    )
  ) {
    sqlite.exec(`ALTER TABLE contracting_guarantee ADD COLUMN restorations TEXT NOT NULL DEFAULT '[]'`);
  }
  return Object.assign(createGuaranteeStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteGuaranteeStoreHandle;
}
