/**
 * Landed-cost distribution math (docs/archive/catalog/02 §"التكاليف الإضافية" —
 * freight/customs/insurance/clearance/other allocated across a target
 * invoice's item costs "حسب القيمة" [by value] or "حسب الكمية" [by
 * quantity]). Pure; the LANDED_COST_DISTRIBUTION rounding boundary this uses
 * is named in `../money/rounding.ts`'s doc-comment — largest-remainder
 * allocation so the parts always reconcile EXACTLY to the entered total, no
 * matter how many target lines share it.
 */

import { Money, Qty, allocate } from "../money/index.js";
import { extend, unitCostOf } from "../inventory/wac-math.js";
import type { CostCategory } from "../contracting/cost-category.js";
import { EmptyLandedCostTargetsError, ZeroLandedCostWeightError } from "./errors.js";

/** docs/archive/catalog/02 §"نوع التكلفة *" on the cost-line table. */
export const LANDED_COST_TYPES = ["SHIPPING", "CUSTOMS", "INSURANCE", "CLEARANCE", "OTHER"] as const;
export type LandedCostType = (typeof LANDED_COST_TYPES)[number];

/** docs/archive/catalog/02 §"طريقة التوزيع *" — حسب القيمة / حسب الكمية / حسب الوزن (R4.7). */
export const LANDED_COST_DISTRIBUTION_METHODS = ["BY_VALUE", "BY_QUANTITY", "BY_WEIGHT"] as const;
export type LandedCostDistributionMethod = (typeof LANDED_COST_DISTRIBUTION_METHODS)[number];

/** One row of "بنود التكلفة" — the additional cost being distributed. */
export interface LandedCostItemEntry {
  readonly costType: LandedCostType;
  readonly description: string;
  readonly amount: Money;
  /**
   * The freight/customs/clearance vendor this charge is owed to.
   *
   * Optional because a landed cost can legitimately be an internal charge with
   * no third party behind it, and because documents raised before this existed
   * carry none. Without it the liability sat in the GL against nobody (D75).
   */
  readonly supplierId?: string | null;
}

/** One target item on the linked purchase invoice, before allocation. */
export interface LandedCostAllocationTarget {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly sourceInvoiceId: string;
  readonly sourceInvoiceNumber: string | null;
  readonly qty: Qty;
  /** The item's current landed unit cost (pre-allocation). */
  readonly unitCost: Money;
  /**
   * Total shipped weight of this line, in the tenant's own weight unit. Only
   * BY_WEIGHT reads it; it stays on the persisted line either way so a
   * confirmed document still states the basis it was allocated on.
   */
  readonly weight: Qty;
  /** بُعد المشروع — every line of a confirmed landed-cost document carries the same document-wide value (D-01). */
  readonly projectId?: string | null;
  /** فئة التكلفة — only meaningful with `projectId`; defaults to "materials" on the inventory debit. */
  readonly costCategory?: CostCategory | null;
  /** بُعد الفرع (DEC-20) — the branch of this line's warehouse, stamped by the server and never taken from the caller. */
  readonly branchId?: string | null;
}

/** A target line after allocation — what a `LandedCostLine` (the document type's line shape) carries. */
export interface AllocatedLandedCostLine extends LandedCostAllocationTarget {
  readonly allocatedAmount: Money;
  /** `unitCost + allocatedAmount / qty` — the new landed unit cost this line raises the position to. */
  readonly newUnitCost: Money;
}

function basisWeight(target: LandedCostAllocationTarget, method: LandedCostDistributionMethod): bigint {
  if (method === "BY_QUANTITY") return target.qty.scaled;
  if (method === "BY_WEIGHT") return target.weight.scaled;
  return extend(target.qty, target.unitCost).scaled;
}

/**
 * Distributes `Σ costItems.amount` across `targets` by value (qty × unitCost),
 * by quantity or by shipped weight, largest-remainder rounded so the allocated
 * amounts sum EXACTLY to the total cost entered (docs/archive/catalog/02: "إجمالي
 * التكلفة").
 */
export function distributeLandedCost(
  costItems: readonly LandedCostItemEntry[],
  method: LandedCostDistributionMethod,
  targets: readonly LandedCostAllocationTarget[],
): AllocatedLandedCostLine[] {
  if (targets.length === 0) throw new EmptyLandedCostTargetsError();
  const totalCost = Money.sum(costItems.map((c) => c.amount));

  const weights = targets.map((t) => basisWeight(t, method));
  if (weights.every((w) => w <= 0n)) {
    throw new ZeroLandedCostWeightError(method);
  }

  const shares = allocate(totalCost, weights);
  return targets.map((t, i) => {
    const allocatedAmount = shares[i] as Money;
    const newUnitCost = t.qty.isZero() ? t.unitCost : t.unitCost.add(unitCostOf(allocatedAmount, t.qty));
    return { ...t, allocatedAmount, newUnitCost };
  });
}

/** Total cost entered ("إجمالي التكلفة"), summed once — used for validation/effects/GL. */
export function totalLandedCost(costItems: readonly LandedCostItemEntry[]): Money {
  return Money.sum(costItems.map((c) => c.amount));
}

/**
 * The entered cost broken down by نوع التكلفة (R4.7) — what the شحن / جمارك /
 * تأمين / تخليص split of one document actually was. Types with nothing entered
 * are omitted, and the parts sum to `totalLandedCost` exactly.
 */
export function landedCostTotalsByType(
  costItems: readonly LandedCostItemEntry[],
): { readonly costType: LandedCostType; readonly amount: Money }[] {
  const byType = new Map<LandedCostType, Money>();
  for (const entry of costItems) {
    byType.set(entry.costType, (byType.get(entry.costType) ?? Money.zero()).add(entry.amount));
  }
  return LANDED_COST_TYPES.filter((type) => byType.has(type)).map((costType) => ({
    costType,
    amount: byType.get(costType) as Money,
  }));
}
