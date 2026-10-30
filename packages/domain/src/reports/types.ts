import type { z } from "zod";
import type { Money } from "../money/index.js";

/**
 * ReportDefinition — the Tier 2 shared "report engine" abstraction
 * (docs/archive/plan.md §2.4: "Build a `ReportDefinition` abstraction (params schema
 * → query plan → column/format spec) so reports are declarations rather than
 * 33 bespoke screens"). Every one of the 33 reports in docs/archive/catalog/08-reports.md
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
/**
 * A figure a report emits: a number, or — for money a report computes exactly —
 * an exact decimal string (D126, D345). A column whose values are strings is
 * totalled exactly and its totals are strings too.
 */
export type ReportFigure = number | string;

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
  /**
   * Marks this cell as naming a domain entity, so the runner can open the
   * drill-down panel on it (A5). `id` must return that entity's REAL id — the
   * panel goes back to the posted documents with it, and a label is not an id.
   */
  readonly entity?: ReportEntityRef<Row>;
  readonly cost?: boolean;
}

export type ReportEntityKind = "customer" | "supplier" | "item" | "account" | "rep" | "funnel-stage" | "pipeline-stage";

export interface ReportEntityRef<Row> {
  readonly kind: ReportEntityKind;
  readonly id: (row: Row) => string | null;
}

/** Groups a report's rows into labeled sections (e.g. trial balance by account type). */
export interface ReportGroupSpec<Row> {
  readonly key: (row: Row) => string;
  readonly label: (row: Row) => string;
}

/** The closed set of parameter-bar controls a report may declare. */
export enum ReportParamKind {
  Date = "date",
  DateRange = "dateRange",
  Select = "select",
  Text = "text",
  Branch = "branch",
}

/** Declarative parameter-bar field — the UI renders this generically, no per-report form code. */
export type ReportParamField =
  | { readonly kind: ReportParamKind.Date; readonly key: string; readonly label: string }
  | { readonly kind: ReportParamKind.DateRange; readonly fromKey: string; readonly toKey: string; readonly label: string }
  | { readonly kind: ReportParamKind.Select; readonly key: string; readonly label: string; readonly options: readonly { value: string; label: string }[] }
  | { readonly kind: ReportParamKind.Text; readonly key: string; readonly label: string; readonly placeholder?: string }
  /**
   * الفرع — a picker over the branch register, resolved by the client against
   * the branches the SESSION may see. The value sent is the real branch id.
   * `allowUnattributed` adds the «غير مخصص» bucket (DEC-20) for reports that
   * read the posted journal line.
   */
  | { readonly kind: ReportParamKind.Branch; readonly key: string; readonly label: string; readonly allowUnattributed: boolean };

/**
 * A GL-reconciliation banner (docs/archive/catalog/08-reports.md: five reports
 * cross-check their own total against a reference — most simply the general
 * ledger itself, e.g. ميزان المراجعة's "إجمالي المدين = إجمالي الدائن").
 */
export interface ReportReconciliationSpec<Row, Ctx, TParams = unknown> {
  readonly labelAr: string;
  readonly computeReportTotal?: (rows: readonly Row[]) => number;
  /**
   * `params` are the ones the report actually RAN with, not its defaults —
   * a reference total computed over the default period would silently stop
   * matching the moment the user changed the date range.
   */
  readonly computeReferenceTotal?: (rows: readonly Row[], ctx: Ctx, params: TParams) => number;
  /** Absolute-difference tolerance before the banner flags a mismatch. Defaults to 0. */
  readonly toleranceMoney?: number;
  /**
   * Both totals as exact Money. When present the banner compares and sends
   * THESE, as exact decimal strings, and the two number totals are not read;
   * a mismatch is then never a float artefact (D345).
   */
  readonly computeExactTotals?: (rows: readonly Row[], ctx: Ctx, params: TParams) => { readonly report: Money; readonly reference: Money } | null;
  /**
   * Whether the reference figure is actually available in this context.
   * Returns false and the banner is not shown at all.
   *
   * A report whose reference source is optional (a control-account balance the
   * caller may or may not wire) would otherwise compare its real total against
   * a defaulted 0 and declare a mismatch on every run — which trains everyone
   * to ignore the banner, the opposite of what it is for.
   */
  readonly available?: (ctx: Ctx) => boolean;
  /** Ledger amounts `computeReferenceTotal` has ALREADY excluded; shown, never subtracted again. */
  readonly reconcilingItems?: (ctx: Ctx, params: TParams) => readonly ReportReconcilingItem[];
}

