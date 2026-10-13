import { useState } from "react";
import { Button, Card, ConfirmDialog } from "@mezan/ui";
import { TenantWireStatus, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { useLockedAccounts, useUnlockTenantAccountMutation } from "./hooks";

function servesSignIn(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

export function TenantLockedAccountsCard({ tenant, isOwner, onError }: { tenant: TenantDTO; isOwner: boolean; onError: (err: unknown) => void }) {
  const { t } = useAppTranslation();
  const locked = useLockedAccounts(tenant.id, isOwner && servesSignIn(tenant));
  const unlock = useUnlockTenantAccountMutation();
  const [asking, setAsking] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const accounts = locked.data?.accounts ?? [];

  if (locked.isError) {
    return (
      <Card className="p-[14px_16px]">
        <p className="text-[13px] font-semibold text-danger-ink">
          {locked.error.message}
        </p>
      </Card>
    );
  }
  if (accounts.length === 0) return null;

  const confirm = (account: string) => {
    setAsking(null);
    if (unlocking !== null) return;
    setUnlocking(account);
    unlock.mutate({ tenantId: tenant.id, account }, { onError, onSettled: () => setUnlocking(null) });
  };

  return (
    <Card className="flex flex-col gap-[10px] p-[14px_16px]">
      <h2 className="font-display text-[14px] font-bold text-ink">{t("platform.tenantDetail.locked.title")}</h2>
      <p className="text-[12.5px] leading-[1.8] text-ink-muted">{t("platform.tenantDetail.locked.hint")}</p>
      <ul className="flex flex-col gap-[8px]">
        {accounts.map((account) => (
          <li key={account} className="flex flex-wrap items-center justify-between gap-[10px] rounded-md border border-border bg-surface-2 p-[8px_12px]">
            <span dir="ltr" className="min-w-0 break-all text-[13px] font-semibold text-ink">
              {account}
            </span>
            <Button size="sm" disabled={unlocking === account} onClick={() => setAsking(account)}>
              {t("platform.tenantDetail.locked.unlock")}
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={asking !== null}
        title={t("platform.tenantDetail.locked.confirm.title")}
        consequence={t("platform.tenantDetail.locked.confirm.consequence", { account: asking ?? "" })}
        confirmLabel={t("platform.tenantDetail.locked.unlock")}
        tone="danger"
        onConfirm={() => asking !== null && confirm(asking)}
        onCancel={() => setAsking(null)}
      />
    </Card>
  );
}
