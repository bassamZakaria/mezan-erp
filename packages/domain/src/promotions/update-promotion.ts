import { Money, Qty } from "../money/index.js";
import { assertValidPromotion, type Promotion, type PromotionBundleComponent, type PromotionDayHourRestriction, type PromotionScope, type PromotionType } from "./promotion.js";
import { DuplicatePromotionError, PromotionNotFoundError } from "./errors.js";
import type { PromotionRepository } from "./ports.js";

export interface UpdatePromotionCommand {
  readonly code?: string;
  readonly priority?: number;
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly description?: string | null;
  readonly type?: PromotionType;
  readonly percentValue?: number | null;
  readonly amountValue?: Money | null;
  readonly minInvoiceValue?: Money | null;
  readonly minQty?: Qty | null;
  readonly maxDiscountAmount?: Money | null;
  readonly buyQty?: number | null;
  readonly getQty?: number | null;
  readonly bundleComponents?: readonly PromotionBundleComponent[];
  readonly requiresCoupon?: boolean;
  readonly dayHourRestriction?: PromotionDayHourRestriction | null;
  readonly scope?: PromotionScope;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly active?: boolean;
}

/**
 * Edits an existing promotion — every field is a patch, applied over the
 * current record, then re-validated as a whole (a partial edit can still
 * produce an invalid combination, e.g. flipping type to "bundle" without
 * components).
 */
export async function updatePromotion(
  promotionId: string,
  command: UpdatePromotionCommand,
  repo: PromotionRepository,
): Promise<Promotion> {
  const current = await repo.findById(promotionId);
  if (!current) throw new PromotionNotFoundError(promotionId);

  if (command.code !== undefined && command.code !== current.code) {
    const existing = await repo.list();
    if (existing.some((p) => p.id !== promotionId && p.code === command.code)) {
      throw new DuplicatePromotionError(command.code);
    }
  }

  const updated: Promotion = {
    ...current,
    code: command.code ?? current.code,
    priority: command.priority ?? current.priority,
    nameAr: command.nameAr ?? current.nameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    description: command.description !== undefined ? command.description : current.description,
    type: command.type ?? current.type,
    percentValue: command.percentValue !== undefined ? command.percentValue : current.percentValue,
    amountValue: command.amountValue !== undefined ? command.amountValue : current.amountValue,
    minInvoiceValue: command.minInvoiceValue !== undefined ? command.minInvoiceValue : current.minInvoiceValue,
    minQty: command.minQty !== undefined ? command.minQty : current.minQty,
    maxDiscountAmount: command.maxDiscountAmount !== undefined ? command.maxDiscountAmount : current.maxDiscountAmount,
    buyQty: command.buyQty !== undefined ? command.buyQty : current.buyQty,
    getQty: command.getQty !== undefined ? command.getQty : current.getQty,
    bundleComponents: command.bundleComponents ?? current.bundleComponents,
    requiresCoupon: command.requiresCoupon ?? current.requiresCoupon,
    dayHourRestriction: command.dayHourRestriction !== undefined ? command.dayHourRestriction : current.dayHourRestriction,
    scope: command.scope ?? current.scope,
    startDate: command.startDate ?? current.startDate,
    endDate: command.endDate ?? current.endDate,
    active: command.active ?? current.active,
  };

  assertValidPromotion(updated);
  await repo.update(updated);
  return updated;
}
