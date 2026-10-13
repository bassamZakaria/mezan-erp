import type { Money } from "../money/money.js";
import type { PaymentProviderId } from "./payment-provider.js";
import type { Plan } from "./plan.js";
import { RENEWABLE_SUBSCRIPTION_STATES, type Subscription } from "./subscription.js";
import type { Payment } from "./payment.js";
import { moneyToPaymobCents } from "./paymob.js";

export enum CardCheckoutStatus {
  Pending = "pending",
  Paid = "paid",
  Failed = "failed",
  Unapplied = "unapplied",
  Refunded = "refunded",
}

export enum CardCheckoutAttentionCause {
  Refund = "REFUND",
  Void = "VOID",
  NotACapture = "NOT_A_CAPTURE",
  OtherCheckout = "OTHER_CHECKOUT",
  Unreadable = "UNREADABLE",
}

export enum CardCheckoutResolution {
  Reviewed = "REVIEWED",
  AppliedByHand = "APPLIED_BY_HAND",
  Refunded = "REFUNDED",
}

export enum CardCheckoutFailureReason {
  ProviderError = "PROVIDER_ERROR",
  Declined = "DECLINED",
  Expired = "EXPIRED",
  NeedsAttention = "NEEDS_ATTENTION",
  AmountMismatch = "AMOUNT_MISMATCH",
  PriceChanged = "PRICE_CHANGED",
  SubscriptionNotRenewable = "SUBSCRIPTION_NOT_RENEWABLE",
  ReferenceAlreadyRecorded = "REFERENCE_ALREADY_RECORDED",
}

export enum ProviderEventOutcome {
  Duplicate = "duplicate",
  Settled = "settled",
  Unchanged = "unchanged",
}

export enum PaidSettlementOutcome {
  Duplicate = "duplicate",
  AlreadySettled = "already-settled",
  SubscriptionChanged = "subscription-changed",
  ReferenceTaken = "reference-taken",
  Paid = "paid",
}

export interface CardCheckout {
  readonly id: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly provider: PaymentProviderId;
  readonly amount: Money;
  readonly currency: "EGP";
  readonly status: CardCheckoutStatus;
  readonly providerOrderRef: string | null;
  readonly checkoutUrl: string | null;
  readonly providerRef: string | null;
  readonly paymentId: string | null;
  readonly failureReason: CardCheckoutFailureReason | null;
  readonly capturedAmount: Money | null;
  readonly requestedBy: string;
  readonly attentionCause: CardCheckoutAttentionCause | null;
  readonly resolution: CardCheckoutResolution | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolutionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardCheckoutSettlement {
  readonly status: Exclude<CardCheckoutStatus, CardCheckoutStatus.Pending>;
  readonly providerRef: string | null;
  readonly paymentId: string | null;
  readonly failureReason: CardCheckoutFailureReason | null;
  readonly capturedAmount?: Money | null;
  readonly now: string;
}

export interface CardCheckoutRepository {
  insert(checkout: CardCheckout): Promise<void>;
  findById(id: string): Promise<CardCheckout | null>;
  findByProviderOrder(provider: PaymentProviderId, providerOrderRef: string): Promise<CardCheckout | null>;
  listByTenant(tenantId: string): Promise<CardCheckout[]>;
  listSweepable(openedAtOrBefore: string, declinedOpenedAfter: string, limit: number): Promise<CardCheckout[]>;
  markSwept(checkoutId: string, now: string): Promise<void>;
  flagNeedsAttention(checkoutId: string, cause: CardCheckoutAttentionCause, now: string): Promise<boolean>;
  resolveFlagged(input: {
    readonly checkoutId: string;
    readonly resolution: CardCheckoutResolution;
    readonly status: CardCheckoutStatus.Pending | CardCheckoutStatus.Refunded;
    readonly resolvedBy: string;
    readonly reason: string;
    readonly now: string;
  }): Promise<boolean>;
  attachSession(id: string, providerOrderRef: string, checkoutUrl: string, now: string): Promise<void>;
  /**
   * Claims the provider's transaction id and, when `settle` is given, moves the
   * checkout by compare-and-set — both in ONE transaction. `duplicate` means the
   * transaction id was already processed and nothing changed.
   */
  recordOutcome(input: {
    readonly provider: PaymentProviderId;
    readonly providerRef: string;
    readonly now: string;
    readonly settle?: { readonly checkoutId: string; readonly from: readonly CardCheckoutStatus[]; readonly to: CardCheckoutSettlement };
  }): Promise<ProviderEventOutcome>;
  /** Moves a checkout that never reached the provider; no transaction id is involved. */
  abandon(checkoutId: string, failureReason: CardCheckoutFailureReason, now: string): Promise<void>;
  /**
   * Settles a paid checkout atomically: claims the transaction id, moves the
   * checkout to `paid`, writes the renewed subscription (compare-and-set on its
   * `updatedAt`) and inserts the payment. Either all of it commits or none of it.
   * `ReferenceTaken` means the tenant already holds a payment under this one's
   * reference and nothing at all was written, the claim included.
   */
  settlePaid(input: {
    readonly provider: PaymentProviderId;
    readonly providerRef: string;
    /**
     * What is claimed as "already processed". Defaults to `providerRef`; an
     * operator applying an `unapplied` payment by hand claims its own key,
     * because the provider's transaction id was claimed when it first arrived.
     */
    readonly claimRef?: string;
    readonly now: string;
    readonly checkoutId: string;
    readonly from: readonly CardCheckoutStatus[];
    readonly subscriptionBefore: Subscription;
    readonly subscriptionAfter: Subscription;
    readonly payment: Payment;
  }): Promise<PaidSettlementOutcome>;
}

export class CardCheckoutUnavailableError extends Error {
  readonly code = "CARD_CHECKOUT_UNAVAILABLE";
  readonly messageEn: string;
  constructor(readonly reasons: string[], reasonsEn: string[]) {
    super(`تعذّر بدء الدفع بالبطاقة: ${reasons.join("، ")}`);
    this.messageEn = `Card checkout unavailable: ${reasonsEn.join("; ")}`;
    this.name = "CardCheckoutUnavailableError";
  }
}

export class CardPaymentNotApplicableError extends Error {
  readonly code = "CARD_PAYMENT_NOT_APPLICABLE";
  readonly messageEn: string;
  constructor(readonly reasons: string[], reasonsEn: string[]) {
    super(`تعذّر تطبيق دفعة البطاقة: ${reasons.join("، ")}`);
    this.messageEn = `The card payment cannot be applied: ${reasonsEn.join("; ")}`;
    this.name = "CardPaymentNotApplicableError";
  }
}

/**
 * What one card checkout charges: the plan's price for the subscription's own
 * cycle, computed here and never taken from the caller.
 */
export function cardCheckoutAmount(plan: Plan, subscription: Subscription): Money {
  if (!RENEWABLE_SUBSCRIPTION_STATES.includes(subscription.status)) {
    throw new CardCheckoutUnavailableError(
      [`حالة الاشتراك "${subscription.status}" لا تسمح بالتجديد`],
      [`subscription status "${subscription.status}" cannot be renewed`],
    );
  }
  const amount = subscription.billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
  if (amount.scaled <= 0n) {
    throw new CardCheckoutUnavailableError(["سعر الباقة صفر"], ["the plan price is zero"]);
  }
  if (moneyToPaymobCents(amount) === null) {
    throw new CardCheckoutUnavailableError(["سعر الباقة ليس بالقرش الصحيح"], ["the plan price is not a whole number of piasters"]);
  }
  return amount;
}
