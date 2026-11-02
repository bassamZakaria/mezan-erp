/**
 * Document lifecycle state machine (Tier 2 document framework, docs/archive/plan.md §3
 * "the document lifecycle").
 *
 * Every document module in Mezan — sales invoice, purchase invoice, treasury
 * voucher, journal entry — walks the same shape: مسودة (draft) → optionally
 * بانتظار الموافقة (pending approval) → مؤكد/مرحل (confirmed/posted) → and from
 * there only ملغي (cancelled) or معكوس (reversed). Confirmed/posted documents
 * are append-only: a correction is a reversing document, never a mutation
 * (docs/archive/plan.md §3 rule 1). This module is the single authority on which
 * transitions are legal; the `DocumentService` calls `assertTransition` before
 * every state change.
 */

import { InvalidDocumentTransitionError } from "./errors.js";

/**
 * The union of statuses across the lifecycle. A concrete document type declares
 * whether its active state is "confirmed" (invoices, vouchers) or "posted"
 * (journal entries) — see {@link DocumentTypeDefinition.confirmedStatus} — but
 * the transition graph below covers both uniformly.
 */
export enum DocumentStatusCode {
  Draft = "draft",
  Pending = "pending",
  Confirmed = "confirmed",
  Posted = "posted",
  Cancelled = "cancelled",
  Reversed = "reversed",
}

export type DocumentStatus = `${DocumentStatusCode}`;

/** Arabic label per status, for messages the user actually reads. */
export const DOCUMENT_STATUS_LABELS_AR: Readonly<Record<DocumentStatus, string>> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "مؤكد",
  posted: "مرحّل",
  cancelled: "ملغي",
  reversed: "معكوس",
};

export const DOCUMENT_STATUS_LABELS_EN: Readonly<Record<DocumentStatus, string>> = {
  draft: "draft",
  pending: "pending approval",
  confirmed: "confirmed",
  posted: "posted",
  cancelled: "cancelled",
  reversed: "reversed",
};

/** Statuses in which a document is live in the ledger / sub-ledgers (its effects have been applied). */
export const ACTIVE_STATUSES: ReadonlySet<DocumentStatus> = new Set(["confirmed", "posted"]);

/** Terminal statuses — no further transition is possible. */
export const TERMINAL_STATUSES: ReadonlySet<DocumentStatus> = new Set(["cancelled", "reversed"]);

/**
 * Legal transitions, as data. Reading a row: from `draft` a document may be
 * sent for approval (`pending`), confirmed/posted directly, or cancelled while
 * still a draft. A `pending` request may be granted (confirmed/posted), bounced
 * back to `draft` (modification requested), or cancelled. An active document may
 * only be reversed; a draft-level cancel is distinct from reversing a live one.
 */
export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> = {
  draft: ["pending", "confirmed", "posted", "cancelled"],
  pending: ["confirmed", "posted", "draft", "cancelled"],
  confirmed: ["reversed"],
  posted: ["reversed"],
  cancelled: [],
  reversed: [],
};

/** Whether `from → to` is a legal lifecycle transition. */
export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

/** Assert `from → to` is legal, else throw {@link InvalidDocumentTransitionError}. */
export function assertTransition(
  docType: string,
  docId: string,
  from: DocumentStatus,
  to: DocumentStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidDocumentTransitionError(docType, docId, from, to);
  }
}

/** Whether a document in `status` is live (effects applied). */
export function isActive(status: DocumentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Whether `status` is terminal (cancelled/reversed). */
export function isTerminal(status: DocumentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
