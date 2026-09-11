import { Hono, type Context } from "hono";
import {
  type AllocatableInvoiceRepository,
  Money,
  Qty,
  NextNumberService,
  createPurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  purchaseOrderSubtotal,
  purchaseOrderTotal,
  createGoodsReceipt,
  confirmGoodsReceipt,
  cancelGoodsReceipt,
  goodsReceiptTotalCost,
  buildInvoiceLinesFromReceipt,
  createPurchaseInvoice,
  confirmPurchaseInvoice,
  cancelPurchaseInvoice,
  purchaseInvoiceSubtotal,
  purchaseInvoiceTax,
  purchaseInvoiceTotal,
  PurchaseOrderNotFoundError,
  GoodsReceiptNotFoundError,
  PurchaseInvoiceNotFoundError,
  DuplicatePurchaseDocumentError,
  InvalidPurchaseDocumentError,
  PurchaseDocumentNotDraftError,
  PurchaseOrderNotReceivableError,
  ReceiptRequiredError,
  OverReceiptError,
  PurchaseOrderRequiredError,
  PurchaseItemsAlreadyConsumedError,
  GoodsReceiptAlreadyInvoicedError,
  InvalidJournalEntryError,
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  NegativeStockError,
  UncostedDeficitIssueError,
  CashBalanceWouldGoNegativeError,
  InvalidDocumentError,
  AllocationMismatchError,
  AllocationExceedsError,
  DEFAULT_PURCHASE_POLICY,
  type PurchaseOrder,
  type PurchaseOrderRepository,
  type GoodsReceipt,
  type GoodsReceiptRepository,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceRepository,
  type PurchaseGlAccounts,
  type PurchaseGlPostingPort,
  type PurchaseGlReversalPort,
  type PurchasePolicy,
  type PurchaseStockPostingPort,
  type CostLayerRepository,
  auditBranchFromScope,
  branchScopedAuditSink,
  type AuditSink,
  can,
} from "@mezan/domain";
import {
  createPurchaseOrderSchema,
  createGoodsReceiptSchema,
  createPurchaseInvoiceSchema,
  purchaseInvoiceListQuerySchema,
  purchaseInvoicePaymentSchema,
  type PurchaseInvoiceListQueryDTO,
} from "@mezan/contracts";
import { refuseUnknownItems, type ItemCatalogCheck } from "./item-check.js";
import type { CurrencyCheck } from "./currency-policy.js";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
  branchScopeOf,
  warehouseScopeOf,
  withinScope,} from "./permission-gate.js";

/**
 * Permission-gated routes for the purchase chain (docs/archive/catalog/02), mounted
 * under `/purchases`. Reuses the documented `purchases.*` permission codes
 * (permissions/catalog.ts). Money/Qty serialize as exact decimal strings.
 *
 *   POST /orders                 create draft PO            (purchases.order.create)
 *   POST /orders/:id/confirm     draft → sent               (purchases.order.confirm)
 *   POST /orders/:id/cancel      → cancelled                (purchases.order.cancel)
 *   GET  /orders[/:id]           list / get one             (purchases.order.view)
 *   POST /receipts               create draft GRN (from PO) (purchases.receipt.create)
 *   POST /receipts/:id/confirm   post stock IN, advance PO  (purchases.receipt.confirm)
 *   GET  /receipts[/:id]         list / get one             (purchases.receipt.view)
 *   POST /invoices               create draft PI            (purchases.invoice.create)
 *   POST /invoices/:id/confirm   post GL (+ stock if manual)(purchases.invoice.confirm)
 *   GET  /invoices[/:id]         list / get one             (purchases.invoice.view)
 */
