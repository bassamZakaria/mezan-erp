import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFormat, type UseFormatOptions } from "../hooks/useFormat";
import { buildReportExport, downloadReportExport, type ReportExportFormat } from "../lib/report-export";
import { Button, Card, Money } from "./atoms";
import { VarianceBeam } from "./beams";
import { Select } from "./Select";
import { TextInput } from "./form";
import { FulcrumRule } from "../shell/FulcrumRule";
import { useUiTranslation } from "../i18n";

/**
 * `<ReportRunner>` — the generic report UI shell (docs/plan.md §2.4): renders
 * a param bar from a declarative field list, runs the report (or gates on an
 * explicit "عرض التقرير" click for on-demand reports), and shows the table +
 * totals + optional chart + an always-available Export button.
 *
 * Deliberately domain-agnostic: it knows nothing about `@mezan/domain`'s
 * `ReportDefinition`. The shapes below are structurally identical to it, so
 * callers (apps/web) pass a `ReportDefinition` straight through — the engine
 * (validation, the query plan, grouping/totals, reconciliation) already ran
 * upstream and handed this component render-ready `result`.
 */

export type ReportRunnerColumnFormat = "text" | "money" | "qty" | "date" | "percent" | "variance";

export interface ReportRunnerColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly format?: ReportRunnerColumnFormat;
  readonly align?: "start" | "end";
  readonly value: (row: Row) => string | number | null;
  readonly total?: boolean;
}

export type ReportRunnerParamField =
  | { readonly kind: "date"; readonly key: string; readonly label: string }
  | { readonly kind: "dateRange"; readonly fromKey: string; readonly toKey: string; readonly label: string }
  | { readonly kind: "select"; readonly key: string; readonly label: string; readonly options: readonly { value: string; label: string }[] }
  | { readonly kind: "text"; readonly key: string; readonly label: string; readonly placeholder?: string };

export interface ReportRunnerGroup<Row> {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly Row[];
  readonly totals: Readonly<Record<string, number>>;
}

export interface ReportRunnerReconciliation {
  readonly labelAr: string;
  readonly reportTotal: number;
  readonly referenceTotal: number;
  readonly diff: number;
  readonly withinTolerance: boolean;
}

/**
 * One figure in a report's summary strip (R21.2). `format` decides how it
 * renders, so a report never hands over a pre-formatted string it will then be
 * unable to export or re-localise.
 */
export interface ReportRunnerKpi {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly format?: ReportRunnerColumnFormat;
  readonly tone?: "default" | "success" | "danger";
  /** Shown under the figure — what it means, not what it is called. */
  readonly hint?: string;
}

/**
 * The collapsible summary strip (R21.2): one line that stays visible when
 * collapsed, expanding into the KPI cards. The one-liner is the point — a
 * report you have to expand to learn anything from has buried its answer.
 */
export interface ReportRunnerSummary {
  readonly headline: string;
  readonly kpis: readonly ReportRunnerKpi[];
}

export interface ReportRunnerResult<Row> {
  readonly rows: readonly Row[];
  readonly groups: readonly ReportRunnerGroup<Row>[];
  readonly grandTotals: Readonly<Record<string, number>>;
  readonly reconciliation: ReportRunnerReconciliation | null;
  /** Computed server-side over the whole result, not the visible page. */
  readonly summary?: ReportRunnerSummary | null;
  /**
   * States that the two sides agree, as a banner above the table (R21.10).
   * The trial balance's whole claim is that it balances; making the reader
   * add two columns to find out is the report failing at its one job.
   */
  readonly balanceCheck?: { readonly label: string; readonly balanced: boolean } | null;
}

