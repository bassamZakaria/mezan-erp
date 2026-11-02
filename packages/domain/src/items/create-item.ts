import type { Account } from "../accounts/index.js";
import type { Money } from "../money/index.js";
import { ItemStatusCode, type AlternateUnit, type CostingMethod, type EtaCodeType, type Item, type ItemRepository, type ItemStatus, type ItemType, type ItemSpecificationValue } from "./item.js";
import { DuplicateItemCodeError, InvalidItemError } from "./errors.js";
import { itemFieldReasons, glAccountRefReasons } from "./validation.js";
import { itemTypeTracksStock } from "./item-type.js";

export interface CreateItemCommand {
  readonly id: string;
  /** SECURITY: decided by the server from the session, never read from the request. */
  readonly awaitsPricing?: boolean;
  /** Omitted or blank, the server allocates the next free `ITM-######` code. */
  readonly code?: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly type: ItemType;
  readonly baseUnitCode: string;
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
}

const ITEM_CODE_PREFIX = "ITM-";
const ITEM_CODE_PATTERN = new RegExp(`^${ITEM_CODE_PREFIX}(\\d+)$`);

/**
 * The next free `ITM-######` code after the highest already in `existing`.
 * Pure — the caller (`createItem`) re-derives this against a fresh read on
 * every retry, so a race that lands between the read and the write is
 * resolved by trying again rather than by trusting a stale count (the item
 * twin of `packages/api/src/master-code.ts`'s `nextMasterCode`).
 */
export function nextItemCode(existing: readonly Item[]): string {
  let max = 0;
  for (const item of existing) {
    const match = ITEM_CODE_PATTERN.exec(item.code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${ITEM_CODE_PREFIX}${String(max + 1).padStart(6, "0")}`;
}

function buildCandidate(command: CreateItemCommand & { code: string }): Item {
  const status: ItemStatus = command.awaitsPricing ? ItemStatusCode.PendingPricing : ItemStatusCode.Active;
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
    brandId: command.brandId ?? null,
    description: command.description ?? null,
    defaultSupplierId: command.defaultSupplierId ?? null,
    seasonId: command.seasonId ?? null,
    specifications: command.specifications ?? [],
    costingMethod: command.costingMethod ?? "WAC",
    salePrice: command.awaitsPricing ? null : (command.salePrice ?? null),
    costPrice: command.awaitsPricing ? null : (command.costPrice ?? null),
    taxRatePercent: command.taxRatePercent ?? 14,
    trackInventory: command.trackInventory ?? itemTypeTracksStock(command.type),
    trackBatches: command.trackBatches ?? false,
    trackExpiry: command.trackExpiry ?? false,
    reorderPoint: command.reorderPoint ?? null,
    imageAttachmentId: command.imageAttachmentId ?? null,
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
 * Validates a new-item command against the existing catalog (docs/archive/catalog/03
 * "الأصناف"): the code must be unique, then every field-level and GL-mapping
 * rule from `./validation.js` must hold. Pure — does not touch the repo.
 */
export function validateNewItem(
  command: CreateItemCommand & { code: string },
  existing: readonly Item[],
  accounts?: readonly Account[],
): void {
  if (existing.some((i) => i.code === command.code)) {
    throw new DuplicateItemCodeError(command.code);
  }
  const candidate = buildCandidate(command);
  const reasons = [...itemFieldReasons(candidate), ...glAccountRefReasons(candidate, accounts)];
  if (reasons.length > 0) throw new InvalidItemError(reasons);
}

async function holdersOf(code: string, repo: ItemRepository): Promise<readonly Item[]> {
  const holder = await repo.findByCode(code);
  return holder ? [holder] : [];
}

/** Retries a code collision this many times before giving up (each attempt re-reads the catalog). */
const MAX_CODE_ALLOCATION_ATTEMPTS = 20;

/**
 * Creates and persists a new item. New items always start `active`
 * (docs/archive/catalog/03 — status is toggled later via edit, never at creation).
 * `accounts`, when supplied, is used to validate any GL mapping overrides —
 * omit it to skip that check (every mapping is itself optional).
 *
 * A blank/omitted `command.code` is allocated here, not by the caller: the
 * catalog size the browser could compute is a stale snapshot the moment a
 * second create races it, so every attempt re-reads the repo and re-derives
 * the code, retrying on a `DuplicateItemCodeError` from either the pre-check
 * (a rival create already landed) or the repo's own unique-code constraint (a
 * rival create landed in the gap between this attempt's read and its write).
 * A manually supplied code never retries — a real duplicate is reported once.
 */
export async function createItem(
  command: CreateItemCommand,
  repo: ItemRepository,
  accounts?: readonly Account[],
): Promise<Item> {
  const manualCode = command.code?.trim();
  const autoAssign = manualCode === undefined || manualCode === "";

  for (let attempt = 0; ; attempt++) {
    const existing = autoAssign ? await repo.list() : await holdersOf(manualCode, repo);
    const code = autoAssign ? nextItemCode(existing) : manualCode;
    const resolved = { ...command, code };
    try {
      validateNewItem(resolved, existing, accounts);
      const item = buildCandidate(resolved);
      await repo.create(item);
      return item;
    } catch (err) {
      if (autoAssign && err instanceof DuplicateItemCodeError && attempt < MAX_CODE_ALLOCATION_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }
}

