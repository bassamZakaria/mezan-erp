import { useMemo, useState, type ReactNode } from "react";
import { ReportChart, ReportRunner, type ReportRunnerEntityRef } from "@mezan/ui";
import type { ReportChartSpec, ReportColumn, ReportParamField } from "@mezan/domain";
import { useReport } from "../../data/reports-hooks";
import { useScopeSelector } from "../../data/hub-hooks";
import { localizeGroupLabel, localizeReportDefinition, tryReportLabel } from "../../report-labels";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { reportChartPoints } from "./chart-points";
import { ReportDrillDownPanel } from "./ReportDrillDownPanel";

/**
 * The generic operational-report screen (docs/archive/catalog/08-reports.md): every
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
  /**
   * Mount the path hangs off. The seven financial statements live under
   * `/financial-reports`, which loads posted AND reversed entries; `/reports`
   * once served its own copy of them from a posted-only slice, so the
   * statements hub and the trial-balance screen disagreed by every reversal.
   */
  readonly apiRoot?: string;
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

export function ReportScreen<TParams extends object, Row>({ definition: rawDefinition, apiPath, apiRoot, renderSummary, onDemand: onDemandOverride }: ReportScreenProps<TParams, Row>) {
  const { t, locale } = useAppTranslation();
  const definition = localizeReportDefinition(rawDefinition, t);
  const onDemand = onDemandOverride ?? definition.onDemand ?? false;
  const [params, setParams] = useState<Record<string, string>>(() => toStringParams(definition.defaultParams));
  // On-demand reports (heavy ledger dumps) don't fetch until the user clicks عرض التقرير.
  const [hasRun, setHasRun] = useState<boolean>(!onDemand);
  const [drillEntity, setDrillEntity] = useState<ReportRunnerEntityRef | null>(null);

  /**
   * الفرع (P-7). The list is the branches this SESSION may see, not every
   * branch: the picker narrows what the server already scopes, and can never
   * widen it — a branchId outside the session's scope returns nothing.
   */
  const { branchOptions } = useScopeSelector();
  const paramFields = useMemo(
    () =>
      branchOptions.length > 1
        ? [
            ...definition.paramFields,
            {
              kind: "select" as const,
              key: "branchId",
              label: t("reports.branchFilter"),
              options: [
                { value: "", label: t("reports.allBranches") },
                ...branchOptions.map((b) => ({ value: b.id, label: b.label })),
              ],
            },
          ]
        : definition.paramFields,
    [branchOptions, definition.paramFields, t],
  );

  const query = useReport<Row>(definition.id, apiPath, params, { enabled: hasRun, apiRoot });

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
   * The chart's points are read off the SAME rows (or the SAME group subtotals)
   * the table renders, through the columns the definition names — so the chart
   * cannot drift from the figures beneath it.
   *
   * Section names are domain enums (account type, cash-flow activity), so they
   * translate before either the table header or the chart reads them — the two
   * must name the same section identically.
   */
  /**
   * Report rows name items, customers and suppliers by their Arabic name, which
   * is what the column definitions read — so the whole reports section printed
   * Arabic names inside the English UI (D57). Each row now also carries the
   * English name its record stores, and this swaps the pair over in one place
   * rather than in twenty column definitions the server owns.
   *
   * A record with no English name keeps the Arabic one: a blank cell is worse
   * than the wrong language, because the row stops being findable.
   */
  const withReadableNames = <T,>(rows: readonly T[]): T[] =>
    rows.map((row) => {
      const r = row as Record<string, unknown>;
      let next: Record<string, unknown> | null = null;
      for (const key of Object.keys(r)) {
        if (!key.endsWith("NameEn")) continue;
        const arKey = `${key.slice(0, -2)}Ar`;
        if (!(arKey in r)) continue;
        const en = r[key];
        if (typeof en !== "string" || en.trim() === "") continue;
        next ??= { ...r };
        next[arKey] = en;
      }
      return (next ?? r) as T;
    });

  const localized = raw === null
    ? null
    : {
        ...raw,
        rows: locale === "en" ? withReadableNames(raw.rows) : raw.rows,
        // The TABLE renders `groups[].rows`, not `rows` — swapping only the top
        // level left the chart in English and the table beneath it in Arabic.
        groups: raw.groups.map((group) => ({
          ...group,
          label: localizeGroupLabel(group.label, t),
          rows: locale === "en" ? withReadableNames(group.rows) : group.rows,
        })),
      };

  const chartPoints = reportChartPoints(definition.chart, definition.columns, definition.rowKey, localized);

  const result = localized === null
    ? null
    : {
        ...localized,
        // The banner's copy arrives from the server in Arabic like every other
        // report label; without this overlay the English trial balance stated
        // its own headline claim in Arabic.
        reconciliation: localized.reconciliation
          ? {
              ...localized.reconciliation,
              labelAr: tryReportLabel(`report.${definition.id}.recon`, localized.reconciliation.labelAr, t),
            }
          : null,
        summary:
          localized.kpis && localized.kpis.length > 0
            ? {
                kpis: localized.kpis.map((kpi) => ({
                  key: kpi.key,
                  label: tryReportLabel(`report.${definition.id}.kpi.${kpi.key}`, kpi.labelAr, t),
                  value: kpi.value,
                  format: kpi.format,
                  tone: kpi.tone,
                  hint: kpi.hintAr
                    ? tryReportLabel(`report.${definition.id}.kpiHint.${kpi.key}`, kpi.hintAr, t)
                    : undefined,
                })),
              }
            : null,
      };

  return (
    <ReportRunner
      title={definition.titleAr}
      description={definition.descriptionAr}
      paramFields={paramFields}
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
              caption={definition.chart?.captionAr ? tryReportLabel(`report.${definition.id}.chartCaption`, definition.chart.captionAr, t) : undefined}
            />
          : result && renderSummary
            ? renderSummary(result.rows)
            : undefined
      }
      showGrandTotal={definition.showGrandTotal ?? true}
      exportBaseFilename={definition.id}
      onEntityClick={setDrillEntity}
      footer={<ReportDrillDownPanel entity={drillEntity} onClose={() => setDrillEntity(null)} />}
    />
  );
}
