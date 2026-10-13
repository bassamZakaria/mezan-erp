import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertingNew } from "./insert-new.js";
import { childRowsByParent } from "./list-query.js";
import {
  Money,
  type AllocatableInvoice,
  type AllocatableInvoiceRepository,
  type AllocationInvoiceKind,
  type AllocationRepository,
  type FxRevaluationShareRecord,
  type FxRevaluationShareRepository,
  type FxOpenItemRef,
  FxOpenItemType,
  type AllocationStatus,
  type CostCategory,
  type DocumentListFilter,
  type DocumentRepository,
  type DocumentStatus,
  type FrameworkDocument,
  type HeldAllocationRequest,
  type VoucherAllocation,
  type VoucherDirection,
  type VoucherLine,
  type TreasuryLegFx,
  type VoucherPaymentMethod,
  type VoucherType,
} from "@mezan/domain";

/**
 * SQLite-backed persistence for Treasury Vouchers (docs/archive/catalog/04 §"السندات
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
  fx_rate                        TEXT,
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
  cost_center_id                 TEXT,
  project_id                     TEXT,
  cost_category                  TEXT,
  withholding_amount             INTEGER,
  withholding_rate_percent       REAL,
  withholding_gl_account_id      TEXT,
  held_allocations               TEXT,
  treasury_fx                    TEXT,
  created_at                     TEXT NOT NULL,
  confirmed_at                   TEXT,
  reverses_doc_id                TEXT,
  reversed_by_doc_id             TEXT,
  workflow_request_id            TEXT,
  journal_entry_id               TEXT
);
CREATE INDEX IF NOT EXISTS idx_voucher_status ON voucher(status);
CREATE INDEX IF NOT EXISTS idx_voucher_type ON voucher(voucher_type);
-- Every voucher list and every treasury report bounds by date; without this the
-- only plan was a full scan and a sort of the table (Q-8).
CREATE INDEX IF NOT EXISTS idx_voucher_date ON voucher(date);
CREATE TABLE IF NOT EXISTS voucher_allocation (
  id          TEXT PRIMARY KEY,
  voucher_id  TEXT NOT NULL,
  invoice_id  TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  reversed_at TEXT,
  invoice_amount INTEGER,
  fx_entry_id TEXT,
  date        TEXT,
  reversed_on TEXT,
  revaluation_share INTEGER
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
CREATE TABLE IF NOT EXISTS fx_revaluation_share (
  entry_id   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  party_id   TEXT NOT NULL,
  currency   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  item_type  TEXT NOT NULL DEFAULT 'invoice',
  PRIMARY KEY (entry_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_fx_share_item ON fx_revaluation_share(item_id);
`;

/** Voucher columns added after the table shipped — an existing books file migrates via `ALTER TABLE`. */
const ADDED_VOUCHER_COLUMNS: readonly [string, string][] = [
  // An existing books file already has `voucher`, and CREATE TABLE IF NOT
  // EXISTS silently no-ops on it, so every column added after the table
  // shipped has to be widened in place here.
  ["fx_rate", "TEXT"],
  ["project_id", "TEXT"],
  ["cost_category", "TEXT"],
  ["held_allocations", "TEXT"],
  ["treasury_fx", "TEXT"],
];

/** Allocation columns added after the table shipped (D221: a foreign invoice relieved at its booked rate). */
const ADDED_ALLOCATION_COLUMNS: readonly [string, string][] = [
  ["invoice_amount", "INTEGER"],
  ["fx_entry_id", "TEXT"],
  ["date", "TEXT"],
  ["reversed_on", "TEXT"],
  ["revaluation_share", "INTEGER"],
  ["money_revaluation_share", "INTEGER"],
];

const ADDED_SHARE_COLUMNS: readonly [string, string][] = [["item_type", "TEXT NOT NULL DEFAULT 'invoice'"]];

