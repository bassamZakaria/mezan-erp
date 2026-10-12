/** Document-framework errors. Stable `code`s so the api/UI can branch on them. */

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
