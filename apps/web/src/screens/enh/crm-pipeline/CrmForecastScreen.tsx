import { Fragment, useState } from "react";
import { Button, Card, EmptyState, Money as MoneyDisplay, StatCard } from "@mezan/ui";
import type { ForecastMonthRowDTO, ForecastOwnerRowDTO } from "@mezan/contracts";
import { SelectField } from "../../../settings/form-controls";
import { useBranches } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { majorOf } from "../../../lib/money";
import { useUrlParam } from "../../../lib/url-state";
import { useCrmAccess, useCrmForecast, useCrmOwners } from "./hooks";

const ALL = "";

function monthName(month: string, locale: string): string {
  const at = new Date(`${month}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en", { month: "long", year: "numeric", timeZone: "UTC" }).format(at);
}

export function CrmForecastScreen() {
  const { t, locale } = useAppTranslation();
  const access = useCrmAccess();
  const branches = useBranches().data ?? [];
  const owners = useCrmOwners().data ?? [];
  const [branchFilter, setBranchFilter] = useUrlParam("branch", ALL);
  const [ownerFilter, setOwnerFilter] = useUrlParam("rep", ALL);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const query = useCrmForecast(branchFilter, ownerFilter);
  const forecast = query.data ?? null;

  const ownerName = (id: string | null): string => (id === null ? t("crmPipeline.owner.none") : (owners.find((o) => o.id === id)?.name ?? t("crmPipeline.owner.other")));
  const monthLabel = (row: ForecastMonthRowDTO): string => (row.month === null ? t("crmPipeline.forecast.unscheduled") : monthName(row.month, locale));
  const monthKey = (row: ForecastMonthRowDTO): string => row.month ?? "none";

  function toggle(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const figures = (row: { count: number; amount: string; weighted: string }) => (
    <>
      <td className="px-[15px] py-[9px] text-end"><span className="mz-num">{row.count}</span></td>
      <td className="px-[15px] py-[9px] text-end"><MoneyDisplay value={majorOf(row.amount)} /></td>
      <td className="px-[15px] py-[9px] text-end font-bold"><MoneyDisplay value={majorOf(row.weighted)} /></td>
    </>
  );

  const headers = (first: string) => (
    <tr>
      <th className="px-[15px] py-[9px] text-start">{first}</th>
      <th className="px-[15px] py-[9px] text-end">{t("crmPipeline.forecast.col.deals")}</th>
      <th className="px-[15px] py-[9px] text-end">{t("crmPipeline.forecast.col.amount")}</th>
      <th className="px-[15px] py-[9px] text-end">{t("crmPipeline.forecast.col.weighted")}</th>
    </tr>
  );

  return (
    <div className="w-full min-w-0">
      <div className="mb-[16px]">
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("crmPipeline.forecast.title")}</h1>
        <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("crmPipeline.forecast.subtitle")}</p>
        {forecast && forecast.scope === "own" ? <p className="mt-[5px] text-[12px] font-semibold text-ink-muted">{t("crmPipeline.forecast.ownScope")}</p> : null}
      </div>

      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("crmPipeline.forecast.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <Card className="mb-[16px] grid gap-2 p-[12px_14px] sm:grid-cols-2">
        <SelectField
          label={t("crmPipeline.forecast.filter.branch")}
          value={branchFilter}
          onChange={setBranchFilter}
          options={[{ value: ALL, label: t("crmPipeline.forecast.filter.allBranches") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
        />
        {access.seesEveryDeal ? (
          <SelectField
            label={t("crmPipeline.forecast.filter.rep")}
            value={ownerFilter}
            onChange={setOwnerFilter}
            options={[{ value: ALL, label: t("crmPipeline.forecast.filter.allReps") }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
          />
        ) : null}
      </Card>

      <div className="mb-[18px] grid grid-cols-1 gap-[14px] sm:grid-cols-3">
        <StatCard label={t("crmPipeline.forecast.kpi.deals")} value={<span className="mz-num">{forecast?.total.count ?? 0}</span>} />
        <StatCard label={t("crmPipeline.forecast.kpi.amount")} value={<MoneyDisplay value={majorOf(forecast?.total.amount)} />} />
        <StatCard label={t("crmPipeline.forecast.kpi.weighted")} value={<MoneyDisplay value={majorOf(forecast?.total.weighted)} />} />
      </div>

      {forecast && forecast.total.count === 0 ? (
        <EmptyState title={t("crmPipeline.forecast.emptyTitle")} description={t("crmPipeline.forecast.emptyBody")} />
      ) : (
        <>
          <Card className="mb-[18px] overflow-hidden">
            <h2 className="px-[15px] pt-[12px] font-display text-[13.5px] font-bold text-ink">{t("crmPipeline.forecast.byMonth")}</h2>
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">{headers(t("crmPipeline.forecast.col.month"))}</thead>
              <tbody>
                {(forecast?.months ?? []).map((row) => {
                  const key = monthKey(row);
                  const open = expanded.has(key);
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-border">
                        <td className="px-[15px] py-[9px]">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => toggle(key)}
                            className="font-semibold text-ink hover:text-brand"
                          >
                            {monthLabel(row)}
                          </button>
                        </td>
                        {figures(row)}
                      </tr>
                      {open
                        ? row.owners.map((owner: ForecastOwnerRowDTO) => (
                            <tr key={`${key}:${owner.ownerUserId ?? "none"}`} className="border-t border-border bg-surface-2/50 text-ink-muted">
                              <td className="ps-[30px] pe-[15px] py-[7px]">{ownerName(owner.ownerUserId)}</td>
                              {figures(owner)}
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
              {forecast ? (
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td className="px-[15px] py-[9px]">{t("crmPipeline.forecast.total")}</td>
                    {figures(forecast.total)}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </Card>

          <Card className="overflow-hidden">
            <h2 className="px-[15px] pt-[12px] font-display text-[13.5px] font-bold text-ink">{t("crmPipeline.forecast.byRep")}</h2>
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">{headers(t("crmPipeline.forecast.col.rep"))}</thead>
              <tbody>
                {(forecast?.owners ?? []).map((row) => (
                  <tr key={row.ownerUserId ?? "none"} className="border-t border-border">
                    <td className="px-[15px] py-[9px] text-ink">{ownerName(row.ownerUserId)}</td>
                    {figures(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
