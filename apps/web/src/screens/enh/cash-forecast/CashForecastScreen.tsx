import { useCountPhrase } from "../../../lib/count-phrase";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ENGLISH_LOCALE,
  Button,
  Card,
  DocumentList,
  EmptyState,
  Money,
  Segmented,
  Select,
  StatCard,
  StatusPill,
  TextInput,
  cn,
  useFormat,
  type DocumentListColumn,
} from "@mezan/ui";
import { can, createAuthContext, UNATTRIBUTED_BRANCH_ID, ArabicCase, CountedNoun } from "@mezan/domain";
import {
  CashForecastDirectionDTO,
  CashForecastHorizonDTO,
  CashForecastKindDTO,
  CashForecastOverdueDTO,
  type CashForecastDTO,
  type CashForecastDayDTO,
  type CashForecastItemDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useBranches } from "../../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { pathForRoute } from "../../../routing";
import { EMPTY } from "../../../lib/empty";
import { majorOf, scaledOf, toMajorNumber } from "../../../lib/money";
import { useUrlNumber, useUrlParam } from "../../../lib/url-state";
import { useCashForecast, useUpdateCashForecastThreshold } from "./hooks";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const MONEY_LITERAL = /^-?\d{1,18}(\.\d{1,6})?$/;

enum ChartView {
  Chart = "chart",
  Table = "table",
}

const ALL_BRANCHES = "all";

const HORIZONS: readonly CashForecastHorizonDTO[] = [CashForecastHorizonDTO.Days30, CashForecastHorizonDTO.Days60, CashForecastHorizonDTO.Days90];

function isHorizon(value: string): value is CashForecastHorizonDTO {
  return (HORIZONS as readonly string[]).includes(value);
}

function isOverdue(value: string): value is CashForecastOverdueDTO {
  return value === CashForecastOverdueDTO.Today || value === CashForecastOverdueDTO.Exclude;
}

function kindLabelKey(kind: CashForecastKindDTO): AppTranslationKey {
  return `cashForecast.kind.${kind}` as AppTranslationKey;
}

function signedMajor(item: CashForecastItemDTO): number {
  const major = majorOf(item.amount);
  return item.direction === CashForecastDirectionDTO.Inflow ? major : -major;
}

function useItemOpener() {
  const { openScreenAt } = useNavigation();
  const navigate = useNavigate();
  return (item: CashForecastItemDTO): (() => void) | null => {
    switch (item.kind) {
      case CashForecastKindDTO.Receivable:
      case CashForecastKindDTO.Installment:
        return item.documentId ? () => openScreenAt("sales-invoices", [item.documentId!]) : null;
      case CashForecastKindDTO.Payable:
        return item.documentId ? () => openScreenAt("purchase-invoices", [item.documentId!]) : null;
      case CashForecastKindDTO.ChequeIncoming:
      case CashForecastKindDTO.ChequeOutgoing:
        return item.reference ? () => navigate(`${pathForRoute("cheques")}?q=${encodeURIComponent(item.reference!)}`) : null;
      case CashForecastKindDTO.ReceivableOther:
        return item.partyId ? () => openScreenAt("customers", [item.partyId!]) : null;
      case CashForecastKindDTO.PayableOther:
        return item.partyId ? () => openScreenAt("vendors", [item.partyId!]) : null;
      default:
        return null;
    }
  };
}

