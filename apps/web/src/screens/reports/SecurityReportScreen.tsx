import { useState, type ReactNode } from "react";
import { ReportRunner, type ReportRunnerColumn, type ReportRunnerParamField } from "@mezan/ui";
import type { ReportCoverageDTO, ReportGapDTO } from "@mezan/contracts";
import { useReport } from "../../data/reports-hooks";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { tryReportLabel } from "../../report-labels";

/** One of the four exception reports this shell renders, keyed the way `securityReports.<report>.*` i18n keys are. */
export type SecurityReportKey = "exceptions" | "postPosting" | "afterHours" | "newAccounts" | "sod";

/**
 * Overlays the server's raw `labelAr` (KPI, gap, gap-detail and column labels
 * all arrive this way) with the catalogue's English pair, keyed by
 * `securityReports.<report>.<kind>.<key>`. A key the catalogue lacks falls back
 * to the server's Arabic rather than leaking a raw i18n key.
 */
export function securityCopy(
  report: SecurityReportKey,
  kind: "col" | "kpi" | "gap" | "gapDetail",
  key: string,
  fallbackAr: string,
  t: (key: AppTranslationKey) => string,
): string {
  return tryReportLabel(`securityReports.${report}.${kind}.${key}`, fallbackAr, t);
}

/**
 * تقارير الرقابة — the shell the four exception reports render through (P-4).
 *
 * They were built, mounted and unreachable: 1,159 lines of
 * `security-reports-routes.ts` with no screen and no smoke entry. This is the
 * operational `ReportScreen`'s twin for `/security-reports`, and it exists
 * separately for one reason — an exception report must carry the two things an
 * operational report has no need of:
 *
 *   `coverage`  how much of the trail the server actually read. When it is
 *               truncated the totals below are a FLOOR, not a total, and
 *               saying so is the difference between a finding and an
 *               accusation.
 *   `gaps`      the questions this build's records cannot answer. A column
 *               that silently disappears reads as "nothing to report", which
 *               in an exception report exonerates.
 */

export interface SecurityReportResult<Row> {
  readonly rows: readonly Row[];
  readonly groups: readonly { readonly key: string; readonly labelAr: string; readonly rows: readonly Row[]; readonly totals: Record<string, number> }[];
  readonly grandTotals: Record<string, number>;
  readonly kpis?: readonly { readonly key: string; readonly labelAr: string; readonly value: number; readonly tone?: string }[];
  readonly coverage?: ReportCoverageDTO;
  readonly gaps?: readonly ReportGapDTO[];
}

export interface SecurityReportScreenProps<Row> {
  readonly report: SecurityReportKey;
  readonly reportId: string;
  readonly apiPath: string;
  readonly title: string;
  readonly description?: string;
  readonly paramFields: readonly ReportRunnerParamField[];
  readonly defaultParams: Record<string, string>;
  readonly columns: readonly ReportRunnerColumn<Row>[];
  readonly rowKey: (row: Row) => string;
  /** Rendered above the table — the watch list, the working-day banner. */
  readonly renderContext?: (result: SecurityReportResult<Row>) => ReactNode;
}

export function SecurityReportScreen<Row>({
  report,
  reportId,
  apiPath,
  title,
  description,
  paramFields,
  defaultParams,
  columns,
  rowKey,
  renderContext,
}: SecurityReportScreenProps<Row>) {
  const { t } = useAppTranslation();
  const [params, setParams] = useState<Record<string, string>>(defaultParams);
  const query = useReport<Row>(reportId, apiPath, params, { apiRoot: "/security-reports" });

  const raw = (query.data ?? null) as SecurityReportResult<Row> | null;
  const result = raw
    ? {
        rows: raw.rows,
        groups: raw.groups.map((g) => ({ key: g.key, label: g.labelAr, rows: g.rows, totals: g.totals })),
        grandTotals: raw.grandTotals,
        reconciliation: null,
        summary:
          raw.kpis && raw.kpis.length > 0
            ? {
                kpis: raw.kpis.map((k) => ({
                  key: k.key,
                  label: securityCopy(report, "kpi", k.key, k.labelAr, t),
                  value: k.value,
                  format: "qty" as const,
                  tone: k.tone === "danger" ? ("danger" as const) : ("default" as const),
                })),
              }
            : null,
      }
    : null;

  const coverage = raw?.coverage;
  const gaps = raw?.gaps ?? [];

  return (
    <ReportRunner
      title={title}
      description={description}
      paramFields={paramFields}
      params={params}
      onParamsChange={setParams}
      fieldErrors={query.error?.fieldErrors}
      onRun={() => query.refetch()}
      loading={query.isFetching}
      result={result}
      columns={columns}
      rowKey={rowKey}
      exportBaseFilename={reportId}
      chart={
        <div className="grid gap-[10px]">
          {coverage?.truncated ? (
            <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
              {t("securityReports.truncated", {
                scanned: String(coverage.scanned),
                matched: String(coverage.matched),
                limit: String(coverage.scanLimit),
              })}
            </div>
          ) : null}
          {raw && renderContext ? renderContext(raw) : null}
          {gaps.length > 0 ? (
            <div className="rounded-md border border-border bg-surface px-[12px] py-[10px] text-[12.5px]">
              <div className="mb-[6px] font-semibold text-ink">{t("securityReports.gapsTitle")}</div>
              <ul className="grid gap-[4px] text-ink-muted">
                {gaps.map((gap) => (
                  <li key={gap.key}>
                    <span className="font-semibold text-ink">{securityCopy(report, "gap", gap.key, gap.labelAr, t)}</span>
                    {" — "}
                    {securityCopy(report, "gapDetail", gap.key, gap.detailAr, t)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
