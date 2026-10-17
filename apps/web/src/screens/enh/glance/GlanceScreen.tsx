import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Button, Card, Money, Select, cn, useFormat, type SelectOption } from "@mezan/ui";
import { OwnerDigestExceptionKind, OwnerDigestSeverity, type GlanceDTO, type OwnerDigestExceptionDTO } from "@mezan/contracts";
import { UNATTRIBUTED_BRANCH_ID } from "@mezan/domain";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { majorOf, scaledOf } from "../../../lib/money";
import { useGlance } from "./hooks";

const PULL_TRIGGER_PX = 72;
const PULL_MAX_PX = 112;
const SCALE_TENTHS = 1000n;
const TWO = 2n;

enum PullPhase {
  Idle = "idle",
  Pulling = "pulling",
  Ready = "ready",
}

enum DeltaTone {
  Up = "up",
  Down = "down",
  Level = "level",
}

const DELTA_CLASS: Record<DeltaTone, string> = {
  [DeltaTone.Up]: "text-success-ink",
  [DeltaTone.Down]: "text-danger-ink",
  [DeltaTone.Level]: "text-ink-muted",
};

const SEVERITY_LABEL: Record<OwnerDigestSeverity, AppTranslationKey> = {
  [OwnerDigestSeverity.Notice]: "glance.severity.notice",
  [OwnerDigestSeverity.Warning]: "glance.severity.warning",
  [OwnerDigestSeverity.Critical]: "glance.severity.critical",
};

const SEVERITY_CLASS: Record<OwnerDigestSeverity, string> = {
  [OwnerDigestSeverity.Notice]: "border-border bg-surface-2 text-ink-muted",
  [OwnerDigestSeverity.Warning]: "border-warning bg-warning-soft text-warning-ink",
  [OwnerDigestSeverity.Critical]: "border-danger bg-danger-soft text-danger-ink",
};

const KIND_LABEL: Record<OwnerDigestExceptionKind, AppTranslationKey> = {
  [OwnerDigestExceptionKind.Void]: "glance.exception.void",
  [OwnerDigestExceptionKind.LargeDiscount]: "glance.exception.large_discount",
  [OwnerDigestExceptionKind.BelowFloor]: "glance.exception.below_floor",
  [OwnerDigestExceptionKind.CashVariance]: "glance.exception.cash_variance",
  [OwnerDigestExceptionKind.OverdueCollections]: "glance.exception.overdue_collections",
  [OwnerDigestExceptionKind.LowStock]: "glance.exception.low_stock",
  [OwnerDigestExceptionKind.ApprovalsWaiting]: "glance.exception.approvals_waiting",
  [OwnerDigestExceptionKind.FailedEta]: "glance.exception.failed_eta",
  [OwnerDigestExceptionKind.Backup]: "glance.exception.backup",
};

function weekdayName(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));
}

function percentChange(current: bigint, previous: bigint): { readonly tenths: bigint; readonly tone: DeltaTone } | null {
  if (previous === 0n) return null;
  if (current === previous) return { tenths: 0n, tone: DeltaTone.Level };
  const base = previous < 0n ? -previous : previous;
  const diff = (current - previous) * SCALE_TENTHS;
  const magnitude = diff < 0n ? -diff : diff;
  const tenths = (magnitude * TWO + base) / (base * TWO);
  return { tenths: diff < 0n ? -tenths : tenths, tone: diff < 0n ? DeltaTone.Down : DeltaTone.Up };
}

function tenthsText(tenths: bigint): string {
  const abs = tenths < 0n ? -tenths : tenths;
  return `${tenths < 0n ? "−" : "+"}${abs / 10n}.${abs % 10n}%`;
}

function Stat({ label, children, detail, tone }: { label: string; children: ReactNode; detail?: ReactNode; tone?: "danger" }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink-muted">{label}</h2>
      <div className={cn("mt-1 min-w-0 font-display text-3xl font-bold leading-tight tracking-tight", tone === "danger" ? "text-danger-ink" : "text-ink")}>{children}</div>
      {detail ? <div className="mt-2 text-sm text-ink-muted">{detail}</div> : null}
    </Card>
  );
}

