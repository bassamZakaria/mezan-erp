import type { Money, Qty } from "../../money/index.js";
import type { CostCategory } from "../cost-category.js";
import type { BoqUnit } from "./boq-unit.js";

/**
 * العقد وجدول الكميات وأوامر التغيير — slice 1 of المقاولات
 * (docs/artifacts/mezan-contracting-designs.html §03, D-08, D-10).
 *
 * The contract holds the commercial parameters every downstream document
 * reads; the BOQ is the spine the مستخلص measures against; a variation order
 * is the only way contracted quantity changes once the contract is active.
 *
 * Every rate the design could not source to primary text is a PER-CONTRACT
 * parameter with a default, never a constant and never a company-wide setting
 * (design §09) — which is why a contract carries fifteen of them.
 */

export type WorksContractStatus = "draft" | "active" | "completed" | "terminated";

/** Public = a Law 182/2018 employer: 60-day payment clock and a 5% تأمين نهائي. */
export type WorksContractType = "private" | "public";

/**
 * D-07. Law 157/2025 moved construction into the general VAT regime on
 * 2025-07-18. A contract signed before that date stays on the transitional
 * basis (14% on 36% of value, no input recovery). Every Egyptian contractor
 * holds both kinds at once, so this is a per-contract field.
 */
export type VatBasis = "standard" | "transitional";

/** D-03. Cost-to-cost recognises under EAS 48; certified_value is the «الاعتراف عند الاعتماد» switch. */
export type RecognitionPolicy = "cost_to_cost" | "certified_value";

export type VariationOrderStatus = "draft" | "approved" | "rejected";

export type BoqLineOrigin = "base" | "variation";

export type VariationLineKind = "add" | "change";

/** The date Law 157/2025 moved construction onto the standard VAT basis. */
export const VAT_TRANSITIONAL_CUTOFF_DATE = "2025-07-18";

export const WORKS_CONTRACT_STATUS_DEFINITIONS: readonly { code: WorksContractStatus; labelAr: string }[] = [
  { code: "draft", labelAr: "مسودة" },
  { code: "active", labelAr: "ساري" },
  { code: "completed", labelAr: "منتهٍ" },
  { code: "terminated", labelAr: "مفسوخ" },
] as const;

export const WORKS_CONTRACT_TRANSITIONS: Readonly<Record<WorksContractStatus, readonly WorksContractStatus[]>> = {
  draft: ["active", "terminated"],
  active: ["completed", "terminated"],
  completed: [],
  terminated: [],
};

