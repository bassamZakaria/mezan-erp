import type { Money, Qty } from "../../money/index.js";
import type { BoqUnit } from "../contracts/boq-unit.js";
import type { VatBasis } from "../contracts/contract.js";

/** The sub side releases on the same two events as the client side (design §06). */
export type SubcontractRetentionReleaseKind = "provisional" | "final";

export const SUBCONTRACT_RETENTION_RELEASE_KIND_DEFINITIONS: readonly {
  code: SubcontractRetentionReleaseKind;
  labelAr: string;
}[] = [
  { code: "provisional", labelAr: "إفراج عند إنهاء الأعمال" },
  { code: "final", labelAr: "إفراج عند انتهاء فترة الضمان" },
] as const;

export function getSubcontractRetentionReleaseKindLabel(kind: SubcontractRetentionReleaseKind): string {
  return SUBCONTRACT_RETENTION_RELEASE_KIND_DEFINITIONS.find((d) => d.code === kind)?.labelAr ?? kind;
}

/**
 * عقد الباطن — the mirror of the works contract, and usually the larger half of
 * the money (design §03 "THE MIRROR", D-04, D-05).
 *
 * Every line is back-to-back: it names the client BOQ line it sits under, and
 * nothing certified to the subcontractor may exceed what the consultant
 * certified to the employer on that same line. Retention withheld from a
 * subcontractor is a LIABILITY (2195), not a silent debit inside AP.
 */

export type SubcontractStatus = "draft" | "active" | "completed" | "terminated";

/** عمالة بالمقاولة is a different animal from a works package: it is the one that turns into disguised employment. */
export type SubcontractKind = "works" | "labour_only";

export const SUBCONTRACT_STATUS_DEFINITIONS: readonly { code: SubcontractStatus; labelAr: string; labelEn: string }[] = [
  { code: "draft", labelAr: "مسودة", labelEn: "draft" },
  { code: "active", labelAr: "ساري", labelEn: "active" },
  { code: "completed", labelAr: "منتهٍ", labelEn: "completed" },
  { code: "terminated", labelAr: "مفسوخ", labelEn: "terminated" },
] as const;

export const SUBCONTRACT_TRANSITIONS: Readonly<Record<SubcontractStatus, readonly SubcontractStatus[]>> = {
  draft: ["active", "terminated"],
  active: ["completed", "terminated"],
  completed: [],
  terminated: [],
};

