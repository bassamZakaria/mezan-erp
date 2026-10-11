import { Money } from "../money/money.js";
import { ProviderTransactionOutcome } from "./payment-provider.js";

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

const SIGNED_BOOLEANS = [
  "error_occured", "has_parent_transaction", "is_3d_secure", "is_auth", "is_capture", "is_refunded",
  "is_standalone_payment", "is_voided", "pending", "success",
] as const;
const SIGNED_INTEGERS = ["amount_cents", "id", "integration_id", "order.id", "owner"] as const;
const SIGNED_TEXT_OR_NULL = ["source_data.pan", "source_data.sub_type", "source_data.type"] as const;

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The signed string joins values with no separator and cannot tell `true`
 * from `"true"` or `123` from `"123"`, so a genuine signature stays valid when
 * a field's JSON type is changed or two adjacent numbers are re-split. Every
 * signed field must therefore carry exactly the JSON type Paymob sends before
 * the signature is even computed.
 */
export function hasPaymobSignedShape(obj: PaymobTransactionObject): boolean {
  for (const key of SIGNED_BOOLEANS) if (typeof readPath(obj, key) !== "boolean") return false;
  for (const key of SIGNED_INTEGERS) if (!isSafeNonNegativeInteger(readPath(obj, key))) return false;
  for (const key of SIGNED_TEXT_OR_NULL) {
    const value = readPath(obj, key);
    if (value !== null && value !== undefined && typeof value !== "string") return false;
  }
  const currency = readPath(obj, "currency");
  const createdAt = readPath(obj, "created_at");
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
    && typeof createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(createdAt);
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
  if (flag(obj, "pending")) return ProviderTransactionOutcome.Pending;
  if (flag(obj, "has_parent_transaction") || flag(obj, "is_refunded") || flag(obj, "is_voided") || flag(obj, "is_auth")) {
    return ProviderTransactionOutcome.NotAPayment;
  }
  if (flag(obj, "success") && !flag(obj, "error_occured")) return ProviderTransactionOutcome.Paid;
  return ProviderTransactionOutcome.Failed;
}

export interface ParsedPaymobTransaction {
  readonly integrationId: number;
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
  const integrationId = readPath(obj, "integration_id");
  if (!isSafeNonNegativeInteger(integrationId)) return null;
  return {
    integrationId,
    providerRef,
    providerOrderRef,
    merchantRef: typeof merchant === "string" && merchant !== "" ? merchant : null,
    amount,
    currency,
    outcome: classifyPaymobTransaction(obj),
    occurredAt: typeof createdAt === "string" ? createdAt : "",
  };
}
