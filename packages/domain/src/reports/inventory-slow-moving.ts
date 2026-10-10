import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { Warehouse } from "../settings/warehouse.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countRows, maxOf } from "./kpi.js";
import { itemTypeTracksStock } from "../items/item-type.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * أصناف بطيئة الحركة — Slow-Moving Items (docs/archive/catalog/08-reports.md): items
 * tying up capital because they haven't sold (or sold long ago). "Last sale
 * date" per item is the max `date` across confirmed/partially-paid/paid
 * `SalesInvoice` lines referencing it — real sales history, not a cached flag.
 */

export type SlowMovingSeverity = "light" | "medium" | "critical";

const SEVERITY_LABELS: Record<SlowMovingSeverity, string> = {
  light: "خفيف",
  medium: "متوسط",
  critical: "حرج",
};

function severityOf(daysSinceLastSale: number | null): SlowMovingSeverity {
  if (daysSinceLastSale === null || daysSinceLastSale >= 365) return "critical";
  if (daysSinceLastSale >= 180) return "medium";
  return "light";
}

export interface InventorySlowMovingContext {
  readonly items: readonly Item[];
  readonly snapshots: readonly WacSnapshot[];
  readonly invoices: readonly SalesInvoice[];
  /**
   * The warehouse register, for resolving each position's branch (D111). A WAC
   * snapshot carries a warehouse and never a branch, so without this the
   * `branchId` parameter has nothing to match on. Optional: omit it and the
   * report runs unfiltered by branch — every route that mounts this report
   * wires it.
   */
  readonly warehouses?: readonly Warehouse[];
}

export interface InventorySlowMovingParams {
  readonly severity: "" | SlowMovingSeverity;
  readonly search: string;
  readonly daysSinceLastSale: number;
  readonly warehouseId: string;
  readonly branchId: string;
}

export interface InventorySlowMovingRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly onHand: number;
  readonly value: number;
  readonly daysSinceLastSale: number | null;
  readonly lastSaleDate: string | null;
  readonly severityLabel: string;
}

const paramsSchema = z.object({
  severity: z.enum(["", "light", "medium", "critical"]),
  search: z.string(),
  daysSinceLastSale: z.coerce.number().int().min(0),
  warehouseId: z.string(),
  branchId: branchIdParamSchema,
});

export function createInventorySlowMovingReport(today: string): ReportDefinition<
  InventorySlowMovingParams,
  InventorySlowMovingRow,
  InventorySlowMovingContext
> {
  return {
    id: "inventory.slow-moving",
    titleAr: "أصناف بطيئة الحركة",
    descriptionAr: "أصناف لم تُباع منذ أكثر من حد الأيام المحدد — رأس مال مجمد.",
    paramsSchema,
    defaultParams: { severity: "", search: "", daysSinceLastSale: 90, warehouseId: "", branchId: "" },
    paramFields: [
      {
        kind: ReportParamKind.Select,
        key: "severity",
        label: "مستوى الخطورة",
        options: [
          { value: "", label: "الكل" },
          { value: "light", label: SEVERITY_LABELS.light },
          { value: "medium", label: SEVERITY_LABELS.medium },
          { value: "critical", label: SEVERITY_LABELS.critical },
        ],
      },
      { kind: ReportParamKind.Text, key: "search", label: "بحث", placeholder: "اسم الصنف" },
      { kind: ReportParamKind.Text, key: "daysSinceLastSale", label: "أيام منذ آخر بيع" },
      { kind: ReportParamKind.Text, key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "onHand", header: "المخزون الحالي", format: "qty", align: "end", total: true, value: (row) => row.onHand },
      { key: "value", header: "قيمة المخزون", format: "money", align: "end", total: true, value: (row) => row.value },
      { key: "daysSinceLastSale", header: "أيام منذ آخر بيع", format: "qty", align: "end", value: (row) => row.daysSinceLastSale },
      { key: "lastSaleDate", header: "تاريخ آخر بيع", format: "date", value: (row) => row.lastSaleDate },
      { key: "severityLabel", header: "مستوى الخطورة", format: "text", value: (row) => row.severityLabel },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "onHand",
      maxPoints: 8,
      captionAr: "الأصناف الراكدة مرتبة حسب الكمية المتبقية.",
    },
    kpis: [
      { key: "value", labelAr: "رأس المال المجمد", format: "money", value: (rows) => sumRows(rows, (r) => r.value), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "itemCount", labelAr: "عدد الأصناف الراكدة", format: "qty", value: (rows) => rows.length },
      { key: "criticalCount", labelAr: "أصناف حرجة", format: "qty", value: (rows) => countRows(rows, (r) => r.severityLabel === SEVERITY_LABELS.critical), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "maxDays", labelAr: "أطول فترة بلا بيع (يوم)", format: "qty", value: (rows) => maxOf(rows, (r) => r.daysSinceLastSale) },
    ],
    run: (params, ctx) => {
      const search = params.search.trim().toLowerCase();
      const todayMs = Date.parse(`${today}T00:00:00Z`);

      const branchOf = branchOfWarehouse(ctx.warehouses);
      const lastSaleByItem = new Map<string, string>();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (!matchesBranch(invoice.branchId, params.branchId)) continue;
        for (const line of invoice.lines) {
          const existing = lastSaleByItem.get(line.itemId);
          if (!existing || invoice.date > existing) lastSaleByItem.set(line.itemId, invoice.date);
        }
      }

      const rows: InventorySlowMovingRow[] = [];
      for (const item of ctx.items) {
        if (!itemTypeTracksStock(item.type)) continue;
        if (search && !item.nameAr.toLowerCase().includes(search)) continue;
        const positions = ctx.snapshots.filter(
          (s) =>
            s.itemId === item.id &&
            (params.warehouseId === "" || s.warehouseId === params.warehouseId) &&
            matchesBranch(branchOf(s.warehouseId), params.branchId),
        );
        const onHand = Number(Qty.sum(positions.map((p) => p.onHand)).toString());
        const value = Number(Money.sum(positions.map((p) => p.totalValue)).toString());
        const lastSaleDate = lastSaleByItem.get(item.id) ?? null;
        const daysSinceLastSale = lastSaleDate ? Math.round((todayMs - Date.parse(`${lastSaleDate}T00:00:00Z`)) / 86_400_000) : null;
        if (daysSinceLastSale !== null && daysSinceLastSale < params.daysSinceLastSale) continue;
        const severity = severityOf(daysSinceLastSale);
        if (params.severity !== "" && severity !== params.severity) continue;
        rows.push({
          itemId: item.id,
          itemNameAr: item.nameAr,
          itemNameEn: item.nameEn ?? null,
          onHand,
          value,
          daysSinceLastSale,
          lastSaleDate,
          severityLabel: SEVERITY_LABELS[severity],
        });
      }
      return rows.sort((a, b) => b.value - a.value);
    },
  };
}
