import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Chip, Button, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { FiscalPeriodDTO, FiscalPeriodStatusDTO } from "@mezan/contracts";
import {
  closePeriod as closePeriodDomain,
  reopenPeriod as reopenPeriodDomain,
  lockPeriod as lockPeriodDomain,
  InvalidPeriodTransitionError,
  type FiscalPeriod,
} from "@mezan/domain";
import { demoFiscalPeriods } from "../accounting-treasury-sample-data";

/**
 * الفترات المالية (Fiscal Periods) — docs/catalog/04 §"الفترات المالية".
 * Period grid with the three-tier lifecycle (مفتوحة → مغلقة → مقفلة) and the
 * close/lock/reopen actions the domain's `packages/domain/src/fiscal-periods`
 * state machine enforces (open must be closed before it can be locked; a
 * locked period is terminal).
 */

const STATUS_LABEL: Record<FiscalPeriodStatusDTO, string> = { open: "مفتوحة", closed: "مغلقة", locked: "مقفلة" };
const STATUS_TONE: Record<FiscalPeriodStatusDTO, PillTone> = { open: "success", closed: "warning", locked: "neutral" };

const MONTH_LABEL_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function monthLabel(periodNumber: number): string {
  return MONTH_LABEL_AR[periodNumber - 1] ?? String(periodNumber);
}

const TODAY = "2026-08-22";

function isCurrentPeriod(period: FiscalPeriodDTO): boolean {
  return TODAY >= period.startDate && TODAY <= period.endDate;
}

