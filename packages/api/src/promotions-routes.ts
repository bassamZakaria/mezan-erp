import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  aggregatePromotionUsage,
  SALES_INVOICE_ACTIVE_STATUSES,
  createPromotion,
  evaluateBestPromotion,
  extendLine,
  promotionStatus,
  updatePromotion,
  DuplicatePromotionError,
  InvalidPromotionError,
  PromotionNotFoundError,
  type FrameworkDocument,
  type Promotion,
  type PromotionLineInput,
  type PromotionRepository,
  type PromotionUsageInvoice,
  type PromotionUsageReturn,
  type SalesInvoiceRepository,
  type SalesReturnLine,
} from "@mezan/domain";
import { createPromotionSchema, evaluatePromotionsQuerySchema, updatePromotionSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serialize(promotion: Promotion) {
  return {
    id: promotion.id,
    code: promotion.code,
    priority: promotion.priority,
    nameAr: promotion.nameAr,
    nameEn: promotion.nameEn,
    description: promotion.description,
    type: promotion.type,
    percentValue: promotion.percentValue,
    amountValue: promotion.amountValue?.toString() ?? null,
    minInvoiceValue: promotion.minInvoiceValue?.toString() ?? null,
    buyQty: promotion.buyQty,
    getQty: promotion.getQty,
    bundleComponents: promotion.bundleComponents.map((c) => ({ itemId: c.itemId, qty: c.qty.toString() })),
    requiresCoupon: promotion.requiresCoupon,
    dayHourRestriction: promotion.dayHourRestriction,
    scope: promotion.scope,
    startDate: promotion.startDate,
    endDate: promotion.endDate,
    active: promotion.active,
    createdAt: promotion.createdAt,
    status: promotionStatus(promotion, new Date().toISOString().slice(0, 10)),
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof PromotionNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicatePromotionError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidPromotionError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/** `undefined` (field absent) stays `undefined`; explicit `null` stays `null`; a string parses to Money. */
function parseMoneyNullish(value: string | null | undefined): Money | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return Money.fromMajor(value);
}

/**
 * Data sources `/report` aggregates real usage from. Both are optional: a
 * composition that wires neither serves a catalogue-only report (every counter
 * genuinely zero because nothing recorded a promotion) rather than a fabricated
 * one.
 */
export interface PromotionsRoutesUsageDeps {
  readonly salesInvoices?: SalesInvoiceRepository;
  /** Read-only slice of the sales-return document service/repo — only `list()` is needed. */
  readonly salesReturns?: { list(): Promise<readonly FrameworkDocument<SalesReturnLine>[]> };
}

/**
 * Promotion routes (docs/catalog/01 §"العروض"): list, get one, create, edit,
 * deactivate, a cart-preview `/evaluate`, and `/report` usage aggregation. Every
 * CRUD route is permission-gated via `sales.promotion.view` / `.manage`.
 */
export function createPromotionsRoutes(
  repo: PromotionRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  usage: PromotionsRoutesUsageDeps = {},
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("sales.promotion.view"), async (c) => {
    const activeParam = c.req.query("active");
    const filter = activeParam === undefined ? undefined : { active: activeParam === "true" };
    const promotions = await repo.list(filter);
    return c.json(promotions.map(serialize));
  });

  /**
   * تقرير استخدام العروض — real usage off confirmed sales invoices.
   *
   * `dateFrom`/`dateTo` filter DOCUMENTS, not the promotion's own window: the
   * question this answers is "what did this campaign grant during the period",
   * so a promotion that has since expired or been deactivated still reports
   * the discount it granted while it was live. Every figure is read from each
   * invoice's own snapshot, never re-derived from the current promotion.
   */
  app.get("/report", gate("sales.promotion.view"), async (c) => {
    const dateFrom = c.req.query("dateFrom");
    const dateTo = c.req.query("dateTo");
    const promotions = await repo.list();

    const invoices: PromotionUsageInvoice[] = (await usage.salesInvoices?.list())?.map((inv) => ({
      id: inv.id,
      date: inv.date,
      live: SALES_INVOICE_ACTIVE_STATUSES.has(inv.status),
      lines: inv.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      promotion: inv.appliedPromotion
        ? {
            promotionId: inv.appliedPromotion.promotionId,
            code: inv.appliedPromotion.code,
            nameAr: inv.appliedPromotion.nameAr,
            discountTotal: inv.appliedPromotion.discountTotal,
            lineDiscounts: inv.appliedPromotion.lineDiscounts.map((d) => ({ itemId: d.itemId, amount: d.amount })),
          }
        : null,
    })) ?? [];

    const returns: PromotionUsageReturn[] = [];
    for (const doc of (await usage.salesReturns?.list()) ?? []) {
      const sourceInvoiceId = doc.lines[0]?.sourceInvoiceId;
      if (!sourceInvoiceId) continue;
      returns.push({
        sourceInvoiceId,
        date: doc.date,
        live: doc.status === "confirmed",
        lines: doc.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      });
    }

    const rows = aggregatePromotionUsage({
      catalog: promotions.map((p) => ({
        id: p.id,
        code: p.code,
        nameAr: p.nameAr,
        startDate: p.startDate,
        endDate: p.endDate,
      })),
      invoices,
      returns,
      dateFrom,
      dateTo,
    });

    return c.json(
      rows.map((row) => ({
        id: row.id,
        code: row.code,
        nameAr: row.nameAr,
        usageCount: row.usageCount,
        discountGranted: row.discountGranted.toString(),
        reversedDiscount: row.reversedDiscount.toString(),
        netDiscount: row.netDiscount.toString(),
      })),
    );
  });

  app.get("/:id", gate("sales.promotion.view"), async (c) => {
    const promotion = await repo.findById(c.req.param("id"));
    if (!promotion) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(promotion));
  });

  app.post("/", gate("sales.promotion.manage"), async (c) => {
    const parsed = createPromotionSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const promotion = await createPromotion(
        {
          id: parsed.data.id ?? crypto.randomUUID(),
          code: parsed.data.code,
          priority: parsed.data.priority,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          description: parsed.data.description,
          type: parsed.data.type,
          percentValue: parsed.data.percentValue,
          amountValue: parseMoneyNullish(parsed.data.amountValue),
          minInvoiceValue: parseMoneyNullish(parsed.data.minInvoiceValue),
          buyQty: parsed.data.buyQty,
          getQty: parsed.data.getQty,
          bundleComponents: parsed.data.bundleComponents?.map((bc) => ({ itemId: bc.itemId, qty: Qty.fromMajor(bc.qty) })),
          requiresCoupon: parsed.data.requiresCoupon,
          dayHourRestriction: parsed.data.dayHourRestriction,
          scope: parsed.data.scope,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          active: parsed.data.active,
          createdAt: new Date().toISOString(),
        },
        repo,
      );
      return c.json(serialize(promotion), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("sales.promotion.manage"), async (c) => {
    const parsed = updatePromotionSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const promotion = await updatePromotion(
        c.req.param("id"),
        {
          code: parsed.data.code,
          priority: parsed.data.priority,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          description: parsed.data.description,
          type: parsed.data.type,
          percentValue: parsed.data.percentValue,
          amountValue: parseMoneyNullish(parsed.data.amountValue),
          minInvoiceValue: parseMoneyNullish(parsed.data.minInvoiceValue),
          buyQty: parsed.data.buyQty,
          getQty: parsed.data.getQty,
          bundleComponents: parsed.data.bundleComponents?.map((bc) => ({ itemId: bc.itemId, qty: Qty.fromMajor(bc.qty) })),
          requiresCoupon: parsed.data.requiresCoupon,
          dayHourRestriction: parsed.data.dayHourRestriction,
          scope: parsed.data.scope,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          active: parsed.data.active,
        },
        repo,
      );
      return c.json(serialize(promotion));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/deactivate", gate("sales.promotion.manage"), async (c) => {
    try {
      const promotion = await updatePromotion(c.req.param("id"), { active: false }, repo);
      return c.json(serialize(promotion));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // Any user creating an invoice/quote can preview promotions — this is a
  // read-only calculation, not a promotion-management action.
  app.post("/evaluate", gate("sales.invoice.create"), async (c) => {
    const parsed = evaluatePromotionsQuerySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    const now = new Date();
    const date = parsed.data.date ?? now.toISOString().slice(0, 10);
    const hour = parsed.data.hour ?? now.getUTCHours();
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

    const lines: PromotionLineInput[] = parsed.data.lines.map((l) => {
      const qty = Qty.fromMajor(l.qty);
      const unitPrice = Money.fromMajor(l.unitPrice);
      return {
        lineId: l.lineId,
        itemId: l.itemId,
        categoryId: l.categoryId ?? null,
        qty,
        unitPrice,
        lineTotal: extendLine(qty, unitPrice),
      };
    });
    const subtotal = Money.sum(lines.map((l) => l.lineTotal));

    const promotions = await repo.list({ active: true });
    const result = evaluateBestPromotion({
      promotions,
      lines,
      subtotal,
      date,
      dayOfWeek,
      hour,
      couponCode: parsed.data.couponCode,
    });

    if (!result) return c.json({ applicable: false, promotion: null });

    return c.json({
      applicable: true,
      promotion: serialize(result.promotion),
      discountTotal: result.discountTotal.toString(),
      lineDiscounts: result.lineDiscounts.map((d) => ({ lineId: d.lineId, amount: d.amount.toString() })),
      freeGoods: result.freeGoods.map((g) => ({ itemId: g.itemId, qty: g.qty.toString() })),
    });
  });

  return app;
}