export function CashForecastScreen() {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const format = useFormat();
  const mayView = can(auth, "treasury.cash_forecast.view");
  const mayManage = can(auth, "treasury.cash_forecast.manage");

  const [horizonParam, setHorizonParam] = useUrlParam("horizon", CashForecastHorizonDTO.Days30);
  const [overdueParam, setOverdueParam] = useUrlParam("overdue", CashForecastOverdueDTO.Today);
  const [branchParam, setBranchParam] = useUrlParam("branch", "");
  const horizon = isHorizon(horizonParam) ? horizonParam : CashForecastHorizonDTO.Days30;
  const overdue = isOverdue(overdueParam) ? overdueParam : CashForecastOverdueDTO.Today;
  const query = useCashForecast(horizon, overdue, branchParam);
  const forecast = query.data ?? null;
  const branchRows = useBranches().data;
  const branchOptions = [
    { value: ALL_BRANCHES, label: t("cashForecast.branch.all") },
    ...(branchRows ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
    { value: UNATTRIBUTED_BRANCH_ID, label: t("cashForecast.branch.unattributed") },
  ];

  if (!mayView) {
    return <EmptyState title={t("cashForecast.noAccessTitle")} description={t("cashForecast.noAccessBody")} />;
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[14px]">
        <div className="min-w-0">
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("cashForecast.title")}</h1>
          <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("cashForecast.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Segmented
            aria-label={t("cashForecast.horizon")}
            options={HORIZONS.map((h) => ({ key: h, label: t("cashForecast.horizonDays", { days: countPhrase(Number(h), CountedNoun.Day) }) }))}
            value={horizon}
            onChange={(key) => setHorizonParam(key)}
          />
          <Select
            size="sm"
            aria-label={t("cashForecast.branch.label")}
            value={branchParam === "" ? ALL_BRANCHES : branchParam}
            onChange={(value) => setBranchParam(value === ALL_BRANCHES ? "" : value)}
            options={branchOptions}
          />
          <Select<CashForecastOverdueDTO>
            size="sm"
            aria-label={t("cashForecast.overdueTreatment")}
            value={overdue}
            onChange={(value) => setOverdueParam(value)}
            options={[
              { value: CashForecastOverdueDTO.Today, label: t("cashForecast.overdue.today") },
              { value: CashForecastOverdueDTO.Exclude, label: t("cashForecast.overdue.exclude") },
            ]}
          />
        </div>
      </div>

      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("cashForecast.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {query.isLoading ? <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("cashForecast.loading")}</Card> : null}

      {forecast && forecast.branchNarrowed && forecast.unattributed.count > 0 ? (
        <Card className="mb-[14px] p-[10px_14px] text-[12px] text-ink-muted">
          {t("cashForecast.branch.unattributedNote", {
            count: forecast.unattributed.count,
            inflows: format.money(majorOf(forecast.unattributed.inflows)),
            outflows: format.money(majorOf(forecast.unattributed.outflows)),
          })}
        </Card>
      ) : null}

      {forecast ? <ForecastBody forecast={forecast} mayManage={mayManage} /> : null}
    </div>
  );
}

function ForecastBody({ forecast, mayManage }: { forecast: CashForecastDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const fmt = useFormat();
  const [selectedDay, setSelectedDay] = useUrlParam("day", "");
  const [view, setView] = useState<ChartView>(ChartView.Chart);
  const day = forecast.days.some((d) => d.date === selectedDay) ? selectedDay : "";

  return (
    <div className="flex min-w-0 flex-col gap-[18px]">
      <RunwayBanner forecast={forecast} />

      <div className="grid grid-cols-1 gap-[14px] min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("cashForecast.kpi.opening")} value={<Money value={majorOf(forecast.openingCash)} />} sub={fmt.date(forecast.today)} />
        <StatCard label={t("cashForecast.kpi.inflows")} value={<Money value={majorOf(forecast.totals.inflows)} />} subTone="up" sub={t("cashForecast.kpi.untilDate", { date: fmt.date(forecast.endDate) })} />
        <StatCard label={t("cashForecast.kpi.outflows")} value={<Money value={majorOf(forecast.totals.outflows)} />} subTone="down" sub={t("cashForecast.kpi.untilDate", { date: fmt.date(forecast.endDate) })} />
        <StatCard
          label={t("cashForecast.kpi.closing")}
          value={<Money value={majorOf(forecast.totals.closing)} />}
          valueTone={scaledOf(forecast.totals.closing) < 0n ? "danger" : "default"}
          sub={fmt.date(forecast.endDate)}
        />
        <StatCard
          label={t("cashForecast.kpi.lowest")}
          value={<Money value={majorOf(forecast.lowest.balance)} />}
          valueTone={scaledOf(forecast.lowest.balance) < scaledOf(forecast.threshold.amount) ? "danger" : "default"}
          sub={fmt.date(forecast.lowest.date)}
        />
        <StatCard
          label={t("cashForecast.kpi.runway")}
          value={
            <span className="mz-num">
              {forecast.runwayDays === null ? t("cashForecast.kpi.runwayBeyond", { days: countPhrase(Number(forecast.horizon), CountedNoun.Day, ArabicCase.Oblique) }) : t("cashForecast.kpi.runwayDays", { days: countPhrase(forecast.runwayDays, CountedNoun.Day) })}
            </span>
          }
          valueTone={forecast.runwayDays === null ? "default" : "danger"}
          sub={forecast.firstBelowZero ? fmt.date(forecast.firstBelowZero) : t("cashForecast.kpi.noZero")}
        />
      </div>

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-border bg-surface-2 px-[16px] py-[9px]">
          <span className="text-[12.5px] font-bold text-ink">{t("cashForecast.chart.title")}</span>
          <Segmented
            aria-label={t("cashForecast.chart.view")}
            options={[
              { key: ChartView.Chart, label: t("cashForecast.chart.viewChart") },
              { key: ChartView.Table, label: t("cashForecast.chart.viewTable") },
            ]}
            value={view}
            onChange={(key) => setView(key === ChartView.Table ? ChartView.Table : ChartView.Chart)}
          />
        </div>
        <div className="p-[14px_16px]">
          {view === ChartView.Chart ? (
            <BalanceChart forecast={forecast} selectedDay={day} onSelectDay={(d) => setSelectedDay(d === day ? "" : d)} />
          ) : (
            <DaysTable days={forecast.days} selectedDay={day} onSelectDay={(d) => setSelectedDay(d === day ? "" : d)} />
          )}
        </div>
      </Card>

      <div className="grid min-w-0 grid-cols-1 gap-[18px] lg:grid-cols-2">
        <DriversCard forecast={forecast} />
        <div className="flex min-w-0 flex-col gap-[18px]">
          <ThresholdCard forecast={forecast} mayManage={mayManage} />
          <OpeningAccountsCard forecast={forecast} />
        </div>
      </div>

      <ItemsTable forecast={forecast} selectedDay={day} onClearDay={() => setSelectedDay("")} />
    </div>
  );
}

function RunwayBanner({ forecast }: { forecast: CashForecastDTO }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const threshold = fmt.money(majorOf(forecast.threshold.amount));
  if (forecast.firstBelowThreshold) {
    const zero = forecast.firstBelowZero ? t("cashForecast.banner.zero", { date: fmt.date(forecast.firstBelowZero) }) : "";
    return (
      <Card className="border-danger bg-danger-soft p-[14px_18px]" role="alert">
        <p className="text-[13.5px] font-bold text-danger-ink">
          {t("cashForecast.banner.below", { date: fmt.date(forecast.firstBelowThreshold), threshold })}
        </p>
        <p className="mt-[4px] text-[12.5px] text-danger-ink">
          {t("cashForecast.banner.lowest", { amount: fmt.money(majorOf(forecast.lowest.balance)), date: fmt.date(forecast.lowest.date) })} {zero}
        </p>
      </Card>
    );
  }
  return (
    <Card className="border-success bg-success-soft p-[14px_18px]">
      <p className="text-[13.5px] font-bold text-success-ink">{t("cashForecast.banner.clear", { date: fmt.date(forecast.endDate), threshold })}</p>
      {forecast.alert ? (
        <p className="mt-[4px] text-[12.5px] text-warning-ink">{t("cashForecast.banner.laterAlert", { date: fmt.date(forecast.alert.crossingDate) })}</p>
      ) : null}
    </Card>
  );
}

function plainAmount(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function percentOf(value: bigint, span: bigint): number {
  return Number((value * 10_000n) / span) / 100;
}

function BalanceChart({ forecast, selectedDay, onSelectDay }: { forecast: CashForecastDTO; selectedDay: string; onSelectDay: (date: string) => void }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const closings = forecast.days.map((d) => scaledOf(d.closing));
  const threshold = scaledOf(forecast.threshold.amount);
  const max = [0n, threshold, ...closings].reduce((m, v) => (v > m ? v : m));
  const min = [0n, threshold, ...closings].reduce((m, v) => (v < m ? v : m));
  const span = max - min === 0n ? 1n : max - min;
  const zero = percentOf(-min, span);
  const thresholdAt = percentOf(threshold - min, span);
  const first = forecast.days[0];
  const middle = forecast.days[Math.floor(forecast.days.length / 2)];
  const last = forecast.days[forecast.days.length - 1];

  return (
    <div className="min-w-0">
      <div className="mb-[8px] flex flex-wrap gap-[14px] text-[11.5px] text-ink-muted">
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-[9px] w-[9px] rounded-sm bg-chart-1" />
          {t("cashForecast.chart.legendAbove")}
        </span>
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-[9px] w-[9px] rounded-sm bg-warning" />
          {t("cashForecast.chart.legendBelowThreshold")}
        </span>
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-[9px] w-[9px] rounded-sm bg-danger" />
          {t("cashForecast.chart.legendBelowZero")}
        </span>
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="w-[14px] border-t-2 border-dashed border-warning" />
          {t("cashForecast.chart.legendThreshold", { amount: fmt.money(majorOf(forecast.threshold.amount)) })}
        </span>
      </div>
      <div className="flex min-w-0 gap-[8px]">
        <div className="flex w-[64px] shrink-0 flex-col justify-between text-end text-[10.5px] text-ink-faint">
          <span className="mz-num truncate">{fmt.money(toMajorNumber(max))}</span>
          <span className="mz-num truncate">{fmt.money(toMajorNumber(min))}</span>
        </div>
        <div className="relative h-[200px] min-w-0 flex-1" role="group" aria-label={t("cashForecast.chart.title")}>
          <div aria-hidden className="absolute border-t border-border-strong" style={{ insetInline: 0, insetBlockEnd: `${zero}%` }} />
          {threshold !== 0n ? (
            <div aria-hidden className="absolute border-t-2 border-dashed border-warning" style={{ insetInline: 0, insetBlockEnd: `${thresholdAt}%` }} />
          ) : null}
          <div className="absolute inset-0 flex items-stretch gap-[1px]">
            {forecast.days.map((d, i) => {
              const value = closings[i]!;
              const height = percentOf(value < 0n ? -value : value, span);
              const tone = value < 0n ? "bg-danger" : value < threshold ? "bg-warning" : "bg-chart-1";
              const label = `${fmt.date(d.date)} · ${fmt.money(majorOf(d.closing))}`;
              return (
                <button
                  key={d.date}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={selectedDay === d.date}
                  onClick={() => onSelectDay(d.date)}
                  className={cn("relative min-w-0 flex-1 rounded-[2px] hover:bg-surface-2", selectedDay === d.date ? "bg-brand-soft" : "")}
                >
                  <span
                    aria-hidden
                    className={cn("absolute rounded-[1px]", tone, d.itemCount > 0 ? "opacity-100" : "opacity-80")}
                    style={{
                      insetInline: 0,
                      insetBlockEnd: `${value >= 0n ? zero : zero - height}%`,
                      blockSize: `${Math.max(height, 0.5)}%`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-[6px] flex justify-between ps-[72px] text-[11px] text-ink-faint">
        <span className="mz-num">{first ? fmt.date(first.date) : ""}</span>
        <span className="mz-num">{middle ? fmt.date(middle.date) : ""}</span>
        <span className="mz-num">{last ? fmt.date(last.date) : ""}</span>
      </div>
      <p className="mt-[8px] text-[11.5px] text-ink-muted">{t("cashForecast.chart.caption")}</p>
    </div>
  );
}

function DaysTable({ days, selectedDay, onSelectDay }: { days: readonly CashForecastDayDTO[]; selectedDay: string; onSelectDay: (date: string) => void }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageCount = Math.max(1, Math.ceil(days.length / pageSize));
  const rows = days.slice((page - 1) * pageSize, page * pageSize);
  const columns: DocumentListColumn<CashForecastDayDTO>[] = [
    { key: "date", header: t("cashForecast.col.date"), render: (d) => <span className="mz-num text-ink">{fmt.date(d.date)}</span> },
    { key: "opening", header: t("cashForecast.col.opening"), align: "end", render: (d) => <Money value={majorOf(d.opening)} /> },
    { key: "inflows", header: t("cashForecast.col.inflows"), align: "end", render: (d) => <Money className="text-success-ink" value={majorOf(d.inflows)} /> },
    { key: "outflows", header: t("cashForecast.col.outflows"), align: "end", render: (d) => <Money className="text-danger-ink" value={majorOf(d.outflows)} /> },
    {
      key: "closing",
      header: t("cashForecast.col.closing"),
      align: "end",
      render: (d) => <Money className={scaledOf(d.closing) < 0n ? "font-bold text-danger-ink" : "font-semibold text-ink"} value={majorOf(d.closing)} />,
    },
    { key: "count", header: t("cashForecast.col.items"), align: "end", render: (d) => <span className="mz-num">{d.itemCount}</span> },
  ];
  return (
    <DocumentList<CashForecastDayDTO>
      title=""
      columns={columns}
      rows={rows}
      rowKey={(d) => d.date}
      onRowClick={(d) => onSelectDay(d.date)}
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZES}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      pageSummary={selectedDay ? t("cashForecast.selectedDay", { date: fmt.date(selectedDay) }) : undefined}
      emptyState={<EmptyState title={t("cashForecast.empty.title")} description={t("cashForecast.empty.body")} />}
    />
  );
}

function ItemLink({ item }: { item: CashForecastItemDTO }) {
  const open = useItemOpener()(item);
  const label = item.reference ?? item.detail ?? "—";
  if (!open) return <span className="mz-num text-ink-muted">{label}</span>;
  return (
    <Button size="sm" variant="ghost" onClick={open} className="mz-num px-[4px]">
      {label}
    </Button>
  );
}

function PartyName({ item }: { item: CashForecastItemDTO }) {
  const { locale } = useAppTranslation();
  const name = locale === ENGLISH_LOCALE ? (item.partyNameEn ?? item.partyName) : item.partyName;
  return <span className="text-ink">{name ?? "—"}</span>;
}

function DriversCard({ forecast }: { forecast: CashForecastDTO }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  return (
    <Card className="min-w-0 p-[16px_18px]">
      <h2 className="font-display text-[14.5px] font-bold text-ink">{t("cashForecast.drivers.title")}</h2>
      <p className="mt-[2px] text-[11.5px] text-ink-muted">{t("cashForecast.drivers.hint")}</p>
      {forecast.dips.length === 0 ? (
        <p className="mt-[12px] text-[12.5px] text-ink-muted">
          {t("cashForecast.drivers.none", { amount: fmt.money(majorOf(forecast.lowest.balance)), date: fmt.date(forecast.lowest.date) })}
        </p>
      ) : (
        <ol className="mt-[12px] flex flex-col gap-[14px]">
          {forecast.dips.map((dip) => (
            <li key={dip.startDate} className="min-w-0 rounded-md border border-border p-[10px_12px]">
              <p className="text-[12.5px] font-semibold text-ink">
                {dip.endDate
                  ? t("cashForecast.drivers.dipRange", { from: fmt.date(dip.startDate), to: fmt.date(dip.endDate) })
                  : t("cashForecast.drivers.dipOpen", { from: fmt.date(dip.startDate) })}
              </p>
              <p className="mt-[2px] text-[12px] text-danger-ink">
                {t("cashForecast.drivers.lowest", { amount: fmt.money(majorOf(dip.lowestBalance)), date: fmt.date(dip.lowestDate) })}
              </p>
              {dip.drivers.length === 0 ? (
                <p className="mt-[6px] text-[12px] text-ink-muted">{t("cashForecast.drivers.noOutflows")}</p>
              ) : (
                <ul className="mt-[8px] flex flex-col gap-[6px]">
                  {dip.drivers.map((item) => (
                    <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-[10px] gap-y-[2px] text-[12px]">
                      <span className="flex min-w-0 flex-wrap items-center gap-[6px]">
                        <StatusPill tone="neutral" label={t(kindLabelKey(item.kind))} />
                        <PartyName item={item} />
                        <ItemLink item={item} />
                      </span>
                      <span className="flex items-center gap-[8px]">
                        <span className="mz-num text-ink-faint">{fmt.date(item.expectedDate)}</span>
                        <Money className="font-semibold text-danger-ink" value={majorOf(item.amount)} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ThresholdCard({ forecast, mayManage }: { forecast: CashForecastDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const mutation = useUpdateCashForecastThreshold();
  const saved = forecast.threshold.amount;
  const [draft, setDraft] = useState(() => plainAmount(saved));
  useEffect(() => setDraft(plainAmount(saved)), [saved]);
  const trimmed = draft.trim().replace(/,/g, "");
  const valid = MONEY_LITERAL.test(trimmed);
  const changed = valid && scaledOf(trimmed) !== scaledOf(saved);

  return (
    <Card className="min-w-0 p-[16px_18px]">
      <h2 className="font-display text-[14.5px] font-bold text-ink">{t("cashForecast.threshold.title")}</h2>
      <p className="mt-[2px] text-[11.5px] text-ink-muted">{t("cashForecast.threshold.hint")}</p>
      <div className="mt-[12px] flex flex-wrap items-end gap-[10px]">
        <div className="min-w-0 flex-1">
          <TextInput
            size="sm"
            inputMode="decimal"
            aria-label={t("cashForecast.threshold.amount")}
            value={draft}
            disabled={!mayManage || mutation.isPending}
            invalid={!valid}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        {mayManage ? (
          <Button size="sm" disabled={!changed || mutation.isPending} onClick={() => mutation.mutate({ amount: trimmed })}>
            {t("cashForecast.threshold.save")}
          </Button>
        ) : null}
      </div>
      {!valid ? <p className="mt-[6px] text-[12px] text-danger-ink">{t("cashForecast.threshold.invalid")}</p> : null}
      {mutation.isError ? <p className="mt-[6px] text-[12px] text-danger-ink">{mutation.error.message}</p> : null}
      {!mayManage ? <p className="mt-[6px] text-[11.5px] text-ink-faint">{t("cashForecast.threshold.readOnly")}</p> : null}
      {forecast.threshold.updatedAt ? (
        <p className="mt-[6px] text-[11.5px] text-ink-faint">{t("cashForecast.threshold.updatedAt", { at: fmt.dateTime(forecast.threshold.updatedAt) })}</p>
      ) : null}
      <h3 className="mt-[14px] text-[12.5px] font-bold text-ink">{t("cashForecast.alerts.title")}</h3>
      {forecast.alerts.length === 0 ? (
        <p className="mt-[4px] text-[12px] text-ink-muted">{t("cashForecast.alerts.none")}</p>
      ) : (
        <ul className="mt-[6px] flex flex-col gap-[5px]">
          {forecast.alerts.map((alert) => (
            <li key={alert.id} className="flex flex-wrap items-center justify-between gap-[8px] text-[12px]">
              <span className="text-ink">
                {t("cashForecast.alerts.row", {
                  date: fmt.date(alert.crossingDate),
                  threshold: fmt.money(majorOf(alert.threshold)),
                })}
              </span>
              <StatusPill tone={alert.clearedAt ? "neutral" : "danger"} label={alert.clearedAt ? t("cashForecast.alerts.cleared") : t("cashForecast.alerts.open")} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OpeningAccountsCard({ forecast }: { forecast: CashForecastDTO }) {
  const { t, locale } = useAppTranslation();
  return (
    <Card className="min-w-0 p-[16px_18px]">
      <h2 className="font-display text-[14.5px] font-bold text-ink">{t("cashForecast.opening.title")}</h2>
      <p className="mt-[2px] text-[11.5px] text-ink-muted">{t("cashForecast.opening.hint")}</p>
      {forecast.openingAccounts.length === 0 ? (
        <p className="mt-[10px] text-[12px] text-ink-muted">{t("cashForecast.opening.none")}</p>
      ) : (
        <ul className="mt-[10px] flex flex-col gap-[6px]">
          {forecast.openingAccounts.map((account) => (
            <li key={account.treasuryAccountId ?? account.glAccountId} className="flex min-w-0 flex-wrap items-center justify-between gap-[8px] text-[12.5px]">
              <span className="min-w-0 truncate text-ink">{locale === ENGLISH_LOCALE ? (account.nameEn ?? account.name) : account.name}</span>
              {account.balance !== null ? (
                <Money className="font-semibold text-ink" value={majorOf(account.balance)} />
              ) : (
                <span className="text-[11.5px] text-ink-faint">{account.glAccountId ? t("cashForecast.opening.shared") : t("cashForecast.opening.unlinked")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemsTable({ forecast, selectedDay, onClearDay }: { forecast: CashForecastDTO; selectedDay: string; onClearDay: () => void }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const [kind, setKind] = useUrlParam("kind", "all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const rows = useMemo(
    () =>
      (forecast.items ?? EMPTY).filter(
        (item) => (kind === "all" || item.kind === kind) && (selectedDay === "" || item.expectedDate === selectedDay),
      ),
    [forecast.items, kind, selectedDay],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const kindOptions = [
    { value: "all", label: t("cashForecast.kind.all") },
    ...Object.values(CashForecastKindDTO).map((k) => ({ value: k as string, label: t(kindLabelKey(k)) })),
  ];

  const columns: DocumentListColumn<CashForecastItemDTO>[] = [
    { key: "expectedDate", header: t("cashForecast.col.expected"), render: (item) => <span className="mz-num text-ink">{fmt.date(item.expectedDate)}</span> },
    { key: "kind", header: t("cashForecast.col.kind"), render: (item) => <StatusPill tone="neutral" label={t(kindLabelKey(item.kind))} /> },
    { key: "party", header: t("cashForecast.col.party"), render: (item) => <PartyName item={item} /> },
    { key: "reference", header: t("cashForecast.col.reference"), render: (item) => <ItemLink item={item} /> },
    {
      key: "due",
      header: t("cashForecast.col.due"),
      render: (item) => (
        <span className="flex flex-wrap items-center gap-[6px]">
          <span className="mz-num text-ink-muted">{fmt.date(item.dueDate)}</span>
          {item.overdue ? <StatusPill tone="warning" label={t("cashForecast.overdueTag")} /> : null}
          {item.currency ? <span className="text-[11px] text-ink-faint">{item.currency}</span> : null}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("cashForecast.col.amount"),
      align: "end",
      render: (item) => (
        <Money className={item.direction === CashForecastDirectionDTO.Inflow ? "font-semibold text-success-ink" : "font-semibold text-danger-ink"} value={signedMajor(item)} />
      ),
    },
  ];

  return (
    <DocumentList<CashForecastItemDTO>
      nested
      title={t("cashForecast.items.title")}
      description={t("cashForecast.items.hint")}
      filterBarExtra={
        <div className="flex flex-wrap items-center gap-[8px]">
          <Select size="sm" aria-label={t("cashForecast.col.kind")} value={kind} onChange={(value) => { setKind(value); setPage(1); }} options={kindOptions} />
          {selectedDay ? (
            <Button size="sm" variant="ghost" onClick={onClearDay}>
              {t("cashForecast.clearDay", { date: fmt.date(selectedDay) })}
            </Button>
          ) : null}
        </div>
      }
      columns={columns}
      rows={pageRows}
      rowKey={(item) => item.id}
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZES}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> / <span className="mz-num">{rows.length}</span></>}
      emptyState={<EmptyState title={t("cashForecast.empty.title")} description={t("cashForecast.empty.body")} />}
    />
  );
}
