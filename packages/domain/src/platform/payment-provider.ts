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
  None = "none",
  Unreadable = "unreadable",
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
  // CONTRACT: never throws for a provider-side failure. That is `Unavailable`
  // or `Unreadable`, and neither may be read as "no payment".
  inquireTransaction(input: ProviderInquiryRequest): Promise<ProviderInquiry>;
}
