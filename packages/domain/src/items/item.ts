import type { Money } from "../money/index.js";

/**
 * Items — inventory master data (docs/catalog/03-inventory.md "الأصناف").
 * An `Item` is either a stock item (تتبع المخزون — carries a quantity
 * balance tracked/costed through warehouses) or a service item (لا يتتبع
 * مخزون — sold without a quantity balance). Phase 1 ships the master-data
 * record only: stock balances/movements/cost layers wire in once Phase 2
 * lands the movements ledger (docs' phased backlog) — see the API's
 * `stockStubbed` marker on the item-detail response.
 */

export type ItemType = "stock" | "service";
export type CostingMethod = "WAC" | "FIFO";
export type ItemStatus = "active" | "inactive";
/** Egyptian e-invoice (ETA) code classification (docs/catalog/03 "تصنيف الفاتورة الإلكترونية"). */
export type EtaCodeType = "EGS" | "GPC";

/**
 * An alternate unit of measure, defined relative to the item's base unit
 * (docs/catalog/03 "وحدات القياس", e.g. "لفة = 12 متر"). `factor` base units
 * make up one of this unit.
 */
export interface AlternateUnit {
  readonly code: string;
  readonly name: string;
  /** 1 of this unit = `factor` base units. Must be a positive, finite number. */
  readonly factor: number;
}

export interface Item {
  readonly id: string;
  /** Unique, auto-generated at creation and immutable afterward (catalog: "disabled on edit"). */
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly type: ItemType;
  readonly baseUnitCode: string;
  readonly alternateUnits: readonly AlternateUnit[];
  readonly barcodes: readonly string[];
  readonly categoryId: string | null;
  readonly brand: string | null;
  readonly costingMethod: CostingMethod;
  readonly salePrice: Money | null;
  /** Becomes system-derived once stock movements exist (Phase 2) — editable here in Phase 1. */
  readonly costPrice: Money | null;
  readonly taxRatePercent: number;
  readonly trackInventory: boolean;
  readonly trackBatches: boolean;
  readonly trackExpiry: boolean;
  readonly reorderPoint: number | null;
  readonly reorderQty: number | null;
  /** GL mapping overrides (docs/catalog/03 "الحسابات") — null means "use the system default for this item type". */
  readonly revenueAccountId: string | null;
  readonly cogsAccountId: string | null;
  readonly inventoryAccountId: string | null;
  readonly etaCodeType: EtaCodeType | null;
  readonly etaItemCode: string | null;
  readonly gpcCode: string | null;
  readonly status: ItemStatus;
}

/**
 * Persistence port for Items. The domain depends on this interface only
 * (docs/plan.md §2.2) — no SQL, no driver.
 */
export interface ItemRepository {
  findById(id: string): Promise<Item | null>;
  findByCode(code: string): Promise<Item | null>;
  /** All items, flat (no ordering guarantee — callers sort/paginate as needed). */
  list(): Promise<Item[]>;
  create(item: Item): Promise<void>;
  /** Full replace of an existing item row. */
  update(item: Item): Promise<void>;
}
