import type { Money } from "../money/index.js";
import type { ItemType } from "./item-type.js";

export type { ItemType };

/**
 * Items — inventory master data (docs/archive/catalog/03-inventory.md "الأصناف").
 * An `Item` is either a stock item (تتبع المخزون — carries a quantity
 * balance tracked/costed through warehouses) or a service item (لا يتتبع
 * مخزون — sold without a quantity balance). Phase 1 ships the master-data
 * record; stock balances/movements/cost layers live in the movements ledger
 * and reach the item-detail response as its `stock` block.
 */

export type CostingMethod = "WAC" | "FIFO";
export enum ItemStatusCode {
  Active = "active",
  Inactive = "inactive",
  PendingPricing = "pending_pricing",
}
export type ItemStatus = `${ItemStatusCode}`;
/** Egyptian e-invoice (ETA) code classification (docs/archive/catalog/03 "تصنيف الفاتورة الإلكترونية"). */
export type EtaCodeType = "EGS" | "GPC";

/**
 * An alternate unit of measure, defined relative to the item's base unit
 * (docs/archive/catalog/03 "وحدات القياس", e.g. "لفة = 12 متر"). `factor` base units
 * make up one of this unit.
 */
export interface AlternateUnit {
  readonly code: string;
  readonly name: string;
  /** 1 of this unit = `factor` base units. Must be a positive, finite number. */
  readonly factor: number;
}

/**
 * One specification value on an item. `code` points at an `ItemSpecification`;
 * `value` is checked against that specification's allowed values when it is a
 * `select`.
 */
export interface ItemSpecificationValue {
  readonly code: string;
  readonly value: string;
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
  /**
   * The brand this item carries, by id (R5.10). Replaces the free-text `brand`
   * that let "Nestle", "نستله" and "nestle " become three brands nobody could
   * filter by.
   */
  readonly brandId: string | null;
  /** Free description shown on the item card and printed documents (R5.4). */
  readonly description: string | null;
  /**
   * The supplier this item is normally bought from (R5.4) — a supplier id, so
   * a purchase can default to it and a reorder can name someone real.
   */
  readonly defaultSupplierId: string | null;
  readonly seasonId: string | null;
  /** Values against the tenant's specification registry — the catalog facets. */
  readonly specifications: readonly ItemSpecificationValue[];
  readonly costingMethod: CostingMethod;
  readonly salePrice: Money | null;
  /**
   * The cost a person enters on the item card. It is NOT the item's moving
   * average: that is derived from the stock ledger. This is the unit cost used
   * where the ledger holds none — an issue out of a position that was never
   * received, and a manufactured component with no stock history.
   */
  readonly costPrice: Money | null;
  readonly taxRatePercent: number;
  readonly trackInventory: boolean;
  readonly trackBatches: boolean;
  readonly trackExpiry: boolean;
  readonly reorderPoint: number | null;
  /**
   * The item's picture, held as an attachment id rather than as bytes on the
   * item — the file lives in the attachments resource, which already owns
   * storage, permissions and deletion.
   */
  readonly imageAttachmentId: string | null;
  readonly reorderQty: number | null;
  /** GL mapping overrides (docs/archive/catalog/03 "الحسابات") — null means "use the system default for this item type". */
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
 * (docs/archive/plan.md §2.2) — no SQL, no driver.
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
