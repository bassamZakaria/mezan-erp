import { BranchGatedAction } from "../branch-restriction";
import { useBranchGate } from "../shell/useBranchGate";
import { useEffect, useMemo, useState } from "react";
import {
  RowActionOutcome,
  Button,
  Card,
  Chip,
  DocumentList,
  EmptyState,
  RowMenu,
  Select,
  StatusPill,
  type DocumentListColumn,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { FiscalPeriodDTO, FiscalPeriodStatusDTO } from "@mezan/contracts";
import {
  useClosePeriod,
  useFiscalPeriods,
  useGenerateFiscalYear,
  useLockPeriod,
  useReopenPeriod,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { todayIso } from "../lib/dates";
import { YearEndCloseCard } from "./YearEndCloseCard";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam } from "../lib/url-state";

/**
 * الفترات المالية (Fiscal Periods) — docs/archive/catalog/04 §"الفترات المالية".
 * Period grid with the three-tier lifecycle (مفتوحة → مغلقة → مقفلة); the
 * close/lock/reopen/generate-year actions all run against the real
 * `/fiscal-periods` API, which enforces the transitions server-side (open
 * must be closed before it can be locked; a locked period is terminal) — an
 * invalid transition surfaces the server's real error message.
 */

const STATUS_KEY: Record<FiscalPeriodStatusDTO, AppTranslationKey> = { open: "fiscalPeriods.status.open", closed: "fiscalPeriods.status.closed", locked: "fiscalPeriods.status.locked" };
const STATUS_TONE: Record<FiscalPeriodStatusDTO, PillTone> = { open: "success", closed: "warning", locked: "neutral" };

const MONTH_KEYS: AppTranslationKey[] = [
  "month.january",
  "month.february",
  "month.march",
  "month.april",
  "month.may",
  "month.june",
  "month.july",
  "month.august",
  "month.september",
  "month.october",
  "month.november",
  "month.december",
];

function monthLabel(periodNumber: number, t: (key: AppTranslationKey) => string): string {
  const key = MONTH_KEYS[periodNumber - 1];
  return key ? t(key) : String(periodNumber);
}

const TODAY = todayIso();

function isCurrentPeriod(period: FiscalPeriodDTO): boolean {
  return TODAY >= period.startDate && TODAY <= period.endDate;
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function FiscalPeriodsScreen() {
  const branchGate = useBranchGate();
  const { t } = useAppTranslation();
  const query = useFiscalPeriods();
  const generateFiscalYear = useGenerateFiscalYear();
  const closePeriodMutation = useClosePeriod();
  const reopenPeriodMutation = useReopenPeriod();
  const lockPeriodMutation = useLockPeriod();
  const periods = query.data ?? EMPTY;

  const [year, setYear] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    FiscalPeriodStatusDTO | "all",
    (next: string) => void,
  ];
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const years = useMemo(() => [...new Set(periods.map((p) => p.year))].sort((a, b) => a - b), [periods]);
  const selectedYear = year ?? years[years.length - 1] ?? new Date().getUTCFullYear();
  const periodsInYear = useMemo(
    () => periods.filter((p) => p.year === selectedYear).sort((a, b) => a.periodNumber - b.periodNumber),
    [periods, selectedYear],
  );
  const filtered = useMemo(
    () => (statusFilter === "all" ? periodsInYear : periodsInYear.filter((p) => p.status === statusFilter)),
    [periodsInYear, statusFilter],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = statusFilter === "all" ? 0 : 1;

  const currentPeriod = periods.find(isCurrentPeriod) ?? null;
  const stalePeriods = periodsInYear.filter((p) => p.status === "open" && p.endDate < TODAY);

  // Each action calls the real API, which enforces the fiscal-period state
  // machine server-side — an invalid transition surfaces the server's own
  // error message rather than one guessed on the client.
  async function closePeriod(period: FiscalPeriodDTO) {
    if (pendingId) return;
    setPendingId(period.id);
    setActionError(null);
    try {
      await closePeriodMutation.mutateAsync(period.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.closeFailed", { period: `${monthLabel(period.periodNumber, t)} ${period.year}` }));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  async function lockPeriod(period: FiscalPeriodDTO) {
    if (pendingId) return;
    setPendingId(period.id);
    setActionError(null);
    try {
      await lockPeriodMutation.mutateAsync(period.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.lockFailed", { period: `${monthLabel(period.periodNumber, t)} ${period.year}` }));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  async function reopenPeriod(period: FiscalPeriodDTO) {
    if (pendingId) return;
    setPendingId(period.id);
    setActionError(null);
    try {
      await reopenPeriodMutation.mutateAsync(period.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.reopenFailed", { period: `${monthLabel(period.periodNumber, t)} ${period.year}` }));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  async function generateNextYear() {
    setActionError(null);
    const nextYear = years.length > 0 ? Math.max(...years) + 1 : new Date().getUTCFullYear();
    try {
      await generateFiscalYear.mutateAsync({ year: nextYear });
      setYear(nextYear);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.generateFailed", { year: String(nextYear) }));
    }
  }

  const columns: DocumentListColumn<FiscalPeriodDTO>[] = [
    {
      key: "period",
      header: t("common.period"),
      render: (p) => (
        <div className="flex items-center gap-[8px]">
          <span className="font-semibold text-ink">
            {monthLabel(p.periodNumber, t)} {p.year}
          </span>
          {isCurrentPeriod(p) ? <StatusPill label={t("fiscalPeriods.currentPeriod")} tone="info" /> : p.endDate < TODAY ? <StatusPill label={t("fiscalPeriods.ended")} tone="neutral" /> : null}
        </div>
      ),
    },
    { key: "range", header: t("fiscalPeriods.fromTo"), render: (p) => <span className="mz-num">{p.startDate} — {p.endDate}</span> },
    { key: "posting", header: t("fiscalPeriods.posting"), render: (p) => <StatusPill label={p.status === "open" ? t("fiscalPeriods.allowed") : t("fiscalPeriods.notAllowed")} tone={p.status === "open" ? "success" : "danger"} /> },
    { key: "status", header: t("common.status"), render: (p) => <StatusPill label={t(STATUS_KEY[p.status])} tone={STATUS_TONE[p.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("fiscalPeriods.financialPeriodsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("fiscalPeriods.financialPeriods")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("fiscalPeriods.closeAndLockMonthlyFinancial")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Select
            size="sm"
            className="w-[130px]"
            aria-label={t("fiscalPeriods.financialYear")}
            value={String(selectedYear)}
            onChange={(value) => setYear(Number(value))}
            options={(years.length > 0 ? years : [selectedYear]).map((y) => ({ value: String(y), label: String(y) }))}
          />
          <Button variant="primary" onClick={generateNextYear}>
            {t("fiscalPeriods.createNextYear")}
          </Button>
        </div>
      </div>

      {actionError ? (
        <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}

      {currentPeriod ? (
        <div className="mb-[18px] rounded-lg border border-border bg-surface p-[16px_18px]">
          <div className="text-[12px] font-semibold text-ink-faint">{t("fiscalPeriods.currentPeriod")}</div>
          <div className="mt-[4px] flex flex-wrap items-center gap-[10px]">
            <span className="font-display text-[15px] font-bold text-ink">
              {monthLabel(currentPeriod.periodNumber, t)} {currentPeriod.year} ({currentPeriod.startDate} → {currentPeriod.endDate})
            </span>
            <StatusPill label={currentPeriod.status === "open" ? t("fiscalPeriods.allowed") : t("fiscalPeriods.notAllowed")} tone={currentPeriod.status === "open" ? "success" : "danger"} />
          </div>
          {stalePeriods.length > 0 ? (
            <div className="mt-[10px] text-[12.5px] text-warning-ink">
              {t("fiscalPeriods.needsAttention")} <span className="mz-num">{stalePeriods.length}</span> {t("fiscalPeriods.openPeriodsArePastTheir")}
            </div>
          ) : null}
        </div>
      ) : null}

      {branchGate.allows(BranchGatedAction.YearEndClose) ? <YearEndCloseCard year={selectedYear} periodsInYear={periodsInYear} /> : null}

      <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">{t("fiscalPeriods.totalPeriods")}</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">{t("fiscalPeriods.openPeriods")}</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.filter((p) => p.status === "open").length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">{t("fiscalPeriods.closedPeriods")}</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.filter((p) => p.status === "closed").length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">{t("fiscalPeriods.lockedPeriods")}</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.filter((p) => p.status === "locked").length}</div>
        </div>
      </div>

      <DocumentList<FiscalPeriodDTO>
        title=""
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]" role="radiogroup">
            {(
              [
                ["all", t("fiscalPeriods.filterAll", { count: String(periodsInYear.length) })],
                ["open", t("fiscalPeriods.filterOpen", { count: String(periodsInYear.filter((p) => p.status === "open").length) })],
                ["closed", t("fiscalPeriods.filterClosed", { count: String(periodsInYear.filter((p) => p.status === "closed").length) })],
                ["locked", t("fiscalPeriods.filterLocked", { count: String(periodsInYear.filter((p) => p.status === "locked").length) })],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                active={statusFilter === value}
                onClick={() => {
                  setStatusFilter(value);
                  setPage(1);
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(p) => p.id}
        rowAction={(p) => {
          const menuItems: RowMenuItem[] =
            p.status === "open"
              ? [{ key: "close", label: t("fiscalPeriods.close"), disabled: pendingId === p.id, onSelect: () => closePeriod(p) }]
              : p.status === "closed"
                ? [
                    { key: "reopen", label: t("fiscalPeriods.reopen"), disabled: pendingId === p.id, onSelect: () => reopenPeriod(p) },
                    { key: "lock", label: t("fiscalPeriods.lock"), disabled: pendingId === p.id, onSelect: () => lockPeriod(p) },
                  ]
                : [];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: `${monthLabel(p.periodNumber, t)} ${p.year}` })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{periodsInYear.length}</span> {t("fiscalPeriods.periods")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("fiscalPeriods.noMatchingPeriods")}
            description={t("fiscalPeriods.emptyBody")}
            action={{ label: t("fiscalPeriods.createNextYear"), onClick: generateNextYear }}
          />
        }
      />
    </div>
  );
}
