import type { Account } from "../accounts/index.js";
import { isPostable } from "../accounts/index.js";
import type { AlternateUnit, Item } from "./item.js";
import type { BilingualReason } from "../collections/errors.js";
import { itemTypeLabelAr, itemTypeTracksStock } from "./item-type.js";

const ITEM_TYPE_LABELS_EN: Readonly<Record<string, string>> = {
  stock: "product",
  service: "service",
  raw_material: "raw material",
  finished_good: "finished good",
  consumable: "consumable",
  recipe: "recipe",
};

/**
 * Alternate-unit conversion rules (docs/archive/catalog/03 "وحدات القياس"): every
 * alternate unit needs a non-blank, unique code distinct from the base unit,
 * and a strictly positive conversion factor.
 */
export function alternateUnitReasons(baseUnitCode: string, alternateUnits: readonly AlternateUnit[]): BilingualReason[] {
  const reasons: BilingualReason[] = [];
  const seen = new Set<string>();
  for (const unit of alternateUnits) {
    if (unit.code.trim() === "") {
      reasons.push({ ar: "كود الوحدة البديلة مطلوب", en: "The alternate unit code is required" });
      continue;
    }
    if (unit.code === baseUnitCode) {
      reasons.push({
        ar: `الوحدة البديلة "${unit.code}" لا يمكن أن تكرر الوحدة الأساسية`,
        en: `Alternate unit "${unit.code}" cannot repeat the base unit`,
      });
    }
    if (seen.has(unit.code)) {
      reasons.push({ ar: `كود الوحدة البديلة "${unit.code}" مكرر`, en: `Alternate unit code "${unit.code}" is duplicated` });
    }
    seen.add(unit.code);
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) {
      reasons.push({
        ar: `الوحدة البديلة "${unit.code}" يجب أن يكون لها معامل تحويل موجب`,
        en: `Alternate unit "${unit.code}" must have a positive conversion factor`,
      });
    }
  }
  return reasons;
}

export function validateAlternateUnits(baseUnitCode: string, alternateUnits: readonly AlternateUnit[]): string[] {
  return alternateUnitReasons(baseUnitCode, alternateUnits).map((reason) => reason.ar);
}

/**
 * Per-item GL account mapping refs (docs/archive/catalog/03 "الحسابات"): when a
 * mapping is supplied, it must resolve to a real, postable (active, detail)
 * account. `accounts` is optional — omit it (e.g. a unit test with no COA
 * fixture) to skip this check entirely, since every mapping is itself
 * optional ("leave blank to use default").
 */
export function glAccountRefReasons(
  item: Pick<Item, "revenueAccountId" | "cogsAccountId" | "inventoryAccountId">,
  accounts?: readonly Account[],
): BilingualReason[] {
  if (!accounts) return [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const reasons: BilingualReason[] = [];
  const refs: readonly [label: string, labelEn: string, id: string | null][] = [
    ["حساب الإيراد", "Revenue account", item.revenueAccountId],
    ["حساب التكلفة", "Cost account", item.cogsAccountId],
    ["حساب المخزون", "Inventory account", item.inventoryAccountId],
  ];
  for (const [label, labelEn, id] of refs) {
    if (!id) continue;
    const account = byId.get(id);
    if (!account) {
      reasons.push({ ar: `${label}: الحساب "${id}" غير موجود`, en: `${labelEn}: account "${id}" was not found` });
      continue;
    }
    if (!isPostable(account)) {
      reasons.push({
        ar: `${label}: الحساب "${id}" ليس حسابًا تفصيليًا قابلاً للترحيل`,
        en: `${labelEn}: account "${id}" is not a postable detail account`,
      });
    }
  }
  return reasons;
}

export function validateGlAccountRefs(
  item: Pick<Item, "revenueAccountId" | "cogsAccountId" | "inventoryAccountId">,
  accounts?: readonly Account[],
): string[] {
  return glAccountRefReasons(item, accounts).map((reason) => reason.ar);
}

/** Field-level rules independent of the rest of the catalog (no uniqueness/GL lookups here). */
export function itemFieldReasons(item: Item): BilingualReason[] {
  const reasons: BilingualReason[] = [];

  if (item.nameAr.trim() === "") reasons.push({ ar: "اسم الصنف بالعربية مطلوب", en: "The Arabic item name is required" });
  if (item.baseUnitCode.trim() === "") reasons.push({ ar: "الوحدة الأساسية مطلوبة", en: "The base unit is required" });

  // Asked as a capability, not as `type === "service"`: recipes cannot hold
  // stock either, and the check has to keep holding as types are added.
  if (!itemTypeTracksStock(item.type) && item.trackInventory) {
    reasons.push({
      ar: `لا يمكن لصنف من نوع "${itemTypeLabelAr(item.type)}" أن يتتبع المخزون`,
      en: `An item of type "${ITEM_TYPE_LABELS_EN[item.type] ?? item.type}" cannot track inventory`,
    });
  }
  if (!item.trackInventory && (item.trackBatches || item.trackExpiry)) {
    reasons.push({ ar: "تتبع الدفعات/الصلاحية يتطلب تفعيل تتبع المخزون", en: "Batch/expiry tracking requires inventory tracking to be enabled" });
  }

  if (!Number.isFinite(item.taxRatePercent) || item.taxRatePercent < 0) {
    reasons.push({ ar: "نسبة الضريبة يجب أن تكون صفرًا أو رقمًا موجبًا", en: "The tax rate must be zero or a positive number" });
  }
  if (item.reorderPoint !== null && item.reorderPoint < 0) reasons.push({ ar: "حد إعادة الطلب لا يمكن أن يكون سالبًا", en: "The reorder point cannot be negative" });
  if (item.reorderQty !== null && item.reorderQty < 0) reasons.push({ ar: "كمية إعادة الطلب لا يمكن أن تكون سالبة", en: "The reorder quantity cannot be negative" });
  if (item.salePrice !== null && item.salePrice.scaled < 0n) reasons.push({ ar: "سعر البيع لا يمكن أن يكون سالبًا", en: "The sale price cannot be negative" });
  if (item.costPrice !== null && item.costPrice.scaled < 0n) reasons.push({ ar: "سعر التكلفة لا يمكن أن يكون سالبًا", en: "The cost price cannot be negative" });

  const seenBarcodes = new Set<string>();
  for (const barcode of item.barcodes) {
    if (barcode.trim() === "") {
      reasons.push({ ar: "الباركود لا يمكن أن يكون فارغًا", en: "A barcode cannot be empty" });
      continue;
    }
    if (seenBarcodes.has(barcode)) reasons.push({ ar: `الباركود "${barcode}" مكرر`, en: `Barcode "${barcode}" is duplicated` });
    seenBarcodes.add(barcode);
  }

  reasons.push(...alternateUnitReasons(item.baseUnitCode, item.alternateUnits));

  return reasons;
}

export function collectItemFieldErrors(item: Item): string[] {
  return itemFieldReasons(item).map((reason) => reason.ar);
}
