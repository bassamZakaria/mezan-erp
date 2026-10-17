import { EmptyState } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../../../data/ApiContext";
import { useAppTranslation } from "../../../i18n";
import { ScreenTabs } from "../../ScreenTabs";
import { PolicyTab } from "./PolicyTab";
import { WorklistTab } from "./WorklistTab";

export function ReorderScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, "inventory.reorder.view");
  const mayManage = can(auth, "inventory.reorder.manage");
  const mayCreate = can(auth, "inventory.reorder.create") && can(auth, "purchases.order.create");

  if (!mayView) {
    return <EmptyState title={t("reorder.noAccessTitle")} description={t("reorder.noAccessBody")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[20px] font-bold text-ink">{t("reorder.title")}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">{t("reorder.subtitle")}</p>
      </div>
      <ScreenTabs
        ariaLabel={t("reorder.title")}
        tabs={[
          { key: "worklist", label: t("reorder.tab.worklist"), render: () => <WorklistTab mayCreate={mayCreate} /> },
          { key: "policies", label: t("reorder.tab.policies"), render: () => <PolicyTab mayManage={mayManage} /> },
        ]}
      />
    </div>
  );
}
