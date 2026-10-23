import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countRows } from "./kpi.js";
import { itemTypeTracksStock } from "../items/item-type.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * مستويات المخزون — Stock Levels (docs/archive/catalog/08-reports.md): point-in-time
 * stock status per item (aggregated across warehouses, or one warehouse when
 * filtered), flagging items at/under their reorder point. Sourced from the
 * cached WAC snapshots (`WacSnapshotRepository`) — the same fast-read cache
 * the costing engine itself serves from.
 */

export type StockLevelStatus = "out" | "low" | "normal";

export interface InventoryStockLevelsContext {
  readonly items: readonly Item[];
  readonly snapshots: readonly WacSnapshot[];
  /**
   * The warehouse register, for resolving each position's branch (D111). A WAC
   * snapshot carries a warehouse and never a branch, so without this the
   * `branchId` parameter has nothing to match on. Optional: omit it and the
   * report runs unfiltered by branch — every route that mounts this report
   * wires it.
   */
  readonly warehouses?: readonly Warehouse[];
}

export interface InventoryStockLevelsParams {
  readonly warehouseId: string;
  readonly search: string;
  readonly branchId: string;
}

export interface InventoryStockLevelsRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly sku: string;
  readonly warehouseCount: number;
  readonly onHand: number;
  readonly averageCost: number;
  readonly value: number;
  readonly status: StockLevelStatus;
}

const STATUS_LABEL: Record<StockLevelStatus, string> = { out: "نافد", low: "منخفض", normal: "طبيعي" };

export const inventoryStockLevelsParamsSchema = z.object({
  warehouseId: z.string(),
  search: z.string(),
  branchId: branchIdParamSchema,
});

function computeStatus(onHand: number, reorderPoint: number | null): StockLevelStatus {
  if (onHand <= 0) return "out";
  if (reorderPoint !== null && onHand <= reorderPoint) return "low";
  return "normal";
}

export interface StockLevelPosition {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string | null;
  readonly sku: string;
  readonly warehouseCount: number;
  readonly onHand: Qty;
  readonly value: Money;
  readonly status: StockLevelStatus;
}

export function computeStockLevelPositions(params: InventoryStockLevelsParams, ctx: InventoryStockLevelsContext): StockLevelPosition[] {
  const search = params.search.trim().toLowerCase();
  const branchOf = branchOfWarehouse(ctx.warehouses);
  const snapshotsByItem = new Map<string, WacSnapshot[]>();
  for (const s of ctx.snapshots) {
    if (params.warehouseId !== "" && s.warehouseId !== params.warehouseId) continue;
    if (!matchesBranch(branchOf(s.warehouseId), params.branchId)) continue;
    const list = snapshotsByItem.get(s.itemId);
    if (list) list.push(s);
    else snapshotsByItem.set(s.itemId, [s]);
  }
  const positions: StockLevelPosition[] = [];
  for (const item of ctx.items) {
    if (!itemTypeTracksStock(item.type)) continue;
    if (search && !item.nameAr.toLowerCase().includes(search) && !item.code.toLowerCase().includes(search)) continue;
    const held = snapshotsByItem.get(item.id) ?? [];
    const onHand = Qty.sum(held.map((p) => p.onHand));
    positions.push({
      itemId: item.id,
      itemNameAr: item.nameAr,
      itemNameEn: item.nameEn ?? null,
      sku: item.code,
      warehouseCount: held.length,
      onHand,
      value: Money.sum(held.map((p) => p.totalValue)),
      status: computeStatus(Number(onHand.toString()), item.reorderPoint),
    });
  }
  return positions.sort((a, b) => a.itemNameAr.localeCompare(b.itemNameAr));
}

export interface StockLevelsAttentionRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string | null;
  readonly sku: string;
  readonly onHand: string;
  readonly status: StockLevelStatus;
}

export interface InventoryStockLevelsSummary {
  readonly totalValue: string;
  readonly needsAttentionCount: number;
  readonly lowCount: number;
  readonly attention: readonly StockLevelsAttentionRow[];
  readonly firstLow: StockLevelsAttentionRow | null;
}

