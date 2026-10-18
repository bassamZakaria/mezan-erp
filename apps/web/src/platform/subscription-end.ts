import { SubscriptionStatusCode, type SubscriptionDTO } from "@mezan/contracts";
import type { AppTranslationKey } from "../i18n";

export interface SubscriptionEnd {
  readonly labelKey: AppTranslationKey;
  readonly date: string;
  readonly isTrial: boolean;
}

export function subscriptionEndOf(subscription: Pick<SubscriptionDTO, "status" | "currentPeriodEnd" | "trialEndsAt">): SubscriptionEnd {
  if (subscription.status === SubscriptionStatusCode.Trialing && subscription.trialEndsAt) {
    return { labelKey: "platform.tenants.trialEnd", date: subscription.trialEndsAt, isTrial: true };
  }
  return { labelKey: "platform.tenants.periodEnd", date: subscription.currentPeriodEnd, isTrial: false };
}
