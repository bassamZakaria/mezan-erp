import type {
  ReportColumn,
  ReportDefinition,
  ReportGroupResult,
  ReportReconciliationResult,
  ReportValidationError,
  RunReportOutcome,
  ReportKpiResult,
  ReportFigure,
  ReportPage,
} from "./types.js";
import { z } from "zod";
import { sumRows } from "./kpi.js";
import { reportChartPoints } from "./chart-points.js";
import { Money } from "../money/index.js";

const DECIMAL_FIGURE = /^-?\d+(\.\d{1,6})?$/;

function isDecimalFigure(raw: string | number | null): raw is string {
  return typeof raw === "string" && DECIMAL_FIGURE.test(raw);
}

function signOf(scaled: bigint): number {
  return scaled > 0n ? 1 : scaled < 0n ? -1 : 0;
}

/** Validates raw (untyped, e.g. straight off a form) params against a report's zod schema. */
export function validateReportParams<TParams>(
  definition: Pick<ReportDefinition<TParams, unknown>, "paramsSchema">,
  rawParams: unknown,
): { ok: true; params: TParams } | { ok: false; errors: ReportValidationError[] } {
  const parsed = definition.paramsSchema.safeParse(rawParams);
  if (parsed.success) {
    return { ok: true, params: parsed.data };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : "_root",
      message: issue.message,
    })),
  };
}

/**
 * Sums a column in SCALED INTEGERS, not floats — through the SAME `sumRows`
 * every report's money KPI calls, so a strip figure and the grand total under
 * it cannot disagree.
 *
 * Report rows carry plain numbers, but a money column's values are exact to the
 * piastre, and adding a few hundred of them as IEEE-754 doubles compounds the
 * representation error: a trial balance whose debits and credits are equal to
 * the piastre came out as 681,214.3999999999 against 681,214.4, so
 * "debit = credit" read FALSE on books that balance.
 */
function sumColumn<Row>(rows: readonly Row[], column: ReportColumn<Row>): ReportFigure {
  const values = rows.map((row) => column.value(row));
  if (values.some(isDecimalFigure)) {
    let scaled = 0n;
    for (const raw of values) {
      if (isDecimalFigure(raw)) scaled += Money.fromMajor(raw).scaled;
      else if (typeof raw === "number" && Number.isFinite(raw)) scaled += BigInt(Math.round(raw * 1e6));
    }
    return Money.fromScaled(scaled).toString();
  }
  return sumRows(rows, (row) => {
    const raw = column.value(row);
    return typeof raw === "number" ? raw : null;
  });
}

function computeTotals<Row>(rows: readonly Row[], totalColumns: readonly ReportColumn<Row>[]): Record<string, ReportFigure> {
  const totals: Record<string, ReportFigure> = {};
  for (const column of totalColumns) totals[column.key] = sumColumn(rows, column);
  return totals;
}

/**
 * Groups rows per the definition's `group` spec (or a single unlabeled group
 * when none is given) and computes per-group + grand totals for every column
 * flagged `total: true`. This is the one place grouping/totals logic lives —
 * every report gets it for free instead of hand-rolling aggregation.
 */
export function computeReportGroups<Row>(
  definition: Pick<ReportDefinition<unknown, Row>, "columns" | "group">,
  rows: readonly Row[],
): { groups: ReportGroupResult<Row>[]; grandTotals: Record<string, ReportFigure> } {
  const totalColumns = definition.columns.filter((c) => c.total);
  const grandTotals = computeTotals(rows, totalColumns);
  for (const column of totalColumns) {
    if (column.grandTotal) grandTotals[column.key] = column.grandTotal(rows);
  }

  if (!definition.group) {
    return { groups: [{ key: "_all", label: "", rows, totals: grandTotals }], grandTotals };
  }

  const order: string[] = [];
  const buckets = new Map<string, { label: string; rows: Row[] }>();
  for (const row of rows) {
    const key = definition.group.key(row);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label: definition.group.label(row), rows: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.rows.push(row);
  }

  const groups: ReportGroupResult<Row>[] = order.map((key) => {
    const bucket = buckets.get(key);
    if (!bucket) throw new Error(`unreachable: missing bucket for group key "${key}"`);
    return { key, label: bucket.label, rows: bucket.rows, totals: computeTotals(bucket.rows, totalColumns) };
  });

  return { groups, grandTotals };
}

/** Evaluates a report's GL-reconciliation banner, if it declares one. */
export function computeReconciliation<TParams, Row, Ctx>(
  definition: Pick<ReportDefinition<TParams, Row, Ctx>, "reconciliation">,
  rows: readonly Row[],
  ctx: Ctx,
  params: TParams,
): ReportReconciliationResult | null {
  if (!definition.reconciliation) return null;
  const { labelAr, computeReportTotal, computeReferenceTotal, toleranceMoney = 0, available } = definition.reconciliation;
  if (available && !available(ctx)) return null;
  const items = (definition.reconciliation.reconcilingItems?.(ctx, params) ?? []).filter((item) =>
    typeof item.amount === "string" ? Money.fromMajor(item.amount).scaled !== 0n : item.amount !== 0,
  );
  const exact = definition.reconciliation.computeExactTotals?.(rows, ctx, params);
  if (exact) {
    const diff = exact.report.add(exact.reference.negate());
    const tolerance = Money.fromMajor(String(toleranceMoney));
    const absDiff = diff.scaled < 0n ? -diff.scaled : diff.scaled;
    return {
      labelAr,
      reportTotal: exact.report.toString(),
      referenceTotal: exact.reference.toString(),
      diff: diff.toString(),
      withinTolerance: absDiff <= tolerance.scaled,
      ...(items.length > 0 ? { reconcilingItems: items } : {}),
    };
  }
  if (!computeReportTotal || !computeReferenceTotal) return null;
  const reportTotal = computeReportTotal(rows);
  const referenceTotal = computeReferenceTotal(rows, ctx, params);
  const diff = reportTotal - referenceTotal;
  return {
    labelAr,
    reportTotal,
    referenceTotal,
    diff,
    withinTolerance: Math.abs(diff) <= toleranceMoney,
    ...(items.length > 0 ? { reconcilingItems: items } : {}),
  };
}