export interface ReportRunnerProps<Row> {
  title: string;
  description?: string;
  paramFields: readonly ReportRunnerParamField[];
  /** Raw (untyped) param form state — keyed by each field's `key`/`fromKey`/`toKey`. */
  params: Record<string, string>;
  onParamsChange: (params: Record<string, string>) => void;
  /** Field-scoped validation messages, keyed the same way as `params`. */
  fieldErrors?: Record<string, string>;
  /** Heavy reports require an explicit "عرض التقرير" click (docs/catalog/08-reports.md). */
  onDemand?: boolean;
  /** Present whenever a run can be triggered — required when `onDemand`, optional otherwise (e.g. a manual refresh). */
  onRun?: () => void;
  loading?: boolean;
  /** `null` before the first run of an on-demand report. */
  result: ReportRunnerResult<Row> | null;
  columns: readonly ReportRunnerColumn<Row>[];
  rowKey: (row: Row) => string;
  chart?: ReactNode;
  /**
   * How to read the chart (R21.3) — "start at the total, subtract the discount
   * in red…". A chart nobody can read is decoration.
   */
  chartCaption?: string;
  /**
   * The basis behind the figures, where it is not obvious (R21.9): which
   * entries are included, in what currency, and what is deliberately left out.
   */
  methodology?: string;
  formatOptions?: UseFormatOptions;
  exportBaseFilename?: string;
  /**
   * Whether to render the grand-total row. Per-group subtotals stay on
   * regardless — the balance sheet turns this off because summing its asset
   * section against its liabilities+equity section yields no useful figure.
   * Defaults to true.
   */
  showGrandTotal?: boolean;
  className?: string;
}

function formatCell(value: string | number | null, format: ReportRunnerColumnFormat | undefined, fmt: ReturnType<typeof useFormat>): ReactNode {
  if (value === null) return "—";
  if (format === "money" && typeof value === "number") return <Money value={value} currencyLabel={fmt.currencyLabel} />;
  if (format === "qty" && typeof value === "number") return <span className="mz-num">{fmt.number(value)}</span>;
  if (format === "percent" && typeof value === "number") return <span className="mz-num">{fmt.number(value)}%</span>;
  if (format === "variance" && typeof value === "number")
    return (
      <VarianceBeam value={value}>
        <span className="mz-num">{value > 0 ? `+${fmt.money(value)}` : fmt.money(value)}</span>
      </VarianceBeam>
    );
  if (format === "date" && typeof value === "string") return <span className="mz-num">{fmt.date(value)}</span>;
  return String(value);
}

