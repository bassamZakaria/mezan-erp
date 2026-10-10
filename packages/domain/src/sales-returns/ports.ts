/**
 * The seam this module plugs a real sales-invoices module into, once that
 * (parallel) PR lands. A `SourceSalesInvoice` is the minimal read-only
 * snapshot a return needs from its source invoice — id/number/customer/
 * warehouse/lines with price+cost+tax+already-returned qty. Today the web
 * demo store and the API layer supply this snapshot directly (the caller
 * already has the invoice loaded); `SalesInvoiceLookupPort` is the interface
 * a real adapter implements so a server-side "create return" flow can resolve
 * it from an invoice id instead. Sales returns never import a sales-invoice
 * type — only this port.
 */

import type { Money, Qty } from "../money/index.js";

export interface SourceSalesInvoiceLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly qty: Qty;
  /** Qty from this line already consumed by prior (confirmed) returns. */
  readonly alreadyReturnedQty: Qty;
  readonly unitPrice: Money;
  readonly unitCost: Money;
  readonly taxAmount: Money;
  /** The VAT rate this line was charged at, carried onto the return line (D76). */
  readonly taxRatePercent?: number | null;
}

export interface SourceSalesInvoice {
  readonly id: string;
  readonly number: string;
  readonly customerId: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly status: "confirmed" | "partial" | "paid";
  readonly lines: readonly SourceSalesInvoiceLine[];
  /** بُعد المشروع on the invoice; a return built from it inherits this onto every line it produces. */
  readonly projectId?: string | null;
  readonly branchId?: string | null;
  /** The invoice's currency and the rate it confirmed at; a return reverses at this rate (D203). */
  readonly currency?: string | null;
  readonly fxRate?: string | null;
}

/** Resolves a confirmed sales invoice by id. Implemented by the real invoices module (or a demo/test double) once wired in. */
export interface SalesInvoiceLookupPort {
  findConfirmedInvoice(id: string): Promise<SourceSalesInvoice | null>;
}
