import { useState } from "react";
import { Button, Card, ConfirmDialog, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import { STEP_UP_REASON_MIN_LENGTH, TenantAnchorState, TenantWireStatus, type AcceptAuditRestoreResultDTO, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { TextAreaField, TextField } from "../settings/form-controls";
import { useAcceptAuditRestoreMutation, useTenantAuditAnchorQuery } from "./lifecycle-hooks";

const TONE: Readonly<Record<TenantAnchorState, PillTone>> = {
  [TenantAnchorState.Anchoring]: "success",
  [TenantAnchorState.UpToDate]: "success",
  [TenantAnchorState.NoChain]: "neutral",
  [TenantAnchorState.Refused]: "danger",
  [TenantAnchorState.Disabled]: "warning",
};

function isLive(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

export function TenantAuditAnchorCard({ tenant, isOwner, booksRefused, onError }: { tenant: TenantDTO; isOwner: boolean; booksRefused: boolean; onError: (err: unknown) => void }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const enabled = isOwner && isLive(tenant) && !booksRefused;
  const anchor = useTenantAuditAnchorQuery(tenant.id, enabled);
  const accept = useAcceptAuditRestoreMutation();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<AcceptAuditRestoreResultDTO | null>(null);

  if (!enabled) return null;
  const status = anchor.data;

  const close = () => {
    setAsking(false);
    setReason("");
    setPassword("");
  };
  const reasonError = reason !== "" && reason.trim().length < STEP_UP_REASON_MIN_LENGTH ? t("platform.lifecycle.reasonShort") : undefined;
  const ready = reason.trim().length >= STEP_UP_REASON_MIN_LENGTH && password !== "";
  const submit = () => {
    if (!ready || accept.isPending) return;
    const body = { reason: reason.trim(), password };
    close();
    accept.mutate({ tenantId: tenant.id, body }, { onSuccess: setDone, onError });
  };

  return (
    <Card className="flex flex-col gap-[10px] p-[14px_16px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="font-display text-[14px] font-bold text-ink">{t("platform.anchor.title")}</h2>
        <p className="max-w-[72ch] text-[12.5px] leading-[1.8] text-ink-muted">{t("platform.anchor.hint")}</p>
      </div>
      {anchor.isError ? <p className="text-[12.5px] font-semibold text-danger-ink">{anchor.error.message}</p> : null}
      {status ? (
        <div className="flex flex-col gap-[8px]">
          <div>
            <StatusPill label={t(`platform.anchor.state.${status.state}`)} tone={TONE[status.state]} />
          </div>
          {status.latestAnchoredSeq !== null && status.latestAnchoredAt !== null ? (
            <p className="text-[12.5px] text-ink-muted">
              {t("platform.anchor.facts", {
                seq: format.number(status.latestAnchoredSeq),
                at: format.dateTime(status.latestAnchoredAt),
                head: status.liveHeadSeq === null ? "—" : format.number(status.liveHeadSeq),
              })}
            </p>
          ) : null}
          {status.refusal ? <p role="alert" className="max-w-[72ch] text-[12.5px] font-semibold leading-[1.8] text-danger-ink">{t(`platform.anchor.refusal.${status.refusal}`)}</p> : null}
          {status.lastRebase ? (
            <p dir="auto" className="max-w-[72ch] text-[12.5px] leading-[1.8] text-ink-muted">
              {t("platform.anchor.rebase", {
                at: format.dateTime(status.lastRebase.anchoredAt),
                by: status.lastRebase.acceptedBy,
                reason: status.lastRebase.reason,
                seq: format.number(status.lastRebase.supersededSeq),
              })}
            </p>
          ) : null}
          {done ? <p role="status" className="text-[12.5px] font-semibold text-success-ink">{t("platform.anchor.accept.done", { seq: format.number(done.seq) })}</p> : null}
          {status.canAcceptRestore ? (
            <div>
              <Button variant="danger-outline" size="sm" disabled={accept.isPending} onClick={() => setAsking(true)}>
                {t("platform.anchor.accept.button")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={asking}
        title={t("platform.anchor.accept.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.anchor.accept.consequence")}</p>
            <TextAreaField label={t("platform.anchor.accept.reason")} value={reason} onChange={setReason} placeholder={t("platform.anchor.accept.reasonHint")} rows={2} hint={reasonError} />
            <TextField label={t("platform.anchor.accept.password")} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          </div>
        }
        confirmLabel={t("platform.anchor.accept.confirm")}
        tone="danger"
        confirmDisabled={!ready}
        onConfirm={submit}
        onCancel={close}
      />
    </Card>
  );
}
