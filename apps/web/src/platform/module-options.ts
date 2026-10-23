import { MODULE_CATALOG } from "@mezan/domain";
import { entitlementModuleLabel } from "../domain-labels";
import type { AppTranslationKey } from "../i18n";

export function platformModuleOptions(t: (key: AppTranslationKey) => string): { value: string; label: string }[] {
  return MODULE_CATALOG.map((id) => ({ value: id, label: entitlementModuleLabel(id, t) }));
}
