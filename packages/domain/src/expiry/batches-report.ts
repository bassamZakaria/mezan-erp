import { z } from "zod";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { CostLayer } from "../inventory/cost-layer.js";
import type { ReportDefinition } from "../reports/types.js";
import { sumRows } from "../reports/kpi.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "../reports/branch-filter.js";
import { summarizeBatchStock } from "./batch-stock.js";
import { ExpiryStatus } from "./types.js";

export const INVENTORY_BATCHES_REPORT_ID = "inventory.batches";

export const EXPIRY_STATUS_LABEL_AR: Record<ExpiryStatus, string> = {
  [ExpiryStatus.Expired]: "منتهية الصلاحية",
  [ExpiryStatus.NearExpiry]: "قاربت على الانتهاء",
  [ExpiryStatus.Ok]: "سليمة",
  [ExpiryStatus.NoExpiry]: "بدون تاريخ صلاحية",
};

export const NO_BATCH_LABEL_AR = "بدون تشغيلة";

export interface InventoryBatchesContext {
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
  readonly layers: readonly CostLayer[];
}

export interface InventoryBatchesParams {
  readonly status: "" | ExpiryStatus;
  readonly search: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly branchId: string;
}

export interface InventoryBatchesRow {
  readonly key: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly batchNo: string | null;
  readonly batchLabel: string;
  readonly expiryDate: string | null;
  readonly daysToExpiry: number | null;
  readonly status: ExpiryStatus;
  readonly statusLabel: string;
  readonly fefoRank: number;
  readonly qty: number;
  readonly qtyExact: string;
  readonly totalValue: number;
  readonly valueExact: string;
  readonly receivedOn: string;
}

const paramsSchema = z.object({
  status: z.enum(["", ExpiryStatus.Expired, ExpiryStatus.NearExpiry, ExpiryStatus.Ok, ExpiryStatus.NoExpiry]),
  search: z.string(),
  warehouseId: z.string(),
  itemId: z.string().default(""),
  branchId: branchIdParamSchema,
});

export function createInventoryBatchesReport(
  today: string,
  nearExpiryDays: number,
): ReportDefinition<InventoryBatchesParams, InventoryBatchesRow, InventoryBatchesContext> {
  return {
    id: INVENTORY_BATCHES_REPORT_ID,
    titleAr: "المخزون حسب التشغيلة والصلاحية",
    descriptionAr: `رصيد كل تشغيلة في كل مستودع بترتيب الصرف (الأقرب انتهاءً أولاً). «قاربت على الانتهاء» = خلال ${nearExpiryDays} يوماً.`,
    paramsSchema,
    defaultParams: { status: "", search: "", warehouseId: "", itemId: "", branchId: "" },
    paramFields: [
      {
        kind: "select",
        key: "status",
        label: "الحالة",
        options: [
          { value: "", label: "الكل" },
          { value: ExpiryStatus.Expired, label: EXPIRY_STATUS_LABEL_AR[ExpiryStatus.Expired] },
          { value: ExpiryStatus.NearExpiry, label: EXPIRY_STATUS_LABEL_AR[ExpiryStatus.NearExpiry] },
          { value: ExpiryStatus.Ok, label: EXPIRY_STATUS_LABEL_AR[ExpiryStatus.Ok] },
          { value: ExpiryStatus.NoExpiry, label: EXPIRY_STATUS_LABEL_AR[ExpiryStatus.NoExpiry] },
        ],
      },
      { kind: "text", key: "search", label: "بحث", placeholder: "اسم الصنف أو كوده أو رقم التشغيلة" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.key,
    group: { key: (row) => row.warehouseId, label: (row) => row.warehouseName },
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "batchLabel", header: "التشغيلة", format: "text", value: (row) => row.batchLabel },
      { key: "expiryDate", header: "تاريخ الصلاحية", format: "date", value: (row) => row.expiryDate },
      { key: "daysToExpiry", header: "الأيام المتبقية", format: "qty", align: "end", value: (row) => row.daysToExpiry },
      { key: "statusLabel", header: "الحالة", format: "text", value: (row) => row.statusLabel },
      { key: "fefoRank", header: "ترتيب الصرف", format: "qty", align: "end", value: (row) => row.fefoRank },
      { key: "qty", header: "الكمية", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "totalValue", header: "القيمة", format: "money", align: "end", total: true, value: (row) => row.totalValue },
      { key: "receivedOn", header: "أول استلام", format: "date", value: (row) => row.receivedOn },
    ],
    kpis: [
      { key: "batchCount", labelAr: "عدد التشغيلات", format: "qty", value: (rows) => rows.length },
      { key: "totalValue", labelAr: "القيمة", format: "money", value: (rows) => sumRows(rows, (r) => r.totalValue) },
      {
        key: "expiredValue",
        labelAr: "قيمة المنتهية",
        format: "money",
        value: (rows) => sumRows(rows, (r) => (r.status === ExpiryStatus.Expired ? r.totalValue : 0)),
        tone: (value) => (value > 0 ? "danger" : "success"),
      },
      {
        key: "nearValue",
        labelAr: "قيمة القريبة من الانتهاء",
        format: "money",
        value: (rows) => sumRows(rows, (r) => (r.status === ExpiryStatus.NearExpiry ? r.totalValue : 0)),
      },
    ],
    run: (params, ctx) => {
      const itemById = new Map(ctx.items.map((i) => [i.id, i]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      const branchOf = branchOfWarehouse(ctx.warehouses);
      const tracked = new Set(ctx.items.filter((i) => i.trackBatches || i.trackExpiry).map((i) => i.id));
      const search = params.search.trim().toLowerCase();
      const rows: InventoryBatchesRow[] = [];
      for (const r of summarizeBatchStock(ctx.layers, { today, nearExpiryDays, trackedItemIds: tracked })) {
        if (params.warehouseId !== "" && r.warehouseId !== params.warehouseId) continue;
        if (params.itemId !== "" && r.itemId !== params.itemId) continue;
        if (params.status !== "" && r.status !== params.status) continue;
        if (!matchesBranch(branchOf(r.warehouseId), params.branchId)) continue;
        const item = itemById.get(r.itemId);
        const itemNameAr = item?.nameAr ?? r.itemId;
        const itemCode = item?.code ?? "";
        if (search && !`${itemNameAr} ${itemCode} ${r.batchNo ?? ""}`.toLowerCase().includes(search)) continue;
        rows.push({
          key: r.key,
          itemId: r.itemId,
          itemCode,
          itemNameAr,
          itemNameEn: item?.nameEn ?? null,
          warehouseId: r.warehouseId,
          warehouseName: warehouseNames.get(r.warehouseId) ?? r.warehouseId,
          batchNo: r.batchNo,
          batchLabel: r.batchNo ?? NO_BATCH_LABEL_AR,
          expiryDate: r.expiryDate,
          daysToExpiry: r.daysToExpiry,
          status: r.status,
          statusLabel: EXPIRY_STATUS_LABEL_AR[r.status],
          fefoRank: r.fefoRank,
          qty: Number(r.qty.toString()),
          qtyExact: r.qty.toString(),
          totalValue: Number(r.value.toString()),
          valueExact: r.value.toString(),
          receivedOn: r.firstReceivedOn,
        });
      }
      return rows;
    },
  };
}
