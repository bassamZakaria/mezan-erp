import { Money, Qty } from "../../money/index.js";
import type { NextNumberService } from "../../numbering/index.js";
import type { ProjectRepository } from "../../projects/index.js";
import type { CustomerRepository } from "../../customers/ports.js";
import { isCostCategory, type CostCategory } from "../cost-category.js";
import { isBoqUnit, type BoqUnit } from "./boq-unit.js";
import {
  canTransitionWorksContract,
  getWorksContractStatusLabel,
  VAT_TRANSITIONAL_CUTOFF_DATE,
  type BoqLine,
  type BoqLineAdjustment,
  type BudgetRevision,
  type WorksContract,
  type WorksContractListFilter,
  type WorksContractStore,
  type WorksContractTerms,
  type WorksContractType,
  type NewBoqLineSpec,
  type VariationOrder,
  type VariationOrderLine,
  type VariationOrderListFilter,
  type VatBasis,
} from "./contract.js";
import {
  computeApprovedVariationsValue,
  computeContractedQuantities,
  computeContractValue,
  computeVariationOrderValue,
  type ContractedQtyRow,
} from "./amounts.js";
import { reviewBoqImport, type BoqImportReview, type BoqImportRow } from "./boq-import.js";
import {
  WorksContractNotDraftError,
  WorksContractNotFoundError,
  InvalidWorksContractError,
  InvalidWorksContractTransitionError,
  SelfApprovalError,
  VariationOrderNotFoundError,
} from "./errors.js";

const PERCENT_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The person acting. `wildcardAdmin` is the tenant admin whose grant is `"*"`:
 * a single-operator install has nobody else to approve a variation order, so
 * the preparer ≠ approver rule (design §06) cannot be enforced against them
 * without locking the product. Every other caller is held to it.
 */
export interface WorksContractActor {
  readonly userId: string;
  readonly wildcardAdmin: boolean;
}

export interface WorksContractServiceDeps {
  readonly store: WorksContractStore;
  readonly numbering: NextNumberService;
  readonly projects: Pick<ProjectRepository, "findById">;
  readonly customers: Pick<CustomerRepository, "findById">;
  /**
   * Slice 2's final-certificate check. Returns an Arabic refusal, or null when
   * the contract may complete. Absent, completion is allowed — the port exists
   * so the certificate slice tightens this without editing the contract.
   */
  readonly completionGuard?: (contractId: string) => Promise<string | null>;
  /** ISO `YYYY-MM-DD` "today", overridable for deterministic tests. */
  readonly today?: () => string;
}

export interface WorksContractTermsInput extends Partial<WorksContractTerms> {}

export interface CreateWorksContractCommand extends WorksContractTermsInput {
  readonly id: string;
  readonly projectId: string;
  readonly customerId: string;
  readonly titleAr: string;
  readonly titleEn?: string | null;
  readonly contractType: WorksContractType;
  readonly signedDate: string;
  readonly startDate: string;
  readonly plannedEndDate: string;
  readonly currency?: string;
  readonly notes?: string | null;
  readonly estimatedTotalCost?: string | null;
}

export interface UpdateWorksContractCommand extends WorksContractTermsInput {
  readonly projectId?: string;
  readonly customerId?: string;
  readonly titleAr?: string;
  readonly titleEn?: string | null;
  readonly contractType?: WorksContractType;
  readonly signedDate?: string;
  readonly startDate?: string;
  readonly plannedEndDate?: string;
  readonly notes?: string | null;
  readonly estimatedTotalCost?: string | null;
  /** Required whenever `estimatedTotalCost` changes — it is written into the budget-revision log. */
  readonly reason?: string;
}

export interface BoqLineInput {
  readonly id?: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly descriptionEn?: string | null;
  readonly unit: string;
  readonly qty: string;
  readonly unitRate: string;
  readonly estimatedUnitCost?: string | null;
  readonly section?: string | null;
  readonly costCategory?: string | null;
  readonly theoreticalQtyPerUnit?: string | null;
  readonly theoreticalItemId?: string | null;
}

export interface VariationOrderLineInput {
  readonly kind: "add" | "change";
  readonly boqLineId?: string | null;
  readonly newLine?: BoqLineInput | null;
  readonly qtyDelta?: string | null;
  readonly unitRateOverride?: string | null;
}

export interface CreateVariationOrderCommand {
  readonly id: string;
  readonly contractId: string;
  readonly date: string;
  readonly titleAr: string;
  readonly reason: string;
  readonly requestedBy: string;
  readonly lines: readonly VariationOrderLineInput[];
}

export interface UpdateVariationOrderCommand {
  readonly date?: string;
  readonly titleAr?: string;
  readonly reason?: string;
  readonly requestedBy?: string;
  readonly lines?: readonly VariationOrderLineInput[];
}

/** A contract with the figures the server derives — never stored, never accepted from the client. */
export interface WorksContractView {
  readonly contract: WorksContract;
  readonly contractValue: Money;
  readonly approvedVariationsValue: Money;
  readonly contractValueAfterVariations: Money;
  readonly boqLineCount: number;
  readonly variationCount: number;
  readonly canComplete: boolean;
}

