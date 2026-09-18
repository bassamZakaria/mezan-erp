import type { SecurityExceptionRowDTO, SecurityWatchlistEntryDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen, securityCopy, type SecurityReportResult } from "./SecurityReportScreen";
import { useAppTranslation } from "../../i18n";
import { monthStartIso, todayIso } from "../../lib/dates";

/** تقرير الاستثناءات الأمنية — `/security-reports/exceptions` (P-4). */

const REPORT = "exceptions" as const;

const SEVERITY_OPTIONS = ["", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;

export function ExceptionsReportScreen() {
  const { t } = useAppTranslation();
  const today = todayIso();

  const paramFields: ReportRunnerParamField[] = [
    { kind: "dateRange", fromKey: "from", toKey: "to", label: t("securityReports.period") },
    { kind: "text", key: "actor", label: t("securityReports.actor") },
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
    { key: "actor", header: securityCopy(REPORT, "col", "actor", "المستخدم", t), value: (r) => r.actor },
    { key: "actionLabelAr", header: securityCopy(REPORT, "col", "actionLabelAr", "الحدث", t), value: (r) => r.actionLabelAr },
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
      renderContext={(result) => <Watchlist result={result} />}
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
  const watchlist = (result as { watchlist?: readonly SecurityWatchlistEntryDTO[] }).watchlist ?? [];
  if (watchlist.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-[12px] py-[10px] text-[12.5px]">
      <div className="mb-[6px] font-semibold text-ink">{t("securityReports.watchlistTitle")}</div>
      <ul className="grid gap-[4px] md:grid-cols-2">
        {watchlist.map((entry) => (
          <li key={entry.action} className="flex items-baseline justify-between gap-[8px]">
            <span className={entry.count > 0 ? "text-ink" : "text-ink-muted"}>{entry.labelAr}</span>
            <span className="mz-num font-semibold text-ink">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
