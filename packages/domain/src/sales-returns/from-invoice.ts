/**
 * Builds return lines from a source invoice snapshot (docs/archive/catalog/01 §"بنود
 * المرتجع" — one row per original invoice line, "المتاح للإرجاع" = original
 * qty − already returned, "كمية الإرجاع" user-entered and capped at that).
 * Pure; no I/O. The caller resolves the `SourceSalesInvoice` itself (today: a
 * demo/API-supplied snapshot; tomorrow: `SalesInvoiceLookupPort`).
 */

import { Qty } from "../money/index.js";
import { extend } from "../inventory/wac-math.js";
import { unitCostOf } from "../inventory/wac-math.js";
import type { SalesReturnLine, SalesReturnReason } from "./sales-return-document.js";
import type { SourceSalesInvoice } from "./ports.js";

export interface SalesReturnRequestedQty {
  readonly itemId: string;
  readonly qty: Qty;
  /**
   * سبب الإرجاع for THIS line (R3.9). A document can return one item because
   * it arrived broken and another because the wrong one was picked, so the
   * reason belongs to the line; the document-level reason is only the default
   * for lines that name none.
   */
  readonly reason?: SalesReturnReason;
}

/** One line per requested item with qty > 0; lines with 0/omitted qty are excluded (docs: "اتركه صفر لاستثنائه"). */
export function buildSalesReturnLinesFromInvoice(
  invoice: SourceSalesInvoice,
  warehouseId: string,
  reason: SalesReturnReason,
  requested: readonly SalesReturnRequestedQty[],
): SalesReturnLine[] {
  const requestedByItem = new Map(requested.map((r) => [r.itemId, r]));
  const lines: SalesReturnLine[] = [];
  for (const invLine of invoice.lines) {
    const request = requestedByItem.get(invLine.itemId);
    const qty = request?.qty;
    if (!qty || qty.isZero()) continue;
    const availableQty = invLine.qty.subtract(invLine.alreadyReturnedQty);
    const taxShare =
      invLine.qty.isZero() || invLine.taxAmount.scaled === 0n
        ? invLine.taxAmount
        : extend(qty, unitCostOf(invLine.taxAmount, invLine.qty));
    lines.push({
      itemId: invLine.itemId,
      warehouseId,
      customerId: invoice.customerId,
      sourceInvoiceId: invoice.id,
      sourceInvoiceNumber: invoice.number,
      reason: request.reason ?? reason,
      availableQty,
      qty,
      unitPrice: invLine.unitPrice,
      unitCost: invLine.unitCost,
      taxAmount: taxShare,
      taxRatePercent: invLine.taxRatePercent ?? null,
      taxRateId: invLine.taxRateId ?? null,
      projectId: invoice.projectId ?? null,
      ...(invoice.fxRate ? { currency: invoice.currency ?? null, fxRate: invoice.fxRate } : {}),
    });
  }
  return lines;
}
