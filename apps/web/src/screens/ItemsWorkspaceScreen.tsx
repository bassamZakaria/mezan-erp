import { ConfigurableProductsScreen } from "./ConfigurableProductsScreen";
import { ItemSpecificationsScreen } from "./ItemSpecificationsScreen";
import { ItemsScreen } from "./ItemsScreen";
import { ProductTemplatesScreen } from "./ProductTemplatesScreen";
import { ScreenTabs } from "./ScreenTabs";
import { useAppTranslation } from "../i18n";

/**
 * الأصناف — ONE page for the four ways this system describes a product, where
 * the nav used to carry four separate screens: the items themselves, the
 * templates that generate their variants, the configurable (made-to-order)
 * products built from a formula, and the specifications those two draw their
 * attributes from. They are one subject and were never four destinations; the
 * reference for this shape is QuickBooks' single «Products and services» list,
 * which carries the item's KIND as a field rather than as a menu entry.
 *
 * The tab is the first URL segment (`#/stock/items/templates`), so a tab is
 * linkable and survives a reload. None of the four screens uses sub-pages of
 * its own — they open detail in a panel — so nothing is shadowed by taking
 * that segment.
 */

const TABS = ["items", "templates", "configurable", "specs"] as const;
export type ItemsTab = (typeof TABS)[number];

export function ItemsWorkspaceScreen() {
  const { t } = useAppTranslation();

  return (
    <ScreenTabs
      ariaLabel={t("items.tabs.label")}
      tabs={[
        { key: "items", label: t("items.tabs.items"), render: () => <ItemsScreen /> },
        { key: "templates", label: t("items.tabs.templates"), render: () => <ProductTemplatesScreen /> },
        { key: "configurable", label: t("items.tabs.configurable"), render: () => <ConfigurableProductsScreen /> },
        { key: "specs", label: t("items.tabs.specs"), render: () => <ItemSpecificationsScreen /> },
      ]}
    />
  );
}
