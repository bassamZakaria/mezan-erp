import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  SalesInvoiceService,
  computeInvoiceTotals,
  InvalidSalesInvoiceError,
  SalesInvoiceNotFoundError,
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceTransitionError,
  InvalidSalesInvoicePaymentError,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  DuplicateJournalEntryError,
  NegativeStockError,
  CreditLimitExceededError,
  type SalesInvoice,
  type SalesInvoiceDiscount,
  type SalesInvoiceTotals,
  type SalesInvoiceRepository,
  type SalesInvoiceStockHook,
  type SalesInvoiceServiceDeps,
  type SalesInvoiceCreditControlDeps,
  type CreateSalesInvoiceCommand,
  type DocumentNumberingHook,
  type DocumentGlHook,
  type DocumentWorkflowGate,
  type DocumentEventPublisher,
  type AuditSink,
  type CreditCheckResult,
} from "@mezan/domain";
import {
  createSalesInvoiceSchema,
  confirmSalesInvoiceSchema,
  salesInvoicePaymentSchema,
  salesInvoiceListQuerySchema,
  type SalesInvoiceDiscountDTO,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/**
 * External dependencies the sales-invoice routes bind the domain service to.
 * The GL / stock / numbering / workflow hooks are the SAME ports the document
 * framework defines; assemble them at the composition root with
 * `createSalesInvoiceGlHook` / `createSalesInvoiceStockHook`.
 */
export interface SalesInvoiceRoutesDeps {
  readonly repo: SalesInvoiceRepository;
  readonly numbering: DocumentNumberingHook;
  readonly gl: DocumentGlHook;
  readonly stock: SalesInvoiceStockHook;
  readonly workflow?: DocumentWorkflowGate;
  /** Credit control on confirm (docs/catalog/01/09 §"الرقابة الائتمانية"); omit for no check at all. */
  readonly creditControl?: SalesInvoiceCreditControlDeps;
  readonly audit?: AuditSink;
  readonly events?: DocumentEventPublisher;
  readonly now?: () => string;
  /** Generates an invoice id when the request omits one. Defaults to a UUID. */
  readonly idGen?: () => string;
}

function discountToDomain(dto: SalesInvoiceDiscountDTO | undefined): SalesInvoiceDiscount | undefined {
  if (!dto) return undefined;
  return dto.type === "percent"
    ? { type: "percent", percent: dto.percent }
    : { type: "amount", amount: Money.fromMajor(dto.amount) };
}

function serializeDiscount(discount: SalesInvoiceDiscount) {
  return discount.type === "percent"
    ? { type: "percent" as const, percent: discount.percent }
    : { type: "amount" as const, amount: discount.amount.toString() };
}

function serializeCreditWarning(warning: CreditCheckResult | null) {
  if (!warning) return null;
  return {
    status: warning.status,
    projectedBalance: warning.projectedBalance.toString(),
    overBy: warning.overBy.toString(),
    message: warning.message,
  };
}

function serializeTotals(totals: SalesInvoiceTotals) {
  return {
    grossTotal: totals.grossTotal.toString(),
    lineDiscountTotal: totals.lineDiscountTotal.toString(),
    invoiceDiscountTotal: totals.invoiceDiscountTotal.toString(),
    subtotal: totals.subtotal.toString(),
    taxableTotal: totals.taxableTotal.toString(),
    taxTotal: totals.taxTotal.toString(),
    grandTotal: totals.grandTotal.toString(),
  };
}

function serialize(invoice: SalesInvoice, totals: SalesInvoiceTotals) {
  const remaining = totals.grandTotal.add(invoice.amountPaid.negate());
  return {
    id: invoice.id,
    docType: invoice.docType,
    docNo: invoice.docNo,
    status: invoice.status,
    date: invoice.date,
    dueDate: invoice.dueDate,
    customerId: invoice.customerId,
    customerNameAr: invoice.customerNameAr,
    customerTaxExempt: invoice.customerTaxExempt,
    warehouseId: invoice.warehouseId,
    branchId: invoice.branchId,
    currency: invoice.currency,
    notes: invoice.notes,
    internalNotes: invoice.internalNotes,
    discount: serializeDiscount(invoice.discount),
    arAccountId: invoice.arAccountId,
    taxAccountId: invoice.taxAccountId,
    amountPaid: invoice.amountPaid.toString(),
    remainingBalance: remaining.toString(),
    journalEntryId: invoice.journalEntryId,
    workflowRequestId: invoice.workflowRequestId,
    createdAt: invoice.createdAt,
    confirmedAt: invoice.confirmedAt,
    lines: invoice.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      isStock: l.isStock,
      qty: l.qty.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId,
      inventoryAccountId: l.inventoryAccountId,
      unitCost: l.unitCost ? l.unitCost.toString() : null,
    })),
    totals: serializeTotals(totals),
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof InvalidSalesInvoiceError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof SalesInvoiceNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof DuplicateSalesInvoiceError ||
    err instanceof InvalidSalesInvoiceTransitionError ||
    err instanceof DuplicateJournalEntryError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidSalesInvoicePaymentError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof CreditLimitExceededError) {
    return c.json({ error: err.code, message: err.message, customerId: err.customerId }, 422);
  }
  if (err instanceof UnbalancedEntryError) {
    return c.json(
      { error: err.code, message: err.message, totalDebit: err.totalDebit.toString(), totalCredit: err.totalCredit.toString() },
      422,
    );
  }
  if (
    err instanceof InvalidJournalEntryError ||
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof NegativeStockError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Sales-invoice routes (docs/catalog/01 §"فواتير المبيعات"), mounted under
 * `/sales-invoices`:
 *   POST /                     create a draft            (sales.invoice.create)
 *   GET  /                     list (status/customer/date) (sales.invoice.view)
 *   GET  /:id                  get one                   (sales.invoice.view)
 *   POST /:id/confirm          confirm → stock + GL + AR  (sales.invoice.confirm)
 *   POST /:id/cancel           cancel a draft            (sales.invoice.delete_draft)
 *   POST /:id/payments         record a collection       (sales.invoice.edit)
 */
export function createSalesInvoicesRoutes(
  deps: SalesInvoiceRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  function service(c: Context): SalesInvoiceService {
    const svcDeps: SalesInvoiceServiceDeps = {
      repo: deps.repo,
      numbering: deps.numbering,
      gl: deps.gl,
      stock: deps.stock,
      workflow: deps.workflow,
      creditControl: deps.creditControl,
      audit: deps.audit,
      events: deps.events,
      now: deps.now,
      actor: getAuthContext(c)?.userId ?? "system",
    };
    return new SalesInvoiceService(svcDeps);
  }

  function totalsFor(svc: SalesInvoiceService, invoice: SalesInvoice): SalesInvoiceTotals {
    return svc.totalsOf(invoice);
  }

  app.post("/", gate("sales.invoice.create"), async (c) => {
    const parsed = createSalesInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    const cmd: CreateSalesInvoiceCommand = {
      id: d.id ?? idGen(),
      date: d.date,
      dueDate: d.dueDate,
      customerId: d.customerId,
      customerNameAr: d.customerNameAr,
      customerTaxExempt: d.customerTaxExempt,
      warehouseId: d.warehouseId,
      branchId: d.branchId,
      currency: d.currency,
      notes: d.notes ?? null,
      internalNotes: d.internalNotes ?? null,
      discount: discountToDomain(d.discount),
      arAccountId: d.arAccountId,
      taxAccountId: d.taxAccountId,
      lines: d.lines.map((l) => ({
        lineId: l.lineId,
        itemId: l.itemId,
        itemNameAr: l.itemNameAr,
        isStock: l.isStock,
        qty: Qty.fromMajor(l.qty),
        unitPrice: Money.fromMajor(l.unitPrice),
        discountPercent: l.discountPercent,
        taxRatePercent: l.taxRatePercent,
        revenueAccountId: l.revenueAccountId,
        cogsAccountId: l.cogsAccountId ?? null,
        inventoryAccountId: l.inventoryAccountId ?? null,
      })),
    };
    const svc = service(c);
    try {
      const invoice = await svc.createDraft(cmd);
      return c.json(serialize(invoice, totalsFor(svc, invoice)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/", gate("sales.invoice.view"), async (c) => {
    const parsed = salesInvoiceListQuerySchema.safeParse({
      status: c.req.query("status"),
      customerId: c.req.query("customerId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const invoices = await svc.list(parsed.data);
    return c.json(invoices.map((inv) => serialize(inv, totalsFor(svc, inv))));
  });

  app.get("/:id", gate("sales.invoice.view"), async (c) => {
    const svc = service(c);
    const invoice = await svc.findById(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(invoice, totalsFor(svc, invoice)));
  });

  app.post("/:id/confirm", gate("sales.invoice.confirm"), async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = confirmSalesInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const ctx = getAuthContext(c);
    try {
      const result = await svc.confirm(c.req.param("id"), {
        requestId: parsed.data.requestId,
        actor: ctx?.userId,
        actorRoles: ctx?.permissions ? [...ctx.permissions] : undefined,
      });
      return c.json({
        ...serialize(result.invoice, totalsFor(svc, result.invoice)),
        held: result.held,
        creditWarning: serializeCreditWarning(result.creditWarning),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate("sales.invoice.delete_draft"), async (c) => {
    const svc = service(c);
    try {
      const invoice = await svc.cancel(c.req.param("id"));
      return c.json(serialize(invoice, totalsFor(svc, invoice)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/payments", gate("sales.invoice.edit"), async (c) => {
    const parsed = salesInvoicePaymentSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    try {
      const invoice = await svc.recordPayment(c.req.param("id"), Money.fromMajor(parsed.data.amount));
      return c.json(serialize(invoice, totalsFor(svc, invoice)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
