import { ArabicCase, arabicDays } from "../text/counted-noun.js";
import { Qty } from "../money/index.js";
import { InvalidReorderPolicyError } from "./errors.js";
import type { BilingualReason } from "../collections/errors.js";
import {
  REORDER_LEAD_DAYS_MAX,
  type ItemWarehousePolicy,
  type ReorderOrderGroup,
  type ReorderOrderLine,
} from "./types.js";

const ONE_UNIT = 1_000_000n;

export function roundUpToPack(qty: Qty, pack: Qty): Qty {
  if (qty.scaled <= 0n) return Qty.zero();
  if (pack.scaled <= ONE_UNIT) return qty;
  const packs = (qty.scaled + pack.scaled - 1n) / pack.scaled;
  return Qty.fromScaled(packs * pack.scaled);
}

export function reorderPosition(onHand: Qty, onOrder: Qty, reserved: Qty): Qty {
  return onHand.add(onOrder).subtract(reserved);
}

export function suggestedOrderQty(max: Qty, position: Qty, pack: Qty): Qty {
  return roundUpToPack(max.subtract(position), pack);
}

export function dailyVelocity(sold: Qty, windowDays: number): Qty {
  if (sold.scaled <= 0n || windowDays <= 0) return Qty.zero();
  return Qty.fromScaled(sold.scaled / BigInt(windowDays));
}

export function daysOfCover(onHand: Qty, reserved: Qty, sold: Qty, windowDays: number): number | null {
  const available = onHand.subtract(reserved);
  if (available.scaled <= 0n) return 0;
  if (sold.scaled <= 0n || windowDays <= 0) return null;
  return Number((available.scaled * BigInt(windowDays) * 10n) / sold.scaled) / 10;
}

export interface LowStockCrossingInput {
  readonly armed: boolean;
  readonly onHandAfter: Qty;
  readonly threshold: Qty | null;
}

export interface LowStockCrossing {
  readonly fire: boolean;
  readonly armed: boolean;
}

export function evaluateLowStockCrossing(input: LowStockCrossingInput): LowStockCrossing {
  if (input.threshold === null || input.threshold.scaled <= 0n) return { fire: false, armed: true };
  if (input.onHandAfter.compare(input.threshold) <= 0) return { fire: input.armed, armed: false };
  return { fire: false, armed: true };
}

export interface ReorderPolicyInput {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly minQty: Qty;
  readonly maxQty: Qty;
  readonly leadDays: number;
  readonly packQty: Qty | null;
  readonly supplierId: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export function buildReorderPolicy(input: ReorderPolicyInput): ItemWarehousePolicy {
  const reasons: BilingualReason[] = [];
  if (input.minQty.scaled < 0n) reasons.push({ ar: "الحد الأدنى لا يمكن أن يكون سالباً.", en: "The minimum cannot be negative." });
  if (input.maxQty.scaled <= 0n) reasons.push({ ar: "الحد الأقصى يجب أن يكون أكبر من صفر.", en: "The maximum must be greater than zero." });
  if (input.maxQty.compare(input.minQty) < 0) reasons.push({ ar: "الحد الأقصى يجب ألا يقل عن الحد الأدنى.", en: "The maximum cannot be below the minimum." });
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > REORDER_LEAD_DAYS_MAX) {
    reasons.push({
      ar: `مدة التوريد يجب أن تكون عدداً صحيحاً من 0 إلى ${arabicDays(REORDER_LEAD_DAYS_MAX, ArabicCase.Oblique)}.`,
      en: `The lead time must be a whole number of days from 0 to ${REORDER_LEAD_DAYS_MAX}.`,
    });
  }
  if (input.packQty !== null && input.packQty.scaled <= 0n) reasons.push({ ar: "حجم العبوة يجب أن يكون أكبر من صفر.", en: "The pack size must be greater than zero." });
  if (reasons.length > 0) throw new InvalidReorderPolicyError(reasons);
  return {
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    minQty: input.minQty,
    maxQty: input.maxQty,
    leadDays: input.leadDays,
    packQty: input.packQty ?? Qty.fromScaled(ONE_UNIT),
    supplierId: input.supplierId,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };
}

export interface ReorderOrderSplit {
  readonly groups: readonly ReorderOrderGroup[];
  readonly needsSupplier: readonly ReorderOrderLine[];
}

export function groupOrderLines(lines: readonly ReorderOrderLine[]): ReorderOrderSplit {
  const groups = new Map<string, { supplierId: string; warehouseId: string; lines: ReorderOrderLine[] }>();
  const needsSupplier: ReorderOrderLine[] = [];
  for (const line of lines) {
    if (line.supplierId === null) {
      needsSupplier.push(line);
      continue;
    }
    const key = `${line.supplierId}\u0000${line.warehouseId}`;
    const group = groups.get(key) ?? { supplierId: line.supplierId, warehouseId: line.warehouseId, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return { groups: [...groups.values()], needsSupplier };
}
