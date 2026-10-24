import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_PAGE_SIZE } from "@mezan/contracts";
import { computeReportGroups, pageReportGroups, readReportPage, runReport } from "./engine.js";
import type { ReportDefinition } from "./types.js";

interface Row {
  readonly id: string;
  readonly section: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly amount: string;
}

const rows: Row[] = [
  { id: "a1", section: "A", nameAr: "أ", nameEn: "One", amount: "10.10" },
  { id: "a2", section: "A", nameAr: "ب", nameEn: null, amount: "20.20" },
  { id: "b1", section: "B", nameAr: "ج", nameEn: "Three", amount: "30.30" },
  { id: "b2", section: "B", nameAr: "أ", nameEn: "One", amount: "40.40" },
  { id: "c1", section: "C", nameAr: "د", nameEn: null, amount: "50.50" },
];

const definition: ReportDefinition<Record<string, never>, Row, null> = {
  id: "paging.test",
  titleAr: "",
  paramsSchema: z.object({}).strip() as unknown as z.ZodType<Record<string, never>, z.ZodTypeDef, unknown>,
  defaultParams: {},
  paramFields: [],
  run: () => rows,
  rowKey: (row) => row.id,
  columns: [
    { key: "nameAr", header: "", value: (row) => row.nameAr },
    { key: "amount", header: "", format: "money", total: true, value: (row) => row.amount },
  ],
  group: { key: (row) => row.section, label: (row) => row.section },
  chart: { labelColumn: "nameAr", valueColumn: "amount", aggregate: true, maxPoints: 2 },
};

describe("pageReportGroups", () => {
  const { groups } = computeReportGroups(definition, rows);

  it("walks the groups in table order and keeps each group's full-set totals", () => {
    const paged = pageReportGroups(groups, { page: 2, pageSize: 2 });
    expect(paged.rows.map((r) => r.id)).toEqual(["b1", "b2"]);
    expect(paged.groups.map((g) => g.key)).toEqual(["B"]);
    expect(paged.groups[0]?.totals).toEqual({ amount: "70.700000" });
    expect(paged.page).toEqual({ page: 2, pageSize: 2, totalRows: 5 });
  });

  it("splits a group across pages without touching its subtotal", () => {
    const paged = pageReportGroups(groups, { page: 1, pageSize: 3 });
    expect(paged.groups.map((g) => [g.key, g.rows.length])).toEqual([["A", 2], ["B", 1]]);
    expect(paged.groups[1]?.totals).toEqual(groups[1]?.totals);
  });

  it("the pages together are every row exactly once", () => {
    const all = [1, 2, 3].flatMap((page) => pageReportGroups(groups, { page, pageSize: 2 }).rows.map((r) => r.id));
    expect(all).toEqual(["a1", "a2", "b1", "b2", "c1"]);
  });

  it("past the end is an empty page that still counts the whole result", () => {
    const paged = pageReportGroups(groups, { page: 9, pageSize: 2 });
    expect(paged.rows).toEqual([]);
    expect(paged.groups).toEqual([]);
    expect(paged.page.totalRows).toBe(5);
  });
});

describe("readReportPage", () => {
  it("no pageSize means unpaged", () => {
    expect(readReportPage({})).toEqual({ ok: true, window: null });
    expect(readReportPage({ page: "3" })).toEqual({ ok: true, window: null });
  });

  it("defaults the page to 1 and refuses a size past the cap or a non-integer", () => {
    expect(readReportPage({ pageSize: "50" })).toEqual({ ok: true, window: { page: 1, pageSize: 50 } });
    expect(readReportPage({ pageSize: String(MAX_PAGE_SIZE + 1) }).ok).toBe(false);
    expect(readReportPage({ pageSize: "10", page: "0" }).ok).toBe(false);
    expect(readReportPage({ pageSize: "abc" }).ok).toBe(false);
  });
});

describe("runReport chartPoints", () => {
  it("are computed over every row, aggregated by label, with the English name carried", () => {
    const outcome = runReport(definition, {}, null);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.chartPoints).toEqual([
      { key: "أ", label: "أ", labelEn: "One", value: 50.5 },
      { key: "د", label: "د", value: 50.5 },
    ]);
  });
});
