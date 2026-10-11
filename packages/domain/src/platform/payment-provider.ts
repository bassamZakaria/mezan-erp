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

export enum ProviderTransactionOutcome {
  Paid = "paid",
  Failed = "failed",
  Pending = "pending",
  NotAPayment = "not_a_payment",
}

export enum ProviderNonPaymentKind {
  Refund = "refund",
  Void = "void",
  Other = "other",
}

export interface VerifiedProviderTransaction {
  readonly providerRef: string;
  readonly providerOrderRef: string;
  readonly merchantRef: string | null;
  readonly amount: Money;
  readonly currency: string;
  readonly outcome: ProviderTransactionOutcome;
  readonly nonPayment?: ProviderNonPaymentKind | null;
  readonly occurredAt: string;
}

export enum ProviderInquiryStatus {
  Found = "found",
  /** The provider said, in so many words, that it holds no transaction for this order. Silence or an odd answer is never this. */
  None = "none",
  /** The provider answered about THIS order and the answer cannot be read or trusted. Other orders are unaffected. */
  Unreadable = "unreadable",
  /** The provider itself could not be asked (network, credentials, outage); every other order would fare the same. */
  Unavailable = "unavailable",
}

export type ProviderInquiry =
  | { readonly status: ProviderInquiryStatus.Found; readonly transaction: VerifiedProviderTransaction }
  | { readonly status: ProviderInquiryStatus.None }
  | { readonly status: ProviderInquiryStatus.Unreadable; readonly reason: string }
  | { readonly status: ProviderInquiryStatus.Unavailable; readonly reason: string };

export interface ProviderInquiryRequest {
  readonly providerOrderRef: string;
  readonly merchantRef: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly testMode: boolean;
  createCheckout(input: CheckoutRequest): Promise<CheckoutSession>;
  /** `null` means the signature did not verify: nothing in the body may be acted on. */
  verifyWebhook(rawBody: string, signature: string): Promise<VerifiedProviderTransaction | null>;
  /**
   * Asks the provider what became of an order, for the callback that never
   * arrived. Never throws for a provider-side failure: that is `Unavailable`
   * or `Unreadable`, neither of which a caller may read as "no payment".
   */
  inquireTransaction(input: ProviderInquiryRequest): Promise<ProviderInquiry>;
}
