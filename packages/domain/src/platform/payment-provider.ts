import type { Money } from "../money/money.js";

export type PaymentProviderId = "paymob" | "paymob-test";

export interface CheckoutRequest {
  readonly checkoutId: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly amount: Money;
  readonly description: string;
  readonly customer: { readonly email: string; readonly name: string };
  readonly returnUrl: string;
  readonly notificationUrl: string;
}

export interface CheckoutSession {
  readonly url: string;
  readonly providerOrderRef: string;
}

export type ProviderTransactionOutcome = "paid" | "failed" | "pending" | "not_a_payment";

export interface VerifiedProviderTransaction {
  readonly providerRef: string;
  readonly providerOrderRef: string;
  readonly merchantRef: string | null;
  readonly amount: Money;
  readonly currency: string;
  readonly outcome: ProviderTransactionOutcome;
  readonly occurredAt: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly testMode: boolean;
  createCheckout(input: CheckoutRequest): Promise<CheckoutSession>;
  /** `null` means the signature did not verify: nothing in the body may be acted on. */
  verifyWebhook(rawBody: string, signature: string): Promise<VerifiedProviderTransaction | null>;
}
