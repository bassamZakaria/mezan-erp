import { auditStreamSchema, type AfterHoursRowDTO, type WorkingHoursDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen, securityCopy, type SecurityReportResult } from "./SecurityReportScreen";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { useAuditLabels } from "../enh/audit-ledger/audit-changes";
import { monthStartIso, todayIso } from "../../lib/dates";

/** نشاط خارج أوقات العمل — `/security-reports/after-hours` (P-4). */

const REPORT = "afterHours" as const;

const STREAMS = ["", ...auditStreamSchema.options] as const;
const STREAM_LABEL_KEY: Record<(typeof auditStreamSchema.options)[number], AppTranslationKey> = {
  security: "audit.securityEvents",
  sensitive: "audit.sensitiveOperations",
};
const SEVERITIES = ["", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;

export function AfterHoursReportScreen() {
  const { t } = useAppTranslation();
  const labels = useAuditLabels();

  const paramFields: ReportRunnerParamField[] = [
    { kind: "dateRange", fromKey: "from", toKey: "to", label: t("securityReports.period") },
    { kind: "text", key: "actor", label: t("securityReports.actor") },
    {
      kind: "select",
      key: "stream",
      label: t("securityReports.stream"),
      options: STREAMS.map((value) => ({
        value,
        label: value === "" ? t("securityReports.anyStream") : t(STREAM_LABEL_KEY[value]),
      })),
    },
    {
      kind: "select",
      key: "severity",
      label: t("securityReports.severity"),
      options: SEVERITIES.map((value) => ({
        value,
        label: value === "" ? t("securityReports.anySeverity") : t(`securityReports.severity.${value}` as never),
      })),
    },
  ];

  const columns: ReportRunnerColumn<AfterHoursRowDTO>[] = [
    { key: "localDate", header: securityCopy(REPORT, "col", "localDate", "التاريخ", t), format: "date", value: (r) => r.localDate },
    { key: "localTime", header: securityCopy(REPORT, "col", "localTime", "الوقت", t), value: (r) => r.localTime },
    { key: "weekdayLabelAr", header: securityCopy(REPORT, "col", "weekdayLabelAr", "اليوم", t), value: (r) => r.weekdayLabelAr },
    {
      key: "outsideReasonLabelAr",
      header: securityCopy(REPORT, "col", "outsideReasonLabelAr", "سبب الاستثناء", t),
      value: (r) => r.outsideReasonLabelAr,
    },
    { key: "actor", header: securityCopy(REPORT, "col", "actor", "المستخدم", t), value: (r) => r.actor },
    { key: "action", header: securityCopy(REPORT, "col", "action", "الإجراء", t), value: (r) => labels.actionLabel(r.action) },
    { key: "entityType", header: securityCopy(REPORT, "col", "entityType", "النوع", t), value: (r) => labels.entityLabel(r.entityType) },
    { key: "entityId", header: securityCopy(REPORT, "col", "entityId", "المرجع", t), value: (r) => r.entityId },
    { key: "branchId", header: securityCopy(REPORT, "col", "branchId", "الفرع", t), value: (r) => r.branchId },
  ];

  return (
    <SecurityReportScreen<AfterHoursRowDTO>
      report={REPORT}
      reportId="security.after_hours"
      apiPath="/after-hours"
      title={t("securityReports.afterHoursTitle")}
      description={t("securityReports.afterHoursDescription")}
      paramFields={paramFields}
      defaultParams={{ from: monthStartIso(), to: todayIso(), actor: "", stream: "", severity: "" }}
      columns={columns}
      rowKey={(r) => r.rowKey}
      renderContext={(result) => <WorkingDayBanner result={result} />}
    />
  );
}

/**
 * An after-hours finding computed against an ASSUMED working day is an
 * allegation against a person. The server says whether the shop configured its
 * hours or the server guessed them, and the reader has to be told which.
 */
function WorkingDayBanner({ result }: { result: SecurityReportResult<AfterHoursRowDTO> }) {
  const { t } = useAppTranslation();
  const hours = (result as { workingHours?: WorkingHoursDTO }).workingHours;
  if (!hours) return null;
  const assumed = hours.startHourSource === "default" || hours.weekendSource === "default";
  return (
    <div
      role="status"
      className={
        assumed
          ? "rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink"
          : "rounded-md border border-border bg-surface px-[12px] py-[10px] text-[12.5px] text-ink-muted"
      }
    >
      {t("securityReports.workingDay", {
        start: String(hours.startHour),
        end: String(hours.endHour),
        timezone: hours.timezone,
      })}
      {assumed ? ` ${t("securityReports.workingDayAssumed")}` : ""}
    </div>
  );
}