export function getWorksContractStatusLabel(status: WorksContractStatus): string {
  return WORKS_CONTRACT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export function canTransitionWorksContract(from: WorksContractStatus, to: WorksContractStatus): boolean {
  return from === to || WORKS_CONTRACT_TRANSITIONS[from].includes(to);
}

/** An append-only record of one change to `estimatedTotalCost`, kept because slice 4 forecasts against it. */
export interface BudgetRevision {
  readonly date: string;
  readonly previousValue: Money | null;
  readonly newValue: Money | null;
  readonly reason: string;
  readonly userId: string;
}

/**
 * The commercial parameters. Percentages are EXACT DECIMAL STRINGS ("4.5"),
 * never floats — they are multiplied into Money on every certificate, and a
 * float here would put a rounding error into a posted deduction.
 */
export interface WorksContractTerms {
  /** نسبة الممارسة — the tender discount, applied to every certificate before deductions. */
  readonly tenderDiscountPercent: string;
  /** المحتجزات الضمانية. */
  readonly retentionPercent: string;
  /** Optional cumulative ceiling as a % of contract value, applied when reached — forward only (D-08). */
  readonly retentionCapPercent: string | null;
  /** الدفعة المقدمة. */
  readonly advancePercent: string;
  /** خصم الدفعة المقدمة — the % of each certificate's net certified value recovered. */
  readonly advanceRecoveryPercent: string;
  /** التشوينات — the rate materials delivered to site are certified at. */
  readonly materialsOnSitePercent: string;
  /** التأمينات الاجتماعية = netCertified × deemedWage% × rate%. Both halves are per contract (design §09). */
  readonly deemedWagePercent: string;
  readonly socialInsuranceRatePercent: string;
  readonly socialInsuranceNote: string | null;
  /** ضريبة الخصم والتحصيل — 1% for contracting under MoF Decree 405/2018. */
  readonly withholdingTaxPercent: string;
  readonly vatBasis: VatBasis;
  readonly paymentTermDays: number;
  /** فترة الضمان. */
  readonly defectsLiabilityMonths: number;
  readonly recognitionPolicy: RecognitionPolicy;
  /** دمغات ورسوم — a configurable deduction line, zero by default (design §09). */
  readonly stampDutyPercent: string;
  /** غرامة التأخير — the two numbers Law 182 states, stored, never turned into a schedule here. */
  readonly latePenaltyPercentPerPeriod: string;
  readonly latePenaltyCapPercent: string;
  /** تأمين نهائي — posted up front on a public contract instead of cash retained. */
  readonly finalSecurityPercent: string;
  /**
   * النسبة المفرج عنها من المحتجزات عند التسليم الابتدائي. The 50/50 split is
   * UNVERIFIED in primary text (design §09), so it is a per-contract parameter
   * with a default rather than a constant.
   */
  readonly provisionalReleasePercent: string;
}

export interface WorksContract extends WorksContractTerms {
  readonly id: string;
  readonly docNo: string;
  readonly projectId: string;
  readonly customerId: string;
  readonly titleAr: string;
  readonly titleEn: string | null;
  readonly contractType: WorksContractType;
  readonly signedDate: string;
  readonly startDate: string;
  readonly plannedEndDate: string;
  readonly currency: string;
  readonly status: WorksContractStatus;
  readonly activatedAt: string | null;
  readonly completedAt: string | null;
  readonly terminatedAt: string | null;
  readonly notes: string | null;
  /** The cost-to-complete basis slice 4 forecasts against. */
  readonly estimatedTotalCost: Money | null;
  readonly budgetRevisions: readonly BudgetRevision[];
  /** التسليم الابتدائي — the release event of the first retention tranche (design §06). */
  readonly provisionalHandoverDate: string | null;
  /** التسليم النهائي — the final tranche's event is this date plus `defectsLiabilityMonths`. */
  readonly finalHandoverDate: string | null;
}

export interface BoqLine {
  readonly id: string;
  readonly contractId: string;
  /** Bill item number, free text like "1.2.3" — unique within the contract. */
  readonly code: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string | null;
  readonly unit: BoqUnit;
  readonly qty: Qty;
  readonly unitRate: Money;
  /** Feeds the مستخلص تنفيذي's estimated-cost column. */
  readonly estimatedUnitCost: Money | null;
  readonly section: string | null;
  readonly sortOrder: number;
  readonly origin: BoqLineOrigin;
  readonly variationOrderId: string | null;
  readonly costCategory: CostCategory | null;
  /**
   * الكمية النظرية لكل وحدة — how much of `theoreticalItemId` one unit of this
   * item ought to consume, the basis of «انحراف الاستهلاك عن الكميات النظرية».
   * REPORTING ONLY: it never enters a contracted quantity, a certificate or a
   * posting, so it stays editable after the contract is active.
   */
  readonly theoreticalQtyPerUnit: Qty | null;
  readonly theoreticalItemId: string | null;
}

/**
 * One approved `change` line, kept as its OWN row rather than mutating the BOQ
 * line's quantity: `contractedQty(asOfDate)` has to be answerable for any past
 * date, and a certificate whose quantity depends on a variation approved after
 * the work was executed must be refusable (design §06).
 */
export interface BoqLineAdjustment {
  readonly id: string;
  readonly contractId: string;
  readonly boqLineId: string;
  readonly variationOrderId: string;
  readonly qtyDelta: Qty;
  readonly unitRateOverride: Money | null;
  readonly approvedAt: string;
}

/** The BOQ line an `add` variation line creates once the order is approved. */
export interface NewBoqLineSpec {
  readonly code: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string | null;
  readonly unit: BoqUnit;
  readonly qty: Qty;
  readonly unitRate: Money;
  readonly estimatedUnitCost: Money | null;
  readonly section: string | null;
  readonly costCategory: CostCategory | null;
}

export interface VariationOrderLine {
  readonly id: string;
  readonly variationOrderId: string;
  readonly kind: VariationLineKind;
  readonly boqLineId: string | null;
  readonly newLine: NewBoqLineSpec | null;
  readonly qtyDelta: Qty | null;
  readonly unitRateOverride: Money | null;
  readonly sortOrder: number;
}

export interface VariationOrder {
  readonly id: string;
  readonly docNo: string;
  readonly contractId: string;
  readonly date: string;
  readonly titleAr: string;
  readonly reason: string;
  /** employer / consultant / contractor — free text, as the paperwork names it. */
  readonly requestedBy: string;
  readonly status: VariationOrderStatus;
  /**
   * The LEGAL approval date entered by the approver, not now(). «أوامر تغيير
   * معتمدة بعد التنفيذ» is one of the six exception reports, and it can only
   * be written against a date somebody stated.
   */
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly rejectedReason: string | null;
  readonly createdBy: string | null;
  readonly lines: readonly VariationOrderLine[];
}

export interface WorksContractListFilter {
  readonly projectId?: string;
  readonly status?: WorksContractStatus;
}

export interface VariationOrderListFilter {
  readonly contractId?: string;
  readonly status?: VariationOrderStatus;
}

/**
 * Persistence port. The domain depends on this interface only — no SQL, no
 * driver. `transaction` exists because a contract's docNo comes off the
 * numbering counter and must be all-or-nothing with the row that carries it.
 */
export interface WorksContractStore {
  findContractById(id: string): Promise<WorksContract | null>;
  findContractByDocNo(docNo: string): Promise<WorksContract | null>;
  listContracts(filter?: WorksContractListFilter): Promise<WorksContract[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insertContract(contract: WorksContract): Promise<void>;
  saveContract(contract: WorksContract): Promise<void>;

  listBoqLines(contractId: string): Promise<BoqLine[]>;
  replaceBoqLines(contractId: string, lines: readonly BoqLine[]): Promise<void>;
  addBoqLines(lines: readonly BoqLine[]): Promise<void>;

  listAdjustments(contractId: string): Promise<BoqLineAdjustment[]>;
  addAdjustments(adjustments: readonly BoqLineAdjustment[]): Promise<void>;

  listVariationOrders(filter?: VariationOrderListFilter): Promise<VariationOrder[]>;
  findVariationOrderById(id: string): Promise<VariationOrder | null>;
  findVariationOrderByDocNo(docNo: string): Promise<VariationOrder | null>;
  insertVariationOrder(order: VariationOrder): Promise<void>;
  saveVariationOrder(order: VariationOrder): Promise<void>;

  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
