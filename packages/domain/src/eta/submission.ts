/**
 * ETA submission queue + lifecycle (docs/archive/catalog/04 §"الإرسالات"). Every
 * confirmed document that must be reported becomes a submission whose status
 * moves جاهز → بانتظار التوقيع → مرسل → مقبول, with أخطاء (error) and مستبعد
 * (excluded) as side states. Submission is a legal obligation — exclusion is
 * exceptional and requires a reason.
 */

export type EtaDocumentType = "invoice" | "credit_note" | "debit_note";

export type EtaSubmissionStatus =
  | "ready" // جاهز — in the queue, not yet sent
  | "pending_signature" // بانتظار التوقيع — awaiting e-seal (v1.0)
  | "submitted" // مرسل — transmitted, awaiting authority acceptance
  | "accepted" // مقبول — accepted by the authority (has a UUID)
  | "error" // أخطاء — rejected / transmission error
  | "excluded"; // مستبعد — deliberately not submitted (reason required)

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
};

export function getEtaDocumentTypeLabel(type: EtaDocumentType): string {
  return ETA_DOCUMENT_TYPE_LABELS[type];
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
}

/** Persistence port for the submission queue. */
export interface EtaSubmissionRepository {
  findById(id: string): Promise<EtaSubmission | null>;
  findByInternalId(internalId: string): Promise<EtaSubmission | null>;
  list(status?: EtaSubmissionStatus): Promise<EtaSubmission[]>;
  create(submission: EtaSubmission): Promise<void>;
  update(submission: EtaSubmission): Promise<void>;
}
