/**
 * Aging policy for the inventory write-down batch (docs/archive/phase-backlog.md Phase 4
 * "Aging-based inventory write-down batch"). Pure math only — no repository
 * dependency, mirroring `fixed-assets/depreciation.ts`'s split between pure
 * period/rate math and the run that reads live data.
 *
 * A position's "aging" is the number of whole days since its last stock
 * movement (in OR out) — a position nobody has touched in a while is
 * "slow-moving". The policy maps an aging-day count to a write-down rate
 * (basis points of the position's recorded WAC value); bands are inclusive of
 * `minDays`, exclusive of `maxDays` (or unbounded when `maxDays` is null).
 */

import { Money } from "../money/index.js";

export interface AgingBand {
  /** Inclusive lower bound, in whole days since the last movement. */
  readonly minDays: number;
  /** Exclusive upper bound, or null for "and beyond". */
  readonly maxDays: number | null;
  /** Write-down rate applied to the position's WAC value, in basis points (100 = 1%). */
  readonly writedownRateBps: number;
}

/**
 * The default policy: nothing under 90 days is considered slow-moving; 90-180
 * days provisions 10%, 180-365 days provisions 25%, 365+ days provisions 50%.
 * A tenant may pass its own bands to `createWritedownRun` — this is only the
 * shipped default.
 */
export const DEFAULT_AGING_WRITEDOWN_POLICY: readonly AgingBand[] = [
  { minDays: 90, maxDays: 180, writedownRateBps: 1_000 },
  { minDays: 180, maxDays: 365, writedownRateBps: 2_500 },
  { minDays: 365, maxDays: null, writedownRateBps: 5_000 },
];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `date` (ISO "YYYY-MM-DD") shifted back `months` calendar months, clamped to the target month's last day. */
function subtractMonths(date: string, months: number): string {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const shifted = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(Math.min(day, lastDay))}`;
}

/**
 * The tenant's own aging policy (settings §"سياسة المخزون" — مخصص هبوط المخزون
 * الراكد): one band, "anything untouched for `months` calendar months is
 * provisioned at `ratePercent`". The month count is converted against the run's
 * own period end, so a run over February ages by February's real calendar.
 */
export function tenantAgingPolicy(period: string, months: number, ratePercent: number): readonly AgingBand[] {
  const end = periodEndDate(period);
  return [
    {
      minDays: agingDaysBetween(subtractMonths(end, months), end),
      maxDays: null,
      writedownRateBps: Math.round(ratePercent * 100),
    },
  ];
}

/** Last calendar day of a "YYYY-MM" period, as a "YYYY-MM-DD" ISO date. */
export function periodEndDate(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new RangeError(`Invalid period: "${period}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(daysInMonth)}`;
}

/** Whole-day difference between an ISO date/date-time `lastActivityAt` and an ISO date `asOfDate` (never negative). */
export function agingDaysBetween(lastActivityAt: string, asOfDate: string): number {
  const lastMs = Date.parse(lastActivityAt.length <= 10 ? `${lastActivityAt}T00:00:00Z` : lastActivityAt);
  const asOfMs = Date.parse(`${asOfDate}T00:00:00Z`);
  const days = Math.floor((asOfMs - lastMs) / 86_400_000);
  return Math.max(0, days);
}

/** The write-down rate (basis points) for a given aging-day count under `policy`; 0 if no band matches. */
export function writedownRateForAgingDays(
  agingDays: number,
  policy: readonly AgingBand[] = DEFAULT_AGING_WRITEDOWN_POLICY,
): number {
  for (const band of policy) {
    if (agingDays >= band.minDays && (band.maxDays === null || agingDays < band.maxDays)) {
      return band.writedownRateBps;
    }
  }
  return 0;
}

/** HALF_UP division of two bigints on their magnitudes (0.5 rounds away from zero) — same policy as wac-math.ts. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Applies a basis-point rate to a Money value, rounded HALF_UP. `rateBps <= 0` returns zero. */
export function applyRateBps(value: Money, rateBps: number): Money {
  if (rateBps <= 0) return Money.zero();
  return Money.fromScaled(divRoundHalfUp(value.scaled * BigInt(rateBps), 10_000n));
}
