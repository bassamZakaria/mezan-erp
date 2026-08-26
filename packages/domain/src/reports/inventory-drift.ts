import { z } from "zod";
import { checkDrift } from "../inventory/wac.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { StockMovement } from "../inventory/movement.js";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countRows, maxOf } from "./kpi.js";

/**
 * انحراف تقييم المخزون — Inventory Valuation Drift (docs/catalog/08-reports.md):
 * a data-integrity report reconciling the three independent costing sources —
 * the cached WAC snapshot, the ledger replayed from scratch, and the
 * immutable cost layers — using the engine's own `checkDrift`
 * (packages/domain/src/inventory/wac.ts). Only positions that actually
 * mismatch appear (docs' own empty-state copy: "جميع الأصناف متطابقة").
 */

export type DriftType = "value" | "qty" | "both";

const DRIFT_TYPE_LABELS: Record<DriftType, string> = {
  value: "فارق قيمة فقط",
  qty: "فارق كمية فقط",
  both: "فارق قيمة وكمية",
};

export interface InventoryDriftContext {
  readonly snapshots: readonly WacSnapshot[];
  readonly movements: readonly StockMovement[];
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
}

export interface InventoryDriftParams {
  readonly type: "" | "value" | "qty";
}

export interface InventoryDriftRow {
  readonly key: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly warehouseName: string;
  readonly onHand: number;
  readonly recomputedAverageCost: number;
  readonly cachedAverageCost: number;
  readonly valueDiff: number;
  readonly maxPctDrift: number;
  readonly typeLabel: string;
}

const paramsSchema = z.object({ type: z.enum(["", "value", "qty"]) });

export function createInventoryDriftReport(): ReportDefinition<
  InventoryDriftParams,
  InventoryDriftRow,
  InventoryDriftContext
> {
  return {
    id: "inventory.drift",
    titleAr: "انحراف تقييم المخزون",
    descriptionAr: "الأصناف التي اختلفت فيها مصادر تقييم التكلفة الثلاثة (المتوسط المحسوب، الكاش، طبقات التكلفة).",
    paramsSchema,
    defaultParams: { type: "" },
    paramFields: [
      {
        kind: "select",
        key: "type",
        label: "النوع",
        options: [
          { value: "", label: "الكل" },
          { value: "value", label: "فارق قيمة فقط" },
          { value: "qty", label: "فارق كمية فقط" },
        ],
      },
    ],
    rowKey: (row) => row.key,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "warehouseName", header: "المستودع", format: "text", value: (row) => row.warehouseName },
      { key: "onHand", header: "كمية المخزون", format: "qty", align: "end", value: (row) => row.onHand },
      { key: "recomputedAverageCost", header: "المتوسط المحسوب", format: "money", align: "end", value: (row) => row.recomputedAverageCost },
      { key: "cachedAverageCost", header: "متوسط الكاش", format: "money", align: "end", value: (row) => row.cachedAverageCost },
      { key: "valueDiff", header: "فارق القيمة", format: "money", align: "end", total: true, value: (row) => row.valueDiff },
      { key: "maxPctDrift", header: "أعلى نسبة انحراف", format: "percent", align: "end", value: (row) => row.maxPctDrift },
      { key: "typeLabel", header: "النوع", format: "text", value: (row) => row.typeLabel },
    ],
    kpis: [
      { key: "valueDiff", labelAr: "إجمالي فارق القيمة", format: "money", value: (rows) => sumRows(rows, (r) => r.valueDiff), tone: (value) => (value === 0 ? "success" : "danger") },
      { key: "positionCount", labelAr: "المواضع المنحرفة", format: "qty", value: (rows) => rows.length, tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "maxPctDrift", labelAr: "أعلى نسبة انحراف", format: "percent", value: (rows) => maxOf(rows, (r) => r.maxPctDrift) },
      { key: "qtyDriftCount", labelAr: "مواضع بفارق كمية", format: "qty", value: (rows) => countRows(rows, (r) => r.typeLabel !== DRIFT_TYPE_LABELS.value) },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "valueDiff",
      maxPoints: 8,
      captionAr: "الأصناف مرتبة حسب فارق القيمة بين مصادر التقييم — كل عمود انحراف يحتاج تفسيراً.",
    },
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const itemNamesEn = new Map(ctx.items.map((i) => [i.id, i.nameEn ?? null]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      const rows: InventoryDriftRow[] = [];

      for (const snapshot of ctx.snapshots) {
        const positionMovements = ctx.movements.filter(
          (m) => m.itemId === snapshot.itemId && m.warehouseId === snapshot.warehouseId,
        );
        // `checkDrift` only reads itemId/warehouseId/averageCost/totalValue off
        // `cached` — `layers` is unused by the function, so an empty array is a
        // safe stand-in for the cheap cached snapshot (no separate cached-layer
        // store exists; the layer comparison below reconciles against the
        // REPLAYED layers, which `checkDrift` computes internally).
        const report = checkDrift({ ...snapshot, layers: [] }, positionMovements);
        const qtyDiffers = report.onHand.compare(snapshot.onHand) !== 0;
        const valueDiffers = !report.withinTolerance;
        if (!qtyDiffers && !valueDiffers) continue;
        if (params.type === "value" && !valueDiffers) continue;
        if (params.type === "qty" && !qtyDiffers) continue;

        const type: DriftType = qtyDiffers && valueDiffers ? "both" : qtyDiffers ? "qty" : "value";
        const recomputedValueMagnitude = report.recomputedValue.scaled < 0n ? -report.recomputedValue.scaled : report.recomputedValue.scaled;
        const driftMagnitude = report.cacheDrift.scaled < 0n ? -report.cacheDrift.scaled : report.cacheDrift.scaled;
        const maxPctDrift = recomputedValueMagnitude > 0n ? (Number(driftMagnitude) / Number(recomputedValueMagnitude)) * 100 : 0;

        rows.push({
          key: `${snapshot.itemId}|${snapshot.warehouseId}`,
          itemNameAr: itemNames.get(snapshot.itemId) ?? snapshot.itemId,
          itemNameEn: itemNamesEn.get(snapshot.itemId) ?? null,
          warehouseName: warehouseNames.get(snapshot.warehouseId) ?? snapshot.warehouseId,
          onHand: Number(report.onHand.toString()),
          recomputedAverageCost: Number(report.recomputedAverageCost.toString()),
          cachedAverageCost: Number(report.cachedAverageCost.toString()),
          valueDiff: Number(report.cacheDrift.toString()),
          maxPctDrift,
          typeLabel: DRIFT_TYPE_LABELS[type],
        });
      }
      return rows.sort((a, b) => b.maxPctDrift - a.maxPctDrift);
    },
  };
}
