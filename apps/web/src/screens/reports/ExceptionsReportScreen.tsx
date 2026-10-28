import type { SecurityExceptionRowDTO, SecurityWatchlistEntryDTO, UnrecordedSecurityEventsDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen, useUserFilterField, securityCopy, type SecurityReportResult } from "./SecurityReportScreen";
import { useAppTranslation } from "../../i18n";
import { useAuditLabels } from "../enh/audit-ledger/audit-changes";
import { monthStartIso, todayIso } from "../../lib/dates";

/** تقرير الاستثناءات الأمنية — `/security-reports/exceptions` (P-4). */

const REPORT = "exceptions" as const;

const SEVERITY_OPTIONS = ["", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;

function knownActionLabel(labels: ReturnType<typeof useAuditLabels>, action: string, fallbackAr: string): string {
  const label = labels.actionLabel(action);
  return label === action ? fallbackAr : label;
}

export function ExceptionsReportScreen() {
  const { t } = useAppTranslation();
  const labels = useAuditLabels();
  const today = todayIso();

  const userFilter = useUserFilterField("actor", t("securityReports.actor"));
  const paramFields: ReportRunnerParamField[] = [
    { kind: "dateRange", fromKey: "from", toKey: "to", label: t("securityReports.period") },
    userFilter,
    { kind: "text", key: "action", label: t("securityReports.action") },
    {
      kind: "select",
      key: "severity",
      label: t("securityReports.severity"),
      options: SEVERITY_OPTIONS.map((value) => ({
        value,
        label: value === "" ? t("securityReports.anySeverity") : t(`securityReports.severity.${value}` as never),
      })),
    },
  ];

  const columns: ReportRunnerColumn<SecurityExceptionRowDTO>[] = [
    { key: "actor", header: securityCopy(REPORT, "col", "actor", "المستخدم", t), value: (r) => r.actorNameAr },
    { key: "actionLabelAr", header: securityCopy(REPORT, "col", "actionLabelAr", "الحدث", t), value: (r) => knownActionLabel(labels, r.action, r.actionLabelAr) },
    {
      key: "count",
      header: securityCopy(REPORT, "col", "count", "العدد", t),
      format: "qty",
      align: "end",
      value: (r) => r.count,
      total: true,
    },
    {
      key: "critical",
      header: securityCopy(REPORT, "col", "critical", "حرِج", t),
      format: "qty",
      align: "end",
      value: (r) => r.critical,
      total: true,
    },
    { key: "warning", header: securityCopy(REPORT, "col", "warning", "تحذير", t), format: "qty", align: "end", value: (r) => r.warning },
    { key: "info", header: securityCopy(REPORT, "col", "info", "معلومة", t), format: "qty", align: "end", value: (r) => r.info },
    { key: "firstAt", header: securityCopy(REPORT, "col", "firstAt", "أول حدوث", t), value: (r) => r.firstAt },
    { key: "lastAt", header: securityCopy(REPORT, "col", "lastAt", "آخر حدوث", t), value: (r) => r.lastAt },
  ];

  return (
    <SecurityReportScreen<SecurityExceptionRowDTO>
      report={REPORT}
      reportId="security.exceptions"
      apiPath="/exceptions"
      title={t("securityReports.exceptionsTitle")}
      description={t("securityReports.exceptionsDescription")}
      paramFields={paramFields}
      defaultParams={{ from: monthStartIso(), to: today, actor: "", action: "", severity: "" }}
      columns={columns}
      rowKey={(r) => `${r.actor}|${r.action}`}
      renderContext={(result) => (
        <>
          <Unrecorded result={result} />
          <Watchlist result={result} />
        </>
      )}
    />
  );
}

/**
 * A watch-list entry at zero is the useful reading: it says the control
 * reported, and reported nothing. That is a different fact from a control that
 * was never wired, and only a row that is rendered can say it.
 */
function Watchlist({ result }: { result: SecurityReportResult<SecurityExceptionRowDTO> }) {
  const { t } = useAppTranslation();
  const labels = useAuditLabels();
  const watchlist = (result as { watchlist?: readonly SecurityWatchlistEntryDTO[] }).watchlist ?? [];
  if (watchlist.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-[12px] py-[10px] text-[12.5px]">
      <div className="mb-[6px] font-semibold text-ink">{t("securityReports.watchlistTitle")}</div>
      <ul className="grid gap-[4px] md:grid-cols-2">
        {watchlist.map((entry) => (
          <li key={entry.action} className="flex items-baseline justify-between gap-[8px]">
            <span className={entry.count > 0 ? "text-ink" : "text-ink-muted"}>{knownActionLabel(labels, entry.action, entry.labelAr)}</span>
            <span className="mz-num font-semibold text-ink">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Unrecorded({ result }: { result: SecurityReportResult<SecurityExceptionRowDTO> }) {
  const { t } = useAppTranslation();
  const unrecorded = (result as { unrecorded?: UnrecordedSecurityEventsDTO }).unrecorded;
  if (!unrecorded) return null;
  if (unrecorded.count === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-[12px] py-[10px] text-[12.5px] text-ink-muted">
        {t("securityReports.unrecordedNone")}
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
      <div className="mb-[6px] flex items-baseline justify-between gap-[8px] font-semibold">
        <span>{t("securityReports.unrecordedTitle")}</span>
        <span className="mz-num">{unrecorded.count}</span>
      </div>
      <p className="mb-[6px]">{t("securityReports.unrecordedHelp")}</p>
      <ul className="grid gap-[4px]">
        {unrecorded.recent.map((entry) => (
          <li key={`${entry.at}|${entry.action}|${entry.actor}`} className="flex flex-wrap items-baseline gap-x-[8px]">
            <span className="mz-num" dir="ltr">{entry.at}</span>
            <span className="font-semibold" dir="ltr">{entry.action}</span>
            <span>{entry.actorNameAr}</span>
            <span dir="ltr">{entry.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
