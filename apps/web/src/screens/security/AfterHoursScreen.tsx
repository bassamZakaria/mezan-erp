import { useState } from "react";
import { Button, Card, StatusPill } from "@mezan/ui";
import type { AfterHoursRowDTO, AuditSeverityDTO, AuditStreamDTO } from "@mezan/contracts";
import { useAfterHoursReport } from "../../data/security-reports-hooks";
import { SelectField, TextField } from "../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { SecurityReportView } from "./SecurityReportView";

/**
 * نشاط خارج أوقات العمل — `/setup/security-after-hours`, over
 * `GET /security-reports/after-hours`.
 *
 * The banner naming the working day is not decoration. An after-hours finding
 * is an allegation against a person, and `workingHours.startHourSource` is the
 * server saying whether the shop configured that day or whether it assumed one.
 */

const SEVERITY_OPTION_KEYS: readonly { value: string; key: AppTranslationKey }[] = [
  { value: "", key: "audit.allSeverities" },
  { value: "CRITICAL", key: "audit.critical" },
  { value: "ERROR", key: "audit.error" },
  { value: "WARNING", key: "audit.warning" },
  { value: "INFO", key: "audit.info" },
];

const STREAM_OPTION_KEYS: readonly { value: string; key: AppTranslationKey }[] = [
  { value: "", key: "securityReports.afterHours.allStreams" },
  { value: "security", key: "audit.securityEvents" },
  { value: "sensitive", key: "audit.sensitiveOperations" },
];

const OUTSIDE_REASON_KEY: Record<AfterHoursRowDTO["outsideReason"], AppTranslationKey> = {
  WEEKEND: "securityReports.afterHours.reason.WEEKEND",
  BEFORE_HOURS: "securityReports.afterHours.reason.BEFORE_HOURS",
  AFTER_HOURS: "securityReports.afterHours.reason.AFTER_HOURS",
};

interface Filters {
  from: string;
  to: string;
  actor: string;
  stream: "" | AuditStreamDTO;
  severity: "" | AuditSeverityDTO;
}

const BLANK: Filters = { from: "", to: "", actor: "", stream: "", severity: "" };

export function AfterHoursScreen() {
  const { t } = useAppTranslation();
  const [filters, setFilters] = useState<Filters>(BLANK);

  const query = useAfterHoursReport({
    from: filters.from.trim() || undefined,
    to: filters.to.trim() || undefined,
    actor: filters.actor.trim() || undefined,
    stream: filters.stream || undefined,
    severity: filters.severity || undefined,
  });
  const report = query.data ?? null;
  const workingHours = report?.workingHours ?? null;

  const activeFilterCount =
    (filters.from.trim() === "" ? 0 : 1) +
    (filters.to.trim() === "" ? 0 : 1) +
    (filters.stream === "" ? 0 : 1) +
    (filters.severity === "" ? 0 : 1);

  return (
    <SecurityReportView<AfterHoursRowDTO>
      report="afterHours"
      title={t("securityReports.afterHours.title")}
      description={t("securityReports.afterHours.description")}
      listKey="security-after-hours"
      columns={report?.columns ?? []}
      rows={report?.rows ?? []}
      rowKey={(row) => row.rowKey}
      kpis={report?.kpis ?? []}
      coverage={report?.coverage ?? null}
      gaps={report?.gaps ?? []}
      loading={query.isLoading}
      failed={query.isError}
      onRetry={() => void query.refetch()}
      searchValue={filters.actor}
      onSearchChange={(v) => setFilters((f) => ({ ...f, actor: v }))}
      searchPlaceholder={t("audit.searchByUser")}
      activeFilterCount={activeFilterCount}
      renderCell={(row, key) =>
        key === "outsideReasonLabelAr" ? (
          <StatusPill label={t(OUTSIDE_REASON_KEY[row.outsideReason])} tone={row.outsideReason === "WEEKEND" ? "danger" : "warning"} />
        ) : undefined
      }
      banner={
        workingHours ? (
          <Card className="mb-[18px] p-[14px_18px]">
            <p className="text-[12.5px] font-semibold text-ink">{t("securityReports.afterHours.workingDayTitle")}</p>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">
              {t("securityReports.afterHours.workingDayFrom")} <span className="mz-num">{workingHours.startHour}:00</span>{" "}
              {t("securityReports.afterHours.workingDayTo")} <span className="mz-num">{workingHours.endHour}:00</span> ·{" "}
              <span className="mz-num">{workingHours.timezone}</span>
            </p>
            {workingHours.startHourSource === "default" || workingHours.weekendSource === "default" ? (
              <p className="mt-[6px] text-[12.5px] font-semibold text-warning-ink">
                {t("securityReports.afterHours.workingDayAssumed")}
              </p>
            ) : null}
          </Card>
        ) : null
      }
      filterBarExtra={
        <div className="flex flex-wrap items-end gap-[10px]">
          <div className="w-[140px]">
            <TextField label={t("audit.from")} value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v }))} placeholder="YYYY-MM-DD" />
          </div>
          <div className="w-[140px]">
            <TextField label={t("audit.to")} value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v }))} placeholder="YYYY-MM-DD" />
          </div>
          <div className="w-[190px]">
            <SelectField
              label={t("common.type")}
              value={filters.stream}
              onChange={(v) => setFilters((f) => ({ ...f, stream: v as Filters["stream"] }))}
              options={STREAM_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
            />
          </div>
          <div className="w-[170px]">
            <SelectField
              label={t("audit.severity")}
              value={filters.severity}
              onChange={(v) => setFilters((f) => ({ ...f, severity: v as Filters["severity"] }))}
              options={SEVERITY_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
            />
          </div>
          <Button size="sm" onClick={() => setFilters(BLANK)}>
            {t("audit.clearFilters")}
          </Button>
        </div>
      }
      emptyTitle={t("securityReports.afterHours.emptyTitle")}
      emptyBody={t("securityReports.afterHours.emptyBody")}
    />
  );
}
