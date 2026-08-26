import { z } from "zod";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { CostLayer } from "../inventory/cost-layer.js";
import { layerRemainingValue } from "../inventory/cost-layer.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * أصناف قاربت على الانتهاء — Expiring Soon / FEFO (docs/catalog/08-reports.md):
 * every surviving cost layer that carries an expiry date, earliest first —
 * the SAME order `orderLayersForConsumption` issues them in, so the report is
 * a literal read of what the next goods issue will take. Layers with no expiry
 * (the non-perishable majority) are not stock this report has anything to say
 * about and never appear.
 */

export type ExpiryWindow = "expired" | "within30" | "within60" | "within90";

const WINDOW_LABELS: Record<ExpiryWindow, string> = {
  expired: "منتهي الصلاحية",
  within30: "خلال 30 يوم",
  within60: "خلال 60 يوم",
  within90: "خلال 90 يوم",
};

const WINDOW_DAYS: Record<ExpiryWindow, number> = {
  expired: 0,
  within30: 30,
  within60: 60,
  within90: 90,
};

function statusLabel(daysToExpiry: number): string {
  if (daysToExpiry < 0) return WINDOW_LABELS.expired;
  if (daysToExpiry <= 30) return WINDOW_LABELS.within30;
  if (daysToExpiry <= 60) return WINDOW_LABELS.within60;
  if (daysToExpiry <= 90) return WINDOW_LABELS.within90;
  return "أكثر من 90 يوم";
}

export interface InventoryExpiringContext {
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
  readonly layers: readonly CostLayer[];
}

export interface InventoryExpiringParams {
  readonly window: "" | ExpiryWindow;
  readonly search: string;
  readonly warehouseId: string;
}

export interface InventoryExpiringRow {
  readonly key: string;
  readonly itemNameAr: string;
  readonly warehouseName: string;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly daysToExpiry: number;
  readonly statusLabel: string;
  readonly qty: number;
  readonly totalValue: number;
  readonly receivedOn: string;
  readonly sourceDocNumber: string;
}

const paramsSchema = z.object({
  window: z.enum(["", "expired", "within30", "within60", "within90"]),
  search: z.string(),
  warehouseId: z.string(),
});

export function createInventoryExpiringReport(today: string): ReportDefinition<
  InventoryExpiringParams,
  InventoryExpiringRow,
  InventoryExpiringContext
> {
  return {
    id: "inventory.expiring",
    titleAr: "أصناف قاربت على الانتهاء",
    descriptionAr:
      "الدفعات التي لها تاريخ صلاحية مرتبة بالأقرب انتهاءً — وهو نفس ترتيب الصرف (FEFO) الذي يتبعه المخزون.",
    paramsSchema,
    defaultParams: { window: "", search: "", warehouseId: "" },
    paramFields: [
      {
        kind: "select",
        key: "window",
        label: "فترة الاستحقاق",
        options: [
          { value: "", label: "الكل" },
          { value: "expired", label: WINDOW_LABELS.expired },
          { value: "within30", label: WINDOW_LABELS.within30 },
          { value: "within60", label: WINDOW_LABELS.within60 },
          { value: "within90", label: WINDOW_LABELS.within90 },
        ],
      },
      { kind: "text", key: "search", label: "بحث", placeholder: "اسم الصنف أو رقم الدفعة" },
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
    ],
    rowKey: (row) => row.key,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "batchNo", header: "رقم الدفعة", format: "text", value: (row) => row.batchNo },
      { key: "warehouseName", header: "المستودع", format: "text", value: (row) => row.warehouseName },
      { key: "expiryDate", header: "تاريخ الانتهاء", format: "date", value: (row) => row.expiryDate },
      { key: "daysToExpiry", header: "الأيام المتبقية", format: "qty", align: "end", value: (row) => row.daysToExpiry },
      { key: "statusLabel", header: "الحالة", format: "text", value: (row) => row.statusLabel },
      { key: "qty", header: "الكمية المتاحة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "totalValue", header: "القيمة", format: "money", align: "end", total: true, value: (row) => row.totalValue },
      { key: "receivedOn", header: "تاريخ الاستلام", format: "date", value: (row) => row.receivedOn },
      { key: "sourceDocNumber", header: "مستند الاستلام", format: "text", value: (row) => row.sourceDocNumber },
    ],
    kpis: [
      { key: "totalValue", labelAr: "القيمة المعرضة", format: "money", value: (rows) => sumRows(rows, (r) => r.totalValue) },
      { key: "expiredValue", labelAr: "قيمة المنتهية", format: "money", value: (rows) => sumRows(rows, (r) => (r.daysToExpiry < 0 ? r.totalValue : 0)), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "within30Value", labelAr: "تنتهي خلال 30 يوم", format: "money", value: (rows) => sumRows(rows, (r) => (r.daysToExpiry >= 0 && r.daysToExpiry <= 30 ? r.totalValue : 0)) },
      { key: "batchCount", labelAr: "عدد الدفعات", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      labelColumn: "statusLabel",
      valueColumn: "totalValue",
      aggregate: true,
      maxPoints: 4,
      captionAr: "القيمة الموزعة على نوافذ الانتهاء — المنتهي أولاً، وهو نفس ترتيب الصرف.",
    },
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      const search = params.search.trim().toLowerCase();
      const todayMs = Date.parse(`${today}T00:00:00Z`);

      const rows: InventoryExpiringRow[] = [];
      for (const layer of ctx.layers) {
        const expiryDate = layer.expiryDate ?? null;
        if (expiryDate === null) continue;
        if (layer.remainingQty.scaled <= 0n) continue;
        if (params.warehouseId !== "" && layer.warehouseId !== params.warehouseId) continue;

        const itemNameAr = itemNames.get(layer.itemId) ?? layer.itemId;
        const batchNo = layer.batchNo ?? "";
        if (search && !`${itemNameAr} ${batchNo}`.toLowerCase().includes(search)) continue;

        const daysToExpiry = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - todayMs) / 86_400_000);
        if (params.window === "expired" && daysToExpiry >= 0) continue;
        if (params.window !== "" && params.window !== "expired") {
          if (daysToExpiry < 0 || daysToExpiry > WINDOW_DAYS[params.window]) continue;
        }

        rows.push({
          key: layer.id,
          itemNameAr,
          warehouseName: warehouseNames.get(layer.warehouseId) ?? layer.warehouseId,
          batchNo,
          expiryDate,
          daysToExpiry,
          statusLabel: statusLabel(daysToExpiry),
          qty: Number(layer.remainingQty.toString()),
          totalValue: Number(layerRemainingValue(layer).toString()),
          receivedOn: layer.createdAt.slice(0, 10),
          sourceDocNumber: layer.sourceDocNumber ?? layer.sourceDocId,
        });
      }

      return rows.sort((a, b) =>
        a.expiryDate === b.expiryDate ? a.receivedOn.localeCompare(b.receivedOn) : a.expiryDate.localeCompare(b.expiryDate),
      );
    },
  };
}
