import type { Money, Qty } from "../../money/index.js";
import type { BoqUnit } from "../contracts/boq-unit.js";

/**
 * المستخلص — the progress certificate (design §04, D-02, D-03, D-09).
 *
 * A certificate stores CUMULATIVE-to-date, never the period: per BOQ line it
 * holds the previously certified quantity, this period's quantity and the
 * cumulative, and every period figure is a SUBTRACTION of two snapshots. The
 * hard `previousCertificateId` plus a strictly increasing serial per contract
 * is what makes that subtraction answerable; storing the period figure instead
 * is how the same work gets billed twice.
 *
 * The certificate only BILLS. Revenue is recognised by the monthly cost-to-cost
 * run unless the contract elects `certified_value` (D-03).
 */

/**
 * The service item the generated invoice's single line names.
 *
 * A sales-invoice line has to target an item, and «مستخلص رقم n» is a service,
 * not a stock movement. The composition points the invoicing adapter at this
 * id; a tenant that prefers its own service item overrides it there.
 */
export const CERTIFICATE_WORKS_ITEM_ID = "SRV-CONTRACTING-WORKS";

export type ProgressCertificateStatus =
  | "draft"
  | "measured"
  | "certified"
  | "approved_for_payment"
  | "invoiced"
  | "cancelled"
  | "voided";

/**
 * «محصّل» is a READ-time derivation from the generated invoice's remaining
 * balance, never a stored status — the money is the treasury's record, and a
 * second copy of it here could disagree with the sub-ledger.
 */
export type ProgressCertificateDerivedStatus = ProgressCertificateStatus | "collected";

export const PROGRESS_CERTIFICATE_STATUS_DEFINITIONS: readonly {
  code: ProgressCertificateDerivedStatus;
  labelAr: string;
}[] = [
  { code: "draft", labelAr: "مسودة" },
  { code: "measured", labelAr: "حصر معتمد" },
  { code: "certified", labelAr: "معتمد من الاستشاري" },
  { code: "approved_for_payment", labelAr: "معتمد للصرف" },
  { code: "invoiced", labelAr: "مفوتر" },
  { code: "collected", labelAr: "محصّل" },
  { code: "cancelled", labelAr: "ملغي" },
  { code: "voided", labelAr: "معكوس بعد الاعتماد" },
] as const;

