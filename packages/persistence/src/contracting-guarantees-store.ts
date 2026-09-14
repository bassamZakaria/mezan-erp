import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  face_value: number;
  percent_of_contract: string | null;
  cash_margin_percent: string;
  cash_margin_amount: number;
  issue_date: string;
  expiry_date: string;
  status: string;
  current_value: number;
  reductions: string;
  restorations: string;
  closed_date: string | null;
  closed_by: string | null;
  closed_amount: number;
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

class SqliteLetterOfGuaranteeRepository implements LetterOfGuaranteeRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByDocNo: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO contracting_guarantee (
        id, doc_no, kind, project_id, contract_id, tender_ref, beneficiary_name_ar,
        bank_treasury_account_id, bank_name_ar, face_value, percent_of_contract,
        cash_margin_percent, cash_margin_amount, issue_date, expiry_date, status,
        current_value, reductions, restorations, closed_date, closed_by, closed_amount, notes
      ) VALUES (
        @id, @doc_no, @kind, @project_id, @contract_id, @tender_ref, @beneficiary_name_ar,
        @bank_treasury_account_id, @bank_name_ar, @face_value, @percent_of_contract,
        @cash_margin_percent, @cash_margin_amount, @issue_date, @expiry_date, @status,
        @current_value, @reductions, @restorations, @closed_date, @closed_by, @closed_amount, @notes
      )
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
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM contracting_guarantee WHERE id = ?`);
    this.selectByDocNo = sqlite.prepare(`SELECT * FROM contracting_guarantee WHERE doc_no = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM contracting_guarantee ORDER BY issue_date DESC, id DESC`);
  }

  async findById(id: string): Promise<LetterOfGuarantee | null> {
    const row = this.selectById.get(id) as GuaranteeRow | undefined;
    return row ? toGuarantee(row) : null;
  }

  async findByDocNo(docNo: string): Promise<LetterOfGuarantee | null> {
    const row = this.selectByDocNo.get(docNo) as GuaranteeRow | undefined;
    return row ? toGuarantee(row) : null;
  }

  async list(): Promise<LetterOfGuarantee[]> {
    return (this.selectAll.all() as GuaranteeRow[]).map(toGuarantee);
  }

  async create(guarantee: LetterOfGuarantee): Promise<void> {
    this.write(guarantee);
  }

  async update(guarantee: LetterOfGuarantee): Promise<void> {
    this.write(guarantee);
  }

  private write(guarantee: LetterOfGuarantee): void {
    this.upsert.run({
      id: guarantee.id,
      doc_no: guarantee.docNo,
      kind: guarantee.kind,
      project_id: guarantee.projectId,
      contract_id: guarantee.contractId,
      tender_ref: guarantee.tenderRef,
      beneficiary_name_ar: guarantee.beneficiaryNameAr,
      bank_treasury_account_id: guarantee.bankTreasuryAccountId,
      bank_name_ar: guarantee.bankNameAr,
      face_value: guarantee.faceValue.toScaledNumber(),
      percent_of_contract: guarantee.percentOfContract,
      cash_margin_percent: guarantee.cashMarginPercent,
      cash_margin_amount: guarantee.cashMarginAmount.toScaledNumber(),
      issue_date: guarantee.issueDate,
      expiry_date: guarantee.expiryDate,
      status: guarantee.status,
      current_value: guarantee.currentValue.toScaledNumber(),
      reductions: JSON.stringify(
        guarantee.reductions.map((r) => ({
          date: r.date,
          amount: r.amount.toScaledNumber(),
          reason: r.reason,
          sourceRef: r.sourceRef,
          userId: r.userId,
        })),
      ),
      restorations: JSON.stringify(
        guarantee.restorations.map((r) => ({
          date: r.date,
          amount: r.amount.toScaledNumber(),
          reason: r.reason,
          sourceRef: r.sourceRef,
          userId: r.userId,
        })),
      ),
      closed_date: guarantee.closedDate,
      closed_by: guarantee.closedBy,
      closed_amount: guarantee.closedAmount.toScaledNumber(),
      notes: guarantee.notes,
    });
  }
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
  const repo = new SqliteLetterOfGuaranteeRepository(sqlite);
  return Object.assign(repo, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteGuaranteeStoreHandle;
}
