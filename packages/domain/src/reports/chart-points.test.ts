import { describe, expect, it } from "vitest";
import { sumRows } from "./kpi.js";
import { ReportChartSlice, ReportChartSource, type ReportChartSpec, type ReportColumn, type ReportGroupResult } from "./types.js";
import { reportChartPoints, type ChartPointSource } from "./chart-points.js";

interface Row {
  readonly label: string;
  readonly value: number;
}

const labelColumn: ReportColumn<Row> = { key: "label", header: "", value: (row) => row.label };
const valueColumn: ReportColumn<Row> = { key: "value", header: "", value: (row) => row.value };
const columns: readonly ReportColumn<Row>[] = [labelColumn, valueColumn];
const rowKey = (row: Row) => row.label;

function rows(...values: readonly number[]): readonly Row[] {
  return values.map((value, i) => ({ label: `r${i}`, value }));
}

function source(rowsIn: readonly Row[], groups: readonly ReportGroupResult<Row>[] = []): ChartPointSource<Row> {
  return { rows: rowsIn, groups };
}

describe("reportChartPoints", () => {
  it("returns null when chart is undefined", () => {
    expect(reportChartPoints(undefined, columns, rowKey, source(rows(1, 2)))).toBeNull();
  });

  it("returns null when result is null", () => {
    const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "label", valueColumn: "value" };
    expect(reportChartPoints(chart, columns, rowKey, null)).toBeNull();
  });

  it("returns null when valueColumn is missing from columns", () => {
    const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "label", valueColumn: "nope" };
    expect(reportChartPoints(chart, columns, rowKey, source(rows(1)))).toBeNull();
  });

  it("returns null when labelColumn is missing from columns (non-groups source)", () => {
    const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "nope", valueColumn: "value" };
    expect(reportChartPoints(chart, columns, rowKey, source(rows(1)))).toBeNull();
  });

  describe("source: 'groups'", () => {
    it("filters out groups with an empty label, maps to {key, label, value: totals[valueColumn] ?? 0}", () => {
      const chart: ReportChartSpec = { source: ReportChartSource.Groups, labelColumn: "label", valueColumn: "value" };
      const groups: readonly ReportGroupResult<Row>[] = [
        { key: "blank", label: "", rows: [], totals: { value: 999 } },
        { key: "g1", label: "المجموعة الأولى", rows: [], totals: { value: 100 } },
        { key: "g2", label: "المجموعة الثانية", rows: [], totals: {} },
      ];
      const points = reportChartPoints(chart, columns, rowKey, source([], groups));
      expect(points).toEqual([
        { key: "g1", label: "المجموعة الأولى", value: 100 },
        { key: "g2", label: "المجموعة الثانية", value: 0 },
      ]);
    });

    it("respects slice: 'last' (tail maxPoints) vs the default (head maxPoints)", () => {
      const groups: readonly ReportGroupResult<Row>[] = Array.from({ length: 5 }, (_, i) => ({
        key: `g${i}`,
        label: `label-${i}`,
        rows: [],
        totals: { value: i },
      }));
      const src = source([], groups);

      const head = reportChartPoints({ source: ReportChartSource.Groups, labelColumn: "label", valueColumn: "value", maxPoints: 2 }, columns, rowKey, src);
      expect(head?.map((p) => p.key)).toEqual(["g0", "g1"]);

      const tail = reportChartPoints({ source: ReportChartSource.Groups, labelColumn: "label", valueColumn: "value", maxPoints: 2, slice: ReportChartSlice.Last }, columns, rowKey, src);
      expect(tail?.map((p) => p.key)).toEqual(["g3", "g4"]);
    });

    it("defaults maxPoints to 8", () => {
      const groups: readonly ReportGroupResult<Row>[] = Array.from({ length: 10 }, (_, i) => ({
        key: `g${i}`,
        label: `label-${i}`,
        rows: [],
        totals: { value: i },
      }));
      const points = reportChartPoints({ source: ReportChartSource.Groups, labelColumn: "label", valueColumn: "value" }, columns, rowKey, source([], groups));
      expect(points).toHaveLength(8);
    });
  });

  describe("source: 'rows', non-aggregate", () => {
    it("maps each row to a point keyed `${rowKey}-${index}`, in original order", () => {
      const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "label", valueColumn: "value" };
      const points = reportChartPoints(chart, columns, rowKey, source(rows(10, 20, 30)));
      expect(points).toEqual([
        { key: "r0-0", label: "r0", value: 10 },
        { key: "r1-1", label: "r1", value: 20 },
        { key: "r2-2", label: "r2", value: 30 },
      ]);
    });

    it("respects maxPoints and slice on the row order too", () => {
      const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "label", valueColumn: "value", maxPoints: 2, slice: ReportChartSlice.Last };
      const points = reportChartPoints(chart, columns, rowKey, source(rows(1, 2, 3, 4)));
      expect(points?.map((p) => p.value)).toEqual([3, 4]);
    });
  });

  describe("source: 'rows', aggregate: true", () => {
    it("buckets rows by the label column's string value, sums the value column via the real sumRows, and sorts by |value| desc", () => {
      const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "label", valueColumn: "value", aggregate: true };
      const bucketed: Row[] = [
        { label: "a", value: 10 },
        { label: "b", value: -50 },
        { label: "a", value: 5 },
        { label: "c", value: 20 },
      ];
      const points = reportChartPoints(chart, columns, rowKey, source(bucketed));
      // "a": 15, "b": -50, "c": 20 — sorted by |value| descending: b(50), c(20), a(15)
      expect(points).toEqual([
        { key: "b", label: "b", value: -50 },
        { key: "c", label: "c", value: 20 },
        { key: "a", label: "a", value: 15 },
      ]);
      // Cross-check against the real sumRows the implementation itself uses.
      expect(sumRows(bucketed.filter((r) => r.label === "a"), (r) => r.value)).toBe(15);
    });

    it("respects maxPoints/slice on the aggregated, sorted buckets", () => {
      const chart: ReportChartSpec = { source: ReportChartSource.Rows, labelColumn: "label", valueColumn: "value", aggregate: true, maxPoints: 1 };
      const bucketed: Row[] = [
        { label: "small", value: 1 },
        { label: "big", value: 100 },
      ];
      const points = reportChartPoints(chart, columns, rowKey, source(bucketed));
      expect(points).toEqual([{ key: "big", label: "big", value: 100 }]);
    });
  });
});
