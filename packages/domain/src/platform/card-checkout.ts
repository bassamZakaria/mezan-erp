import type { Money } from "../money/money.js";
import type { PaymentProviderId } from "./payment-provider.js";
import type { Plan } from "./plan.js";
import type { Subscription } from "./subscription.js";
import type { Payment } from "./payment.js";
import { moneyToPaymobCents } from "./paymob.js";

export type CardCheckoutStatus = "pending" | "paid" | "failed" | "unapplied";

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
  readonly failureReason: string | null;
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardCheckoutSettlement {
  readonly status: Exclude<CardCheckoutStatus, "pending">;
  readonly providerRef: string | null;
  readonly paymentId: string | null;
  readonly failureReason: string | null;
  readonly now: string;
}

export interface CardCheckoutRepository {
  insert(checkout: CardCheckout): Promise<void>;
  findById(id: string): Promise<CardCheckout | null>;
  findByProviderOrder(provider: PaymentProviderId, providerOrderRef: string): Promise<CardCheckout | null>;
  listByTenant(tenantId: string): Promise<CardCheckout[]>;
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
  }): Promise<"duplicate" | "settled" | "unchanged">;
  /** Moves a checkout that never reached the provider; no transaction id is involved. */
  abandon(checkoutId: string, failureReason: string, now: string): Promise<void>;
  /**
   * Settles a paid checkout atomically: claims the transaction id, moves the
   * checkout to `paid`, writes the renewed subscription (compare-and-set on its
   * `updatedAt`) and inserts the payment. Either all of it commits or none of it.
   */
  settlePaid(input: {
    readonly provider: PaymentProviderId;
    readonly providerRef: string;
    readonly now: string;
    readonly checkoutId: string;
    readonly from: readonly CardCheckoutStatus[];
    readonly subscriptionBefore: Subscription;
    readonly subscriptionAfter: Subscription;
    readonly payment: Payment;
  }): Promise<"duplicate" | "already-settled" | "subscription-changed" | "paid">;
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

const RENEWABLE: readonly Subscription["status"][] = ["trialing", "active", "past_due"];

/**
 * What one card checkout charges: the plan's price for the subscription's own
 * cycle, computed here and never taken from the caller.
 */
export function cardCheckoutAmount(plan: Plan, subscription: Subscription): Money {
  if (!RENEWABLE.includes(subscription.status)) {
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
