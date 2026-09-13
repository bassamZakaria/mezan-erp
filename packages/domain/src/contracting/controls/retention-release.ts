import type { Money } from "../../money/index.js";

/**
 * الإفراج عن المحتجزات — slice 5B of المقاولات (design §06).
 *
 * Retention is a receivable under EAS 48, but its clock is the RELEASE EVENT,
 * not the certificate that withheld it. Aged as ordinary AR every balance
 * reads 120-days-overdue the day it is created, which trains the collector to
 * ignore the one signal that matters — so the release is its own document with
 * its own due date, and the calendar ages from that date.
 */

export type RetentionReleaseKind = "provisional" | "final" | "other";

export type RetentionReleaseStatus = "draft" | "released" | "cancelled";

export const RETENTION_RELEASE_KIND_DEFINITIONS: readonly { code: RetentionReleaseKind; labelAr: string }[] = [
  { code: "provisional", labelAr: "إفراج عند التسليم الابتدائي" },
  { code: "final", labelAr: "إفراج عند انتهاء فترة الضمان" },
  { code: "other", labelAr: "إفراج استثنائي" },
] as const;

export const RETENTION_RELEASE_STATUS_DEFINITIONS: readonly { code: RetentionReleaseStatus; labelAr: string }[] = [
  { code: "draft", labelAr: "مسودة" },
  { code: "released", labelAr: "مُفرج عنه" },
  { code: "cancelled", labelAr: "ملغي" },
] as const;

export function getRetentionReleaseKindLabel(kind: RetentionReleaseKind): string {
  return RETENTION_RELEASE_KIND_DEFINITIONS.find((d) => d.code === kind)?.labelAr ?? kind;
}

export function getRetentionReleaseStatusLabel(status: RetentionReleaseStatus): string {
  return RETENTION_RELEASE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/**
 * The service item the generated «إفراج عن محتجزات» invoice names. A tenant
 * that prefers its own service item overrides it in the composition.
 */
export const RETENTION_RELEASE_ITEM_ID = "SRV-CONTRACTING-RETENTION";

export interface RetentionRelease {
  readonly id: string;
  readonly docNo: string;
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  readonly customerId: string;
  readonly kind: RetentionReleaseKind;
  readonly date: string;
  readonly amount: Money;
  /**
   * Server-derived: provisional → the contract's provisional handover date;
   * final → the final handover date plus فترة الضمان. Null when the contract
   * has not recorded the handover the tranche depends on.
   */
  readonly releaseEventDate: string | null;
  /** `date < releaseEventDate` — allowed, but it feeds «ضمان محتجز مفرج عنه قبل الميعاد». */
  readonly earlyRelease: boolean;
  readonly status: RetentionReleaseStatus;
  readonly notes: string | null;
  /**
   * The AR document the release becomes. Dr 1105 / Cr 1150 IS the invoice's own
   * posting, which is what keeps the receivables sub-ledger equal to the GL
   * control — a separate journal entry would move the control without the
   * sub-ledger.
   */
  readonly invoiceId: string | null;
  readonly invoiceDocNo: string | null;
  readonly releasedAt: string | null;
  readonly releasedBy: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface RetentionReleaseListFilter {
  readonly contractId?: string;
  readonly projectId?: string;
  readonly status?: RetentionReleaseStatus;
}

/** Persistence port. `transaction` exists because a release numbers a document and issues an invoice. */
export interface RetentionReleaseStore {
  findById(id: string): Promise<RetentionRelease | null>;
  findByDocNo(docNo: string): Promise<RetentionRelease | null>;
  list(filter?: RetentionReleaseListFilter): Promise<RetentionRelease[]>;
  save(release: RetentionRelease): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
