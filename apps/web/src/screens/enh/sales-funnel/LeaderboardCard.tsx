import { CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../../../lib/count-phrase";
import { useQuery } from "@tanstack/react-query";
import { leaderboardCardSchema, type LeaderboardCardDTO } from "@mezan/contracts";
import { ENGLISH_LOCALE, Card, EmptyState, Money as MoneyDisplay } from "@mezan/ui";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { majorOf } from "../../../lib/money";

function useLeaderboardCard(): ReturnType<typeof useQuery<LeaderboardCardDTO, ApiError>> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeaderboardCardDTO, ApiError>({
    queryKey: ["sales-funnel", "leaderboard-card"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/sales-funnel/leaderboard-card");
      if (!res.ok) throw await loaderError(res, t("salesFunnel.card.loadFailed"), t);
      return leaderboardCardSchema.parse(await res.json());
    },
  });
}

export function LeaderboardCard() {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const query = useLeaderboardCard();
  const card = query.data ?? null;

  return (
    <Card className="mb-[16px] p-[14px_16px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-[14px] font-bold text-ink">{t("salesFunnel.card.title")}</h2>
          <p className="mt-[3px] text-[12px] text-ink-muted">{t("salesFunnel.card.subtitle")}</p>
        </div>
        {card ? (
          <p className="text-[12px] text-ink-muted">
            {t("salesFunnel.card.total")}: <MoneyDisplay value={majorOf(card.totalRevenue)} />
          </p>
        ) : null}
      </div>
      {query.isError ? (
        <p role="alert" className="mt-[10px] text-[12.5px] font-semibold text-danger-ink">
          {query.error?.message ?? t("salesFunnel.card.loadFailed")}
        </p>
      ) : null}
      {card && card.entries.length === 0 ? (
        <EmptyState title={t("salesFunnel.card.empty")} />
      ) : (
        <ol className="mt-[10px] flex flex-col gap-[8px]">
          {(card?.entries ?? []).map((entry) => (
            <li key={entry.repId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface p-[9px_12px]">
              <span className="flex items-center gap-[10px]">
                <span className="mz-num inline-flex h-[24px] w-[24px] items-center justify-center rounded-full bg-surface-2 text-[12px] font-bold text-ink">{entry.rank}</span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold text-ink">{locale === ENGLISH_LOCALE ? entry.nameEn : entry.nameAr}</span>
                  <span className="text-[11px] text-ink-muted">{t("salesFunnel.card.deals", { count: countPhrase(entry.invoiceCount, CountedNoun.Invoice) })}</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                <span className="text-[13px] font-bold text-ink">
                  <MoneyDisplay value={majorOf(entry.revenue)} />
                </span>
                {entry.grossMargin !== undefined ? (
                  <span>
                    {t("salesFunnel.card.margin")}: <MoneyDisplay value={majorOf(entry.grossMargin)} />
                  </span>
                ) : null}
                {entry.conversionRate !== null ? (
                  <span>
                    {t("salesFunnel.card.conversion")}: <span className="mz-num">{entry.conversionRate.toFixed(0)}%</span>
                  </span>
                ) : null}
                <span>
                  {t("salesFunnel.card.collected")}: <MoneyDisplay value={majorOf(entry.collected)} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