export interface VariationOrderView {
  readonly order: VariationOrder;
  readonly netValue: Money;
}

export function defaultWorksContractTerms(contractType: WorksContractType, signedDate: string): WorksContractTerms {
  return {
    tenderDiscountPercent: "0",
    retentionPercent: "5",
    retentionCapPercent: null,
    advancePercent: "10",
    advanceRecoveryPercent: "10",
    materialsOnSitePercent: "75",
    deemedWagePercent: "20",
    socialInsuranceRatePercent: "18.75",
    socialInsuranceNote: null,
    withholdingTaxPercent: "1",
    vatBasis: defaultVatBasis(signedDate),
    paymentTermDays: contractType === "public" ? 60 : 30,
    defectsLiabilityMonths: 12,
    recognitionPolicy: "cost_to_cost",
    stampDutyPercent: "0",
    latePenaltyPercentPerPeriod: "0",
    latePenaltyCapPercent: "10",
    finalSecurityPercent: contractType === "public" ? "5" : "0",
    provisionalReleasePercent: "50",
  };
}

/** D-07: keyed on the contract's own signature date, never on a company-wide setting. */
export function defaultVatBasis(signedDate: string): VatBasis {
  return signedDate < VAT_TRANSITIONAL_CUTOFF_DATE ? "transitional" : "standard";
}

function requirePercent(reasons: string[], label: string, value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!PERCENT_RE.test(value)) {
    reasons.push(`${label} يجب أن تكون نسبة رقمية`);
    return;
  }
  if (Number.parseFloat(value) > 100) reasons.push(`${label} لا يمكن أن تتجاوز 100%`);
}

function requireDate(reasons: string[], label: string, value: string | null | undefined): void {
  if (value === null || value === undefined || !DATE_RE.test(value)) reasons.push(`${label} مطلوب بصيغة YYYY-MM-DD`);
}

function moneyOrNull(reasons: string[], label: string, value: string | null | undefined): Money | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return Money.fromMajor(value);
  } catch {
    reasons.push(`${label} يجب أن يكون رقمًا`);
    return null;
  }
}

function qtyOrNull(reasons: string[], label: string, value: string | null | undefined): Qty | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const qty = Qty.fromMajor(value);
    if (qty.isNegative()) reasons.push(`${label} لا يمكن أن تكون سالبة`);
    return qty;
  } catch {
    reasons.push(`${label} يجب أن تكون رقمًا`);
    return null;
  }
}

function mergeTerms(current: WorksContractTerms, patch: WorksContractTermsInput): WorksContractTerms {
  return {
    tenderDiscountPercent: patch.tenderDiscountPercent ?? current.tenderDiscountPercent,
    retentionPercent: patch.retentionPercent ?? current.retentionPercent,
    retentionCapPercent: patch.retentionCapPercent !== undefined ? patch.retentionCapPercent : current.retentionCapPercent,
    advancePercent: patch.advancePercent ?? current.advancePercent,
    advanceRecoveryPercent: patch.advanceRecoveryPercent ?? current.advanceRecoveryPercent,
    materialsOnSitePercent: patch.materialsOnSitePercent ?? current.materialsOnSitePercent,
    deemedWagePercent: patch.deemedWagePercent ?? current.deemedWagePercent,
    socialInsuranceRatePercent: patch.socialInsuranceRatePercent ?? current.socialInsuranceRatePercent,
    socialInsuranceNote: patch.socialInsuranceNote !== undefined ? patch.socialInsuranceNote : current.socialInsuranceNote,
    withholdingTaxPercent: patch.withholdingTaxPercent ?? current.withholdingTaxPercent,
    vatBasis: patch.vatBasis ?? current.vatBasis,
    paymentTermDays: patch.paymentTermDays ?? current.paymentTermDays,
    defectsLiabilityMonths: patch.defectsLiabilityMonths ?? current.defectsLiabilityMonths,
    recognitionPolicy: patch.recognitionPolicy ?? current.recognitionPolicy,
    stampDutyPercent: patch.stampDutyPercent ?? current.stampDutyPercent,
    latePenaltyPercentPerPeriod: patch.latePenaltyPercentPerPeriod ?? current.latePenaltyPercentPerPeriod,
    latePenaltyCapPercent: patch.latePenaltyCapPercent ?? current.latePenaltyCapPercent,
    finalSecurityPercent: patch.finalSecurityPercent ?? current.finalSecurityPercent,
    provisionalReleasePercent: patch.provisionalReleasePercent ?? current.provisionalReleasePercent,
  };
}

