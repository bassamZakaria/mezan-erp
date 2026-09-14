import type { Money, Qty } from "../../money/index.js";

/**
 * مستودعات المواقع والصرف والاستهلاك — the entities of slice 4A
 * (docs/artifacts/mezan-contracting-designs.html D-11, §03 "How cost reaches a
 * project").
 *
 * Stock does not become cost by moving. An issue to site and its receipt are
 * two legs of ONE valuation-neutral transfer through a per-branch transit
 * store; only the consumption document converts inventory into project cost,
 * and only it carries both ledger dimensions.
 */

export type SiteIssueStatus = "draft" | "issued" | "partially_received" | "received";

export interface SiteIssueLine {
  readonly itemId: string;
  readonly qty: Qty;
}

export interface SiteIssue {
  readonly id: string;
  readonly docNo: string | null;
  readonly date: string;
  /** The main/normal store the material leaves. */
  readonly fromWarehouseId: string;
  /** The site store it is destined for (type SITE). */
  readonly toWarehouseId: string;
  /** Read off the site store at draft time, never off the request body. */
  readonly projectId: string;
  readonly issuedByUserId: string;
  /** The branch transit store the confirmed issue parked the goods in. */
  readonly transitWarehouseId: string | null;
  readonly notes: string | null;
  readonly status: SiteIssueStatus;
  readonly lines: readonly SiteIssueLine[];
  readonly createdAt: string;
  readonly issuedAt: string | null;
}

export type SiteReceiptStatus = "draft" | "confirmed";

export interface SiteReceiptLine {
  readonly itemId: string;
  readonly qtyReceived: Qty;
}

export interface SiteReceipt {
  readonly id: string;
  readonly docNo: string | null;
  readonly issueId: string;
  readonly date: string;
  readonly receivedByUserId: string;
  readonly projectId: string;
  readonly notes: string | null;
  readonly status: SiteReceiptStatus;
  readonly lines: readonly SiteReceiptLine[];
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

export type MaterialConsumptionStatus = "draft" | "confirmed";

export interface MaterialConsumptionLine {
  readonly itemId: string;
  readonly qty: Qty;
}

export interface MaterialConsumption {
  readonly id: string;
  readonly docNo: string | null;
  readonly date: string;
  /** The site store the material is consumed out of. */
  readonly warehouseId: string;
  readonly projectId: string;
  readonly boqLineId: string | null;
  /**
   * عقد الباطن الذي صُرفت له المواد. Set when the material was issued TO a
   * subcontractor rather than consumed by the contractor's own crew: the sub
   * certificate's «خصم مواد مصروفة للمقاول» is prefilled from these, so a
   * consumption that names no subcontract can never become a deduction.
   */
  readonly subcontractId: string | null;
  readonly notes: string | null;
  readonly status: MaterialConsumptionStatus;
  readonly lines: readonly MaterialConsumptionLine[];
  /**
   * The value the STOCK LEDGER moved, recorded after the fact — never a figure
   * the document carried in (D47). Zero while the document is a draft.
   */
  readonly totalCost: Money;
  readonly journalEntryId: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

/**
 * عهدة الشدة والسقالات — a returnable-materials register, deliberately with no
 * valuation, no stock movement and no posting (D-11). Formwork issued to a site
 * is company property that comes back; charging it to the project as cost would
 * expense an asset the company still owns.
 */
export interface CustodyItem {
  readonly id: string;
  readonly projectId: string;
  readonly warehouseId: string;
  readonly custodianUserId: string;
  readonly descriptionAr: string;
  readonly qtyOut: Qty;
  readonly qtyReturned: Qty;
  readonly issuedDate: string;
  readonly expectedReturnDate: string | null;
  readonly notes: string | null;
}

export type EquipmentLogStatus = "draft" | "confirmed";

export interface EquipmentLog {
  readonly id: string;
  readonly docNo: string | null;
  readonly projectId: string;
  readonly assetId: string;
  readonly date: string;
  readonly hours: Qty;
  readonly hourlyRate: Money;
  /** hours × hourlyRate, computed by the domain. */
  readonly amount: Money;
  readonly boqLineId: string | null;
  readonly notes: string | null;
  readonly status: EquipmentLogStatus;
  readonly journalEntryId: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

/** One outstanding line of an issue that never fully arrived on site. */
export interface UnreceivedRow {
  readonly issueId: string;
  readonly docNo: string | null;
  readonly date: string;
  readonly projectId: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly transitWarehouseId: string | null;
  readonly issuedByUserId: string;
  readonly itemId: string;
  readonly qtyIssued: Qty;
  readonly qtyReceived: Qty;
  readonly qtyOutstanding: Qty;
  readonly ageDays: number;
  /**
   * `outstanding` — the ordinary shortfall the two-step split exists to find.
   * `received_before_issue` — a CONFIRMED receipt dated before the issue it
   * closes, which no honest sequence of events produces.
   */
  readonly kind: "outstanding" | "received_before_issue";
  /** On a `received_before_issue` row, the offending receipt. Null otherwise. */
  readonly receiptId: string | null;
  readonly receiptDocNo: string | null;
  readonly receiptDate: string | null;
}

/** استهلاك مقابل بند جدول الكميات — consumed quantity per (BOQ line, item). */
export interface ConsumptionByBoqLineRow {
  readonly boqLineId: string | null;
  readonly itemId: string;
  readonly qty: Qty;
  readonly cost: Money;
}

/** ساعات المعدات — confirmed plant hours per BOQ line. */
export interface EquipmentHoursRow {
  readonly boqLineId: string | null;
  readonly hours: Qty;
  readonly amount: Money;
}
