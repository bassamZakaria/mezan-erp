import { Money } from "../../money/index.js";
import { percentOf } from "../certificates/amounts.js";
import { daysBetweenDates } from "./exceptions.js";
import type { RetentionReleaseKind } from "./retention-release.js";

/**
 * المحتجزات — the arithmetic of what is held, what may be released and when.
 *
 * `held` and `released` are read off the POSTED ledger (account 1150 by
 * project), never off a stored total: a second copy of the retention balance
 * is the figure that ends up disagreeing with the control account.
 */

export interface RetentionPosition {
  /** Σ debits on the retention account for the project — what the certificates withheld. */
  readonly held: Money;
  /** Σ credits — what has been released back into receivables. */
  readonly released: Money;
  readonly balance: Money;
}

export function retentionPositionOf(debits: Money, credits: Money): RetentionPosition {
  return {
    held: debits,
    released: credits,
    balance: Money.fromScaled(debits.scaled - credits.scaled),
  };
}

/** The payable side (2195): a subcontractor's retention is a credit balance. */
export function retentionPayablePositionOf(debits: Money, credits: Money): RetentionPosition {
  return {
    held: credits,
    released: debits,
    balance: Money.fromScaled(credits.scaled - debits.scaled),
  };
}

/** The last day of the month `date` falls in, +`months` months, keeping the day of month where it exists. */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split("-").map((part) => Number(part));
  const year = y ?? 1970;
  const monthIndex = (m ?? 1) - 1 + months;
  const day = d ?? 1;
  const target = new Date(Date.UTC(year, monthIndex, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export interface ReleaseEventInput {
  readonly provisionalHandoverDate: string | null;
  readonly finalHandoverDate: string | null;
  readonly defectsLiabilityMonths: number;
}

/**
 * The date the tranche becomes due — التسليم الابتدائي for the first,
 * التسليم النهائي + فترة الضمان for the last. Null when the handover it
 * depends on has not been recorded: the calendar then says so rather than
 * inventing a date the collector would chase.
 */
export function releaseEventDateOf(kind: RetentionReleaseKind, contract: ReleaseEventInput): string | null {
  if (kind === "provisional") return contract.provisionalHandoverDate;
  if (kind === "final") {
    return contract.finalHandoverDate === null
      ? null
      : addMonthsToDate(contract.finalHandoverDate, contract.defectsLiabilityMonths);
  }
  return null;
}

export function isEarlyRelease(date: string, releaseEventDate: string | null): boolean {
  return releaseEventDate !== null && date < releaseEventDate;
}

export interface ReleaseCapInput {
  readonly kind: RetentionReleaseKind;
  readonly position: RetentionPosition;
  readonly provisionalReleasePercent: string;
  /** Already released under the `provisional` tranche, so the percentage is a ceiling and not a per-document allowance. */
  readonly provisionalReleasedToDate: Money;
}

/**
 * The most this document may release. The percentage ceiling is cumulative:
 * two provisional releases of 40% each must not add up to 80% of what was
 * held, which is what a per-document check would allow.
 */
export function releaseCapOf(input: ReleaseCapInput): Money {
  const balance = input.position.balance;
  if (input.kind !== "provisional") return balance;
  const ceiling = percentOf(input.position.held, input.provisionalReleasePercent);
  const remaining = Money.fromScaled(ceiling.scaled - input.provisionalReleasedToDate.scaled);
  const capped = remaining.scaled < 0n ? Money.zero() : remaining;
  return capped.scaled < balance.scaled ? capped : balance;
}

export interface RetentionCalendarEventInput extends ReleaseEventInput {
  readonly position: RetentionPosition;
  readonly provisionalReleasePercent: string;
  readonly provisionalReleasedToDate: Money;
  readonly asOfDate: string;
}

export interface RetentionCalendarEvent {
  readonly kind: RetentionReleaseKind | null;
  readonly date: string | null;
  readonly daysToEvent: number | null;
  readonly due: boolean;
  /**
   * Days since the event fell due — the ONLY ageing retention has. Null while
   * the event is still ahead, because a balance that is not yet claimable is
   * not overdue (design §06).
   */
  readonly ageDays: number | null;
}

/**
 * The next release event the contract is waiting on: the provisional tranche
 * while its percentage ceiling is not exhausted, then the final one.
 */
export function nextRetentionEvent(input: RetentionCalendarEventInput): RetentionCalendarEvent {
  const provisionalRemaining = releaseCapOf({
    kind: "provisional",
    position: input.position,
    provisionalReleasePercent: input.provisionalReleasePercent,
    provisionalReleasedToDate: input.provisionalReleasedToDate,
  });
  let kind: RetentionReleaseKind | null = null;
  if (input.position.balance.scaled > 0n) {
    if (provisionalRemaining.scaled > 0n && input.provisionalHandoverDate !== null) kind = "provisional";
    else if (input.finalHandoverDate !== null) kind = "final";
  }
  const date = kind === null ? null : releaseEventDateOf(kind, input);
  if (date === null) return { kind, date: null, daysToEvent: null, due: false, ageDays: null };
  const daysToEvent = daysBetweenDates(input.asOfDate, date);
  const due = date <= input.asOfDate;
  return { kind, date, daysToEvent, due, ageDays: due ? -daysToEvent : null };
}
