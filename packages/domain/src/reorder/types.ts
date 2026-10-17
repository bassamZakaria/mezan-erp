import type { Qty } from "../money/index.js";

export enum ReorderRuleSource {
  Policy = "policy",
  ItemDefault = "item_default",
}

export enum ReorderTrigger {
  BelowMinimum = "below_minimum",
  CoverBelowLeadTime = "cover_below_lead_time",
}

export enum ReorderProblem {
  NoOrderQty = "no_order_qty",
  NoSupplier = "no_supplier",
}

export const REORDER_LEAD_DAYS_MAX = 365;
export const REORDER_WINDOW_DAYS_DEFAULT = 30;
export const REORDER_WINDOW_DAYS_MIN = 7;
export const REORDER_WINDOW_DAYS_MAX = 365;

export interface ItemWarehousePolicy {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly minQty: Qty;
  readonly maxQty: Qty;
  readonly leadDays: number;
  readonly packQty: Qty;
  readonly supplierId: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface ItemWarehousePolicyRepository {
  get(itemId: string, warehouseId: string): Promise<ItemWarehousePolicy | null>;
  list(): Promise<readonly ItemWarehousePolicy[]>;
  save(policy: ItemWarehousePolicy): Promise<void>;
  remove(itemId: string, warehouseId: string): Promise<void>;
}

export interface ReorderRow {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly source: ReorderRuleSource;
  readonly trigger: ReorderTrigger;
  readonly minQty: Qty;
  readonly maxQty: Qty | null;
  readonly leadDays: number;
  readonly packQty: Qty;
  readonly onHand: Qty;
  readonly reserved: Qty;
  readonly onOrder: Qty;
  readonly onOrderDraft: Qty;
  readonly position: Qty;
  readonly soldInWindow: Qty;
  readonly dailyVelocity: Qty;
  readonly daysOfCover: number | null;
  readonly suggestedQty: Qty;
  readonly supplierId: string | null;
  readonly problems: readonly ReorderProblem[];
}

export interface ReorderOrderLine {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly supplierId: string | null;
  readonly qty: Qty;
}

export interface ReorderOrderGroup {
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly lines: readonly ReorderOrderLine[];
}
