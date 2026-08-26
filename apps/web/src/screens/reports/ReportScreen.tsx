import { useState, type ReactNode } from "react";
import { ReportChart, ReportRunner } from "@mezan/ui";
import type { ReportChartSpec, ReportColumn, ReportParamField } from "@mezan/domain";
import { useReport } from "../../data/reports-hooks";
import { localizeReportDefinition, tryReportLabel } from "../../report-labels";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * The generic operational-report screen (docs/catalog/08-reports.md): every
 * one of the 18 reports below is this SAME component, parameterized by a
 * `ReportDefinition`'s metadata (title/params/columns — shared with the
 * server so the two can never drift) and the API path that computes it. This
 * is the "real ReportRunner + data client" the reports engine was built for
 * (packages/ui/src/primitives/ReportRunner.tsx): rows come from `useReport`
 * hitting the live `/reports/*` API over the shared session transport, over
 * the SAME repositories the sales/purchases/inventory/customers/suppliers
 * screens read and write — no report-specific screen code, no sample data.
 */

/** The subset of `ReportDefinition` a screen needs — deliberately NOT the full type (which also carries `run`/`paramsSchema`/`Ctx`, all server-only concerns this component never touches). */
export interface ReportScreenDefinition<TParams, Row> {
  readonly id: string;
  readonly titleAr: string;
  readonly descriptionAr?: string;
  readonly paramFields: readonly ReportParamField[];
  readonly defaultParams: TParams;
  readonly onDemand?: boolean;
  readonly columns: readonly ReportColumn<Row>[];
  readonly rowKey: (row: Row) => string;
  /** The balance sheet turns this off — summing assets against liabilities+equity yields no useful figure. */
  readonly showGrandTotal?: boolean;
  readonly chart?: ReportChartSpec;
}

export interface ReportScreenProps<TParams, Row> {
  readonly definition: ReportScreenDefinition<TParams, Row>;
  readonly apiPath: string;
  /** Optional summary block rendered above the table (e.g. the VAT net-payable line). */
  readonly renderSummary?: (rows: readonly Row[]) => ReactNode;
  /** Overrides the definition's own `onDemand` — lets a caller auto-run a report the definition marks on-demand (e.g. the trial balance on the financial-statements page). */
  readonly onDemand?: boolean;
}

function toStringParams(defaults: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]),
  );
}

export function ReportScreen<TParams extends object, Row>({ definition: rawDefinition, apiPath, renderSummary, onDemand: onDemandOverride }: ReportScreenProps<TParams, Row>) {
  const { t } = useAppTranslation();
  const definition = localizeReportDefinition(rawDefinition, t);
  const onDemand = onDemandOverride ?? definition.onDemand ?? false;
  const [params, setParams] = useState<Record<string, string>>(() => toStringParams(definition.defaultParams));
  // On-demand reports (heavy ledger dumps) don't fetch until the user clicks عرض التقرير.
  const [hasRun, setHasRun] = useState<boolean>(!onDemand);

  const query = useReport<Row>(definition.id, apiPath, params, { enabled: hasRun });

  const fieldErrors = query.error?.fieldErrors;
  const raw = query.data ?? null;

  /**
   * The summary strip (R21.2). Labels are overlaid from the catalogue the same
   * way column headers are — the server carries the Arabic and the client
   * translates by key, so the two can never drift.
   *
   * The headline is composed from the KPIs rather than sent: the server would
   * have to send a formatted string, which could not then be re-localised or
   * exported.
   */
  /**
   * The chart's points are read off the SAME rows the table renders, through
   * the columns the definition names — so the chart cannot drift from the
   * figures beneath it.
   */
  const chartSpec = definition.chart;
  const labelColumn = chartSpec ? definition.columns.find((c) => c.key === chartSpec.labelColumn) : undefined;
  const valueColumn = chartSpec ? definition.columns.find((c) => c.key === chartSpec.valueColumn) : undefined;
  const chartPoints =
    raw && chartSpec && labelColumn && valueColumn
      ? raw.rows.slice(0, chartSpec.maxPoints ?? 8).map((row, index) => ({
          key: `${definition.rowKey(row)}-${index}`,
          label: String(labelColumn.value(row) ?? ""),
          value: Number(valueColumn.value(row) ?? 0),
        }))
      : null;

  const result = raw === null
    ? null
    : {
        ...raw,
        summary:
          raw.kpis && raw.kpis.length > 0
            ? {
                kpis: raw.kpis.map((kpi) => ({
                  key: kpi.key,
                  label: tryReportLabel(`report.${definition.id}.kpi.${kpi.key}`, kpi.labelAr, t),
                  value: kpi.value,
                  format: kpi.format,
                  tone: kpi.tone,
                  hint: kpi.hintAr,
                })),
              }
            : null,
      };

  return (
    <ReportRunner
      title={definition.titleAr}
      description={definition.descriptionAr}
      paramFields={definition.paramFields}
      params={params}
      onParamsChange={setParams}
      fieldErrors={fieldErrors}
      onDemand={onDemand}
      onRun={() => setHasRun(true)}
      loading={query.isFetching}
      result={result}
      columns={definition.columns}
      rowKey={definition.rowKey}
      chart={
        // A report-declared chart wins; `renderSummary` stays for the handful
        // of screens that render something a two-column chart cannot express.
        chartPoints
          ? <ReportChart
              title={definition.titleAr}
              points={chartPoints}
              caption={definition.chart?.captionAr}
            />
          : result && renderSummary
            ? renderSummary(result.rows)
            : undefined
      }
      showGrandTotal={definition.showGrandTotal ?? true}
      exportBaseFilename={definition.id}
    />
  );
}
