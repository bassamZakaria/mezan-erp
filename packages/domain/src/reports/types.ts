import type { z } from "zod";

/**
 * ReportDefinition — the Tier 2 shared "report engine" abstraction
 * (docs/plan.md §2.4: "Build a `ReportDefinition` abstraction (params schema
 * → query plan → column/format spec) so reports are declarations rather than
 * 33 bespoke screens"). Every one of the 33 reports in docs/catalog/08-reports.md
 * is, structurally, a parameter bar + an aggregate query/plan + a table (with
 * optional grouping/totals/charts) + export. This module models exactly that
 * shape; concrete reports (e.g. `./trial-balance.ts`) are just data.
 */

/** How a column's raw value is rendered — routed through `useFormat()` on the UI side. */
/**
 * `share` is a percentage rendered as an inline bar beside its number (R21.6).
 * A contribution column is read by comparing rows, and a column of bare
 * numbers makes the reader do that comparison in their head.
 */
export type ReportColumnFormat = "text" | "money" | "qty" | "date" | "percent" | "variance" | "share";

export interface ReportColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly format?: ReportColumnFormat;
  readonly align?: "start" | "end";
  /** Extracts the raw cell value from a row. `number` for money/qty/percent columns. */
  readonly value: (row: Row) => string | number | null;
  /** Included in the per-group subtotal + grand-total rows (numeric columns only). */
  readonly total?: boolean;
  /**
   * Overrides the plain column sum for the GRAND total when adding the rows up
   * is meaningless. The VAT return is the case in point: its groups carry
   * opposite signs, so summing the tax column across output and input rows
   * produces a figure with no accounting meaning — and the dashboard read it as
   * "VAT due" and showed 24,983 payable where the return itself showed
   * 12,072.20 refundable. Per-GROUP subtotals still use the plain sum.
   */
  readonly grandTotal?: (rows: readonly Row[]) => number;
}

/** Groups a report's rows into labeled sections (e.g. trial balance by account type). */
export interface ReportGroupSpec<Row> {
  readonly key: (row: Row) => string;
  readonly label: (row: Row) => string;
}

/** Declarative parameter-bar field — the UI renders this generically, no per-report form code. */
export type ReportParamField =
  | { readonly kind: "date"; readonly key: string; readonly label: string }
  | { readonly kind: "dateRange"; readonly fromKey: string; readonly toKey: string; readonly label: string }
  | { readonly kind: "select"; readonly key: string; readonly label: string; readonly options: readonly { value: string; label: string }[] }
  | { readonly kind: "text"; readonly key: string; readonly label: string; readonly placeholder?: string };

/**
 * A GL-reconciliation banner (docs/catalog/08-reports.md: five reports
 * cross-check their own total against a reference — most simply the general
 * ledger itself, e.g. ميزان المراجعة's "إجمالي المدين = إجمالي الدائن").
 */
export interface ReportReconciliationSpec<Row, Ctx, TParams = unknown> {
  readonly labelAr: string;
  readonly computeReportTotal: (rows: readonly Row[]) => number;
  /**
   * `params` are the ones the report actually RAN with, not its defaults —
   * a reference total computed over the default period would silently stop
   * matching the moment the user changed the date range.
   */
  readonly computeReferenceTotal: (rows: readonly Row[], ctx: Ctx, params: TParams) => number;
  /** Absolute-difference tolerance before the banner flags a mismatch. Defaults to 0. */
  readonly toleranceMoney?: number;
}

export interface ReportDefinition<TParams, Row, Ctx = unknown> {
  readonly id: string;
  readonly titleAr: string;
  readonly descriptionAr?: string;
  readonly paramsSchema: z.ZodType<TParams, z.ZodTypeDef, unknown>;
  readonly defaultParams: TParams;
  readonly paramFields: readonly ReportParamField[];
  /**
   * Heavy ledger reports require an explicit "عرض التقرير" click rather than
   * auto-running on every filter change (docs/catalog/08-reports.md: دفتر
   * الأستاذ العام / دفتر حساب). Defaults to false (auto-run).
   */
  readonly onDemand?: boolean;
  /** The aggregate query/plan. Pure — no I/O; `ctx` supplies whatever data source the report needs. */
  readonly run: (params: TParams, ctx: Ctx) => Row[];
  readonly columns: readonly ReportColumn<Row>[];
  readonly rowKey: (row: Row) => string;
  readonly group?: ReportGroupSpec<Row>;
  readonly reconciliation?: ReportReconciliationSpec<Row, Ctx, TParams>;
  /**
   * Whether the grand-total row is meaningful for this report. The balance
   * sheet sets this false — summing the assets section against the
   * liabilities+equity section yields no useful figure (the A = L + E check
   * lives in `reconciliation` instead), while per-section subtotals stay on.
   * Defaults to true.
   */
  readonly showGrandTotal?: boolean;
  /**
   * The summary strip's figures (R21.2). Omit it and the report still gets a
   * strip: `defaultReportKpis` derives one from the row count and whichever
   * columns are already marked `total`, so every report answers "how much, and
   * over how many rows" without each being taught to. Supply it to say
   * something the column totals cannot.
   */
  readonly kpis?: readonly ReportKpiSpec<Row, TParams>[];
}

/**
 * One figure in a report's summary strip (R21.2).
 *
 * `value` is a number and `format` says how to render it — a report that
 * handed over a pre-formatted string could neither be exported nor
 * re-localised. Labels stay Arabic here and are overlaid on the client the
 * same way column headers are, keyed `report.<id>.kpi.<key>`.
 */
export interface ReportKpiSpec<Row, TParams> {
  readonly key: string;
  readonly labelAr: string;
  readonly hintAr?: string;
  readonly format?: ReportColumnFormat;
  readonly value: (rows: readonly Row[], params: TParams) => number;
  readonly tone?: (value: number) => "default" | "success" | "danger";
}

export interface ReportKpiResult {
  readonly key: string;
  readonly labelAr: string;
  readonly hintAr?: string;
  readonly format?: ReportColumnFormat;
  readonly value: number;
  readonly tone?: "default" | "success" | "danger";
}

export interface ReportValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ReportGroupResult<Row> {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly Row[];
  readonly totals: Readonly<Record<string, number>>;
}

export interface ReportReconciliationResult {
  readonly labelAr: string;
  readonly reportTotal: number;
  readonly referenceTotal: number;
  readonly diff: number;
  readonly withinTolerance: boolean;
}

export type RunReportOutcome<TParams, Row> =
  | {
      readonly ok: true;
      readonly params: TParams;
      readonly rows: readonly Row[];
      readonly groups: readonly ReportGroupResult<Row>[];
      readonly grandTotals: Readonly<Record<string, number>>;
      readonly reconciliation: ReportReconciliationResult | null;
      readonly kpis: readonly ReportKpiResult[];
    }
  | { readonly ok: false; readonly errors: readonly ReportValidationError[] };
