import { Qty } from "../money/index.js";
import type { WacSnapshot } from "../inventory/ports.js";
import { itemTypeIsPurchasable, itemTypeTracksStock } from "../items/item-type.js";
import { ItemStatusCode, type Item } from "../items/item.js";
import type { Warehouse, WarehouseType } from "../settings/warehouse.js";
import { dailyVelocity, daysOfCover, reorderPosition, suggestedOrderQty } from "./calc.js";
import {
  ReorderProblem,
  ReorderRuleSource,
  ReorderTrigger,
  type ItemWarehousePolicy,
  type ReorderRow,
} from "./types.js";

const ONE_UNIT = Qty.fromScaled(1_000_000n);
const MAIN_WAREHOUSE_TYPE: WarehouseType = "MAIN";

export interface OnOrderQty {
  readonly open: Qty;
  readonly draft: Qty;
}

export interface ReorderWorklistInput {
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
  readonly policies: readonly ItemWarehousePolicy[];
  readonly snapshots: readonly WacSnapshot[];
  readonly reserved: (itemId: string, warehouseId: string) => Qty;
  readonly onOrder: (itemId: string, warehouseId: string) => OnOrderQty;
  readonly sold: (itemId: string, warehouseId: string) => Qty;
  readonly windowDays: number;
}

interface Rule {
  readonly source: ReorderRuleSource;
  readonly minQty: Qty;
  readonly maxQty: Qty | null;
  readonly leadDays: number;
  readonly packQty: Qty;
  readonly supplierId: string | null;
}

export { MAIN_WAREHOUSE_TYPE };

export function qtyFromNumber(value: number): Qty {
  return Qty.fromMajor(value.toFixed(6));
}

export function itemDefaultRule(item: Item): Rule | null {
  if (item.reorderPoint === null || !Number.isFinite(item.reorderPoint) || item.reorderPoint <= 0) return null;
  const minQty = qtyFromNumber(item.reorderPoint);
  const orderQty = item.reorderQty !== null && Number.isFinite(item.reorderQty) && item.reorderQty > 0 ? qtyFromNumber(item.reorderQty) : null;
  return {
    source: ReorderRuleSource.ItemDefault,
    minQty,
    maxQty: orderQty ? minQty.add(orderQty) : null,
    leadDays: 0,
    packQty: ONE_UNIT,
    supplierId: item.defaultSupplierId,
  };
}

function policyRule(policy: ItemWarehousePolicy, item: Item): Rule {
  return {
    source: ReorderRuleSource.Policy,
    minQty: policy.minQty,
    maxQty: policy.maxQty,
    leadDays: policy.leadDays,
    packQty: policy.packQty,
    supplierId: policy.supplierId ?? item.defaultSupplierId,
  };
}

function isOrderable(item: Item): boolean {
  return itemTypeTracksStock(item.type) && itemTypeIsPurchasable(item.type) && item.trackInventory && item.status !== ItemStatusCode.Inactive;
}

function fallbackWarehouseIds(item: Item, warehouses: readonly Warehouse[], snapshots: readonly WacSnapshot[]): string[] {
  const stocking = new Set(snapshots.filter((s) => s.itemId === item.id).map((s) => s.warehouseId));
  const main = warehouses.filter((w) => w.active && w.type === MAIN_WAREHOUSE_TYPE);
  const holding = main.filter((w) => stocking.has(w.id));
  if (holding.length > 0) return holding.map((w) => w.id);
  const home = main.find((w) => w.isDefault) ?? main[0];
  return home ? [home.id] : [];
}

