/**
 * Shared types + ports for the manufacturing module (docs/archive/catalog/07):
 * قوائم المواد (BOMs), أوامر التصنيع (Work Orders), المنتجات القابلة للتهيئة
 * (Configurable Products) and التصنيع المخصص (Custom Manufacturing / config
 * instances).
 *
 * Like the purchase chain, the module depends on PORTS only — never on SQL,
 * HTTP, the accounting module, or the inventory module's SQLite adapter. Stock
 * moves through the costing/stock-ledger engine's ports; the work-order
 * completion posting is handed to a GL posting port that the API turns into a
 * real journal entry.
 */

import type { Money } from "../money/index.js";
import type {
  PostIssueCommand,
  PostIssueResult,
  PostReceiptCommand,
  PostTransferCommand,
  PostTransferResult,
} from "../inventory/index.js";

/** Activation state shared by BOMs and configurable products (docs/archive/catalog/07). */
export type ActivationStatus = "active" | "inactive";

/** أمر التصنيع lifecycle (docs/archive/catalog/07 §Work Orders §Workflows/statuses). */
export type WorkOrderStatus = "planned" | "in_progress" | "completed" | "cancelled";

/**
 * The finer 4-stage machine inside "in_progress" (docs/archive/catalog/07):
 * بدء العمل → صرف المواد → استلام المنتج → إكمال أمر العمل. `not_started`
 * precedes بدء العمل (a freshly-planned order).
 */
export type WorkOrderStage =
  | "not_started"
  | "started"
  | "materials_issued"
  | "product_received"
  | "completed";

/** أولوية أمر العمل (docs/archive/catalog/07 — الأولوية, default عادية). */
export type WorkOrderPriority = "low" | "normal" | "high";

/** التصنيع المخصص lifecycle (docs/archive/catalog/07 §Config Instances). */
export type ConfigInstanceStatus =
  | "configured"
  | "in_progress"
  | "produced"
  | "closed"
  | "cancelled";

/** طريقة التسعير (docs/archive/catalog/07 §Configurable Products §التسعير). */
export type PricingMethod = "manual" | "formula";

/** سياسة الأصناف (docs/archive/catalog/07 — صنف لكل أمر / صنف لكل مواصفات). */
export type ItemPolicy = "per_order" | "per_spec";

// --- Stock ports (satisfied structurally by StockLedgerService) ------------

/**
 * The stock hooks a work order uses across its stages. All three are called
 * stock-only (no `gl` on the command): the GL is driven separately by the
 * completion posting, exactly as the purchase chain drives receipt vs. invoice
 * separately.
 *
 * `postTransfer` is what gives الإنتاج تحت التشغيل a PHYSICAL address. Issuing
 * raw material used to post a bare OUT of the raw warehouse, so the goods left
 * the system entirely and re-appeared only as a money figure on the order:
 * nobody could walk the shop floor, count what was sitting there, and compare
 * it with a system quantity — there was no system quantity to compare with, and
 * for the whole length of the run the stock sub-ledger sat BELOW GL 1200 by the
 * issued value. Issue is now a transfer (raw → WIP warehouse), and the material
 * only leaves stock when the finished product absorbs it.
 */
export interface ManufacturingStockPort {
  postIssue(command: PostIssueCommand): Promise<PostIssueResult>;
  postReceipt(command: PostReceiptCommand): Promise<void>;
  postTransfer(command: PostTransferCommand): Promise<PostTransferResult>;
}

// --- GL posting hook (no import of the accounting module) -------------------

export interface ManufacturingGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

/**
 * The balanced posting a completed work order hands to whoever posts to the GL
 * (Σ debit === Σ credit). WIP costing capitalises materials + labour + overhead
 * into finished-goods inventory (COGS is deferred to the later sale):
 *
 *   Dr المخزون التام (finished goods) = total WIP cost
 *     Cr المخزون الخام (raw inventory) = material cost issued (net of returns)
 *     Cr العمالة المحمّلة (labour applied) = labour cost
 *     Cr المصاريف المحمّلة (overhead applied) = overhead + logged extra cost
 */
export interface ManufacturingGlPosting {
  readonly sourceDocType: "WORK_ORDER";
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly ManufacturingGlPostingLine[];
  /**
   * The journal entry's own id — what makes the posting idempotent.
   *
   * Omitted, it falls back to one id per work order, which is right only while
   * an order posts ONCE. An order now also posts when scrap is logged and when
   * the product absorbs it, so each of those names its own ref; sharing the
   * completion id made the second posting fail as a duplicate.
   */
  readonly entryRef?: string;
}

export interface ManufacturingGlPostingPort {
  post(posting: ManufacturingGlPosting): Promise<void>;
}

/**
 * GL account mapping for a work-order completion posting. Supplied per confirm
 * (the API derives it from item/tenant defaults); the domain never hardcodes ids.
 */
export interface WorkOrderGlAccounts {
  readonly finishedGoodsAccountId: string;
  readonly rawInventoryAccountId: string;
  readonly laborAppliedAccountId: string;
  readonly overheadAppliedAccountId: string;
  /** Debited for scrap beyond the BOM's waste allowance, at the moment it is logged. */
  readonly abnormalScrapAccountId: string;
  /**
   * إنتاج تحت التشغيل — parks the value of NORMAL scrap between the moment it
   * is destroyed and the moment the product that absorbs it is received.
   *
   * Without it the material's value would be nowhere: the stock ledger has
   * lost it (the material is gone) while the product carrying it does not
   * exist yet, so the inventory sub-ledger would sit below GL 1200 for the
   * rest of the run — the exact divergence class this system refuses.
   */
  readonly wipAccountId: string;
}
