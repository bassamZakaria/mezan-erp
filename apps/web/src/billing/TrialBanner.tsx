import { CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../lib/count-phrase";
import { Link } from "react-router";
import { useTenantBilling } from "./hooks";
import { routePathForScreen } from "../routing";
import { useAppTranslation } from "../i18n";

/**
 * «تبقّى ٥ أيام من تجربتك» — the reverse trial's countdown.
 *
 * Counted on the TENANT's calendar day, which the server sends: a browser in
 * another timezone must not tell an Egyptian shop it has a day less than it
 * has. It says what happens on day 15 — the tenant moves to the free plan and
 * keeps working — because the point of DEC-31 is that nothing is taken away,
 * and a countdown with no ending reads as a threat.
 */
export function TrialBanner() {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const billing = useTenantBilling().data;
  const daysLeft = billing?.trialDaysLeft ?? null;
  if (billing?.subscription?.status !== "trialing" || daysLeft === null) return null;

  const urgent = daysLeft <= 3;
  return (
    <div
      role="status"
      className={`mb-[16px] flex flex-wrap items-center gap-[10px] rounded-md border px-[14px] py-[10px] text-[12.5px] ${
        urgent ? "border-warning bg-warning-soft text-warning-ink" : "border-border bg-surface-2 text-ink"
      }`}
    >
      <span className="font-semibold">
        {daysLeft === 0 ? t("trial.endsToday") : t("trial.daysLeft", { days: countPhrase(daysLeft, CountedNoun.Day) })}
      </span>
      <span className="text-ink-muted">{t("trial.thenFree")}</span>
      {billing.intendedPlan ? (
        <span className="text-ink-muted">
          {t("trial.intendedPlan", { plan: locale === "ar" ? billing.intendedPlan.nameAr : billing.intendedPlan.nameEn })}
        </span>
      ) : null}
      <Link
        to={`/${routePathForScreen("settings-billing")}`}
        className="font-semibold text-brand underline underline-offset-2"
      >
        {t("trial.seePlans")}
      </Link>
    </div>
  );
}
