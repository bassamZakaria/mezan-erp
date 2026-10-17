import { Card, EmptyState } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../../../data/ApiContext";
import { useAppTranslation } from "../../../i18n";
import { ScreenTabs } from "../../ScreenTabs";
import { PolicyTab } from "./PolicyTab";
import { PromiseTable } from "./PromiseTable";
import { RemindersTab } from "./RemindersTab";
import { WorklistTab } from "./WorklistTab";
import { usePromises } from "./hooks";

function PromisesTab({ mayEdit }: { mayEdit: boolean }) {
  const { t } = useAppTranslation();
  const query = usePromises();
  if (query.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (query.isError) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {query.error.message}
      </Card>
    );
  }
  if (!query.data || query.data.length === 0) return <EmptyState title={t("collections.promises.empty")} />;
  return (
    <Card className="p-[8px_12px]">
      <PromiseTable promises={query.data} showCustomer mayCancel={mayEdit} />
    </Card>
  );
}

export function CollectionsScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, "sales.collections.view");
  const mayEdit = can(auth, "sales.collections.edit");
  const mayRun = can(auth, "sales.collections.run");
  const maySend = can(auth, "sales.collections.send");
  const mayManage = can(auth, "sales.collections.manage");

  if (!mayView) {
    return <EmptyState title={t("collections.noAccessTitle")} description={t("collections.noAccessBody")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[20px] font-bold text-ink">{t("collections.title")}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">{t("collections.subtitle")}</p>
      </div>
      <ScreenTabs
        ariaLabel={t("collections.title")}
        tabs={[
          { key: "worklist", label: t("collections.tab.worklist"), render: () => <WorklistTab mayRun={mayRun} mayPromise={mayEdit} /> },
          { key: "reminders", label: t("collections.tab.reminders"), render: () => <RemindersTab maySend={maySend} /> },
          { key: "promises", label: t("collections.tab.promises"), render: () => <PromisesTab mayEdit={mayEdit} /> },
          { key: "policy", label: t("collections.tab.policy"), render: () => <PolicyTab mayManage={mayManage} /> },
        ]}
      />
    </div>
  );
}
