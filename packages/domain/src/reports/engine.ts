import type {
  ReportColumn,
  ReportDefinition,
  ReportGroupResult,
  ReportReconciliationResult,
  ReportValidationError,
  RunReportOutcome,
  ReportKpiResult,
} from "./types.js";
import { sumRows } from "./kpi.js";

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
function sumColumn<Row>(rows: readonly Row[], column: ReportColumn<Row>): number {
  return sumRows(rows, (row) => {
    const raw = column.value(row);
    return typeof raw === "number" ? raw : null;
  });
}

function computeTotals<Row>(rows: readonly Row[], totalColumns: readonly ReportColumn<Row>[]): Record<string, number> {
  const totals: Record<string, number> = {};
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
): { groups: ReportGroupResult<Row>[]; grandTotals: Record<string, number> } {
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
  const reportTotal = computeReportTotal(rows);
  const referenceTotal = computeReferenceTotal(rows, ctx, params);
  const diff = reportTotal - referenceTotal;
  const items = (definition.reconciliation.reconcilingItems?.(ctx, params) ?? []).filter((item) => item.amount !== 0);
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
  grandTotals: Readonly<Record<string, number>>,
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
  grandTotals: Readonly<Record<string, number>>,
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
      tone: spec.tone?.(value),
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

  return { ok: true, params: validated.params, rows, groups, grandTotals, reconciliation, kpis };
}
