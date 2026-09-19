import type { Money } from "../money/money.js";
import type { PaymentProviderId } from "./payment-provider.js";
import type { Plan } from "./plan.js";
import type { Subscription } from "./subscription.js";
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
  /** Compare-and-set: moves the row only while its status is one of `from`; false when another settlement got there first. */
  settle(id: string, from: readonly CardCheckoutStatus[], to: CardCheckoutSettlement): Promise<boolean>;
  /** Undoes a `paid` settlement whose payment could not be written, so the provider's retry can settle it again. */
  reopen(id: string, now: string): Promise<boolean>;
  /** Inserts the provider's transaction id under a unique key; false when it was already claimed. */
  claimProviderEvent(provider: PaymentProviderId, providerRef: string, now: string): Promise<boolean>;
  releaseProviderEvent(provider: PaymentProviderId, providerRef: string): Promise<void>;
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