export interface PurchasesRoutesDeps {
  /** Refuses a line naming an item the catalogue does not hold — D38's twin on the purchase side. */
  readonly itemCheck?: ItemCatalogCheck;
  readonly orders: PurchaseOrderRepository;
  readonly receipts: GoodsReceiptRepository;
  readonly invoices: PurchaseInvoiceRepository;
  readonly numbering: NextNumberService;
  readonly stock: PurchaseStockPostingPort;
  readonly gl: PurchaseGlPostingPort;
  readonly accounts: PurchaseGlAccounts;
  readonly allocatable?: AllocatableInvoiceRepository;
  /** Exchange rates, so a foreign-currency invoice posts at the rate of its own date (D24). */
  readonly exchangeRates?: { findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null> };
  /** The tenant's own currency; anything else on a document needs a rate. */
  readonly baseCurrency?: string;
  /** A static value, or a resolver read fresh per request (e.g. off the live tenant settings — no restart needed to apply a toggle). */
  readonly policy?: PurchasePolicy | (() => Promise<PurchasePolicy> | PurchasePolicy);
  /**
   * Item → tax rate % lookup for create-from-receipt auto-fill. Defaults to 0,
   * which is only ever right for a tenant with no VAT — leave it unsupplied and
   * every «من إيصال استلام» invoice records no input VAT at all (D50).
   */
  readonly resolveTaxRate?: (itemId: string) => number | Promise<number>;
  /**
   * Settings §"سياسة المخزون" → `autoGenerateBatchNumbers`: hands a batch
   * number to a receipt line the receiver left blank. Omit and a blank batch
   * stays blank.
   */
  readonly autoBatchNo?: (input: { itemId: string; receiptNumber: string; lineIndex: number }) => Promise<string | null>;
  /** Refuses a document currency the tenant has not enabled (settings §"عام"). */
  readonly currencyCheck?: CurrencyCheck;
  /**
   * Cost-layer lookups the cancel endpoints use for the "sold-item" guard
   * (`trackSoldPurchaseItems`) and the stock-reversal ports use to find the
   * layers a receipt/invoice created. Omit and the two cancel endpoints are
   * not mounted (existing callers that only need create/confirm are unaffected).
   */
  readonly layers?: CostLayerRepository;
  /** GL reversal hook for cancelling a confirmed purchase invoice. Required together with `layers`. */
  readonly glReverse?: PurchaseGlReversalPort;
  /** Append-only audit sink; when present every confirm/cancel below is recorded on the `sensitive` stream. */
  readonly audit?: AuditSink;
  /**
   * Pay a supplier straight off the invoice: creates, confirms and allocates a
   * real سند صرف. Omit it and `POST /invoices/:id/payments` answers 503 rather
   * than flipping the invoice to "paid" with nothing posted behind it — the
   * failure D40 was filed for on the sales side.
   */
  readonly pay?: (input: {
    readonly invoiceId: string;
    readonly invoiceNumber: string;
    readonly supplierId: string;
    readonly branchId: string;
    readonly amount: Money;
    readonly treasuryAccountId: string;
    readonly paymentMethod: "cash" | "bank" | "cheque" | "card" | "wallet";
    readonly date: string;
    readonly referenceNo: string | null;
    readonly memo: string;
    readonly actor?: string;
  }) => Promise<{ voucherId: string; voucherNo: string | null }>;
  readonly now?: () => string;
}

function serializeOrder(o: PurchaseOrder) {
  return {
    id: o.id,
    number: o.number,
    supplierId: o.supplierId,
    date: o.date,
    expectedDeliveryDate: o.expectedDeliveryDate,
    branchId: o.branchId,
    warehouseId: o.warehouseId,
    currency: o.currency,
    notes: o.notes,
    lines: o.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty.toString(),
      unitPrice: l.unitPrice.toString(),
      receivedQty: l.receivedQty.toString(),
    })),
    status: o.status,
    subtotal: purchaseOrderSubtotal(o).toString(),
    total: purchaseOrderTotal(o).toString(),
    createdBy: o.createdBy,
    createdAt: o.createdAt,
  };
}

function serializeReceipt(r: GoodsReceipt) {
  return {
    id: r.id,
    number: r.number,
    purchaseOrderId: r.purchaseOrderId,
    supplierId: r.supplierId,
    warehouseId: r.warehouseId,
    date: r.date,
    notes: r.notes,
    lines: r.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      batchNo: l.batchNo ?? null,
      expiryDate: l.expiryDate ?? null,
    })),
    status: r.status,
    invoiced: r.invoiced,
    totalCost: goodsReceiptTotalCost(r).toString(),
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

