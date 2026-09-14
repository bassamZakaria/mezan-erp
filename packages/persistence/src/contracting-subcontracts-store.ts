import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  Qty,
  type BoqUnit,
  type CertificateComputation,
  type CertificateDeductionKey,
  type CertificateDeductionRow,
  type SubCertificate,
  type SubCertificateListFilter,
  type SubCertificateStatus,
  type SubCertificateWorkLine,
  type Subcontract,
  type SubcontractAdvancePayment,
  type SubcontractKind,
  type SubcontractLine,
  type SubcontractListFilter,
  type SubcontractRetentionRelease,
  type SubcontractRetentionReleaseKind,
  type SubcontractStatus,
  type SubcontractStore,
  type VatBasis,
} from "@mezan/domain";

/**
 * SQLite-backed عقود الباطن ومستخلصاتها (design §03 "THE MIRROR", D-04).
 *
 * Six tables. The advances and the retention releases are rows rather than
 * columns because both are append-only histories the screens list and the
 * ledger is reconciled against: a single `advance_paid` number could not say
 * WHICH voucher paid it, and a single `retention_released` could not say which
 * journal entry released it.
 *
 * The certificate mirrors the client certificate's storage exactly — the
 * computed scalars on the header, the block's rows in their own table — so a
 * list never recomputes history and a printed certificate can never disagree
 * with the one that was signed.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS subcontract (
  id                            TEXT PRIMARY KEY,
  doc_no                        TEXT NOT NULL UNIQUE,
  contract_id                   TEXT NOT NULL,
  project_id                    TEXT NOT NULL,
  supplier_id                   TEXT NOT NULL,
  title_ar                      TEXT NOT NULL,
  kind                          TEXT NOT NULL,
  disguised_employment_reviewed INTEGER NOT NULL DEFAULT 0,
  review_note                   TEXT,
  signed_date                   TEXT NOT NULL,
  start_date                    TEXT NOT NULL,
  planned_end_date              TEXT NOT NULL,
  currency                      TEXT NOT NULL,
  status                        TEXT NOT NULL,
  activated_at                  TEXT,
  completed_at                  TEXT,
  terminated_at                 TEXT,
  notes                         TEXT,
  created_by                    TEXT,
  retention_percent             TEXT NOT NULL,
  retention_cap_percent         TEXT,
  advance_percent               TEXT NOT NULL,
  advance_recovery_percent      TEXT NOT NULL,
  withholding_tax_percent       TEXT NOT NULL,
  deemed_wage_percent           TEXT NOT NULL,
  social_insurance_rate_percent TEXT NOT NULL,
  withhold_social_insurance     INTEGER NOT NULL DEFAULT 0,
  social_insurance_note         TEXT,
  penalty_cap_percent           TEXT NOT NULL,
  payment_term_days             INTEGER NOT NULL,
  defects_liability_months      INTEGER NOT NULL,
  vat_basis                     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subcontract_contract ON subcontract (contract_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_project ON subcontract (project_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_supplier ON subcontract (supplier_id);

CREATE TABLE IF NOT EXISTS subcontract_line (
  id                  TEXT PRIMARY KEY,
  subcontract_id      TEXT NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
  client_boq_line_id  TEXT NOT NULL,
  code                TEXT NOT NULL,
  description_ar      TEXT NOT NULL,
  unit                TEXT NOT NULL,
  qty                 INTEGER NOT NULL,
  unit_rate           INTEGER NOT NULL,
  client_unit_rate    INTEGER NOT NULL,
  margin_vs_client    INTEGER NOT NULL,
  estimated_unit_cost INTEGER,
  sort_order          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subcontract_line ON subcontract_line (subcontract_id, sort_order);

CREATE TABLE IF NOT EXISTS subcontract_advance (
  subcontract_id TEXT NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
  voucher_id     TEXT NOT NULL,
  voucher_no     TEXT,
  date           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL,
  PRIMARY KEY (subcontract_id, voucher_id)
);

CREATE TABLE IF NOT EXISTS subcontract_retention_release (
  id               TEXT PRIMARY KEY,
  subcontract_id   TEXT NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  journal_entry_id TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'final',
  release_event_date TEXT,
  early_release    INTEGER NOT NULL DEFAULT 0,
  invoice_id       TEXT,
  invoice_doc_no   TEXT,
  released_by      TEXT,
  notes            TEXT,
  sort_order       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subcontract_retention_release ON subcontract_retention_release (subcontract_id, sort_order);

CREATE TABLE IF NOT EXISTS subcontract_certificate (
  id                             TEXT PRIMARY KEY,
  doc_no                         TEXT NOT NULL UNIQUE,
  subcontract_id                 TEXT NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
  contract_id                    TEXT NOT NULL,
  project_id                     TEXT NOT NULL,
  supplier_id                    TEXT NOT NULL,
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
  cancelled_by                   TEXT,
  cancelled_at                   TEXT,
  cancel_reason_ar               TEXT,
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
CREATE INDEX IF NOT EXISTS idx_sub_certificate_subcontract ON subcontract_certificate (subcontract_id, serial);
CREATE INDEX IF NOT EXISTS idx_sub_certificate_project ON subcontract_certificate (project_id);
CREATE INDEX IF NOT EXISTS idx_sub_certificate_status ON subcontract_certificate (status);

CREATE TABLE IF NOT EXISTS subcontract_certificate_work_line (
  id                        TEXT PRIMARY KEY,
  certificate_id            TEXT NOT NULL REFERENCES subcontract_certificate(id) ON DELETE CASCADE,
  subcontract_line_id       TEXT NOT NULL,
  client_boq_line_id        TEXT NOT NULL,
  client_certified_qty      INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_sub_certificate_work_line ON subcontract_certificate_work_line (certificate_id, sort_order);

CREATE TABLE IF NOT EXISTS subcontract_certificate_deduction (
  certificate_id   TEXT NOT NULL REFERENCES subcontract_certificate(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  label_ar         TEXT NOT NULL,
  percent          TEXT,
  cumulative       INTEGER NOT NULL,
  previous         INTEGER NOT NULL,
  this_certificate INTEGER NOT NULL,
  posted           INTEGER NOT NULL,
  capped           INTEGER NOT NULL,
  sort_order       INTEGER NOT NULL,
  PRIMARY KEY (certificate_id, key)
);
`;

interface SubcontractRow {
  id: string;
  doc_no: string;
  contract_id: string;
  project_id: string;
  supplier_id: string;
  title_ar: string;
  kind: string;
  disguised_employment_reviewed: number;
  review_note: string | null;
  signed_date: string;
  start_date: string;
  planned_end_date: string;
  currency: string;
  status: string;
  activated_at: string | null;
  completed_at: string | null;
  terminated_at: string | null;
  notes: string | null;
  created_by: string | null;
  retention_percent: string;
  retention_cap_percent: string | null;
  advance_percent: string;
  advance_recovery_percent: string;
  withholding_tax_percent: string;
  deemed_wage_percent: string;
  social_insurance_rate_percent: string;
  withhold_social_insurance: number;
  social_insurance_note: string | null;
  penalty_cap_percent: string;
  payment_term_days: number;
  defects_liability_months: number;
  vat_basis: string;
}

interface LineRow {
  id: string;
  subcontract_id: string;
  client_boq_line_id: string;
  code: string;
  description_ar: string;
  unit: string;
  qty: number;
  unit_rate: number;
  client_unit_rate: number;
  margin_vs_client: number;
  estimated_unit_cost: number | null;
  sort_order: number;
}

interface AdvanceRow {
  subcontract_id: string;
  voucher_id: string;
  voucher_no: string | null;
  date: string;
  amount: number;
  sort_order: number;
}

interface ReleaseRow {
  id: string;
  subcontract_id: string;
  date: string;
  amount: number;
  journal_entry_id: string;
  kind: string;
  release_event_date: string | null;
  early_release: number;
  invoice_id: string | null;
  invoice_doc_no: string | null;
  released_by: string | null;
  notes: string | null;
  sort_order: number;
}

interface CertificateRow {
  id: string;
  doc_no: string;
  subcontract_id: string;
  contract_id: string;
  project_id: string;
  supplier_id: string;
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
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason_ar: string | null;
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
  subcontract_line_id: string;
  client_boq_line_id: string;
  client_certified_qty: number;
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
  sort_order: number;
}

function toLine(row: LineRow): SubcontractLine {
  return {
    id: row.id,
    subcontractId: row.subcontract_id,
    clientBoqLineId: row.client_boq_line_id,
    code: row.code,
    descriptionAr: row.description_ar,
    unit: row.unit as BoqUnit,
    qty: Qty.fromScaled(row.qty),
    unitRate: Money.fromScaled(row.unit_rate),
    clientUnitRate: Money.fromScaled(row.client_unit_rate),
    marginVsClient: Money.fromScaled(row.margin_vs_client),
    estimatedUnitCost: row.estimated_unit_cost === null ? null : Money.fromScaled(row.estimated_unit_cost),
    sortOrder: row.sort_order,
  };
}

function toAdvance(row: AdvanceRow): SubcontractAdvancePayment {
  return {
    voucherId: row.voucher_id,
    voucherNo: row.voucher_no,
    date: row.date,
    amount: Money.fromScaled(row.amount),
  };
}

function toRelease(row: ReleaseRow): SubcontractRetentionRelease {
  return {
    id: row.id,
    date: row.date,
    amount: Money.fromScaled(row.amount),
    journalEntryId: row.journal_entry_id,
    kind: row.kind as SubcontractRetentionReleaseKind,
    releaseEventDate: row.release_event_date,
    earlyRelease: row.early_release === 1,
    invoiceId: row.invoice_id,
    invoiceDocNo: row.invoice_doc_no,
    releasedBy: row.released_by,
    notes: row.notes,
  };
}

function toWorkLine(row: WorkLineRow): SubCertificateWorkLine {
  return {
    id: row.id,
    boqLineId: row.subcontract_line_id,
    clientBoqLineId: row.client_boq_line_id,
    clientCertifiedCumulativeQty: Qty.fromScaled(row.client_certified_qty),
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
  };
}

function toComputation(row: CertificateRow, deductions: readonly CertificateDeductionRow[]): CertificateComputation {
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

class SqliteSubcontractStore implements SubcontractStore {
  private readonly upsertSubcontract: Database.Statement;
  private readonly upsertCertificate: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly insertAdvance: Database.Statement;
  private readonly insertRelease: Database.Statement;
  private readonly insertWorkLine: Database.Statement;
  private readonly insertDeduction: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsertSubcontract = sqlite.prepare(`
      INSERT INTO subcontract (
        id, doc_no, contract_id, project_id, supplier_id, title_ar, kind,
        disguised_employment_reviewed, review_note, signed_date, start_date, planned_end_date,
        currency, status, activated_at, completed_at, terminated_at, notes, created_by,
        retention_percent, retention_cap_percent, advance_percent, advance_recovery_percent,
        withholding_tax_percent, deemed_wage_percent, social_insurance_rate_percent,
        withhold_social_insurance, social_insurance_note, penalty_cap_percent,
        payment_term_days, defects_liability_months, vat_basis
      ) VALUES (
        @id, @doc_no, @contract_id, @project_id, @supplier_id, @title_ar, @kind,
        @disguised_employment_reviewed, @review_note, @signed_date, @start_date, @planned_end_date,
        @currency, @status, @activated_at, @completed_at, @terminated_at, @notes, @created_by,
        @retention_percent, @retention_cap_percent, @advance_percent, @advance_recovery_percent,
        @withholding_tax_percent, @deemed_wage_percent, @social_insurance_rate_percent,
        @withhold_social_insurance, @social_insurance_note, @penalty_cap_percent,
        @payment_term_days, @defects_liability_months, @vat_basis
      )
      ON CONFLICT(id) DO UPDATE SET
        doc_no = excluded.doc_no,
        contract_id = excluded.contract_id,
        project_id = excluded.project_id,
        supplier_id = excluded.supplier_id,
        title_ar = excluded.title_ar,
        kind = excluded.kind,
        disguised_employment_reviewed = excluded.disguised_employment_reviewed,
        review_note = excluded.review_note,
        signed_date = excluded.signed_date,
        start_date = excluded.start_date,
        planned_end_date = excluded.planned_end_date,
        currency = excluded.currency,
        status = excluded.status,
        activated_at = excluded.activated_at,
        completed_at = excluded.completed_at,
        terminated_at = excluded.terminated_at,
        notes = excluded.notes,
        created_by = excluded.created_by,
        retention_percent = excluded.retention_percent,
        retention_cap_percent = excluded.retention_cap_percent,
        advance_percent = excluded.advance_percent,
        advance_recovery_percent = excluded.advance_recovery_percent,
        withholding_tax_percent = excluded.withholding_tax_percent,
        deemed_wage_percent = excluded.deemed_wage_percent,
        social_insurance_rate_percent = excluded.social_insurance_rate_percent,
        withhold_social_insurance = excluded.withhold_social_insurance,
        social_insurance_note = excluded.social_insurance_note,
        penalty_cap_percent = excluded.penalty_cap_percent,
        payment_term_days = excluded.payment_term_days,
        defects_liability_months = excluded.defects_liability_months,
        vat_basis = excluded.vat_basis
    `);
    this.insertLine = sqlite.prepare(`
      INSERT INTO subcontract_line (
        id, subcontract_id, client_boq_line_id, code, description_ar, unit, qty, unit_rate,
        client_unit_rate, margin_vs_client, estimated_unit_cost, sort_order
      ) VALUES (
        @id, @subcontract_id, @client_boq_line_id, @code, @description_ar, @unit, @qty, @unit_rate,
        @client_unit_rate, @margin_vs_client, @estimated_unit_cost, @sort_order
      )
    `);
    this.insertAdvance = sqlite.prepare(`
      INSERT INTO subcontract_advance (subcontract_id, voucher_id, voucher_no, date, amount, sort_order)
      VALUES (@subcontract_id, @voucher_id, @voucher_no, @date, @amount, @sort_order)
    `);
    this.insertRelease = sqlite.prepare(`
      INSERT INTO subcontract_retention_release (
        id, subcontract_id, date, amount, journal_entry_id, kind, release_event_date,
        early_release, invoice_id, invoice_doc_no, released_by, notes, sort_order
      ) VALUES (
        @id, @subcontract_id, @date, @amount, @journal_entry_id, @kind, @release_event_date,
        @early_release, @invoice_id, @invoice_doc_no, @released_by, @notes, @sort_order
      )
    `);
    this.upsertCertificate = sqlite.prepare(`
      INSERT INTO subcontract_certificate (
        id, doc_no, subcontract_id, contract_id, project_id, supplier_id, serial,
        previous_certificate_id, period_from, period_to, execution_date, is_final, status,
        prepared_by, prepared_at, measured_by, measured_at, certified_by, certified_at,
        approved_by, approved_at, cancelled_by, cancelled_at, cancel_reason_ar, invoice_id, invoice_doc_no, journal_entry_id,
        posted_deductions_total, due_date, penalties_cumulative, suspended_cumulative,
        employer_materials_cumulative, water_electricity_cumulative, notes,
        gross_works, materials_on_site, certificate_total, tender_discount_percent, tender_discount,
        net_certified, previous_net_certified, this_certificate_net_certified, deductions_this_certificate,
        deductions_cumulative, suspended_balance, invoice_base, vat_basis, vat_statutory_rate_percent,
        vat_effective_rate_percent, vat, previous_payments, net_payable_this_certificate,
        cumulative_net_payable, contract_value_after_variations, completion_percent,
        retention_held_cumulative, advance_received, advance_outstanding
      ) VALUES (
        @id, @doc_no, @subcontract_id, @contract_id, @project_id, @supplier_id, @serial,
        @previous_certificate_id, @period_from, @period_to, @execution_date, @is_final, @status,
        @prepared_by, @prepared_at, @measured_by, @measured_at, @certified_by, @certified_at,
        @approved_by, @approved_at, @cancelled_by, @cancelled_at, @cancel_reason_ar, @invoice_id, @invoice_doc_no, @journal_entry_id,
        @posted_deductions_total, @due_date, @penalties_cumulative, @suspended_cumulative,
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
        subcontract_id = excluded.subcontract_id,
        contract_id = excluded.contract_id,
        project_id = excluded.project_id,
        supplier_id = excluded.supplier_id,
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
        cancelled_by = excluded.cancelled_by,
        cancelled_at = excluded.cancelled_at,
        cancel_reason_ar = excluded.cancel_reason_ar,
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
    this.insertWorkLine = sqlite.prepare(`
      INSERT INTO subcontract_certificate_work_line (
        id, certificate_id, subcontract_line_id, client_boq_line_id, client_certified_qty, code,
        description_ar, unit, unit_rate, this_period_qty, previous_cumulative_qty, cumulative_qty,
        contracted_qty, completion_percent, previous_cumulative_value, cumulative_value,
        this_period_value, sort_order
      ) VALUES (
        @id, @certificate_id, @subcontract_line_id, @client_boq_line_id, @client_certified_qty, @code,
        @description_ar, @unit, @unit_rate, @this_period_qty, @previous_cumulative_qty, @cumulative_qty,
        @contracted_qty, @completion_percent, @previous_cumulative_value, @cumulative_value,
        @this_period_value, @sort_order
      )
    `);
    this.insertDeduction = sqlite.prepare(`
      INSERT INTO subcontract_certificate_deduction (
        certificate_id, key, label_ar, percent, cumulative, previous, this_certificate, posted, capped, sort_order
      ) VALUES (
        @certificate_id, @key, @label_ar, @percent, @cumulative, @previous, @this_certificate, @posted, @capped, @sort_order
      )
    `);
  }

  private hydrate(row: SubcontractRow): Subcontract {
    const lines = (
      this.sqlite
        .prepare(`SELECT * FROM subcontract_line WHERE subcontract_id = ? ORDER BY sort_order, id`)
        .all(row.id) as LineRow[]
    ).map(toLine);
    const advances = (
      this.sqlite
        .prepare(`SELECT * FROM subcontract_advance WHERE subcontract_id = ? ORDER BY sort_order`)
        .all(row.id) as AdvanceRow[]
    ).map(toAdvance);
    const releases = (
      this.sqlite
        .prepare(`SELECT * FROM subcontract_retention_release WHERE subcontract_id = ? ORDER BY sort_order`)
        .all(row.id) as ReleaseRow[]
    ).map(toRelease);
    return {
      id: row.id,
      docNo: row.doc_no,
      contractId: row.contract_id,
      projectId: row.project_id,
      supplierId: row.supplier_id,
      titleAr: row.title_ar,
      kind: row.kind as SubcontractKind,
      disguisedEmploymentReviewed: row.disguised_employment_reviewed === 1,
      reviewNote: row.review_note,
      signedDate: row.signed_date,
      startDate: row.start_date,
      plannedEndDate: row.planned_end_date,
      currency: row.currency,
      status: row.status as SubcontractStatus,
      activatedAt: row.activated_at,
      completedAt: row.completed_at,
      terminatedAt: row.terminated_at,
      notes: row.notes,
      createdBy: row.created_by,
      retentionPercent: row.retention_percent,
      retentionCapPercent: row.retention_cap_percent,
      advancePercent: row.advance_percent,
      advanceRecoveryPercent: row.advance_recovery_percent,
      withholdingTaxPercent: row.withholding_tax_percent,
      deemedWagePercent: row.deemed_wage_percent,
      socialInsuranceRatePercent: row.social_insurance_rate_percent,
      withholdSocialInsurance: row.withhold_social_insurance === 1,
      socialInsuranceNote: row.social_insurance_note,
      penaltyCapPercent: row.penalty_cap_percent,
      paymentTermDays: row.payment_term_days,
      defectsLiabilityMonths: row.defects_liability_months,
      vatBasis: row.vat_basis as VatBasis,
      advances,
      retentionReleases: releases,
      lines,
    };
  }

  private hydrateCertificate(row: CertificateRow): SubCertificate {
    const workLines = (
      this.sqlite
        .prepare(`SELECT * FROM subcontract_certificate_work_line WHERE certificate_id = ? ORDER BY sort_order, id`)
        .all(row.id) as WorkLineRow[]
    ).map(toWorkLine);
    const deductions = (
      this.sqlite
        .prepare(`SELECT * FROM subcontract_certificate_deduction WHERE certificate_id = ? ORDER BY sort_order`)
        .all(row.id) as DeductionRow[]
    ).map(toDeduction);
    return {
      id: row.id,
      docNo: row.doc_no,
      subcontractId: row.subcontract_id,
      contractId: row.contract_id,
      projectId: row.project_id,
      supplierId: row.supplier_id,
      serial: row.serial,
      previousCertificateId: row.previous_certificate_id,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      executionDate: row.execution_date,
      isFinal: row.is_final === 1,
      status: row.status as SubCertificateStatus,
      preparedBy: row.prepared_by,
      preparedAt: row.prepared_at,
      measuredBy: row.measured_by,
      measuredAt: row.measured_at,
      certifiedBy: row.certified_by,
      certifiedAt: row.certified_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      cancelledBy: row.cancelled_by,
      cancelledAt: row.cancelled_at,
      cancelReasonAr: row.cancel_reason_ar,
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
      computed: toComputation(row, deductions),
    };
  }

  async findById(id: string): Promise<Subcontract | null> {
    const row = this.sqlite.prepare(`SELECT * FROM subcontract WHERE id = ?`).get(id) as SubcontractRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async findByDocNo(docNo: string): Promise<Subcontract | null> {
    const row = this.sqlite.prepare(`SELECT * FROM subcontract WHERE doc_no = ?`).get(docNo) as
      | SubcontractRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter?: SubcontractListFilter): Promise<Subcontract[]> {
    const rows = this.sqlite.prepare(`SELECT * FROM subcontract ORDER BY doc_no`).all() as SubcontractRow[];
    return rows
      .filter(
        (r) =>
          (filter?.contractId === undefined || r.contract_id === filter.contractId) &&
          (filter?.projectId === undefined || r.project_id === filter.projectId) &&
          (filter?.supplierId === undefined || r.supplier_id === filter.supplierId) &&
          (filter?.status === undefined || r.status === filter.status),
      )
      .map((r) => this.hydrate(r));
  }

  async save(subcontract: Subcontract): Promise<void> {
    const write = this.sqlite.transaction(() => {
      this.upsertSubcontract.run({
        id: subcontract.id,
        doc_no: subcontract.docNo,
        contract_id: subcontract.contractId,
        project_id: subcontract.projectId,
        supplier_id: subcontract.supplierId,
        title_ar: subcontract.titleAr,
        kind: subcontract.kind,
        disguised_employment_reviewed: subcontract.disguisedEmploymentReviewed ? 1 : 0,
        review_note: subcontract.reviewNote,
        signed_date: subcontract.signedDate,
        start_date: subcontract.startDate,
        planned_end_date: subcontract.plannedEndDate,
        currency: subcontract.currency,
        status: subcontract.status,
        activated_at: subcontract.activatedAt,
        completed_at: subcontract.completedAt,
        terminated_at: subcontract.terminatedAt,
        notes: subcontract.notes,
        created_by: subcontract.createdBy,
        retention_percent: subcontract.retentionPercent,
        retention_cap_percent: subcontract.retentionCapPercent,
        advance_percent: subcontract.advancePercent,
        advance_recovery_percent: subcontract.advanceRecoveryPercent,
        withholding_tax_percent: subcontract.withholdingTaxPercent,
        deemed_wage_percent: subcontract.deemedWagePercent,
        social_insurance_rate_percent: subcontract.socialInsuranceRatePercent,
        withhold_social_insurance: subcontract.withholdSocialInsurance ? 1 : 0,
        social_insurance_note: subcontract.socialInsuranceNote,
        penalty_cap_percent: subcontract.penaltyCapPercent,
        payment_term_days: subcontract.paymentTermDays,
        defects_liability_months: subcontract.defectsLiabilityMonths,
        vat_basis: subcontract.vatBasis,
      });
      this.sqlite.prepare(`DELETE FROM subcontract_line WHERE subcontract_id = ?`).run(subcontract.id);
      this.sqlite.prepare(`DELETE FROM subcontract_advance WHERE subcontract_id = ?`).run(subcontract.id);
      this.sqlite.prepare(`DELETE FROM subcontract_retention_release WHERE subcontract_id = ?`).run(subcontract.id);
      subcontract.lines.forEach((line, index) => {
        this.insertLine.run({
          id: line.id,
          subcontract_id: subcontract.id,
          client_boq_line_id: line.clientBoqLineId,
          code: line.code,
          description_ar: line.descriptionAr,
          unit: line.unit,
          qty: line.qty.toScaledNumber(),
          unit_rate: line.unitRate.toScaledNumber(),
          client_unit_rate: line.clientUnitRate.toScaledNumber(),
          margin_vs_client: line.marginVsClient.toScaledNumber(),
          estimated_unit_cost: line.estimatedUnitCost?.toScaledNumber() ?? null,
          sort_order: line.sortOrder || index + 1,
        });
      });
      subcontract.advances.forEach((advance, index) => {
        this.insertAdvance.run({
          subcontract_id: subcontract.id,
          voucher_id: advance.voucherId,
          voucher_no: advance.voucherNo,
          date: advance.date,
          amount: advance.amount.toScaledNumber(),
          sort_order: index + 1,
        });
      });
      subcontract.retentionReleases.forEach((release, index) => {
        this.insertRelease.run({
          id: release.id,
          subcontract_id: subcontract.id,
          date: release.date,
          amount: release.amount.toScaledNumber(),
          journal_entry_id: release.journalEntryId,
          kind: release.kind,
          release_event_date: release.releaseEventDate,
          early_release: release.earlyRelease ? 1 : 0,
          invoice_id: release.invoiceId,
          invoice_doc_no: release.invoiceDocNo,
          released_by: release.releasedBy,
          notes: release.notes,
          sort_order: index + 1,
        });
      });
    });
    write();
  }

  async findCertificateById(id: string): Promise<SubCertificate | null> {
    const row = this.sqlite.prepare(`SELECT * FROM subcontract_certificate WHERE id = ?`).get(id) as
      | CertificateRow
      | undefined;
    return row ? this.hydrateCertificate(row) : null;
  }

  async findCertificateByDocNo(docNo: string): Promise<SubCertificate | null> {
    const row = this.sqlite.prepare(`SELECT * FROM subcontract_certificate WHERE doc_no = ?`).get(docNo) as
      | CertificateRow
      | undefined;
    return row ? this.hydrateCertificate(row) : null;
  }

  async listCertificates(filter?: SubCertificateListFilter): Promise<SubCertificate[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM subcontract_certificate ORDER BY subcontract_id, serial`)
      .all() as CertificateRow[];
    return rows
      .filter(
        (r) =>
          (filter?.subcontractId === undefined || r.subcontract_id === filter.subcontractId) &&
          (filter?.contractId === undefined || r.contract_id === filter.contractId) &&
          (filter?.projectId === undefined || r.project_id === filter.projectId) &&
          (filter?.supplierId === undefined || r.supplier_id === filter.supplierId) &&
          (filter?.status === undefined || r.status === filter.status),
      )
      .map((r) => this.hydrateCertificate(r));
  }

  async listCertificatesBySubcontract(subcontractId: string): Promise<SubCertificate[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM subcontract_certificate WHERE subcontract_id = ? ORDER BY serial`)
      .all(subcontractId) as CertificateRow[];
    return rows.map((r) => this.hydrateCertificate(r));
  }

  async saveCertificate(certificate: SubCertificate): Promise<void> {
    const write = this.sqlite.transaction(() => {
      const c = certificate.computed;
      this.upsertCertificate.run({
        id: certificate.id,
        doc_no: certificate.docNo,
        subcontract_id: certificate.subcontractId,
        contract_id: certificate.contractId,
        project_id: certificate.projectId,
        supplier_id: certificate.supplierId,
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
        cancelled_by: certificate.cancelledBy,
        cancelled_at: certificate.cancelledAt,
        cancel_reason_ar: certificate.cancelReasonAr,
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
      this.sqlite
        .prepare(`DELETE FROM subcontract_certificate_work_line WHERE certificate_id = ?`)
        .run(certificate.id);
      this.sqlite
        .prepare(`DELETE FROM subcontract_certificate_deduction WHERE certificate_id = ?`)
        .run(certificate.id);
      for (const line of certificate.workLines) {
        this.insertWorkLine.run({
          id: line.id,
          certificate_id: certificate.id,
          subcontract_line_id: line.boqLineId,
          client_boq_line_id: line.clientBoqLineId,
          client_certified_qty: line.clientCertifiedCumulativeQty.toScaledNumber(),
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
          sort_order: index,
        });
      });
    });
    write();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nesting-aware: approving a sub certificate confirms a purchase invoice and
    // posts a journal entry, each of which opens its own transaction on this
    // same connection.
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }
}

export interface SqliteSubcontractStoreHandle extends SubcontractStore {
  close(): void;
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!existing.has(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** Open a SQLite-backed subcontract store. ":memory:" for tests, a path for real. */
export function createSqliteSubcontractStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteSubcontractStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  addColumnIfMissing(sqlite, "subcontract_retention_release", "kind", "kind TEXT NOT NULL DEFAULT 'final'");
  addColumnIfMissing(sqlite, "subcontract_retention_release", "release_event_date", "release_event_date TEXT");
  addColumnIfMissing(sqlite, "subcontract_retention_release", "early_release", "early_release INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "subcontract_retention_release", "invoice_id", "invoice_id TEXT");
  addColumnIfMissing(sqlite, "subcontract_retention_release", "invoice_doc_no", "invoice_doc_no TEXT");
  addColumnIfMissing(sqlite, "subcontract_certificate", "cancelled_by", "cancelled_by TEXT");
  addColumnIfMissing(sqlite, "subcontract_certificate", "cancel_reason_ar", "cancel_reason_ar TEXT");
  const store = new SqliteSubcontractStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteSubcontractStoreHandle;
}
