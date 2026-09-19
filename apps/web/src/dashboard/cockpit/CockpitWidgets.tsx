import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card, Money, cn, useFormat } from "@mezan/ui";
import {
  CashForecastHorizonDTO,
  CashForecastOverdueDTO,
  CockpitDirectionDTO,
  type CockpitDTO,
  type CockpitDayDTO,
} from "@mezan/contracts";
import { UNATTRIBUTED_BRANCH_ID } from "@mezan/domain";
import { useAppTranslation } from "../../i18n";
import { pathForRoute } from "../../routing";
import type { ScreenKey } from "../../router/screens";
import { entityName } from "../../lib/entity-names";
import { majorOf, scaledOf, toMajorNumber } from "../../lib/money";
import { useCashForecast } from "../../screens/enh/cash-forecast/hooks";
import { MicroBeam, type BeamDirection, type DeltaTone } from "../KpiStrip";

export function drillHref(screen: ScreenKey, params: Readonly<Record<string, string | null | undefined>> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const qs = query.toString();
  return `${pathForRoute(screen)}${qs ? `?${qs}` : ""}`;
}

function weekdayName(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));
}

function directionOf(current: bigint, previous: bigint): BeamDirection {
  if (current === previous) return "level";
  return current > previous ? "up" : "down";
}

function percentChangeTenths(current: bigint, previous: bigint): bigint | null {
  if (previous === 0n) return null;
  const base = previous < 0n ? -previous : previous;
  const diff = (current - previous) * 1000n;
  const negative = diff < 0n;
  const abs = negative ? -diff : diff;
  const tenths = (abs * 2n + base) / (base * 2n);
  return negative ? -tenths : tenths;
}

function tenthsText(tenths: bigint): string {
  const abs = tenths < 0n ? -tenths : tenths;
  return `${abs / 10n}.${abs % 10n}`;
}

function percentTenths(value: string | null): bigint | null {
  if (value === null) return null;
  const negative = value.startsWith("-");
  const [whole = "0", fraction = "0"] = (negative ? value.slice(1) : value).split(".");
  const tenths = BigInt(whole) * 10n + BigInt((fraction + "0").slice(0, 1));
  return negative ? -tenths : tenths;
}

interface SparklineProps {
  readonly values: readonly number[];
  readonly label: string;
  readonly rtl: boolean;
  readonly tone?: "brand" | "chart2" | "chart3";
}

const TONE_VAR = { brand: "var(--chart-1)", chart2: "var(--chart-2)", chart3: "var(--chart-3)" } as const;

export function Sparkline({ values, label, rtl, tone = "brand" }: SparklineProps) {
  const width = 100;
  const height = 30;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = rtl ? width - index * step : index * step;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const last = points[points.length - 1];
  const zeroY = height - 2 - ((0 - min) / span) * (height - 4);
  const area = points.length > 1 ? `${points[0]![0].toFixed(2)},${zeroY.toFixed(2)} ${line} ${last![0].toFixed(2)},${zeroY.toFixed(2)}` : "";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-[30px] w-full overflow-visible">
      {area ? <polygon points={area} fill={TONE_VAR[tone]} opacity={0.12} /> : null}
      <polyline points={line} fill="none" stroke={TONE_VAR[tone]} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.4} fill={TONE_VAR[tone]} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

const deltaToneClass: Record<DeltaTone, string> = {
  good: "text-success-ink",
  bad: "text-danger-ink",
  neutral: "text-ink-faint",
};

