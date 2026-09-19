import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { Button, Card, Money, useFormat } from "@mezan/ui";
import type { BillingCycleDTO, SubscriptionStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { CardCheckoutChip, CheckoutOutcomeNotice, CHECKOUT_POLL_LIMIT_MS, TestModeChip } from "./CardCheckoutStatus";
import { useStartRenewal, useTenantBilling, useTenantCheckout } from "./hooks";

const STATUS_LABEL: Record<SubscriptionStatusDTO, AppTranslationKey> = {
  trialing: "platform.subscriptionStatus.trialing",
  active: "platform.subscriptionStatus.active",
  past_due: "platform.subscriptionStatus.past_due",
  suspended: "platform.subscriptionStatus.suspended",
  cancelled: "platform.subscriptionStatus.cancelled",
};

const CYCLE_LABEL: Record<BillingCycleDTO, AppTranslationKey> = {
  monthly: "platform.billingCycle.monthly",
  yearly: "platform.billingCycle.yearly",
};

/**
 * «الاشتراك» — the cloud tenant's own subscription and its «تجديد الاشتراك»
 * by card. Renders nothing on an edition without subscription billing.
 */
export function SubscriptionCard() {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnedCheckout = searchParams.get("checkout");
  const [returnedAt] = useState(() => Date.now());
  const billing = useTenantBilling();
  const renew = useStartRenewal();
  const returned = useTenantCheckout(returnedCheckout, returnedAt);

  const data = billing.data;
  if (!data) return null;
  const { subscription } = data;

  return (
    <Card className="mt-[16px] p-[16px]">
      <div className="mb-[12px] flex flex-wrap items-center gap-[8px]">
        <h2 className="text-[13px] font-bold text-ink">{t("billing.title")}</h2>
        {data.testMode ? <TestModeChip /> : null}
      </div>

      {returnedCheckout ? (
        <div className="mb-[12px] rounded-md border border-border bg-surface-2 p-[12px]">
          {returned.isError ? (
            <p role="alert" className="text-[12.5px] font-semibold text-danger-ink">{returned.error.message}</p>
          ) : (
            <CheckoutOutcomeNotice checkout={returned.data} timedOut={returned.dataUpdatedAt - returnedAt >= CHECKOUT_POLL_LIMIT_MS} />
          )}
        </div>
      ) : null}

      {subscription ? (
        <div className="flex flex-col gap-[10px]">
          <Row label={t("billing.plan")} value={locale === "ar" ? subscription.planNameAr : subscription.planNameEn} />
          <Row label={t("billing.status")} value={t(STATUS_LABEL[subscription.status])} />
          <Row label={t("billing.cycle")} value={t(CYCLE_LABEL[subscription.billingCycle])} />
          <Row label={t("billing.periodEnd")} value={format.date(subscription.currentPeriodEnd)} numeric />
          <div className="flex items-center justify-between gap-[10px] text-[12.5px]">
            <span className="text-ink-muted">{t("billing.amountDue")}</span>
            <Money value={Number(subscription.amountDue)} />
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-muted">{t("billing.noSubscription")}</p>
      )}

      {renew.error ? (
        <p role="alert" className="mt-[10px] text-[12.5px] font-semibold text-danger-ink">{renew.error.message}</p>
      ) : null}

      {data.canRenew ? (
        <div className="mt-[14px] flex flex-wrap items-center gap-[10px] border-t border-border pt-[12px]">
          <Button variant="primary" disabled={renew.isPending} onClick={() => renew.start(location.pathname)}>
            {renew.isPending ? t("billing.renew.opening") : t("billing.renew")}
          </Button>
          <span className="text-[11.5px] text-ink-faint">{data.testMode ? t("billing.renew.testHint") : t("billing.renew.hint")}</span>
        </div>
      ) : !data.cardCheckout && subscription ? (
        <p className="mt-[12px] text-[11.5px] text-ink-faint">{t("billing.cardUnavailable")}</p>
      ) : null}

      {data.checkouts.length > 0 ? (
        <div className="mt-[14px] flex flex-col gap-[8px] border-t border-border pt-[12px]">
          <span className="text-xs font-semibold text-ink-muted">{t("billing.history")}</span>
          {data.checkouts.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-[10px]">
              <div className="flex items-center gap-[8px]">
                <CardCheckoutChip status={c.status} />
                <span className="text-[11px] text-ink-faint">{format.date(c.createdAt)}</span>
              </div>
              <Money value={Number(c.amount)} />
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function Row({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-[10px] text-[12.5px]">
      <span className="text-ink-muted">{label}</span>
      <span className={`font-semibold text-ink ${numeric ? "mz-num" : ""}`}>{value}</span>
    </div>
  );
}
