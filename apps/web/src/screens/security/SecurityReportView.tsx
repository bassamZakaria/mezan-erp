import { useMemo, type ReactNode } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  formatDateTime,
  type DocumentListColumn,
  type DocumentListStat,
  type Locale,
} from "@mezan/ui";
import type { ReportColumnDTO, ReportCoverageDTO, ReportGapDTO, ReportKpiDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { tryReportLabel } from "../../report-labels";

/**
 * تقارير الرقابة والأمان — the shared frame the four exception reports render
 * inside. The server owns the columns, the KPIs and the `gaps` list; this only
 * lays them out and overlays the English copy by catalogue key.
 */

export type SecurityReportKey = "exceptions" | "postPosting" | "afterHours" | "newAccounts";

export function securityCopy(
  report: SecurityReportKey,
  kind: "col" | "kpi" | "gap" | "gapDetail",
  key: string,
  fallbackAr: string,
  t: (key: AppTranslationKey) => string,
): string {
  return tryReportLabel(`securityReports.${report}.${kind}.${key}`, fallbackAr, t);
}

function formatCell(value: unknown, format: ReportColumnDTO["format"], locale: Locale): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-ink-faint">—</span>;
  if (format === "qty") return <span className="mz-num text-ink">{String(value)}</span>;
  if (format === "datetime" || format === "date") {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return <span className="mz-num text-ink-muted">{String(value)}</span>;
    return (
      <span className="mz-num text-ink-muted">
        {format === "date" ? formatDateTime(parsed, { locale }).split(" ")[0] : formatDateTime(parsed, { locale })}
      </span>
    );
  }
  if (typeof value === "boolean") return <span className="text-ink">{String(value)}</span>;
  return <span className="text-ink">{String(value)}</span>;
}

export interface SecurityReportViewProps<Row> {
  readonly report: SecurityReportKey;
  readonly title: string;
  readonly description: string;
  readonly listKey: string;
  readonly columns: readonly ReportColumnDTO[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
  readonly kpis: readonly ReportKpiDTO[];
  readonly coverage: ReportCoverageDTO | null;
  readonly gaps: readonly ReportGapDTO[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly searchValue?: string;
  readonly onSearchChange?: (value: string) => void;
  readonly searchPlaceholder?: string;
  readonly filterBarExtra?: ReactNode;
  readonly activeFilterCount?: number;
  /** Rendered above the table — the working-day banner, the watch list. */
  readonly banner?: ReactNode;
  /** Overrides one cell; return undefined to fall back to the generic renderer. */
  readonly renderCell?: (row: Row, columnKey: string) => ReactNode | undefined;
  readonly emptyTitle: string;
  readonly emptyBody: string;
}

export function SecurityReportView<Row extends object>({
  report,
  title,
  description,
  listKey,
  columns,
  rows,
  rowKey,
  kpis,
  coverage,
  gaps,
  loading,
  failed,
  onRetry,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filterBarExtra,
  activeFilterCount,
  banner,
  renderCell,
  emptyTitle,
  emptyBody,
}: SecurityReportViewProps<Row>) {
  const { t, locale } = useAppTranslation();

  const stats = useMemo<DocumentListStat[]>(
    () =>
      kpis.map((kpi) => ({
        label: securityCopy(report, "kpi", kpi.key, kpi.labelAr, t),
        value: (
          <span className={kpi.tone === "danger" ? "mz-num text-danger-ink" : kpi.tone === "warning" ? "mz-num text-warning-ink" : "mz-num"}>
            {kpi.value}
          </span>
        ),
      })),
    [kpis, report, t],
  );

  const listColumns = useMemo<DocumentListColumn<Row>[]>(
    () =>
      columns.map((column) => ({
        key: column.key,
        header: securityCopy(report, "col", column.key, column.labelAr, t),
        render: (row: Row) =>
          renderCell?.(row, column.key) ??
          formatCell((row as Record<string, unknown>)[column.key], column.format, locale),
      })),
    [columns, locale, renderCell, report, t],
  );

  return (
    <>
      {failed ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("securityReports.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {coverage?.truncated ? (
        <Card className="mb-[18px] p-[14px_18px]">
          <p className="text-[12.5px] font-semibold text-warning-ink">{t("securityReports.coverageTruncatedTitle")}</p>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">
            {t("securityReports.coverageTruncatedBody")} <span className="mz-num">{coverage.scanned}</span> /{" "}
            <span className="mz-num">{coverage.matched}</span>
          </p>
        </Card>
      ) : null}

      {banner}

      <DocumentList<Row>
        title={title}
        description={description}
        listKey={listKey}
        statsCollapsible
        stats={stats}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        filterBarCollapsible={filterBarExtra !== undefined}
        activeFilterCount={activeFilterCount}
        filterBarExtra={filterBarExtra}
        columns={listColumns}
        rows={[...rows]}
        rowKey={rowKey}
        loading={loading}
        loadFailed={failed}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{rows.length}</span>
          </>
        }
        emptyState={<EmptyState title={emptyTitle} description={emptyBody} />}
      />

      {gaps.length > 0 ? (
        <Card className="mt-[18px] p-[16px_20px]">
          <h3 className="text-[13px] font-semibold text-ink">{t("securityReports.gapsTitle")}</h3>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("securityReports.gapsBody")}</p>
          <dl className="mt-[12px] flex flex-col gap-[10px]">
            {gaps.map((gap) => (
              <div key={gap.key}>
                <dt className="text-[12.5px] font-semibold text-ink">
                  {securityCopy(report, "gap", gap.key, gap.labelAr, t)}
                </dt>
                <dd className="text-[12.5px] text-ink-muted">
                  {securityCopy(report, "gapDetail", gap.key, gap.detailAr, t)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
    </>
  );
}
