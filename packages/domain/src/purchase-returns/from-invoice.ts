/**
 * Builds return lines from a source purchase-invoice snapshot (docs/archive/catalog/02
 * §"بنود المرتجع"). Pure; no I/O — mirrors `../sales-returns/from-invoice.ts`.
 */

import { extend, unitCostOf } from "../inventory/wac-math.js";
import type { Qty } from "../money/index.js";
import type { PurchaseReturnLine, PurchaseReturnReason } from "./purchase-return-document.js";
import type { SourcePurchaseInvoice } from "./ports.js";

export interface PurchaseReturnRequestedQty {
  readonly itemId: string;
  readonly qty: Qty;
}

export function buildPurchaseReturnLinesFromInvoice(
  invoice: SourcePurchaseInvoice,
  warehouseId: string,
  reason: PurchaseReturnReason,
  requested: readonly PurchaseReturnRequestedQty[],
): PurchaseReturnLine[] {
  const requestedByItem = new Map(requested.map((r) => [r.itemId, r.qty]));
  const lines: PurchaseReturnLine[] = [];
  for (const invLine of invoice.lines) {
    const qty = requestedByItem.get(invLine.itemId);
    if (!qty || qty.isZero()) continue;
    const availableQty = invLine.qty.subtract(invLine.alreadyReturnedQty);
    const taxShare =
      invLine.qty.isZero() || invLine.taxAmount.scaled === 0n
        ? invLine.taxAmount
        : extend(qty, unitCostOf(invLine.taxAmount, invLine.qty));
    lines.push({
      itemId: invLine.itemId,
      warehouseId,
      supplierId: invoice.supplierId,
      sourceInvoiceId: invoice.id,
      sourceInvoiceNumber: invoice.number,
      reason,
      availableQty,
      qty,
      unitCost: invLine.unitCost,
      taxAmount: taxShare,
    });
  }
  return lines;
}
