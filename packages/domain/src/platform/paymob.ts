import { Money } from "../money/money.js";
import type { ProviderTransactionOutcome } from "./payment-provider.js";

// Paymob's documented concatenation order for the Transaction Processed
// callback HMAC (HMAC-SHA512, lowercase hex, key = the merchant's HMAC secret).
// The order is a contract with Paymob, not alphabetical in the dotted names:
// reordering, adding or dropping a key makes every genuine callback fail.
// https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback
export const PAYMOB_TRANSACTION_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

export type PaymobTransactionObject = Readonly<Record<string, unknown>>;

function readPath(obj: PaymobTransactionObject, dotted: string): unknown {
  let current: unknown = obj;
  for (const key of dotted.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hmacPart(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return String(value);
  return "";
}

/** The exact string Paymob signs for a Transaction Processed callback's `obj`. */
export function paymobTransactionHmacMessage(obj: PaymobTransactionObject): string {
  return PAYMOB_TRANSACTION_HMAC_FIELDS.map((field) => hmacPart(readPath(obj, field))).join("");
}

const CENTS_PER_MAJOR_SCALED = 10_000n;

/** EGP piasters for the Intention API's `amount`; `null` when the amount is not a whole number of piasters. */
export function moneyToPaymobCents(amount: Money): number | null {
  if (amount.scaled % CENTS_PER_MAJOR_SCALED !== 0n) return null;
  const cents = amount.scaled / CENTS_PER_MAJOR_SCALED;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

export function paymobCentsToMoney(cents: number): Money | null {
  if (!Number.isSafeInteger(cents)) return null;
  return Money.fromScaled(BigInt(cents) * CENTS_PER_MAJOR_SCALED);
}

function flag(obj: PaymobTransactionObject, key: string): boolean {
  return readPath(obj, key) === true;
}

/**
 * Only a settled, captured, first-hand sale counts as paid. A refund or void
 * arrives as its own transaction with a parent; an auth-only hold has not moved
 * money yet.
 */
export function classifyPaymobTransaction(obj: PaymobTransactionObject): ProviderTransactionOutcome {
  if (flag(obj, "pending")) return "pending";
  if (flag(obj, "has_parent_transaction") || flag(obj, "is_refunded") || flag(obj, "is_voided") || flag(obj, "is_auth")) {
    return "not_a_payment";
  }
  if (flag(obj, "success") && !flag(obj, "error_occured")) return "paid";
  return "failed";
}

export interface ParsedPaymobTransaction {
  readonly providerRef: string;
  readonly providerOrderRef: string;
  readonly merchantRef: string | null;
  readonly amount: Money;
  readonly currency: string;
  readonly outcome: ProviderTransactionOutcome;
  readonly occurredAt: string;
}

function idString(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return value;
  return null;
}

export function parsePaymobTransaction(obj: PaymobTransactionObject): ParsedPaymobTransaction | null {
  const providerRef = idString(readPath(obj, "id"));
  const providerOrderRef = idString(readPath(obj, "order.id"));
  const cents = readPath(obj, "amount_cents");
  const currency = readPath(obj, "currency");
  const createdAt = readPath(obj, "created_at");
  if (!providerRef || !providerOrderRef || typeof cents !== "number" || typeof currency !== "string") return null;
  const amount = paymobCentsToMoney(cents);
  if (!amount) return null;
  const merchant = readPath(obj, "order.merchant_order_id") ?? readPath(obj, "merchant_order_id");
  return {
    providerRef,
    providerOrderRef,
    merchantRef: typeof merchant === "string" && merchant !== "" ? merchant : null,
    amount,
    currency,
    outcome: classifyPaymobTransaction(obj),
    occurredAt: typeof createdAt === "string" ? createdAt : "",
  };
}
