/** Document-framework errors. Stable `code`s so the api/UI can branch on them. */

import type { DocumentStatus } from "./status.js";

export class InvalidDocumentTransitionError extends Error {
  readonly code = "INVALID_DOCUMENT_TRANSITION";
  constructor(
    readonly docType: string,
    readonly docId: string,
    readonly from: DocumentStatus,
    readonly to: DocumentStatus,
  ) {
    super(`Document ${docType}/${docId} cannot transition ${from} → ${to}.`);
    this.name = "InvalidDocumentTransitionError";
  }
}

export class DocumentNotFoundError extends Error {
  readonly code = "DOCUMENT_NOT_FOUND";
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`Document ${docType}/${docId} was not found.`);
    this.name = "DocumentNotFoundError";
  }
}

export class DuplicateDocumentError extends Error {
  readonly code = "DUPLICATE_DOCUMENT";
  constructor(
    readonly docType: string,
    readonly docId: string,
  ) {
    super(`Document ${docType}/${docId} already exists.`);
    this.name = "DuplicateDocumentError";
  }
}

/**
 * A document type declared a hook (GL, stock, workflow, numbering) but the
 * running `DocumentService` was constructed without an adapter for it. This is a
 * wiring/programming error, surfaced early rather than silently skipping the
 * hook.
 */
export class MissingHookError extends Error {
  readonly code = "MISSING_DOCUMENT_HOOK";
  constructor(
    readonly docType: string,
    readonly hook: "numbering" | "gl" | "stock" | "workflow",
  ) {
    super(`Document type "${docType}" requires the ${hook} hook, but none was wired into the DocumentService.`);
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