function validateTerms(terms: WorksContractTerms): string[] {
  const reasons: string[] = [];
  requirePercent(reasons, "نسبة الممارسة", terms.tenderDiscountPercent);
  requirePercent(reasons, "نسبة المحتجزات الضمانية", terms.retentionPercent);
  requirePercent(reasons, "سقف المحتجزات", terms.retentionCapPercent);
  requirePercent(reasons, "نسبة الدفعة المقدمة", terms.advancePercent);
  requirePercent(reasons, "نسبة خصم الدفعة المقدمة", terms.advanceRecoveryPercent);
  requirePercent(reasons, "نسبة التشوينات", terms.materialsOnSitePercent);
  requirePercent(reasons, "نسبة الأجر الافتراضي", terms.deemedWagePercent);
  requirePercent(reasons, "نسبة التأمينات الاجتماعية", terms.socialInsuranceRatePercent);
  requirePercent(reasons, "نسبة ضريبة الخصم والتحصيل", terms.withholdingTaxPercent);
  requirePercent(reasons, "نسبة الدمغات والرسوم", terms.stampDutyPercent);
  requirePercent(reasons, "نسبة غرامة التأخير", terms.latePenaltyPercentPerPeriod);
  requirePercent(reasons, "سقف غرامة التأخير", terms.latePenaltyCapPercent);
  requirePercent(reasons, "نسبة التأمين النهائي", terms.finalSecurityPercent);
  requirePercent(reasons, "نسبة الإفراج عند التسليم الابتدائي", terms.provisionalReleasePercent);
  if (!Number.isInteger(terms.paymentTermDays) || terms.paymentTermDays < 0) reasons.push("مهلة السداد يجب أن تكون عددًا صحيحًا موجبًا");
  if (!Number.isInteger(terms.defectsLiabilityMonths) || terms.defectsLiabilityMonths < 0) reasons.push("فترة الضمان يجب أن تكون عددًا صحيحًا موجبًا");
  return reasons;
}

function parseUnit(reasons: string[], value: string, code: string): BoqUnit {
  if (isBoqUnit(value)) return value;
  reasons.push(`وحدة غير معروفة في البند "${code}"`);
  return "piece";
}

function parseCategory(reasons: string[], value: string | null | undefined, code: string): CostCategory | null {
  if (value === null || value === undefined || value === "") return null;
  if (isCostCategory(value)) return value;
  reasons.push(`فئة تكلفة غير معروفة في البند "${code}"`);
  return null;
}

export class WorksContractService {
  constructor(private readonly deps: WorksContractServiceDeps) {}

  // ----- contracts ---------------------------------------------------------

  async list(filter?: WorksContractListFilter): Promise<WorksContractView[]> {
    const contracts = await this.deps.store.listContracts(filter);
    return Promise.all(contracts.map((contract) => this.view(contract)));
  }

  async get(idOrDocNo: string): Promise<WorksContractView> {
    return this.view(await this.require(idOrDocNo));
  }

  async create(cmd: CreateWorksContractCommand): Promise<WorksContractView> {
    const reasons: string[] = [];
    if (cmd.titleAr.trim().length === 0) reasons.push("اسم العقد مطلوب");
    requireDate(reasons, "تاريخ التوقيع", cmd.signedDate);
    requireDate(reasons, "تاريخ البدء", cmd.startDate);
    requireDate(reasons, "تاريخ الانتهاء المخطط", cmd.plannedEndDate);
    if (DATE_RE.test(cmd.startDate) && DATE_RE.test(cmd.plannedEndDate) && cmd.plannedEndDate < cmd.startDate) {
      reasons.push("تاريخ الانتهاء المخطط يسبق تاريخ البدء");
    }
    const currency = cmd.currency ?? "EGP";
    if (currency !== "EGP") reasons.push("العملة المدعومة حاليًا هي الجنيه المصري فقط");
    if (!(await this.deps.projects.findById(cmd.projectId))) reasons.push(`المشروع "${cmd.projectId}" غير موجود`);
    if (!(await this.deps.customers.findById(cmd.customerId))) reasons.push(`العميل "${cmd.customerId}" غير موجود`);

    const terms = mergeTerms(defaultWorksContractTerms(cmd.contractType, cmd.signedDate), cmd);
    reasons.push(...validateTerms(terms));
    const estimatedTotalCost = moneyOrNull(reasons, "التكلفة التقديرية للعقد", cmd.estimatedTotalCost);
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);

