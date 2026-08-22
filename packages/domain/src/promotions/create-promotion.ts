import { Money } from "../money/index.js";
import { assertValidPromotion, type Promotion, type PromotionBundleComponent, type PromotionDayHourRestriction, type PromotionScope, type PromotionType } from "./promotion.js";
import { DuplicatePromotionError } from "./errors.js";
import type { PromotionRepository } from "./ports.js";

export interface CreatePromotionCommand {
  readonly id: string;
  readonly code: string;
  readonly priority?: number;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly description?: string | null;
  readonly type: PromotionType;
  readonly percentValue?: number | null;
  readonly amountValue?: Money | null;
  readonly minInvoiceValue?: Money | null;
  readonly buyQty?: number | null;
  readonly getQty?: number | null;
  readonly bundleComponents?: readonly PromotionBundleComponent[];
  readonly requiresCoupon?: boolean;
  readonly dayHourRestriction?: PromotionDayHourRestriction | null;
  readonly scope?: PromotionScope;
  readonly startDate: string;
  readonly endDate: string;
  readonly active?: boolean;
  readonly createdAt: string;
}

/**
 * Creates and persists a new promotion (docs/catalog/01 §"العروض"). New
 * promotions default to `active: true`, no scope restriction ("all"), and no
 * coupon requirement — mirroring the mockup's create-dialog defaults.
 */
export async function createPromotion(command: CreatePromotionCommand, repo: PromotionRepository): Promise<Promotion> {
  const existing = await repo.list();
  if (existing.some((p) => p.code === command.code)) {
    throw new DuplicatePromotionError(command.code);
  }

  const promotion: Promotion = {
    id: command.id,
    code: command.code,
    priority: command.priority ?? 0,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    description: command.description ?? null,
    type: command.type,
    percentValue: command.percentValue ?? null,
    amountValue: command.amountValue ?? null,
    minInvoiceValue: command.minInvoiceValue ?? null,
    buyQty: command.buyQty ?? null,
    getQty: command.getQty ?? null,
    bundleComponents: command.bundleComponents ?? [],
    requiresCoupon: command.requiresCoupon ?? false,
    dayHourRestriction: command.dayHourRestriction ?? null,
    scope: command.scope ?? { type: "all", ids: [] },
    startDate: command.startDate,
    endDate: command.endDate,
    active: command.active ?? true,
    createdAt: command.createdAt,
  };

  assertValidPromotion(promotion);
  await repo.save(promotion);
  return promotion;
}
