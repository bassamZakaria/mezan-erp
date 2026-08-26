import type { Account } from "../accounts/index.js";
import type { Money } from "../money/index.js";
import type { AlternateUnit, CostingMethod, EtaCodeType, Item, ItemRepository, ItemStatus, ItemType } from "./item.js";
import { DuplicateItemCodeError, InvalidItemError } from "./errors.js";
import { collectItemFieldErrors, validateGlAccountRefs } from "./validation.js";
import { itemTypeTracksStock } from "./item-type.js";

export interface CreateItemCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly type: ItemType;
  readonly baseUnitCode: string;
  readonly alternateUnits?: readonly AlternateUnit[];
  readonly barcodes?: readonly string[];
  readonly categoryId?: string | null;
  readonly brand?: string | null;
  readonly costingMethod?: CostingMethod;
  readonly salePrice?: Money | null;
  readonly costPrice?: Money | null;
  readonly taxRatePercent?: number;
  readonly trackInventory?: boolean;
  readonly trackBatches?: boolean;
  readonly trackExpiry?: boolean;
  readonly reorderPoint?: number | null;
  readonly reorderQty?: number | null;
  readonly revenueAccountId?: string | null;
  readonly cogsAccountId?: string | null;
  readonly inventoryAccountId?: string | null;
  readonly etaCodeType?: EtaCodeType | null;
  readonly etaItemCode?: string | null;
  readonly gpcCode?: string | null;
}

function buildCandidate(command: CreateItemCommand): Item {
  const status: ItemStatus = "active";
  return {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    type: command.type,
    baseUnitCode: command.baseUnitCode,
    alternateUnits: command.alternateUnits ?? [],
    barcodes: command.barcodes ?? [],
    categoryId: command.categoryId ?? null,
    brand: command.brand ?? null,
    costingMethod: command.costingMethod ?? "WAC",
    salePrice: command.salePrice ?? null,
    costPrice: command.costPrice ?? null,
    taxRatePercent: command.taxRatePercent ?? 14,
    trackInventory: command.trackInventory ?? itemTypeTracksStock(command.type),
    trackBatches: command.trackBatches ?? false,
    trackExpiry: command.trackExpiry ?? false,
    reorderPoint: command.reorderPoint ?? null,
    reorderQty: command.reorderQty ?? null,
    revenueAccountId: command.revenueAccountId ?? null,
    cogsAccountId: command.cogsAccountId ?? null,
    inventoryAccountId: command.inventoryAccountId ?? null,
    etaCodeType: command.etaCodeType ?? null,
    etaItemCode: command.etaItemCode ?? null,
    gpcCode: command.gpcCode ?? null,
    status,
  };
}

/**
 * Validates a new-item command against the existing catalog (docs/catalog/03
 * "الأصناف"): the code must be unique, then every field-level and GL-mapping
 * rule from `./validation.js` must hold. Pure — does not touch the repo.
 */
export function validateNewItem(
  command: CreateItemCommand,
  existing: readonly Item[],
  accounts?: readonly Account[],
): void {
  if (existing.some((i) => i.code === command.code)) {
    throw new DuplicateItemCodeError(command.code);
  }
  const candidate = buildCandidate(command);
  const reasons = [...collectItemFieldErrors(candidate), ...validateGlAccountRefs(candidate, accounts)];
  if (reasons.length > 0) throw new InvalidItemError(reasons);
}

/**
 * Creates and persists a new item. New items always start `active`
 * (docs/catalog/03 — status is toggled later via edit, never at creation).
 * `accounts`, when supplied, is used to validate any GL mapping overrides —
 * omit it to skip that check (every mapping is itself optional).
 */
export async function createItem(
  command: CreateItemCommand,
  repo: ItemRepository,
  accounts?: readonly Account[],
): Promise<Item> {
  const existing = await repo.list();
  validateNewItem(command, existing, accounts);

  const item = buildCandidate(command);
  await repo.create(item);
  return item;
}
