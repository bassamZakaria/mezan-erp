/** Document-framework errors. Stable `code`s so the api/UI can branch on them. */

import { DOCUMENT_STATUS_LABELS_AR, type DocumentStatus } from "./status.js";

export class InvalidDocumentTransitionError extends Error {
  readonly code = "INVALID_DOCUMENT_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly docId: string,
    readonly from: DocumentStatus,
    readonly to: DocumentStatus,
  ) {
    super(`لا يمكن نقل المستند ${docId} من "${DOCUMENT_STATUS_LABELS_AR[from]}" إلى "${DOCUMENT_STATUS_LABELS_AR[to]}".`);
    this.messageEn = `Document ${docId} cannot move from "${from}" to "${to}".`;
    this.name = "InvalidDocumentTransitionError";
  }
}

export class ReversalNotReversibleError extends Error {
  readonly code = "REVERSAL_NOT_REVERSIBLE";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`المستند ${docId} قيد عكسي ولا يُعكس. أعد إدخال المستند الأصلي من جديد بدلاً من عكس عكسه.`);
    this.messageEn = `Document ${docId} is itself a reversal and cannot be reversed. Re-enter the original document instead.`;
    this.name = "ReversalNotReversibleError";
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

/**
 * A stock plan reached the ledger without its document's date. Stamping the
 * wall clock instead put a June return's goods into October while its journal
 * entry sat in June, so inventory and GL 1200 disagreed at every month end in
 * between.
 */
export class StockPlanDateRequiredError extends Error {
  readonly code = "STOCK_PLAN_DATE_REQUIRED";
  readonly messageEn: string;
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`حركة المخزون للمستند "${docId}" من النوع "${docType}" بلا تاريخ مستند، ولا تُرحَّل بتاريخ اليوم.`);
    this.messageEn = `The stock plan of ${docType} "${docId}" carries no document date and will not be stamped with today's.`;
    this.name = "StockPlanDateRequiredError";
  }
}

/** A confirm was attempted but the document's own structural validation failed. */
export class InvalidDocumentError extends Error {
  readonly code = "INVALID_DOCUMENT";
  constructor(
    readonly docType: string,
    readonly docId: string,
    message: string,
    readonly messageEn?: string,
  ) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}
