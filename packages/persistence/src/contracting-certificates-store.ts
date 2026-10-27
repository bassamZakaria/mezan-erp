import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseTakenIdAsync } from "./insert-new.js";
import { childRowsByParentAsync } from "./list-query.js";
import { TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type BoqUnit,
  type CertificateComputation,
  type CertificateDeductionKey,
  type CertificateDeductionRow,
  type CertificateMaterialLine,
  type CertificateWorkLine,
  type ProgressCertificate,
  type ProgressCertificateListFilter,
  type ProgressCertificateStatus,
  type ProgressCertificateStore,
  type VatBasis,
} from "@mezan/domain";

/**
 * SQLite-backed المستخلص store (design §04).
 *
 * Four tables — header, work lines, materials on site, deductions — rather
 * than a JSON blob, because a certificate is queried BY CONTRACT and BY SERIAL
 * on every recompute (the previous cumulative is read off the previous
 * certificate's lines), and the deductions block is what the ledger and the
 * print both read.
 *
 * The header carries the computed scalars and the deduction table carries the
 * block's rows, so the stored computation has exactly one home: a list never
 * recomputes history, and a printed certificate can never disagree with the
 * one that was signed.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS contracting_certificate (
  id                             TEXT PRIMARY KEY,
  doc_no                         TEXT NOT NULL UNIQUE,
  contract_id                    TEXT NOT NULL,
  project_id                     TEXT NOT NULL,
  serial                         INTEGER NOT NULL,
  previous_certificate_id        TEXT,
  period_from                    TEXT NOT NULL,
  period_to                      TEXT NOT NULL,
  execution_date                 TEXT NOT NULL,
  is_final                       INTEGER NOT NULL DEFAULT 0,
  status                         TEXT NOT NULL,
  prepared_by                    TEXT,
  prepared_at                    TEXT,
  measured_by                    TEXT,
  measured_at                    TEXT,
  certified_by                   TEXT,
  certified_at                   TEXT,
  approved_by                    TEXT,
  approved_at                    TEXT,
  cancelled_at                   TEXT,
  cancelled_by                   TEXT,
  cancel_reason_ar               TEXT,
  voided_at                      TEXT,
  voided_by                      TEXT,
  void_reason_ar                 TEXT,
  void_journal_entry_id          TEXT,
  invoice_id                     TEXT,
  invoice_doc_no                 TEXT,
  journal_entry_id               TEXT,
  posted_deductions_total        INTEGER NOT NULL DEFAULT 0,
  due_date                       TEXT,
  penalties_cumulative           INTEGER NOT NULL DEFAULT 0,
  suspended_cumulative           INTEGER NOT NULL DEFAULT 0,
  employer_materials_cumulative  INTEGER NOT NULL DEFAULT 0,
  water_electricity_cumulative   INTEGER NOT NULL DEFAULT 0,
  notes                          TEXT,
  gross_works                    INTEGER NOT NULL DEFAULT 0,
  materials_on_site              INTEGER NOT NULL DEFAULT 0,
  certificate_total              INTEGER NOT NULL DEFAULT 0,
  tender_discount_percent        TEXT NOT NULL DEFAULT '0',
  tender_discount                INTEGER NOT NULL DEFAULT 0,
  net_certified                  INTEGER NOT NULL DEFAULT 0,
  previous_net_certified         INTEGER NOT NULL DEFAULT 0,
  this_certificate_net_certified INTEGER NOT NULL DEFAULT 0,
  deductions_this_certificate    INTEGER NOT NULL DEFAULT 0,
  deductions_cumulative          INTEGER NOT NULL DEFAULT 0,
  suspended_balance              INTEGER NOT NULL DEFAULT 0,
  invoice_base                   INTEGER NOT NULL DEFAULT 0,
  vat_basis                      TEXT NOT NULL DEFAULT 'standard',
  vat_statutory_rate_percent     TEXT NOT NULL DEFAULT '14',
  vat_effective_rate_percent     TEXT NOT NULL DEFAULT '14',
  vat                            INTEGER NOT NULL DEFAULT 0,
  previous_payments              INTEGER NOT NULL DEFAULT 0,
  net_payable_this_certificate   INTEGER NOT NULL DEFAULT 0,
  cumulative_net_payable         INTEGER NOT NULL DEFAULT 0,
  contract_value_after_variations INTEGER NOT NULL DEFAULT 0,
  completion_percent             TEXT NOT NULL DEFAULT '0.0',
  retention_held_cumulative      INTEGER NOT NULL DEFAULT 0,
  advance_received               INTEGER NOT NULL DEFAULT 0,
  advance_outstanding            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_certificate_contract ON contracting_certificate (contract_id, serial);
CREATE INDEX IF NOT EXISTS idx_certificate_project ON contracting_certificate (project_id);
CREATE INDEX IF NOT EXISTS idx_certificate_status ON contracting_certificate (status);

CREATE TABLE IF NOT EXISTS contracting_certificate_work_line (
  id                        TEXT PRIMARY KEY,
  certificate_id            TEXT NOT NULL REFERENCES contracting_certificate(id) ON DELETE CASCADE,
  boq_line_id               TEXT NOT NULL,
  code                      TEXT NOT NULL,
  description_ar            TEXT NOT NULL,
  unit                      TEXT NOT NULL,
  unit_rate                 INTEGER NOT NULL,
  this_period_qty           INTEGER NOT NULL,
  previous_cumulative_qty   INTEGER NOT NULL,
  cumulative_qty            INTEGER NOT NULL,
  contracted_qty            INTEGER NOT NULL,
  completion_percent        TEXT NOT NULL,
  previous_cumulative_value INTEGER NOT NULL,
  cumulative_value          INTEGER NOT NULL,
  this_period_value         INTEGER NOT NULL,
  sort_order                INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificate_work_line ON contracting_certificate_work_line (certificate_id, sort_order);

CREATE TABLE IF NOT EXISTS contracting_certificate_material_line (
  id                      TEXT PRIMARY KEY,
  certificate_id          TEXT NOT NULL REFERENCES contracting_certificate(id) ON DELETE CASCADE,
  material_key            TEXT NOT NULL,
  description_ar          TEXT NOT NULL,
  unit                    TEXT NOT NULL,
  qty                     INTEGER NOT NULL,
  unit_rate               INTEGER NOT NULL,
  previous_cumulative_qty INTEGER NOT NULL,
  cumulative_qty          INTEGER NOT NULL,
  value                   INTEGER NOT NULL,
  previous_value          INTEGER NOT NULL,
  sort_order              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificate_material_line ON contracting_certificate_material_line (certificate_id, sort_order);

CREATE TABLE IF NOT EXISTS contracting_certificate_deduction (
  certificate_id   TEXT NOT NULL REFERENCES contracting_certificate(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  label_ar         TEXT NOT NULL,
  percent          TEXT,
  cumulative       INTEGER NOT NULL,
  previous         INTEGER NOT NULL,
  this_certificate INTEGER NOT NULL,
  posted           INTEGER NOT NULL,
  capped           INTEGER NOT NULL,
  note_ar          TEXT,
  sort_order       INTEGER NOT NULL,
  PRIMARY KEY (certificate_id, key)
);
`;

interface HeaderRow {
  id: string;
  doc_no: string;
  contract_id: string;
  project_id: string;
  serial: bigint;
  previous_certificate_id: string | null;
  period_from: string;
  period_to: string;
  execution_date: string;
  is_final: bigint;
  status: string;
  prepared_by: string | null;
  prepared_at: string | null;
  measured_by: string | null;
  measured_at: string | null;
  certified_by: string | null;
  certified_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason_ar: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason_ar: string | null;
  void_journal_entry_id: string | null;
  invoice_id: string | null;
  invoice_doc_no: string | null;
  journal_entry_id: string | null;
  posted_deductions_total: bigint;
  due_date: string | null;
  penalties_cumulative: bigint;
  suspended_cumulative: bigint;
  employer_materials_cumulative: bigint;
  water_electricity_cumulative: bigint;
  notes: string | null;
  gross_works: bigint;
  materials_on_site: bigint;
  certificate_total: bigint;
  tender_discount_percent: string;
  tender_discount: bigint;
  net_certified: bigint;
  previous_net_certified: bigint;
  this_certificate_net_certified: bigint;
  deductions_this_certificate: bigint;
  deductions_cumulative: bigint;
  suspended_balance: bigint;
  invoice_base: bigint;
  vat_basis: string;
  vat_statutory_rate_percent: string;
  vat_effective_rate_percent: string;
  vat: bigint;
  previous_payments: bigint;
  net_payable_this_certificate: bigint;
  cumulative_net_payable: bigint;
  contract_value_after_variations: bigint;
  completion_percent: string;
  retention_held_cumulative: bigint;
  advance_received: bigint;
  advance_outstanding: bigint;
}

interface WorkLineRow {
  id: string;
  certificate_id: string;
  boq_line_id: string;
  code: string;
  description_ar: string;
  unit: string;
  unit_rate: bigint;
  this_period_qty: bigint;
  previous_cumulative_qty: bigint;
  cumulative_qty: bigint;
  contracted_qty: bigint;
  completion_percent: string;
  previous_cumulative_value: bigint;
  cumulative_value: bigint;
  this_period_value: bigint;
  sort_order: bigint;
}

interface MaterialLineRow {
  id: string;
  certificate_id: string;
  material_key: string;
  description_ar: string;
  unit: string;
  qty: bigint;
  unit_rate: bigint;
  previous_cumulative_qty: bigint;
  cumulative_qty: bigint;
  value: bigint;
  previous_value: bigint;
  sort_order: bigint;
}

interface DeductionRow {
  certificate_id: string;
  key: string;
  label_ar: string;
  percent: string | null;
  cumulative: bigint;
  previous: bigint;
  this_certificate: bigint;
  posted: bigint;
  capped: bigint;
  note_ar: string | null;
  sort_order: bigint;
}

function toWorkLine(row: WorkLineRow): CertificateWorkLine {
  return {
    id: row.id,
    boqLineId: row.boq_line_id,
    code: row.code,
    descriptionAr: row.description_ar,
    unit: row.unit as BoqUnit,
    unitRate: Money.fromScaled(row.unit_rate),
    thisPeriodQty: Qty.fromScaled(row.this_period_qty),
    previousCumulativeQty: Qty.fromScaled(row.previous_cumulative_qty),
    cumulativeQty: Qty.fromScaled(row.cumulative_qty),
    contractedQty: Qty.fromScaled(row.contracted_qty),
    completionPercent: row.completion_percent,
    previousCumulativeValue: Money.fromScaled(row.previous_cumulative_value),
    cumulativeValue: Money.fromScaled(row.cumulative_value),
    thisPeriodValue: Money.fromScaled(row.this_period_value),
    sortOrder: Number(row.sort_order),
  };
}

function toMaterialLine(row: MaterialLineRow): CertificateMaterialLine {
  return {
    id: row.id,
    materialKey: row.material_key,
    descriptionAr: row.description_ar,
    unit: row.unit as BoqUnit,
    qty: Qty.fromScaled(row.qty),
    unitRate: Money.fromScaled(row.unit_rate),
    previousCumulativeQty: Qty.fromScaled(row.previous_cumulative_qty),
    cumulativeQty: Qty.fromScaled(row.cumulative_qty),
    value: Money.fromScaled(row.value),
    previousValue: Money.fromScaled(row.previous_value),
    sortOrder: Number(row.sort_order),
  };
}

function toDeduction(row: DeductionRow): CertificateDeductionRow {
  return {
    key: row.key as CertificateDeductionKey,
    labelAr: row.label_ar,
    percent: row.percent,
    cumulative: Money.fromScaled(row.cumulative),
    previous: Money.fromScaled(row.previous),
    thisCertificate: Money.fromScaled(row.this_certificate),
    posted: Number(row.posted) === 1,
    capped: Number(row.capped) === 1,
    noteAr: row.note_ar ?? null,
  };
}

function toComputation(row: HeaderRow, deductions: readonly CertificateDeductionRow[]): CertificateComputation {
  return {
    grossWorks: Money.fromScaled(row.gross_works),
    materialsOnSite: Money.fromScaled(row.materials_on_site),
    certificateTotal: Money.fromScaled(row.certificate_total),
    tenderDiscountPercent: row.tender_discount_percent,
    tenderDiscount: Money.fromScaled(row.tender_discount),
    netCertified: Money.fromScaled(row.net_certified),
    previousNetCertified: Money.fromScaled(row.previous_net_certified),
    thisCertificateNetCertified: Money.fromScaled(row.this_certificate_net_certified),
    deductions,
    deductionsThisCertificate: Money.fromScaled(row.deductions_this_certificate),
    deductionsCumulative: Money.fromScaled(row.deductions_cumulative),
    suspendedBalance: Money.fromScaled(row.suspended_balance),
    invoiceBase: Money.fromScaled(row.invoice_base),
    vatBasis: row.vat_basis as VatBasis,
    vatStatutoryRatePercent: row.vat_statutory_rate_percent,
    vatEffectiveRatePercent: row.vat_effective_rate_percent,
    vat: Money.fromScaled(row.vat),
    previousPayments: Money.fromScaled(row.previous_payments),
    netPayableThisCertificate: Money.fromScaled(row.net_payable_this_certificate),
    cumulativeNetPayable: Money.fromScaled(row.cumulative_net_payable),
    contractValueAfterVariations: Money.fromScaled(row.contract_value_after_variations),
    completionPercent: row.completion_percent,
    retentionHeldCumulative: Money.fromScaled(row.retention_held_cumulative),
    advanceReceived: Money.fromScaled(row.advance_received),
    advanceOutstanding: Money.fromScaled(row.advance_outstanding),
  };
}

const UPSERT_HEADER = `
      INSERT INTO contracting_certificate (
        id, doc_no, contract_id, project_id, serial, previous_certificate_id, period_from, period_to,
        execution_date, is_final, status, prepared_by, prepared_at, measured_by, measured_at,
        certified_by, certified_at, approved_by, approved_at, cancelled_at, cancelled_by, cancel_reason_ar,
        voided_at, voided_by, void_reason_ar, void_journal_entry_id, invoice_id, invoice_doc_no,
        journal_entry_id, posted_deductions_total, due_date, penalties_cumulative, suspended_cumulative,
        employer_materials_cumulative, water_electricity_cumulative, notes,
        gross_works, materials_on_site, certificate_total, tender_discount_percent, tender_discount,
        net_certified, previous_net_certified, this_certificate_net_certified, deductions_this_certificate,
        deductions_cumulative, suspended_balance, invoice_base, vat_basis, vat_statutory_rate_percent,
        vat_effective_rate_percent, vat, previous_payments, net_payable_this_certificate,
        cumulative_net_payable, contract_value_after_variations, completion_percent,
        retention_held_cumulative, advance_received, advance_outstanding
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        doc_no = excluded.doc_no,
        contract_id = excluded.contract_id,
        project_id = excluded.project_id,
        serial = excluded.serial,
        previous_certificate_id = excluded.previous_certificate_id,
        period_from = excluded.period_from,
        period_to = excluded.period_to,
        execution_date = excluded.execution_date,
        is_final = excluded.is_final,
        status = excluded.status,
        prepared_by = excluded.prepared_by,
        prepared_at = excluded.prepared_at,
        measured_by = excluded.measured_by,
        measured_at = excluded.measured_at,
        certified_by = excluded.certified_by,
        certified_at = excluded.certified_at,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        cancelled_at = excluded.cancelled_at,
        cancelled_by = excluded.cancelled_by,
        cancel_reason_ar = excluded.cancel_reason_ar,
        voided_at = excluded.voided_at,
        voided_by = excluded.voided_by,
        void_reason_ar = excluded.void_reason_ar,
        void_journal_entry_id = excluded.void_journal_entry_id,
        invoice_id = excluded.invoice_id,
        invoice_doc_no = excluded.invoice_doc_no,
        journal_entry_id = excluded.journal_entry_id,
        posted_deductions_total = excluded.posted_deductions_total,
        due_date = excluded.due_date,
        penalties_cumulative = excluded.penalties_cumulative,
        suspended_cumulative = excluded.suspended_cumulative,
        employer_materials_cumulative = excluded.employer_materials_cumulative,
        water_electricity_cumulative = excluded.water_electricity_cumulative,
        notes = excluded.notes,
        gross_works = excluded.gross_works,
        materials_on_site = excluded.materials_on_site,
        certificate_total = excluded.certificate_total,
        tender_discount_percent = excluded.tender_discount_percent,
        tender_discount = excluded.tender_discount,
        net_certified = excluded.net_certified,
        previous_net_certified = excluded.previous_net_certified,
        this_certificate_net_certified = excluded.this_certificate_net_certified,
        deductions_this_certificate = excluded.deductions_this_certificate,
        deductions_cumulative = excluded.deductions_cumulative,
        suspended_balance = excluded.suspended_balance,
        invoice_base = excluded.invoice_base,
        vat_basis = excluded.vat_basis,
        vat_statutory_rate_percent = excluded.vat_statutory_rate_percent,
        vat_effective_rate_percent = excluded.vat_effective_rate_percent,
        vat = excluded.vat,
        previous_payments = excluded.previous_payments,
        net_payable_this_certificate = excluded.net_payable_this_certificate,
        cumulative_net_payable = excluded.cumulative_net_payable,
        contract_value_after_variations = excluded.contract_value_after_variations,
        completion_percent = excluded.completion_percent,
        retention_held_cumulative = excluded.retention_held_cumulative,
        advance_received = excluded.advance_received,
        advance_outstanding = excluded.advance_outstanding
    `;

function headerParams(certificate: ProgressCertificate): SqlValue[] {
  const c = certificate.computed;
  return [
    certificate.id,
    certificate.docNo,
    certificate.contractId,
    certificate.projectId,
    certificate.serial,
    certificate.previousCertificateId,
    certificate.periodFrom,
    certificate.periodTo,
    certificate.executionDate,
    certificate.isFinal ? 1 : 0,
    certificate.status,
    certificate.preparedBy,
    certificate.preparedAt,
    certificate.measuredBy,
    certificate.measuredAt,
    certificate.certifiedBy,
    certificate.certifiedAt,
    certificate.approvedBy,
    certificate.approvedAt,
    certificate.cancelledAt,
    certificate.cancelledBy,
    certificate.cancelReasonAr,
    certificate.voidedAt,
    certificate.voidedBy,
    certificate.voidReasonAr,
    certificate.voidJournalEntryId,
    certificate.invoiceId,
    certificate.invoiceDocNo,
    certificate.journalEntryId,
    certificate.postedDeductionsTotal.scaled,
    certificate.dueDate,
    certificate.penaltiesCumulative.scaled,
    certificate.suspendedCumulative.scaled,
    certificate.employerMaterialsCumulative.scaled,
    certificate.waterElectricityCumulative.scaled,
    certificate.notes,
    c.grossWorks.scaled,
    c.materialsOnSite.scaled,
    c.certificateTotal.scaled,
    c.tenderDiscountPercent,
    c.tenderDiscount.scaled,
    c.netCertified.scaled,
    c.previousNetCertified.scaled,
    c.thisCertificateNetCertified.scaled,
    c.deductionsThisCertificate.scaled,
    c.deductionsCumulative.scaled,
    c.suspendedBalance.scaled,
    c.invoiceBase.scaled,
    c.vatBasis,
    c.vatStatutoryRatePercent,
    c.vatEffectiveRatePercent,
    c.vat.scaled,
    c.previousPayments.scaled,
    c.netPayableThisCertificate.scaled,
    c.cumulativeNetPayable.scaled,
    c.contractValueAfterVariations.scaled,
    c.completionPercent,
    c.retentionHeldCumulative.scaled,
    c.advanceReceived.scaled,
    c.advanceOutstanding.scaled,
  ];
}

const INSERT_WORK_LINE = `
      INSERT INTO contracting_certificate_work_line (
        id, certificate_id, boq_line_id, code, description_ar, unit, unit_rate, this_period_qty,
        previous_cumulative_qty, cumulative_qty, contracted_qty, completion_percent,
        previous_cumulative_value, cumulative_value, this_period_value, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `;

function workLineParams(certificate: ProgressCertificate, line: CertificateWorkLine): SqlValue[] {
  return [
    line.id,
    certificate.id,
    line.boqLineId,
    line.code,
    line.descriptionAr,
    line.unit,
    line.unitRate.scaled,
    line.thisPeriodQty.scaled,
    line.previousCumulativeQty.scaled,
    line.cumulativeQty.scaled,
    line.contractedQty.scaled,
    line.completionPercent,
    line.previousCumulativeValue.scaled,
    line.cumulativeValue.scaled,
    line.thisPeriodValue.scaled,
    line.sortOrder,
  ];
}

const INSERT_MATERIAL_LINE = `
      INSERT INTO contracting_certificate_material_line (
        id, certificate_id, material_key, description_ar, unit, qty, unit_rate,
        previous_cumulative_qty, cumulative_qty, value, previous_value, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `;

function materialLineParams(certificate: ProgressCertificate, line: CertificateMaterialLine): SqlValue[] {
  return [
    line.id,
    certificate.id,
    line.materialKey,
    line.descriptionAr,
    line.unit,
    line.qty.scaled,
    line.unitRate.scaled,
    line.previousCumulativeQty.scaled,
    line.cumulativeQty.scaled,
    line.value.scaled,
    line.previousValue.scaled,
    line.sortOrder,
  ];
}

const INSERT_DEDUCTION = `
      INSERT INTO contracting_certificate_deduction (
        certificate_id, key, label_ar, percent, cumulative, previous, this_certificate, posted, capped, note_ar, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `;

function deductionParams(certificate: ProgressCertificate, deduction: CertificateDeductionRow, index: number): SqlValue[] {
  return [
    certificate.id,
    deduction.key,
    deduction.labelAr,
    deduction.percent,
    deduction.cumulative.scaled,
    deduction.previous.scaled,
    deduction.thisCertificate.scaled,
    deduction.posted ? 1 : 0,
    deduction.capped ? 1 : 0,
    deduction.noteAr,
    index,
  ];
}

interface CertificateChildren {
  readonly workLines: ReadonlyMap<string, WorkLineRow[]>;
  readonly materialLines: ReadonlyMap<string, MaterialLineRow[]>;
  readonly deductions: ReadonlyMap<string, DeductionRow[]>;
}

class SqlProgressCertificateStore implements ProgressCertificateStore {
  constructor(private readonly db: SqlDb) {}

  private async children(certificateIds: readonly string[]): Promise<CertificateChildren> {
    const [workLines, materialLines, deductions] = [
      await childRowsByParentAsync<WorkLineRow>(this.db, {
        table: "contracting_certificate_work_line",
        parentColumn: "certificate_id",
        parentIds: certificateIds,
        orderBy: "certificate_id, sort_order, id",
      }),
      await childRowsByParentAsync<MaterialLineRow>(this.db, {
        table: "contracting_certificate_material_line",
        parentColumn: "certificate_id",
        parentIds: certificateIds,
        orderBy: "certificate_id, sort_order, id",
      }),
      await childRowsByParentAsync<DeductionRow>(this.db, {
        table: "contracting_certificate_deduction",
        parentColumn: "certificate_id",
        parentIds: certificateIds,
        orderBy: "certificate_id, sort_order",
      }),
    ];
    return { workLines, materialLines, deductions };
  }

  private async hydrateAll(rows: readonly HeaderRow[]): Promise<ProgressCertificate[]> {
    const children = await this.children(rows.map((row) => row.id));
    return rows.map((row) => toCertificate(row, children));
  }

  async findById(id: string): Promise<ProgressCertificate | null> {
    const row = await this.db.get<HeaderRow>(`SELECT * FROM contracting_certificate WHERE id = ?`, [id]);
    return row ? (await this.hydrateAll([row]))[0]! : null;
  }

  async findByDocNo(docNo: string): Promise<ProgressCertificate | null> {
    const row = await this.db.get<HeaderRow>(`SELECT * FROM contracting_certificate WHERE doc_no = ?`, [docNo]);
    return row ? (await this.hydrateAll([row]))[0]! : null;
  }

  async list(filter?: ProgressCertificateListFilter): Promise<ProgressCertificate[]> {
    const rows = await this.db.all<HeaderRow>(`SELECT * FROM contracting_certificate ORDER BY contract_id, serial`);
    return this.hydrateAll(
      rows.filter(
        (r) =>
          (filter?.contractId === undefined || r.contract_id === filter.contractId) &&
          (filter?.projectId === undefined || r.project_id === filter.projectId) &&
          (filter?.status === undefined || r.status === filter.status),
      ),
    );
  }

  async listByContract(contractId: string): Promise<ProgressCertificate[]> {
    return this.hydrateAll(
      await this.db.all<HeaderRow>(`SELECT * FROM contracting_certificate WHERE contract_id = ? ORDER BY serial`, [contractId]),
    );
  }

  async insert(certificate: ProgressCertificate): Promise<void> {
    await this.db.transaction(async () => {
      await refuseTakenIdAsync(this.db, "contracting_certificate", certificate.id);
      await this.write(certificate);
    });
  }

  async save(certificate: ProgressCertificate): Promise<void> {
    await this.db.transaction(() => this.write(certificate));
  }

  private async write(certificate: ProgressCertificate): Promise<void> {
    await this.db.run(UPSERT_HEADER, headerParams(certificate));
    await this.db.run(`DELETE FROM contracting_certificate_work_line WHERE certificate_id = ?`, [certificate.id]);
    await this.db.run(`DELETE FROM contracting_certificate_material_line WHERE certificate_id = ?`, [certificate.id]);
    await this.db.run(`DELETE FROM contracting_certificate_deduction WHERE certificate_id = ?`, [certificate.id]);
    for (const line of certificate.workLines) await this.db.run(INSERT_WORK_LINE, workLineParams(certificate, line));
    for (const line of certificate.materialLines) await this.db.run(INSERT_MATERIAL_LINE, materialLineParams(certificate, line));
    for (const [index, deduction] of certificate.computed.deductions.entries()) {
      await this.db.run(INSERT_DEDUCTION, deductionParams(certificate, deduction, index));
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nesting-aware: approving a certificate confirms an invoice and posts a
    // journal entry, each of which opens its own transaction on this same
    // connection. A bare BEGIN here would be a transaction inside a transaction.
    return this.db.transaction(fn, TransactionMode.Immediate);
  }
}

function toCertificate(row: HeaderRow, children: CertificateChildren): ProgressCertificate {
  const workLines = (children.workLines.get(row.id) ?? []).map(toWorkLine);
  const materialLines = (children.materialLines.get(row.id) ?? []).map(toMaterialLine);
  const deductions = (children.deductions.get(row.id) ?? []).map(toDeduction);
  return {
    id: row.id,
    docNo: row.doc_no,
    contractId: row.contract_id,
    projectId: row.project_id,
    serial: Number(row.serial),
    previousCertificateId: row.previous_certificate_id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    executionDate: row.execution_date,
    isFinal: Number(row.is_final) === 1,
    status: row.status as ProgressCertificateStatus,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at,
    measuredBy: row.measured_by,
    measuredAt: row.measured_at,
    certifiedBy: row.certified_by,
    certifiedAt: row.certified_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by ?? null,
    cancelReasonAr: row.cancel_reason_ar ?? null,
    voidedAt: row.voided_at ?? null,
    voidedBy: row.voided_by ?? null,
    voidReasonAr: row.void_reason_ar ?? null,
    voidJournalEntryId: row.void_journal_entry_id ?? null,
    invoiceId: row.invoice_id,
    invoiceDocNo: row.invoice_doc_no,
    journalEntryId: row.journal_entry_id,
    postedDeductionsTotal: Money.fromScaled(row.posted_deductions_total),
    dueDate: row.due_date,
    penaltiesCumulative: Money.fromScaled(row.penalties_cumulative),
    suspendedCumulative: Money.fromScaled(row.suspended_cumulative),
    employerMaterialsCumulative: Money.fromScaled(row.employer_materials_cumulative),
    waterElectricityCumulative: Money.fromScaled(row.water_electricity_cumulative),
    notes: row.notes,
    workLines,
    materialLines,
    computed: toComputation(row, deductions),
  };
}

export async function ensureProgressCertificateSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createProgressCertificateStore(db: SqlDb): ProgressCertificateStore {
  return new SqlProgressCertificateStore(db);
}

export interface SqliteProgressCertificateStoreHandle extends ProgressCertificateStore {
  close(): void;
}

/** Open a SQLite-backed certificate store. ":memory:" for tests, a path for real. */
export function createSqliteProgressCertificateStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteProgressCertificateStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  const headerColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(contracting_certificate)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const name of [
    "cancelled_by",
    "cancel_reason_ar",
    "voided_at",
    "voided_by",
    "void_reason_ar",
    "void_journal_entry_id",
  ]) {
    if (!headerColumns.has(name)) sqlite.exec(`ALTER TABLE contracting_certificate ADD COLUMN ${name} TEXT`);
  }
  const deductionColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(contracting_certificate_deduction)`).all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!deductionColumns.has("note_ar")) {
    sqlite.exec(`ALTER TABLE contracting_certificate_deduction ADD COLUMN note_ar TEXT`);
  }
  return Object.assign(createProgressCertificateStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteProgressCertificateStoreHandle;
}
