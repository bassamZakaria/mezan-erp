import { Money } from "../money/index.js";
import type { Opportunity } from "./opportunity.js";

export interface ForecastFigures {
  readonly count: number;
  readonly amount: Money;
  readonly weighted: Money;
}

export interface ForecastOwnerRow extends ForecastFigures {
  readonly ownerUserId: string | null;
}

export interface ForecastMonthRow extends ForecastFigures {
  /** `YYYY-MM`, or null for deals with no expected close date. */
  readonly month: string | null;
  readonly owners: readonly ForecastOwnerRow[];
}

export interface WeightedForecast {
  readonly months: readonly ForecastMonthRow[];
  readonly owners: readonly ForecastOwnerRow[];
  readonly total: ForecastFigures;
}

const BASIS_POINTS = 10_000n;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])/;

/**
 * Expected value × probability, in exact scaled integers: the probability is
 * read to two decimal places and the quotient rounds half-up at the sixth
 * decimal, so no float touches the figure.
 */
export function weightedAmount(amount: Money, probabilityPercent: number): Money {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(probabilityPercent) ? probabilityPercent : 0));
  const basisPoints = BigInt(Math.round(clamped * 100));
  const product = amount.scaled * basisPoints;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  const rounded = (magnitude + BASIS_POINTS / 2n) / BASIS_POINTS;
  return Money.fromScaled(negative ? -rounded : rounded);
}

export function forecastMonthOf(expectedCloseDate: string | null): string | null {
  if (expectedCloseDate === null) return null;
  const match = MONTH_PATTERN.exec(expectedCloseDate);
  return match ? expectedCloseDate.slice(0, 7) : null;
}

interface Accumulator {
  count: number;
  amount: Money;
  weighted: Money;
}

function accumulate(into: Accumulator, opportunity: Opportunity): void {
  into.count += 1;
  into.amount = into.amount.add(opportunity.expectedValue);
  into.weighted = into.weighted.add(weightedAmount(opportunity.expectedValue, opportunity.probability));
}

function empty(): Accumulator {
  return { count: 0, amount: Money.zero(), weighted: Money.zero() };
}

function compareOwners(a: ForecastOwnerRow, b: ForecastOwnerRow): number {
  if (a.ownerUserId === b.ownerUserId) return 0;
  if (a.ownerUserId === null) return 1;
  if (b.ownerUserId === null) return -1;
  return a.ownerUserId < b.ownerUserId ? -1 : 1;
}

function ownerRows(groups: ReadonlyMap<string | null, Accumulator>): ForecastOwnerRow[] {
  return [...groups.entries()].map(([ownerUserId, figures]) => ({ ownerUserId, ...figures })).sort(compareOwners);
}

/**
 * The weighted pipeline by expected close month, per rep and in total. Only
 * open deals count — a won deal is revenue, a lost one is nothing. The caller
 * passes the opportunities the requester may see, so the total here equals
 * exactly what the board shows. Every figure is a sum of the same per-deal
 * weighted amounts, so months, reps and the total reconcile to the unit.
 */
export function buildWeightedForecast(opportunities: readonly Opportunity[]): WeightedForecast {
  const byMonth = new Map<string | null, { figures: Accumulator; owners: Map<string | null, Accumulator> }>();
  const byOwner = new Map<string | null, Accumulator>();
  const total = empty();

  for (const opportunity of opportunities) {
    if (opportunity.status !== "open") continue;
    const month = forecastMonthOf(opportunity.expectedCloseDate);
    let bucket = byMonth.get(month);
    if (!bucket) {
      bucket = { figures: empty(), owners: new Map() };
      byMonth.set(month, bucket);
    }
    let monthOwner = bucket.owners.get(opportunity.ownerUserId);
    if (!monthOwner) {
      monthOwner = empty();
      bucket.owners.set(opportunity.ownerUserId, monthOwner);
    }
    let owner = byOwner.get(opportunity.ownerUserId);
    if (!owner) {
      owner = empty();
      byOwner.set(opportunity.ownerUserId, owner);
    }
    accumulate(bucket.figures, opportunity);
    accumulate(monthOwner, opportunity);
    accumulate(owner, opportunity);
    accumulate(total, opportunity);
  }

  const months = [...byMonth.entries()]
    .map(([month, bucket]) => ({ month, ...bucket.figures, owners: ownerRows(bucket.owners) }))
    .sort((a, b) => (a.month === b.month ? 0 : a.month === null ? 1 : b.month === null ? -1 : a.month < b.month ? -1 : 1));

  return { months, owners: ownerRows(byOwner), total };
}
