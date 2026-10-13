import type { Account } from "../accounts/index.js";
import type { Money } from "../money/index.js";
import { ItemStatusCode, type AlternateUnit, type CostingMethod, type EtaCodeType, type Item, type ItemRepository, type ItemStatus, type ItemType, type ItemSpecificationValue } from "./item.js";
import { InvalidItemError, ItemNotFoundError, ItemPriceRequiredError, ItemStatusNotSettableError } from "./errors.js";
import { collectItemFieldErrors, validateGlAccountRefs } from "./validation.js";

/**
 * Every field but `code` (docs/archive/catalog/03: the item code is auto-generated
 * and disabled on edit — a full replace of any other field is expected via
 * the same form that creates an item).
 */
export interface UpdateItemCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly type?: ItemType;
  readonly baseUnitCode?: string;
  readonly alternateUnits?: readonly AlternateUnit[];
  readonly barcodes?: readonly string[];
  readonly categoryId?: string | null;
  readonly brandId?: string | null;
  readonly description?: string | null;
  readonly defaultSupplierId?: string | null;
  readonly seasonId?: string | null;
  readonly specifications?: readonly ItemSpecificationValue[];
  readonly costingMethod?: CostingMethod;
  readonly salePrice?: Money | null;
  readonly costPrice?: Money | null;
  readonly taxRatePercent?: number;
  readonly trackInventory?: boolean;
  readonly trackBatches?: boolean;
  readonly trackExpiry?: boolean;
  readonly reorderPoint?: number | null;
  readonly imageAttachmentId?: string | null;
  readonly reorderQty?: number | null;
  readonly revenueAccountId?: string | null;
  readonly cogsAccountId?: string | null;
  readonly inventoryAccountId?: string | null;
  readonly etaCodeType?: EtaCodeType | null;
  readonly etaItemCode?: string | null;
  readonly gpcCode?: string | null;
  readonly status?: ItemStatus;
}

/**
 * Edits an existing item (docs/archive/catalog/03's "Add Item" dialog doubles as the
 * edit form). Re-validates every field-level and GL-mapping rule that still
 * applies after the change — `accounts`, when supplied, checks any GL
 * mapping overrides the same way `createItem` does.
 */
export async function updateItem(
  itemId: string,
  command: UpdateItemCommand,
  repo: ItemRepository,
  accounts?: readonly Account[],
): Promise<Item> {
  const current = await repo.findById(itemId);
  if (!current) throw new ItemNotFoundError(itemId);
  const awaitedPricing = current.status === ItemStatusCode.PendingPricing;
  if (!awaitedPricing && command.status === ItemStatusCode.PendingPricing) throw new ItemStatusNotSettableError(itemId);
  const salePrice = command.salePrice !== undefined ? command.salePrice : current.salePrice;
  const priced = salePrice !== null && salePrice.scaled > 0n;
  if (awaitedPricing && !priced && command.status !== undefined && command.status !== ItemStatusCode.PendingPricing) throw new ItemPriceRequiredError(itemId);
  const releasedStatus = command.status === undefined || command.status === ItemStatusCode.PendingPricing ? ItemStatusCode.Active : command.status;

  const updated: Item = {
    ...current,
    nameAr: command.nameAr ?? current.nameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    type: command.type ?? current.type,
    baseUnitCode: command.baseUnitCode ?? current.baseUnitCode,
    alternateUnits: command.alternateUnits ?? current.alternateUnits,
    barcodes: command.barcodes ?? current.barcodes,
    categoryId: command.categoryId !== undefined ? command.categoryId : current.categoryId,
    brandId: command.brandId !== undefined ? command.brandId : current.brandId,
    description: command.description !== undefined ? command.description : current.description,
    defaultSupplierId: command.defaultSupplierId !== undefined ? command.defaultSupplierId : current.defaultSupplierId,
    seasonId: command.seasonId !== undefined ? command.seasonId : current.seasonId,
    specifications: command.specifications !== undefined ? command.specifications : current.specifications,
    costingMethod: command.costingMethod ?? current.costingMethod,
    salePrice: command.salePrice !== undefined ? command.salePrice : current.salePrice,
    costPrice: command.costPrice !== undefined ? command.costPrice : current.costPrice,
    taxRatePercent: command.taxRatePercent ?? current.taxRatePercent,
    trackInventory: command.trackInventory ?? current.trackInventory,
    trackBatches: command.trackBatches ?? current.trackBatches,
    trackExpiry: command.trackExpiry ?? current.trackExpiry,
    reorderPoint: command.reorderPoint !== undefined ? command.reorderPoint : current.reorderPoint,
    imageAttachmentId:
      command.imageAttachmentId !== undefined ? command.imageAttachmentId : current.imageAttachmentId,
    reorderQty: command.reorderQty !== undefined ? command.reorderQty : current.reorderQty,
    revenueAccountId: command.revenueAccountId !== undefined ? command.revenueAccountId : current.revenueAccountId,
    cogsAccountId: command.cogsAccountId !== undefined ? command.cogsAccountId : current.cogsAccountId,
    inventoryAccountId:
      command.inventoryAccountId !== undefined ? command.inventoryAccountId : current.inventoryAccountId,
    etaCodeType: command.etaCodeType !== undefined ? command.etaCodeType : current.etaCodeType,
    etaItemCode: command.etaItemCode !== undefined ? command.etaItemCode : current.etaItemCode,
    gpcCode: command.gpcCode !== undefined ? command.gpcCode : current.gpcCode,
    status: awaitedPricing ? (priced ? releasedStatus : ItemStatusCode.PendingPricing) : (command.status ?? current.status),
  };

  const reasons = [...collectItemFieldErrors(updated), ...validateGlAccountRefs(updated, accounts)];
  if (reasons.length > 0) throw new InvalidItemError(reasons);

  await repo.update(updated);
  return updated;
}
