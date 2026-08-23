import type { ItemDTO } from "@mezan/contracts";

/**
 * Sample Items catalog for the Cyag (شركة سياج) demo tenant — docs/catalog/03-inventory.md
 * "الأصناف". Uses `ItemDTO` (the wire contract) directly as the local demo
 * type, the same convention `accounts-sample-data.ts` established for the
 * Chart of Accounts screen: apps/web has no live API wiring yet (every
 * Phase-0/Phase-1 screen is sample-data-driven), so this keeps the demo state
 * shaped exactly like what the real API would return.
 */

export interface ItemUnitOption {
  code: string;
  labelAr: string;
}

/** Base units offered in the unit picker (docs/catalog/03 "وحدة القياس"). */
export const demoUnits: ItemUnitOption[] = [
  { code: "PCS", labelAr: "قطعة" },
  { code: "CTN", labelAr: "كرتونة" },
  { code: "BOX", labelAr: "صندوق" },
  { code: "KG", labelAr: "كيلوجرام" },
  { code: "G", labelAr: "جرام" },
  { code: "L", labelAr: "لتر" },
  { code: "M", labelAr: "متر" },
  { code: "SVC", labelAr: "خدمة" },
];

export function unitLabel(code: string): string {
  return demoUnits.find((u) => u.code === code)?.labelAr ?? code;
}

export interface ItemCategoryOption {
  id: string;
  nameAr: string;
}

/** Item categories dialog data (docs/catalog/03 "تصنيفات الأصناف"). */
export const demoItemCategories: ItemCategoryOption[] = [
  { id: "cat-food", nameAr: "مواد غذائية" },
  { id: "cat-office", nameAr: "مستلزمات مكتبية" },
  { id: "cat-spares", nameAr: "قطع غيار" },
  { id: "cat-services", nameAr: "خدمات" },
];

export function categoryLabel(id: string | null): string {
  if (!id) return "بدون تصنيف";
  return demoItemCategories.find((c) => c.id === id)?.nameAr ?? id;
}
