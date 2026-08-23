import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFormat, type UseFormatOptions } from "../hooks/useFormat";
import { buildReportExport, downloadReportExport, type ReportExportFormat } from "../lib/report-export";
import { Button, Card, Money } from "./atoms";
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

export type ReportRunnerColumnFormat = "text" | "money" | "qty" | "date" | "percent";

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

export interface ReportRunnerResult<Row> {
  readonly rows: readonly Row[];
  readonly groups: readonly ReportRunnerGroup<Row>[];
  readonly grandTotals: Readonly<Record<string, number>>;
  readonly reconciliation: ReportRunnerReconciliation | null;
}

export interface ReportRunnerProps<Row> {
  eyebrow?: string;
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
  const inputClass =
    "rounded-md border border-border bg-surface px-[11px] py-[8px] text-[12.5px] text-ink outline-none focus:border-brand";

  function set(key: string, value: string) {
    onParamsChange({ ...params, [key]: value });
  }

  const errorKey = field.kind === "dateRange" ? field.fromKey : field.key;
  const error = fieldErrors?.[errorKey];

  return (
    <label className="flex flex-col gap-[5px]">
      <span className="text-[11.5px] font-semibold text-ink-muted">{field.label}</span>
      {field.kind === "date" ? (
        <input type="date" aria-label={field.label} value={params[field.key] ?? ""} onChange={(e) => set(field.key, e.target.value)} className={inputClass} />
      ) : field.kind === "dateRange" ? (
        <span className="flex items-center gap-[8px]">
          <input
            type="date"
            aria-label={t("ui.report.rangeFrom", { label: field.label })}
            value={params[field.fromKey] ?? ""}
            onChange={(e) => set(field.fromKey, e.target.value)}
            className={inputClass}
          />
          <span className="text-xs text-ink-faint">{t("ui.dateRange.separator")}</span>
          <input
            type="date"
            aria-label={t("ui.report.rangeTo", { label: field.label })}
            value={params[field.toKey] ?? ""}
            onChange={(e) => set(field.toKey, e.target.value)}
            className={inputClass}
          />
        </span>
      ) : field.kind === "select" ? (
        <select aria-label={field.label} value={params[field.key] ?? ""} onChange={(e) => set(field.key, e.target.value)} className={inputClass}>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          aria-label={field.label}
          value={params[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => set(field.key, e.target.value)}
          className={inputClass}
        />
      )}
      {error ? <span className="text-[11px] text-danger-ink">{error}</span> : null}
    </label>
  );
}

export function ReportRunner<Row>({
  eyebrow,
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
  formatOptions,
  exportBaseFilename,
  showGrandTotal = true,
  className,
}: ReportRunnerProps<Row>) {
  const { t } = useUiTranslation();
  const fmt = useFormat(formatOptions);
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
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
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          {eyebrow ? <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">{eyebrow}</div> : null}
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

          {chart ? <div className="mb-[16px]">{chart}</div> : null}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={cn(
                          "whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted",
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
                    <tr className="border-t-2 border-border-strong bg-surface-2 font-bold">
                      {columns.map((col, i) => (
                        <td key={col.key} className={cn("px-[15px] py-[12px]", col.align === "end" ? "text-end" : "text-start")}>
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
        <tr className="bg-surface-3">
          <td colSpan={columns.length} className="px-[15px] py-[8px] text-[11.5px] font-bold text-ink">
            {group.label}
          </td>
        </tr>
      ) : null}
      {group.rows.map((row) => (
        <tr key={rowKey(row)} className="border-b border-border last:border-b-0">
          {columns.map((col) => (
            <td key={col.key} className={cn("px-[15px] py-[12px] align-middle", col.align === "end" ? "text-end" : "text-start")}>
              {formatCell(col.value(row), col.format, fmt)}
            </td>
          ))}
        </tr>
      ))}
      {showHeader && totalColumns.size > 0 ? (
        <tr className="border-b border-border bg-surface-2/60 font-semibold">
          {columns.map((col, i) => (
            <td key={col.key} className={cn("px-[15px] py-[9px]", col.align === "end" ? "text-end" : "text-start")}>
              {i === 0 ? t("ui.report.groupTotal", { label: group.label }) : totalColumns.has(col.key) ? formatCell(group.totals[col.key] ?? 0, col.format, fmt) : ""}
            </td>
          ))}
        </tr>
      ) : null}
    </>
  );
}
