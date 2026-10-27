import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew, refuseTakenIdAsync } from "./insert-new.js";
import { childRowsByParentAsync } from "./list-query.js";
import { TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type BoqLine,
  type BoqLineAdjustment,
  type BoqUnit,
  type BudgetRevision,
  type CostCategory,
  type NewBoqLineSpec,
  type RecognitionPolicy,
  type VariationLineKind,
  type VariationOrder,
  type VariationOrderLine,
  type VariationOrderListFilter,
  type VariationOrderStatus,
  type VatBasis,
  type WorksContract,
  type WorksContractListFilter,
  type WorksContractStatus,
  type WorksContractStore,
  type WorksContractType,
} from "@mezan/domain";

/**
 * SQLite-backed store for العقد وجدول الكميات وأوامر التغيير (slice 1 of
 * المقاولات). Money and quantities are stored as scaled INTEGERs at 1e-6, the
 * same contract the ledger keeps (docs/archive/plan.md §2.3) — nothing here is
 * ever a float.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS works_contract (
  id                             TEXT PRIMARY KEY,
  doc_no                         TEXT NOT NULL UNIQUE,
  project_id                     TEXT NOT NULL,
  customer_id                    TEXT NOT NULL,
  title_ar                       TEXT NOT NULL,
  title_en                       TEXT,
  contract_type                  TEXT NOT NULL,
  signed_date                    TEXT NOT NULL,
  start_date                     TEXT NOT NULL,
  planned_end_date               TEXT NOT NULL,
  currency                       TEXT NOT NULL,
  status                         TEXT NOT NULL,
  activated_at                   TEXT,
  completed_at                   TEXT,
  terminated_at                  TEXT,
  notes                          TEXT,
  estimated_total_cost           INTEGER,
  budget_revisions               TEXT NOT NULL,
  tender_discount_percent        TEXT NOT NULL,
  retention_percent              TEXT NOT NULL,
  retention_cap_percent          TEXT,
  advance_percent                TEXT NOT NULL,
  advance_recovery_percent       TEXT NOT NULL,
  materials_on_site_percent      TEXT NOT NULL,
  deemed_wage_percent            TEXT NOT NULL,
  social_insurance_rate_percent  TEXT NOT NULL,
  social_insurance_note          TEXT,
  withholding_tax_percent        TEXT NOT NULL,
  vat_basis                      TEXT NOT NULL,
  payment_term_days              INTEGER NOT NULL,
  defects_liability_months       INTEGER NOT NULL,
  recognition_policy             TEXT NOT NULL,
  stamp_duty_percent             TEXT NOT NULL,
  late_penalty_percent_per_period TEXT NOT NULL,
  late_penalty_cap_percent       TEXT NOT NULL,
  final_security_percent         TEXT NOT NULL,
  provisional_release_percent    TEXT,
  provisional_handover_date      TEXT,
  final_handover_date            TEXT
);
CREATE INDEX IF NOT EXISTS idx_works_contract_project ON works_contract(project_id);

CREATE TABLE IF NOT EXISTS contract_boq_line (
  id                  TEXT PRIMARY KEY,
  contract_id         TEXT NOT NULL,
  code                TEXT NOT NULL,
  description_ar      TEXT NOT NULL,
  description_en      TEXT,
  unit                TEXT NOT NULL,
  qty                 INTEGER NOT NULL,
  unit_rate           INTEGER NOT NULL,
  estimated_unit_cost INTEGER,
  section             TEXT,
  sort_order          INTEGER NOT NULL,
  origin              TEXT NOT NULL,
  variation_order_id  TEXT,
  cost_category       TEXT,
  theoretical_qty_per_unit INTEGER,
  theoretical_item_id TEXT,
  UNIQUE (contract_id, code)
);
CREATE INDEX IF NOT EXISTS idx_contract_boq_line_contract ON contract_boq_line(contract_id);

CREATE TABLE IF NOT EXISTS contract_boq_line_adjustment (
  id                 TEXT PRIMARY KEY,
  contract_id        TEXT NOT NULL,
  boq_line_id        TEXT NOT NULL,
  variation_order_id TEXT NOT NULL,
  qty_delta          INTEGER NOT NULL,
  unit_rate_override INTEGER,
  approved_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boq_adjustment_contract ON contract_boq_line_adjustment(contract_id);

CREATE TABLE IF NOT EXISTS contract_variation_order (
  id              TEXT PRIMARY KEY,
  doc_no          TEXT NOT NULL UNIQUE,
  contract_id     TEXT NOT NULL,
  date            TEXT NOT NULL,
  title_ar        TEXT NOT NULL,
  reason          TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  status          TEXT NOT NULL,
  approved_at     TEXT,
  approved_by     TEXT,
  rejected_reason TEXT,
  created_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_variation_order_contract ON contract_variation_order(contract_id);

CREATE TABLE IF NOT EXISTS contract_variation_order_line (
  id                 TEXT NOT NULL,
  variation_order_id TEXT NOT NULL,
  kind               TEXT NOT NULL,
  boq_line_id        TEXT,
  new_line           TEXT,
  qty_delta          INTEGER,
  unit_rate_override INTEGER,
  sort_order         INTEGER NOT NULL,
  PRIMARY KEY (variation_order_id, id)
);
`;

interface ContractRow {
  id: string;
  doc_no: string;
  project_id: string;
  customer_id: string;
  title_ar: string;
  title_en: string | null;
  contract_type: string;
  signed_date: string;
  start_date: string;
  planned_end_date: string;
  currency: string;
  status: string;
  activated_at: string | null;
  completed_at: string | null;
  terminated_at: string | null;
  notes: string | null;
  estimated_total_cost: bigint | null;
  budget_revisions: string;
  tender_discount_percent: string;
  retention_percent: string;
  retention_cap_percent: string | null;
  advance_percent: string;
  advance_recovery_percent: string;
  materials_on_site_percent: string;
  deemed_wage_percent: string;
  social_insurance_rate_percent: string;
  social_insurance_note: string | null;
  withholding_tax_percent: string;
  vat_basis: string;
  payment_term_days: bigint;
  defects_liability_months: bigint;
  recognition_policy: string;
  stamp_duty_percent: string;
  late_penalty_percent_per_period: string;
  late_penalty_cap_percent: string;
  final_security_percent: string;
  provisional_release_percent: string | null;
  provisional_handover_date: string | null;
  final_handover_date: string | null;
}

interface BoqRow {
  id: string;
  contract_id: string;
  code: string;
  description_ar: string;
  description_en: string | null;
  unit: string;
  qty: bigint;
  unit_rate: bigint;
  estimated_unit_cost: bigint | null;
  section: string | null;
  sort_order: bigint;
  origin: string;
  variation_order_id: string | null;
  cost_category: string | null;
  theoretical_qty_per_unit: bigint | null;
  theoretical_item_id: string | null;
}

interface AdjustmentRow {
  id: string;
  contract_id: string;
  boq_line_id: string;
  variation_order_id: string;
  qty_delta: bigint;
  unit_rate_override: bigint | null;
  approved_at: string;
}

interface VariationRow {
  id: string;
  doc_no: string;
  contract_id: string;
  date: string;
  title_ar: string;
  reason: string;
  requested_by: string;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_reason: string | null;
  created_by: string | null;
}

interface VariationLineRow {
  id: string;
  variation_order_id: string;
  kind: string;
  boq_line_id: string | null;
  new_line: string | null;
  qty_delta: bigint | null;
  unit_rate_override: bigint | null;
  sort_order: bigint;
}

interface SerialisedBudgetRevision {
  date: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string;
  userId: string;
}

interface SerialisedNewLine {
  code: string;
  descriptionAr: string;
  descriptionEn: string | null;
  unit: string;
  qty: string;
  unitRate: string;
  estimatedUnitCost: string | null;
  section: string | null;
  costCategory: string | null;
}

function toContract(row: ContractRow): WorksContract {
  const revisions = JSON.parse(row.budget_revisions) as SerialisedBudgetRevision[];
  return {
    id: row.id,
    docNo: row.doc_no,
    projectId: row.project_id,
    customerId: row.customer_id,
    titleAr: row.title_ar,
    titleEn: row.title_en,
    contractType: row.contract_type as WorksContractType,
    signedDate: row.signed_date,
    startDate: row.start_date,
    plannedEndDate: row.planned_end_date,
    currency: row.currency,
    status: row.status as WorksContractStatus,
    activatedAt: row.activated_at,
    completedAt: row.completed_at,
    terminatedAt: row.terminated_at,
    notes: row.notes,
    estimatedTotalCost: row.estimated_total_cost === null ? null : Money.fromScaled(row.estimated_total_cost),
    budgetRevisions: revisions.map(
      (r): BudgetRevision => ({
        date: r.date,
        previousValue: r.previousValue === null ? null : Money.fromMajor(r.previousValue),
        newValue: r.newValue === null ? null : Money.fromMajor(r.newValue),
        reason: r.reason,
        userId: r.userId,
      }),
    ),
    tenderDiscountPercent: row.tender_discount_percent,
    retentionPercent: row.retention_percent,
    retentionCapPercent: row.retention_cap_percent,
    advancePercent: row.advance_percent,
    advanceRecoveryPercent: row.advance_recovery_percent,
    materialsOnSitePercent: row.materials_on_site_percent,
    deemedWagePercent: row.deemed_wage_percent,
    socialInsuranceRatePercent: row.social_insurance_rate_percent,
    socialInsuranceNote: row.social_insurance_note,
    withholdingTaxPercent: row.withholding_tax_percent,
    vatBasis: row.vat_basis as VatBasis,
    paymentTermDays: Number(row.payment_term_days),
    defectsLiabilityMonths: Number(row.defects_liability_months),
    recognitionPolicy: row.recognition_policy as RecognitionPolicy,
    stampDutyPercent: row.stamp_duty_percent,
    latePenaltyPercentPerPeriod: row.late_penalty_percent_per_period,
    latePenaltyCapPercent: row.late_penalty_cap_percent,
    finalSecurityPercent: row.final_security_percent,
    provisionalReleasePercent: row.provisional_release_percent ?? "50",
    provisionalHandoverDate: row.provisional_handover_date,
    finalHandoverDate: row.final_handover_date,
  };
}

function toBoqLine(row: BoqRow): BoqLine {
  return {
    id: row.id,
    contractId: row.contract_id,
    code: row.code,
    descriptionAr: row.description_ar,
    descriptionEn: row.description_en,
    unit: row.unit as BoqUnit,
    qty: Qty.fromScaled(row.qty),
    unitRate: Money.fromScaled(row.unit_rate),
    estimatedUnitCost: row.estimated_unit_cost === null ? null : Money.fromScaled(row.estimated_unit_cost),
    section: row.section,
    sortOrder: Number(row.sort_order),
    origin: row.origin === "variation" ? "variation" : "base",
    variationOrderId: row.variation_order_id,
    costCategory: (row.cost_category as CostCategory | null) ?? null,
    theoreticalQtyPerUnit: row.theoretical_qty_per_unit === null ? null : Qty.fromScaled(row.theoretical_qty_per_unit),
    theoreticalItemId: row.theoretical_item_id,
  };
}

function toAdjustment(row: AdjustmentRow): BoqLineAdjustment {
  return {
    id: row.id,
    contractId: row.contract_id,
    boqLineId: row.boq_line_id,
    variationOrderId: row.variation_order_id,
    qtyDelta: Qty.fromScaled(row.qty_delta),
    unitRateOverride: row.unit_rate_override === null ? null : Money.fromScaled(row.unit_rate_override),
    approvedAt: row.approved_at,
  };
}

function toNewLine(json: string | null): NewBoqLineSpec | null {
  if (json === null) return null;
  const spec = JSON.parse(json) as SerialisedNewLine;
  return {
    code: spec.code,
    descriptionAr: spec.descriptionAr,
    descriptionEn: spec.descriptionEn,
    unit: spec.unit as BoqUnit,
    qty: Qty.fromMajor(spec.qty),
    unitRate: Money.fromMajor(spec.unitRate),
    estimatedUnitCost: spec.estimatedUnitCost === null ? null : Money.fromMajor(spec.estimatedUnitCost),
    section: spec.section,
    costCategory: (spec.costCategory as CostCategory | null) ?? null,
  };
}

function fromNewLine(spec: NewBoqLineSpec | null): string | null {
  if (spec === null) return null;
  const serialised: SerialisedNewLine = {
    code: spec.code,
    descriptionAr: spec.descriptionAr,
    descriptionEn: spec.descriptionEn,
    unit: spec.unit,
    qty: spec.qty.toString(),
    unitRate: spec.unitRate.toString(),
    estimatedUnitCost: spec.estimatedUnitCost === null ? null : spec.estimatedUnitCost.toString(),
    section: spec.section,
    costCategory: spec.costCategory,
  };
  return JSON.stringify(serialised);
}

const UPSERT_CONTRACT = `INSERT INTO works_contract (
           id, doc_no, project_id, customer_id, title_ar, title_en, contract_type, signed_date, start_date,
           planned_end_date, currency, status, activated_at, completed_at, terminated_at, notes,
           estimated_total_cost, budget_revisions, tender_discount_percent, retention_percent,
           retention_cap_percent, advance_percent, advance_recovery_percent, materials_on_site_percent,
           deemed_wage_percent, social_insurance_rate_percent, social_insurance_note, withholding_tax_percent,
           vat_basis, payment_term_days, defects_liability_months, recognition_policy, stamp_duty_percent,
           late_penalty_percent_per_period, late_penalty_cap_percent, final_security_percent,
           provisional_release_percent, provisional_handover_date, final_handover_date
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?
         )
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           customer_id = excluded.customer_id,
           title_ar = excluded.title_ar,
           title_en = excluded.title_en,
           contract_type = excluded.contract_type,
           signed_date = excluded.signed_date,
           start_date = excluded.start_date,
           planned_end_date = excluded.planned_end_date,
           currency = excluded.currency,
           status = excluded.status,
           activated_at = excluded.activated_at,
           completed_at = excluded.completed_at,
           terminated_at = excluded.terminated_at,
           notes = excluded.notes,
           estimated_total_cost = excluded.estimated_total_cost,
           budget_revisions = excluded.budget_revisions,
           tender_discount_percent = excluded.tender_discount_percent,
           retention_percent = excluded.retention_percent,
           retention_cap_percent = excluded.retention_cap_percent,
           advance_percent = excluded.advance_percent,
           advance_recovery_percent = excluded.advance_recovery_percent,
           materials_on_site_percent = excluded.materials_on_site_percent,
           deemed_wage_percent = excluded.deemed_wage_percent,
           social_insurance_rate_percent = excluded.social_insurance_rate_percent,
           social_insurance_note = excluded.social_insurance_note,
           withholding_tax_percent = excluded.withholding_tax_percent,
           vat_basis = excluded.vat_basis,
           payment_term_days = excluded.payment_term_days,
           defects_liability_months = excluded.defects_liability_months,
           recognition_policy = excluded.recognition_policy,
           stamp_duty_percent = excluded.stamp_duty_percent,
           late_penalty_percent_per_period = excluded.late_penalty_percent_per_period,
           late_penalty_cap_percent = excluded.late_penalty_cap_percent,
           final_security_percent = excluded.final_security_percent,
           provisional_release_percent = excluded.provisional_release_percent,
           provisional_handover_date = excluded.provisional_handover_date,
           final_handover_date = excluded.final_handover_date`;

function contractRowParams(contract: WorksContract): SqlValue[] {
  const revisions: SerialisedBudgetRevision[] = contract.budgetRevisions.map((r) => ({
    date: r.date,
    previousValue: r.previousValue?.toString() ?? null,
    newValue: r.newValue?.toString() ?? null,
    reason: r.reason,
    userId: r.userId,
  }));
  return [
    contract.id,
    contract.docNo,
    contract.projectId,
    contract.customerId,
    contract.titleAr,
    contract.titleEn,
    contract.contractType,
    contract.signedDate,
    contract.startDate,
    contract.plannedEndDate,
    contract.currency,
    contract.status,
    contract.activatedAt,
    contract.completedAt,
    contract.terminatedAt,
    contract.notes,
    contract.estimatedTotalCost?.scaled ?? null,
    JSON.stringify(revisions),
    contract.tenderDiscountPercent,
    contract.retentionPercent,
    contract.retentionCapPercent,
    contract.advancePercent,
    contract.advanceRecoveryPercent,
    contract.materialsOnSitePercent,
    contract.deemedWagePercent,
    contract.socialInsuranceRatePercent,
    contract.socialInsuranceNote,
    contract.withholdingTaxPercent,
    contract.vatBasis,
    contract.paymentTermDays,
    contract.defectsLiabilityMonths,
    contract.recognitionPolicy,
    contract.stampDutyPercent,
    contract.latePenaltyPercentPerPeriod,
    contract.latePenaltyCapPercent,
    contract.finalSecurityPercent,
    contract.provisionalReleasePercent,
    contract.provisionalHandoverDate,
    contract.finalHandoverDate,
  ];
}

const UPSERT_ADJUSTMENT = `INSERT INTO contract_boq_line_adjustment (id, contract_id, boq_line_id, variation_order_id, qty_delta, unit_rate_override, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         qty_delta = excluded.qty_delta,
         unit_rate_override = excluded.unit_rate_override,
         approved_at = excluded.approved_at`;

function adjustmentParams(a: BoqLineAdjustment): SqlValue[] {
  return [
    a.id,
    a.contractId,
    a.boqLineId,
    a.variationOrderId,
    a.qtyDelta.scaled,
    a.unitRateOverride?.scaled ?? null,
    a.approvedAt,
  ];
}

const UPSERT_VARIATION = `INSERT INTO contract_variation_order (id, doc_no, contract_id, date, title_ar, reason, requested_by, status, approved_at, approved_by, rejected_reason, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             date = excluded.date,
             title_ar = excluded.title_ar,
             reason = excluded.reason,
             requested_by = excluded.requested_by,
             status = excluded.status,
             approved_at = excluded.approved_at,
             approved_by = excluded.approved_by,
             rejected_reason = excluded.rejected_reason`;

function variationParams(order: VariationOrder): SqlValue[] {
  return [
    order.id,
    order.docNo,
    order.contractId,
    order.date,
    order.titleAr,
    order.reason,
    order.requestedBy,
    order.status,
    order.approvedAt,
    order.approvedBy,
    order.rejectedReason,
    order.createdBy,
  ];
}

const INSERT_VARIATION_LINE = `INSERT INTO contract_variation_order_line (id, variation_order_id, kind, boq_line_id, new_line, qty_delta, unit_rate_override, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function variationLineParams(orderId: string, line: VariationOrderLine): SqlValue[] {
  return [
    line.id,
    orderId,
    line.kind,
    line.boqLineId,
    fromNewLine(line.newLine),
    line.qtyDelta?.scaled ?? null,
    line.unitRateOverride?.scaled ?? null,
    line.sortOrder,
  ];
}

const UPSERT_BOQ_LINE = `INSERT INTO contract_boq_line (id, contract_id, code, description_ar, description_en, unit, qty, unit_rate, estimated_unit_cost, section, sort_order, origin, variation_order_id, cost_category, theoretical_qty_per_unit, theoretical_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         description_ar = excluded.description_ar,
         description_en = excluded.description_en,
         unit = excluded.unit,
         qty = excluded.qty,
         unit_rate = excluded.unit_rate,
         estimated_unit_cost = excluded.estimated_unit_cost,
         section = excluded.section,
         sort_order = excluded.sort_order,
         origin = excluded.origin,
         variation_order_id = excluded.variation_order_id,
         cost_category = excluded.cost_category,
         theoretical_qty_per_unit = excluded.theoretical_qty_per_unit,
         theoretical_item_id = excluded.theoretical_item_id`;

function boqLineParams(line: BoqLine): SqlValue[] {
  return [
    line.id,
    line.contractId,
    line.code,
    line.descriptionAr,
    line.descriptionEn,
    line.unit,
    line.qty.scaled,
    line.unitRate.scaled,
    line.estimatedUnitCost?.scaled ?? null,
    line.section,
    line.sortOrder,
    line.origin,
    line.variationOrderId,
    line.costCategory,
    line.theoreticalQtyPerUnit?.scaled ?? null,
    line.theoreticalItemId,
  ];
}

class SqlWorksContractStore implements WorksContractStore {
  constructor(private readonly db: SqlDb) {}

  async findContractById(id: string): Promise<WorksContract | null> {
    const row = await this.db.get<ContractRow>(`SELECT * FROM works_contract WHERE id = ?`, [id]);
    return row ? toContract(row) : null;
  }

  async findContractByDocNo(docNo: string): Promise<WorksContract | null> {
    const row = await this.db.get<ContractRow>(`SELECT * FROM works_contract WHERE doc_no = ?`, [docNo]);
    return row ? toContract(row) : null;
  }

  async listContracts(filter?: WorksContractListFilter): Promise<WorksContract[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter?.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<ContractRow>(`SELECT * FROM works_contract${where} ORDER BY doc_no`, params);
    return rows.map(toContract);
  }

  async insertContract(contract: WorksContract): Promise<void> {
    await insertNew(this.db, contract.id, UPSERT_CONTRACT, contractRowParams(contract));
  }

  async saveContract(contract: WorksContract): Promise<void> {
    await this.db.run(UPSERT_CONTRACT, contractRowParams(contract));
  }

  async listBoqLines(contractId: string): Promise<BoqLine[]> {
    const rows = await this.db.all<BoqRow>(`SELECT * FROM contract_boq_line WHERE contract_id = ? ORDER BY sort_order`, [contractId]);
    return rows.map(toBoqLine);
  }

  async replaceBoqLines(contractId: string, lines: readonly BoqLine[]): Promise<void> {
    await this.transaction(async () => {
      await this.db.run(`DELETE FROM contract_boq_line WHERE contract_id = ?`, [contractId]);
      await this.writeBoqLines(lines);
    });
  }

  async addBoqLines(lines: readonly BoqLine[]): Promise<void> {
    await this.transaction(async () => {
      await this.writeBoqLines(lines);
    });
  }

  async listAdjustments(contractId: string): Promise<BoqLineAdjustment[]> {
    const rows = await this.db.all<AdjustmentRow>(
      `SELECT * FROM contract_boq_line_adjustment WHERE contract_id = ? ORDER BY approved_at, id`,
      [contractId],
    );
    return rows.map(toAdjustment);
  }

  async addAdjustments(adjustments: readonly BoqLineAdjustment[]): Promise<void> {
    await this.transaction(async () => {
      for (const a of adjustments) await this.db.run(UPSERT_ADJUSTMENT, adjustmentParams(a));
    });
  }

  async listVariationOrders(filter?: VariationOrderListFilter): Promise<VariationOrder[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter?.contractId) {
      clauses.push("contract_id = ?");
      params.push(filter.contractId);
    }
    if (filter?.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<VariationRow>(`SELECT * FROM contract_variation_order${where} ORDER BY doc_no`, params);
    const linesByOrder = await childRowsByParentAsync<VariationLineRow>(this.db, {
      table: "contract_variation_order_line",
      parentColumn: "variation_order_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "variation_order_id, sort_order",
    });
    return rows.map((row) => toVariation(row, linesByOrder.get(row.id) ?? []));
  }

  async findVariationOrderById(id: string): Promise<VariationOrder | null> {
    const row = await this.db.get<VariationRow>(`SELECT * FROM contract_variation_order WHERE id = ?`, [id]);
    return row ? this.hydrateVariation(row) : null;
  }

  async findVariationOrderByDocNo(docNo: string): Promise<VariationOrder | null> {
    const row = await this.db.get<VariationRow>(`SELECT * FROM contract_variation_order WHERE doc_no = ?`, [docNo]);
    return row ? this.hydrateVariation(row) : null;
  }

  async insertVariationOrder(order: VariationOrder): Promise<void> {
    await this.transaction(async () => {
      await refuseTakenIdAsync(this.db, "contract_variation_order", order.id);
      await this.writeVariationOrder(order);
    });
  }

  async saveVariationOrder(order: VariationOrder): Promise<void> {
    await this.transaction(() => this.writeVariationOrder(order));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn, TransactionMode.Immediate);
  }

  private async writeVariationOrder(order: VariationOrder): Promise<void> {
    await this.db.run(UPSERT_VARIATION, variationParams(order));
    await this.db.run(`DELETE FROM contract_variation_order_line WHERE variation_order_id = ?`, [order.id]);
    for (const line of order.lines) await this.db.run(INSERT_VARIATION_LINE, variationLineParams(order.id, line));
  }

  private async writeBoqLines(lines: readonly BoqLine[]): Promise<void> {
    for (const line of lines) await this.db.run(UPSERT_BOQ_LINE, boqLineParams(line));
  }

  private async hydrateVariation(row: VariationRow): Promise<VariationOrder> {
    const lineRows = await this.db.all<VariationLineRow>(
      `SELECT * FROM contract_variation_order_line WHERE variation_order_id = ? ORDER BY sort_order`,
      [row.id],
    );
    return toVariation(row, lineRows);
  }
}

function toVariation(row: VariationRow, lineRows: readonly VariationLineRow[]): VariationOrder {
  const lines: VariationOrderLine[] = lineRows.map((l) => ({
    id: l.id,
    variationOrderId: l.variation_order_id,
    kind: l.kind as VariationLineKind,
    boqLineId: l.boq_line_id,
    newLine: toNewLine(l.new_line),
    qtyDelta: l.qty_delta === null ? null : Qty.fromScaled(l.qty_delta),
    unitRateOverride: l.unit_rate_override === null ? null : Money.fromScaled(l.unit_rate_override),
    sortOrder: Number(l.sort_order),
  }));
  return {
    id: row.id,
    docNo: row.doc_no,
    contractId: row.contract_id,
    date: row.date,
    titleAr: row.title_ar,
    reason: row.reason,
    requestedBy: row.requested_by,
    status: row.status as VariationOrderStatus,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    rejectedReason: row.rejected_reason,
    createdBy: row.created_by,
    lines,
  };
}

export async function ensureWorksContractSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createWorksContractStore(db: SqlDb): WorksContractStore {
  return new SqlWorksContractStore(db);
}

export interface SqliteWorksContractStoreHandle extends WorksContractStore {
  close(): void;
}

/** Open a SQLite-backed works-contract store. ":memory:" for tests, a path or a shared connection for real. */
export function createSqliteWorksContractStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteWorksContractStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return Object.assign(createWorksContractStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteWorksContractStoreHandle;
}
