import type {
  ReportColumn,
  ReportDefinition,
  ReportGroupResult,
  ReportReconciliationResult,
  ReportValidationError,
  RunReportOutcome,
} from "./types.js";

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

function sumColumn<Row>(rows: readonly Row[], column: ReportColumn<Row>): number {
  let sum = 0;
  for (const row of rows) {
    const raw = column.value(row);
    if (typeof raw === "number" && Number.isFinite(raw)) sum += raw;
  }
  return sum;
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
): ReportReconciliationResult | null {
  if (!definition.reconciliation) return null;
  const { labelAr, computeReportTotal, computeReferenceTotal, toleranceMoney = 0 } = definition.reconciliation;
  const reportTotal = computeReportTotal(rows);
  const referenceTotal = computeReferenceTotal(rows, ctx);
  const diff = reportTotal - referenceTotal;
  return { labelAr, reportTotal, referenceTotal, diff, withinTolerance: Math.abs(diff) <= toleranceMoney };
}

/**
 * Runs a report end to end: validate params → execute the query plan →
 * group + total → evaluate reconciliation. The one function a UI needs to
 * call to go from raw form params to render-ready output.
 */
export function runReport<TParams, Row, Ctx>(
  definition: ReportDefinition<TParams, Row, Ctx>,
  rawParams: unknown,
  ctx: Ctx,
): RunReportOutcome<TParams, Row> {
  const validated = validateReportParams(definition, rawParams);
  if (!validated.ok) return validated;

  const rows = definition.run(validated.params, ctx);
  const { groups, grandTotals } = computeReportGroups(definition, rows);
  const reconciliation = computeReconciliation(definition, rows, ctx);

  return { ok: true, params: validated.params, rows, groups, grandTotals, reconciliation };
}
