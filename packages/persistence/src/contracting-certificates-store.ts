import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refusingTakenId } from "./insert-new.js";
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
  serial: number;
  previous_certificate_id: string | null;
  period_from: string;
  period_to: string;
  execution_date: string;
  is_final: number;
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
  posted_deductions_total: number;
  due_date: string | null;
  penalties_cumulative: number;
  suspended_cumulative: number;
  employer_materials_cumulative: number;
  water_electricity_cumulative: number;
  notes: string | null;
  gross_works: number;
  materials_on_site: number;
  certificate_total: number;
  tender_discount_percent: string;
  tender_discount: number;
  net_certified: number;
  previous_net_certified: number;
  this_certificate_net_certified: number;
  deductions_this_certificate: number;
  deductions_cumulative: number;
  suspended_balance: number;
  invoice_base: number;
  vat_basis: string;
  vat_statutory_rate_percent: string;
  vat_effective_rate_percent: string;
  vat: number;
  previous_payments: number;
  net_payable_this_certificate: number;
  cumulative_net_payable: number;
  contract_value_after_variations: number;
  completion_percent: string;
  retention_held_cumulative: number;
  advance_received: number;
  advance_outstanding: number;
}

interface WorkLineRow {
  id: string;
  certificate_id: string;
  boq_line_id: string;
  code: string;
  description_ar: string;
  unit: string;
  unit_rate: number;
  this_period_qty: number;
  previous_cumulative_qty: number;
  cumulative_qty: number;
  contracted_qty: number;
  completion_percent: string;
  previous_cumulative_value: number;
  cumulative_value: number;
  this_period_value: number;
  sort_order: number;
}

interface MaterialLineRow {
  id: string;
  certificate_id: string;
  material_key: string;
  description_ar: string;
  unit: string;
  qty: number;
  unit_rate: number;
  previous_cumulative_qty: number;
  cumulative_qty: number;
  value: number;
  previous_value: number;
  sort_order: number;
}

interface DeductionRow {
  certificate_id: string;
  key: string;
  label_ar: string;
  percent: string | null;
  cumulative: number;
  previous: number;
  this_certificate: number;
  posted: number;
  capped: number;
  note_ar: string | null;
  sort_order: number;
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
    sortOrder: row.sort_order,
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
    sortOrder: row.sort_order,
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
    posted: row.posted === 1,
    capped: row.capped === 1,
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

class SqliteProgressCertificateStore implements ProgressCertificateStore {
  private readonly upsertHeader: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByDocNo: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByContract: Database.Statement;
  private readonly deleteWorkLines: Database.Statement;
  private readonly deleteMaterialLines: Database.Statement;
  private readonly deleteDeductions: Database.Statement;
  private readonly insertWorkLine: Database.Statement;
  private readonly insertMaterialLine: Database.Statement;
  private readonly insertDeduction: Database.Statement;
  private readonly selectWorkLines: Database.Statement;
  private readonly selectMaterialLines: Database.Statement;
  private readonly selectDeductions: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsertHeader = sqlite.prepare(`
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
        @id, @doc_no, @contract_id, @project_id, @serial, @previous_certificate_id, @period_from, @period_to,
        @execution_date, @is_final, @status, @prepared_by, @prepared_at, @measured_by, @measured_at,
        @certified_by, @certified_at, @approved_by, @approved_at, @cancelled_at, @cancelled_by, @cancel_reason_ar,
        @voided_at, @voided_by, @void_reason_ar, @void_journal_entry_id, @invoice_id, @invoice_doc_no,
        @journal_entry_id, @posted_deductions_total, @due_date, @penalties_cumulative, @suspended_cumulative,
        @employer_materials_cumulative, @water_electricity_cumulative, @notes,
        @gross_works, @materials_on_site, @certificate_total, @tender_discount_percent, @tender_discount,
        @net_certified, @previous_net_certified, @this_certificate_net_certified, @deductions_this_certificate,
        @deductions_cumulative, @suspended_balance, @invoice_base, @vat_basis, @vat_statutory_rate_percent,
        @vat_effective_rate_percent, @vat, @previous_payments, @net_payable_this_certificate,
        @cumulative_net_payable, @contract_value_after_variations, @completion_percent,
        @retention_held_cumulative, @advance_received, @advance_outstanding
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
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM contracting_certificate WHERE id = ?`);
    this.selectByDocNo = sqlite.prepare(`SELECT * FROM contracting_certificate WHERE doc_no = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM contracting_certificate ORDER BY contract_id, serial`);
    this.selectByContract = sqlite.prepare(
      `SELECT * FROM contracting_certificate WHERE contract_id = ? ORDER BY serial`,
    );
    this.deleteWorkLines = sqlite.prepare(`DELETE FROM contracting_certificate_work_line WHERE certificate_id = ?`);
    this.deleteMaterialLines = sqlite.prepare(
      `DELETE FROM contracting_certificate_material_line WHERE certificate_id = ?`,
    );
    this.deleteDeductions = sqlite.prepare(`DELETE FROM contracting_certificate_deduction WHERE certificate_id = ?`);
    this.insertWorkLine = sqlite.prepare(`
      INSERT INTO contracting_certificate_work_line (
        id, certificate_id, boq_line_id, code, description_ar, unit, unit_rate, this_period_qty,
        previous_cumulative_qty, cumulative_qty, contracted_qty, completion_percent,
        previous_cumulative_value, cumulative_value, this_period_value, sort_order
      ) VALUES (
        @id, @certificate_id, @boq_line_id, @code, @description_ar, @unit, @unit_rate, @this_period_qty,
        @previous_cumulative_qty, @cumulative_qty, @contracted_qty, @completion_percent,
        @previous_cumulative_value, @cumulative_value, @this_period_value, @sort_order
      )
    `);
    this.insertMaterialLine = sqlite.prepare(`
      INSERT INTO contracting_certificate_material_line (
        id, certificate_id, material_key, description_ar, unit, qty, unit_rate,
        previous_cumulative_qty, cumulative_qty, value, previous_value, sort_order
      ) VALUES (
        @id, @certificate_id, @material_key, @description_ar, @unit, @qty, @unit_rate,
        @previous_cumulative_qty, @cumulative_qty, @value, @previous_value, @sort_order
      )
    `);
    this.insertDeduction = sqlite.prepare(`
      INSERT INTO contracting_certificate_deduction (
        certificate_id, key, label_ar, percent, cumulative, previous, this_certificate, posted, capped, note_ar, sort_order
      ) VALUES (
        @certificate_id, @key, @label_ar, @percent, @cumulative, @previous, @this_certificate, @posted, @capped, @note_ar, @sort_order
      )
    `);
    this.selectWorkLines = sqlite.prepare(
      `SELECT * FROM contracting_certificate_work_line WHERE certificate_id = ? ORDER BY sort_order, id`,
    );
    this.selectMaterialLines = sqlite.prepare(
      `SELECT * FROM contracting_certificate_material_line WHERE certificate_id = ? ORDER BY sort_order, id`,
    );
    this.selectDeductions = sqlite.prepare(
      `SELECT * FROM contracting_certificate_deduction WHERE certificate_id = ? ORDER BY sort_order`,
    );
  }

