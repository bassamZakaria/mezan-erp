/**
 * Builds return lines from a source purchase-invoice snapshot (docs/archive/catalog/02
 * §"بنود المرتجع"). Pure; no I/O — mirrors `../sales-returns/from-invoice.ts`.
 */

import { extend, unitCostOf } from "../inventory/wac-math.js";
import type { Qty } from "../money/index.js";
import type { PurchaseReturnLine, PurchaseReturnReason } from "./purchase-return-document.js";
import type { SourcePurchaseInvoice } from "./ports.js";
import { matchSourceLines } from "../documents/match-source-lines.js";

export interface PurchaseReturnRequestedQty {
  readonly itemId: string;
  readonly sourceLineId?: string | null;
  readonly qty: Qty;
}

export function buildPurchaseReturnLinesFromInvoice(
  invoice: SourcePurchaseInvoice,
  warehouseId: string,
  reason: PurchaseReturnReason,
  requested: readonly PurchaseReturnRequestedQty[],
): PurchaseReturnLine[] {
  const lines: PurchaseReturnLine[] = [];
  for (const { line: invLine, request } of matchSourceLines(invoice.lines, requested)) {
    const qty = request.qty;
    if (qty.isZero()) continue;
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
      sourceLineId: invLine.sourceLineId ?? null,
      reason,
      availableQty,
      qty,
      unitCost: invLine.unitCost,
      taxAmount: taxShare,
      taxRatePercent: invLine.taxRatePercent ?? null,
      taxRateId: invLine.taxRateId ?? null,
      // A return built from an invoice inherits the invoice's projectId and
      // each line's costCategory (D-01) — the invoice is the only place these
      // are stated, and a return that drops them loses the project's cost.
      projectId: invoice.projectId ?? null,
      costCategory: invLine.costCategory ?? null,
      ...(invoice.fxRate ? { currency: invoice.currency ?? null, fxRate: invoice.fxRate } : {}),
    });
  }
  return lines;
}