function buildRow(
  input: ReorderWorklistInput,
  item: Item,
  warehouseId: string,
  rule: Rule,
  snapshotOnHand: Qty,
): ReorderRow | null {
  const reserved = input.reserved(item.id, warehouseId);
  const orders = input.onOrder(item.id, warehouseId);
  const onOrder = orders.open.add(orders.draft);
  const position = reorderPosition(snapshotOnHand, onOrder, reserved);
  const sold = input.sold(item.id, warehouseId);
  const cover = daysOfCover(snapshotOnHand, reserved, sold, input.windowDays);
  const belowMinimum = position.compare(rule.minQty) <= 0;
  const coverShort = !belowMinimum && cover !== null && rule.leadDays > 0 && cover < rule.leadDays;
  if (!belowMinimum && !coverShort) return null;
  const problems: ReorderProblem[] = [];
  let suggestedQty = Qty.zero();
  if (rule.maxQty === null) problems.push(ReorderProblem.NoOrderQty);
  else {
    suggestedQty = suggestedOrderQty(rule.maxQty, position, rule.packQty);
    if (suggestedQty.scaled <= 0n) return null;
  }
  if (rule.supplierId === null) problems.push(ReorderProblem.NoSupplier);
  return {
    itemId: item.id,
    warehouseId,
    source: rule.source,
    trigger: belowMinimum ? ReorderTrigger.BelowMinimum : ReorderTrigger.CoverBelowLeadTime,
    minQty: rule.minQty,
    maxQty: rule.maxQty,
    leadDays: rule.leadDays,
    packQty: rule.packQty,
    onHand: snapshotOnHand,
    reserved,
    onOrder: orders.open,
    onOrderDraft: orders.draft,
    position,
    soldInWindow: sold,
    dailyVelocity: dailyVelocity(sold, input.windowDays),
    daysOfCover: cover,
    suggestedQty,
    supplierId: rule.supplierId,
    problems,
  };
}

function coverRank(row: ReorderRow): number {
  return row.daysOfCover ?? Number.POSITIVE_INFINITY;
}

export function buildReorderWorklist(input: ReorderWorklistInput): ReorderRow[] {
  const warehouseIds = new Set(input.warehouses.filter((w) => w.active).map((w) => w.id));
  const onHandOf = new Map(input.snapshots.map((s) => [`${s.itemId}\u0000${s.warehouseId}`, s.onHand]));
  const policied = new Set(input.policies.map((p) => `${p.itemId}\u0000${p.warehouseId}`));
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const rows: ReorderRow[] = [];

  for (const policy of input.policies) {
    const item = itemsById.get(policy.itemId);
    if (!item || !isOrderable(item) || !warehouseIds.has(policy.warehouseId)) continue;
    const row = buildRow(input, item, policy.warehouseId, policyRule(policy, item), onHandOf.get(`${item.id}\u0000${policy.warehouseId}`) ?? Qty.zero());
    if (row) rows.push(row);
  }

  for (const item of input.items) {
    if (!isOrderable(item)) continue;
    const rule = itemDefaultRule(item);
    if (!rule) continue;
    for (const warehouseId of fallbackWarehouseIds(item, input.warehouses, input.snapshots)) {
      if (policied.has(`${item.id}\u0000${warehouseId}`)) continue;
      const row = buildRow(input, item, warehouseId, rule, onHandOf.get(`${item.id}\u0000${warehouseId}`) ?? Qty.zero());
      if (row) rows.push(row);
    }
  }

  return rows.sort((a, b) => {
    const byCover = coverRank(a) - coverRank(b);
    if (byCover !== 0 && !Number.isNaN(byCover)) return byCover;
    const byPosition = a.position.compare(b.position);
    if (byPosition !== 0) return byPosition;
    return `${a.itemId}${a.warehouseId}`.localeCompare(`${b.itemId}${b.warehouseId}`);
  });
}

export function resolveLowStockThreshold(policy: ItemWarehousePolicy | null, item: Pick<Item, "reorderPoint">): Qty | null {
  if (policy) return policy.minQty;
  if (item.reorderPoint === null || !Number.isFinite(item.reorderPoint) || item.reorderPoint <= 0) return null;
  return qtyFromNumber(item.reorderPoint);
}
