import { useCallback, useMemo, useState } from "react";
import { Button, EmptyState, Select, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import { PeriodStatusDTO, type FiscalPeriodDTO, type FiscalPeriodStatusDTO, type PeriodCloseFixTargetDTO } from "@mezan/contracts";
import { useFiscalPeriods } from "../../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { fiscalMonthLabel } from "../../../lib/fiscal-month";
import { useUrlParam } from "../../../lib/url-state";
import { CheckList } from "./CheckList";
import { CloseActions } from "./CloseActions";
import { CloseHistory } from "./CloseHistory";
import { isClear } from "./findings";
import { PeriodCloseAction, usePeriodCloseChecklist } from "./hooks";

const STATUS_KEY: Readonly<Record<FiscalPeriodStatusDTO, AppTranslationKey>> = {
  [PeriodStatusDTO.Open]: "fiscalPeriods.status.open",
  [PeriodStatusDTO.Closed]: "fiscalPeriods.status.closed",
  [PeriodStatusDTO.Locked]: "fiscalPeriods.status.locked",
};
const STATUS_TONE: Readonly<Record<FiscalPeriodStatusDTO, PillTone>> = {
  [PeriodStatusDTO.Open]: "success",
  [PeriodStatusDTO.Closed]: "warning",
  [PeriodStatusDTO.Locked]: "neutral",
};
const NEXT_ACTION: Readonly<Record<FiscalPeriodStatusDTO, PeriodCloseAction | null>> = {
  [PeriodStatusDTO.Open]: PeriodCloseAction.Close,
  [PeriodStatusDTO.Closed]: PeriodCloseAction.Lock,
  [PeriodStatusDTO.Locked]: null,
};

function byPeriodOrder(a: FiscalPeriodDTO, b: FiscalPeriodDTO): number {
  return a.startDate.localeCompare(b.startDate);
}

function periodToCloseNext(periods: readonly FiscalPeriodDTO[], today: string): FiscalPeriodDTO | null {
  const open = periods.filter((p) => p.status === PeriodStatusDTO.Open);
  return open.find((p) => p.endDate < today) ?? open.find((p) => p.startDate <= today && p.endDate >= today) ?? periods[periods.length - 1] ?? null;
}

enum NoticeTone {
  Success = "success",
  Danger = "danger",
}

interface Notice {
  readonly tone: NoticeTone;
  readonly message: string;
}

const NOTICE_ROLE: Readonly<Record<NoticeTone, "status" | "alert">> = { [NoticeTone.Success]: "status", [NoticeTone.Danger]: "alert" };
const NOTICE_CLASS: Readonly<Record<NoticeTone, string>> = {
  [NoticeTone.Success]: "mb-[14px] rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink",
  [NoticeTone.Danger]: "mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink",
};

export function PeriodCloseScreen() {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const nav = useNavigation();
  const periodsQuery = useFiscalPeriods();
  const [periodParam, setPeriodParam] = useUrlParam("period", "");
  const [notice, setNotice] = useState<Notice | null>(null);

  const periods = useMemo(() => [...(periodsQuery.data ?? EMPTY)].sort(byPeriodOrder), [periodsQuery.data]);
  const selected = useMemo(
    () => periods.find((p) => p.id === periodParam) ?? periodToCloseNext(periods, todayIso()),
    [periods, periodParam],
  );
  const selectedId = selected?.id ?? null;
  const checklistQuery = usePeriodCloseChecklist(selected?.id ?? null);
  const checklist = checklistQuery.data;

  const periodLabel = selected ? `${fiscalMonthLabel(selected.periodNumber, t)} ${selected.year}` : "";
  const periodOptions = useMemo(
    () =>
      periods.map((p) => ({
        value: p.id,
        label: t("periodClose.periodOption", { month: fiscalMonthLabel(p.periodNumber, t), year: String(p.year), status: t(STATUS_KEY[p.status]) }),
      })),
    [periods, t],
  );

  const selectPeriod = useCallback(
    (id: string) => {
      setNotice(null);
      setPeriodParam(id);
    },
    [setPeriodParam],
  );
  const openFix = useCallback((target: PeriodCloseFixTargetDTO) => nav.navigate(target), [nav]);
  const openFiscalPeriods = useCallback(() => nav.navigate("fiscal-periods"), [nav]);
  const { refetch } = checklistQuery;
  const recheck = useCallback(() => void refetch(), [refetch]);
  const pinPeriod = useCallback(() => {
    if (selectedId) setPeriodParam(selectedId);
  }, [selectedId, setPeriodParam]);
  const reportDone = useCallback((message: string) => setNotice({ tone: NoticeTone.Success, message }), []);
  const reportError = useCallback((message: string) => setNotice({ tone: NoticeTone.Danger, message }), []);

  if (periodsQuery.isLoading) return null;
  if (!selected) {
    return (
      <EmptyState
        title={t("periodClose.noPeriodsTitle")}
        description={t("periodClose.noPeriodsBody")}
        action={{ label: t("periodClose.openFiscalPeriods"), onClick: openFiscalPeriods }}
      />
    );
  }

  const clearCount = checklist ? checklist.checks.filter(isClear).length : 0;
  const nextAction = checklist ? NEXT_ACTION[checklist.periodStatus] : null;

  return (
    <div className="w-full min-w-0">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[14px]">
        <div className="min-w-0">
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("periodClose.title")}</h1>
          <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("periodClose.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Select size="sm" className="min-w-[220px]" aria-label={t("periodClose.period")} value={selected.id} onChange={selectPeriod} options={periodOptions} />
          <Button onClick={recheck} disabled={checklistQuery.isFetching}>
            {checklistQuery.isFetching ? t("periodClose.refreshing") : t("periodClose.refresh")}
          </Button>
          <Button variant="ghost" onClick={openFiscalPeriods}>
            {t("periodClose.openFiscalPeriods")}
          </Button>
        </div>
      </div>

      {notice ? (
        <div role={NOTICE_ROLE[notice.tone]} className={NOTICE_CLASS[notice.tone]}>
          {notice.message}
        </div>
      ) : null}

      {checklistQuery.isError ? (
        <EmptyState
          title={t("periodClose.loadFailed")}
          description={checklistQuery.error.message}
          action={{ label: t("common.retry"), onClick: recheck }}
        />
      ) : null}

      {checklist ? (
        <>
          <div className="mb-[14px] flex flex-wrap items-center justify-between gap-[12px] rounded-lg border border-border bg-surface p-[14px_16px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-[10px]">
                <span className="font-display text-[15px] font-bold text-ink">{periodLabel}</span>
                <StatusPill label={t(STATUS_KEY[checklist.periodStatus])} tone={STATUS_TONE[checklist.periodStatus]} />
                <span className="mz-num text-[12px] text-ink-muted">
                  {t("periodClose.range", { start: fmt.date(checklist.startDate), end: fmt.date(checklist.endDate) })}
                </span>
              </div>
              <p className="mt-[5px] text-[12.5px] text-ink-muted">
                <span className="mz-num">{t("periodClose.progress", { clear: fmt.number(clearCount), total: fmt.number(checklist.checks.length) })}</span>
                {" · "}
                <span className={checklist.blocking.length === 0 ? "text-success-ink" : "text-danger-ink"}>
                  {checklist.blocking.length === 0 ? t("periodClose.allClear") : t("periodClose.blockedCount", { count: fmt.number(checklist.blocking.length) })}
                </span>
                {" · "}
                <span className="mz-num">{t("periodClose.evaluatedAt", { time: fmt.dateTime(checklist.evaluatedAt) })}</span>
              </p>
              {checklist.periodStatus === PeriodStatusDTO.Locked ? <p className="mt-[5px] text-[12.5px] text-ink-muted">{t("periodClose.periodLocked")}</p> : null}
              {checklist.periodStatus === PeriodStatusDTO.Closed ? <p className="mt-[5px] text-[12.5px] text-ink-muted">{t("periodClose.periodClosed")}</p> : null}
            </div>
            {nextAction ? (
              <CloseActions checklist={checklist} action={nextAction} periodLabel={periodLabel} onStart={pinPeriod} onDone={reportDone} onError={reportError} />
            ) : null}
          </div>

          <CheckList checks={checklist.checks} onFix={openFix} />
          <CloseHistory periodId={checklist.periodId} />
        </>
      ) : null}
    </div>
  );
}
