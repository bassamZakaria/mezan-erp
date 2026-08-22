/**
 * Sales-invoice lifecycle transitions.
 *
 * The shared spine (draft → pending → confirmed → reversed, plus a draft-level
 * cancel) mirrors the document framework's own state machine (documents/
 * status.ts) — the same "confirmed/posted documents are append-only, corrected
 * only by reversal" rule (docs/plan.md §3). It extends that spine with the AR
 * payment states the catalog documents: a live invoice is collected against
 * (confirmed → partially_paid → paid) before it can be reversed.
 */

import type { SalesInvoiceStatus } from "./sales-invoice.js";
import { InvalidSalesInvoiceTransitionError } from "./errors.js";

export const SALES_INVOICE_TRANSITIONS: Readonly<
  Record<SalesInvoiceStatus, readonly SalesInvoiceStatus[]>
> = {
  draft: ["pending", "confirmed", "cancelled"],
  pending: ["confirmed", "draft", "cancelled"],
  confirmed: ["partially_paid", "paid", "reversed"],
  partially_paid: ["paid", "reversed"],
  paid: ["reversed"],
  cancelled: [],
  reversed: [],
};

export function canTransition(from: SalesInvoiceStatus, to: SalesInvoiceStatus): boolean {
  return SALES_INVOICE_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  invoiceId: string,
  from: SalesInvoiceStatus,
  to: SalesInvoiceStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidSalesInvoiceTransitionError(invoiceId, from, to);
  }
}
