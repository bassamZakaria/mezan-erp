import { CardCheckoutAttentionCause, CardCheckoutResolution } from "@mezan/domain";
import type { AppTranslationKey } from "../i18n";

const ATTENTION_CAUSE_KEY: Readonly<Record<CardCheckoutAttentionCause, AppTranslationKey>> = {
  [CardCheckoutAttentionCause.Refund]: "platform.cardCheckout.attention.REFUND",
  [CardCheckoutAttentionCause.Void]: "platform.cardCheckout.attention.VOID",
  [CardCheckoutAttentionCause.NotACapture]: "platform.cardCheckout.attention.NOT_A_CAPTURE",
  [CardCheckoutAttentionCause.OtherCheckout]: "platform.cardCheckout.attention.OTHER_CHECKOUT",
  [CardCheckoutAttentionCause.Unreadable]: "platform.cardCheckout.attention.UNREADABLE",
};

const RESOLVED_KEY: Readonly<Record<CardCheckoutResolution, AppTranslationKey>> = {
  [CardCheckoutResolution.Reviewed]: "platform.cardCheckout.resolved.REVIEWED",
  [CardCheckoutResolution.AppliedByHand]: "platform.cardCheckout.resolved.APPLIED_BY_HAND",
  [CardCheckoutResolution.Refunded]: "platform.cardCheckout.resolved.REFUNDED",
};

export function attentionCauseKey(cause: string | null): AppTranslationKey {
  const known = cause === null ? undefined : (ATTENTION_CAUSE_KEY as Readonly<Record<string, AppTranslationKey | undefined>>)[cause];
  return known ?? "platform.cardCheckout.reason.NEEDS_ATTENTION";
}

export function resolvedKey(resolution: string): AppTranslationKey {
  return (RESOLVED_KEY as Readonly<Record<string, AppTranslationKey | undefined>>)[resolution] ?? "platform.cardCheckout.reason.other";
}