/**
 * Runs a report end to end: validate params → execute the query plan →
 * group + total → evaluate reconciliation. The one function a UI needs to
 * call to go from raw form params to render-ready output.
 */
/**
 * The summary strip a report gets when it declares none (R21.2).
 *
 * Derived from what the report already says about itself: how many rows it
 * found, and the grand total of every column it already marks `total`. That is
 * enough for a reader to know the size and the shape of the answer without
 * each of the twenty-odd reports being taught the same lesson separately.
 */
function defaultReportKpis<TParams, Row, Ctx>(
  definition: ReportDefinition<TParams, Row, Ctx>,
  rows: readonly Row[],
  grandTotals: Readonly<Record<string, ReportFigure>>,
): ReportKpiResult[] {
  const kpis: ReportKpiResult[] = [
    { key: "rowCount", labelAr: "عدد السطور", format: "qty", value: rows.length },
  ];
  for (const column of definition.columns) {
    if (!column.total) continue;
    const value = grandTotals[column.key];
    if (value === undefined) continue;
    kpis.push({ key: column.key, labelAr: column.header, format: column.format ?? "money", value });
  }
  // Four is what the strip lays out; past that the cards stop being a summary.
  return kpis.slice(0, 4);
}

function computeReportKpis<TParams, Row, Ctx>(
  definition: ReportDefinition<TParams, Row, Ctx>,
  params: TParams,
  rows: readonly Row[],
  grandTotals: Readonly<Record<string, ReportFigure>>,
): ReportKpiResult[] {
  if (!definition.kpis) return defaultReportKpis(definition, rows, grandTotals);
  return definition.kpis.map((spec) => {
    const value = spec.value(rows, params);
    return {
      key: spec.key,
      labelAr: spec.labelAr,
      hintAr: spec.hintAr,
      format: spec.format,
      value,
      tone: spec.tone?.(typeof value === "string" ? signOf(Money.fromMajor(value).scaled) : value),
    };
  });
}

export function runReport<TParams, Row, Ctx>(
  definition: ReportDefinition<TParams, Row, Ctx>,
  rawParams: unknown,
  ctx: Ctx,
): RunReportOutcome<TParams, Row> {
  const validated = validateReportParams(definition, rawParams);
  if (!validated.ok) return validated;

  const rows = definition.run(validated.params, ctx);
  const { groups, grandTotals } = computeReportGroups(definition, rows);
  const reconciliation = computeReconciliation(definition, rows, ctx, validated.params);

  const kpis = computeReportKpis(definition, validated.params, rows, grandTotals);
  const chartPoints = reportChartPoints(definition.chart, definition.columns, definition.rowKey, { rows, groups });

  return { ok: true, params: validated.params, rows, groups, grandTotals, reconciliation, kpis, chartPoints };
}

export const MAX_REPORT_PAGE_SIZE = 500;

const reportPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_REPORT_PAGE_SIZE).optional(),
});

/** `pageSize` absent means the caller wants every row, as before paging existed. */
export function readReportPage(
  query: Readonly<Record<string, string | undefined>>,
): { ok: true; window: { page: number; pageSize: number } | null } | { ok: false; errors: ReportValidationError[] } {
  const parsed = reportPageQuerySchema.safeParse({ page: query.page, pageSize: query.pageSize });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => ({ field: issue.path.join(".") || "_root", message: issue.message })) };
  }
  const { page, pageSize } = parsed.data;
  return { ok: true, window: pageSize === undefined ? null : { page, pageSize } };
}

/**
 * Cuts one page out of the rows in TABLE order — group by group — and keeps
 * every group's own totals, which were computed over the full set. A group
 * with no row on this page is left out of it.
 */
export function pageReportGroups<G extends { readonly rows: readonly unknown[] }>(
  groups: readonly G[],
  window: { readonly page: number; readonly pageSize: number },
): { groups: G[]; rows: G["rows"][number][]; page: ReportPage } {
  const start = (window.page - 1) * window.pageSize;
  const end = start + window.pageSize;
  const pagedGroups: G[] = [];
  const rows: G["rows"][number][] = [];
  let cursor = 0;
  for (const group of groups) {
    const from = Math.max(start - cursor, 0);
    const to = Math.min(end - cursor, group.rows.length);
    cursor += group.rows.length;
    if (from >= to) continue;
    const slice = group.rows.slice(from, to);
    pagedGroups.push({ ...group, rows: slice });
    rows.push(...slice);
  }
  return { groups: pagedGroups, rows, page: { page: window.page, pageSize: window.pageSize, totalRows: cursor } };
}
