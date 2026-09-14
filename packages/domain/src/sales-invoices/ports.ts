/**
 * Ports for the sales-invoice module. The domain depends only on these
 * interfaces — never on SQL, HTTP, or the GL/stock engines (docs/archive/plan.md §3.2).
 * The GL and workflow hooks reuse the document framework's hook ports verbatim;
 * the stock issue hook is sales-specific because it must return the cost of
 * goods sold so a single combined journal entry (revenue + COGS) can be posted.
 */

import type { Money, Qty } from "../money/index.js";
import type { AppliedSalesInvoicePromotion, SalesInvoice, SalesInvoiceLine } from "./sales-invoice.js";

/** Persistence port for sales invoices, keyed by id. */
export interface SalesInvoiceRepository {
  save(invoice: SalesInvoice): Promise<void>;
  update(invoice: SalesInvoice): Promise<void>;
  findById(id: string): Promise<SalesInvoice | null>;
  /**
   * The document NUMBER, which is what a URL carries — `#/sell/sales-invoices/
   * INV-000001`. Once the list is a page rather than the whole table, a deep
   * link can no longer be resolved by searching the rows that happen to be
   * loaded.
   */
  findByDocNo(docNo: string): Promise<SalesInvoice | null>;
  list(filter?: SalesInvoiceListFilter): Promise<readonly SalesInvoice[]>;
  /** How many invoices the same filter matches, ignoring `limit`/`offset`. */
  count(filter?: SalesInvoiceListFilter): Promise<number>;
  /** Run `fn` in one atomic transaction. In-memory implementations may just call `fn`. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface SalesInvoiceListFilter {
  readonly status?: SalesInvoice["status"];
  readonly customerId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  /**
   * The caller's SCOPE — the branches and warehouses they may see at all,
   * absent meaning all of them. Only a resolved session may populate these,
   * and an EMPTY array means "nothing", never "everything".
   *
   * A row with no id on the scoping dimension is not attributable, so it stays
   * visible under a narrowed scope; that is the rule `withinScope` has always
   * applied and it is why scope is separate from the filters below.
   */
  readonly branchScope?: readonly string[];
  readonly warehouseScope?: readonly string[];
  /** Presentation filters the user picked. Strict equality — a null does not match. */
  readonly branchId?: string;
  readonly warehouseId?: string;
  readonly salespersonId?: string;
  /** Substring of the document number or the customer name. */
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** One line of stock to issue OUT on confirm. */
export interface SalesInvoiceIssueLine {
  readonly itemId: string;
  readonly qty: Qty;
}

export interface SalesInvoiceStockIssue {
  readonly issueId: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly warehouseId: string;
  /**
   * بُعد المشروع, carried onto the stock-issue plan so a stock hook that
   * threads it into the inventory engine's own issue command (once that
   * command carries the field) has it in hand without another lookup. NOT
   * forwarded to `StockLedgerService.postIssue` yet — its command type does
   * not carry `projectId`.
   */
  readonly projectId?: string | null;
  readonly occurredAt: string;
  readonly lines: readonly SalesInvoiceIssueLine[];
}

export interface SalesInvoiceIssuedLineCost {
  readonly itemId: string;
  readonly unitCost: Money;
  readonly cost: Money;
}

export interface SalesInvoiceStockResult {
  readonly totalCost: Money;
  readonly lines: readonly SalesInvoiceIssuedLineCost[];
}

/**
 * Issues stock OUT for a confirming invoice and returns the moving-average cost
 * of what left, so the service can post Dr COGS / Cr Inventory in the same
 * journal entry as the revenue. Bound to the stock-ledger engine's `postIssue`.
 */
export interface SalesInvoiceStockHook {
  issue(plan: SalesInvoiceStockIssue): Promise<SalesInvoiceStockResult>;
}

/**
 * Resolves a customer's outstanding balance for credit control (docs/archive/catalog/01
 * §"الحد الائتماني"): the sum of (grandTotal − amountPaid) across their live
 * (confirmed/partially_paid) invoices. Bound to the sales-invoice repository
 * itself — see {@link createSalesInvoiceCustomerExposureHook} — so the service
 * never depends on the customer/AR sub-ledger directly.
 */
export interface SalesInvoiceCustomerExposureHook {
  currentBalance(customerId: string, excludeInvoiceId?: string): Promise<Money>;
}

export interface SalesInvoicePromotionRequest {
  readonly lines: readonly SalesInvoiceLine[];
  readonly date: string;
  readonly couponCode: string | null;
}

/**
 * Runs the promotion engine against a confirming invoice and returns the
 * snapshot to stamp onto it. Bound to the promotion repository — see
 * {@link createSalesInvoicePromotionHook} — so the invoice module never
 * depends on the promotions module's write surface.
 */
export interface SalesInvoicePromotionHook {
  evaluate(request: SalesInvoicePromotionRequest): Promise<AppliedSalesInvoicePromotion | null>;
}
