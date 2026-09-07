import { useState } from "react";
import { Button, StatusPill } from "@mezan/ui";
import type { NewAccountRowDTO } from "@mezan/contracts";
import { useNewAccountsReport } from "../../data/security-reports-hooks";
import { SelectField, TextField } from "../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { SecurityReportView } from "./SecurityReportView";

/**
 * حسابات أُنشئت حديثاً — `/setup/security-new-accounts`, over
 * `GET /security-reports/new-accounts`. Who was onboarded in the look-back
 * window, who created them, and what those accounts have posted or voided
 * since.
 */

const WINDOW_OPTION_KEYS: readonly { value: string; key: AppTranslationKey }[] = [
  { value: "30", key: "securityReports.newAccounts.window30" },
  { value: "90", key: "securityReports.newAccounts.window90" },
  { value: "180", key: "securityReports.newAccounts.window180" },
  { value: "365", key: "securityReports.newAccounts.window365" },
];

interface Filters {
  days: string;
  createdBy: string;
}

const BLANK: Filters = { days: "90", createdBy: "" };

export function NewAccountsScreen() {
  const { t } = useAppTranslation();
  const [filters, setFilters] = useState<Filters>(BLANK);

  const query = useNewAccountsReport({
    days: Number(filters.days),
    createdBy: filters.createdBy.trim() || undefined,
  });
  const report = query.data ?? null;

  return (
    <SecurityReportView<NewAccountRowDTO>
      report="newAccounts"
      title={t("securityReports.newAccounts.title")}
      description={t("securityReports.newAccounts.description")}
      listKey="security-new-accounts"
      columns={report?.columns ?? []}
      rows={report?.rows ?? []}
      rowKey={(row) => row.userId}
      kpis={report?.kpis ?? []}
      coverage={report?.coverage ?? null}
      gaps={report?.gaps ?? []}
      loading={query.isLoading}
      failed={query.isError}
      onRetry={() => void query.refetch()}
      searchValue={filters.createdBy}
      onSearchChange={(v) => setFilters((f) => ({ ...f, createdBy: v }))}
      searchPlaceholder={t("securityReports.newAccounts.searchByCreator")}
      activeFilterCount={filters.days === BLANK.days ? 0 : 1}
      renderCell={(row, key) =>
        key === "status" ? (
          <StatusPill
            label={row.status === "active" ? t("common.active") : t("common.inactive")}
            tone={row.status === "active" ? "success" : "neutral"}
          />
        ) : key === "nameAr" ? (
          <span className="flex items-center gap-[8px]">
            <span className="text-ink">{row.nameAr}</span>
            {row.isCompanyAdmin ? <StatusPill label={t("securityReports.newAccounts.companyAdmin")} tone="danger" /> : null}
          </span>
        ) : key === "createdBy" && row.createdBy === null ? (
          <span className="text-ink-faint">{t("securityReports.newAccounts.unknownCreator")}</span>
        ) : undefined
      }
      filterBarExtra={
        <div className="flex flex-wrap items-end gap-[10px]">
          <div className="w-[200px]">
            <SelectField
              label={t("securityReports.newAccounts.windowLabel")}
              value={filters.days}
              onChange={(v) => setFilters((f) => ({ ...f, days: v }))}
              options={WINDOW_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
            />
          </div>
          <div className="w-[180px]">
            <TextField
              label={t("securityReports.newAccounts.createdByLabel")}
              value={filters.createdBy}
              onChange={(v) => setFilters((f) => ({ ...f, createdBy: v }))}
            />
          </div>
          <Button size="sm" onClick={() => setFilters(BLANK)}>
            {t("audit.clearFilters")}
          </Button>
        </div>
      }
      emptyTitle={t("securityReports.newAccounts.emptyTitle")}
      emptyBody={t("securityReports.newAccounts.emptyBody")}
    />
  );
}
