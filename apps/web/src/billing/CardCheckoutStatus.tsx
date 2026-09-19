import { StatusPill, type PillTone } from "@mezan/ui";
import type { CardCheckoutDTO, CardCheckoutStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const TONE: Record<CardCheckoutStatusDTO, PillTone> = {
  pending: "info",
  paid: "success",
  failed: "danger",
  unapplied: "warning",
};

const LABEL: Record<CardCheckoutStatusDTO, AppTranslationKey> = {
  pending: "billing.checkoutStatus.pending",
  paid: "billing.checkoutStatus.paid",
  failed: "billing.checkoutStatus.failed",
  unapplied: "billing.checkoutStatus.unapplied",
};

export function CardCheckoutChip({ status }: { status: CardCheckoutStatusDTO }) {
  const { t } = useAppTranslation();
  return <StatusPill label={t(LABEL[status])} tone={TONE[status]} />;
}

export function TestModeChip() {
  const { t } = useAppTranslation();
  return <StatusPill label={t("billing.testMode")} tone="warning" />;
}

/** The test double hands back a same-origin path; a live checkout is Paymob's absolute URL. */
export function absoluteCheckoutUrl(checkout: Pick<CardCheckoutDTO, "checkoutUrl">): string | null {
  if (!checkout.checkoutUrl) return null;
  return new URL(checkout.checkoutUrl, window.location.origin).toString();
}

/**
 * The outcome shown after the browser comes back from the hosted checkout. It
 * reads the checkout's status from the server — which only the verified
 * webhook moves — and never the `success=` the provider appends to the URL.
 */
export function CheckoutOutcomeNotice({ checkout, timedOut }: { checkout: CardCheckoutDTO | undefined; timedOut: boolean }) {
  const { t } = useAppTranslation();
  if (!checkout) return null;
  const { key, tone } = outcomeCopy(checkout.status, timedOut);
  return (
    <p role="status" className={`text-[12.5px] font-semibold ${tone}`}>
      {t(key)}
    </p>
  );
}

function outcomeCopy(status: CardCheckoutStatusDTO, timedOut: boolean): { key: AppTranslationKey; tone: string } {
  switch (status) {
    case "paid":
      return { key: "billing.outcome.paid", tone: "text-success-ink" };
    case "failed":
      return { key: "billing.outcome.failed", tone: "text-danger-ink" };
    case "unapplied":
      return { key: "billing.outcome.unapplied", tone: "text-warning-ink" };
    default:
      return timedOut ? { key: "billing.outcome.stillPending", tone: "text-warning-ink" } : { key: "billing.outcome.waiting", tone: "text-ink-muted" };
  }
}

export const CHECKOUT_POLL_MS = 3_000;
export const CHECKOUT_POLL_LIMIT_MS = 120_000;
