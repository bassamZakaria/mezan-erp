/**
 * The seam this module plugs a real purchase-invoices module into, once that
 * (parallel) PR lands — mirrors `../sales-returns/ports.ts`.
 */

import type { Money, Qty } from "../money/index.js";

export interface SourcePurchaseInvoiceLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly qty: Qty;
  /** Qty from this line already consumed by prior (confirmed) returns. */
  readonly alreadyReturnedQty: Qty;
  readonly unitCost: Money;
  readonly taxAmount: Money;
}

export interface SourcePurchaseInvoice {
  readonly id: string;
  readonly number: string;
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly status: "confirmed" | "partial" | "paid";
  readonly lines: readonly SourcePurchaseInvoiceLine[];
}

/** Resolves a confirmed purchase invoice by id. Implemented by the real invoices module (or a demo/test double) once wired in. */
export interface PurchaseInvoiceLookupPort {
  findConfirmedInvoice(id: string): Promise<SourcePurchaseInvoice | null>;
}
