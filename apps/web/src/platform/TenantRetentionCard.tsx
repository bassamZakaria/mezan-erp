import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, ConfirmDialog, StatusPill, useFormat } from "@mezan/ui";
import { STEP_UP_REASON_MIN_LENGTH, TenantWireStatus, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { TextAreaField, TextField } from "../settings/form-controls";
import { useExtendTenantRetentionMutation, usePurgeTenantNowMutation, useTenantRetentionQuery } from "./lifecycle-hooks";

enum RetentionDialog {
  None = "none",
  Extend = "extend",
  Purge = "purge",
}

const isoDay = (iso: string): string => iso.slice(0, 10);

export function TenantRetentionCard({ tenant, isOwner, onError }: { tenant: TenantDTO; isOwner: boolean; onError: (err: unknown) => void }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const archived = tenant.status === TenantWireStatus.Archived;
  const retention = useTenantRetentionQuery(tenant.id, archived);
  const extend = useExtendTenantRetentionMutation();
  const purge = usePurgeTenantNowMutation();
  const [dialog, setDialog] = useState<RetentionDialog>(RetentionDialog.None);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [until, setUntil] = useState("");
  const [code, setCode] = useState("");

  if (!archived) return null;
  const view = retention.data;
  const schedule = view?.retention ?? null;

  const close = () => {
    setDialog(RetentionDialog.None);
    setReason("");
    setPassword("");
    setUntil("");
    setCode("");
  };
  const reasonReady = reason.trim().length >= STEP_UP_REASON_MIN_LENGTH;
  const reasonHint = reason !== "" && !reasonReady ? t("platform.lifecycle.reasonShort") : undefined;
  const extendReady = reasonReady && password !== "" && schedule !== null && until > isoDay(schedule.deleteAfter);
  const purgeReady = reasonReady && password !== "" && code.trim() === tenant.code;

  const submitExtend = () => {
    if (!extendReady || extend.isPending) return;
    const body = { reason: reason.trim(), password, deleteAfter: until };
    close();
    extend.mutate({ tenantId: tenant.id, body }, { onError });
  };
  const submitPurge = () => {
    if (!purgeReady || purge.isPending) return;
    const body = { reason: reason.trim(), password, confirmCode: code.trim() };
    close();
    purge.mutate({ tenantId: tenant.id, body }, { onSuccess: () => navigate("/platform/tenants"), onError });
  };

  const fields = (
    <>
      <TextAreaField label={t("platform.lifecycle.reason")} value={reason} onChange={setReason} rows={2} hint={reasonHint} />
      <TextField label={t("platform.anchor.accept.password")} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
    </>
  );

  return (
    <Card className="flex flex-col gap-[10px] p-[14px_16px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="font-display text-[14px] font-bold text-ink">{t("platform.retention.title")}</h2>
        <p className="max-w-[72ch] text-[12.5px] leading-[1.8] text-ink-muted">{t("platform.retention.hint", { days: format.number(view?.retentionDays ?? 0) })}</p>
        <p className="max-w-[72ch] text-[12px] leading-[1.8] text-ink-muted">{t("platform.retention.offServer")}</p>
      </div>
      {retention.isError ? <p className="text-[12.5px] font-semibold text-danger-ink">{retention.error.message}</p> : null}
      {schedule ? (
        <div className="flex flex-col gap-[6px]">
          <div>
            <StatusPill label={t("platform.retention.scheduled", { date: format.date(schedule.deleteAfter) })} tone="warning" />
          </div>
          <p className="text-[12.5px] text-ink-muted">{t("platform.retention.since", { date: format.date(schedule.terminatedAt) })}</p>
          {schedule.lastExtension ? (
            <p dir="auto" className="text-[12.5px] text-ink-muted">
              {t("platform.retention.extended", { at: format.dateTime(schedule.lastExtension.at), by: schedule.lastExtension.by, reason: schedule.lastExtension.reason })}
            </p>
          ) : null}
          {isOwner ? (
            <div className="flex flex-wrap gap-[9px]">
              <Button size="sm" disabled={extend.isPending} onClick={() => setDialog(RetentionDialog.Extend)}>
                {t("platform.retention.extend.button")}
              </Button>
              <Button variant="danger-outline" size="sm" disabled={purge.isPending} onClick={() => setDialog(RetentionDialog.Purge)}>
                {t("platform.retention.purge.button")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog === RetentionDialog.Extend}
        title={t("platform.retention.extend.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.retention.extend.consequence")}</p>
            <TextField label={t("platform.retention.extend.until")} type="date" value={until} onChange={setUntil} />
            {fields}
          </div>
        }
        confirmLabel={t("platform.retention.extend.confirm")}
        confirmDisabled={!extendReady}
        onConfirm={submitExtend}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog === RetentionDialog.Purge}
        title={t("platform.retention.purge.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.retention.purge.consequence", { code: tenant.code })}</p>
            <TextField label={t("platform.retention.purge.code")} value={code} onChange={setCode} autoComplete="off" />
            {fields}
          </div>
        }
        confirmLabel={t("platform.retention.purge.confirm")}
        tone="danger"
        confirmDisabled={!purgeReady}
        onConfirm={submitPurge}
        onCancel={close}
      />
    </Card>
  );
}
