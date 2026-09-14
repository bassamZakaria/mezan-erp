import type { Money } from "../money/money.js";

export interface PaymentProvider {
  createCheckout(input: {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly amount: Money;
    readonly returnUrl: string;
  }): Promise<{ readonly url: string; readonly providerRef: string }>;

  verifyWebhook(
    rawBody: string,
    signature: string,
  ): Promise<{ readonly providerRef: string; readonly amount: Money; readonly paidAt: string } | null>;
}
