import { Money, Qty, type AdjustmentReason, type FiscalPeriod, type StockAdjustmentDocLine, type StockMovementDirection, type StockTransferDocLine } from "@mezan/domain";
import type { SeedAdjustmentCommand, SeedTransferCommand } from "./store/inventory-ops-store";

/** Open fiscal period (أغسطس 2026) the inventory-ops demo posts into. */
export const demoOpenPeriod: FiscalPeriod = {
  id: "fp-2026-08",
  year: 2026,
  periodNumber: 8,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  status: "open",
};

/**
 * Stock Adjustments / Transfers demo data (docs/catalog/03-inventory.md
 * §"تسويات المخزون" / §"تحويلات المخزون") for the Cyag tenant, replayed
 * through the REAL engine by `createInventoryOpsStore` (see its seeding
 * comment) — so on-hand qty, weighted-average cost and the opening-balance GL
 * entry are all internally consistent, not hand-typed numbers.
 *
 * Items reuse real ids from `items-sample-data.ts` (itm-1 أرز, itm-2 زيت,
 * itm-8 سكر); warehouses reuse `sample-data.ts`'s `demoWarehouses`
 * (MAIN-WH, VAN-1).
 *
 * Physical Counts are seeded EMPTY on purpose — the catalog recon found the
 * demo tenant has zero existing counts ("لا توجد عمليات جرد"); the screen is
 * still fully interactive (a new count can be started against the seeded
 * balances below).
 */

function adjLine(
  itemId: string,
  warehouseId: string,
  reason: AdjustmentReason,
  direction: StockMovementDirection,
  qty: string,
  unitCost?: string,
): StockAdjustmentDocLine {
  return {
    itemId,
    warehouseId,
    reason,
    direction,
    qty: Qty.fromMajor(qty),
    unitCost: unitCost !== undefined ? Money.fromMajor(unitCost) : undefined,
  };
}

function trfLine(itemId: string, fromWarehouseId: string, toWarehouseId: string, qty: string): StockTransferDocLine {
  return { itemId, fromWarehouseId, toWarehouseId, qty: Qty.fromMajor(qty) };
}

export const demoAdjustmentSeeds: SeedAdjustmentCommand[] = [
  {
    id: "adj-seed-1",
    date: "2026-08-01",
    memo: "تسجيل الرصيد الافتتاحي لصنف الأرز",
    lines: [adjLine("itm-1", "MAIN-WH", "INITIAL_STOCK", "IN", "100", "5000")],
  },
  {
    id: "adj-seed-2",
    date: "2026-08-02",
    memo: "تسجيل الرصيد الافتتاحي لصنف الزيت",
    lines: [adjLine("itm-2", "MAIN-WH", "INITIAL_STOCK", "IN", "200", "45")],
  },
  {
    id: "adj-seed-3",
    date: "2026-08-03",
    memo: "تسجيل الرصيد الافتتاحي لصنف السكر",
    lines: [adjLine("itm-8", "MAIN-WH", "INITIAL_STOCK", "IN", "150", "30")],
  },
  {
    id: "adj-seed-4",
    date: "2026-08-10",
    memo: "تلف عبوات زيت أثناء النقل الداخلي",
    lines: [adjLine("itm-2", "MAIN-WH", "DAMAGE", "OUT", "5")],
  },
  {
    id: "adj-seed-5",
    date: "2026-08-15",
    memo: "تصحيح جرد — نقص في رصيد السكر",
    lines: [adjLine("itm-8", "MAIN-WH", "PHYSICAL_COUNT", "OUT", "3")],
  },
];

export const demoTransferSeeds: SeedTransferCommand[] = [
  {
    id: "trf-seed-1",
    date: "2026-08-12",
    memo: "تحميل السيارة برحلة بيع ميداني",
    lines: [trfLine("itm-1", "MAIN-WH", "VAN-1", "10")],
  },
  {
    id: "trf-seed-2",
    date: "2026-08-12",
    memo: "تحميل السيارة برحلة بيع ميداني",
    lines: [trfLine("itm-2", "MAIN-WH", "VAN-1", "20")],
  },
];
