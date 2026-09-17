/**
 * What the simplified regime would cost, and what would disqualify the tenant
 * from it — computed from posted sales, never asserted.
 *
 * The charge is on GROSS TURNOVER, not on profit, which is the whole point of
 * the regime and also the figure Mezan is least sure of: "حجم الأعمال" in the
 * statute is not defined here as an accounting term, and the turnover this
 * module is handed is the net of the posted sales invoices (`sales.by-period`).
 * That is a defensible reading, not a verified one — so every result carries
 * `estimate: true` and the surfaces that render it say ESTIMATE.
 */

import { Money } from "../money/index.js";
import {
  bandForTurnover,
  type SimplifiedRegimeBand,
  type SimplifiedRegimeSchedule,
} from "./simplified-regime-schedule.js";

const RATE_SCALE = 1_000_000n;

/** HALF_UP on magnitudes — the TAX_COMPUTATION rounding boundary. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** base × rate% at the TAX_COMPUTATION boundary, HALF_UP, exact throughout. */
export function taxOnBase(base: Money, ratePercent: number): Money {
  const rateScaled = BigInt(Math.round(ratePercent * Number(RATE_SCALE)));
  return Money.fromScaled(divRoundHalfUp(base.scaled * rateScaled, 100n * RATE_SCALE));
}

export type TurnoverStanding =
  /** At or under the ceiling — the ordinary case. */
  | "within_ceiling"
  /** Over the ceiling but inside the overshoot the statute grants a grace year for. */
  | "grace_overshoot"
  /** Beyond even the grace — the regime does not reach this turnover at all. */
  | "over_ceiling";

export interface SimplifiedRegimeLiability {
  readonly turnover: Money;
  readonly standing: TurnoverStanding;
  readonly band: SimplifiedRegimeBand | null;
  readonly ratePercent: number | null;
  /** Null when no band or grace rate applies — an unpriceable case, never a zero. */
  readonly tax: Money | null;
  /** The articles every figure above was read from, for the citation line on screen. */
  readonly sources: readonly string[];
  /** Always true. Mezan estimates; the ETA assesses. */
  readonly estimate: true;
}

/**
 * The charge on `turnover` under `schedule`.
 *
 * A turnover above the ceiling is not an error: the statute grants one grace
 * year at the top rate for an overshoot within its tolerance, and beyond that
 * the answer is "this regime does not apply", which the caller must be able to
 * show rather than silently receive as a large number.
 */
export function computeSimplifiedRegimeLiability(
  schedule: SimplifiedRegimeSchedule,
  turnover: Money,
): SimplifiedRegimeLiability {
  const ceiling = schedule.turnoverCeiling.value;
  const grace = schedule.overshootGrace.value;
  const graceCeiling = Money.fromScaled(
    ceiling.scaled + divRoundHalfUp(ceiling.scaled * BigInt(Math.round(grace.overshootPercent * 1_000_000)), 100n * 1_000_000n),
  );

  if (turnover.scaled <= ceiling.scaled) {
    const band = bandForTurnover(schedule, turnover);
    return {
      turnover,
      standing: "within_ceiling",
      band,
      ratePercent: band?.ratePercent ?? null,
      tax: band ? taxOnBase(turnover, band.ratePercent) : null,
      sources: band ? [band.source] : [schedule.turnoverCeiling.source],
      estimate: true,
    };
  }

  if (turnover.scaled <= graceCeiling.scaled) {
    return {
      turnover,
      standing: "grace_overshoot",
      band: null,
      ratePercent: grace.ratePercent,
      tax: taxOnBase(turnover, grace.ratePercent),
      sources: [schedule.overshootGrace.source, schedule.turnoverCeiling.source],
      estimate: true,
    };
  }

  return {
    turnover,
    standing: "over_ceiling",
    band: null,
    ratePercent: null,
    tax: null,
    sources: [schedule.turnoverCeiling.source],
    estimate: true,
  };
}

export interface ClientTurnover {
  readonly customerId: string;
  readonly customerName: string;
  readonly turnover: Money;
}

export interface ConcentrationReading {
  readonly totalTurnover: Money;
  /** The clients the statute measures across — the largest `clientCount` of them. */
  readonly topClients: readonly ClientTurnover[];
  /** Their combined share of turnover, in percent, to two places. */
  readonly topSharePercent: number;
  readonly thresholdPercent: number;
  /**
   * TRUE means "this MAY disqualify you", never "you are disqualified". The
   * exclusion turns on facts Mezan does not hold — related parties, contracts
   * spanning years, who the client actually is — so the code computes the
   * number and the taxpayer's accountant decides.
   */
  readonly mayDisqualify: boolean;
  readonly source: string;
}

/**
 * The ≥90%-from-one-or-two-clients test, computed and SHOWN, not decided.
 *
 * Percent is derived on scaled integers and rounded once at the end, so a
 * concentration of exactly the threshold reads as exactly the threshold rather
 * than as 89.999999 from float drift.
 */
export function computeClientConcentration(
  schedule: SimplifiedRegimeSchedule,
  clients: readonly ClientTurnover[],
): ConcentrationReading {
  const test = schedule.concentration.value;
  const total = Money.sum(clients.map((client) => client.turnover));
  const ranked = [...clients].sort((a, b) => (b.turnover.scaled > a.turnover.scaled ? 1 : b.turnover.scaled < a.turnover.scaled ? -1 : 0));
  const top = ranked.slice(0, test.clientCount);
  const topTotal = Money.sum(top.map((client) => client.turnover));
  const sharePercent =
    total.scaled === 0n ? 0 : Number(divRoundHalfUp(topTotal.scaled * 10_000n, total.scaled)) / 100;
  return {
    totalTurnover: total,
    topClients: top,
    topSharePercent: sharePercent,
    thresholdPercent: test.sharePercent,
    mayDisqualify: total.scaled > 0n && sharePercent >= test.sharePercent,
    source: schedule.concentration.source,
  };
}
