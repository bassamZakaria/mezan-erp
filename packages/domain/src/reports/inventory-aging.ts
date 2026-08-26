import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { CostLayer } from "../inventory/cost-layer.js";
import { layerRemainingValue } from "../inventory/cost-layer.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, maxOf, percentOf } from "./kpi.js";

/**
 * أعمار المخزون — Inventory Aging (docs/catalog/08-reports.md): the age of
 * the OLDEST surviving unit of each item/warehouse position, from the
 * immutable cost layers (FIFO receipt order) — the same layers the WAC engine
 * draws down on issue (packages/domain/src/inventory/wac.ts). Stock older
 * than 180 days is flagged for review.
 */

export type AgeBucket = "under30" | "30to90" | "90to180" | "180to365" | "over365";

const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  under30: "أقل من 30 يوم",
  "30to90": "30-90 يوم",
  "90to180": "90-180 يوم",
  "180to365": "180-365 يوم",
  over365: "أكثر من 365 يوم",
};

function bucketOf(ageDays: number): AgeBucket {
  if (ageDays < 30) return "under30";
  if (ageDays < 90) return "30to90";
  if (ageDays < 180) return "90to180";
  if (ageDays < 365) return "180to365";
  return "over365";
}

export interface InventoryAgingContext {
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
  readonly layers: readonly CostLayer[];
}

export interface InventoryAgingParams {
  readonly bucket: "" | AgeBucket;
  readonly search: string;
  readonly warehouseId: string;
}

export interface InventoryAgingRow {
  readonly key: string;
  readonly itemNameAr: string;
  readonly warehouseName: string;
  readonly qty: number;
  readonly totalValue: number;
  readonly ageDays: number;
  readonly ageBucketLabel: string;
  readonly lastReceiptDate: string;
}

const paramsSchema = z.object({
  bucket: z.enum(["", "under30", "30to90", "90to180", "180to365", "over365"]),
  search: z.string(),
  warehouseId: z.string(),
});

export function createInventoryAgingReport(today: string): ReportDefinition<
  InventoryAgingParams,
  InventoryAgingRow,
  InventoryAgingContext
> {
  return {
    id: "inventory.aging",
    titleAr: "أعمار المخزون",
    descriptionAr: "عمر أقدم وحدة من كل صنف في كل مستودع — البضاعة الأقدم من 180 يوم تستحق المراجعة.",
    paramsSchema,
    defaultParams: { bucket: "", search: "", warehouseId: "" },
    paramFields: [
      {
        kind: "select",
        key: "bucket",
        label: "الشريحة العمرية",
        options: [
          { value: "", label: "الكل" },
          { value: "under30", label: AGE_BUCKET_LABELS.under30 },
          { value: "30to90", label: AGE_BUCKET_LABELS["30to90"] },
          { value: "90to180", label: AGE_BUCKET_LABELS["90to180"] },
          { value: "180to365", label: AGE_BUCKET_LABELS["180to365"] },
          { value: "over365", label: AGE_BUCKET_LABELS.over365 },
        ],
      },
      { kind: "text", key: "search", label: "بحث", placeholder: "اسم الصنف أو الكود" },
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
    ],
    rowKey: (row) => row.key,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "warehouseName", header: "المستودع", format: "text", value: (row) => row.warehouseName },
      { key: "qty", header: "الكمية المتاحة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "totalValue", header: "إجمالي القيمة", format: "money", align: "end", total: true, value: (row) => row.totalValue },
      { key: "ageDays", header: "العمر (يوم)", format: "qty", align: "end", value: (row) => row.ageDays },
      { key: "ageBucketLabel", header: "الشريحة العمرية", format: "text", value: (row) => row.ageBucketLabel },
      { key: "lastReceiptDate", header: "آخر استلام", format: "date", value: (row) => row.lastReceiptDate },
    ],
    kpis: [
      { key: "totalValue", labelAr: "إجمالي القيمة", format: "money", value: (rows) => sumRows(rows, (r) => r.totalValue) },
      { key: "over180Value", labelAr: "قيمة أقدم من 180 يوم", format: "money", value: (rows) => sumRows(rows, (r) => (r.ageDays > 180 ? r.totalValue : 0)), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "over180Percent", labelAr: "نسبة الراكد", format: "percent", value: (rows) => percentOf(sumRows(rows, (r) => (r.ageDays > 180 ? r.totalValue : 0)), sumRows(rows, (r) => r.totalValue)) },
      { key: "oldestAgeDays", labelAr: "أقدم عمر (يوم)", format: "qty", value: (rows) => maxOf(rows, (r) => r.ageDays) },
    ],
    chart: {
      labelColumn: "ageBucketLabel",
      valueColumn: "totalValue",
      aggregate: true,
      maxPoints: 5,
      captionAr: "قيمة المخزون موزعة على الشرائح العمرية — كل عمود هو مجموع صفوف تلك الشريحة.",
    },
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      const search = params.search.trim().toLowerCase();
      const todayMs = Date.parse(`${today}T00:00:00Z`);

      const byPosition = new Map<string, CostLayer[]>();
      for (const layer of ctx.layers) {
        if (layer.remainingQty.scaled <= 0n) continue;
        if (params.warehouseId !== "" && layer.warehouseId !== params.warehouseId) continue;
        const key = `${layer.itemId}|${layer.warehouseId}`;
        const existing = byPosition.get(key) ?? [];
        existing.push(layer);
        byPosition.set(key, existing);
      }

      const rows: InventoryAgingRow[] = [];
      for (const [key, layers] of byPosition) {
        const [itemId, warehouseId] = key.split("|") as [string, string];
        const itemNameAr = itemNames.get(itemId) ?? itemId;
        if (search && !itemNameAr.toLowerCase().includes(search)) continue;
        const oldest = layers.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        const ageDays = Math.max(0, Math.round((todayMs - Date.parse(oldest.createdAt)) / 86_400_000));
        const bucket = bucketOf(ageDays);
        if (params.bucket !== "" && bucket !== params.bucket) continue;
        const latestReceipt = layers.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
        rows.push({
          key,
          itemNameAr,
          warehouseName: warehouseNames.get(warehouseId) ?? warehouseId,
          qty: Number(Qty.sum(layers.map((l) => l.remainingQty)).toString()),
          totalValue: Number(Money.sum(layers.map(layerRemainingValue)).toString()),
          ageDays,
          ageBucketLabel: AGE_BUCKET_LABELS[bucket],
          lastReceiptDate: latestReceipt.createdAt.slice(0, 10),
        });
      }
      return rows.sort((a, b) => b.ageDays - a.ageDays);
    },
  };
}
