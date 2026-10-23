import { sumRows } from "./kpi.js";
import { ReportChartSource, type ReportChartPoint, type ReportChartSpec, type ReportColumn, type ReportGroupResult } from "./types.js";

/**
 * Turns a report's `chart` declaration into the points `<ReportChart>` draws.
 *
 * Every point is read off the SAME rows (or the SAME group subtotals) the table
 * prints, through the columns the definition names — so the chart cannot drift
 * from the figures beneath it. Where points are added together, they are added
 * through `sumRows`, the scaled-integer accumulation the engine's totals use.
 */
export interface ChartPointSource<Row> {
  readonly rows: readonly Row[];
  readonly groups: readonly ReportGroupResult<Row>[];
}

/**
 * A chart point is a bar length, not a figure anyone reads off: an exact
 * decimal string (D345) becomes a number only here, for geometry.
 */
function chartValue(raw: string | number): number {
  return typeof raw === "number" ? raw : Number(raw);
}

export function reportChartPoints<Row>(
  chart: ReportChartSpec | undefined,
  columns: readonly ReportColumn<Row>[],
  rowKey: (row: Row) => string,
  result: ChartPointSource<Row> | null,
): ReportChartPoint[] | null {
  if (!chart || !result) return null;
  const valueColumn = columns.find((c) => c.key === chart.valueColumn);
  if (!valueColumn) return null;

  const maxPoints = chart.maxPoints ?? 8;
  const take = (points: ReportChartPoint[]): ReportChartPoint[] =>
    chart.slice === "last" ? points.slice(Math.max(0, points.length - maxPoints)) : points.slice(0, maxPoints);

  if (chart.source === ReportChartSource.Groups) {
    // A section's own name, not a cell's: the grouping key is rarely a column
    // (the trial balance groups by account type and never prints it), so
    // requiring one here silently produced no chart at all.
    return take(
      result.groups
        .filter((group) => group.label !== "")
        .map((group) => ({ key: group.key, label: group.label, value: chartValue(group.totals[chart.valueColumn] ?? 0) })),
    );
  }

  const labelColumn = columns.find((c) => c.key === chart.labelColumn);
  if (!labelColumn) return null;

  const enKey = labelColumn.key.endsWith("Ar") ? `${labelColumn.key.slice(0, -2)}En` : null;
  const labelEnOf = (row: Row): { labelEn?: string } => {
    const en = enKey ? (row as Record<string, unknown>)[enKey] : undefined;
    return typeof en === "string" && en.trim() !== "" ? { labelEn: en } : {};
  };

  if (chart.aggregate) {
    const buckets = new Map<string, Row[]>();
    for (const row of result.rows) {
      const label = String(labelColumn.value(row) ?? "");
      const bucket = buckets.get(label);
      if (bucket) bucket.push(row);
      else buckets.set(label, [row]);
    }
    const points: ReportChartPoint[] = [...buckets.entries()].map(([label, rows]) => ({
      key: label,
      label,
      ...(rows[0] ? labelEnOf(rows[0]) : {}),
      value: sumRows(rows, (row) => {
        const raw = valueColumn.value(row);
        return raw === null ? null : chartValue(raw);
      }),
    }));
    // Ordered by magnitude: a chart of the eight largest is only the eight
    // largest if it was sorted before it was cut.
    points.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return take(points);
  }

  return take(
    result.rows.map((row, index) => ({
      key: `${rowKey(row)}-${index}`,
      label: String(labelColumn.value(row) ?? ""),
      ...labelEnOf(row),
      value: chartValue(valueColumn.value(row) ?? 0),
    })),
  );
}
