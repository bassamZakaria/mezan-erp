import { useState } from "react";
import { EmptyState, Segmented } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { OneTimeCredentialDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { CloneUserPanel } from "./CloneUserPanel";
import { Notice, NoticeTone, type NoticeState } from "./Notice";
import { CredentialSheet } from "./CredentialSheet";
import { CLONE_SEGMENT } from "./segments";
import { RoleTemplatesPanel } from "./RoleTemplatesPanel";
import { UserImportPanel } from "./UserImportPanel";

enum ProvisioningTab {
  Templates = "templates",
  Import = "import",
  Clone = "clone",
}

export function ProvisioningScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const { segments } = useNavigation();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayProvision = can(auth, "admin.users.create");
  const mayManageRoles = can(auth, "admin.roles.manage");
  const [tab, setTab] = useState<ProvisioningTab>(segments[0] === CLONE_SEGMENT ? ProvisioningTab.Clone : ProvisioningTab.Import);
  const [sheet, setSheet] = useState<readonly OneTimeCredentialDTO[] | null>(null);
  const [issuedNotice, setIssuedNotice] = useState<NoticeState | null>(null);
  const issue = (credentials: readonly OneTimeCredentialDTO[], message: string) => {
    setIssuedNotice({ tone: NoticeTone.Success, message });
    setSheet(credentials);
  };

  if (!mayProvision) {
    return <EmptyState title={t("provisioning.noAccessTitle")} description={t("provisioning.noAccessBody")} />;
  }
  if (sheet) return <CredentialSheet credentials={sheet} onClose={() => setSheet(null)} />;

  const tabs = [
    ...(mayManageRoles ? [{ key: ProvisioningTab.Templates, label: t("provisioning.tab.templates") }] : []),
    { key: ProvisioningTab.Import, label: t("provisioning.tab.import") },
    { key: ProvisioningTab.Clone, label: t("provisioning.tab.clone") },
  ];
  const active = tabs.some((entry) => entry.key === tab) ? tab : ProvisioningTab.Import;

  return (
    <div className="w-full min-w-0">
      <div className="mb-[16px]">
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("provisioning.title")}</h1>
        <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("provisioning.subtitle")}</p>
      </div>
      <div className="mb-[14px]">
        <Notice notice={issuedNotice} />
      </div>
      <Segmented
        aria-label={t("provisioning.tabs")}
        className="mb-[16px]"
        options={tabs}
        value={active}
        onChange={(key) => setTab(key as ProvisioningTab)}
      />
      {active === ProvisioningTab.Templates ? <RoleTemplatesPanel /> : null}
      {active === ProvisioningTab.Import ? <UserImportPanel onIssued={issue} /> : null}
      {active === ProvisioningTab.Clone ? <CloneUserPanel onIssued={issue} /> : null}
    </div>
  );
}
