import { Money } from "../money/index.js";
import { shareOfBase } from "../exchange-rates/convert.js";

export enum FxItemEventKind {
  Relief = "relief",
  Reopening = "reopening",
  Close = "close",
}

export interface FxItemEvent {
  readonly kind: FxItemEventKind;
  readonly ref: string;
  readonly day: string;
  readonly at: string;
  readonly amount: Money;
  readonly by?: string;
}

export interface FxItemTimeline {
  readonly opened: Money;
  readonly events: readonly FxItemEvent[];
}

export interface RunShareStep {
  readonly kind: FxItemEventKind;
  readonly ref: string;
  readonly day: string;
  readonly by?: string;
  readonly amount: Money;
}

export interface RunShareWalk {
  readonly remaining: Money;
  readonly steps: readonly RunShareStep[];
  takenBy(ref: string): Money;
}

// INVARIANT: amounts are base at the item's own booked rate, so a part over the balance open is the same fraction as its foreign amount over the foreign balance, with no conversion to round. Events of one instant keep the order given — a relief before its own re-opening.
export function fxItemTimeline(opened: Money, events: readonly FxItemEvent[]): FxItemTimeline {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.day !== b.event.day ? (a.event.day < b.event.day ? -1 : 1) : a.event.at !== b.event.at ? (a.event.at < b.event.at ? -1 : 1) : a.index - b.index))
    .map((entry) => entry.event);
  return { opened, events: ordered };
}

function openAfter(open: bigint, event: FxItemEvent): bigint {
  if (event.kind === FxItemEventKind.Relief) return open - event.amount.scaled;
  if (event.kind === FxItemEventKind.Reopening) return open + event.amount.scaled;
  return 0n;
}

export function fxItemOpenOn(timeline: FxItemTimeline, day: string): Money {
  let open = timeline.opened.scaled;
  for (const event of timeline.events) if (event.day <= day) open = openAfter(open, event);
  return Money.fromScaled(open);
}

// INVARIANT: the one place a run's share of an item is measured after the run's day. A re-opening returns only the part of its relief that is open again: when reliefs entered since have already closed the item, what they took stays taken, or the share would be left standing on a closed document. The settlement posted in date order, the run posted late and the carrying amount read by a later run all call it, so they cannot disagree (fx-order-independence.test.ts). An event dated on the run's own day is one the run already restated.
export function walkRunShare(timeline: FxItemTimeline, run: { readonly day: string; readonly share: Money }, upTo?: string): RunShareWalk {
  let open = timeline.opened.scaled;
  let remaining = run.share.scaled;
  const taken = new Map<string, bigint>();
  const steps: RunShareStep[] = [];
  for (const event of timeline.events) {
    if (upTo !== undefined && event.day > upTo) break;
    if (event.day > run.day) {
      let moved = 0n;
      if (event.kind === FxItemEventKind.Reopening) {
        const held = taken.get(event.ref) ?? 0n;
        const after = open + event.amount.scaled;
        const reopened = after <= 0n ? 0n : open >= 0n ? event.amount.scaled : after;
        moved = shareOfBase(Money.fromScaled(held), Money.fromScaled(reopened), event.amount).scaled;
        taken.set(event.ref, held - moved);
        remaining += moved;
      } else {
        moved = event.kind === FxItemEventKind.Close || event.amount.scaled >= open ? remaining : shareOfBase(Money.fromScaled(remaining), event.amount, Money.fromScaled(open)).scaled;
        taken.set(event.ref, (taken.get(event.ref) ?? 0n) + moved);
        remaining -= moved;
      }
      if (moved !== 0n) steps.push({ kind: event.kind, ref: event.ref, day: event.day, ...(event.by ? { by: event.by } : {}), amount: Money.fromScaled(moved) });
    }
    open = openAfter(open, event);
  }
  return { remaining: Money.fromScaled(remaining), steps, takenBy: (ref) => Money.fromScaled(taken.get(ref) ?? 0n) };
}
