import { useState } from "react";
import { Button, StatusPill } from "@mezan/ui";
import type { PostPostingChangeRowDTO } from "@mezan/contracts";
import { usePostPostingChangesReport } from "../../data/security-reports-hooks";
import { SelectField, TextField } from "../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { SecurityReportView } from "./SecurityReportView";

/**
 * تقرير التعديلات بعد الترحيل — `/setup/security-post-posting-changes`, over
 * `GET /security-reports/post-posting-changes`. Voids, reversals, reopened
 * periods and numbering adjustments made after a document was posted.
 */

type ChangeType = "VOID" | "REVERSE" | "PERIOD_REOPENED" | "NUMBERING_ADJUSTED";

const CHANGE_TYPE_OPTION_KEYS: readonly { value: string; key: AppTranslationKey }[] = [
  { value: "", key: "securityReports.postPosting.allChangeTypes" },
  { value: "VOID", key: "securityReports.postPosting.changeType.VOID" },
  { value: "REVERSE", key: "securityReports.postPosting.changeType.REVERSE" },
  { value: "PERIOD_REOPENED", key: "securityReports.postPosting.changeType.PERIOD_REOPENED" },
  { value: "NUMBERING_ADJUSTED", key: "securityReports.postPosting.changeType.NUMBERING_ADJUSTED" },
];

const CHANGE_TYPE_KEY: Record<ChangeType, AppTranslationKey> = {
  VOID: "securityReports.postPosting.changeType.VOID",
  REVERSE: "securityReports.postPosting.changeType.REVERSE",
  PERIOD_REOPENED: "securityReports.postPosting.changeType.PERIOD_REOPENED",
  NUMBERING_ADJUSTED: "securityReports.postPosting.changeType.NUMBERING_ADJUSTED",
};

interface Filters {
  from: string;
  to: string;
  actor: string;
  entityType: string;
  changeType: "" | ChangeType;
}

const BLANK: Filters = { from: "", to: "", actor: "", entityType: "", changeType: "" };

export function PostPostingChangesScreen() {
  const { t } = useAppTranslation();
  const [filters, setFilters] = useState<Filters>(BLANK);

  const query = usePostPostingChangesReport({
    from: filters.from.trim() || undefined,
    to: filters.to.trim() || undefined,
    actor: filters.actor.trim() || undefined,
    entityType: filters.entityType.trim() || undefined,
    changeType: filters.changeType || undefined,
  });
  const report = query.data ?? null;

  const activeFilterCount =
    (filters.from.trim() === "" ? 0 : 1) +
    (filters.to.trim() === "" ? 0 : 1) +
    (filters.entityType.trim() === "" ? 0 : 1) +
    (filters.changeType === "" ? 0 : 1);

  return (
    <SecurityReportView<PostPostingChangeRowDTO>
      report="postPosting"
      title={t("securityReports.postPosting.title")}
      description={t("securityReports.postPosting.description")}
      listKey="security-post-posting-changes"
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
        key === "changeTypeLabelAr" ? (
          <StatusPill
            label={t(CHANGE_TYPE_KEY[row.changeType])}
            tone={row.changeType === "PERIOD_REOPENED" || row.changeType === "NUMBERING_ADJUSTED" ? "danger" : "warning"}
          />
        ) : key === "reason" && row.reason === null ? (
          <span className="text-ink-faint">{t("securityReports.postPosting.noReasonRecorded")}</span>
        ) : undefined
      }
      filterBarExtra={
        <div className="flex flex-wrap items-end gap-[10px]">
          <div className="w-[140px]">
            <TextField label={t("audit.from")} value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v }))} placeholder="YYYY-MM-DD" />
          </div>
          <div className="w-[140px]">
            <TextField label={t("audit.to")} value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v }))} placeholder="YYYY-MM-DD" />
          </div>
          <div className="w-[160px]">
            <TextField label={t("audit.entity")} value={filters.entityType} onChange={(v) => setFilters((f) => ({ ...f, entityType: v }))} />
          </div>
          <div className="w-[200px]">
            <SelectField
              label={t("securityReports.postPosting.changeTypeLabel")}
              value={filters.changeType}
              onChange={(v) => setFilters((f) => ({ ...f, changeType: v as Filters["changeType"] }))}
              options={CHANGE_TYPE_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
            />
          </div>
          <Button size="sm" onClick={() => setFilters(BLANK)}>
            {t("audit.clearFilters")}
          </Button>
        </div>
      }
      emptyTitle={t("securityReports.postPosting.emptyTitle")}
      emptyBody={t("securityReports.postPosting.emptyBody")}
    />
  );
}