export const STOCK_LEVELS_ATTENTION_LIMIT = 5;

function attentionRow(position: StockLevelPosition): StockLevelsAttentionRow {
  return {
    itemId: position.itemId,
    itemNameAr: position.itemNameAr,
    itemNameEn: position.itemNameEn,
    sku: position.sku,
    onHand: position.onHand.toString(),
    status: position.status,
  };
}

export function summarizeStockLevels(params: InventoryStockLevelsParams, ctx: InventoryStockLevelsContext): InventoryStockLevelsSummary {
  const positions = computeStockLevelPositions(params, ctx);
  const needsAttention = positions.filter((p) => p.status !== "normal");
  const low = positions.filter((p) => p.status === "low");
  return {
    totalValue: Money.sum(positions.map((p) => p.value)).toString(),
    needsAttentionCount: needsAttention.length,
    lowCount: low.length,
    attention: needsAttention.slice(0, STOCK_LEVELS_ATTENTION_LIMIT).map(attentionRow),
    firstLow: low[0] ? attentionRow(low[0]) : null,
  };
}

export function createInventoryStockLevelsReport(): ReportDefinition<
  InventoryStockLevelsParams,
  InventoryStockLevelsRow,
  InventoryStockLevelsContext
> {
  return {
    id: "inventory.stock-levels",
    titleAr: "مستويات المخزون",
    descriptionAr: "الأصناف التي تحتاج تدخلاً الآن — الأصناف الأقل من حد إعادة الطلب.",
    paramsSchema: inventoryStockLevelsParamsSchema,
    defaultParams: { warehouseId: "", search: "", branchId: "" },
    paramFields: [
      { kind: ReportParamKind.Text, key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع (اتركه فارغاً لكل المستودعات)" },
      { kind: ReportParamKind.Text, key: "search", label: "الصنف", placeholder: "ابحث بالاسم أو الكود" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "sku", header: "الكود", format: "text", value: (row) => row.sku },
      { key: "warehouseCount", header: "عدد المستودعات", format: "qty", align: "end", value: (row) => row.warehouseCount },
      { key: "onHand", header: "إجمالي المخزون", format: "qty", align: "end", total: true, value: (row) => row.onHand },
      { key: "averageCost", header: "متوسط التكلفة", format: "money", align: "end", value: (row) => row.averageCost },
      { key: "value", header: "قيمة المخزون", format: "money", align: "end", total: true, value: (row) => row.value },
      { key: "status", header: "الحالة", format: "text", value: (row) => STATUS_LABEL[row.status] },
    ],
    kpis: [
      { key: "value", labelAr: "إجمالي قيمة المخزون", format: "money", value: (rows) => sumRows(rows, (r) => r.value) },
      { key: "onHand", labelAr: "إجمالي الكميات", format: "qty", value: (rows) => sumRows(rows, (r) => r.onHand) },
      { key: "itemCount", labelAr: "عدد الأصناف", format: "qty", value: (rows) => rows.length },
      { key: "needsAttention", labelAr: "أصناف تحت حد الطلب", format: "qty", value: (rows) => countRows(rows, (r) => r.status !== "normal"), tone: (value) => (value > 0 ? "danger" : "success") },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "value",
      maxPoints: 8,
      captionAr: "الأصناف الأعلى قيمة مخزونية — أين يقف رأس المال.",
    },
    run: (params, ctx) =>
      computeStockLevelPositions(params, ctx).map((position) => {
        const onHand = Number(position.onHand.toString());
        const value = Number(position.value.toString());
        return {
          itemId: position.itemId,
          itemNameAr: position.itemNameAr,
          itemNameEn: position.itemNameEn,
          sku: position.sku,
          warehouseCount: position.warehouseCount,
          onHand,
          averageCost: onHand !== 0 ? value / onHand : 0,
          value,
          status: position.status,
        };
      }),
  };
}
