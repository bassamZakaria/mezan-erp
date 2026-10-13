import { Money, Qty, allocate } from "../money/index.js";
import { extend } from "./wac-math.js";

export enum StockChangeKind {
  Addition = "addition",
  Removal = "removal",
  Revaluation = "revaluation",
}

export interface StockHolding {
  readonly onHand: Qty;
  readonly totalValue: Money;
}

export interface StockAddition {
  readonly kind: StockChangeKind.Addition;
  readonly qty: Qty;
  readonly unitCost: Money;
  readonly stated: Money;
  readonly recorded?: Money | null;
}

export interface StockRemoval {
  readonly kind: StockChangeKind.Removal;
  readonly qty: Qty;
  readonly unitCost: Money;
  readonly stated?: Money;
  readonly recorded?: Money | null;
}

export interface StockRevaluation {
  readonly kind: StockChangeKind.Revaluation;
  readonly delta: Money;
  readonly receipt: { readonly remaining: bigint; readonly original: bigint } | null;
  readonly undoes?: Money;
  readonly recorded?: Money | null;
}

export type StockChange = StockAddition | StockRemoval | StockRevaluation;

export interface StockChangeResult extends StockHolding {
  readonly valueChange: Money;
  readonly layeredQty: Qty;
  // INVARIANT: what the caller's document stated the position's value would
  // change by, less what it did change by. The control account moved by the
  // stated figure, so the caller books this against cost in the same entry
  // (credit inventory when positive) or the sub-ledger and 1200 part.
  readonly difference: Money;
}

// INVARIANT: every quantity or value change to a stock position is decided
// here, for the live engine and for the replay alike. A position that holds
// units never holds a negative value, one that holds none holds no value, and
// value never lands on units that are not on hand.
// `recorded` is the replay's: what the ledger stored for a movement is taken
// as it stands, because the engine decided it here against the position as it
// stood then — and documents are not always entered in date order.
export function changeStockPosition(held: StockHolding, change: StockChange): StockChangeResult {
  switch (change.kind) {
    case StockChangeKind.Addition:
      return add(held, change);
    case StockChangeKind.Removal:
      return remove(held, change);
    case StockChangeKind.Revaluation:
      return revalue(held, change);
  }
}

function add(held: StockHolding, change: StockAddition): StockChangeResult {
  const onHand = held.onHand.add(change.qty);
  if (!held.onHand.isNegative()) {
    const entered = change.recorded ?? change.stated;
    return { onHand, totalValue: held.totalValue.add(entered), valueChange: entered, layeredQty: change.qty, difference: change.stated.add(entered.negate()) };
  }
  const short = held.onHand.negate();
  const levels = change.qty.compare(short) >= 0;
  const covered = levels ? short : change.qty;
  const excess = change.qty.subtract(covered);
  const carried = held.totalValue.negate();
  const coverValue = levels ? carried : (allocate(carried, [covered.scaled, short.scaled - covered.scaled])[0] as Money);
  const valueChange = change.recorded ?? coverValue.add(excess.isZero() ? Money.zero() : extend(excess, change.unitCost));
  return { onHand, totalValue: held.totalValue.add(valueChange), valueChange, layeredQty: excess, difference: change.stated.add(valueChange.negate()) };
}

function remove(held: StockHolding, change: StockRemoval): StockChangeResult {
  const onHand = held.onHand.subtract(change.qty);
  const taken = change.recorded ?? (onHand.isZero() ? held.totalValue : valueLeaving(held, onHand, extend(change.qty, change.unitCost)));
  const valueChange = taken.negate();
  const stated = change.stated ?? taken;
  return { onHand, totalValue: held.totalValue.add(valueChange), valueChange, layeredQty: Qty.zero(), difference: taken.add(stated.negate()) };
}

function valueLeaving(held: StockHolding, remaining: Qty, atCost: Money): Money {
  if (held.totalValue.scaled < 0n) return atCost;
  if (remaining.isNegative()) return held.onHand.isNegative() || atCost.scaled > held.totalValue.scaled ? atCost : held.totalValue;
  return atCost.scaled > held.totalValue.scaled ? held.totalValue : atCost;
}

function revalue(held: StockHolding, change: StockRevaluation): StockChangeResult {
  const absorbed = change.recorded ?? absorbable(held, change);
  return { onHand: held.onHand, totalValue: held.totalValue.add(absorbed), valueChange: absorbed, layeredQty: Qty.zero(), difference: change.delta.add(absorbed.negate()) };
}

function absorbable(held: StockHolding, change: StockRevaluation): Money {
  if (held.onHand.scaled <= 0n) return Money.zero();
  const share = change.receipt ? receiptShare(change.delta, change.receipt.remaining, change.receipt.original) : change.delta;
  const capped = change.undoes && magnitude(share) > magnitude(change.undoes) ? change.undoes.negate() : share;
  if (capped.scaled >= 0n) return capped;
  if (held.totalValue.scaled <= 0n) return Money.zero();
  return capped.scaled < -held.totalValue.scaled ? held.totalValue.negate() : capped;
}

function receiptShare(amount: Money, remaining: bigint, original: bigint): Money {
  if (original <= 0n || remaining <= 0n) return Money.zero();
  if (remaining >= original) return amount;
  return allocate(amount, [remaining, original - remaining])[0] as Money;
}

function magnitude(amount: Money): bigint {
  return amount.scaled < 0n ? -amount.scaled : amount.scaled;
}
