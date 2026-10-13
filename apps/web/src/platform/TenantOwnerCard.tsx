import { useId, useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { TenantWireStatus, type OwnerCandidateDTO, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { OwnerContactChip } from "./chips";
import { useAssignOwnerMutation, useConfirmPendingOwnerMutation, useDeclinePendingOwnerMutation, useOwnerCandidates, useResendPendingOwnerMutation } from "./hooks";

function canAssignOwner(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

enum PendingOwnerAct {
  Confirm = "confirm",
  Decline = "decline",
  Resend = "resend",
}

function pendingHintKey(pending: NonNullable<TenantDTO["pendingOwner"]>, expired: boolean) {
  if (expired) return "platform.tenantDetail.owner.pendingExpiredHint" as const;
  return pending.linkMailed ? ("platform.tenantDetail.owner.pendingHint" as const) : ("platform.tenantDetail.owner.pendingUnmailedHint" as const);
}

export function TenantOwnerCard({
  tenant,
  isOwner,
  handOverMailConfigured,
  onError,
}: {
  tenant: TenantDTO;
  isOwner: boolean;
  handOverMailConfigured: boolean;
  onError: (err: unknown) => void;
}) {
  const { t } = useAppTranslation();
  const noMailHintId = useId();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<OwnerCandidateDTO | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [asking, setAsking] = useState<PendingOwnerAct.Confirm | PendingOwnerAct.Decline | null>(null);
  const [acting, setActing] = useState<PendingOwnerAct | null>(null);
  const actionable = isOwner && canAssignOwner(tenant);
  const candidates = useOwnerCandidates(tenant.id, actionable && picking);
  const assignOwner = useAssignOwnerMutation();
  const confirmPending = useConfirmPendingOwnerMutation();
  const declinePending = useDeclinePendingOwnerMutation();
  const resendPending = useResendPendingOwnerMutation();
  const pending = tenant.pendingOwner;
  const expired = pending ? new Date(pending.expiresAt).getTime() <= Date.now() : false;

  const actOnPending = (act: PendingOwnerAct) => {
    if (acting !== null) return;
    setActing(act);
    const mutation = act === PendingOwnerAct.Confirm ? confirmPending : act === PendingOwnerAct.Decline ? declinePending : resendPending;
    mutation.mutate(tenant.id, { onError, onSettled: () => setActing(null) });
  };

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
          <span>{t(pendingHintKey(pending, expired), { email: pending.email })}</span>
          {actionable && !expired ? (
            <Button variant="default" size="sm" disabled={acting !== null} onClick={() => setAsking(PendingOwnerAct.Confirm)}>
              {t("platform.tenantDetail.owner.confirmPending")}
            </Button>
          ) : null}
          {actionable ? (
            <Button
              variant="default"
              size="sm"
              disabled={acting !== null || !handOverMailConfigured}
              aria-describedby={handOverMailConfigured ? undefined : noMailHintId}
              onClick={() => actOnPending(PendingOwnerAct.Resend)}
            >
              {t("platform.tenantDetail.owner.resendPending")}
            </Button>
          ) : null}
          {actionable ? (
            <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => setAsking(PendingOwnerAct.Decline)}>
              {t("platform.tenantDetail.owner.declinePending")}
            </Button>
          ) : null}
        </p>
      ) : null}
      {pending && actionable && !handOverMailConfigured ? (
        <p id={noMailHintId} className="mt-[2px] text-[12px] text-ink-muted">
          {t("platform.tenantDetail.owner.resendNoMail")}
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
        open={asking === PendingOwnerAct.Confirm}
        title={t("platform.tenantDetail.owner.confirmPending.title")}
        consequence={t("platform.tenantDetail.owner.confirmPending.consequence", { from: tenant.ownerEmail, to: pending?.email ?? "" })}
        confirmLabel={t("platform.tenantDetail.owner.confirmPending.confirm")}
        tone="danger"
        onConfirm={() => {
          setAsking(null);
          actOnPending(PendingOwnerAct.Confirm);
        }}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === PendingOwnerAct.Decline}
        title={t("platform.tenantDetail.owner.declinePending.title")}
        consequence={t("platform.tenantDetail.owner.declinePending.consequence", { owner: tenant.ownerEmail, to: pending?.email ?? "" })}
        confirmLabel={t("platform.tenantDetail.owner.declinePending.confirm")}
        tone="danger"
        onConfirm={() => {
          setAsking(null);
          actOnPending(PendingOwnerAct.Decline);
        }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
