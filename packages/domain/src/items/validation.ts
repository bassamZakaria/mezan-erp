import type { Account } from "../accounts/index.js";
import { isPostable } from "../accounts/index.js";
import type { AlternateUnit, Item } from "./item.js";
import { itemTypeTracksStock } from "./item-type.js";

/**
 * Alternate-unit conversion rules (docs/catalog/03 "وحدات القياس"): every
 * alternate unit needs a non-blank, unique code distinct from the base unit,
 * and a strictly positive conversion factor.
 */
export function validateAlternateUnits(baseUnitCode: string, alternateUnits: readonly AlternateUnit[]): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const unit of alternateUnits) {
    if (unit.code.trim() === "") {
      reasons.push("alternate unit code is required");
      continue;
    }
    if (unit.code === baseUnitCode) {
      reasons.push(`alternate unit "${unit.code}" cannot repeat the base unit`);
    }
    if (seen.has(unit.code)) {
      reasons.push(`alternate unit code "${unit.code}" is duplicated`);
    }
    seen.add(unit.code);
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) {
      reasons.push(`alternate unit "${unit.code}" must have a positive conversion factor`);
    }
  }
  return reasons;
}

/**
 * Per-item GL account mapping refs (docs/catalog/03 "الحسابات"): when a
 * mapping is supplied, it must resolve to a real, postable (active, detail)
 * account. `accounts` is optional — omit it (e.g. a unit test with no COA
 * fixture) to skip this check entirely, since every mapping is itself
 * optional ("leave blank to use default").
 */
export function validateGlAccountRefs(
  item: Pick<Item, "revenueAccountId" | "cogsAccountId" | "inventoryAccountId">,
  accounts?: readonly Account[],
): string[] {
  if (!accounts) return [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const reasons: string[] = [];
  const refs: readonly [label: string, id: string | null][] = [
    ["حساب الإيراد", item.revenueAccountId],
    ["حساب التكلفة", item.cogsAccountId],
    ["حساب المخزون", item.inventoryAccountId],
  ];
  for (const [label, id] of refs) {
    if (!id) continue;
    const account = byId.get(id);
    if (!account) {
      reasons.push(`${label}: account "${id}" was not found`);
      continue;
    }
    if (!isPostable(account)) {
      reasons.push(`${label}: account "${id}" is not a postable detail account`);
    }
  }
  return reasons;
}

/** Field-level rules independent of the rest of the catalog (no uniqueness/GL lookups here). */
export function collectItemFieldErrors(item: Item): string[] {
  const reasons: string[] = [];

  if (item.nameAr.trim() === "") reasons.push("nameAr is required");
  if (item.baseUnitCode.trim() === "") reasons.push("baseUnitCode is required");

  // Asked as a capability, not as `type === "service"`: recipes cannot hold
  // stock either, and the check has to keep holding as types are added.
  if (!itemTypeTracksStock(item.type) && item.trackInventory) {
    reasons.push(`an item of type ${item.type} cannot track inventory`);
  }
  if (!item.trackInventory && (item.trackBatches || item.trackExpiry)) {
    reasons.push("batch/expiry tracking requires trackInventory");
  }

  if (!Number.isFinite(item.taxRatePercent) || item.taxRatePercent < 0) {
    reasons.push("taxRatePercent must be zero or a positive number");
  }
  if (item.reorderPoint !== null && item.reorderPoint < 0) reasons.push("reorderPoint cannot be negative");
  if (item.reorderQty !== null && item.reorderQty < 0) reasons.push("reorderQty cannot be negative");
  if (item.salePrice !== null && item.salePrice.scaled < 0n) reasons.push("salePrice cannot be negative");
  if (item.costPrice !== null && item.costPrice.scaled < 0n) reasons.push("costPrice cannot be negative");

  const seenBarcodes = new Set<string>();
  for (const barcode of item.barcodes) {
    if (barcode.trim() === "") {
      reasons.push("barcode cannot be blank");
      continue;
    }
    if (seenBarcodes.has(barcode)) reasons.push(`barcode "${barcode}" is duplicated`);
    seenBarcodes.add(barcode);
  }

  reasons.push(...validateAlternateUnits(item.baseUnitCode, item.alternateUnits));

  return reasons;
}
