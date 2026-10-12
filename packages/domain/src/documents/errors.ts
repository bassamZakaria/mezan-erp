/** Document-framework errors. Stable `code`s so the api/UI can branch on them. */

import type { Money } from "../money/index.js";
import type { ApprovalStatus } from "../workflow/index.js";
import { DOCUMENT_STATUS_LABELS_AR, type DocumentStatus } from "./status.js";

export class InvalidDocumentTransitionError extends Error {
  readonly code = "INVALID_DOCUMENT_TRANSITION";
  constructor(
    readonly docType: string,
    readonly docId: string,
    readonly from: DocumentStatus,
    readonly to: DocumentStatus,
  ) {
    super(`لا يمكن نقل المستند ${docId} من "${DOCUMENT_STATUS_LABELS_AR[from]}" إلى "${DOCUMENT_STATUS_LABELS_AR[to]}".`);
    this.name = "InvalidDocumentTransitionError";
  }
}

export class DocumentNotFoundError extends Error {
  readonly code = "DOCUMENT_NOT_FOUND";
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`المستند ${docId} غير موجود.`);
    this.name = "DocumentNotFoundError";
  }
}

export class DuplicateDocumentError extends Error {
  readonly code = "DUPLICATE_DOCUMENT";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`المستند "${docType}/${docId}" موجود بالفعل.`);
    this.messageEn = `Document ${docType}/${docId} already exists.`;
    this.name = "DuplicateDocumentError";
  }
}

/**
 * A document type declared a hook (GL, stock, workflow, numbering) but the
 * running `DocumentService` was constructed without an adapter for it. This is a
 * wiring/programming error, surfaced early rather than silently skipping the
 * hook — not reachable from user input (D280: converted for consistency anyway).
 */
export class MissingHookError extends Error {
  readonly code = "MISSING_DOCUMENT_HOOK";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly hook: "numbering" | "gl" | "stock" | "workflow",
  ) {
    super(`نوع المستند "${docType}" يتطلب ربط الخطاف "${hook}"، ولم يُربط في "DocumentService".`);
    this.messageEn = `Document type "${docType}" requires the ${hook} hook, but none was wired into the DocumentService.`;
    this.name = "MissingHookError";
  }
}

/** A confirm was attempted but the document's own structural validation failed. */
export class InvalidDocumentError extends Error {
  readonly code = "INVALID_DOCUMENT";
  constructor(
    readonly docType: string,
    readonly docId: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

export class DocumentChangedError extends Error {
  readonly code = "DOCUMENT_CHANGED";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`تغيّر المستند ${docId} أثناء تنفيذ العملية — أعد تحميله ثم حاول مرة أخرى.`);
    this.messageEn = `Document ${docType}/${docId} changed while the operation ran. Reload it and try again.`;
    this.name = "DocumentChangedError";
  }
}

export function assertDocumentWritten(written: boolean, docType: string, docId: string): void {
  if (!written) throw new DocumentChangedError(docType, docId);
}

export class DocumentReversalRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly messageEn?: string,
  ) {
    super(message);
    this.name = "DocumentReversalRefusedError";
  }
}

export class DocumentResubmitRefusedError extends Error {
  readonly code = "DOCUMENT_RESUBMIT_REFUSED";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly docId: string,
    readonly approvalStatus: ApprovalStatus | null,
  ) {
    super(RESUBMIT_REFUSAL_AR[approvalStatus ?? "none"]);
    this.messageEn = `Document ${docType}/${docId} cannot be resubmitted: its approval request is ${approvalStatus ?? "absent"}, not rejected.`;
    this.name = "DocumentResubmitRefusedError";
  }
}

const RESUBMIT_REFUSAL_AR: Readonly<Record<ApprovalStatus | "none", string>> = {
  none: "لا يوجد طلب موافقة مرفوض على هذا المستند حتى يُعاد إرساله.",
  pending: "المستند بانتظار الموافقة بالفعل، ولا حاجة لإعادة إرساله.",
  approved: "طلب الموافقة على هذا المستند معتمد بالفعل؛ أكِّد المستند بدلاً من إعادة إرساله.",
  modification_requested: "طُلب تعديل هذا المستند؛ عدِّله ثم أكِّده ليُعرض على المعتمِد من جديد.",
  rejected: "تعذّرت إعادة إرسال المستند للاعتماد.",
};

/** A wiring error: a reversal emptied a stock position at a value its mirror did not name, and nothing can book the difference. */
export class UnbookedStockVarianceError extends Error {
  readonly code = "UNBOOKED_STOCK_VARIANCE";
  readonly messageEn: string;
  constructor(readonly unmirroredValue: Money) {
    super(`تعذّر عكس المستند: فرق تكلفة مخزون بقيمة ${unmirroredValue.toString()} لا يوجد حساب لترحيله.`);
    this.messageEn = `The reversal left a stock cost variance of ${unmirroredValue.toString()} with no account wired to book it.`;
    this.name = "UnbookedStockVarianceError";
  }
}
