import { useMemo } from "react";
import type { ItemCategoryDTO, ItemUnitDTO } from "@mezan/contracts";
import { useItemCategories, useItemUnits } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { entityName } from "./entity-names";
import { EMPTY } from "../lib/empty";

/**
 * Display labels for the item master-data catalogs (docs/archive/catalog/03). Both
 * units and categories are tenant records served by `/item-units` and
 * `/item-categories`, so a screen that only needs the label resolves it
 * through these hooks instead of holding its own copy of the catalog.
 *
 * Both carry `nameEn` and both used to render `nameAr` unconditionally, so the
 * English UI read "قطعة (PCS)" for a unit whose English name the API was
 * already serving (D49).
 */

export function unitLabel(code: string, units: readonly ItemUnitDTO[], locale = "ar"): string {
  return entityName(units.find((u) => u.code === code), locale, code);
}

export function categoryLabel(
  id: string | null,
  categories: readonly ItemCategoryDTO[],
  uncategorized: string,
  locale = "ar",
): string {
  if (!id) return uncategorized;
  return entityName(categories.find((c) => c.id === id), locale, id);
}

export function useUnitLabel(): (code: string) => string {
  const { locale } = useAppTranslation();
  const units = useItemUnits().data ?? EMPTY;
  return useMemo(() => (code: string) => unitLabel(code, units, locale), [units, locale]);
}

export function useCategoryLabel(): (id: string | null) => string {
  const { t, locale } = useAppTranslation();
  const categories = useItemCategories().data ?? EMPTY;
  const uncategorized = t("common.uncategorized");
  return useMemo(
    () => (id: string | null) => categoryLabel(id, categories, uncategorized, locale),
    [categories, uncategorized, locale],
  );
}