export function FiscalPeriodsScreen() {
  const [periods, setPeriods] = useState<FiscalPeriodDTO[]>(demoFiscalPeriods);
  const [year, setYear] = useState(2026);
  const [statusFilter, setStatusFilter] = useState<FiscalPeriodStatusDTO | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const years = useMemo(() => [...new Set(periods.map((p) => p.year))].sort(), [periods]);
  const periodsInYear = useMemo(() => periods.filter((p) => p.year === year).sort((a, b) => a.periodNumber - b.periodNumber), [periods, year]);
  const filtered = useMemo(
    () => (statusFilter === "all" ? periodsInYear : periodsInYear.filter((p) => p.status === statusFilter)),
    [periodsInYear, statusFilter],
  );

  const currentPeriod = periods.find(isCurrentPeriod) ?? null;
  const stalePeriods = periodsInYear.filter((p) => p.status === "open" && p.endDate < TODAY);

  // Each action runs the REAL domain state-machine transition
  // (packages/domain/src/fiscal-periods/transitions.ts) rather than duplicating
  // the rules in the UI — an invalid transition throws and surfaces as an error.
  function applyTransition(period: FiscalPeriodDTO, transition: (p: FiscalPeriod) => FiscalPeriod, verb: string) {
    setActionError(null);
    try {
      const next = transition(period as FiscalPeriod);
      setPeriods((prev) => prev.map((p) => (p.id === period.id ? (next as FiscalPeriodDTO) : p)));
    } catch (err) {
      if (err instanceof InvalidPeriodTransitionError) {
        setActionError(`تعذر ${verb} فترة "${monthLabel(period.periodNumber)} ${period.year}".`);
      } else {
        throw err;
      }
    }
  }

  function closePeriod(period: FiscalPeriodDTO) {
    applyTransition(period, closePeriodDomain, "إغلاق");
  }

  function lockPeriod(period: FiscalPeriodDTO) {
    applyTransition(period, lockPeriodDomain, "قفل");
  }

  function reopenPeriod(period: FiscalPeriodDTO) {
    applyTransition(period, reopenPeriodDomain, "إعادة فتح");
  }

  function generateNextYear() {
    setActionError(null);
    const nextYear = Math.max(...years) + 1;
    if (periods.some((p) => p.year === nextYear)) {
      setActionError(`فترات سنة ${nextYear} موجودة بالفعل.`);
      return;
    }
    const generated: FiscalPeriodDTO[] = Array.from({ length: 12 }, (_, i) => {
      const periodNumber = i + 1;
      const pad = String(periodNumber).padStart(2, "0");
      const endDay = new Date(Date.UTC(nextYear, periodNumber, 0)).getUTCDate();
      return {
        id: `fp-${nextYear}-${pad}`,
        year: nextYear,
        periodNumber,
        startDate: `${nextYear}-${pad}-01`,
        endDate: `${nextYear}-${pad}-${String(endDay).padStart(2, "0")}`,
        status: "open",
      };
    });
    setPeriods((prev) => [...prev, ...generated]);
    setYear(nextYear);
  }

  const columns: DocumentListColumn<FiscalPeriodDTO>[] = [
    {
      key: "period",
      header: "الفترة",
      render: (p) => (
        <div className="flex items-center gap-[8px]">
          <span className="font-semibold text-ink">
            {monthLabel(p.periodNumber)} {p.year}
          </span>
          {isCurrentPeriod(p) ? <StatusPill label="الفترة الحالية" tone="info" /> : p.endDate < TODAY ? <StatusPill label="منتهية" tone="neutral" /> : null}
        </div>
      ),
    },
    { key: "range", header: "من — إلى", render: (p) => <span className="mz-num">{p.startDate} — {p.endDate}</span> },
    { key: "posting", header: "الترحيل", render: (p) => <StatusPill label={p.status === "open" ? "مسموح" : "غير مسموح"} tone={p.status === "open" ? "success" : "danger"} /> },
    { key: "status", header: "الحالة", render: (p) => <StatusPill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /> },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="flex justify-end gap-[6px]">
          {p.status === "open" ? (
            <Button size="sm" onClick={() => closePeriod(p)}>
              إغلاق
            </Button>
          ) : null}
          {p.status === "closed" ? (
            <>
              <Button size="sm" onClick={() => reopenPeriod(p)}>
                إعادة فتح
              </Button>
              <Button size="sm" onClick={() => lockPeriod(p)}>
                قفل
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Accounting · Fiscal Periods</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">الفترات المالية</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">تحكم في إغلاق وقفل الفترات المالية الشهرية لمنع الترحيل بعد إقفال الحسابات</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <select
            aria-label="السنة المالية"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={generateNextYear}>
            إنشاء السنة التالية
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
          <div className="text-[12px] font-semibold text-ink-faint">الفترة الحالية</div>
          <div className="mt-[4px] flex flex-wrap items-center gap-[10px]">
            <span className="font-display text-[15px] font-bold text-ink">
              {monthLabel(currentPeriod.periodNumber)} {currentPeriod.year} ({currentPeriod.startDate} → {currentPeriod.endDate})
            </span>
            <StatusPill label={currentPeriod.status === "open" ? "مسموح" : "غير مسموح"} tone={currentPeriod.status === "open" ? "success" : "danger"} />
          </div>
          {stalePeriods.length > 0 ? (
            <div className="mt-[10px] text-[12.5px] text-warning-ink">
              يحتاج انتباه: <span className="mz-num">{stalePeriods.length}</span> فترة مفتوحة تجاوزت نهايتها.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">إجمالي الفترات</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">فترات مفتوحة</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.filter((p) => p.status === "open").length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">فترات مغلقة</div>
          <div className="mz-num mt-[6px] text-[20px] font-bold text-ink">{periodsInYear.filter((p) => p.status === "closed").length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="text-[11px] font-semibold text-ink-faint">فترات مقفلة</div>
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
                ["all", `الكل (${periodsInYear.length})`],
                ["open", `مفتوحة (${periodsInYear.filter((p) => p.status === "open").length})`],
                ["closed", `مغلقة (${periodsInYear.filter((p) => p.status === "closed").length})`],
                ["locked", `مقفلة (${periodsInYear.filter((p) => p.status === "locked").length})`],
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
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{periodsInYear.length}</span> فترة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فترات مطابقة</div>}
      />
    </div>
  );
}
