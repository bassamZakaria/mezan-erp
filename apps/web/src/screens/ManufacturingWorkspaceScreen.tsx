import { BomsScreen } from "./BomsScreen";
import { ConfigInstancesScreen } from "./ConfigInstancesScreen";
import { ScreenTabs } from "./ScreenTabs";
import { WorkOrdersScreen } from "./WorkOrdersScreen";
import { useAppTranslation } from "../i18n";

/**
 * أوامر التصنيع — the whole of manufacturing on one page, because for the
 * business Mezan is sold to, manufacturing is not a department: it is a stock
 * operation that happens a few times a month. A workspace of its own told the
 * owner "this is factory software" and told his staff to avoid the area.
 *
 * The tabs are the three things a build needs, in the order a build needs
 * them: the ORDERS, the made-to-order variant of an order, and the RECIPES
 * they are raised against. قوائم المواد lives here rather than on the item
 * page: the person who authors a recipe is the person releasing an order, and
 * a recipe filed under الأصناف is the single most predictable "I can't find
 * the bill of materials" ticket this product can generate.
 *
 * لوحة الإنتاج is NOT a tab. It is the floor's own screen — buckets, work
 * stations, every active order — reached from the orders list rather than
 * competing with it as a second landing page.
 */

export function ManufacturingWorkspaceScreen() {
  const { t } = useAppTranslation();

  return (
    <ScreenTabs
      ariaLabel={t("manufacturing.tabs.label")}
      tabs={[
        { key: "orders", label: t("manufacturing.tabs.orders"), render: () => <WorkOrdersScreen /> },
        { key: "custom", label: t("manufacturing.tabs.custom"), render: () => <ConfigInstancesScreen /> },
        { key: "boms", label: t("manufacturing.tabs.boms"), render: () => <BomsScreen /> },
      ]}
    />
  );
}