function ParamField({
  field,
  params,
  onParamsChange,
  fieldErrors,
}: {
  field: ReportRunnerParamField;
  params: Record<string, string>;
  onParamsChange: (params: Record<string, string>) => void;
  fieldErrors?: Record<string, string>;
}) {
  const { t } = useUiTranslation();

  function set(key: string, value: string) {
    onParamsChange({ ...params, [key]: value });
  }

  const errorKey = field.kind === "dateRange" ? field.fromKey : field.key;
  const error = fieldErrors?.[errorKey];

  return (
    <div className="flex flex-col gap-[5px]">
      <span className="text-[11.5px] font-semibold text-ink-muted">{field.label}</span>
      {field.kind === "date" ? (
        <TextInput type="date" size="sm" aria-label={field.label} value={params[field.key] ?? ""} onChange={(e) => set(field.key, e.target.value)} />
      ) : field.kind === "dateRange" ? (
        <span className="flex items-center gap-[8px]">
          <TextInput
            type="date"
            size="sm"
            aria-label={t("ui.report.rangeFrom", { label: field.label })}
            value={params[field.fromKey] ?? ""}
            onChange={(e) => set(field.fromKey, e.target.value)}
          />
          <span className="text-xs text-ink-faint">{t("ui.dateRange.separator")}</span>
          <TextInput
            type="date"
            size="sm"
            aria-label={t("ui.report.rangeTo", { label: field.label })}
            value={params[field.toKey] ?? ""}
            onChange={(e) => set(field.toKey, e.target.value)}
          />
        </span>
      ) : field.kind === "select" ? (
        <Select
          size="sm"
          aria-label={field.label}
          value={params[field.key] ?? ""}
          onChange={(next) => set(field.key, next)}
          options={field.options.map((opt) => ({ value: opt.value, label: opt.label }))}
        />
      ) : (
        <TextInput
          size="sm"
          aria-label={field.label}
          value={params[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => set(field.key, e.target.value)}
        />
      )}
      {error ? <span className="text-[11px] text-danger-ink">{error}</span> : null}
    </div>
  );
}

export function ReportRunner<Row>({
  title,
  description,
  paramFields,
  params,
  onParamsChange,
  fieldErrors,
  onDemand = false,
  onRun,
  loading = false,
  result,
  columns,
  rowKey,
  chart,
  chartCaption,
  methodology,
  formatOptions,
  exportBaseFilename,
  showGrandTotal = true,
  className,
}: ReportRunnerProps<Row>) {
  const { t } = useUiTranslation();
  const fmt = useFormat(formatOptions);
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  // Expanded by default: the KPIs are the answer, and hiding them behind a
  // click would make the strip a decoration rather than the summary.
  const [summaryOpen, setSummaryOpen] = useState(true);
  const totalColumns = new Set(columns.filter((c) => c.total).map((c) => c.key));
  const hasResult = result !== null;

  async function handleExport(format: ReportExportFormat) {
    if (!result) return;
    setExporting(format);
    try {
      const file = await buildReportExport(columns, result.rows, {
        format,
        baseFilename: exportBaseFilename ?? "report",
        sheetName: title.slice(0, 31),
      });
      downloadReportExport(file);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{title}</h1>
          {description ? <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={() => handleExport("csv")} disabled={!hasResult || result.rows.length === 0 || exporting !== null}>
            {exporting === "csv" ? t("ui.report.exporting") : t("ui.report.exportCsv")}
          </Button>
          <Button variant="primary" onClick={() => handleExport("xlsx")} disabled={!hasResult || result.rows.length === 0 || exporting !== null}>
            {exporting === "xlsx" ? t("ui.report.exporting") : t("ui.report.exportExcel")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      {/*
        A server-side 400 names no single param, so it arrives under `_root`.
        Without this it was looked up as a field key, matched nothing, and the
        rejection was swallowed — the screen just sat on its empty placeholder.
      */}
      {fieldErrors?._root ? (
        <Card role="alert" className="mb-[16px] border-danger p-[12px_16px] text-[12.5px] text-danger-ink">
          {fieldErrors._root}
        </Card>
      ) : null}

      {paramFields.length > 0 ? (
        <Card className="mb-[16px] flex flex-wrap items-end gap-[16px] p-[14px_16px]">
          {paramFields.map((field) => (
            <ParamField key={field.kind === "dateRange" ? field.fromKey : field.key} field={field} params={params} onParamsChange={onParamsChange} fieldErrors={fieldErrors} />
          ))}
          {onDemand ? (
            <Button variant="primary" onClick={onRun} disabled={loading}>
              {loading ? t("ui.report.loading") : t("ui.report.run")}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {onDemand && !hasResult ? (
        <Card className="p-[28px] text-center text-[13px] text-ink-muted">{t("ui.report.prompt")}</Card>
      ) : !hasResult ? (
        <Card className="p-[28px] text-center text-[13px] text-ink-muted">{loading ? t("ui.report.loading") : t("ui.report.empty")}</Card>
      ) : (
        <>
          {result.reconciliation ? (
            <Card
              className={cn(
                "mb-[16px] flex flex-wrap items-center justify-between gap-[10px] p-[13px_16px] text-[12.5px]",
                result.reconciliation.withinTolerance ? "border-success" : "border-danger",
              )}
            >
              <span className="font-semibold text-ink">{result.reconciliation.labelAr}</span>
              <span className="mz-num flex items-center gap-[10px]">
                <span>{fmt.money(result.reconciliation.reportTotal)}</span>
                <span aria-hidden>{result.reconciliation.withinTolerance ? "=" : "≠"}</span>
                <span>{fmt.money(result.reconciliation.referenceTotal)}</span>
                {!result.reconciliation.withinTolerance ? (
                  <span className="font-semibold text-danger-ink">{t("ui.report.difference", { amount: fmt.money(Math.abs(result.reconciliation.diff)) })}</span>
                ) : null}
              </span>
            </Card>
          ) : null}

          {result.balanceCheck ? (
            <Card
              role="status"
              className={cn(
                "mb-[16px] flex items-center gap-[10px] p-[13px_16px] text-[12.5px] font-semibold",
                result.balanceCheck.balanced ? "border-success text-success-ink" : "border-danger text-danger-ink",
              )}
            >
              <span aria-hidden>{result.balanceCheck.balanced ? "✓" : "✕"}</span>
              <span>{result.balanceCheck.label}</span>
            </Card>
          ) : null}

          {result.summary ? (
            <Card className="mb-[16px] overflow-hidden">
              <button
                type="button"
                onClick={() => setSummaryOpen((open) => !open)}
                aria-expanded={summaryOpen}
                className="flex w-full items-center justify-between gap-[10px] px-[16px] py-[11px] text-start text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                <span>{result.summary.headline}</span>
                <span className="text-[11px] font-normal text-ink-muted">
                  {summaryOpen ? t("ui.report.summaryCollapse") : t("ui.report.summaryExpand")}
                </span>
              </button>
              {summaryOpen ? (
                <div className="grid gap-[1px] border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                  {result.summary.kpis.map((kpi) => (
                    <div key={kpi.key} className="flex flex-col gap-[3px] bg-surface p-[13px_16px]">
                      <span className="text-[11.5px] text-ink-muted">{kpi.label}</span>
                      <span
                        className={cn(
                          "text-[16px] font-bold",
                          kpi.tone === "success" ? "text-success-ink" : kpi.tone === "danger" ? "text-danger-ink" : "text-ink",
                        )}
                      >
                        {formatCell(kpi.value, kpi.format ?? "money", fmt)}
                      </span>
                      {kpi.hint ? <span className="text-[11px] text-ink-faint">{kpi.hint}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {chart ? (
            <div className="mb-[16px]">
              {chart}
              {chartCaption ? <p className="mt-[6px] text-[11.5px] text-ink-muted">{chartCaption}</p> : null}
            </div>
          ) : null}

          <Card className="overflow-hidden rounded-md">
            <div className="max-h-[min(68vh,760px)] overflow-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={cn(
                          "sticky top-0 z-20 whitespace-nowrap border-b border-border bg-surface-2 px-[14px] py-[9px] text-[11.5px] font-bold uppercase tracking-[0.3px] text-ink-muted",
                          col.align === "end" ? "text-end" : "text-start",
                        )}
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.groups.map((group) => (
                    <SectionRows key={group.key} group={group} columns={columns} rowKey={rowKey} totalColumns={totalColumns} fmt={fmt} showHeader={result.groups.length > 1 || group.label !== ""} />
                  ))}
                  {showGrandTotal && totalColumns.size > 0 ? (
                    <tr className="font-bold">
                      {columns.map((col, i) => (
                        <td
                          key={col.key}
                          className={cn(
                            "border-t-2 border-border-strong bg-surface-2 px-[14px] py-[9px]",
                            col.align === "end" ? "text-end tabular-nums" : "text-start",
                          )}
                        >
                          {i === 0 ? t("ui.report.grandTotal") : totalColumns.has(col.key) ? formatCell(result.grandTotals[col.key] ?? 0, col.format, fmt) : ""}
                        </td>
                      ))}
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {result.rows.length === 0 ? <div className="p-[16px] text-center text-[12.5px] text-ink-muted">{t("ui.report.noRows")}</div> : null}
            </div>
          </Card>

          {methodology ? (
            <p className="mt-[10px] max-w-[80ch] text-[11.5px] text-ink-faint">
              <span className="font-semibold">{t("ui.report.methodology")}:</span> {methodology}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function SectionRows<Row>({
  group,
  columns,
  rowKey,
  totalColumns,
  fmt,
  showHeader,
}: {
  group: ReportRunnerGroup<Row>;
  columns: readonly ReportRunnerColumn<Row>[];
  rowKey: (row: Row) => string;
  totalColumns: Set<string>;
  fmt: ReturnType<typeof useFormat>;
  showHeader: boolean;
}) {
  const { t } = useUiTranslation();
  return (
    <>
      {showHeader ? (
        <tr>
          <td colSpan={columns.length} className="bg-surface-3 px-[14px] py-[7px] font-display text-[12.5px] font-bold text-ink">
            {group.label}
          </td>
        </tr>
      ) : null}
      {group.rows.map((row) => (
        <tr key={rowKey(row)} className="h-[36px] transition-colors even:bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] hover:bg-surface-2">
          {columns.map((col) => (
            <td
              key={col.key}
              className={cn(
                "px-[14px] py-[6px] align-middle",
                col.align === "end" ? "text-end font-mono tabular-nums" : "text-start",
              )}
            >
              {formatCell(col.value(row), col.format, fmt)}
            </td>
          ))}
        </tr>
      ))}
      {showHeader && totalColumns.size > 0 ? (
        <tr className="font-semibold">
          {columns.map((col, i) => (
            <td
              key={col.key}
              className={cn(
                "border-y border-border bg-[color-mix(in_srgb,var(--surface-2)_80%,transparent)] px-[14px] py-[7px]",
                col.align === "end" ? "text-end font-mono tabular-nums" : "text-start",
              )}
            >
              {i === 0 ? t("ui.report.groupTotal", { label: group.label }) : totalColumns.has(col.key) ? formatCell(group.totals[col.key] ?? 0, col.format, fmt) : ""}
            </td>
          ))}
        </tr>
      ) : null}
    </>
  );
}