interface TileShellProps {
  readonly title: string;
  readonly href: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

function TileShell({ title, href, children, footer, className }: TileShellProps) {
  const { t } = useAppTranslation();
  return (
    <Card className={cn("flex min-w-0 flex-col p-[14px_16px] shadow-1", className)}>
      <div className="flex items-start justify-between gap-[8px]">
        <h3 className="min-w-0 text-xs font-semibold text-ink-muted">{title}</h3>
        <Link
          to={href}
          className="-m-[6px] flex-none rounded-md p-[6px] text-2xs font-semibold text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          aria-label={`${t("cockpit.open")} — ${title}`}
        >
          {t("cockpit.open")}
        </Link>
      </div>
      <div className="mt-[6px] min-w-0 flex-1">{children}</div>
      {footer ? <div className="mt-[8px] min-w-0 text-2xs text-ink-faint">{footer}</div> : null}
    </Card>
  );
}

interface PulseMetricProps {
  readonly title: string;
  readonly href: string;
  readonly today: string;
  readonly lastWeek: string;
  readonly compareDay: string;
  readonly days: readonly CockpitDayDTO[];
  readonly pick: (day: CockpitDayDTO) => string;
  readonly rtl: boolean;
  readonly tone: "brand" | "chart2";
}

function PulseMoneyTile({ title, href, today, lastWeek, compareDay, days, pick, rtl, tone }: PulseMetricProps) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const current = scaledOf(today);
  const previous = scaledOf(lastWeek);
  const direction = directionOf(current, previous);
  const deltaTone: DeltaTone = direction === "level" ? "neutral" : direction === "up" ? "good" : "bad";
  const day = weekdayName(compareDay, locale);
  const change = percentChangeTenths(current, previous);
  const delta =
    current === previous
      ? t("cockpit.pulse.flat", { day })
      : previous === 0n
        ? t("cockpit.pulse.noCompare", { day })
        : t("cockpit.pulse.vs", { day, value: `${change !== null && change < 0n ? "−" : "+"}${tenthsText(change ?? 0n)}%` });
  const series = days.map((d) => majorOf(pick(d)));
  const sparkLabel = t("cockpit.pulse.sparkLabel", { metric: title, values: series.map((v) => format.money(v)).join("، ") });
  return (
    <TileShell title={title} href={href}>
      <div className="min-w-0 font-display text-lg font-bold tracking-tight text-ink min-[420px]:text-2xl">
        <Money value={toMajorNumber(current)} />
      </div>
      <div className={cn("mt-[6px] flex items-center gap-[6px] text-2xs", deltaToneClass[deltaTone])}>
        <MicroBeam direction={direction} rtl={rtl} />
        <span className="min-w-0">
          {delta}
          {previous !== 0n && current !== previous ? (
            <span className="text-ink-faint">
              {" "}
              (<span className="mz-num">{format.money(toMajorNumber(previous))}</span>)
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-[10px]">
        <div className="mb-[2px] text-2xs text-ink-faint">{t("cockpit.pulse.spark")}</div>
        <Sparkline values={series} label={sparkLabel} rtl={rtl} tone={tone} />
      </div>
    </TileShell>
  );
}

function PulseMarginTile({ data, rtl, href }: { readonly data: CockpitDTO; readonly rtl: boolean; readonly href: string }) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const title = t("cockpit.pulse.margin");
  const margin = data.pulse.grossMarginPercent;
  if (!margin) {
    return (
      <TileShell title={title} href={href}>
        <p className="text-sm text-ink-muted">{t("cockpit.pulse.marginHidden")}</p>
      </TileShell>
    );
  }
  const today = percentTenths(margin.today);
  const previous = percentTenths(margin.sameWeekdayLastWeek);
  const day = weekdayName(data.compareDate, locale);
  const direction: BeamDirection = today === null || previous === null ? "level" : directionOf(today, previous);
  const deltaTone: DeltaTone = direction === "level" ? "neutral" : direction === "up" ? "good" : "bad";
  let delta: string;
  if (today === null) delta = t("cockpit.pulse.noSales");
  else if (previous === null) delta = t("cockpit.pulse.noCompare", { day });
  else if (today === previous) delta = t("cockpit.pulse.flat", { day });
  else {
    const points = tenthsText(today - previous);
    delta = t("cockpit.pulse.vs", { day, value: t(today > previous ? "cockpit.pulse.pointsUp" : "cockpit.pulse.pointsDown", { value: points }) });
  }
  const series = data.days.map((d) => (d.grossMarginPercent === null ? 0 : Number(d.grossMarginPercent)));
  const sparkLabel = t("cockpit.pulse.sparkLabel", {
    metric: title,
    values: data.days.map((d) => (d.grossMarginPercent === null ? "—" : `${format.number(Number(d.grossMarginPercent))}%`)).join("، "),
  });
  return (
    <TileShell title={title} href={href}>
      <div className="mz-num min-w-0 font-display text-lg font-bold tracking-tight text-ink min-[420px]:text-2xl">
        {margin.today === null ? "—" : `${format.number(Number(margin.today))}%`}
      </div>
      <div className={cn("mt-[6px] flex items-center gap-[6px] text-2xs", deltaToneClass[deltaTone])}>
        <MicroBeam direction={direction} rtl={rtl} />
        <span className="min-w-0">{delta}</span>
      </div>
      <div className="mt-[10px]">
        <div className="mb-[2px] text-2xs text-ink-faint">{t("cockpit.pulse.spark")}</div>
        <Sparkline values={series} label={sparkLabel} rtl={rtl} tone="brand" />
      </div>
    </TileShell>
  );
}

export interface CockpitWidgetProps {
  readonly data: CockpitDTO;
  readonly rtl: boolean;
  readonly branchParam: string;
}

function branchQuery(branchParam: string): string | null {
  return branchParam && branchParam !== UNATTRIBUTED_BRANCH_ID ? branchParam : null;
}

export function CockpitPulse({ data, rtl, branchParam }: CockpitWidgetProps) {
  const { t } = useAppTranslation();
  const branch = branchQuery(branchParam);
  return (
    <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
      <PulseMoneyTile
        title={t("cockpit.pulse.sales")}
        href={drillHref("sales-invoices", { from: data.today, to: data.today, branch })}
        today={data.pulse.sales.today}
        lastWeek={data.pulse.sales.sameWeekdayLastWeek}
        compareDay={data.compareDate}
        days={data.days}
        pick={(d) => d.sales}
        rtl={rtl}
        tone="brand"
      />
      <PulseMoneyTile
        title={t("cockpit.pulse.collections")}
        href={drillHref("treasury-vouchers", { type: "customer_collection", from: data.today, to: data.today, branch })}
        today={data.pulse.collections.today}
        lastWeek={data.pulse.collections.sameWeekdayLastWeek}
        compareDay={data.compareDate}
        days={data.days}
        pick={(d) => d.collections}
        rtl={rtl}
        tone="chart2"
      />
      <PulseMarginTile data={data} rtl={rtl} href={drillHref("financial-reports", { tab: "income-statement" })} />
    </div>
  );
}

export function CockpitRunway({ companyWide }: { readonly companyWide: boolean }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const forecast = useCashForecast(CashForecastHorizonDTO.Days90, CashForecastOverdueDTO.Today);
  const title = t("cockpit.runway.title");
  const href = drillHref("cash-forecast", { horizon: CashForecastHorizonDTO.Days90 });
  const data = forecast.data;
  return (
    <TileShell title={title} href={href} footer={companyWide ? t("cockpit.branch.companyWide") : undefined}>
      {forecast.isError ? (
        <p className="text-sm text-danger-ink">{t("cockpit.runway.unavailable")}</p>
      ) : !data ? (
        <p className="text-sm text-ink-faint">{t("cockpit.loading")}</p>
      ) : (
        <>
          <div
            className={cn(
              "mz-num font-display text-lg font-bold tracking-tight min-[420px]:text-2xl",
              data.runwayDays === null ? "text-success-ink" : data.runwayDays <= 30 ? "text-danger-ink" : "text-warning-ink",
            )}
          >
            {data.runwayDays === null ? t("cockpit.runway.safe") : t("cockpit.runway.days", { days: format.number(data.runwayDays) })}
          </div>
          <div className="mt-[6px] text-2xs text-ink-muted">
            {t("cockpit.runway.lowest", { amount: format.money(majorOf(data.lowest.balance)), date: data.lowest.date })}
          </div>
          {data.firstBelowThreshold ? (
            <div className="mt-[2px] text-2xs font-semibold text-warning-ink">{t("cockpit.runway.belowThreshold", { date: data.firstBelowThreshold })}</div>
          ) : null}
        </>
      )}
    </TileShell>
  );
}

export function CockpitOverdueTile({ data, branchParam }: CockpitWidgetProps) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const overdue = data.overdueReceivables;
  if (!overdue) return null;
  const href = drillHref("sales-invoices", { status: "overdue", branch: branchQuery(branchParam) });
  const clear = overdue.invoiceCount === 0;
  return (
    <TileShell
      title={t("cockpit.overdue.title")}
      href={href}
      footer={overdue.oldestDueDate ? t("cockpit.overdue.oldest", { date: overdue.oldestDueDate }) : undefined}
    >
      {clear ? (
        <p className="text-sm font-semibold text-success-ink">{t("cockpit.overdue.clear")}</p>
      ) : (
        <>
          <div className="min-w-0 font-display text-lg font-bold tracking-tight text-danger-ink min-[420px]:text-2xl">
            <Money value={majorOf(overdue.amount)} />
          </div>
          <div className="mt-[6px] text-2xs text-ink-muted">
            {t("cockpit.overdue.detail", { invoices: format.number(overdue.invoiceCount), customers: format.number(overdue.customerCount) })}
          </div>
        </>
      )}
    </TileShell>
  );
}

