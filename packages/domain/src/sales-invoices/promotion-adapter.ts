/**
 * Binds the pure promotion engine to the sales-invoice module's
 * {@link SalesInvoicePromotionHook}. This is the ONLY place the two modules
 * meet: the invoice aggregate knows a promotion snapshot, never a `Promotion`.
 *
 * The engine runs against the invoice's own lines at confirm, so the discount
 * an invoice records is the one its real lines and its real date earned — a
 * client-supplied figure is never trusted.
 */

import { Money } from "../money/index.js";
import { evaluateBestPromotion, extendLine, type PromotionLineInput } from "../promotions/engine.js";
import type { PromotionRepository } from "../promotions/ports.js";
import type { AppliedSalesInvoicePromotion } from "./sales-invoice.js";
import type { SalesInvoicePromotionHook, SalesInvoicePromotionRequest } from "./ports.js";

export interface SalesInvoicePromotionHookOptions {
  /** Resolves an item's category so category-scoped promotions can match; unresolved items are treated as uncategorised. */
  readonly categoryOfItem?: (itemId: string) => Promise<string | null> | string | null;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
}

export function createSalesInvoicePromotionHook(
  repo: PromotionRepository,
  options: SalesInvoicePromotionHookOptions = {},
): SalesInvoicePromotionHook {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async evaluate(request: SalesInvoicePromotionRequest): Promise<AppliedSalesInvoicePromotion | null> {
      if (request.lines.length === 0) return null;
      const promotions = await repo.list({ active: true });
      if (promotions.length === 0) return null;

      const lines: PromotionLineInput[] = [];
      for (const line of request.lines) {
        lines.push({
          lineId: line.lineId,
          itemId: line.itemId,
          categoryId: options.categoryOfItem ? ((await options.categoryOfItem(line.itemId)) ?? null) : null,
          qty: line.qty,
          unitPrice: line.unitPrice,
          lineTotal: extendLine(line.qty, line.unitPrice),
        });
      }

      const appliedAt = now();
      const evaluatedAt = new Date(appliedAt);
      const result = evaluateBestPromotion({
        promotions,
        lines,
        subtotal: Money.sum(lines.map((l) => l.lineTotal)),
        date: request.date,
        dayOfWeek: new Date(`${request.date}T00:00:00Z`).getUTCDay(),
        hour: evaluatedAt.getUTCHours(),
        couponCode: request.couponCode,
      });
      if (!result || result.discountTotal.scaled <= 0n) return null;

      const itemByLineId = new Map(request.lines.map((l) => [l.lineId, l.itemId]));
      return {
        promotionId: result.promotion.id,
        code: result.promotion.code,
        nameAr: result.promotion.nameAr,
        couponCode: request.couponCode,
        discountTotal: result.discountTotal,
        lineDiscounts: result.lineDiscounts
          .filter((d) => d.amount.scaled > 0n)
          .map((d) => ({ lineId: d.lineId, itemId: itemByLineId.get(d.lineId) ?? "", amount: d.amount })),
        appliedAt,
      };
    },
  };
}
