import { BomsScreen } from "./BomsScreen";
import { ConfigurableProductsScreen } from "./ConfigurableProductsScreen";
import { ItemSpecificationsScreen } from "./ItemSpecificationsScreen";
import { ItemsScreen } from "./ItemsScreen";
import { ProductTemplatesScreen } from "./ProductTemplatesScreen";
import { ScreenTabs } from "./ScreenTabs";
import { useAppTranslation } from "../i18n";

/**
 * الأصناف — ONE page for the ways this system describes a product, where the
 * nav used to carry a separate screen for each: the items themselves, the
 * templates that generate their variants, the configurable (made-to-order)
 * products built from a formula, the specifications those two draw their
 * attributes from, and قائمة المواد — the recipe a finished good is built
 * from. They are one subject and were never five destinations; the reference
 * for this shape is QuickBooks' single «Products and services» list, which
 * carries the item's KIND as a field rather than as a menu entry.
 *
 * THE BILL OF MATERIALS BELONGS TO THE ITEM. QuickBooks has no BOM screen at
 * all: the recipe is reached at «Products and services → the item → Edit →
 * View/edit bill of materials», and an edit applies only to manufacturing
 * orders created after it. Mezan already stores it that way — every `Bom`
 * carries a `productItemId`, versioning supersedes rather than mutates, and a
 * manufacturing order snapshots the version it was planned against — so this
 * is only where it is SHOWN.
 *
 * The tab is the first URL segment (`#/stock/items/templates`), so a tab is
 * linkable and survives a reload. None of the four screens uses sub-pages of
 * its own — they open detail in a panel — so nothing is shadowed by taking
 * that segment.
 */

const TABS = ["items", "templates", "configurable", "specs", "boms"] as const;
export type ItemsTab = (typeof TABS)[number];

export function ItemsWorkspaceScreen() {
  const { t } = useAppTranslation();

  return (
    <ScreenTabs
      ariaLabel={t("items.tabs.label")}
      // الأصناف is the page; the other four are what an item is BUILT from —
      // its variants' template, the attributes that template draws on, the
      // formula behind a made-to-order product, and the recipe a manufacturing
      // order is raised against. Every one is in use (the seeded tenant has 2
      // templates generating 5 variant items, 5 specifications the item form
      // reads, 1 configurable product and 3 recipes), so none can go — but
      // none of them is the list a user opens الأصناف to see.
      primaryCount={1}
      moreLabel={t("items.tabs.more")}
      tabs={[
        { key: "items", label: t("items.tabs.items"), render: () => <ItemsScreen /> },
        { key: "templates", label: t("items.tabs.templates"), render: () => <ProductTemplatesScreen /> },
        { key: "configurable", label: t("items.tabs.configurable"), render: () => <ConfigurableProductsScreen /> },
        { key: "specs", label: t("items.tabs.specs"), render: () => <ItemSpecificationsScreen /> },
        { key: "boms", label: t("items.tabs.boms"), render: () => <BomsScreen /> },
      ]}
    />
  );
}