  private hydrate(row: HeaderRow): ProgressCertificate {
    const workLines = (this.selectWorkLines.all(row.id) as WorkLineRow[]).map(toWorkLine);
    const materialLines = (this.selectMaterialLines.all(row.id) as MaterialLineRow[]).map(toMaterialLine);
    const deductions = (this.selectDeductions.all(row.id) as DeductionRow[]).map(toDeduction);
    return {
      id: row.id,
      docNo: row.doc_no,
      contractId: row.contract_id,
      projectId: row.project_id,
      serial: row.serial,
      previousCertificateId: row.previous_certificate_id,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      executionDate: row.execution_date,
      isFinal: row.is_final === 1,
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

  async findById(id: string): Promise<ProgressCertificate | null> {
    const row = this.selectById.get(id) as HeaderRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async findByDocNo(docNo: string): Promise<ProgressCertificate | null> {
    const row = this.selectByDocNo.get(docNo) as HeaderRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter?: ProgressCertificateListFilter): Promise<ProgressCertificate[]> {
    const rows = this.selectAll.all() as HeaderRow[];
    return rows
      .filter(
        (r) =>
          (filter?.contractId === undefined || r.contract_id === filter.contractId) &&
          (filter?.projectId === undefined || r.project_id === filter.projectId) &&
          (filter?.status === undefined || r.status === filter.status),
      )
      .map((r) => this.hydrate(r));
  }

  async listByContract(contractId: string): Promise<ProgressCertificate[]> {
    return (this.selectByContract.all(contractId) as HeaderRow[]).map((r) => this.hydrate(r));
  }

  async insert(certificate: ProgressCertificate): Promise<void> {
    refusingTakenId(this.sqlite, "contracting_certificate", certificate.id);
    return this.save(certificate);
  }

  async save(certificate: ProgressCertificate): Promise<void> {
    const write = this.sqlite.transaction(() => {
      const c = certificate.computed;
      this.upsertHeader.run({
        id: certificate.id,
        doc_no: certificate.docNo,
        contract_id: certificate.contractId,
        project_id: certificate.projectId,
        serial: certificate.serial,
        previous_certificate_id: certificate.previousCertificateId,
        period_from: certificate.periodFrom,
        period_to: certificate.periodTo,
        execution_date: certificate.executionDate,
        is_final: certificate.isFinal ? 1 : 0,
        status: certificate.status,
        prepared_by: certificate.preparedBy,
        prepared_at: certificate.preparedAt,
        measured_by: certificate.measuredBy,
        measured_at: certificate.measuredAt,
        certified_by: certificate.certifiedBy,
        certified_at: certificate.certifiedAt,
        approved_by: certificate.approvedBy,
        approved_at: certificate.approvedAt,
        cancelled_at: certificate.cancelledAt,
        cancelled_by: certificate.cancelledBy,
        cancel_reason_ar: certificate.cancelReasonAr,
        voided_at: certificate.voidedAt,
        voided_by: certificate.voidedBy,
        void_reason_ar: certificate.voidReasonAr,
        void_journal_entry_id: certificate.voidJournalEntryId,
        invoice_id: certificate.invoiceId,
        invoice_doc_no: certificate.invoiceDocNo,
        journal_entry_id: certificate.journalEntryId,
        posted_deductions_total: certificate.postedDeductionsTotal.toScaledNumber(),
        due_date: certificate.dueDate,
        penalties_cumulative: certificate.penaltiesCumulative.toScaledNumber(),
        suspended_cumulative: certificate.suspendedCumulative.toScaledNumber(),
        employer_materials_cumulative: certificate.employerMaterialsCumulative.toScaledNumber(),
        water_electricity_cumulative: certificate.waterElectricityCumulative.toScaledNumber(),
        notes: certificate.notes,
        gross_works: c.grossWorks.toScaledNumber(),
        materials_on_site: c.materialsOnSite.toScaledNumber(),
        certificate_total: c.certificateTotal.toScaledNumber(),
        tender_discount_percent: c.tenderDiscountPercent,
        tender_discount: c.tenderDiscount.toScaledNumber(),
        net_certified: c.netCertified.toScaledNumber(),
        previous_net_certified: c.previousNetCertified.toScaledNumber(),
        this_certificate_net_certified: c.thisCertificateNetCertified.toScaledNumber(),
        deductions_this_certificate: c.deductionsThisCertificate.toScaledNumber(),
        deductions_cumulative: c.deductionsCumulative.toScaledNumber(),
        suspended_balance: c.suspendedBalance.toScaledNumber(),
        invoice_base: c.invoiceBase.toScaledNumber(),
        vat_basis: c.vatBasis,
        vat_statutory_rate_percent: c.vatStatutoryRatePercent,
        vat_effective_rate_percent: c.vatEffectiveRatePercent,
        vat: c.vat.toScaledNumber(),
        previous_payments: c.previousPayments.toScaledNumber(),
        net_payable_this_certificate: c.netPayableThisCertificate.toScaledNumber(),
        cumulative_net_payable: c.cumulativeNetPayable.toScaledNumber(),
        contract_value_after_variations: c.contractValueAfterVariations.toScaledNumber(),
        completion_percent: c.completionPercent,
        retention_held_cumulative: c.retentionHeldCumulative.toScaledNumber(),
        advance_received: c.advanceReceived.toScaledNumber(),
        advance_outstanding: c.advanceOutstanding.toScaledNumber(),
      });
      this.deleteWorkLines.run(certificate.id);
      this.deleteMaterialLines.run(certificate.id);
      this.deleteDeductions.run(certificate.id);
      for (const line of certificate.workLines) {
        this.insertWorkLine.run({
          id: line.id,
          certificate_id: certificate.id,
          boq_line_id: line.boqLineId,
          code: line.code,
          description_ar: line.descriptionAr,
          unit: line.unit,
          unit_rate: line.unitRate.toScaledNumber(),
          this_period_qty: line.thisPeriodQty.toScaledNumber(),
          previous_cumulative_qty: line.previousCumulativeQty.toScaledNumber(),
          cumulative_qty: line.cumulativeQty.toScaledNumber(),
          contracted_qty: line.contractedQty.toScaledNumber(),
          completion_percent: line.completionPercent,
          previous_cumulative_value: line.previousCumulativeValue.toScaledNumber(),
          cumulative_value: line.cumulativeValue.toScaledNumber(),
          this_period_value: line.thisPeriodValue.toScaledNumber(),
          sort_order: line.sortOrder,
        });
      }
      for (const line of certificate.materialLines) {
        this.insertMaterialLine.run({
          id: line.id,
          certificate_id: certificate.id,
          material_key: line.materialKey,
          description_ar: line.descriptionAr,
          unit: line.unit,
          qty: line.qty.toScaledNumber(),
          unit_rate: line.unitRate.toScaledNumber(),
          previous_cumulative_qty: line.previousCumulativeQty.toScaledNumber(),
          cumulative_qty: line.cumulativeQty.toScaledNumber(),
          value: line.value.toScaledNumber(),
          previous_value: line.previousValue.toScaledNumber(),
          sort_order: line.sortOrder,
        });
      }
      certificate.computed.deductions.forEach((deduction, index) => {
        this.insertDeduction.run({
          certificate_id: certificate.id,
          key: deduction.key,
          label_ar: deduction.labelAr,
          percent: deduction.percent,
          cumulative: deduction.cumulative.toScaledNumber(),
          previous: deduction.previous.toScaledNumber(),
          this_certificate: deduction.thisCertificate.toScaledNumber(),
          posted: deduction.posted ? 1 : 0,
          capped: deduction.capped ? 1 : 0,
          note_ar: deduction.noteAr,
          sort_order: index,
        });
      });
    });
    write();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nesting-aware: approving a certificate confirms an invoice and posts a
    // journal entry, each of which opens its own transaction on this same
    // connection. A bare BEGIN here would be a transaction inside a transaction.
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }
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
  const store = new SqliteProgressCertificateStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteProgressCertificateStoreHandle;
}
