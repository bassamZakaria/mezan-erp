import { EmptyState } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../../../data/ApiContext";
import { useAppTranslation } from "../../../i18n";
import { ScreenTabs } from "../../ScreenTabs";
import { INTEGRATIONS_MANAGE, INTEGRATIONS_VIEW, useIntegrationsCatalog } from "./hooks";
import { ApiKeysTab } from "./ApiKeysTab";
import { WebhooksTab } from "./WebhooksTab";
import { DeliveriesTab } from "./DeliveriesTab";
import { DeveloperGuideTab } from "./DeveloperGuideTab";

const NOT_FOUND = 404;

export function IntegrationsScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, INTEGRATIONS_VIEW);
  const mayManage = can(auth, INTEGRATIONS_MANAGE);
  const catalog = useIntegrationsCatalog();

  if (!mayView) return <EmptyState title={t("integrations.noAccessTitle")} description={t("integrations.noAccessBody")} />;
  if (catalog.isError && catalog.error.status === NOT_FOUND) {
    return <EmptyState title={t("integrations.cloudOnlyTitle")} description={t("integrations.cloudOnlyBody")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[20px] font-bold text-ink">{t("integrations.title")}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">{t("integrations.subtitle")}</p>
      </div>
      {catalog.isLoading ? <p className="text-[13px] text-ink-muted">{t("common.loading")}</p> : null}
      {catalog.isError ? (
        <p role="alert" className="text-[13px] text-danger-ink">
          {catalog.error.message || t("integrations.loadFailed")}
        </p>
      ) : null}
      {catalog.data ? (
        <ScreenTabs
          ariaLabel={t("integrations.title")}
          tabs={[
            { key: "keys", label: t("integrations.tab.keys"), render: () => <ApiKeysTab catalog={catalog.data} mayManage={mayManage} /> },
            { key: "webhooks", label: t("integrations.tab.webhooks"), render: () => <WebhooksTab catalog={catalog.data} mayManage={mayManage} /> },
            { key: "deliveries", label: t("integrations.tab.deliveries"), render: () => <DeliveriesTab mayManage={mayManage} /> },
            { key: "docs", label: t("integrations.tab.docs"), render: () => <DeveloperGuideTab catalog={catalog.data} /> },
          ]}
        />
      ) : null}
    </div>
  );
}
