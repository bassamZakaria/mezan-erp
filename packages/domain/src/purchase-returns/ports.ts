/**
 * The seam this module plugs a real purchase-invoices module into, once that
 * (parallel) PR lands — mirrors `../sales-returns/ports.ts`.
 */

import type { Money, Qty } from "../money/index.js";
import type { CostCategory } from "../contracting/cost-category.js";

export interface SourcePurchaseInvoiceLine {
  /** EXTERNAL CONTRACT: a purchase invoice line has no id; this is its position in the invoice. */
  readonly sourceLineId?: string | null;
  readonly itemId: string;
  readonly itemName: string;
  readonly qty: Qty;
  /** Qty from this line already consumed by prior (confirmed) returns. */
  readonly alreadyReturnedQty: Qty;
  readonly unitCost: Money;
  readonly taxAmount: Money;
  /** The VAT rate this line was charged at, carried onto the return line (D76). */
  readonly taxRatePercent?: number | null;
  readonly taxRateId?: string | null;
  /** فئة التكلفة this line was invoiced under — a return inherits it (D-01). */
  readonly costCategory?: CostCategory | null;
}

export interface SourcePurchaseInvoice {
  readonly id: string;
  readonly number: string;
  readonly createdBy?: string | null;
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly status: "confirmed" | "partial" | "paid";
  readonly lines: readonly SourcePurchaseInvoiceLine[];
  /** بُعد المشروع — a return built from this invoice inherits it (D-01). */
  readonly projectId?: string | null;
  /** The invoice's currency and the rate it confirmed at; a return reverses at this rate (D203). */
  readonly currency?: string | null;
  readonly fxRate?: string | null;
}

/** Resolves a confirmed purchase invoice by id. Implemented by the real invoices module (or a demo/test double) once wired in. */
export interface PurchaseInvoiceLookupPort {
  findConfirmedInvoice(id: string): Promise<SourcePurchaseInvoice | null>;
}