function addMissingColumns(sqlite: Database.Database): void {
  for (const [table, columns] of [["voucher", ADDED_VOUCHER_COLUMNS], ["voucher_allocation", ADDED_ALLOCATION_COLUMNS], ["fx_revaluation_share", ADDED_SHARE_COLUMNS]] as const) {
    const existing = new Set(
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    );
    for (const [name, type] of columns) {
      if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

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
  fx_rate: string | null;
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
  cost_center_id: string | null;
  project_id: string | null;
  cost_category: string | null;
  withholding_amount: number | null;
  withholding_rate_percent: number | null;
  withholding_gl_account_id: string | null;
  held_allocations: string | null;
  treasury_fx: string | null;
  created_at: string;
  confirmed_at: string | null;
  reverses_doc_id: string | null;
  reversed_by_doc_id: string | null;
  workflow_request_id: string | null;
  journal_entry_id: string | null;
}

interface StoredHeldAllocation {
  allocationId: string;
  invoiceId: string;
  amountScaled: string | null;
}

function toStoredHeldAllocation(a: HeldAllocationRequest): StoredHeldAllocation {
  return { allocationId: a.allocationId, invoiceId: a.invoiceId, amountScaled: a.amount ? a.amount.scaled.toString() : null };
}

interface StoredTreasuryLegFx {
  readonly currency: string;
  readonly fxRate: string;
  readonly foreignAmount: string;
  readonly carryingBase?: string;
  readonly realised?: string;
  readonly realisedAccountId?: string;
}

function parseTreasuryFx(raw: string | null): Pick<VoucherLine, "treasuryFx" | "counterTreasuryFx"> {
  if (!raw) return { treasuryFx: null, counterTreasuryFx: null };
  const stored = JSON.parse(raw) as { treasury?: StoredTreasuryLegFx | null; counter?: StoredTreasuryLegFx | null };
  const leg = (value: StoredTreasuryLegFx | null | undefined): TreasuryLegFx | null =>
    value
      ? {
          currency: value.currency,
          fxRate: value.fxRate,
          foreignAmount: Money.fromMajor(value.foreignAmount),
          ...(value.carryingBase === undefined ? {} : { carryingBase: Money.fromMajor(value.carryingBase) }),
          ...(value.realised === undefined ? {} : { realised: Money.fromMajor(value.realised) }),
          ...(value.realisedAccountId === undefined ? {} : { realisedAccountId: value.realisedAccountId }),
        }
      : null;
  return { treasuryFx: leg(stored.treasury), counterTreasuryFx: leg(stored.counter) };
}

function storedTreasuryFx(line: VoucherLine): string | null {
  if (!line.treasuryFx && !line.counterTreasuryFx) return null;
  const leg = (value: TreasuryLegFx | null | undefined): StoredTreasuryLegFx | null =>
    value
      ? {
          currency: value.currency,
          fxRate: value.fxRate,
          foreignAmount: value.foreignAmount.toString(),
          ...(value.carryingBase ? { carryingBase: value.carryingBase.toString() } : {}),
          ...(value.realised ? { realised: value.realised.toString() } : {}),
          ...(value.realisedAccountId ? { realisedAccountId: value.realisedAccountId } : {}),
        }
      : null;
  return JSON.stringify({ treasury: leg(line.treasuryFx), counter: leg(line.counterTreasuryFx) });
}

function parseHeldAllocations(raw: string | null): readonly HeldAllocationRequest[] | null {
  if (!raw) return null;
  return (JSON.parse(raw) as StoredHeldAllocation[]).map((a) => ({
    allocationId: a.allocationId,
    invoiceId: a.invoiceId,
    amount: a.amountScaled === null ? null : Money.fromScaled(BigInt(a.amountScaled)),
  }));
}

function toDocument(row: VoucherRow): FrameworkDocument<VoucherLine> {
  const line: VoucherLine = {
    voucherType: row.voucher_type as VoucherType,
    direction: row.direction as VoucherDirection,
    amount: Money.fromScaled(row.amount),
    currency: row.currency,
    fxRate: row.fx_rate,
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
    costCenterId: row.cost_center_id,
    projectId: row.project_id,
    costCategory: row.cost_category as CostCategory | null,
    withholdingAmount: row.withholding_amount === null ? null : Money.fromScaled(row.withholding_amount),
    withholdingRatePercent: row.withholding_rate_percent,
    withholdingGlAccountId: row.withholding_gl_account_id,
    heldAllocations: parseHeldAllocations(row.held_allocations),
    ...parseTreasuryFx(row.treasury_fx),
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
    fx_rate: line.fxRate ?? null,
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
    cost_center_id: line.costCenterId ?? null,
    project_id: line.projectId ?? null,
    cost_category: line.costCategory ?? null,
    withholding_amount: line.withholdingAmount ? line.withholdingAmount.toScaledNumber() : null,
    withholding_rate_percent: line.withholdingRatePercent ?? null,
    withholding_gl_account_id: line.withholdingGlAccountId ?? null,
    held_allocations: line.heldAllocations?.length ? JSON.stringify(line.heldAllocations.map(toStoredHeldAllocation)) : null,
    treasury_fx: storedTreasuryFx(line),
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
        id, doc_no, doc_type, date, memo, status, voucher_type, direction, amount, currency, fx_rate,
        branch_id, payment_method, treasury_account_id, treasury_gl_account_id,
        counterparty_gl_account_id, counter_treasury_account_id, counter_treasury_gl_account_id,
        customer_id, supplier_id, reference_no, cost_center_id, project_id, cost_category,
        withholding_amount, withholding_rate_percent, withholding_gl_account_id, held_allocations, treasury_fx, created_at, confirmed_at,
        reverses_doc_id, reversed_by_doc_id, workflow_request_id, journal_entry_id
      ) VALUES (
        @id, @doc_no, @doc_type, @date, @memo, @status, @voucher_type, @direction, @amount, @currency, @fx_rate,
        @branch_id, @payment_method, @treasury_account_id, @treasury_gl_account_id,
        @counterparty_gl_account_id, @counter_treasury_account_id, @counter_treasury_gl_account_id,
        @customer_id, @supplier_id, @reference_no, @cost_center_id, @project_id, @cost_category,
        @withholding_amount, @withholding_rate_percent, @withholding_gl_account_id, @held_allocations, @treasury_fx, @created_at, @confirmed_at,
        @reverses_doc_id, @reversed_by_doc_id, @workflow_request_id, @journal_entry_id
      )
    `);
    this.updateStmt = sqlite.prepare(`
      UPDATE voucher SET
        doc_no = @doc_no, memo = @memo, status = @status, amount = @amount, fx_rate = @fx_rate,
        counterparty_gl_account_id = @counterparty_gl_account_id,
        counter_treasury_account_id = @counter_treasury_account_id,
        counter_treasury_gl_account_id = @counter_treasury_gl_account_id,
        customer_id = @customer_id, supplier_id = @supplier_id, reference_no = @reference_no,
        cost_center_id = @cost_center_id, project_id = @project_id, cost_category = @cost_category,
        withholding_amount = @withholding_amount,
        withholding_rate_percent = @withholding_rate_percent,
        withholding_gl_account_id = @withholding_gl_account_id,
        held_allocations = @held_allocations,
        treasury_fx = @treasury_fx,
        confirmed_at = @confirmed_at, reverses_doc_id = @reverses_doc_id,
        reversed_by_doc_id = @reversed_by_doc_id, workflow_request_id = @workflow_request_id,
        journal_entry_id = @journal_entry_id
      WHERE id = @id
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM voucher WHERE id = ?`).safeIntegers();
  }

  async save(doc: FrameworkDocument<VoucherLine>): Promise<void> {
    insertingNew(doc.id, () => this.insert.run(docParams(doc)));
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
    return withSqliteTransaction(this.sqlite, fn, "BEGIN");
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
  invoice_amount: bigint | null;
  fx_entry_id: string | null;
  date: string | null;
  reversed_on: string | null;
  revaluation_share: bigint | null;
  money_revaluation_share: bigint | null;
}

function toAllocation(row: AllocationRow): VoucherAllocation {
  return {
    id: row.id,
    voucherId: row.voucher_id,
    invoiceId: row.invoice_id,
    amount: Money.fromScaled(row.amount),
    invoiceAmount: row.invoice_amount === null ? null : Money.fromScaled(row.invoice_amount),
    fxEntryId: row.fx_entry_id,
    revaluationShare: row.revaluation_share === null ? null : Money.fromScaled(row.revaluation_share),
    moneyRevaluationShare: row.money_revaluation_share === null ? null : Money.fromScaled(row.money_revaluation_share),
    status: row.status as AllocationStatus,
    createdAt: row.created_at,
    reversedAt: row.reversed_at,
    date: row.date,
    reversedOn: row.reversed_on,
  };
}

class SqliteAllocationRepository implements AllocationRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByVoucher: Database.Statement;
  private readonly selectByInvoice: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO voucher_allocation (id, voucher_id, invoice_id, amount, status, created_at, reversed_at, invoice_amount, fx_entry_id, date, reversed_on, revaluation_share, money_revaluation_share)
      VALUES (@id, @voucher_id, @invoice_id, @amount, @status, @created_at, @reversed_at, @invoice_amount, @fx_entry_id, @date, @reversed_on, @revaluation_share, @money_revaluation_share)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, reversed_at = excluded.reversed_at, reversed_on = excluded.reversed_on
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
      invoice_amount: alloc.invoiceAmount ? alloc.invoiceAmount.toScaledNumber() : null,
      fx_entry_id: alloc.fxEntryId ?? null,
      date: alloc.date ?? null,
      reversed_on: alloc.reversedOn ?? null,
      revaluation_share: alloc.revaluationShare ? alloc.revaluationShare.toScaledNumber() : null,
      money_revaluation_share: alloc.moneyRevaluationShare ? alloc.moneyRevaluationShare.toScaledNumber() : null,
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

  async allocatedByIds(ids: readonly string[]): Promise<ReadonlyMap<string, Money>> {
    const rowsById = childRowsByParent<InvoiceRow>(this.sqlite, {
      table: "open_invoice",
      parentColumn: "id",
      parentIds: ids,
      orderBy: "id",
      columns: "id, allocated",
      safeIntegers: true,
    });
    const out = new Map<string, Money>();
    for (const [id, rows] of rowsById) {
      const row = rows[0];
      if (row) out.set(id, Money.fromScaled(row.allocated));
    }
    return out;
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

interface ShareRow {
  entry_id: string;
  item_id: string;
  account_id: string;
  kind: string;
  party_id: string;
  currency: string;
  amount: bigint;
  item_type: string;
}

function toShare(row: ShareRow): FxRevaluationShareRecord {
  return {
    entryId: row.entry_id,
    itemId: row.item_id,
    itemType: row.item_type === FxOpenItemType.Money ? FxOpenItemType.Money : FxOpenItemType.Invoice,
    accountId: row.account_id,
    kind: row.kind as AllocationInvoiceKind,
    partyId: row.party_id,
    currency: row.currency,
    amount: Money.fromScaled(row.amount),
  };
}

class SqliteRevaluationShareRepository implements FxRevaluationShareRepository {
  private readonly insert: Database.Statement;
  private readonly selectByItem: Database.Statement;
  private readonly selectByEntry: Database.Statement;
  private readonly selectItems: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.selectItems = sqlite.prepare(`SELECT DISTINCT item_id, item_type FROM fx_revaluation_share ORDER BY item_id, item_type`);
    this.insert = sqlite.prepare(`
      INSERT INTO fx_revaluation_share (entry_id, item_id, account_id, kind, party_id, currency, amount, item_type)
      VALUES (@entry_id, @item_id, @account_id, @kind, @party_id, @currency, @amount, @item_type)
    `);
    this.selectByItem = sqlite.prepare(`SELECT * FROM fx_revaluation_share WHERE item_id = ? AND item_type = ? ORDER BY entry_id`).safeIntegers();
    this.selectByEntry = sqlite.prepare(`SELECT * FROM fx_revaluation_share WHERE entry_id = ? ORDER BY item_id`).safeIntegers();
  }

  async saveAll(shares: readonly FxRevaluationShareRecord[]): Promise<void> {
    for (const share of shares) {
      this.insert.run({
        entry_id: share.entryId,
        item_id: share.itemId,
        account_id: share.accountId,
        kind: share.kind,
        party_id: share.partyId,
        currency: share.currency,
        amount: share.amount.toScaledNumber(),
        item_type: share.itemType,
      });
    }
  }
  async listByItem(item: FxOpenItemRef): Promise<readonly FxRevaluationShareRecord[]> {
    return (this.selectByItem.all(item.id, item.type) as ShareRow[]).map(toShare);
  }
  async listByEntry(entryId: string): Promise<readonly FxRevaluationShareRecord[]> {
    return (this.selectByEntry.all(entryId) as ShareRow[]).map(toShare);
  }
  async listItems(): Promise<readonly FxOpenItemRef[]> {
    return (this.selectItems.all() as { item_id: string; item_type: string }[]).map((row) => ({
      id: row.item_id,
      type: row.item_type === FxOpenItemType.Money ? FxOpenItemType.Money : FxOpenItemType.Invoice,
    }));
  }
}

export interface SqliteVoucherStoreHandle {
  readonly documents: DocumentRepository<VoucherLine>;
  readonly allocations: AllocationRepository;
  readonly invoices: AllocatableInvoiceRepository;
  readonly revaluationShares: FxRevaluationShareRepository;
  close(): void;
}

/** Open a SQLite-backed voucher store (documents + allocations + open invoices). ":memory:" for tests. */
export function createSqliteVoucherStore(path: SqliteConnectionInput = ":memory:"): SqliteVoucherStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  return {
    documents: new SqliteVoucherRepository(sqlite),
    allocations: new SqliteAllocationRepository(sqlite),
    invoices: new SqliteInvoiceRepository(sqlite),
    revaluationShares: new SqliteRevaluationShareRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
