import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  createPromotion,
  evaluateBestPromotion,
  extendLine,
  promotionStatus,
  updatePromotion,
  DuplicatePromotionError,
  InvalidPromotionError,
  PromotionNotFoundError,
  type Promotion,
  type PromotionLineInput,
  type PromotionRepository,
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
 * Promotion routes (docs/catalog/01 §"العروض"): list, get one, create, edit,
 * deactivate, a cart-preview `/evaluate`, and a `/report` usage stub. Every
 * CRUD route is permission-gated via `sales.promotion.view` / `.manage`.
 */
export function createPromotionsRoutes(
  repo: PromotionRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("sales.promotion.view"), async (c) => {
    const activeParam = c.req.query("active");
    const filter = activeParam === undefined ? undefined : { active: activeParam === "true" };
    const promotions = await repo.list(filter);
    return c.json(promotions.map(serialize));
  });

  app.get("/report", gate("sales.promotion.view"), async (c) => {
    const dateFrom = c.req.query("dateFrom");
    const dateTo = c.req.query("dateTo");
    const promotions = await repo.list();
    const inRange = promotions.filter((p) => {
      if (dateFrom && p.endDate < dateFrom) return false;
      if (dateTo && p.startDate > dateTo) return false;
      return p.active;
    });
    // No invoice/POS usage-tracking is wired up yet (sales invoices don't yet
    // record which promotion/coupon they applied), so every row is an honest
    // zero stub rather than a fabricated number. Real usage aggregation is
    // follow-up work once that link exists.
    return c.json(
      inRange.map((p) => ({
        id: p.id,
        code: p.code,
        nameAr: p.nameAr,
        usageCount: 0,
        discountGranted: "0.000000",
        reversedDiscount: "0.000000",
        netDiscount: "0.000000",
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
