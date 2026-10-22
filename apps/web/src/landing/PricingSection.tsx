import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Money, Segmented, StatusPill, cn } from "@mezan/ui";
import type { PublicPlanDTO } from "@mezan/contracts";
import { CountedNoun } from "@mezan/domain";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useCountPhrase } from "../lib/count-phrase";
import { entitlementModuleLabel } from "../domain-labels";
import { fetchPublicPlans } from "../signup/signup-api";

export const PUBLIC_PLANS_QUERY_KEY = ["signup", "plans"] as const;

enum BillingCycle {
  Monthly = "monthly",
  Yearly = "yearly",
}

enum PlanCode {
  Free = "free",
  Core = "core",
  Business = "business",
  Enterprise = "enterprise",
}

const POPULAR_PLAN = PlanCode.Business;
const MONTHS_PAID_FOR_A_YEAR = 10;

const AUDIENCE: Record<PlanCode, AppTranslationKey> = {
  [PlanCode.Free]: "landing.pricing.audience.free",
  [PlanCode.Core]: "landing.pricing.audience.core",
  [PlanCode.Business]: "landing.pricing.audience.business",
  [PlanCode.Enterprise]: "landing.pricing.audience.enterprise",
};

const SALES_INVOICE_QUOTA = "sales_invoices_per_month";

function audienceOf(code: string): AppTranslationKey | null {
  return (AUDIENCE as Readonly<Record<string, AppTranslationKey | undefined>>)[code] ?? null;
}

function isFree(plan: PublicPlanDTO): boolean {
  return Number(plan.priceMonthly) === 0 && Number(plan.priceYearly) === 0;
}

/** Only claim "two months free" when every paid plan really is priced that way; the console can change prices. */
function yearlySavesTwoMonths(plans: readonly PublicPlanDTO[]): boolean {
  const paid = plans.filter((plan) => !isFree(plan));
  return paid.length > 0 && paid.every((plan) => Number(plan.priceYearly) === Number(plan.priceMonthly) * MONTHS_PAID_FOR_A_YEAR);
}