function serializeInvoice(inv: PurchaseInvoice, allocated: Money = Money.zero()) {
  /**
   * What supplier-payment vouchers have applied against this invoice, read
   * from the allocation sub-ledger. The purchase invoice carried no payment
   * fields at all, so the list could show what was bought but never what was
   * settled — no مدفوع / مدفوع جزئياً / متأخر state was derivable (R4.1).
   */
  const total = purchaseInvoiceTotal(inv);
  const remaining = Money.fromScaled(total.scaled - allocated.scaled);
  return {
    id: inv.id,
    number: inv.number,
    supplierId: inv.supplierId,
    date: inv.date,
    dueDate: inv.dueDate,
    supplierInvoiceNumber: inv.supplierInvoiceNumber,
    branchId: inv.branchId,
    warehouseId: inv.warehouseId,
    currency: inv.currency,
    fxRate: inv.fxRate ?? null,
    notes: inv.notes,
    receiptId: inv.receiptId,
    lines: inv.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      kind: l.kind,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      taxRatePercent: l.taxRatePercent,
      batchNo: l.batchNo ?? null,
      expiryDate: l.expiryDate ?? null,
    })),
    status: inv.status,
    subtotal: purchaseInvoiceSubtotal(inv).toString(),
    tax: purchaseInvoiceTax(inv).toString(),
    total: total.toString(),
    amountPaid: allocated.toString(),
    remainingBalance: remaining.toString(),
    createdBy: inv.createdBy,
    createdAt: inv.createdAt,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (
    err instanceof PurchaseOrderNotFoundError ||
    err instanceof GoodsReceiptNotFoundError ||
    err instanceof PurchaseInvoiceNotFoundError
  ) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicatePurchaseDocumentError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof PurchaseDocumentNotDraftError ||
    err instanceof PurchaseOrderNotReceivableError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidPurchaseDocumentError ||
    err instanceof ReceiptRequiredError ||
    err instanceof OverReceiptError ||
    err instanceof PurchaseOrderRequiredError ||
    err instanceof PurchaseItemsAlreadyConsumedError ||
    err instanceof GoodsReceiptAlreadyInvoicedError
  ) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        reasons: err instanceof InvalidPurchaseDocumentError ? err.reasons : undefined,
      },
      422,
    );
  }
  // Thrown by the GL port inside the confirm, not by the purchase domain — the
  // sales, voucher and journal routes all map these; leaving them out here made
  // a closed period answer 500 on this one module alone (D20).
  if (
    err instanceof InvalidJournalEntryError ||
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof NegativeStockError ||
    err instanceof UncostedDeficitIssueError ||
    // Raised by the voucher engine behind `POST /invoices/:id/payments` — the
    // same D20 shape: a refusal the caller can act on must not answer 500.
    err instanceof CashBalanceWouldGoNegativeError ||
    err instanceof InvalidDocumentError ||
    err instanceof AllocationMismatchError ||
    err instanceof AllocationExceedsError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

export function createPurchasesRoutes(
  deps: PurchasesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const resolvePolicy = async (): Promise<PurchasePolicy> => {
    if (!deps.policy) return DEFAULT_PURCHASE_POLICY;
    return typeof deps.policy === "function" ? await deps.policy() : deps.policy;
  };
  const resolveTaxRate = deps.resolveTaxRate ?? (() => 0);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";
  /**
   * The audit sink stamped with the branch the caller is working in — read off
   * the same `x-branch-scope` the permission gate already resolved, never a
   * second mechanism. Unnarrowed requests record no branch rather than a guess.
   */
  const audit = (c: Context): AuditSink | undefined => {
    if (!deps.audit) return undefined;
    const ctx = getAuthContext(c);
    return branchScopedAuditSink(deps.audit, ctx ? auditBranchFromScope(ctx.branchScope) : null);
  };

  // --- Purchase Orders -----------------------------------------------------

  interface OrderListFilter {
    readonly status?: string;
    readonly supplierId?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly branchId?: string;
    readonly warehouseId?: string;
    readonly search?: string;
  }

  function parseOrderListQuery(c: Context): OrderListFilter {
    const status = c.req.query("status");
    return {
      status: status && status !== "all" ? status : undefined,
      supplierId: c.req.query("supplierId") || undefined,
      fromDate: c.req.query("fromDate") || undefined,
      toDate: c.req.query("toDate") || undefined,
      branchId: c.req.query("branchId") || undefined,
      warehouseId: c.req.query("warehouseId") || undefined,
      search: c.req.query("search") || undefined,
    };
  }

  /**
   * The single filter the order rows, the chip counts and the KPI strip all go
   * through (R1.1). The screen narrowed by branch, warehouse, supplier, date
   * and free text in the browser while its four tiles were computed over every
   * order the server had sent, so applying a filter moved the rows and left the
   * header alone.
   *
   * `branchId`/`warehouseId`/`supplierId`/`search` are presentation filters over
   * an already-scoped set — the scopes below still decide what this user may see
   * at all, and no query parameter widens them.
   */
  async function listFilteredOrders(c: Context, filter: OrderListFilter): Promise<readonly PurchaseOrder[]> {
    // Branch AND warehouse (R1.14): a purchase order receives into a
    // warehouse, so the header's warehouse selector has to narrow it.
    let rows = withinScope(
      withinScope(await deps.orders.list(), branchScopeOf(c), (o) => o.branchId),
      warehouseScopeOf(c),
      (o) => o.warehouseId,
    );
    if (filter.status) rows = rows.filter((o) => o.status === filter.status);
    if (filter.supplierId) rows = rows.filter((o) => o.supplierId === filter.supplierId);
    if (filter.fromDate) rows = rows.filter((o) => o.date >= filter.fromDate!);
    if (filter.toDate) rows = rows.filter((o) => o.date <= filter.toDate!);
    if (filter.branchId) rows = rows.filter((o) => o.branchId === filter.branchId);
    if (filter.warehouseId) rows = rows.filter((o) => o.warehouseId === filter.warehouseId);
    const term = filter.search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter((o) => o.number.toLowerCase().includes(term) || o.supplierId.toLowerCase().includes(term));
    }
    return rows;
  }

  app.get("/orders", gate("purchases.order.view"), async (c) => {
    return c.json((await listFilteredOrders(c, parseOrderListQuery(c))).map(serializeOrder));
  });

  /**
   * The status chips. Deliberately ignores its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero. Every other filter applies.
   */
  app.get("/orders/counts", gate("purchases.order.view"), async (c) => {
    const { status: _status, ...withoutStatus } = parseOrderListQuery(c);
    const rows = await listFilteredOrders(c, withoutStatus);
    const counts: Record<string, number> = {
      all: rows.length,
      draft: 0,
      sent: 0,
      partially_received: 0,
      fully_received: 0,
      cancelled: 0,
    };
    for (const order of rows) counts[order.status] = (counts[order.status] ?? 0) + 1;
    return c.json(counts);
  });

  /** The KPI strip, summed in `Money` over the whole filtered set (R1.1). */
  app.get("/orders/stats", gate("purchases.order.view"), async (c) => {
    const rows = await listFilteredOrders(c, parseOrderListQuery(c));
    let sent = 0;
    let received = 0;
    let value = Money.zero();
    for (const order of rows) {
      if (order.status === "sent") sent += 1;
      if (order.status === "fully_received") received += 1;
      // A cancelled order commits nothing, so it must not inflate the value of
      // the order book the strip reports.
      if (order.status !== "cancelled") value = value.add(purchaseOrderSubtotal(order));
    }
    return c.json({ count: rows.length, sent, received, value: value.toString() });
  });

  app.get("/orders/:id", gate("purchases.order.view"), async (c) => {
    const order = await deps.orders.findById(c.req.param("id"));
    if (!order) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeOrder(order));
  });

  app.post("/orders", gate("purchases.order.create"), async (c) => {
    const parsed = createPurchaseOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const orderCurrencyRefusal = await deps.currencyCheck?.(parsed.data.currency);
    if (orderCurrencyRefusal) return c.json({ error: "CURRENCY_NOT_ALLOWED", message: orderCurrencyRefusal }, 422);
    const orderItemRefusal = await refuseUnknownItems(c, deps.itemCheck, parsed.data.lines.map((l) => l.itemId));
    if (orderItemRefusal) return orderItemRefusal;
    try {
      const order = await createPurchaseOrder(
        {
          ...parsed.data,
          createdBy: actor(c),
          lines: parsed.data.lines.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            qty: Qty.fromMajor(l.qty),
            unitPrice: Money.fromMajor(l.unitPrice),
          })),
        },
        { orders: deps.orders, numbering: deps.numbering, now: deps.now },
      );
      return c.json(serializeOrder(order), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/orders/:id/confirm", gate("purchases.order.confirm"), async (c) => {
    try {
      const order = await confirmPurchaseOrder(c.req.param("id"), {
        orders: deps.orders,
        audit: audit(c),
        actor: actor(c),
      });
      return c.json(serializeOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/orders/:id/cancel", gate("purchases.order.cancel"), async (c) => {
    try {
      const order = await cancelPurchaseOrder(c.req.param("id"), {
        orders: deps.orders,
        audit: audit(c),
        actor: actor(c),
      });
      return c.json(serializeOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Goods Receipts ------------------------------------------------------

  interface ReceiptListFilter {
    readonly status?: string;
    readonly supplierId?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly warehouseId?: string;
    readonly invoiced?: boolean;
    readonly search?: string;
  }

  function parseReceiptListQuery(c: Context): ReceiptListFilter {
    const status = c.req.query("status");
    const invoiced = c.req.query("invoiced");
    return {
      status: status && status !== "all" ? status : undefined,
      supplierId: c.req.query("supplierId") || undefined,
      fromDate: c.req.query("fromDate") || undefined,
      toDate: c.req.query("toDate") || undefined,
      warehouseId: c.req.query("warehouseId") || undefined,
      invoiced: invoiced === undefined || invoiced === "" ? undefined : invoiced === "true",
      search: c.req.query("search") || undefined,
    };
  }

  /**
   * The single filter the receipt rows, the chip counts and the KPI strip all
   * go through (R1.1). A goods receipt carries no branch of its own — the
   * warehouse is what it is attributable to, which is why the screen's branch
   * selector must reach here as a `warehouseId`.
   */
  async function listFilteredReceipts(c: Context, filter: ReceiptListFilter): Promise<readonly GoodsReceipt[]> {
    let rows = withinScope(await deps.receipts.list(), warehouseScopeOf(c), (r) => r.warehouseId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.supplierId) rows = rows.filter((r) => r.supplierId === filter.supplierId);
    if (filter.fromDate) rows = rows.filter((r) => r.date >= filter.fromDate!);
    if (filter.toDate) rows = rows.filter((r) => r.date <= filter.toDate!);
    if (filter.warehouseId) rows = rows.filter((r) => r.warehouseId === filter.warehouseId);
    if (filter.invoiced !== undefined) rows = rows.filter((r) => r.invoiced === filter.invoiced);
    const term = filter.search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) => r.number.toLowerCase().includes(term) || r.supplierId.toLowerCase().includes(term));
    }
    return rows;
  }

  app.get("/receipts", gate("purchases.receipt.view"), async (c) => {
    return c.json((await listFilteredReceipts(c, parseReceiptListQuery(c))).map(serializeReceipt));
  });

  /**
   * The status chips. Deliberately ignores its own `status` axis — and the
   * invoiced/not-invoiced axis beside it — because a chip states how many rows
   * it WOULD show; counting the already-filtered set renders every chip but the
   * active one as zero. Every other filter still applies.
   */
  app.get("/receipts/counts", gate("purchases.receipt.view"), async (c) => {
    const { status: _status, invoiced: _invoiced, ...withoutStatus } = parseReceiptListQuery(c);
    const rows = await listFilteredReceipts(c, withoutStatus);
    const counts: Record<string, number> = {
      all: rows.length,
      draft: 0,
      confirmed: 0,
      cancelled: 0,
      invoiced: 0,
      uninvoiced: 0,
    };
    for (const receipt of rows) {
      counts[receipt.status] = (counts[receipt.status] ?? 0) + 1;
      if (receipt.invoiced) counts.invoiced! += 1;
      else counts.uninvoiced! += 1;
    }
    return c.json(counts);
  });

  /** The KPI strip, summed in `Money` over the whole filtered set (R1.1). */
  app.get("/receipts/stats", gate("purchases.receipt.view"), async (c) => {
    const rows = await listFilteredReceipts(c, parseReceiptListQuery(c));
    let confirmed = 0;
    let uninvoiced = 0;
    let value = Money.zero();
    for (const receipt of rows) {
      if (!receipt.invoiced) uninvoiced += 1;
      // Only a confirmed receipt has taken stock in, so a draft's or a
      // cancelled receipt's cost is not value received.
      if (receipt.status !== "confirmed") continue;
      confirmed += 1;
      value = value.add(goodsReceiptTotalCost(receipt));
    }
    return c.json({ count: rows.length, confirmed, uninvoiced, value: value.toString() });
  });

  app.get("/receipts/:id", gate("purchases.receipt.view"), async (c) => {
    const receipt = await deps.receipts.findById(c.req.param("id"));
    if (!receipt) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeReceipt(receipt));
  });

  app.post("/receipts", gate("purchases.receipt.create"), async (c) => {
    const parsed = createGoodsReceiptSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const receiptItemRefusal = await refuseUnknownItems(c, deps.itemCheck, (parsed.data.lines ?? []).map((l) => l.itemId));
    if (receiptItemRefusal) return receiptItemRefusal;
    try {
      const receipt = await createGoodsReceipt(
        {
          id: parsed.data.id,
          purchaseOrderId: parsed.data.purchaseOrderId,
          date: parsed.data.date,
          notes: parsed.data.notes,
          createdBy: actor(c),
          supplierId: parsed.data.supplierId,
          warehouseId: parsed.data.warehouseId,
          lines: parsed.data.lines?.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            qty: Qty.fromMajor(l.qty),
            unitCost: Money.fromMajor(l.unitCost),
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
          })),
        },
        {
          receipts: deps.receipts,
          orders: deps.orders,
          numbering: deps.numbering,
          policy: await resolvePolicy(),
          autoBatchNo: deps.autoBatchNo,
          now: deps.now,
        },
      );
      return c.json(serializeReceipt(receipt), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/receipts/:id/confirm", gate("purchases.receipt.confirm"), async (c) => {
    try {
      const receipt = await confirmGoodsReceipt(c.req.param("id"), {
        receipts: deps.receipts,
        orders: deps.orders,
        stock: deps.stock,
        gl: deps.gl,
        accounts: deps.accounts,
        audit: audit(c),
        actor: actor(c),
        now: deps.now,
      });
      return c.json(serializeReceipt(receipt));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  if (deps.layers) {
    const layers = deps.layers;
    app.post("/receipts/:id/cancel", gate("purchases.receipt.void"), async (c) => {
      try {
        const receipt = await cancelGoodsReceipt(c.req.param("id"), {
          receipts: deps.receipts,
          orders: deps.orders,
          stock: deps.stock,
          layers,
          policy: await resolvePolicy(),
          audit: audit(c),
          actor: actor(c),
          now: deps.now,
        });
        return c.json(serializeReceipt(receipt));
      } catch (err) {
        return handleDomainError(c, err);
      }
    });
  }

  // --- Purchase Invoices ---------------------------------------------------

  /** Allocated-against-invoice amounts from the treasury sub-ledger, keyed by invoice id. */
  async function allocatedByInvoice(ids: readonly string[]): Promise<ReadonlyMap<string, Money>> {
    const out = new Map<string, Money>();
    if (!deps.allocatable) return out;
    const rows = await Promise.all(ids.map((id) => deps.allocatable!.findById(id)));
    for (const row of rows) if (row) out.set(row.id, row.allocated);
    return out;
  }

  function parseInvoiceListQuery(c: Context) {
    return purchaseInvoiceListQuerySchema.safeParse({
      status: c.req.query("status"),
      supplierId: c.req.query("supplierId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
      branchId: c.req.query("branchId"),
      warehouseId: c.req.query("warehouseId"),
      search: c.req.query("search"),
    });
  }

  interface FilteredInvoices {
    readonly rows: readonly PurchaseInvoice[];
    readonly allocations: ReadonlyMap<string, Money>;
  }

  /**
   * The payment states the list filters and counts by. They are derived from
   * the allocation sub-ledger — the only place a supplier payment is recorded
   * — rather than stored on the invoice, so they must be computed in exactly
   * one place or the rows, the chips and the KPI strip will disagree.
   */
  function paymentStateOf(inv: PurchaseInvoice, allocated: Money, today: string, horizon: string) {
    const total = purchaseInvoiceTotal(inv);
    const remaining = total.scaled - allocated.scaled;
    const live = inv.status === "confirmed";
    const settled = remaining <= 0n;
    return {
      overdue: live && !settled && inv.dueDate !== null && inv.dueDate < today,
      dueSoon: live && !settled && inv.dueDate !== null && inv.dueDate >= today && inv.dueDate <= horizon,
      partiallyPaid: live && allocated.scaled > 0n && !settled,
      paid: live && settled,
    };
  }

  function paymentHorizon(today: string): string {
    const base = new Date(`${today}T00:00:00.000Z`);
    return new Date(base.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  }

  async function listFilteredInvoices(c: Context, filter: PurchaseInvoiceListQueryDTO): Promise<FilteredInvoices> {
    let rows = withinScope(
      withinScope(await deps.invoices.list(), branchScopeOf(c), (i) => i.branchId),
      warehouseScopeOf(c),
      (i) => i.warehouseId,
    );
    const { status, supplierId, fromDate, toDate, branchId, warehouseId, search } = filter;
    if (supplierId) rows = rows.filter((inv) => inv.supplierId === supplierId);
    if (fromDate) rows = rows.filter((inv) => inv.date >= fromDate);
    if (toDate) rows = rows.filter((inv) => inv.date <= toDate);
    if (branchId) rows = rows.filter((inv) => inv.branchId === branchId);
    if (warehouseId) rows = rows.filter((inv) => inv.warehouseId === warehouseId);
    const term = search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (inv) =>
          inv.number.toLowerCase().includes(term) || (inv.supplierInvoiceNumber ?? "").toLowerCase().includes(term),
      );
    }

    const allocations = await allocatedByInvoice(rows.map((i) => i.id));
    if (status && status !== "all") {
      const today = (deps.now?.() ?? new Date().toISOString()).slice(0, 10);
      const horizon = paymentHorizon(today);
      rows = rows.filter((inv) => {
        const state = paymentStateOf(inv, allocations.get(inv.id) ?? Money.zero(), today, horizon);
        switch (status) {
          case "overdue":
            return state.overdue;
          case "due_soon":
            return state.dueSoon;
          case "partially_paid":
            return state.partiallyPaid;
          case "paid":
            return state.paid;
          default:
            return inv.status === status;
        }
      });
    }
    return { rows, allocations };
  }

  app.get("/invoices", gate("purchases.invoice.view"), async (c) => {
    const parsed = parseInvoiceListQuery(c);
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const { rows, allocations } = await listFilteredInvoices(c, parsed.data);
    return c.json(rows.map((inv) => serializeInvoice(inv, allocations.get(inv.id))));
  });

  /** Chip counts over the whole filtered set, ignoring the status filter (R1.1). */
  app.get("/invoices/counts", gate("purchases.invoice.view"), async (c) => {
    const parsed = parseInvoiceListQuery(c);
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const { status: _ignored, ...withoutStatus } = parsed.data;
    const { rows, allocations } = await listFilteredInvoices(c, withoutStatus);
    const today = (deps.now?.() ?? new Date().toISOString()).slice(0, 10);
    const horizon = paymentHorizon(today);

    const counts: Record<string, number> = {
      all: rows.length,
      draft: 0,
      confirmed: 0,
      cancelled: 0,
      overdue: 0,
      due_soon: 0,
      partially_paid: 0,
      paid: 0,
    };
    for (const inv of rows) {
      counts[inv.status] = (counts[inv.status] ?? 0) + 1;
      const state = paymentStateOf(inv, allocations.get(inv.id) ?? Money.zero(), today, horizon);
      if (state.overdue) counts.overdue! += 1;
      if (state.dueSoon) counts.due_soon! += 1;
      if (state.partiallyPaid) counts.partially_paid! += 1;
      if (state.paid) counts.paid! += 1;
    }
    return c.json(counts);
  });

  /** The KPI strip, summed in `Money` over the whole filtered set (R1.1). */
  app.get("/invoices/stats", gate("purchases.invoice.view"), async (c) => {
    const parsed = parseInvoiceListQuery(c);
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const { rows, allocations } = await listFilteredInvoices(c, parsed.data);

    let purchases = Money.zero();
    let paid = Money.zero();
    let unpaid = Money.zero();
    let count = 0;
    for (const inv of rows) {
      if (inv.status !== "confirmed") continue;
      const total = purchaseInvoiceTotal(inv);
      const allocated = allocations.get(inv.id) ?? Money.zero();
      count += 1;
      purchases = purchases.add(total);
      paid = paid.add(allocated);
      // A credit balance on one invoice must not cancel what another still
      // owes — "unpaid" is what is outstanding, not a net position.
      const remaining = total.scaled - allocated.scaled;
      if (remaining > 0n) unpaid = unpaid.add(Money.fromScaled(remaining));
    }
    return c.json({
      count,
      purchases: purchases.toString(),
      paid: paid.toString(),
      unpaid: unpaid.toString(),
    });
  });

  app.get("/invoices/:id", gate("purchases.invoice.view"), async (c) => {
    const invoice = await deps.invoices.findById(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeInvoice(invoice, (await allocatedByInvoice([invoice.id])).get(invoice.id)));
  });

  /**
   * What each inventory line delivered and what is left of it (R4.4).
   *
   * The figures are derived from the cost layers the FUNDING document created —
   * the goods receipt for a «من إيصال استلام» invoice, the invoice itself for a
   * manual one — because that is where the stock ledger records the truth. A
   * fully drawn-down layer is deleted rather than kept at zero, so "consumed"
   * is measured as received minus what still remains, never as a sum over
   * surviving layers.
   */
  app.get("/invoices/:id/fulfilment", gate("purchases.invoice.view"), async (c) => {
    const invoice = await deps.invoices.findById(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);

    const receipt = invoice.receiptId ? await deps.receipts.findById(invoice.receiptId) : null;
    const sourceDocId = receipt ? receipt.id : invoice.status === "confirmed" ? invoice.id : null;
    const sourceDocType = receipt ? "GOODS_RECEIPT" : invoice.status === "confirmed" ? "PURCHASE_INVOICE" : null;

    const receivedByItem = new Map<string, Qty>();
    if (receipt) {
      for (const l of receipt.lines) {
        receivedByItem.set(l.itemId, (receivedByItem.get(l.itemId) ?? Qty.zero()).add(l.qty));
      }
    }

    const remainingByItem = new Map<string, Qty>();
    if (deps.layers && sourceDocId) {
      const itemIds = [...new Set(invoice.lines.filter((l) => l.itemId !== null).map((l) => l.itemId as string))];
      for (const itemId of itemIds) {
        const layers = await deps.layers.listByPosition(itemId, invoice.warehouseId);
        const mine = layers.filter((l) => l.sourceDocId === sourceDocId);
        remainingByItem.set(itemId, mine.reduce((sum, l) => sum.add(l.remainingQty), Qty.zero()));
      }
    }

    /** Split a per-item figure back over the lines that share that item, largest line first, without inventing quantity. */
    const takenByItem = new Map<string, Qty>();
    const shareOf = (itemId: string, lineQty: Qty, pool: Qty): Qty => {
      const alreadyTaken = takenByItem.get(itemId) ?? Qty.zero();
      const left = pool.compare(alreadyTaken) > 0 ? pool.subtract(alreadyTaken) : Qty.zero();
      const share = left.compare(lineQty) > 0 ? lineQty : left;
      takenByItem.set(itemId, alreadyTaken.add(share));
      return share;
    };

    const lines = invoice.lines.map((line, lineIndex) => {
      if (line.kind !== "inventory" || line.itemId === null) {
        return {
          lineIndex,
          itemId: line.itemId,
          invoicedQty: line.qty.toString(),
          receivedQty: Qty.zero().toString(),
          consumedQty: Qty.zero().toString(),
          remainingQty: Qty.zero().toString(),
        };
      }
      const itemId = line.itemId;
      // A manual invoice IS the receiving document, so it has received nothing until it is confirmed.
      const receivedPool = receipt ? (receivedByItem.get(itemId) ?? Qty.zero()) : sourceDocId ? line.qty : Qty.zero();
      const received = receipt ? shareOf(`recv:${itemId}`, line.qty, receivedPool) : receivedPool;
      const remainingPool = remainingByItem.get(itemId) ?? Qty.zero();
      const remaining = shareOf(`rem:${itemId}`, received, remainingPool);
      const consumed = received.compare(remaining) > 0 ? received.subtract(remaining) : Qty.zero();
      return {
        lineIndex,
        itemId,
        invoicedQty: line.qty.toString(),
        receivedQty: received.toString(),
        consumedQty: consumed.toString(),
        remainingQty: remaining.toString(),
      };
    });

    return c.json({ invoiceId: invoice.id, sourceDocId, sourceDocType, lines });
  });

  /**
   * سداد للمورد straight off the invoice (R4.4). A status that says money moved
   * must be backed by a posting: this creates, confirms and allocates a real
   * supplier-payment voucher, so the treasury account, GL 2100 and the
   * allocation sub-ledger all move together.
   */
  app.post("/invoices/:id/payments", gate("purchases.invoice.edit"), async (c) => {
    const parsed = purchaseInvoicePaymentSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (!deps.pay) {
      return c.json(
        { error: "PAYMENT_UNAVAILABLE", message: "السداد يتطلب سند صرف؛ وحدة الخزينة غير مفعّلة." },
        503,
      );
    }
    const invoice = await deps.invoices.findById(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);
    if (invoice.status !== "confirmed") {
      return c.json(
        { error: "INVOICE_NOT_PAYABLE", message: "لا يمكن السداد إلا على فاتورة مؤكدة." },
        422,
      );
    }
    const amount = Money.fromMajor(parsed.data.amount);
    if (amount.scaled <= 0n) {
      return c.json({ error: "INVALID_PAYMENT", message: "قيمة السداد يجب أن تكون أكبر من صفر." }, 422);
    }
    const allocated = (await allocatedByInvoice([invoice.id])).get(invoice.id) ?? Money.zero();
    const remaining = purchaseInvoiceTotal(invoice).scaled - allocated.scaled;
    if (amount.scaled > remaining) {
      return c.json(
        { error: "PAYMENT_EXCEEDS_BALANCE", message: "قيمة السداد أكبر من المتبقي على الفاتورة." },
        422,
      );
    }
    try {
      const { voucherId, voucherNo } = await deps.pay({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        supplierId: invoice.supplierId,
        branchId: invoice.branchId,
        amount,
        treasuryAccountId: parsed.data.treasuryAccountId,
        paymentMethod: parsed.data.paymentMethod ?? "cash",
        // A payment happens when it happens — dating it back to the invoice
        // would measure the treasury's balance on the wrong day.
        date: parsed.data.date ?? (deps.now?.() ?? new Date().toISOString()).slice(0, 10),
        referenceNo: parsed.data.referenceNo ?? null,
        memo: parsed.data.notes ?? `سداد على الفاتورة ${invoice.number}`,
        actor: actor(c),
      });
      const settled = (await allocatedByInvoice([invoice.id])).get(invoice.id);
      return c.json({ ...serializeInvoice(invoice, settled), voucherId, voucherNo });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/invoices", gate("purchases.invoice.create"), async (c) => {
    const parsed = createPurchaseInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const invoiceCurrencyRefusal = await deps.currencyCheck?.(parsed.data.currency);
    if (invoiceCurrencyRefusal) return c.json({ error: "CURRENCY_NOT_ALLOWED", message: invoiceCurrencyRefusal }, 422);
    // Only caller-supplied lines are checked: an expense or freight line carries
    // no item at all, and a from-receipt build reuses ids already in the books.
    const invoiceItemRefusal = await refuseUnknownItems(
      c,
      deps.itemCheck,
      (parsed.data.lines ?? []).map((l) => l.itemId).filter((id): id is string => typeof id === "string" && id !== ""),
    );
    if (invoiceItemRefusal) return invoiceItemRefusal;
    try {
      // create-from-receipt: auto-fill lines from a confirmed receipt when omitted.
      let lines: PurchaseInvoiceLine[] | undefined;
      if (parsed.data.lines && parsed.data.receiptId) {
        /*
         * An invoice that NAMES a receipt and then states its own costs was
         * never checked against it (D88): the supplier's figure went straight
         * into the books, revalued the stock, and nothing said the goods had
         * been received at a different price.
         *
         * A real price difference is legitimate — that is what the price
         * variance account exists for — so this is a GATE, not a refusal:
         * restating a received cost needs `purchases.receipt.edit_cost`, the
         * same grant that lets someone change the cost on the receipt itself.
         * Without it the receipt's cost stands.
         */
        const receipt = await deps.receipts.findById(parsed.data.receiptId);
        if (!receipt) throw new GoodsReceiptNotFoundError(parsed.data.receiptId);
        const receivedCost = new Map(receipt.lines.map((l) => [l.itemId, l.unitCost.toString()]));
        const restated = parsed.data.lines.filter((l) => {
          if (!l.itemId) return false;
          const received = receivedCost.get(l.itemId);
          return received !== undefined && received !== Money.fromMajor(l.unitCost).toString();
        });
        const ctx = getAuthContext(c);
        if (restated.length > 0 && !(ctx && can(ctx, "purchases.receipt.edit_cost"))) {
          return c.json(
            {
              error: "PERMISSION_DENIED",
              permission: "purchases.receipt.edit_cost",
              items: restated.map((l) => l.itemId),
              message: "تكلفة الفاتورة تختلف عن تكلفة الاستلام، وتعديلها يتطلب صلاحية تعديل تكلفة الاستلام.",
            },
            403,
          );
        }
      }
      if (parsed.data.lines) {
        lines = parsed.data.lines.map((l) => ({
          itemId: l.itemId ?? null,
          description: l.description ?? null,
          kind: l.kind ?? "inventory",
          qty: Qty.fromMajor(l.qty),
          unitCost: Money.fromMajor(l.unitCost),
          taxRatePercent: l.taxRatePercent ?? 0,
          batchNo: l.batchNo ?? null,
          expiryDate: l.expiryDate ?? null,
        }));
      } else if (parsed.data.receiptId) {
        const receipt = await deps.receipts.findById(parsed.data.receiptId);
        if (!receipt) throw new GoodsReceiptNotFoundError(parsed.data.receiptId);
        // The domain builder is pure and synchronous, so the per-item rates are
        // resolved here first and handed to it as a plain lookup.
        const rates = new Map<string, number>();
        for (const line of receipt.lines) {
          if (!rates.has(line.itemId)) rates.set(line.itemId, await resolveTaxRate(line.itemId));
        }
        lines = buildInvoiceLinesFromReceipt(receipt, (itemId) => rates.get(itemId) ?? 0);
      } else {
        return c.json({ error: "VALIDATION_ERROR", message: "lines or receiptId is required" }, 400);
      }

      const invoice = await createPurchaseInvoice(
        {
          id: parsed.data.id,
          supplierId: parsed.data.supplierId,
          date: parsed.data.date,
          dueDate: parsed.data.dueDate,
          supplierInvoiceNumber: parsed.data.supplierInvoiceNumber,
          branchId: parsed.data.branchId,
          warehouseId: parsed.data.warehouseId,
          currency: parsed.data.currency,
          notes: parsed.data.notes,
          receiptId: parsed.data.receiptId,
          createdBy: actor(c),
          lines,
        },
        {
          invoices: deps.invoices,
          receipts: deps.receipts,
          numbering: deps.numbering,
          policy: await resolvePolicy(),
          now: deps.now,
        },
      );
      return c.json(serializeInvoice(invoice), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/invoices/:id/confirm", gate("purchases.invoice.confirm"), async (c) => {
    try {
      const { invoice } = await confirmPurchaseInvoice(c.req.param("id"), {
        invoices: deps.invoices,
        receipts: deps.receipts,
        stock: deps.stock,
        gl: deps.gl,
        accounts: deps.accounts,
        allocatable: deps.allocatable,
        exchangeRates: deps.exchangeRates,
        baseCurrency: deps.baseCurrency,
        audit: audit(c),
        actor: actor(c),
        now: deps.now,
      });
      return c.json(serializeInvoice(invoice));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  if (deps.layers && deps.glReverse) {
    const layers = deps.layers;
    const glReverse = deps.glReverse;
    app.post("/invoices/:id/cancel", gate("purchases.invoice.void"), async (c) => {
      try {
        const invoice = await cancelPurchaseInvoice(c.req.param("id"), {
          invoices: deps.invoices,
          stock: deps.stock,
          glReverse,
          layers,
          policy: await resolvePolicy(),
          audit: audit(c),
          actor: actor(c),
          now: deps.now,
        });
        return c.json(serializeInvoice(invoice));
      } catch (err) {
        return handleDomainError(c, err);
      }
    });
  }

  return app;
}
