import type { Cheque, ChequeStatus, ChequeStoredStatus } from "./cheque.js";
import { InvalidChequeTransitionError } from "./errors.js";

/**
 * Days before `dueDate` a still-pending cheque is considered "تحت التحصيل"
 * (sent for bank collection ahead of its due date) rather than plain "قيد
 * الانتظار". Not configurable per docs/archive/catalog/04 — no such setting is
 * documented; a fixed, generous window keeps the derivation deterministic.
 */
export const COLLECTION_WINDOW_DAYS = 3;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The 7-state status a UI/report shows, derived from the 5 stored states plus
 * `dueDate` vs. `asOfDate`. Only a `pending` cheque is ever split into
 * pending/under_collection/due_today — every other stored status (deposited,
 * collected, bounced, replaced) is a manual action outcome and passes through
 * unchanged (see cheque.ts's module doc for why this split exists).
 */
export function effectiveChequeStatus(cheque: Pick<Cheque, "status" | "dueDate">, asOfDate: string): ChequeStatus {
  if (cheque.status !== "pending") return cheque.status;
  if (asOfDate >= cheque.dueDate) return "due_today";
  if (asOfDate >= addDays(cheque.dueDate, -COLLECTION_WINDOW_DAYS)) return "under_collection";
  return "pending";
}

/** Legal stored-status transitions per manual action (docs/archive/catalog/04's 7-state lifecycle). */
export type ChequeAction = "deposit" | "collect" | "bounce" | "replace" | "return";

const ALLOWED_FROM: Record<ChequeAction, ChequeStoredStatus> = {
  deposit: "pending",
  collect: "deposited",
  bounce: "deposited",
  replace: "bounced",
  return: "collected",
};

const TARGET_STATUS: Record<ChequeAction, ChequeStoredStatus> = {
  deposit: "deposited",
  collect: "collected",
  bounce: "bounced",
  replace: "replaced",
  return: "bounced",
};

/** Guard one manual transition; throws {@link InvalidChequeTransitionError} when illegal. */
export function assertChequeTransition(cheque: Cheque, action: ChequeAction): void {
  if (cheque.status !== ALLOWED_FROM[action]) {
    throw new InvalidChequeTransitionError(cheque.id, cheque.status, TARGET_STATUS[action]);
  }
}