export function getProgressCertificateStatusLabel(status: ProgressCertificateDerivedStatus): string {
  return PROGRESS_CERTIFICATE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** Statuses whose lines a preparer may still re-enter. After certify nothing changes. */
export const EDITABLE_CERTIFICATE_STATUSES: readonly ProgressCertificateStatus[] = ["draft", "measured"];

/**
 * A certificate that still counts against the contract. A cancelled one never
 * reached the ledger and a voided one has had its invoice and its deductions
 * entry reversed, so neither may be the «سابق» a later certificate subtracts.
 */
export function isLiveCertificate(certificate: Pick<ProgressCertificate, "status">): boolean {
  return certificate.status !== "cancelled" && certificate.status !== "voided";
}

/** The eleven deduction rows of the Egyptian block, in the order the paperwork prints them. */
export type CertificateDeductionKey =
  | "retention"
  | "advanceRecovery"
  | "socialInsurance"
  | "withholdingTax"
  | "penalties"
  | "suspended"
  | "employerMaterials"
  | "waterElectricity"
  | "stampDuty";

export interface CertificateDeductionRow {
  readonly key: CertificateDeductionKey;
  readonly labelAr: string;
  /** The rate it was struck at, as an exact decimal string; null for a manual amount. */
  readonly percent: string | null;
  /** Cumulative-to-date. */
  readonly cumulative: Money;
  /** The previous certificate's cumulative for the same row. */
  readonly previous: Money;
  /** cumulative − previous — what THIS certificate deducts. */
  readonly thisCertificate: Money;
  /**
   * التعليات is held pending rectification, not taken: it is excluded from the
   * invoiced base rather than posted, so it never reaches the ledger.
   */
  readonly posted: boolean;
  /** True when a contract cap or the advance received held this row below its computed rate. */
  readonly capped: boolean;
}

export interface CertificateWorkLine {
  readonly id: string;
  readonly boqLineId: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly unit: BoqUnit;
  /** Stamped from the BOQ when the certificate is created — never re-read later. */
  readonly unitRate: Money;
  /** The ONLY figure the client supplies on a work line. */
  readonly thisPeriodQty: Qty;
  readonly previousCumulativeQty: Qty;
  readonly cumulativeQty: Qty;
  /** `contractedQty(boqLineId, executionDate)` — honours variation approval dates. */
  readonly contractedQty: Qty;
  /** cumulative ÷ contracted, as an exact decimal string with one place. */
  readonly completionPercent: string;
  readonly previousCumulativeValue: Money;
  readonly cumulativeValue: Money;
  readonly thisPeriodValue: Money;
  readonly sortOrder: number;
}

/**
 * التشوينات — material delivered and jointly inspected but not built in,
 * certified at the contract's own percentage. Incorporating it is entered as a
 * NEGATIVE quantity in the current-period column, so the value migrates from
 * "stored" to "executed" without being counted twice.
 */
export interface CertificateMaterialLine {
  readonly id: string;
  /** Stable key the next certificate matches its carried-forward cumulative by. */
  readonly materialKey: string;
  readonly descriptionAr: string;
  readonly unit: BoqUnit;
  /** This period, may be negative. */
  readonly qty: Qty;
  readonly unitRate: Money;
  readonly previousCumulativeQty: Qty;
  readonly cumulativeQty: Qty;
  /** cumulativeQty × unitRate × materialsOnSitePercent. */
  readonly value: Money;
  readonly previousValue: Money;
  readonly sortOrder: number;
}

/**
 * The whole computed block, stored on the row at every recompute so a list
 * never re-derives history and a printed certificate can never disagree with
 * the one that was signed.
 */
export interface CertificateComputation {
  readonly grossWorks: Money;
  readonly materialsOnSite: Money;
  readonly certificateTotal: Money;
  readonly tenderDiscountPercent: string;
  readonly tenderDiscount: Money;
  readonly netCertified: Money;
  readonly previousNetCertified: Money;
  readonly thisCertificateNetCertified: Money;
  readonly deductions: readonly CertificateDeductionRow[];
  /** Σ of the this-certificate column over the POSTED deductions. */
  readonly deductionsThisCertificate: Money;
  /** Σ of the cumulative column over the POSTED deductions. */
  readonly deductionsCumulative: Money;
  /** التعليات carried, cumulative — excluded from the invoice, released when it falls. */
  readonly suspendedBalance: Money;
  /** thisCertificateNetCertified − this certificate's suspended movement. */
  readonly invoiceBase: Money;
  readonly vatBasis: "standard" | "transitional";
  readonly vatStatutoryRatePercent: string;
  /** What the invoice is actually raised at: 14, or 14 × 36% ≈ 5.04 on the transitional basis. */
  readonly vatEffectiveRatePercent: string;
  readonly vat: Money;
  /** الدفعات السابقة — the previous certificate's cumulative net payable. */
  readonly previousPayments: Money;
  readonly netPayableThisCertificate: Money;
  readonly cumulativeNetPayable: Money;
  readonly contractValueAfterVariations: Money;
  readonly completionPercent: string;
  readonly retentionHeldCumulative: Money;
  readonly advanceReceived: Money;
  readonly advanceOutstanding: Money;
}

export interface ProgressCertificate {
  readonly id: string;
  readonly docNo: string;
  readonly contractId: string;
  readonly projectId: string;
  /** 1, 2, 3… per contract, server-assigned and strictly increasing. */
  readonly serial: number;
  readonly previousCertificateId: string | null;
  readonly periodFrom: string;
  readonly periodTo: string;
  /** The date the quantities are measured as of — decides which variation orders count. */
  readonly executionDate: string;
  /** مستخلص ختامي — closes quantities; no certificate may follow it. */
  readonly isFinal: boolean;
  readonly status: ProgressCertificateStatus;
  readonly preparedBy: string | null;
  readonly preparedAt: string | null;
  readonly measuredBy: string | null;
  readonly measuredAt: string | null;
  /** الاستشاري. */
  readonly certifiedBy: string | null;
  readonly certifiedAt: string | null;
  /** The employer's finance clearance — this is what starts the payment clock (D-09). */
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly cancelledAt: string | null;
  /** Who cancelled it — never the measurer, who may never have existed. */
  readonly cancelledBy: string | null;
  /** Mandatory on cancel: a cancelled certificate with no stated reason is unauditable. */
  readonly cancelReasonAr: string | null;
  readonly voidedAt: string | null;
  readonly voidedBy: string | null;
  readonly voidReasonAr: string | null;
  /** The entry that mirrored the deductions entry when this certificate was voided. */
  readonly voidJournalEntryId: string | null;
  readonly invoiceId: string | null;
  readonly invoiceDocNo: string | null;
  readonly journalEntryId: string | null;
  /** What the deductions entry credited to AR — the figure the AR sub-ledger has to follow. */
  readonly postedDeductionsTotal: Money;
  readonly dueDate: string | null;
  readonly penaltiesCumulative: Money;
  readonly suspendedCumulative: Money;
  readonly employerMaterialsCumulative: Money;
  readonly waterElectricityCumulative: Money;
  readonly notes: string | null;
  readonly workLines: readonly CertificateWorkLine[];
  readonly materialLines: readonly CertificateMaterialLine[];
  readonly computed: CertificateComputation;
}

export interface ProgressCertificateListFilter {
  readonly contractId?: string;
  readonly projectId?: string;
  readonly status?: ProgressCertificateStatus;
}

/**
 * Persistence port. `transaction` exists because approving a certificate
 * numbers a document, posts a journal entry and confirms an invoice, and those
 * three are all-or-nothing.
 */
export interface ProgressCertificateStore {
  findById(id: string): Promise<ProgressCertificate | null>;
  findByDocNo(docNo: string): Promise<ProgressCertificate | null>;
  list(filter?: ProgressCertificateListFilter): Promise<ProgressCertificate[]>;
  /** Every certificate of one contract, ordered by serial ascending. */
  listByContract(contractId: string): Promise<ProgressCertificate[]>;
  save(certificate: ProgressCertificate): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
