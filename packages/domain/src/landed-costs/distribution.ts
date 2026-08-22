/**
 * Landed-cost distribution math (docs/catalog/02 §"التكاليف الإضافية" —
 * freight/customs/insurance/clearance/other allocated across a target
 * invoice's item costs "حسب القيمة" [by value] or "حسب الكمية" [by
 * quantity]). Pure; the LANDED_COST_DISTRIBUTION rounding boundary this uses
 * is named in `../money/rounding.ts`'s doc-comment — largest-remainder
 * allocation so the parts always reconcile EXACTLY to the entered total, no
 * matter how many target lines share it.
 */

import { Money, Qty, allocate } from "../money/index.js";
import { extend, unitCostOf } from "../inventory/wac-math.js";
import { EmptyLandedCostTargetsError, ZeroLandedCostWeightError } from "./errors.js";

/** docs/catalog/02 §"نوع التكلفة *" on the cost-line table. */
export const LANDED_COST_TYPES = ["SHIPPING", "CUSTOMS", "INSURANCE", "CLEARANCE", "OTHER"] as const;
export type LandedCostType = (typeof LANDED_COST_TYPES)[number];

/** docs/catalog/02 §"طريقة التوزيع *". */
export const LANDED_COST_DISTRIBUTION_METHODS = ["BY_VALUE", "BY_QUANTITY"] as const;
export type LandedCostDistributionMethod = (typeof LANDED_COST_DISTRIBUTION_METHODS)[number];

/** One row of "بنود التكلفة" — the additional cost being distributed. */
export interface LandedCostItemEntry {
  readonly costType: LandedCostType;
  readonly description: string;
  readonly amount: Money;
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
}

/** A target line after allocation — what a `LandedCostLine` (the document type's line shape) carries. */
export interface AllocatedLandedCostLine extends LandedCostAllocationTarget {
  readonly allocatedAmount: Money;
  /** `unitCost + allocatedAmount / qty` — the new landed unit cost this line raises the position to. */
  readonly newUnitCost: Money;
}

/**
 * Distributes `Σ costItems.amount` across `targets` by value (qty × unitCost)
 * or by quantity, largest-remainder rounded so the allocated amounts sum
 * EXACTLY to the total cost entered (docs/catalog/02: "إجمالي التكلفة").
 */
export function distributeLandedCost(
  costItems: readonly LandedCostItemEntry[],
  method: LandedCostDistributionMethod,
  targets: readonly LandedCostAllocationTarget[],
): AllocatedLandedCostLine[] {
  if (targets.length === 0) throw new EmptyLandedCostTargetsError();
  const totalCost = Money.sum(costItems.map((c) => c.amount));

  const weights = targets.map((t) => (method === "BY_QUANTITY" ? t.qty.scaled : extend(t.qty, t.unitCost).scaled));
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