function CountStat({ label, value, detail, alert }: { label: string; value: string; detail: string; alert: boolean }) {
  return (
    <Card className="flex flex-col p-4">
      <h2 className="text-sm font-semibold text-ink-muted">{label}</h2>
      <div className={cn("mt-1 font-display text-4xl font-bold leading-tight", alert ? "text-danger-ink" : "text-ink")}>
        <span className="mz-num">{value}</span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{detail}</p>
    </Card>
  );
}

function ExceptionRow({ exception }: { exception: OwnerDigestExceptionDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-base font-semibold text-ink">{t(KIND_LABEL[exception.kind])}</p>
        {exception.amount !== null ? (
          <p className="text-sm text-ink-muted">
            <Money value={majorOf(exception.amount)} />
          </p>
        ) : null}
      </div>
      <div className="flex flex-none items-center gap-2">
        <span className={cn("rounded-full border px-2 py-[2px] text-xs font-semibold", SEVERITY_CLASS[exception.severity])}>{t(SEVERITY_LABEL[exception.severity])}</span>
        <span className="mz-num min-w-[2ch] text-center font-display text-xl font-bold text-ink">{format.number(exception.count)}</span>
      </div>
    </li>
  );
}

function GlanceCards({ data }: { data: GlanceDTO }) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const { cockpit } = data;
  const day = weekdayName(cockpit.compareDate, locale);
  const salesNow = scaledOf(cockpit.pulse.sales.today);
  const change = percentChange(salesNow, scaledOf(cockpit.pulse.sales.sameWeekdayLastWeek));
  const margin = cockpit.pulse.grossMarginPercent;
  const overdue = cockpit.overdueReceivables;
  const stock = cockpit.lowStock;

  let delta = t("cockpit.pulse.noCompare", { day });
  let deltaTone = DeltaTone.Level;
  if (change) {
    deltaTone = change.tone;
    delta = change.tone === DeltaTone.Level ? t("cockpit.pulse.flat", { day }) : t("cockpit.pulse.vs", { day, value: tenthsText(change.tenths) });
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-muted">{t("glance.sales")}</h2>
        <div className="mt-1 min-w-0 font-display text-5xl font-bold leading-tight tracking-tight text-ink">
          <Money value={majorOf(cockpit.pulse.sales.today)} />
        </div>
        <p className={cn("mt-2 text-sm font-semibold", DELTA_CLASS[deltaTone])}>{delta}</p>
        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 min-[380px]:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-sm text-ink-muted">{t("glance.collections")}</dt>
            <dd className="mt-1 font-display text-xl font-bold text-ink">
              <Money value={majorOf(cockpit.pulse.collections.today)} />
            </dd>
          </div>
          {margin?.today ? (
            <div className="min-w-0">
              <dt className="text-sm text-ink-muted">{t("glance.margin")}</dt>
              <dd className="mt-1 font-display text-xl font-bold text-ink">
                <span className="mz-num">{format.number(Number(margin.today))}%</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {cockpit.cash ? (
        <Stat label={t("glance.cash")} detail={t("glance.cash.accounts", { count: format.number(cockpit.cash.accounts.length) })}>
          <Money value={majorOf(cockpit.cash.total)} />
        </Stat>
      ) : null}

      {data.receivables ? (
        <Stat
          label={t("glance.receivables")}
          detail={
            overdue && overdue.invoiceCount > 0 ? (
              <span className="text-danger-ink">
                {t("glance.receivables.overdue")}: <Money value={majorOf(overdue.amount)} /> · {t("glance.receivables.detail", { invoices: format.number(overdue.invoiceCount), customers: format.number(overdue.customerCount) })}
              </span>
            ) : (
              t("glance.receivables.clear")
            )
          }
        >
          <Money value={majorOf(data.receivables.amount)} />
        </Stat>
      ) : null}

      {data.payables ? (
        <Stat label={t("glance.payables")}>
          <Money value={majorOf(data.payables.amount)} />
        </Stat>
      ) : null}

      {stock || data.approvals ? (
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          {stock ? (
            <CountStat
              label={t("glance.lowStock")}
              value={format.number(stock.low + stock.out)}
              detail={stock.low + stock.out === 0 ? t("glance.lowStock.clear") : t("glance.lowStock.out", { count: format.number(stock.out) })}
              alert={stock.out > 0}
            />
          ) : null}
          {data.approvals ? (
            <CountStat
              label={t("glance.approvals")}
              value={format.number(data.approvals.waiting)}
              detail={data.approvals.oldestWaitingSince ? t("glance.approvals.oldest", { date: format.date(data.approvals.oldestWaitingSince) }) : t("glance.approvals.clear")}
              alert={false}
            />
          ) : null}
        </div>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink-muted">{t("glance.exceptions")}</h2>
        {data.exceptions.length === 0 ? (
          <p className="mt-2 text-base text-ink-muted">{t("glance.exceptions.clear")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {data.exceptions.map((exception) => (
              <ExceptionRow key={exception.kind} exception={exception} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function branchOptions(data: GlanceDTO | undefined, t: (key: AppTranslationKey) => string): SelectOption[] {
  if (!data || data.branches.length < 2) return [];
  return [
    { value: "", label: t("glance.branch.all") },
    ...data.branches.map((branch) => ({ value: branch.id, label: branch.name })),
    { value: UNATTRIBUTED_BRANCH_ID, label: t("glance.branch.unattributed") },
  ];
}

export function GlanceView() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const [branchId, setBranchId] = useState("");
  const glance = useGlance(branchId);
  const { refetch, isFetching } = glance;
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | null>(null);

  const refresh = useCallback(() => {
    if (isFetching) return;
    void refetch();
  }, [isFetching, refetch]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  function onTouchStart(event: TouchEvent) {
    pullStart.current = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null;
  }

  function onTouchMove(event: TouchEvent) {
    if (pullStart.current === null) return;
    const distance = (event.touches[0]?.clientY ?? pullStart.current) - pullStart.current;
    setPull(distance > 0 ? Math.min(distance, PULL_MAX_PX) : 0);
  }

  function onTouchEnd() {
    if (pull >= PULL_TRIGGER_PX) refresh();
    pullStart.current = null;
    setPull(0);
  }

  const phase = pull >= PULL_TRIGGER_PX ? PullPhase.Ready : pull > 0 ? PullPhase.Pulling : PullPhase.Idle;
  const options = branchOptions(glance.data, t);
  const stamp = glance.data ? t("glance.updatedAt", { time: format.time(glance.data.generatedAt) }) : "";

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div aria-hidden={phase === PullPhase.Idle} className="overflow-hidden text-center text-sm text-ink-muted transition-[height]" style={{ height: pull }}>
        {phase === PullPhase.Ready ? t("glance.release") : phase === PullPhase.Pulling ? t("glance.pull") : null}
      </div>

      <div className="mb-3 flex items-center gap-2">
        {options.length > 0 ? (
          <div className="min-w-0 flex-1">
            <Select value={branchId} onChange={setBranchId} options={options} aria-label={t("glance.branch")} />
          </div>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-ink-muted">{t("glance.readOnly")}</p>
        )}
        <Button variant="default" onClick={refresh} aria-busy={isFetching} disabled={isFetching} className="flex-none justify-center">
          {isFetching ? t("glance.refreshing") : t("glance.refresh")}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mb-3 text-xs text-ink-faint">
        {stamp}
      </p>

      {glance.isError && !glance.data ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger bg-danger-soft p-4 text-danger-ink">
          <p className="text-base">{glance.error.message || t("glance.loadFailed")}</p>
          <Button variant="default" onClick={refresh} className="justify-center">
            {t("glance.retry")}
          </Button>
        </div>
      ) : glance.data ? (
        <GlanceCards data={glance.data} />
      ) : (
        <p role="status" className="py-10 text-center text-base text-ink-muted">
          {t("glance.loading")}
        </p>
      )}
    </div>
  );
}

export function GlanceScreen() {
  const { t } = useAppTranslation();
  return (
    <div className="mx-auto w-full max-w-[480px] p-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("glance.title")}</h1>
      <p className="mb-4 mt-1 text-sm text-ink-muted">{t("glance.subtitle")}</p>
      <GlanceView />
    </div>
  );
}