export function CockpitLowStockTile({ data }: CockpitWidgetProps) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const stock = data.lowStock;
  if (!stock) return null;
  const first = stock.firstItemNameAr ? entityName({ nameAr: stock.firstItemNameAr, nameEn: stock.firstItemNameEn }, locale) : null;
  return (
    <TileShell
      title={t("cockpit.lowStock.title")}
      href={drillHref("items", { status: "low_stock" })}
      footer={
        stock.out > 0 ? (
          <Link to={drillHref("items", { status: "out_of_stock" })} className="font-semibold text-danger-ink hover:underline">
            {t("cockpit.lowStock.out", { count: format.number(stock.out) })}
          </Link>
        ) : undefined
      }
    >
      {stock.low === 0 ? (
        <p className="text-sm font-semibold text-success-ink">{t("cockpit.lowStock.clear")}</p>
      ) : (
        <>
          <div className="mz-num font-display text-lg font-bold tracking-tight text-warning-ink min-[420px]:text-2xl">{format.number(stock.low)}</div>
          {first ? <div className="mt-[6px] truncate text-2xs text-ink-muted">{t("cockpit.lowStock.detail", { name: first })}</div> : null}
        </>
      )}
    </TileShell>
  );
}

export function CockpitCashTile({ data }: CockpitWidgetProps) {
  const { t, locale } = useAppTranslation();
  const cash = data.cash;
  if (!cash) return null;
  return (
    <TileShell title={t("cockpit.cash.title")} href={drillHref("treasury-accounts")}>
      <div className="min-w-0 font-display text-lg font-bold tracking-tight text-ink min-[420px]:text-2xl">
        <Money value={majorOf(cash.total)} />
      </div>
      {cash.accounts.length === 0 ? (
        <p className="mt-[6px] text-sm text-ink-muted">{t("cockpit.cash.empty")}</p>
      ) : (
        <ul className="mt-[10px] flex flex-col divide-y divide-border">
          {cash.accounts.map((account) => (
            <li key={account.treasuryAccountId}>
              <Link
                to={drillHref("treasury-accounts", { q: account.code })}
                className="flex min-w-0 items-center justify-between gap-[10px] py-[7px] text-sm hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-ink">{entityName({ nameAr: account.name, nameEn: account.nameEn }, locale)}</span>
                {account.balance === null ? (
                  <span className="flex-none text-2xs text-ink-faint">{t("cockpit.cash.unlinked")}</span>
                ) : (
                  <span className={cn("flex-none font-semibold", scaledOf(account.balance) < 0n ? "text-danger-ink" : "text-ink")}>
                    <Money value={majorOf(account.balance)} showUnit={false} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TileShell>
  );
}

export function CockpitMoversTile({ data }: CockpitWidgetProps) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const movers = data.topMovers;
  if (!movers) return null;
  return (
    <TileShell title={t("cockpit.movers.title")} href={drillHref("report-sales-by-item")} footer={t("cockpit.movers.hint")}>
      {movers.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("cockpit.movers.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {movers.map((mover) => {
            const up = mover.direction === CockpitDirectionDTO.Up;
            const name = mover.nameAr ? entityName({ nameAr: mover.nameAr, nameEn: mover.nameEn }, locale) : mover.itemId;
            return (
              <li key={mover.itemId}>
                <Link to={drillHref("items", { q: mover.code ?? mover.itemId })} className="flex min-w-0 items-center justify-between gap-[10px] py-[7px] hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{name}</span>
                    <span className="block text-2xs text-ink-faint">
                      <span className="mz-num">{format.money(majorOf(mover.current))}</span>
                      {" · "}
                      {t("cockpit.movers.was", { value: format.money(majorOf(mover.previous)) })}
                    </span>
                  </span>
                  <span className={cn("mz-num flex-none text-sm font-semibold", up ? "text-success-ink" : "text-danger-ink")}>
                    {up ? "+" : "−"}
                    {format.money(Math.abs(majorOf(mover.change)))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </TileShell>
  );
}

export function CockpitMarginTile({ data, rtl }: CockpitWidgetProps) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const weeks = data.marginTrend;
  if (!weeks) return null;
  const current = weeks[weeks.length - 1];
  const previous = weeks[weeks.length - 2];
  const values = weeks.map((w) => (w.grossMarginPercent === null ? 0 : Number(w.grossMarginPercent)));
  const label = weeks
    .map((w) => t("cockpit.margin.weekLabel", { from: w.from, to: w.to, value: w.grossMarginPercent === null ? t("cockpit.margin.none") : `${format.number(Number(w.grossMarginPercent))}%` }))
    .join("، ");
  const pct = (value: string | null | undefined) => (value === null || value === undefined ? "—" : `${format.number(Number(value))}%`);
  return (
    <TileShell title={t("cockpit.margin.title")} href={drillHref("financial-reports", { tab: "income-statement" })} footer={t("cockpit.margin.hint")}>
      <div className="flex flex-wrap items-baseline gap-x-[16px] gap-y-[4px]">
        <div>
          <div className="text-2xs text-ink-faint">{t("cockpit.margin.current")}</div>
          <div className="mz-num font-display text-lg font-bold text-ink min-[420px]:text-2xl">{pct(current?.grossMarginPercent)}</div>
        </div>
        <div>
          <div className="text-2xs text-ink-faint">{t("cockpit.margin.previous")}</div>
          <div className="mz-num text-md font-semibold text-ink-muted">{pct(previous?.grossMarginPercent)}</div>
        </div>
      </div>
      <div className="mt-[10px]">
        <Sparkline values={values} label={label} rtl={rtl} tone="chart3" />
      </div>
    </TileShell>
  );
}