    return this.deps.store.transaction(async () => {
      if (await this.deps.store.findContractById(cmd.id)) {
        throw new InvalidWorksContractError([`العقد "${cmd.id}" موجود بالفعل`]);
      }
      const number = await this.deps.numbering.next("CONTRACT");
      const contract: WorksContract = {
        ...terms,
        id: cmd.id,
        docNo: number.formatted,
        projectId: cmd.projectId,
        customerId: cmd.customerId,
        titleAr: cmd.titleAr.trim(),
        titleEn: cmd.titleEn ?? null,
        contractType: cmd.contractType,
        signedDate: cmd.signedDate,
        startDate: cmd.startDate,
        plannedEndDate: cmd.plannedEndDate,
        currency,
        status: "draft",
        activatedAt: null,
        completedAt: null,
        terminatedAt: null,
        notes: cmd.notes ?? null,
        estimatedTotalCost,
        budgetRevisions: [],
        provisionalHandoverDate: null,
        finalHandoverDate: null,
      };
      await this.deps.store.saveContract(contract);
      return this.view(contract);
    });
  }

  async update(idOrDocNo: string, cmd: UpdateWorksContractCommand, actor: WorksContractActor): Promise<WorksContractView> {
    const current = await this.require(idOrDocNo);
    const reasons: string[] = [];

    if (current.status === "completed" || current.status === "terminated") {
      throw new WorksContractNotDraftError(
        current.id,
        current.status,
        `لا يمكن تعديل عقد حالته "${getWorksContractStatusLabel(current.status)}".`,
      );
    }

    const draft = current.status === "draft";
    if (!draft) {
      const frozen = (
        [
          "projectId",
          "customerId",
          "titleAr",
          "contractType",
          "signedDate",
          "startDate",
          "tenderDiscountPercent",
          "retentionPercent",
          "retentionCapPercent",
          "advancePercent",
          "advanceRecoveryPercent",
          "materialsOnSitePercent",
          "deemedWagePercent",
          "socialInsuranceRatePercent",
          "withholdingTaxPercent",
          "vatBasis",
          "paymentTermDays",
          "defectsLiabilityMonths",
          "recognitionPolicy",
          "stampDutyPercent",
          "latePenaltyPercentPerPeriod",
          "latePenaltyCapPercent",
          "finalSecurityPercent",
          "provisionalReleasePercent",
        ] as const
      ).filter((key) => cmd[key] !== undefined);
      if (frozen.length > 0) {
        throw new WorksContractNotDraftError(
          current.id,
          current.status,
          "الشروط التجارية تُجمَّد بتفعيل العقد — المسموح بعد التفعيل هو التكلفة التقديرية وتاريخ الانتهاء المخطط والملاحظات فقط.",
        );
      }
    }

    if (cmd.titleAr !== undefined && cmd.titleAr.trim().length === 0) reasons.push("اسم العقد مطلوب");
    if (cmd.signedDate !== undefined) requireDate(reasons, "تاريخ التوقيع", cmd.signedDate);
    if (cmd.startDate !== undefined) requireDate(reasons, "تاريخ البدء", cmd.startDate);
    if (cmd.plannedEndDate !== undefined) requireDate(reasons, "تاريخ الانتهاء المخطط", cmd.plannedEndDate);
    if (cmd.projectId !== undefined && !(await this.deps.projects.findById(cmd.projectId))) {
      reasons.push(`المشروع "${cmd.projectId}" غير موجود`);
    }
    if (cmd.customerId !== undefined && !(await this.deps.customers.findById(cmd.customerId))) {
      reasons.push(`العميل "${cmd.customerId}" غير موجود`);
    }

    const terms = mergeTerms(current, cmd);
    reasons.push(...validateTerms(terms));

    let estimatedTotalCost = current.estimatedTotalCost;
    const revisions: BudgetRevision[] = [...current.budgetRevisions];
    if (cmd.estimatedTotalCost !== undefined) {
      const next = moneyOrNull(reasons, "التكلفة التقديرية للعقد", cmd.estimatedTotalCost);
      const changed = (next?.toString() ?? null) !== (current.estimatedTotalCost?.toString() ?? null);
      if (changed) {
        if (!cmd.reason || cmd.reason.trim().length === 0) reasons.push("تغيير التكلفة التقديرية يتطلب ذكر السبب");
        else {
          revisions.push({
            date: new Date().toISOString().slice(0, 10),
            previousValue: current.estimatedTotalCost,
            newValue: next,
            reason: cmd.reason.trim(),
            userId: actor.userId,
          });
        }
        estimatedTotalCost = next;
      }
    }
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);

    const contract: WorksContract = {
      ...current,
      ...terms,
      projectId: cmd.projectId ?? current.projectId,
      customerId: cmd.customerId ?? current.customerId,
      titleAr: cmd.titleAr?.trim() ?? current.titleAr,
      titleEn: cmd.titleEn !== undefined ? cmd.titleEn : current.titleEn,
      contractType: cmd.contractType ?? current.contractType,
      signedDate: cmd.signedDate ?? current.signedDate,
      startDate: cmd.startDate ?? current.startDate,
      plannedEndDate: cmd.plannedEndDate ?? current.plannedEndDate,
      notes: cmd.notes !== undefined ? cmd.notes : current.notes,
      estimatedTotalCost,
      budgetRevisions: revisions,
    };
    await this.deps.store.saveContract(contract);
    return this.view(contract);
  }

  async activate(idOrDocNo: string, activatedAt: string): Promise<WorksContractView> {
    const current = await this.require(idOrDocNo);
    if (!canTransitionWorksContract(current.status, "active")) throw new InvalidWorksContractTransitionError(current.status, "active");
    const reasons: string[] = [];
    requireDate(reasons, "تاريخ التفعيل", activatedAt);
    const lines = await this.deps.store.listBoqLines(current.id);
    if (lines.length === 0) reasons.push("لا يمكن تفعيل عقد بلا بنود في جدول الكميات");
    // INVARIANT: one LIVE works contract per project. Every per-project read —
    // the WIP balance, أصل العقد, the recognition run, the project P&L — is
    // keyed on the projectId alone, so a second active contract on the same
    // project silently attributes one contract's cost and billings to the
    // other. Drafts and closed contracts may still share a project.
    const live = (await this.deps.store.listContracts({ projectId: current.projectId })).find(
      (c) => c.id !== current.id && c.status === "active",
    );
    if (live) {
      reasons.push(
        `المشروع مرتبط بعقد سارٍ بالفعل (${live.docNo}) — لا يمكن تفعيل عقد ثانٍ على نفس المشروع قبل إنهائه أو فسخه.`,
      );
    }
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);
    const contract: WorksContract = { ...current, status: "active", activatedAt };
    await this.deps.store.saveContract(contract);
    return this.view(contract);
  }

  async complete(idOrDocNo: string, completedAt: string): Promise<WorksContractView> {
    const current = await this.require(idOrDocNo);
    if (!canTransitionWorksContract(current.status, "completed")) throw new InvalidWorksContractTransitionError(current.status, "completed");
    const reasons: string[] = [];
    requireDate(reasons, "تاريخ الإنهاء", completedAt);
    const refusal = await this.deps.completionGuard?.(current.id);
    if (refusal) reasons.push(refusal);
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);
    const contract: WorksContract = { ...current, status: "completed", completedAt };
    await this.deps.store.saveContract(contract);
    return this.view(contract);
  }

  async terminate(idOrDocNo: string, terminatedAt: string, reason: string | null): Promise<WorksContractView> {
    const current = await this.require(idOrDocNo);
    if (!canTransitionWorksContract(current.status, "terminated")) throw new InvalidWorksContractTransitionError(current.status, "terminated");
    const reasons: string[] = [];
    requireDate(reasons, "تاريخ الفسخ", terminatedAt);
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);
    const contract: WorksContract = {
      ...current,
      status: "terminated",
      terminatedAt,
      notes: reason && reason.trim().length > 0 ? reason.trim() : current.notes,
    };
    await this.deps.store.saveContract(contract);
    return this.view(contract);
  }

  // ----- BOQ ---------------------------------------------------------------

  async listBoq(idOrDocNo: string): Promise<BoqLine[]> {
    const contract = await this.require(idOrDocNo);
    return this.deps.store.listBoqLines(contract.id);
  }

  async putBoq(idOrDocNo: string, inputs: readonly BoqLineInput[]): Promise<BoqLine[]> {
    const contract = await this.require(idOrDocNo);
    if (contract.status !== "draft") throw new WorksContractNotDraftError(contract.id, contract.status);
    const lines = this.buildBoqLines(contract.id, inputs);
    await this.deps.store.replaceBoqLines(contract.id, lines);
    return lines;
  }

  async reviewImport(idOrDocNo: string, rows: readonly BoqImportRow[]): Promise<BoqImportReview> {
    const contract = await this.require(idOrDocNo);
    if (contract.status !== "draft") throw new WorksContractNotDraftError(contract.id, contract.status);
    const existing = await this.deps.store.listBoqLines(contract.id);
    return reviewBoqImport(rows, existing.map((l) => l.code));
  }

  /** Persists only the rows the review accepts; a rejected row is reported back, never silently dropped. */
  async commitImport(idOrDocNo: string, rows: readonly BoqImportRow[]): Promise<{ review: BoqImportReview; lines: BoqLine[] }> {
    const contract = await this.require(idOrDocNo);
    if (contract.status !== "draft") throw new WorksContractNotDraftError(contract.id, contract.status);
    const existing = await this.deps.store.listBoqLines(contract.id);
    const review = reviewBoqImport(rows, existing.map((l) => l.code));
    const accepted = review.rows.flatMap((r) => (r.value ? [r.value] : []));
    const added: BoqLine[] = accepted.map((row, index) => ({
      id: `${contract.id}-IMP-${existing.length + index + 1}`,
      contractId: contract.id,
      code: row.code,
      descriptionAr: row.descriptionAr,
      descriptionEn: row.descriptionEn,
      unit: row.unit,
      qty: row.qty,
      unitRate: row.unitRate,
      estimatedUnitCost: row.estimatedUnitCost,
      section: row.section,
      sortOrder: existing.length + index + 1,
      origin: "base",
      variationOrderId: null,
      costCategory: row.costCategory,
      theoreticalQtyPerUnit: null,
      theoreticalItemId: null,
    }));
    if (added.length > 0) await this.deps.store.addBoqLines(added);
    return { review, lines: [...existing, ...added] };
  }

  async contractedQuantities(idOrDocNo: string, asOfDate: string | null): Promise<ContractedQtyRow[]> {
    const contract = await this.require(idOrDocNo);
    const [lines, adjustments, orders] = await Promise.all([
      this.deps.store.listBoqLines(contract.id),
      this.deps.store.listAdjustments(contract.id),
      this.deps.store.listVariationOrders({ contractId: contract.id }),
    ]);
    return computeContractedQuantities(
      { lines, adjustments, variationApprovals: approvalDates(orders) },
      asOfDate,
    );
  }

  // ----- variation orders --------------------------------------------------

  async listVariationOrders(filter?: VariationOrderListFilter): Promise<VariationOrderView[]> {
    const orders = await this.deps.store.listVariationOrders(filter);
    const byContract = new Map<string, BoqLine[]>();
    const views: VariationOrderView[] = [];
    for (const order of orders) {
      let lines = byContract.get(order.contractId);
      if (!lines) {
        lines = await this.deps.store.listBoqLines(order.contractId);
        byContract.set(order.contractId, lines);
      }
      views.push({ order, netValue: computeVariationOrderValue(order, lines) });
    }
    return views;
  }

  async getVariationOrder(idOrDocNo: string): Promise<VariationOrderView> {
    const order = await this.requireVariationOrder(idOrDocNo);
    const lines = await this.deps.store.listBoqLines(order.contractId);
    return { order, netValue: computeVariationOrderValue(order, lines) };
  }

  async createVariationOrder(cmd: CreateVariationOrderCommand, actor: WorksContractActor): Promise<VariationOrderView> {
    const contract = await this.require(cmd.contractId);
    const reasons: string[] = [];
    if (contract.status !== "active") reasons.push("لا يمكن إصدار أمر تغيير إلا على عقد ساري");
    requireDate(reasons, "تاريخ أمر التغيير", cmd.date);
    if (cmd.titleAr.trim().length === 0) reasons.push("عنوان أمر التغيير مطلوب");
    if (cmd.reason.trim().length === 0) reasons.push("سبب أمر التغيير مطلوب");
    if (cmd.lines.length === 0) reasons.push("أمر التغيير بلا بنود");
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);

    const boqLines = await this.deps.store.listBoqLines(contract.id);
    const lines = this.buildVariationLines(cmd.id, cmd.lines, boqLines);

    return this.deps.store.transaction(async () => {
      if (await this.deps.store.findVariationOrderById(cmd.id)) {
        throw new InvalidWorksContractError([`أمر التغيير "${cmd.id}" موجود بالفعل`]);
      }
      const number = await this.deps.numbering.next("VARIATION_ORDER");
      const order: VariationOrder = {
        id: cmd.id,
        docNo: number.formatted,
        contractId: contract.id,
        date: cmd.date,
        titleAr: cmd.titleAr.trim(),
        reason: cmd.reason.trim(),
        requestedBy: cmd.requestedBy.trim(),
        status: "draft",
        approvedAt: null,
        approvedBy: null,
        rejectedReason: null,
        createdBy: actor.userId,
        lines,
      };
      await this.deps.store.saveVariationOrder(order);
      return { order, netValue: computeVariationOrderValue(order, boqLines) };
    });
  }

  async updateVariationOrder(idOrDocNo: string, cmd: UpdateVariationOrderCommand): Promise<VariationOrderView> {
    const current = await this.requireVariationOrder(idOrDocNo);
    if (current.status !== "draft") {
      throw new InvalidWorksContractError([`لا يمكن تعديل أمر تغيير حالته "${current.status === "approved" ? "معتمد" : "مرفوض"}".`]);
    }
    const reasons: string[] = [];
    if (cmd.date !== undefined) requireDate(reasons, "تاريخ أمر التغيير", cmd.date);
    if (cmd.titleAr !== undefined && cmd.titleAr.trim().length === 0) reasons.push("عنوان أمر التغيير مطلوب");
    if (cmd.lines !== undefined && cmd.lines.length === 0) reasons.push("أمر التغيير بلا بنود");
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);

    const boqLines = await this.deps.store.listBoqLines(current.contractId);
    const order: VariationOrder = {
      ...current,
      date: cmd.date ?? current.date,
      titleAr: cmd.titleAr?.trim() ?? current.titleAr,
      reason: cmd.reason?.trim() ?? current.reason,
      requestedBy: cmd.requestedBy?.trim() ?? current.requestedBy,
      lines: cmd.lines ? this.buildVariationLines(current.id, cmd.lines, boqLines) : current.lines,
    };
    await this.deps.store.saveVariationOrder(order);
    return { order, netValue: computeVariationOrderValue(order, boqLines) };
  }

  /**
   * اعتماد أمر التغيير. `add` lines enter the BOQ with origin `variation`;
   * `change` lines are recorded as adjustment ROWS stamped with the approval
   * date, so nothing already certified is recomputed (D-08, forward only).
   */
  async approveVariationOrder(idOrDocNo: string, approvedAt: string, actor: WorksContractActor): Promise<VariationOrderView> {
    const current = await this.requireVariationOrder(idOrDocNo);
    const contract = await this.require(current.contractId);
    const reasons: string[] = [];
    if (current.status !== "draft") reasons.push("أمر التغيير لم يعد مسودة");
    if (contract.status !== "active") reasons.push("لا يمكن اعتماد أمر تغيير إلا على عقد ساري");
    requireDate(reasons, "تاريخ الاعتماد", approvedAt);
    /**
     * INVARIANT: the approval is BOUNDED by the order's own date and today.
     * `approvedAt` is what every ceiling and every «أوامر تغيير متأخرة
     * الاعتماد» exception is measured from, so a date before the order existed
     * reopened every quantity ceiling retroactively and hid the late approval
     * from the report at the same time.
     */
    if (DATE_RE.test(approvedAt)) {
      const today = this.today();
      if (approvedAt < current.date) {
        reasons.push(`تاريخ الاعتماد (${approvedAt}) لا يجوز أن يسبق تاريخ أمر التغيير (${current.date}).`);
      }
      if (approvedAt > today) {
        reasons.push(`تاريخ الاعتماد (${approvedAt}) لا يجوز أن يكون في المستقبل (اليوم ${today}).`);
      }
    }
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);
    if (!actor.wildcardAdmin && current.createdBy !== null && current.createdBy === actor.userId) {
      throw new SelfApprovalError(actor.userId);
    }

    return this.deps.store.transaction(async () => {
      const existing = await this.deps.store.listBoqLines(contract.id);
      const additions: BoqLine[] = [];
      const adjustments: BoqLineAdjustment[] = [];
      let sortOrder = existing.reduce((max, l) => Math.max(max, l.sortOrder), 0);
      for (const line of current.lines) {
        if (line.kind === "add" && line.newLine) {
          sortOrder += 1;
          additions.push({
            id: `${current.id}-${line.id}`,
            contractId: contract.id,
            code: line.newLine.code,
            descriptionAr: line.newLine.descriptionAr,
            descriptionEn: line.newLine.descriptionEn,
            unit: line.newLine.unit,
            qty: line.newLine.qty,
            unitRate: line.newLine.unitRate,
            estimatedUnitCost: line.newLine.estimatedUnitCost,
            section: line.newLine.section,
            sortOrder,
            origin: "variation",
            variationOrderId: current.id,
            costCategory: line.newLine.costCategory,
            theoreticalQtyPerUnit: null,
            theoreticalItemId: null,
          });
          continue;
        }
        if (line.kind === "change" && line.boqLineId && line.qtyDelta) {
          adjustments.push({
            id: `${current.id}-${line.id}-ADJ`,
            contractId: contract.id,
            boqLineId: line.boqLineId,
            variationOrderId: current.id,
            qtyDelta: line.qtyDelta,
            unitRateOverride: line.unitRateOverride,
            approvedAt,
          });
        }
      }
      if (additions.length > 0) await this.deps.store.addBoqLines(additions);
      if (adjustments.length > 0) await this.deps.store.addAdjustments(adjustments);
      const order: VariationOrder = {
        ...current,
        status: "approved",
        approvedAt,
        approvedBy: actor.userId,
        rejectedReason: null,
      };
      await this.deps.store.saveVariationOrder(order);
      return { order, netValue: computeVariationOrderValue(order, [...existing, ...additions]) };
    });
  }

  async rejectVariationOrder(idOrDocNo: string, reason: string, actor: WorksContractActor): Promise<VariationOrderView> {
    const current = await this.requireVariationOrder(idOrDocNo);
    if (current.status !== "draft") throw new InvalidWorksContractError(["أمر التغيير لم يعد مسودة"]);
    if (reason.trim().length === 0) throw new InvalidWorksContractError(["سبب الرفض مطلوب"]);
    if (!actor.wildcardAdmin && current.createdBy !== null && current.createdBy === actor.userId) {
      throw new SelfApprovalError(actor.userId);
    }
    const order: VariationOrder = { ...current, status: "rejected", rejectedReason: reason.trim() };
    await this.deps.store.saveVariationOrder(order);
    const boqLines = await this.deps.store.listBoqLines(order.contractId);
    return { order, netValue: computeVariationOrderValue(order, boqLines) };
  }

  // ----- internals ---------------------------------------------------------

  private today(): string {
    return this.deps.today ? this.deps.today() : new Date().toISOString().slice(0, 10);
  }

  private async require(idOrDocNo: string): Promise<WorksContract> {
    const found =
      (await this.deps.store.findContractById(idOrDocNo)) ?? (await this.deps.store.findContractByDocNo(idOrDocNo));
    if (!found) throw new WorksContractNotFoundError(idOrDocNo);
    return found;
  }

  private async requireVariationOrder(idOrDocNo: string): Promise<VariationOrder> {
    const found =
      (await this.deps.store.findVariationOrderById(idOrDocNo)) ??
      (await this.deps.store.findVariationOrderByDocNo(idOrDocNo));
    if (!found) throw new VariationOrderNotFoundError(idOrDocNo);
    return found;
  }

  private async view(contract: WorksContract): Promise<WorksContractView> {
    const [lines, orders] = await Promise.all([
      this.deps.store.listBoqLines(contract.id),
      this.deps.store.listVariationOrders({ contractId: contract.id }),
    ]);
    const contractValue = computeContractValue(lines);
    const approvedVariationsValue = computeApprovedVariationsValue(orders, lines);
    const refusal = contract.status === "active" ? await this.deps.completionGuard?.(contract.id) : null;
    return {
      contract,
      contractValue,
      approvedVariationsValue,
      contractValueAfterVariations: contractValue.add(approvedVariationsValue),
      boqLineCount: lines.length,
      variationCount: orders.length,
      canComplete: contract.status === "active" && !refusal,
    };
  }

  private buildBoqLines(contractId: string, inputs: readonly BoqLineInput[]): BoqLine[] {
    const reasons: string[] = [];
    const seen = new Set<string>();
    const lines = inputs.map((input, index) => {
      const code = input.code.trim();
      if (code.length === 0) reasons.push(`كود البند مطلوب في السطر ${index + 1}`);
      else if (seen.has(code)) reasons.push(`كود البند "${code}" مكرر`);
      seen.add(code);
      if (input.descriptionAr.trim().length === 0) reasons.push(`وصف البند مطلوب في السطر ${index + 1}`);
      const unit = parseUnit(reasons, input.unit, code);
      const costCategory = parseCategory(reasons, input.costCategory, code);
      let qty = Qty.zero();
      try {
        qty = Qty.fromMajor(input.qty);
      } catch {
        reasons.push(`الكمية غير رقمية في البند "${code}"`);
      }
      if (qty.isNegative()) reasons.push(`الكمية لا يمكن أن تكون سالبة في البند "${code}"`);
      let unitRate = Money.zero();
      try {
        unitRate = Money.fromMajor(input.unitRate);
      } catch {
        reasons.push(`الفئة غير رقمية في البند "${code}"`);
      }
      if (unitRate.scaled < 0n) reasons.push(`الفئة لا يمكن أن تكون سالبة في البند "${code}"`);
      const section = (input.section ?? "").trim();
      const line: BoqLine = {
        id: input.id ?? `${contractId}-B${index + 1}`,
        contractId,
        code,
        descriptionAr: input.descriptionAr.trim(),
        descriptionEn: input.descriptionEn ?? null,
        unit,
        qty,
        unitRate,
        estimatedUnitCost: moneyOrNull(reasons, `التكلفة التقديرية للبند "${code}"`, input.estimatedUnitCost),
        section: section.length === 0 ? null : section,
        sortOrder: index + 1,
        origin: "base",
        variationOrderId: null,
        costCategory,
        theoreticalQtyPerUnit: qtyOrNull(reasons, `الكمية النظرية للبند "${code}"`, input.theoreticalQtyPerUnit),
        theoreticalItemId: input.theoreticalItemId ?? null,
      };
      return line;
    });
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);
    return lines;
  }

  private buildVariationLines(
    orderId: string,
    inputs: readonly VariationOrderLineInput[],
    boqLines: readonly BoqLine[],
  ): VariationOrderLine[] {
    const reasons: string[] = [];
    const existingCodes = new Set(boqLines.map((l) => l.code));
    const lines = inputs.map((input, index) => {
      let newLine: NewBoqLineSpec | null = null;
      let qtyDelta: Qty | null = null;
      let boqLineId: string | null = null;

      if (input.kind === "add") {
        const spec = input.newLine;
        if (!spec) {
          reasons.push(`بند الإضافة رقم ${index + 1} بلا بيانات بند`);
        } else {
          const code = spec.code.trim();
          if (code.length === 0) reasons.push(`كود البند مطلوب في بند الإضافة رقم ${index + 1}`);
          else if (existingCodes.has(code)) reasons.push(`كود البند "${code}" موجود بالفعل في جدول الكميات`);
          else existingCodes.add(code);
          if (spec.descriptionAr.trim().length === 0) reasons.push(`وصف البند مطلوب في بند الإضافة رقم ${index + 1}`);
          const unit = parseUnit(reasons, spec.unit, code);
          const costCategory = parseCategory(reasons, spec.costCategory, code);
          let qty = Qty.zero();
          try {
            qty = Qty.fromMajor(spec.qty);
          } catch {
            reasons.push(`الكمية غير رقمية في البند "${code}"`);
          }
          let unitRate = Money.zero();
          try {
            unitRate = Money.fromMajor(spec.unitRate);
          } catch {
            reasons.push(`الفئة غير رقمية في البند "${code}"`);
          }
          const section = (spec.section ?? "").trim();
          newLine = {
            code,
            descriptionAr: spec.descriptionAr.trim(),
            descriptionEn: spec.descriptionEn ?? null,
            unit,
            qty,
            unitRate,
            estimatedUnitCost: moneyOrNull(reasons, `التكلفة التقديرية للبند "${code}"`, spec.estimatedUnitCost),
            section: section.length === 0 ? null : section,
            costCategory,
          };
        }
      } else {
        boqLineId = input.boqLineId ?? null;
        if (!boqLineId) reasons.push(`بند التعديل رقم ${index + 1} لا يشير إلى بند في جدول الكميات`);
        else if (!boqLines.some((l) => l.id === boqLineId)) reasons.push(`البند "${boqLineId}" غير موجود في جدول الكميات`);
        if (input.qtyDelta === null || input.qtyDelta === undefined || input.qtyDelta === "") {
          reasons.push(`فرق الكمية مطلوب في بند التعديل رقم ${index + 1}`);
        } else {
          try {
            qtyDelta = Qty.fromMajor(input.qtyDelta);
          } catch {
            reasons.push(`فرق الكمية غير رقمي في بند التعديل رقم ${index + 1}`);
          }
        }
      }

      const line: VariationOrderLine = {
        id: `L${index + 1}`,
        variationOrderId: orderId,
        kind: input.kind,
        boqLineId,
        newLine,
        qtyDelta,
        unitRateOverride: moneyOrNull(reasons, `فئة البند في بند التغيير رقم ${index + 1}`, input.unitRateOverride),
        sortOrder: index + 1,
      };
      return line;
    });
    if (reasons.length > 0) throw new InvalidWorksContractError(reasons);
    return lines;
  }
}

/** Variation order id → its approval date, for every APPROVED order. */
export function approvalDates(orders: readonly VariationOrder[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (order.status === "approved" && order.approvedAt) map.set(order.id, order.approvedAt);
  }
  return map;
}
