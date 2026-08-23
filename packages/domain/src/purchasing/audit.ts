/**
 * Audit port for the purchase chain — the same optional `AuditSink` shape
 * sales invoices (`sales-invoices/service.ts`) and treasury vouchers
 * (`vouchers/voucher-service.ts`) already declare. Optional so every existing
 * caller keeps working unchanged; when a sink IS wired, confirming or
 * cancelling a purchase order, goods receipt or purchase invoice appends to
 * the same append-only `sensitive` stream `/audit` reads.
 */

import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";

export type PurchaseAuditEntityType = "PURCHASE_ORDER" | "GOODS_RECEIPT" | "PURCHASE_INVOICE";
export type PurchaseAuditAction = "CONFIRM" | "CANCEL";

export interface PurchaseAuditDeps {
  /** Omit and nothing is recorded — the flow behaves exactly as before. */
  readonly audit?: AuditSink;
  readonly actor?: string;
}

export async function recordPurchaseAudit(
  deps: PurchaseAuditDeps,
  entityType: PurchaseAuditEntityType,
  action: PurchaseAuditAction,
  details: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!deps.audit) return;
  await recordSensitiveEvent(deps.audit, {
    module: "purchases",
    entityType,
    action,
    actor: deps.actor ?? "system",
    severity: action === "CANCEL" ? "WARNING" : "INFO",
    details,
  });
}
