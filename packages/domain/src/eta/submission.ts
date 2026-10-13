/**
 * ETA submission queue + lifecycle (docs/archive/catalog/04 §"الإرسالات"). Every
 * confirmed document that must be reported becomes a submission whose status
 * moves جاهز → بانتظار التوقيع → مرسل → مقبول, with أخطاء (error) and مستبعد
 * (excluded) as side states. Submission is a legal obligation — exclusion is
 * exceptional and requires a reason.
 */

/**
 * الإيصال الإلكتروني (`receipt`) is a SEPARATE authority mandate from the
 * e-invoice, with its own document shape and its own post-sale reporting
 * window — see receipt.ts. It shares this queue because the queue is what
 * makes both work offline, not because the documents are alike.
 */
import type { EtaPrevalidationFinding } from "./prevalidate.js";

export type EtaDocumentType = "invoice" | "credit_note" | "debit_note" | "receipt";

export enum EtaSubmissionState {
  Ready = "ready",
  PendingSignature = "pending_signature",
  Submitted = "submitted",
  Accepted = "accepted",
  Error = "error",
  Excluded = "excluded",
}

export type EtaSubmissionStatus = `${EtaSubmissionState}`;

export interface EtaSubmissionStatusDefinition {
  readonly code: EtaSubmissionStatus;
  readonly labelAr: string;
}

export const ETA_SUBMISSION_STATUSES: readonly EtaSubmissionStatusDefinition[] = [
  { code: "ready", labelAr: "جاهز" },
  { code: "pending_signature", labelAr: "بانتظار التوقيع" },
  { code: "submitted", labelAr: "مرسل" },
  { code: "accepted", labelAr: "مقبول" },
  { code: "error", labelAr: "أخطاء" },
  { code: "excluded", labelAr: "مستبعد" },
] as const;

export function getEtaStatusLabel(status: EtaSubmissionStatus): string {
  return ETA_SUBMISSION_STATUSES.find((s) => s.code === status)?.labelAr ?? status;
}

const ETA_DOCUMENT_TYPE_LABELS: Record<EtaDocumentType, string> = {
  invoice: "فاتورة",
  credit_note: "إشعار خصم",
  debit_note: "إشعار إضافة",
  receipt: "إيصال إلكتروني",
};

export function getEtaDocumentTypeLabel(type: EtaDocumentType): string {
  return ETA_DOCUMENT_TYPE_LABELS[type];
}

/**
 * One HTTP round trip against the authority, kept on the submission itself.
 *
 * Filing is a legal act; "the gateway said no" with nothing behind it is not
 * an audit trail. `requestBody` is what was SENT with secrets redacted — the
 * token request's client secret never reaches this record.
 */
export interface EtaTransmitLogEntry {
  readonly at: string;
  readonly attempt: number;
  readonly method: string;
  readonly url: string;
  readonly requestBody: string | null;
  readonly status: number | null;
  readonly responseBody: string;
  readonly error: string | null;
}

export interface EtaSubmission {
  readonly id: string;
  /** المعرف الداخلي — the source document number, e.g. "INV-000014". */
  readonly internalId: string;
  readonly documentType: EtaDocumentType;
  readonly status: EtaSubmissionStatus;
  /** المعرف لدى المصلحة — the authority's UUID, set on acceptance. */
  readonly etaUuid: string | null;
  /** The built ETA payload (JSON), queued offline until transmitted. */
  readonly payload: unknown;
  /** الأخطاء — error messages from a rejection/transmission failure. */
  readonly errors: readonly string[];
  /** Reason captured when excluded. */
  readonly exclusionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
  /** رقم الإرسال لدى المصلحة — the authority's submission id, when it returned one. */
  readonly gatewaySubmissionId: string | null;
  /** The CAdES-BES signature attached before transmission, when the e-seal leg ran. */
  readonly signature: string | null;
  /** Every request/response of every attempt, oldest first. */
  readonly transmitLog: readonly EtaTransmitLogEntry[];
  /** e-receipt only: the POS device serial whose chain this receipt is a link of. */
  readonly receiptSerial?: string | null;
  /** e-receipt only: the receipt's position on that device's chain, from 1. */
  readonly receiptSeq?: number | null;
  /**
   * فحص مسبق (ENH-011b) — every rule finding as of the last enqueue/requeue.
   * Never blocks the confirm that produced it; `EtaService.submit` refuses to
   * transmit while a `Blocking`-severity finding remains.
   */
  readonly prevalidation?: readonly EtaPrevalidationFinding[];
  /**
   * One authority error code per entry of {@link errors} (same index), when the
   * rejection carried one — null where it did not. Powers the rejections
   * report's grouping; `errors` alone is prose, not a stable key.
   */
  readonly rejectionCodes?: readonly (string | null)[];
  /**
   * When this document was handed to the authority with no answer recorded
   * yet; null once the answer is. REQUIRED ORDERING: written BEFORE the call,
   * so a crash or a lost turn after the authority received it leaves this set
   * and the next drive asks what the authority holds instead of sending again.
   */
  readonly transmitStartedAt?: string | null;
}

/** Persistence port for the submission queue. */
export interface EtaSubmissionRepository {
  findById(id: string): Promise<EtaSubmission | null>;
  findByInternalId(internalId: string): Promise<EtaSubmission | null>;
  list(status?: EtaSubmissionStatus): Promise<EtaSubmission[]>;
  statusByEtaUuid(etaUuid: string): Promise<EtaSubmissionStatus | null>;
  create(submission: EtaSubmission): Promise<void>;
  update(submission: EtaSubmission): Promise<void>;
}
