import { Hono, type Context } from "hono";
import {
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
  goodsReceiptTotalCost,
  buildInvoiceLinesFromReceipt,
  createPurchaseInvoice,
  confirmPurchaseInvoice,
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
  type PurchasePolicy,
  type PurchaseStockPostingPort,
} from "@mezan/domain";
import {
  createPurchaseOrderSchema,
  createGoodsReceiptSchema,
  createPurchaseInvoiceSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/**
 * Permission-gated routes for the purchase chain (docs/catalog/02), mounted
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
  readonly orders: PurchaseOrderRepository;
  readonly receipts: GoodsReceiptRepository;
  readonly invoices: PurchaseInvoiceRepository;
  readonly numbering: NextNumberService;
  readonly stock: PurchaseStockPostingPort;
  readonly gl: PurchaseGlPostingPort;
  readonly accounts: PurchaseGlAccounts;
  readonly policy?: PurchasePolicy;
  /** Item → tax rate % lookup for create-from-receipt auto-fill. Defaults to 0. */
  readonly resolveTaxRate?: (itemId: string) => number;
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
    })),
    status: r.status,
    invoiced: r.invoiced,
    totalCost: goodsReceiptTotalCost(r).toString(),
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

function serializeInvoice(inv: PurchaseInvoice) {
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
    notes: inv.notes,
    receiptId: inv.receiptId,
    lines: inv.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      kind: l.kind,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      taxRatePercent: l.taxRatePercent,
    })),
    status: inv.status,
    subtotal: purchaseInvoiceSubtotal(inv).toString(),
    tax: purchaseInvoiceTax(inv).toString(),
    total: purchaseInvoiceTotal(inv).toString(),
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
    err instanceof OverReceiptError
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
  throw err;
}

export function createPurchasesRoutes(
  deps: PurchasesRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;
  const resolveTaxRate = deps.resolveTaxRate ?? (() => 0);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";

  // --- Purchase Orders -----------------------------------------------------

  app.get("/orders", gate("purchases.order.view"), async (c) => {
    return c.json((await deps.orders.list()).map(serializeOrder));
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
      const order = await confirmPurchaseOrder(c.req.param("id"), { orders: deps.orders });
      return c.json(serializeOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/orders/:id/cancel", gate("purchases.order.cancel"), async (c) => {
    try {
      const order = await cancelPurchaseOrder(c.req.param("id"), { orders: deps.orders });
      return c.json(serializeOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Goods Receipts ------------------------------------------------------

  app.get("/receipts", gate("purchases.receipt.view"), async (c) => {
    return c.json((await deps.receipts.list()).map(serializeReceipt));
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
    try {
      const receipt = await createGoodsReceipt(
        {
          id: parsed.data.id,
          purchaseOrderId: parsed.data.purchaseOrderId,
          date: parsed.data.date,
          notes: parsed.data.notes,
          createdBy: actor(c),
          lines: parsed.data.lines?.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            qty: Qty.fromMajor(l.qty),
            unitCost: Money.fromMajor(l.unitCost),
          })),
        },
        { receipts: deps.receipts, orders: deps.orders, numbering: deps.numbering, policy, now: deps.now },
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
        now: deps.now,
      });
      return c.json(serializeReceipt(receipt));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Purchase Invoices ---------------------------------------------------

  app.get("/invoices", gate("purchases.invoice.view"), async (c) => {
    return c.json((await deps.invoices.list()).map(serializeInvoice));
  });

  app.get("/invoices/:id", gate("purchases.invoice.view"), async (c) => {
    const invoice = await deps.invoices.findById(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeInvoice(invoice));
  });

  app.post("/invoices", gate("purchases.invoice.create"), async (c) => {
    const parsed = createPurchaseInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      // create-from-receipt: auto-fill lines from a confirmed receipt when omitted.
      let lines: PurchaseInvoiceLine[] | undefined;
      if (parsed.data.lines) {
        lines = parsed.data.lines.map((l) => ({
          itemId: l.itemId ?? null,
          description: l.description ?? null,
          kind: l.kind ?? "inventory",
          qty: Qty.fromMajor(l.qty),
          unitCost: Money.fromMajor(l.unitCost),
          taxRatePercent: l.taxRatePercent ?? 0,
        }));
      } else if (parsed.data.receiptId) {
        const receipt = await deps.receipts.findById(parsed.data.receiptId);
        if (!receipt) throw new GoodsReceiptNotFoundError(parsed.data.receiptId);
        lines = buildInvoiceLinesFromReceipt(receipt, resolveTaxRate);
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
        { invoices: deps.invoices, receipts: deps.receipts, numbering: deps.numbering, policy, now: deps.now },
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
        now: deps.now,
      });
      return c.json(serializeInvoice(invoice));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
