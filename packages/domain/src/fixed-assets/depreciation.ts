import { Money } from "../money/index.js";
import type { Asset } from "./asset.js";
import { InvalidAssetError } from "./errors.js";

/**
 * Straight-line depreciation math with daily/IFRS proration — pure functions,
 * no repository dependency. Everything needed is passed in so a depreciation
 * run (create-depreciation-run.ts, post-depreciation-run.ts) can call these
 * against in-memory asset snapshots.
 */

export interface DepreciationPeriod {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
}

export interface MonthlyDepreciationResult {
  readonly assetId: string;
  /** 0 if nothing to depreciate this period. */
  readonly amount: Money;
  readonly fullyDepreciatedAfter: boolean;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `start`/`end` bound a calendar month as ISO dates; `daysInPeriod` is the day count (leap-year aware). */
export function periodBounds(period: DepreciationPeriod): { start: string; end: string; daysInPeriod: number } {
  const start = `${period.year}-${pad2(period.month)}-01`;
  const daysInPeriod = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const end = `${period.year}-${pad2(period.month)}-${pad2(daysInPeriod)}`;
  return { start, end, daysInPeriod };
}

/** The depreciable base: acquisition cost minus salvage value. Exact bigint subtraction. */
export function depreciableBase(asset: Pick<Asset, "acquisitionCost" | "salvageValue">): Money {
  return Money.fromScaled(asset.acquisitionCost.scaled - asset.salvageValue.scaled);
}

/**
 * The full month's straight-line depreciation amount. Integer bigint division
 * floors toward zero — fine/expected, since the last period absorbs the
 * rounding remainder via the salvage-value cap in {@link computeMonthlyDepreciation}.
 */
export function straightLineMonthlyAmount(
  asset: Pick<Asset, "acquisitionCost" | "salvageValue" | "usefulLifeMonths">,
): Money {
  if (asset.usefulLifeMonths <= 0) {
    throw new InvalidAssetError(["العمر الإنتاجي للأصل يجب أن يكون أكبر من صفر"]);
  }
  return Money.fromScaled(depreciableBase(asset).scaled / BigInt(asset.usefulLifeMonths));
}

/** Inclusive calendar-day difference between two `YYYY-MM-DD` dates (b - a), as a plain integer day count. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/**
 * The daily/IFRS-proration algorithm: computes how much of an asset's
 * straight-line monthly depreciation is due for one period, prorating a
 * partial first/only period by days in service, and capping cumulative
 * depreciation at the depreciable base.
 */
export function computeMonthlyDepreciation(asset: Asset, period: DepreciationPeriod): MonthlyDepreciationResult {
  if (asset.status !== "active") {
    return {
      assetId: asset.id,
      amount: Money.zero(),
      fullyDepreciatedAfter: asset.status === "fully_depreciated",
    };
  }

  const { start, end, daysInPeriod } = periodBounds(period);

  if (asset.depreciationStartDate > end) {
    return { assetId: asset.id, amount: Money.zero(), fullyDepreciatedAfter: false };
  }

  const effectiveStart = asset.depreciationStartDate > start ? asset.depreciationStartDate : start;
  const daysInServiceRaw = daysBetween(effectiveStart, end) + 1;
  const daysInService = Math.max(0, Math.min(daysInServiceRaw, daysInPeriod));

  const monthlyAmount = straightLineMonthlyAmount(asset);
  const prorated = Money.fromScaled((monthlyAmount.scaled * BigInt(daysInService)) / BigInt(daysInPeriod));

  const base = depreciableBase(asset);
  const remainingBase = base.scaled - asset.accumulatedDepreciation.scaled;

  if (remainingBase <= 0n) {
    return { assetId: asset.id, amount: Money.zero(), fullyDepreciatedAfter: true };
  }

  const amount = Money.fromScaled(prorated.scaled > remainingBase ? remainingBase : prorated.scaled);
  const fullyDepreciatedAfter = asset.accumulatedDepreciation.scaled + amount.scaled >= base.scaled;

  return { assetId: asset.id, amount, fullyDepreciatedAfter };
}
