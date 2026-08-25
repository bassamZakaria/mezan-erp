import { useMemo } from "react";
import type { ItemCategoryDTO, ItemUnitDTO } from "@mezan/contracts";
import { useItemCategories, useItemUnits } from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * Display labels for the item master-data catalogs (docs/catalog/03). Both
 * units and categories are tenant records served by `/item-units` and
 * `/item-categories`, so a screen that only needs the label resolves it
 * through these hooks instead of holding its own copy of the catalog.
 */

export function unitLabel(code: string, units: readonly ItemUnitDTO[]): string {
  return units.find((u) => u.code === code)?.nameAr ?? code;
}

export function categoryLabel(id: string | null, categories: readonly ItemCategoryDTO[], uncategorized: string): string {
  if (!id) return uncategorized;
  return categories.find((c) => c.id === id)?.nameAr ?? id;
}

export function useUnitLabel(): (code: string) => string {
  const units = useItemUnits().data ?? [];
  return useMemo(() => (code: string) => unitLabel(code, units), [units]);
}

export function useCategoryLabel(): (id: string | null) => string {
  const { t } = useAppTranslation();
  const categories = useItemCategories().data ?? [];
  const uncategorized = t("common.uncategorized");
  return useMemo(() => (id: string | null) => categoryLabel(id, categories, uncategorized), [categories, uncategorized]);
}
