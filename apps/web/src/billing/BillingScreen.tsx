import { ArabicCase, CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../lib/count-phrase";
import { useState } from "react";
import { useLocation } from "react-router";
import { Button, Card, Money, StatusPill } from "@mezan/ui";
import type { BillingLimitDTO, BillingModuleDTO, BillingQuotaDTO, BillingPlanOfferDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { SubscriptionCard } from "./SubscriptionCard";
import { useEntitlements } from "../data/hooks";
import { useEditionHasSubscriptionBilling, useStartModuleTrial, useStartRenewal, useTenantBilling } from "./hooks";

const QUOTA_LABEL: Record<BillingQuotaDTO["kind"], AppTranslationKey> = {
  sales_invoices_per_month: "plan.quota.salesInvoicesPerMonth",
};

const LIMIT_LABEL: Record<BillingLimitDTO["limit"], AppTranslationKey> = {
  seats: "plan.limit.seats",
  branches: "plan.limit.branches",
  warehouses: "plan.limit.warehouses",
};

const MODULE_STATE_LABEL: Record<BillingModuleDTO["state"], AppTranslationKey> = {
  active: "plan.module.active",
  trialing: "plan.module.trialing",
  read_only: "plan.module.readOnly",
  locked: "plan.module.locked",
};

const MODULE_STATE_TONE: Record<BillingModuleDTO["state"], "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  trialing: "info",
  read_only: "warning",
  locked: "neutral",
};

/**
 * «الباقة والاستخدام» — the one screen that answers "what am I on, what have I
 * used, and what would I get if I paid".
 *
 * Every figure here is the SERVER's: the usage counts come from the tenant's
 * own rows on the tenant's own calendar month, so the number beside a quota is
 * the same number the refusal will quote. Computing any of it in the browser
 * would give the owner a second opinion that can disagree with the one that
 * actually stops the invoice.
 */
export function BillingScreen() {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const location = useLocation();
  const editionHasBilling = useEditionHasSubscriptionBilling();
  const entitlementsKnown = useEntitlements().data !== undefined;
  const billing = useTenantBilling();
  const renewal = useStartRenewal();
  const moduleTrial = useStartModuleTrial();
  const [pendingModule, setPendingModule] = useState<string | null>(null);
  const data = billing.data;

  const name = (ar: string, en: string) => (locale === "ar" ? ar : en);

  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <h1 className="font-display text-[17px] font-bold text-ink">{t("plan.title")}</h1>

      {entitlementsKnown && !editionHasBilling ? <p className="max-w-[68ch] text-[12.5px] text-ink-muted">{t("plan.noSubscriptionInThisEdition")}</p> : null}

      {billing.isError ? (
        <p role="alert" className="text-[12.5px] font-semibold text-danger-ink">
          {billing.error.message}
        </p>
      ) : null}

      {data?.subscription ? (
        <Card className="p-[16px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h2 className="text-[13px] font-bold text-ink">
              {name(data.subscription.planNameAr, data.subscription.planNameEn)}
            </h2>
            <StatusPill
              label={data.subscription.planKind === "free" ? t("plan.kind.free") : t("plan.kind.paid")}
              tone={data.subscription.planKind === "free" ? "info" : "success"}
            />
            {data.trialDaysLeft !== null ? (
              <StatusPill label={t("trial.daysLeft", { days: countPhrase(data.trialDaysLeft, CountedNoun.Day) })} tone="warning" />
            ) : null}
          </div>
          {data.subscription.planKind === "free" ? (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">{t("plan.freeNeverLapses")}</p>
          ) : null}
        </Card>
      ) : null}

      {data && (data.quotas.length > 0 || data.limits.length > 0) ? (
        <Card className="p-[16px]">
          <h2 className="mb-[12px] text-[13px] font-bold text-ink">
            {t("plan.usage.title", { month: data.month ?? "" })}
          </h2>
          <div className="flex flex-col gap-[10px]">
            {data.quotas.map((q) => (
              <UsageRow key={q.kind} label={t(QUOTA_LABEL[q.kind])} used={q.used} allowed={q.allowed} />
            ))}
            {data.limits.map((l) => (
              <UsageRow key={l.limit} label={t(LIMIT_LABEL[l.limit])} used={l.used} allowed={l.allowed} />
            ))}
          </div>
          <p className="mt-[10px] text-[11.5px] text-ink-faint">{t("plan.usage.creationOnly")}</p>
        </Card>
      ) : null}

      {data && data.modules.length > 0 ? (
        <Card className="p-[16px]">
          <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("plan.modules.title")}</h2>
          {moduleTrial.error ? (
            <p role="alert" className="mb-[10px] text-[12.5px] font-semibold text-danger-ink">
              {moduleTrial.error.message}
            </p>
          ) : null}
          <ul className="flex flex-col gap-[8px]">
            {data.modules.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-[8px]">
                <div className="flex items-center gap-[8px]">
                  <span className="text-[12.5px] font-semibold text-ink">{name(m.nameAr, m.nameEn)}</span>
                  <StatusPill label={t(MODULE_STATE_LABEL[m.state])} tone={MODULE_STATE_TONE[m.state]} />
                </div>
                {m.canTrial ? (
                  <Button
                    size="sm"
                    // Only THIS row is disabled while it is starting: a
                    // mutation-wide flag would grey out every other module.
                    disabled={pendingModule === m.id}
                    onClick={() => {
                      if (pendingModule !== null) return;
                      setPendingModule(m.id);
                      moduleTrial.mutate(
                        { module: m.id },
                        { onSettled: () => setPendingModule(null) },
                      );
                    }}
                  >
                    {pendingModule === m.id
                      ? t("plan.modules.starting")
                      : t("plan.modules.try", { days: countPhrase(data.moduleTrialDays, CountedNoun.Day, ArabicCase.Oblique) })}
                  </Button>
                ) : m.trialUsed && m.state !== "trialing" ? (
                  <StatusPill label={t("plan.modules.trialUsed")} tone="neutral" />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data && data.plans.length > 0 ? (
        <Card className="p-[16px]">
          <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("plan.offers.title")}</h2>
          <div className="flex flex-col gap-[12px]">
            {data.plans.map((p) => (
              <PlanOffer key={p.id} plan={p} nameOf={name} />
            ))}
          </div>
          {data.canRenew ? (
            <div className="mt-[14px] flex flex-wrap items-center gap-[10px] border-t border-border pt-[12px]">
              <Button
                variant="primary"
                disabled={renewal.isPending}
                onClick={() => renewal.start(location.pathname)}
              >
                {renewal.isPending ? t("billing.renew.opening") : t("plan.upgrade")}
              </Button>
              <span className="text-[11.5px] text-ink-faint">{t("plan.upgradeHint")}</span>
            </div>
          ) : null}
        </Card>
      ) : null}

      <SubscriptionCard />
    </div>
  );
}

function UsageRow({ label, used, allowed }: { label: string; used: number; allowed: number }) {
  const { t } = useAppTranslation();
  const over = used >= allowed;
  return (
    <div className="flex items-center justify-between gap-[10px] text-[12.5px]">
      <span className="text-ink-muted">{label}</span>
      {/*
        BIDI: «من» stays OUTSIDE the numeric runs. Putting the Arabic word
        inside one `mz-num` span with both figures reorders them on screen —
        "22 من 25" rendered as "22 25 من" — and a usage figure that reads
        backwards is worse than no figure at all.
      */}
      <span className={`font-semibold ${over ? "text-danger-ink" : "text-ink"}`}>
        <span className="mz-num">{used}</span> {t("plan.usage.of")} <span className="mz-num">{allowed}</span>
      </span>
    </div>
  );
}

function PlanOffer({
  plan,
  nameOf,
}: {
  plan: BillingPlanOfferDTO;
  nameOf: (ar: string, en: string) => string;
}) {
  const { t } = useAppTranslation();
  const invoiceQuota = plan.quotas["sales_invoices_per_month"];
  return (
    <div
      className={`rounded-md border p-[12px] ${plan.current ? "border-brand bg-brand-soft" : "border-border bg-surface-2"}`}
    >
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="text-[12.5px] font-bold text-ink">{nameOf(plan.nameAr, plan.nameEn)}</span>
        {plan.current ? <StatusPill label={t("plan.offers.current")} tone="info" /> : null}
        {plan.kind === "free" ? <StatusPill label={t("plan.kind.free")} tone="success" /> : null}
      </div>
      <div className="mt-[6px] flex flex-wrap items-center gap-[12px] text-[12px] text-ink-muted">
        <span className="flex items-center gap-[4px]">
          {t("plan.offers.monthly")}
          <Money value={Number(plan.priceMonthly)} />
        </span>
        <span>
          {t("plan.limit.seats")}: <span className="mz-num">{plan.seatsIncluded}</span>
        </span>
        <span>
          {t("plan.limit.branches")}: <span className="mz-num">{plan.branchesIncluded}</span>
        </span>
        <span>
          {t("plan.limit.warehouses")}: <span className="mz-num">{plan.warehousesIncluded}</span>
        </span>
        {invoiceQuota !== undefined ? (
          <span>
            {t("plan.quota.salesInvoicesPerMonth")}: <span className="mz-num">{invoiceQuota}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
