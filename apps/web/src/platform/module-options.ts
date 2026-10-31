import { FREE_SUB_MODULES, MODULE_CATALOG, SUB_MODULES, moduleName, parentOf } from "@mezan/domain";
import { entitlementModuleLabel } from "../domain-labels";
import type { AppTranslationKey } from "../i18n";

type Translate = (key: AppTranslationKey) => string;

export function platformModuleOptions(t: Translate): { value: string; label: string }[] {
  return MODULE_CATALOG.map((id) => ({ value: id, label: entitlementModuleLabel(id, t) }));
}

/** The paid HR parts a plan can carry without the whole module; the free part is never offered. */
export function hrPartOptions(): { value: string; label: string }[] {
  return (SUB_MODULES.hr ?? []).filter((id) => !FREE_SUB_MODULES.has(id)).map((id) => ({ value: id, label: moduleName(id).ar }));
}

/** A module's name, or a part's as «parent — part». */
export function licensableLabel(id: string, t: Translate): string {
  const parent = parentOf(id);
  return parent === null ? entitlementModuleLabel(id, t) : `${entitlementModuleLabel(parent, t)} — ${moduleName(id).ar}`;
}
