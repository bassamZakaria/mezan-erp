import type { Account } from "../accounts/index.js";
import { isPostable } from "../accounts/index.js";
import type { AlternateUnit, Item } from "./item.js";
import { itemTypeLabelAr, itemTypeTracksStock } from "./item-type.js";

/**
 * Alternate-unit conversion rules (docs/archive/catalog/03 "وحدات القياس"): every
 * alternate unit needs a non-blank, unique code distinct from the base unit,
 * and a strictly positive conversion factor.
 */
export function validateAlternateUnits(baseUnitCode: string, alternateUnits: readonly AlternateUnit[]): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const unit of alternateUnits) {
    if (unit.code.trim() === "") {
      reasons.push("كود الوحدة البديلة مطلوب");
      continue;
    }
    if (unit.code === baseUnitCode) {
      reasons.push(`الوحدة البديلة "${unit.code}" لا يمكن أن تكرر الوحدة الأساسية`);
    }
    if (seen.has(unit.code)) {
      reasons.push(`كود الوحدة البديلة "${unit.code}" مكرر`);
    }
    seen.add(unit.code);
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) {
      reasons.push(`الوحدة البديلة "${unit.code}" يجب أن يكون لها معامل تحويل موجب`);
    }
  }
  return reasons;
}

/**
 * Per-item GL account mapping refs (docs/archive/catalog/03 "الحسابات"): when a
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
      reasons.push(`${label}: الحساب "${id}" غير موجود`);
      continue;
    }
    if (!isPostable(account)) {
      reasons.push(`${label}: الحساب "${id}" ليس حسابًا تفصيليًا قابلاً للترحيل`);
    }
  }
  return reasons;
}

/** Field-level rules independent of the rest of the catalog (no uniqueness/GL lookups here). */
export function collectItemFieldErrors(item: Item): string[] {
  const reasons: string[] = [];

  if (item.nameAr.trim() === "") reasons.push("اسم الصنف بالعربية مطلوب");
  if (item.baseUnitCode.trim() === "") reasons.push("الوحدة الأساسية مطلوبة");

  // Asked as a capability, not as `type === "service"`: recipes cannot hold
  // stock either, and the check has to keep holding as types are added.
  if (!itemTypeTracksStock(item.type) && item.trackInventory) {
    reasons.push(`لا يمكن لصنف من نوع "${itemTypeLabelAr(item.type)}" أن يتتبع المخزون`);
  }
  if (!item.trackInventory && (item.trackBatches || item.trackExpiry)) {
    reasons.push("تتبع الدفعات/الصلاحية يتطلب تفعيل تتبع المخزون");
  }

  if (!Number.isFinite(item.taxRatePercent) || item.taxRatePercent < 0) {
    reasons.push("نسبة الضريبة يجب أن تكون صفرًا أو رقمًا موجبًا");
  }
  if (item.reorderPoint !== null && item.reorderPoint < 0) reasons.push("حد إعادة الطلب لا يمكن أن يكون سالبًا");
  if (item.reorderQty !== null && item.reorderQty < 0) reasons.push("كمية إعادة الطلب لا يمكن أن تكون سالبة");
  if (item.salePrice !== null && item.salePrice.scaled < 0n) reasons.push("سعر البيع لا يمكن أن يكون سالبًا");
  if (item.costPrice !== null && item.costPrice.scaled < 0n) reasons.push("سعر التكلفة لا يمكن أن يكون سالبًا");

  const seenBarcodes = new Set<string>();
  for (const barcode of item.barcodes) {
    if (barcode.trim() === "") {
      reasons.push("الباركود لا يمكن أن يكون فارغًا");
      continue;
    }
    if (seenBarcodes.has(barcode)) reasons.push(`الباركود "${barcode}" مكرر`);
    seenBarcodes.add(barcode);
  }

  reasons.push(...validateAlternateUnits(item.baseUnitCode, item.alternateUnits));

  return reasons;
}
