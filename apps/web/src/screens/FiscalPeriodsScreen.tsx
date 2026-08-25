import { useMemo, useState } from "react";
import { FulcrumRule, DocumentList, StatusPill, Chip, Button, Card, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { FiscalPeriodDTO, FiscalPeriodStatusDTO } from "@mezan/contracts";
import {
  useClosePeriod,
  useFiscalPeriods,
  useGenerateFiscalYear,
  useLockPeriod,
  useReopenPeriod,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * الفترات المالية (Fiscal Periods) — docs/catalog/04 §"الفترات المالية".
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

const TODAY = new Date().toISOString().slice(0, 10);

function isCurrentPeriod(period: FiscalPeriodDTO): boolean {
  return TODAY >= period.startDate && TODAY <= period.endDate;
}

export function FiscalPeriodsScreen() {
  const { t } = useAppTranslation();
  const query = useFiscalPeriods();
  const generateFiscalYear = useGenerateFiscalYear();
  const closePeriodMutation = useClosePeriod();
  const reopenPeriodMutation = useReopenPeriod();
  const lockPeriodMutation = useLockPeriod();
  const periods = query.data ?? [];

  const [year, setYear] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<FiscalPeriodStatusDTO | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);

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

  const currentPeriod = periods.find(isCurrentPeriod) ?? null;
  const stalePeriods = periodsInYear.filter((p) => p.status === "open" && p.endDate < TODAY);

  // Each action calls the real API, which enforces the fiscal-period state
  // machine server-side — an invalid transition surfaces the server's own
  // error message rather than one guessed on the client.
  async function closePeriod(period: FiscalPeriodDTO) {
    setActionError(null);
    try {
      await closePeriodMutation.mutateAsync(period.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.closeFailed", { period: `${monthLabel(period.periodNumber, t)} ${period.year}` }));
    }
  }

  async function lockPeriod(period: FiscalPeriodDTO) {
    setActionError(null);
    try {
      await lockPeriodMutation.mutateAsync(period.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.lockFailed", { period: `${monthLabel(period.periodNumber, t)} ${period.year}` }));
    }
  }

  async function reopenPeriod(period: FiscalPeriodDTO) {
    setActionError(null);
    try {
      await reopenPeriodMutation.mutateAsync(period.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("fiscalPeriods.reopenFailed", { period: `${monthLabel(period.periodNumber, t)} ${period.year}` }));
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
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="flex justify-end gap-[6px]">
          {p.status === "open" ? (
            <Button size="sm" onClick={() => closePeriod(p)}>
              {t("fiscalPeriods.close")}
            </Button>
          ) : null}
          {p.status === "closed" ? (
            <>
              <Button size="sm" onClick={() => reopenPeriod(p)}>
                {t("fiscalPeriods.reopen")}
              </Button>
              <Button size="sm" onClick={() => lockPeriod(p)}>
                {t("fiscalPeriods.lock")}
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
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
          <div className="mz-eyebrow">Accounting · Fiscal Periods</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("fiscalPeriods.financialPeriods")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("fiscalPeriods.closeAndLockMonthlyFinancial")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <select
            aria-label={t("fiscalPeriods.financialYear")}
            value={selectedYear}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
          >
            {years.length > 0 ? (
              years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))
            ) : (
              <option value={selectedYear}>{selectedYear}</option>
            )}
          </select>
          <Button variant="primary" onClick={generateNextYear}>
            {t("fiscalPeriods.createNextYear")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

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
        eyebrow="Accounting · Fiscal Periods"
        title=""
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {(
              [
                ["all", t("fiscalPeriods.filterAll", { count: String(periodsInYear.length) })],
                ["open", t("fiscalPeriods.filterOpen", { count: String(periodsInYear.filter((p) => p.status === "open").length) })],
                ["closed", t("fiscalPeriods.filterClosed", { count: String(periodsInYear.filter((p) => p.status === "closed").length) })],
                ["locked", t("fiscalPeriods.filterLocked", { count: String(periodsInYear.filter((p) => p.status === "locked").length) })],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>
                {label}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{periodsInYear.length}</span> {t("fiscalPeriods.periods")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("fiscalPeriods.noMatchingPeriods")}</div>}
      />
    </div>
  );
}
