import Database from "better-sqlite3";
import {
  Money,
  type AllocatableInvoice,
  type AllocatableInvoiceRepository,
  type AllocationInvoiceKind,
  type AllocationRepository,
  type AllocationStatus,
  type DocumentListFilter,
  type DocumentRepository,
  type DocumentStatus,
  type FrameworkDocument,
  type VoucherAllocation,
  type VoucherDirection,
  type VoucherLine,
  type VoucherPaymentMethod,
  type VoucherType,
} from "@mezan/domain";

/**
 * SQLite-backed persistence for Treasury Vouchers (docs/catalog/04 §"السندات
 * النقدية"): the voucher document itself (a framework document whose single
 * economic line is denormalised onto the row), its invoice allocations, and the
 * thin open-invoice sub-ledger allocations apply against. Money is stored as
 * INTEGER at scale 1e-6 — never REAL — and read back via `safeIntegers()`.
 *
 * The voucher's OWN number (CV-) and its GL entry number are allocated by the
 * ledger store's connection-bound numbering engine so they stay gap-free; this
 * store owns only the document/allocation/invoice tables.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS voucher (
  id                             TEXT PRIMARY KEY,
  doc_no                         TEXT UNIQUE,
  doc_type                       TEXT NOT NULL,
  date                           TEXT NOT NULL,
  memo                           TEXT NOT NULL,
  status                         TEXT NOT NULL,
  voucher_type                   TEXT NOT NULL,
  direction                      TEXT NOT NULL,
  amount                         INTEGER NOT NULL,
  currency                       TEXT NOT NULL,
  branch_id                      TEXT NOT NULL,
  payment_method                 TEXT NOT NULL,
  treasury_account_id            TEXT NOT NULL,
  treasury_gl_account_id         TEXT NOT NULL,
  counterparty_gl_account_id     TEXT,
  counter_treasury_account_id    TEXT,
  counter_treasury_gl_account_id TEXT,
  customer_id                    TEXT,
  supplier_id                    TEXT,
  reference_no                   TEXT,
  created_at                     TEXT NOT NULL,
  confirmed_at                   TEXT,
  reverses_doc_id                TEXT,
  reversed_by_doc_id             TEXT,
  workflow_request_id            TEXT,
  journal_entry_id               TEXT
);
CREATE INDEX IF NOT EXISTS idx_voucher_status ON voucher(status);
CREATE INDEX IF NOT EXISTS idx_voucher_type ON voucher(voucher_type);
CREATE TABLE IF NOT EXISTS voucher_allocation (
  id          TEXT PRIMARY KEY,
  voucher_id  TEXT NOT NULL,
  invoice_id  TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  reversed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alloc_voucher ON voucher_allocation(voucher_id);
CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON voucher_allocation(invoice_id);
CREATE TABLE IF NOT EXISTS open_invoice (
  id         TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  kind       TEXT NOT NULL,
  party_id   TEXT NOT NULL,
  date       TEXT NOT NULL,
  total      INTEGER NOT NULL,
  allocated  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_party ON open_invoice(party_id);
`;

interface VoucherRow {
  id: string;
  doc_no: string | null;
  doc_type: string;
  date: string;
  memo: string;
  status: string;
  voucher_type: string;
  direction: string;
  amount: bigint;
  currency: string;
  branch_id: string;
  payment_method: string;
  treasury_account_id: string;
  treasury_gl_account_id: string;
  counterparty_gl_account_id: string | null;
  counter_treasury_account_id: string | null;
  counter_treasury_gl_account_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  reference_no: string | null;
  created_at: string;
  confirmed_at: string | null;
  reverses_doc_id: string | null;
  reversed_by_doc_id: string | null;
  workflow_request_id: string | null;
  journal_entry_id: string | null;
}

function toDocument(row: VoucherRow): FrameworkDocument<VoucherLine> {
  const line: VoucherLine = {
    voucherType: row.voucher_type as VoucherType,
    direction: row.direction as VoucherDirection,
    amount: Money.fromScaled(row.amount),
    currency: row.currency,
    branchId: row.branch_id,
    paymentMethod: row.payment_method as VoucherPaymentMethod,
    treasuryAccountId: row.treasury_account_id,
    treasuryGlAccountId: row.treasury_gl_account_id,
    counterpartyGlAccountId: row.counterparty_gl_account_id,
    counterTreasuryAccountId: row.counter_treasury_account_id,
    counterTreasuryGlAccountId: row.counter_treasury_gl_account_id,
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    referenceNo: row.reference_no,
  };
  return {
    id: row.id,
    docType: row.doc_type,
    docNo: row.doc_no,
    date: row.date,
    memo: row.memo,
    status: row.status as DocumentStatus,
    lines: [line],
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    reversesDocId: row.reverses_doc_id,
    reversedByDocId: row.reversed_by_doc_id,
    workflowRequestId: row.workflow_request_id,
    journalEntryId: row.journal_entry_id,
  };
}

function docParams(doc: FrameworkDocument<VoucherLine>) {
  const line = doc.lines[0];
  if (!line) throw new Error(`Voucher "${doc.id}" has no economic line.`);
  return {
    id: doc.id,
    doc_no: doc.docNo,
    doc_type: doc.docType,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    voucher_type: line.voucherType,
    direction: line.direction,
    amount: line.amount.toScaledNumber(),
    currency: line.currency,
    branch_id: line.branchId,
    payment_method: line.paymentMethod,
    treasury_account_id: line.treasuryAccountId,
    treasury_gl_account_id: line.treasuryGlAccountId,
    counterparty_gl_account_id: line.counterpartyGlAccountId,
    counter_treasury_account_id: line.counterTreasuryAccountId,
    counter_treasury_gl_account_id: line.counterTreasuryGlAccountId,
    customer_id: line.customerId,
    supplier_id: line.supplierId,
    reference_no: line.referenceNo,
    created_at: doc.createdAt,
    confirmed_at: doc.confirmedAt,
    reverses_doc_id: doc.reversesDocId,
    reversed_by_doc_id: doc.reversedByDocId,
    workflow_request_id: doc.workflowRequestId,
    journal_entry_id: doc.journalEntryId,
  };
}

class SqliteVoucherRepository implements DocumentRepository<VoucherLine> {
  private readonly insert: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO voucher (
        id, doc_no, doc_type, date, memo, status, voucher_type, direction, amount, currency,
        branch_id, payment_method, treasury_account_id, treasury_gl_account_id,
        counterparty_gl_account_id, counter_treasury_account_id, counter_treasury_gl_account_id,
        customer_id, supplier_id, reference_no, created_at, confirmed_at,
        reverses_doc_id, reversed_by_doc_id, workflow_request_id, journal_entry_id
      ) VALUES (
        @id, @doc_no, @doc_type, @date, @memo, @status, @voucher_type, @direction, @amount, @currency,
        @branch_id, @payment_method, @treasury_account_id, @treasury_gl_account_id,
        @counterparty_gl_account_id, @counter_treasury_account_id, @counter_treasury_gl_account_id,
        @customer_id, @supplier_id, @reference_no, @created_at, @confirmed_at,
        @reverses_doc_id, @reversed_by_doc_id, @workflow_request_id, @journal_entry_id
      )
    `);
    this.updateStmt = sqlite.prepare(`
      UPDATE voucher SET
        doc_no = @doc_no, memo = @memo, status = @status, amount = @amount,
        counterparty_gl_account_id = @counterparty_gl_account_id,
        counter_treasury_account_id = @counter_treasury_account_id,
        counter_treasury_gl_account_id = @counter_treasury_gl_account_id,
        customer_id = @customer_id, supplier_id = @supplier_id, reference_no = @reference_no,
        confirmed_at = @confirmed_at, reverses_doc_id = @reverses_doc_id,
        reversed_by_doc_id = @reversed_by_doc_id, workflow_request_id = @workflow_request_id,
        journal_entry_id = @journal_entry_id
      WHERE id = @id
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM voucher WHERE id = ?`).safeIntegers();
  }

  async save(doc: FrameworkDocument<VoucherLine>): Promise<void> {
    this.insert.run(docParams(doc));
  }

  async update(doc: FrameworkDocument<VoucherLine>): Promise<void> {
    this.updateStmt.run(docParams(doc));
  }

  async findById(id: string): Promise<FrameworkDocument<VoucherLine> | null> {
    const row = this.selectById.get(id) as VoucherRow | undefined;
    return row ? toDocument(row) : null;
  }

  async list(filter: DocumentListFilter = {}): Promise<readonly FrameworkDocument<VoucherLine>[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM voucher ${where} ORDER BY date DESC, created_at DESC`)
      .safeIntegers()
      .all(...params) as VoucherRow[];
    return rows.map(toDocument);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.sqlite.exec("BEGIN");
    try {
      const result = await fn();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}

interface AllocationRow {
  id: string;
  voucher_id: string;
  invoice_id: string;
  amount: bigint;
  status: string;
  created_at: string;
  reversed_at: string | null;
}

function toAllocation(row: AllocationRow): VoucherAllocation {
  return {
    id: row.id,
    voucherId: row.voucher_id,
    invoiceId: row.invoice_id,
    amount: Money.fromScaled(row.amount),
    status: row.status as AllocationStatus,
    createdAt: row.created_at,
    reversedAt: row.reversed_at,
  };
}

class SqliteAllocationRepository implements AllocationRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByVoucher: Database.Statement;
  private readonly selectByInvoice: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO voucher_allocation (id, voucher_id, invoice_id, amount, status, created_at, reversed_at)
      VALUES (@id, @voucher_id, @invoice_id, @amount, @status, @created_at, @reversed_at)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, reversed_at = excluded.reversed_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM voucher_allocation WHERE id = ?`).safeIntegers();
    this.selectByVoucher = sqlite.prepare(`SELECT * FROM voucher_allocation WHERE voucher_id = ? ORDER BY created_at`).safeIntegers();
    this.selectByInvoice = sqlite.prepare(`SELECT * FROM voucher_allocation WHERE invoice_id = ? ORDER BY created_at`).safeIntegers();
  }

  private write(alloc: VoucherAllocation): void {
    this.upsert.run({
      id: alloc.id,
      voucher_id: alloc.voucherId,
      invoice_id: alloc.invoiceId,
      amount: alloc.amount.toScaledNumber(),
      status: alloc.status,
      created_at: alloc.createdAt,
      reversed_at: alloc.reversedAt,
    });
  }

  async save(alloc: VoucherAllocation): Promise<void> {
    this.write(alloc);
  }
  async update(alloc: VoucherAllocation): Promise<void> {
    this.write(alloc);
  }
  async findById(id: string): Promise<VoucherAllocation | null> {
    const row = this.selectById.get(id) as AllocationRow | undefined;
    return row ? toAllocation(row) : null;
  }
  async listByVoucher(voucherId: string): Promise<readonly VoucherAllocation[]> {
    return (this.selectByVoucher.all(voucherId) as AllocationRow[]).map(toAllocation);
  }
  async listByInvoice(invoiceId: string): Promise<readonly VoucherAllocation[]> {
    return (this.selectByInvoice.all(invoiceId) as AllocationRow[]).map(toAllocation);
  }
}

interface InvoiceRow {
  id: string;
  invoice_no: string;
  kind: string;
  party_id: string;
  date: string;
  total: bigint;
  allocated: bigint;
}

function toInvoice(row: InvoiceRow): AllocatableInvoice {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    kind: row.kind as AllocationInvoiceKind,
    partyId: row.party_id,
    date: row.date,
    total: Money.fromScaled(row.total),
    allocated: Money.fromScaled(row.allocated),
  };
}

class SqliteInvoiceRepository implements AllocatableInvoiceRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO open_invoice (id, invoice_no, kind, party_id, date, total, allocated)
      VALUES (@id, @invoice_no, @kind, @party_id, @date, @total, @allocated)
      ON CONFLICT(id) DO UPDATE SET
        invoice_no = excluded.invoice_no, kind = excluded.kind, party_id = excluded.party_id,
        date = excluded.date, total = excluded.total, allocated = excluded.allocated
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM open_invoice WHERE id = ?`).safeIntegers();
  }

  async findById(id: string): Promise<AllocatableInvoice | null> {
    const row = this.selectById.get(id) as InvoiceRow | undefined;
    return row ? toInvoice(row) : null;
  }

  async save(invoice: AllocatableInvoice): Promise<void> {
    this.upsert.run({
      id: invoice.id,
      invoice_no: invoice.invoiceNo,
      kind: invoice.kind,
      party_id: invoice.partyId,
      date: invoice.date,
      total: invoice.total.toScaledNumber(),
      allocated: invoice.allocated.toScaledNumber(),
    });
  }

  async listOpen(filter: { kind?: AllocationInvoiceKind; partyId?: string }): Promise<readonly AllocatableInvoice[]> {
    const clauses: string[] = ["total > allocated"];
    const params: unknown[] = [];
    if (filter.kind) {
      clauses.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.partyId) {
      clauses.push("party_id = ?");
      params.push(filter.partyId);
    }
    const rows = this.sqlite
      .prepare(`SELECT * FROM open_invoice WHERE ${clauses.join(" AND ")} ORDER BY date`)
      .safeIntegers()
      .all(...params) as InvoiceRow[];
    return rows.map(toInvoice);
  }
}

export interface SqliteVoucherStoreHandle {
  readonly documents: DocumentRepository<VoucherLine>;
  readonly allocations: AllocationRepository;
  readonly invoices: AllocatableInvoiceRepository;
  close(): void;
}

/** Open a SQLite-backed voucher store (documents + allocations + open invoices). ":memory:" for tests. */
export function createSqliteVoucherStore(path = ":memory:"): SqliteVoucherStoreHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  return {
    documents: new SqliteVoucherRepository(sqlite),
    allocations: new SqliteAllocationRepository(sqlite),
    invoices: new SqliteInvoiceRepository(sqlite),
    close: () => sqlite.close(),
  };
}
