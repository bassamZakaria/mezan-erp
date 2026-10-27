import type Database from "better-sqlite3";
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
  disguised_employment_reviewed: bigint;
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
  withhold_social_insurance: bigint;
  social_insurance_note: string | null;
  penalty_cap_percent: string;
  payment_term_days: bigint;
  defects_liability_months: bigint;
  vat_basis: string;
}

interface LineRow {
  id: string;
  subcontract_id: string;
  client_boq_line_id: string;
  code: string;
  description_ar: string;
  unit: string;
  qty: bigint;
  unit_rate: bigint;
  client_unit_rate: bigint;
  margin_vs_client: bigint;
  estimated_unit_cost: bigint | null;
  sort_order: bigint;
}

interface AdvanceRow {
  subcontract_id: string;
  voucher_id: string;
  voucher_no: string | null;
  date: string;
  amount: bigint;
  sort_order: bigint;
}

interface ReleaseRow {
  id: string;
  subcontract_id: string;
  date: string;
  amount: bigint;
  journal_entry_id: string;
  kind: string;
  release_event_date: string | null;
  early_release: bigint;
  invoice_id: string | null;
  invoice_doc_no: string | null;
  released_by: string | null;
  notes: string | null;
  sort_order: bigint;
}

interface CertificateRow {
  id: string;
  doc_no: string;
  subcontract_id: string;
  contract_id: string;
  project_id: string;
  supplier_id: string;
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
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason_ar: string | null;
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
  subcontract_line_id: string;
  client_boq_line_id: string;
  client_certified_qty: bigint;
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
  sort_order: bigint;
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
    sortOrder: Number(row.sort_order),
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
    earlyRelease: Number(row.early_release) === 1,
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
    noteAr: null,
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

const UPSERT_SUBCONTRACT = `
      INSERT INTO subcontract (
        id, doc_no, contract_id, project_id, supplier_id, title_ar, kind,
        disguised_employment_reviewed, review_note, signed_date, start_date, planned_end_date,
        currency, status, activated_at, completed_at, terminated_at, notes, created_by,
        retention_percent, retention_cap_percent, advance_percent, advance_recovery_percent,
        withholding_tax_percent, deemed_wage_percent, social_insurance_rate_percent,
        withhold_social_insurance, social_insurance_note, penalty_cap_percent,
        payment_term_days, defects_liability_months, vat_basis
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
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
    `;

function subcontractParams(subcontract: Subcontract): SqlValue[] {
  return [
    subcontract.id,
    subcontract.docNo,
    subcontract.contractId,
    subcontract.projectId,
    subcontract.supplierId,
    subcontract.titleAr,
    subcontract.kind,
    subcontract.disguisedEmploymentReviewed ? 1 : 0,
    subcontract.reviewNote,
    subcontract.signedDate,
    subcontract.startDate,
    subcontract.plannedEndDate,
    subcontract.currency,
    subcontract.status,
    subcontract.activatedAt,
    subcontract.completedAt,
    subcontract.terminatedAt,
    subcontract.notes,
    subcontract.createdBy,
    subcontract.retentionPercent,
    subcontract.retentionCapPercent,
    subcontract.advancePercent,
    subcontract.advanceRecoveryPercent,
    subcontract.withholdingTaxPercent,
    subcontract.deemedWagePercent,
    subcontract.socialInsuranceRatePercent,
    subcontract.withholdSocialInsurance ? 1 : 0,
    subcontract.socialInsuranceNote,
    subcontract.penaltyCapPercent,
    subcontract.paymentTermDays,
    subcontract.defectsLiabilityMonths,
    subcontract.vatBasis,
  ];
}

const INSERT_LINE = `
      INSERT INTO subcontract_line (
        id, subcontract_id, client_boq_line_id, code, description_ar, unit, qty, unit_rate,
        client_unit_rate, margin_vs_client, estimated_unit_cost, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `;

function lineParams(subcontract: Subcontract, line: SubcontractLine, index: number): SqlValue[] {
  return [
    line.id,
    subcontract.id,
    line.clientBoqLineId,
    line.code,
    line.descriptionAr,
    line.unit,
    line.qty.scaled,
    line.unitRate.scaled,
    line.clientUnitRate.scaled,
    line.marginVsClient.scaled,
    line.estimatedUnitCost?.scaled ?? null,
    line.sortOrder || index + 1,
  ];
}

const INSERT_ADVANCE = `
      INSERT INTO subcontract_advance (subcontract_id, voucher_id, voucher_no, date, amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

function advanceParams(subcontract: Subcontract, advance: SubcontractAdvancePayment, index: number): SqlValue[] {
  return [
    subcontract.id,
    advance.voucherId,
    advance.voucherNo,
    advance.date,
    advance.amount.scaled,
    index + 1,
  ];
}

const INSERT_RELEASE = `
      INSERT INTO subcontract_retention_release (
        id, subcontract_id, date, amount, journal_entry_id, kind, release_event_date,
        early_release, invoice_id, invoice_doc_no, released_by, notes, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `;

function releaseParams(subcontract: Subcontract, release: SubcontractRetentionRelease, index: number): SqlValue[] {
  return [
    release.id,
    subcontract.id,
    release.date,
    release.amount.scaled,
    release.journalEntryId,
    release.kind,
    release.releaseEventDate,
    release.earlyRelease ? 1 : 0,
    release.invoiceId,
    release.invoiceDocNo,
    release.releasedBy,
    release.notes,
    index + 1,
  ];
}

const UPSERT_CERTIFICATE = `
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
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
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
    `;

function certificateParams(certificate: SubCertificate): SqlValue[] {
  const c = certificate.computed;
  return [
    certificate.id,
    certificate.docNo,
    certificate.subcontractId,
    certificate.contractId,
    certificate.projectId,
    certificate.supplierId,
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
    certificate.cancelledBy,
    certificate.cancelledAt,
    certificate.cancelReasonAr,
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
      INSERT INTO subcontract_certificate_work_line (
        id, certificate_id, subcontract_line_id, client_boq_line_id, client_certified_qty, code,
        description_ar, unit, unit_rate, this_period_qty, previous_cumulative_qty, cumulative_qty,
        contracted_qty, completion_percent, previous_cumulative_value, cumulative_value,
        this_period_value, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `;

function workLineParams(certificate: SubCertificate, line: SubCertificateWorkLine): SqlValue[] {
  return [
    line.id,
    certificate.id,
    line.boqLineId,
    line.clientBoqLineId,
    line.clientCertifiedCumulativeQty.scaled,
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

const INSERT_DEDUCTION = `
      INSERT INTO subcontract_certificate_deduction (
        certificate_id, key, label_ar, percent, cumulative, previous, this_certificate, posted, capped, sort_order
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `;

function deductionParams(certificate: SubCertificate, deduction: CertificateDeductionRow, index: number): SqlValue[] {
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
    index,
  ];
}

interface SubcontractChildren {
  readonly lines: ReadonlyMap<string, LineRow[]>;
  readonly advances: ReadonlyMap<string, AdvanceRow[]>;
  readonly releases: ReadonlyMap<string, ReleaseRow[]>;
}

interface SubCertificateChildren {
  readonly workLines: ReadonlyMap<string, WorkLineRow[]>;
  readonly deductions: ReadonlyMap<string, DeductionRow[]>;
}

function toSubcontract(row: SubcontractRow, children: SubcontractChildren): Subcontract {
  const lines = (children.lines.get(row.id) ?? []).map(toLine);
  const advances = (children.advances.get(row.id) ?? []).map(toAdvance);
  const releases = (children.releases.get(row.id) ?? []).map(toRelease);
  return {
    id: row.id,
    docNo: row.doc_no,
    contractId: row.contract_id,
    projectId: row.project_id,
    supplierId: row.supplier_id,
    titleAr: row.title_ar,
    kind: row.kind as SubcontractKind,
    disguisedEmploymentReviewed: Number(row.disguised_employment_reviewed) === 1,
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
    withholdSocialInsurance: Number(row.withhold_social_insurance) === 1,
    socialInsuranceNote: row.social_insurance_note,
    penaltyCapPercent: row.penalty_cap_percent,
    paymentTermDays: Number(row.payment_term_days),
    defectsLiabilityMonths: Number(row.defects_liability_months),
    vatBasis: row.vat_basis as VatBasis,
    advances,
    retentionReleases: releases,
    lines,
  };
}

function toSubCertificate(row: CertificateRow, children: SubCertificateChildren): SubCertificate {
  const workLines = (children.workLines.get(row.id) ?? []).map(toWorkLine);
  const deductions = (children.deductions.get(row.id) ?? []).map(toDeduction);
  return {
    id: row.id,
    docNo: row.doc_no,
    subcontractId: row.subcontract_id,
    contractId: row.contract_id,
    projectId: row.project_id,
    supplierId: row.supplier_id,
    serial: Number(row.serial),
    previousCertificateId: row.previous_certificate_id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    executionDate: row.execution_date,
    isFinal: Number(row.is_final) === 1,
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

class SqlSubcontractStore implements SubcontractStore {
  constructor(private readonly db: SqlDb) {}

  private async hydrateAll(rows: readonly SubcontractRow[]): Promise<Subcontract[]> {
    const parentIds = rows.map((row) => row.id);
    const children: SubcontractChildren = {
      lines: await childRowsByParentAsync<LineRow>(this.db, {
        table: "subcontract_line",
        parentColumn: "subcontract_id",
        parentIds,
        orderBy: "subcontract_id, sort_order, id",
      }),
      advances: await childRowsByParentAsync<AdvanceRow>(this.db, {
        table: "subcontract_advance",
        parentColumn: "subcontract_id",
        parentIds,
        orderBy: "subcontract_id, sort_order",
      }),
      releases: await childRowsByParentAsync<ReleaseRow>(this.db, {
        table: "subcontract_retention_release",
        parentColumn: "subcontract_id",
        parentIds,
        orderBy: "subcontract_id, sort_order",
      }),
    };
    return rows.map((row) => toSubcontract(row, children));
  }

  private async hydrateCertificates(rows: readonly CertificateRow[]): Promise<SubCertificate[]> {
    const parentIds = rows.map((row) => row.id);
    const children: SubCertificateChildren = {
      workLines: await childRowsByParentAsync<WorkLineRow>(this.db, {
        table: "subcontract_certificate_work_line",
        parentColumn: "certificate_id",
        parentIds,
        orderBy: "certificate_id, sort_order, id",
      }),
      deductions: await childRowsByParentAsync<DeductionRow>(this.db, {
        table: "subcontract_certificate_deduction",
        parentColumn: "certificate_id",
        parentIds,
        orderBy: "certificate_id, sort_order",
      }),
    };
    return rows.map((row) => toSubCertificate(row, children));
  }

  async findById(id: string): Promise<Subcontract | null> {
    const row = await this.db.get<SubcontractRow>(`SELECT * FROM subcontract WHERE id = ?`, [id]);
    return row ? (await this.hydrateAll([row]))[0]! : null;
  }

  async findByDocNo(docNo: string): Promise<Subcontract | null> {
    const row = await this.db.get<SubcontractRow>(`SELECT * FROM subcontract WHERE doc_no = ?`, [docNo]);
    return row ? (await this.hydrateAll([row]))[0]! : null;
  }

  async list(filter?: SubcontractListFilter): Promise<Subcontract[]> {
    const rows = await this.db.all<SubcontractRow>(`SELECT * FROM subcontract ORDER BY doc_no`);
    return this.hydrateAll(
      rows.filter(
        (r) =>
          (filter?.contractId === undefined || r.contract_id === filter.contractId) &&
          (filter?.projectId === undefined || r.project_id === filter.projectId) &&
          (filter?.supplierId === undefined || r.supplier_id === filter.supplierId) &&
          (filter?.status === undefined || r.status === filter.status),
      ),
    );
  }

  async insert(subcontract: Subcontract): Promise<void> {
    await this.db.transaction(async () => {
      await refuseTakenIdAsync(this.db, "subcontract", subcontract.id);
      await this.writeSubcontract(subcontract);
    });
  }

  async save(subcontract: Subcontract): Promise<void> {
    await this.db.transaction(() => this.writeSubcontract(subcontract));
  }

  private async writeSubcontract(subcontract: Subcontract): Promise<void> {
    await this.db.run(UPSERT_SUBCONTRACT, subcontractParams(subcontract));
    await this.db.run(`DELETE FROM subcontract_line WHERE subcontract_id = ?`, [subcontract.id]);
    await this.db.run(`DELETE FROM subcontract_advance WHERE subcontract_id = ?`, [subcontract.id]);
    await this.db.run(`DELETE FROM subcontract_retention_release WHERE subcontract_id = ?`, [subcontract.id]);
    for (const [index, line] of subcontract.lines.entries()) {
      await this.db.run(INSERT_LINE, lineParams(subcontract, line, index));
    }
    for (const [index, advance] of subcontract.advances.entries()) {
      await this.db.run(INSERT_ADVANCE, advanceParams(subcontract, advance, index));
    }
    for (const [index, release] of subcontract.retentionReleases.entries()) {
      await this.db.run(INSERT_RELEASE, releaseParams(subcontract, release, index));
    }
  }

  async findCertificateById(id: string): Promise<SubCertificate | null> {
    const row = await this.db.get<CertificateRow>(`SELECT * FROM subcontract_certificate WHERE id = ?`, [id]);
    return row ? (await this.hydrateCertificates([row]))[0]! : null;
  }

  async findCertificateByDocNo(docNo: string): Promise<SubCertificate | null> {
    const row = await this.db.get<CertificateRow>(`SELECT * FROM subcontract_certificate WHERE doc_no = ?`, [docNo]);
    return row ? (await this.hydrateCertificates([row]))[0]! : null;
  }

  async listCertificates(filter?: SubCertificateListFilter): Promise<SubCertificate[]> {
    const rows = await this.db.all<CertificateRow>(`SELECT * FROM subcontract_certificate ORDER BY subcontract_id, serial`);
    return this.hydrateCertificates(
      rows.filter(
        (r) =>
          (filter?.subcontractId === undefined || r.subcontract_id === filter.subcontractId) &&
          (filter?.contractId === undefined || r.contract_id === filter.contractId) &&
          (filter?.projectId === undefined || r.project_id === filter.projectId) &&
          (filter?.supplierId === undefined || r.supplier_id === filter.supplierId) &&
          (filter?.status === undefined || r.status === filter.status),
      ),
    );
  }

  async listCertificatesBySubcontract(subcontractId: string): Promise<SubCertificate[]> {
    return this.hydrateCertificates(
      await this.db.all<CertificateRow>(`SELECT * FROM subcontract_certificate WHERE subcontract_id = ? ORDER BY serial`, [
        subcontractId,
      ]),
    );
  }

  async insertCertificate(certificate: SubCertificate): Promise<void> {
    await this.db.transaction(async () => {
      await refuseTakenIdAsync(this.db, "subcontract_certificate", certificate.id);
      await this.writeCertificate(certificate);
    });
  }

  async saveCertificate(certificate: SubCertificate): Promise<void> {
    await this.db.transaction(() => this.writeCertificate(certificate));
  }

  private async writeCertificate(certificate: SubCertificate): Promise<void> {
    await this.db.run(UPSERT_CERTIFICATE, certificateParams(certificate));
    await this.db.run(`DELETE FROM subcontract_certificate_work_line WHERE certificate_id = ?`, [certificate.id]);
    await this.db.run(`DELETE FROM subcontract_certificate_deduction WHERE certificate_id = ?`, [certificate.id]);
    for (const line of certificate.workLines) await this.db.run(INSERT_WORK_LINE, workLineParams(certificate, line));
    for (const [index, deduction] of certificate.computed.deductions.entries()) {
      await this.db.run(INSERT_DEDUCTION, deductionParams(certificate, deduction, index));
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nesting-aware: approving a sub certificate confirms a purchase invoice and
    // posts a journal entry, each of which opens its own transaction on this
    // same connection.
    return this.db.transaction(fn, TransactionMode.Immediate);
  }
}

export async function ensureSubcontractSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createSubcontractStore(db: SqlDb): SubcontractStore {
  return new SqlSubcontractStore(db);
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
  return Object.assign(createSubcontractStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteSubcontractStoreHandle;
}