export function getSubcontractStatusLabel(status: SubcontractStatus): string {
  return SUBCONTRACT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export function getSubcontractStatusLabelEn(status: SubcontractStatus): string {
  return SUBCONTRACT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelEn ?? status;
}

export function canTransitionSubcontract(from: SubcontractStatus, to: SubcontractStatus): boolean {
  return from === to || SUBCONTRACT_TRANSITIONS[from].includes(to);
}

export const SUBCONTRACT_KIND_DEFINITIONS: readonly { code: SubcontractKind; labelAr: string }[] = [
  { code: "works", labelAr: "أعمال بالمقاولة" },
  { code: "labour_only", labelAr: "عمالة بالمقاولة" },
] as const;

export function getSubcontractKindLabel(kind: SubcontractKind): string {
  return SUBCONTRACT_KIND_DEFINITIONS.find((d) => d.code === kind)?.labelAr ?? kind;
}

/**
 * The commercial parameters, mirrored from the client side with the
 * subcontractor's OWN values. Percentages are exact decimal strings, never
 * floats — each is multiplied into Money on a certificate.
 */
export interface SubcontractTerms {
  /** المحتجزات الضمانية withheld FROM the subcontractor — credited to 2195, not held inside AP. */
  readonly retentionPercent: string;
  readonly retentionCapPercent: string | null;
  readonly advancePercent: string;
  readonly advanceRecoveryPercent: string;
  /** ضريبة الخصم والتحصيل the contractor withholds from the sub and owes the ETA (Form 41). */
  readonly withholdingTaxPercent: string;
  /** التأمينات الاجتماعية = netCertified × deemedWage% × rate%, withheld only when `withholdSocialInsurance`. */
  readonly deemedWagePercent: string;
  readonly socialInsuranceRatePercent: string;
  readonly withholdSocialInsurance: boolean;
  readonly socialInsuranceNote: string | null;
  /** غرامة التأخير — the ceiling the penalty column may not pass, stored, never turned into a schedule here. */
  readonly penaltyCapPercent: string;
  readonly paymentTermDays: number;
  readonly defectsLiabilityMonths: number;
  /** The SUB's invoice basis, which need not be the client contract's (D-07). */
  readonly vatBasis: VatBasis;
}

/**
 * One advance payment actually made to the subcontractor, read off a CONFIRMED
 * voucher at link time. The recovery ceiling is the sum of these: a figure the
 * caller states would let a sub be "recovered" for money never paid.
 */
export interface SubcontractAdvancePayment {
  readonly voucherId: string;
  readonly voucherNo: string | null;
  readonly date: string;
  readonly amount: Money;
}

/**
 * One release of retention back to the subcontractor.
 *
 * INVARIANT: the release is an AP DOCUMENT, not a bare journal — a purchase
 * invoice whose single expense line debits 2195, so the invoice's own posting
 * is Dr 2195 / Cr AP and the payables sub-ledger moves with GL 2100. A bare
 * journal moved the control account and left nothing for a voucher to pay.
 */
export interface SubcontractRetentionRelease {
  readonly id: string;
  readonly date: string;
  readonly amount: Money;
  readonly journalEntryId: string;
  /** الشريحة — التسليم الابتدائي or انتهاء فترة الضمان. */
  readonly kind: SubcontractRetentionReleaseKind;
  /** completionDate for `provisional`, completionDate + فترة الضمان for `final`; null until the sub is completed. */
  readonly releaseEventDate: string | null;
  /** Released before its event fell due — the flag the exception report reads. */
  readonly earlyRelease: boolean;
  readonly invoiceId: string | null;
  readonly invoiceDocNo: string | null;
  readonly releasedBy: string | null;
  readonly notes: string | null;
}

export interface SubcontractLine {
  readonly id: string;
  readonly subcontractId: string;
  /** REQUIRED — back-to-back. The client BOQ line this package sits under. */
  readonly clientBoqLineId: string;
  /** The client line's bill item number, stamped so the grid reads without a join. */
  readonly code: string;
  readonly descriptionAr: string;
  readonly unit: BoqUnit;
  readonly qty: Qty;
  /** The SUB's rate. */
  readonly unitRate: Money;
  /** The client line's rate, stamped at save — the margin column is what this document exists for. */
  readonly clientUnitRate: Money;
  /** clientUnitRate − unitRate. */
  readonly marginVsClient: Money;
  readonly estimatedUnitCost: Money | null;
  readonly sortOrder: number;
}

export interface Subcontract extends SubcontractTerms {
  readonly id: string;
  readonly docNo: string;
  /** The CLIENT contract this package is let under. */
  readonly contractId: string;
  readonly projectId: string;
  /** The subcontractor — a supplier. */
  readonly supplierId: string;
  readonly titleAr: string;
  readonly kind: SubcontractKind;
  /**
   * The ETA/NOSI distinction is RECORDED, never implied (design §09): a
   * labour-only package that nobody reviewed is the one that is reassessed as
   * employment, and «لم يُراجع» has to be visible rather than absent.
   */
  readonly disguisedEmploymentReviewed: boolean;
  readonly reviewNote: string | null;
  readonly signedDate: string;
  readonly startDate: string;
  readonly plannedEndDate: string;
  readonly currency: string;
  readonly status: SubcontractStatus;
  readonly activatedAt: string | null;
  readonly completedAt: string | null;
  readonly terminatedAt: string | null;
  readonly notes: string | null;
  readonly createdBy: string | null;
  readonly advances: readonly SubcontractAdvancePayment[];
  readonly retentionReleases: readonly SubcontractRetentionRelease[];
  readonly lines: readonly SubcontractLine[];
}

export interface SubcontractListFilter {
  readonly contractId?: string;
  readonly projectId?: string;
  readonly supplierId?: string;
  readonly status?: SubcontractStatus;
}

/** Σ qty × rate over the lines — the subcontract's value. */
export type SubcontractValue = Money;
