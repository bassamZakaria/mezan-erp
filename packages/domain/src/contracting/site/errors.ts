/** Raised when a site document fails validation. Every reason is Arabic — these reach the user unchanged. */
export class InvalidSiteDocumentError extends Error {
  readonly code = "INVALID_SITE_DOCUMENT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidSiteDocumentError";
  }
}

/** Raised when a site document id names nothing. */
export class SiteDocumentNotFoundError extends Error {
  readonly code = "SITE_DOCUMENT_NOT_FOUND";
  constructor(readonly documentId: string) {
    super(`المستند "${documentId}" غير موجود.`);
    this.name = "SiteDocumentNotFoundError";
  }
}

/** Raised when a document is acted on from a status that does not allow it. */
export class SiteDocumentStatusError extends Error {
  readonly code = "SITE_DOCUMENT_STATUS";
  readonly messageEn?: string;
  constructor(message: string, messageEn?: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "SiteDocumentStatusError";
  }
}

/**
 * The two-step control itself (D-11): the person who issued from the main store
 * may not be the person who signs for it on site. Without this the second step
 * is paperwork, not a control.
 */
export class SiteReceiptSelfReceiptError extends Error {
  readonly code = "SITE_RECEIPT_SELF_RECEIPT";
  constructor(readonly userId: string) {
    super("لا يجوز أن يستلم بالموقع من أصدر إذن الصرف.");
    this.name = "SiteReceiptSelfReceiptError";
  }
}
