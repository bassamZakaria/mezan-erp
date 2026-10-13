import type { Money, Qty } from "../../money/index.js";
import type { CertificateComputation, CertificateWorkLine } from "../certificates/certificate.js";
import type { Subcontract, SubcontractListFilter } from "./subcontract.js";

/**
 * مستخلص مقاول باطن — the same document as the client certificate with the
 * opposite sign (design §03 "THE MIRROR", D-04).
 *
 * It reuses the client certificate's arithmetic wholesale
 * (`computeCertificate` in ../certificates/amounts.ts): cumulative first,
 * differenced against the previous certificate's stored block, deductions
 * struck on the cumulative net certified value. What differs is where the
 * money goes — a purchase invoice instead of a sales invoice, AP instead of
 * AR, retention PAYABLE instead of retention receivable — and one control the
 * client side has no need of: a sub line may never be certified beyond what
 * the consultant certified to the employer on the client line it sits under.
 */

export type SubCertificateStatus =
  | "draft"
  | "measured"
  | "certified"
  | "approved_for_payment"
  | "invoiced"
  | "cancelled";

/** «مدفوع» is derived from the generated purchase invoice's remaining balance, never stored. */
export type SubCertificateDerivedStatus = SubCertificateStatus | "paid";

export const SUB_CERTIFICATE_STATUS_DEFINITIONS: readonly {
  code: SubCertificateDerivedStatus;
  labelAr: string;
}[] = [
  { code: "draft", labelAr: "مسودة" },
  { code: "measured", labelAr: "حصر معتمد" },
  { code: "certified", labelAr: "معتمد فنيًا" },
  { code: "approved_for_payment", labelAr: "معتمد للصرف" },
  { code: "invoiced", labelAr: "مفوتر" },
  { code: "paid", labelAr: "مدفوع" },
  { code: "cancelled", labelAr: "ملغي" },
] as const;

export function getSubCertificateStatusLabel(status: SubCertificateDerivedStatus): string {
  return SUB_CERTIFICATE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** Statuses whose lines a preparer may still re-enter. After certify nothing changes. */
export const EDITABLE_SUB_CERTIFICATE_STATUSES: readonly SubCertificateStatus[] = ["draft", "measured"];

export function isLiveSubCertificate(certificate: Pick<SubCertificate, "status">): boolean {
  return certificate.status !== "cancelled";
}

/**
 * A work line of a sub certificate IS a certificate work line — `boqLineId`
 * holds the SUBCONTRACT line id — plus the two figures the back-to-back
 * control is argued with.
 */
export interface SubCertificateWorkLine extends CertificateWorkLine {
  /** The client BOQ line this package sits under. */
  readonly clientBoqLineId: string;
  /** The latest cumulative quantity the consultant certified to the employer on that line. */
  readonly clientCertifiedCumulativeQty: Qty;
}

export interface SubCertificate {
  readonly id: string;
  readonly docNo: string;
  readonly subcontractId: string;
  readonly contractId: string;
  readonly projectId: string;
  readonly supplierId: string;
  /** 1, 2, 3… per subcontract, server-assigned and strictly increasing. */
  readonly serial: number;
  readonly previousCertificateId: string | null;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly executionDate: string;
  /** مستخلص ختامي — closes quantities; no certificate may follow it. */
  readonly isFinal: boolean;
  readonly status: SubCertificateStatus;
  readonly preparedBy: string | null;
  readonly preparedAt: string | null;
  readonly measuredBy: string | null;
  readonly measuredAt: string | null;
  readonly certifiedBy: string | null;
  readonly certifiedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: string | null;
  /** سبب الإلغاء — mandatory. A cancelled document with no stated reason is an untraceable one. */
  readonly cancelReasonAr: string | null;
  readonly invoiceId: string | null;
  readonly invoiceDocNo: string | null;
  readonly journalEntryId: string | null;
  /** What the deductions entry DEBITED to AP — the figure the AP sub-ledger has to follow. */
  readonly postedDeductionsTotal: Money;
  readonly dueDate: string | null;
  readonly penaltiesCumulative: Money;
  readonly suspendedCumulative: Money;
  /** خصم مواد مصروفة للمقاول — prefilled from the site consumptions that name this subcontract. */
  readonly employerMaterialsCumulative: Money;
  readonly waterElectricityCumulative: Money;
  readonly notes: string | null;
  readonly workLines: readonly SubCertificateWorkLine[];
  readonly computed: CertificateComputation;
}

export interface SubCertificateListFilter {
  readonly subcontractId?: string;
  readonly contractId?: string;
  readonly projectId?: string;
  readonly supplierId?: string;
  readonly status?: SubCertificateStatus;
}

/**
 * Persistence port for both halves of the slice. `transaction` exists because
 * approving a sub certificate numbers a document, confirms a purchase invoice
 * and posts a journal entry, and those three are all-or-nothing.
 */
export interface SubcontractStore {
  findById(id: string): Promise<Subcontract | null>;
  findByDocNo(docNo: string): Promise<Subcontract | null>;
  list(filter?: SubcontractListFilter): Promise<Subcontract[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insert(subcontract: Subcontract): Promise<void>;
  save(subcontract: Subcontract): Promise<void>;

  findCertificateById(id: string): Promise<SubCertificate | null>;
  findCertificateByDocNo(docNo: string): Promise<SubCertificate | null>;
  listCertificates(filter?: SubCertificateListFilter): Promise<SubCertificate[]>;
  /** Every certificate of one subcontract, ordered by serial ascending. */
  listCertificatesBySubcontract(subcontractId: string): Promise<SubCertificate[]>;
  insertCertificate(certificate: SubCertificate): Promise<void>;
  saveCertificate(certificate: SubCertificate): Promise<void>;

  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
