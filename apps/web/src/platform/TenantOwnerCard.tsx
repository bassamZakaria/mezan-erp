import { useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { TenantWireStatus, type OwnerCandidateDTO, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { OwnerContactChip } from "./chips";
import type { PlatformApiError } from "./api";
import { useAssignOwnerMutation, useConfirmPendingOwnerMutation, useOwnerCandidates } from "./hooks";

function canAssignOwner(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

export function TenantOwnerCard({ tenant, isOwner, onError }: { tenant: TenantDTO; isOwner: boolean; onError: (err: PlatformApiError) => void }) {
  const { t } = useAppTranslation();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<OwnerCandidateDTO | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [confirmingPending, setConfirmingPending] = useState(false);
  const actionable = isOwner && canAssignOwner(tenant);
  const candidates = useOwnerCandidates(tenant.id, actionable && picking);
  const assignOwner = useAssignOwnerMutation();
  const confirmPending = useConfirmPendingOwnerMutation();
  const pending = tenant.pendingOwner;

  const assign = (candidate: OwnerCandidateDTO) => {
    if (assigningId !== null) return;
    setAssigningId(candidate.id);
    assignOwner.mutate(
      { tenantId: tenant.id, userId: candidate.id },
      { onSuccess: () => setPicking(false), onError, onSettled: () => setAssigningId(null) },
    );
  };

  return (
    <div>
      <p className="mt-[2px] flex flex-wrap items-center gap-[8px] text-[12.5px] text-ink-muted">
        <span>{t("platform.tenantDetail.ownerEmail")}: {tenant.ownerEmail}</span>
        <OwnerContactChip tenant={tenant} />
        {actionable ? (
          <Button variant="default" size="sm" onClick={() => setPicking((open) => !open)}>
            {t("platform.tenantDetail.owner.assign")}
          </Button>
        ) : null}
      </p>
      {tenant.ownerNeeded ? <p className="mt-[2px] text-[12px] text-danger-ink">{t("platform.tenantDetail.owner.neededHint")}</p> : null}
      {tenant.ownerContactVerified ? null : <p className="mt-[2px] text-[12px] text-warning-ink">{t("platform.tenantDetail.ownerUnverifiedHint")}</p>}
      {pending ? (
        <p className="mt-[4px] flex flex-wrap items-center gap-[8px] text-[12px] text-warning-ink">
          <span>{t("platform.tenantDetail.owner.pendingHint", { email: pending.email })}</span>
          {actionable ? (
            <Button variant="default" size="sm" disabled={confirmPending.isPending} onClick={() => setConfirmingPending(true)}>
              {t("platform.tenantDetail.owner.confirmPending")}
            </Button>
          ) : null}
        </p>
      ) : null}
      {actionable && picking ? (
        <div className="mt-[8px] rounded-md border border-border bg-surface-2 p-[10px_12px]">
          <p className="text-[12.5px] font-semibold text-ink">{t("platform.tenantDetail.owner.pick")}</p>
          {candidates.isPending ? <p className="mt-[6px] text-[12.5px] text-ink-muted">{t("platform.tenantDetail.owner.loading")}</p> : null}
          {candidates.isError ? (
            <p role="alert" className="mt-[6px] text-[12.5px] text-danger-ink">
              {t("platform.tenantDetail.owner.loadFailed")}
            </p>
          ) : null}
          {candidates.data && candidates.data.length === 0 ? <p className="mt-[6px] text-[12.5px] text-ink-muted">{t("platform.tenantDetail.owner.none")}</p> : null}
          <ul className="mt-[6px] flex flex-col gap-[6px]">
            {(candidates.data ?? []).map((candidate) => (
              <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-[8px] text-[12.5px]">
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{candidate.nameAr}</span> <span className="mz-lat break-all text-ink-muted">{candidate.email}</span>
                </span>
                <Button variant="default" size="sm" disabled={assigningId === candidate.id} onClick={() => setChosen(candidate)}>
                  {t("platform.tenantDetail.owner.assignThis")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={chosen !== null}
        title={t("platform.tenantDetail.owner.confirmAssign.title")}
        consequence={t("platform.tenantDetail.owner.confirmAssign.consequence", { name: chosen?.nameAr ?? "", email: chosen?.email ?? "" })}
        confirmLabel={t("platform.tenantDetail.owner.confirmAssign.confirm")}
        tone="danger"
        onConfirm={() => {
          const candidate = chosen;
          setChosen(null);
          if (candidate) assign(candidate);
        }}
        onCancel={() => setChosen(null)}
      />
      <ConfirmDialog
        open={confirmingPending}
        title={t("platform.tenantDetail.owner.confirmPending.title")}
        consequence={t("platform.tenantDetail.owner.confirmPending.consequence", { from: tenant.ownerEmail, to: pending?.email ?? "" })}
        confirmLabel={t("platform.tenantDetail.owner.confirmPending.confirm")}
        tone="danger"
        onConfirm={() => {
          setConfirmingPending(false);
          confirmPending.mutate(tenant.id, { onError });
        }}
        onCancel={() => setConfirmingPending(false)}
      />
    </div>
  );
}
