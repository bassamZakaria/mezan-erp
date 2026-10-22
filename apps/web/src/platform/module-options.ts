import { MODULE_CATALOG, MODULES, moduleName } from "@mezan/domain";
import { moduleLabel } from "../domain-labels";
import type { AppTranslationKey } from "../i18n";

/** `MODULE_CATALOG` ids are entitlement ids; the permission catalog's `MODULES` keys its one differing entry as `cheques`. */
const CATALOG_MODULE_ID: Readonly<Record<string, string>> = { financial_papers: "cheques" };

export function platformModuleLabel(id: string, t: (key: AppTranslationKey) => string): string {
  const entry = MODULES.find((m) => m.id === (CATALOG_MODULE_ID[id] ?? id));
  return entry ? moduleLabel(entry, t) : moduleName(id).ar;
}

export function platformModuleOptions(t: (key: AppTranslationKey) => string): { value: string; label: string }[] {
  return MODULE_CATALOG.map((id) => ({ value: id, label: platformModuleLabel(id, t) }));
}