export interface ReportReconcilingItem {
  readonly key: string;
  readonly labelAr: string;
  readonly amount: ReportFigure;
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
   * auto-running on every filter change (docs/archive/catalog/08-reports.md: دفتر
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
  /** The chart above the table (A2). Omit it and the report renders none. */
  readonly chart?: ReportChartSpec;
  readonly costRowKeys?: readonly string[];
  /** SECURITY: a report whose `run` orders by a cost field must name a cost-free order here, or `withoutCost` leaves the order as a cost oracle. */
  readonly costlessOrder?: (a: Row, b: Row) => number;
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
  readonly value: (rows: readonly Row[], params: TParams) => ReportFigure;
  /** Handed a string figure's SIGN (-1, 0 or 1), never a float of it. */
  readonly tone?: (value: number) => "default" | "success" | "danger";
  readonly cost?: boolean;
}

export interface ReportKpiResult {
  readonly key: string;
  readonly labelAr: string;
  readonly hintAr?: string;
  readonly format?: ReportColumnFormat;
  readonly value: ReportFigure;
  readonly tone?: "default" | "success" | "danger";
}

/**
 * What a report charts (A2, R21.4). Names two of its own columns rather than
 * carrying a second copy of the data: the chart and the table are then the
 * same numbers by construction, and a chart cannot drift from the rows beneath
 * it.
 */
export interface ReportChartSpec {
  /** Omitted with `source: ReportChartSource.Groups` — the point's name is the section's own label. */
  readonly labelColumn?: string;
  readonly valueColumn: string;
  /** Charting fifty rows produces a hairbrush; the top slice is the readable part. */
  readonly maxPoints?: number;
  readonly captionAr?: string;
  /**
   * Where the points come from.
   *
   * `rows` (the default) plots one point per row. `groups` plots one point per
   * SECTION, using the subtotal the table already prints for it — which is the
   * only readable chart for a statement whose rows are individual accounts:
   * the balance sheet's answer is "assets versus liabilities and equity", not
   * "the eight largest ledger accounts".
   */
  readonly source?: ReportChartSource;
  /**
   * Adds the rows up by their label before plotting. A movement report has one
   * row per movement, and forty bars each labelled with the same item name are
   * not a chart of anything; summing them by item is.
   */
  readonly aggregate?: boolean;
  /**
   * Which end of the rows to take when there are more than `maxPoints`.
   * `last` is for a running-balance statement, where the answer is at the end.
   */
  readonly slice?: ReportChartSlice;
}

export enum ReportChartSlice {
  First = "first",
  Last = "last",
}

export enum ReportChartSource {
  Rows = "rows",
  Groups = "groups",
}

export interface ReportChartPoint {
  readonly key: string;
  readonly label: string;
  readonly labelEn?: string;
  readonly value: number;
}

export interface ReportValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ReportGroupResult<Row> {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly Row[];
  readonly totals: Readonly<Record<string, ReportFigure>>;
}

export interface ReportReconciliationResult {
  readonly labelAr: string;
  readonly reportTotal: ReportFigure;
  readonly referenceTotal: ReportFigure;
  readonly diff: ReportFigure;
  readonly withinTolerance: boolean;
  /** Present only when at least one item is non-zero. */
  readonly reconcilingItems?: readonly ReportReconcilingItem[];
}

export type RunReportOutcome<TParams, Row> =
  | {
      readonly ok: true;
      readonly params: TParams;
      readonly rows: readonly Row[];
      readonly groups: readonly ReportGroupResult<Row>[];
      readonly grandTotals: Readonly<Record<string, ReportFigure>>;
      readonly reconciliation: ReportReconciliationResult | null;
      readonly kpis: readonly ReportKpiResult[];
      /** Computed over the whole result before any paging, so a paged response still charts every row. */
      readonly chartPoints: readonly ReportChartPoint[] | null;
    }
  | { readonly ok: false; readonly errors: readonly ReportValidationError[] };
