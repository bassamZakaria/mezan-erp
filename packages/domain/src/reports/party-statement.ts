import { Money } from "../money/index.js";

export type PartyStatementEntryKind =
  | "opening"
  | "invoice"
  | "return"
  | "receipt"
  | "payment"
  | "refund"
  | "cheque"
  | "cheque_returned"
  | "deduction"
  | "journal"
  | "imported";

/**
 * One movement on a party's account, in BASE currency. `increase` raises what
 * the party owes (a customer debit, a supplier credit); `decrease` lowers it.
 */
export interface PartyStatementEntry {
  readonly key: string;
  readonly date: string;
  readonly kind: PartyStatementEntryKind;
  readonly reference: string;
  readonly increase: Money;
  readonly decrease: Money;
  /** The invoices a receipt or payment was applied to. */
  readonly allocations?: readonly { readonly invoiceRef: string; readonly amount: Money }[];
}

export interface PartyStatementLine extends PartyStatementEntry {
  readonly balance: Money;
}

export interface PartyStatement {
  readonly lines: readonly PartyStatementLine[];
  readonly totalIncrease: Money;
  readonly totalDecrease: Money;
  readonly closing: Money;
}

/** Orders the movements by day and adds the running balance. */
export function buildPartyStatement(entries: readonly PartyStatementEntry[]): PartyStatement {
  const ordered = [...entries].sort((a, b) => {
    if (a.kind === "opening" && b.kind !== "opening") return -1;
    if (b.kind === "opening" && a.kind !== "opening") return 1;
    return a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date);
  });
  let running = 0n;
  let increase = 0n;
  let decrease = 0n;
  const lines = ordered.map((entry) => {
    running += entry.increase.scaled - entry.decrease.scaled;
    increase += entry.increase.scaled;
    decrease += entry.decrease.scaled;
    return { ...entry, balance: Money.fromScaled(running) };
  });
  return {
    lines,
    totalIncrease: Money.fromScaled(increase),
    totalDecrease: Money.fromScaled(decrease),
    closing: Money.fromScaled(running),
  };
}

/** A signed amount as an increase or a decrease. */
export function statementSides(amount: Money): { increase: Money; decrease: Money } {
  return amount.scaled >= 0n
    ? { increase: amount, decrease: Money.zero() }
    : { increase: Money.zero(), decrease: amount.negate() };
}
