import { useState } from "react";
import { Button, Card, StatusPill } from "@mezan/ui";
import type { AuditSeverityDTO, SecurityExceptionRowDTO } from "@mezan/contracts";
import { useSecurityExceptionsReport } from "../../data/security-reports-hooks";
import { SelectField, TextField } from "../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { SecurityReportView } from "./SecurityReportView";

/**
 * تقرير الاستثناءات الأمنية — `/setup/security-exceptions`, over
 * `GET /security-reports/exceptions`. Every security-stream event in the
 * period, grouped by actor and counted by severity, plus the watch list of
 * named controls and whether each one fired.
 */

const SEVERITY_OPTION_KEYS: readonly { value: string; key: AppTranslationKey }[] = [
  { value: "", key: "audit.allSeverities" },
  { value: "CRITICAL", key: "audit.critical" },
  { value: "ERROR", key: "audit.error" },
  { value: "WARNING", key: "audit.warning" },
  { value: "INFO", key: "audit.info" },
];

interface Filters {
  from: string;
  to: string;
  actor: string;
  action: string;
  severity: "" | AuditSeverityDTO;
}

const BLANK: Filters = { from: "", to: "", actor: "", action: "", severity: "" };

export function SecurityExceptionsScreen() {
  const { t } = useAppTranslation();
  const [filters, setFilters] = useState<Filters>(BLANK);

  const query = useSecurityExceptionsReport({
    from: filters.from.trim() || undefined,
    to: filters.to.trim() || undefined,
    actor: filters.actor.trim() || undefined,
    action: filters.action.trim() || undefined,
    severity: filters.severity || undefined,
  });
  const report = query.data ?? null;

  const activeFilterCount =
    (filters.from.trim() === "" ? 0 : 1) +
    (filters.to.trim() === "" ? 0 : 1) +
    (filters.action.trim() === "" ? 0 : 1) +
    (filters.severity === "" ? 0 : 1);

  const watchlist = report?.watchlist ?? [];

  return (
    <SecurityReportView<SecurityExceptionRowDTO>
      report="exceptions"
      title={t("securityReports.exceptions.title")}
      description={t("securityReports.exceptions.description")}
      listKey="security-exceptions"
      columns={report?.columns ?? []}
      rows={report?.rows ?? []}
      rowKey={(row) => `${row.actor}-${row.action}`}
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
      filterBarExtra={
        <div className="flex flex-wrap items-end gap-[10px]">
          <div className="w-[140px]">
            <TextField label={t("audit.from")} value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v }))} placeholder="YYYY-MM-DD" />
          </div>
          <div className="w-[140px]">
            <TextField label={t("audit.to")} value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v }))} placeholder="YYYY-MM-DD" />
          </div>
          <div className="w-[160px]">
            <TextField label={t("audit.action")} value={filters.action} onChange={(v) => setFilters((f) => ({ ...f, action: v }))} />
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
      banner={
        watchlist.length > 0 ? (
          <Card className="mb-[18px] p-[16px_20px]">
            <h3 className="text-[13px] font-semibold text-ink">{t("securityReports.watchlistTitle")}</h3>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("securityReports.watchlistBody")}</p>
            <ul className="mt-[12px] flex flex-wrap gap-[10px]">
              {watchlist.map((entry) => (
                <li key={entry.action} className="flex items-center gap-[8px] rounded-md border border-border bg-surface-2 p-[8px_12px]">
                  <span className="text-[12.5px] text-ink">{entry.labelAr}</span>
                  <StatusPill label={String(entry.count)} tone={entry.count > 0 ? "warning" : "neutral"} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null
      }
      emptyTitle={t("securityReports.exceptions.emptyTitle")}
      emptyBody={t("securityReports.exceptions.emptyBody")}
    />
  );
}