function PlanCard({ plan, previous, cycle }: { plan: PublicPlanDTO; previous: PublicPlanDTO | null; cycle: BillingCycle }) {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const popular = plan.code === POPULAR_PLAN;
  const name = locale === "ar" ? plan.nameAr : plan.nameEn;
  const price = cycle === BillingCycle.Monthly ? plan.priceMonthly : plan.priceYearly;
  const audience = audienceOf(plan.code);
  const invoiceCap = plan.quotas?.[SALES_INVOICE_QUOTA];
  const builtOn = previous !== null && previous.modules.every((id) => plan.modules.includes(id)) ? previous : null;
  const inherited = new Set(builtOn?.modules ?? []);
  const added = plan.modules.filter((id) => !inherited.has(id));
  const limits = [
    countPhrase(plan.seatsIncluded, CountedNoun.User),
    countPhrase(plan.branchesIncluded, CountedNoun.Branch),
    countPhrase(plan.warehousesIncluded, CountedNoun.Warehouse),
    ...(invoiceCap === undefined ? [] : [t("landing.pricing.invoices", { count: countPhrase(invoiceCap, CountedNoun.Invoice) })]),
  ];

  return (
    <article
      data-testid={`landing-plan-${plan.code}`}
      className={cn(
        "relative flex flex-col rounded-lg bg-surface p-[22px] shadow-1",
        popular ? "border-2 border-brand shadow-2" : "border border-border",
      )}
    >
      {popular ? (
        <span className="absolute -top-[13px] start-[20px] rounded-pill bg-brand px-[12px] py-[3px] text-xs font-bold text-brand-ink">
          {t("landing.pricing.popular")}
        </span>
      ) : null}
      <h3 className="font-display text-xl font-bold text-ink">{name}</h3>
      {audience ? <p className="mt-[2px] min-h-[40px] text-[13px] text-ink-muted">{t(audience)}</p> : null}
      <p className="mt-[14px] flex flex-wrap items-baseline gap-x-[6px]">
        {isFree(plan) ? (
          <span className="font-display text-[28px] font-bold text-ink">{t("landing.pricing.free")}</span>
        ) : (
          <>
            <Money value={price} className="text-[26px] font-bold text-ink" />
            <span className="text-[13px] text-ink-muted">{t(cycle === BillingCycle.Monthly ? "landing.pricing.perMonth" : "landing.pricing.perYear")}</span>
          </>
        )}
      </p>
      <Link
        to={`/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`}
        className={cn(
          "mt-[16px] inline-flex min-h-[44px] items-center justify-center rounded-md border px-[15px] text-[14px] font-semibold transition-colors",
          popular ? "border-brand bg-brand text-brand-ink hover:bg-brand-strong" : "border-border-strong bg-surface text-ink hover:bg-surface-2",
        )}
      >
        {t("landing.pricing.choose")}
      </Link>
      <ul className="mt-[18px] flex flex-col gap-[6px] border-b border-border pb-[14px] text-[13px] text-ink">
        {limits.map((limit) => (
          <li key={limit} className="font-semibold">
            {limit}
          </li>
        ))}
      </ul>
      <p className="mt-[14px] text-xs font-semibold text-ink-muted">
        {builtOn ? t("landing.pricing.everything", { plan: locale === "ar" ? builtOn.nameAr : builtOn.nameEn }) : t("landing.pricing.includes")}
      </p>
      <ul className="mt-[8px] flex flex-col gap-[6px] text-[13px] text-ink">
        {added.map((id) => (
          <li key={id} className="flex items-start gap-[8px]">
            <svg viewBox="0 0 16 16" className="mt-[3px] h-[14px] w-[14px] flex-none text-accent" aria-hidden="true">
              <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {entitlementModuleLabel(id, t)}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PricingSection() {
  const { t } = useAppTranslation();
  const [cycle, setCycle] = useState<BillingCycle>(BillingCycle.Monthly);
  const plansQuery = useQuery<PublicPlanDTO[]>({ queryKey: PUBLIC_PLANS_QUERY_KEY, queryFn: fetchPublicPlans });
  const plans = plansQuery.data ?? [];
  const savesTwoMonths = yearlySavesTwoMonths(plans);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-[12px]">
        <Segmented
          aria-label={t("landing.pricing.cycle")}
          value={cycle}
          onChange={(key) => setCycle(key === BillingCycle.Yearly ? BillingCycle.Yearly : BillingCycle.Monthly)}
          options={[
            { key: BillingCycle.Monthly, label: t("landing.pricing.monthly") },
            { key: BillingCycle.Yearly, label: t("landing.pricing.yearly") },
          ]}
        />
        {savesTwoMonths ? <StatusPill tone="success" label={t("landing.pricing.yearlySave")} /> : null}
      </div>

      {plansQuery.isPending ? (
        <p className="mt-[24px] text-[14px] text-ink-muted" role="status">
          {t("landing.pricing.loading")}
        </p>
      ) : plansQuery.isError ? (
        <div className="mt-[24px] flex flex-wrap items-center gap-[12px]" role="alert">
          <p className="text-[14px] text-ink">{t("landing.pricing.failed")}</p>
          <Button onClick={() => void plansQuery.refetch()}>{t("landing.pricing.retry")}</Button>
        </div>
      ) : (
        <div className="mt-[28px] grid gap-[20px] sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan, index) => (
            <PlanCard key={plan.id} plan={plan} previous={index > 0 ? plans[index - 1]! : null} cycle={cycle} />
          ))}
        </div>
      )}

      <p className="mt-[18px] text-[13px] text-ink-muted">{t("landing.pricing.vat")}</p>
      <p className="mt-[4px] text-[13px] text-ink-muted">{t("landing.pricing.more")}</p>
    </div>
  );
}
