import { useState } from "react";
import { Button, Card, ConfirmDialog, StatusPill, useFormat } from "@mezan/ui";
import {
  TENANT_EXPORT_MIN_PASSPHRASE_LENGTH,
  TenantBackupDrillOutcome,
  TenantBackupRefusal,
  TenantWireStatus,
  type TenantBackupDrillResultDTO,
  type TenantDTO,
  type TenantExportOfferDTO,
} from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { SelectField, TextAreaField, TextField } from "../settings/form-controls";
import { PlatformApiError } from "./api";
import { useBackupDrillMutation, useDownloadTenantExportMutation, useExportTenantBackupMutation, useTenantBackupsQuery } from "./hooks";

const LATEST = "";
const BYTES_PER_MB = 1024 * 1024;

function isLive(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

export function TenantBackupCard({ tenant, isOwner, booksRefused, onError }: { tenant: TenantDTO; isOwner: boolean; booksRefused: boolean; onError: (err: unknown) => void }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const enabled = isOwner && isLive(tenant) && !booksRefused;
  const backups = useTenantBackupsQuery(tenant.id, enabled);
  const exportBackup = useExportTenantBackupMutation();
  const download = useDownloadTenantExportMutation();
  const drill = useBackupDrillMutation();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [offer, setOffer] = useState<TenantExportOfferDTO | null>(null);
  const [chosen, setChosen] = useState(LATEST);
  const [result, setResult] = useState<TenantBackupDrillResultDTO | null>(null);

  if (!enabled) return null;

  const files = backups.data?.backups ?? [];
  const closeDialog = () => {
    setAsking(false);
    setReason("");
    setPassphrase("");
    setAgain("");
  };
  const passphraseError =
    passphrase !== "" && passphrase.length < TENANT_EXPORT_MIN_PASSPHRASE_LENGTH
      ? t("platform.backup.export.passphraseShort", { min: format.number(TENANT_EXPORT_MIN_PASSPHRASE_LENGTH) })
      : again !== "" && again !== passphrase
        ? t("platform.backup.export.passphraseMismatch")
        : undefined;
  const ready = reason.trim() !== "" && passphrase.length >= TENANT_EXPORT_MIN_PASSPHRASE_LENGTH && again === passphrase;

  const submitExport = () => {
    if (!ready || exportBackup.isPending) return;
    const body = { reason: reason.trim(), passphrase };
    closeDialog();
    setOffer(null);
    exportBackup.mutate({ tenantId: tenant.id, body }, { onSuccess: setOffer, onError });
  };

  const downloadOffer = () => {
    if (!offer || download.isPending) return;
    download.mutate(
      { downloadPath: offer.downloadPath, fileName: offer.fileName },
      {
        onSuccess: () => setOffer(null),
        onError: (err) => {
          if (err instanceof PlatformApiError && err.code === TenantBackupRefusal.ExportGone) setOffer(null);
          onError(err);
        },
      },
    );
  };

  const runDrill = () => {
    if (drill.isPending) return;
    setResult(null);
    drill.mutate({ tenantId: tenant.id, body: chosen === LATEST ? {} : { file: chosen } }, { onSuccess: setResult, onError });
  };

  const options = [
    { value: LATEST, label: t("platform.backup.drill.latest") },
    ...files.map((f) => ({ value: f.file, label: `${format.dateTime(f.createdAt)} · ${format.number(Math.max(1, Math.round(f.bytes / BYTES_PER_MB)))} MB` })),
  ];

  return (
    <Card className="flex flex-col gap-[14px] p-[14px_16px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="font-display text-[14px] font-bold text-ink">{t("platform.backup.title")}</h2>
        <p className="max-w-[72ch] text-[12.5px] leading-[1.8] text-ink-muted">{t("platform.backup.hint")}</p>
      </div>

      <section className="flex flex-col gap-[8px]" aria-label={t("platform.backup.export.section")}>
        <h3 className="text-[13px] font-bold text-ink">{t("platform.backup.export.section")}</h3>
        <p className="max-w-[72ch] text-[12.5px] leading-[1.8] text-ink-muted">{t("platform.backup.export.hint")}</p>
        <div>
          <Button size="sm" disabled={exportBackup.isPending} onClick={() => setAsking(true)}>
            {exportBackup.isPending ? t("platform.backup.export.preparing") : t("platform.backup.export.button")}
          </Button>
        </div>
        {offer ? (
          <div role="status" className="flex flex-col gap-[8px] rounded-md border border-border bg-surface-2 p-[10px_12px]">
            <p className="text-[13px] font-semibold text-ink">{t("platform.backup.offer.ready")}</p>
            <p className="text-[12.5px] text-ink-muted">
              <span dir="ltr" className="mz-lat break-all">{offer.fileName}</span>
              {" · "}
              {t("platform.backup.offer.facts", {
                size: format.number(Math.max(1, Math.round(offer.bytes / BYTES_PER_MB))),
                rows: format.number(offer.totalRows),
                tables: format.number(offer.tableCount),
              })}
            </p>
            <p className="text-[12px] text-warning-ink">{t("platform.backup.offer.once", { time: format.time(offer.expiresAt) })}</p>
            <p className="max-w-[72ch] text-[12px] text-ink-muted">{t("platform.backup.offer.howTo")}</p>
            <div>
              <Button variant="primary" size="sm" disabled={download.isPending} onClick={downloadOffer}>
                {download.isPending ? t("platform.backup.offer.downloading") : t("platform.backup.offer.download")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-[8px] border-t border-border pt-[12px]" aria-label={t("platform.backup.drill.title")}>
        <h3 className="text-[13px] font-bold text-ink">{t("platform.backup.drill.title")}</h3>
        <p className="max-w-[72ch] text-[12.5px] leading-[1.8] text-ink-muted">{t("platform.backup.drill.hint")}</p>
        {backups.isError ? (
          <p className="text-[12.5px] font-semibold text-danger-ink">{backups.error.message}</p>
        ) : files.length === 0 && !backups.isLoading ? (
          <p className="text-[12.5px] text-ink-muted">{t("platform.backup.drill.none")}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="min-w-[220px] flex-1">
              <SelectField label={t("platform.backup.drill.pick")} value={chosen} onChange={setChosen} options={options} />
            </div>
            <Button size="sm" disabled={drill.isPending || backups.isLoading} onClick={runDrill}>
              {drill.isPending ? t("platform.backup.drill.running") : t("platform.backup.drill.run")}
            </Button>
          </div>
        )}
        {result ? (
          <div role="status" className="flex flex-col gap-[6px] rounded-md border border-border bg-surface-2 p-[10px_12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill
                label={result.outcome === TenantBackupDrillOutcome.Pass ? t("platform.backup.drill.pass") : t("platform.backup.drill.fail")}
                tone={result.outcome === TenantBackupDrillOutcome.Pass ? "success" : "danger"}
              />
              <span dir="ltr" className="mz-lat break-all text-[12px] text-ink-muted">{result.file}</span>
            </div>
            {result.outcome === TenantBackupDrillOutcome.Pass ? (
              <>
                <p className="text-[12.5px] text-ink">
                  {t("platform.backup.drill.summary", {
                    tables: format.number(result.tableCount),
                    rows: format.number(result.totalRows),
                    empty: format.number(result.emptyTables),
                  })}
                </p>
                {result.largestTables.length > 0 ? (
                  <p className="text-[12px] text-ink-muted">
                    {t("platform.backup.drill.largest")}:{" "}
                    {result.largestTables.map((table) => `${table.name} (${format.number(table.rows)})`).join("، ")}
                  </p>
                ) : null}
              </>
            ) : (
              <p dir="auto" className="text-[12.5px] font-semibold text-danger-ink">{result.report}</p>
            )}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={asking}
        title={t("platform.backup.export.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.backup.export.consequence")}</p>
            <TextAreaField label={t("platform.tenantDetail.reason")} value={reason} onChange={setReason} placeholder={t("platform.tenantDetail.reasonHint")} rows={2} />
            <TextField label={t("platform.backup.export.passphrase")} value={passphrase} onChange={setPassphrase} type="password" autoComplete="new-password" hint={t("platform.backup.export.passphraseHint")} />
            <TextField label={t("platform.backup.export.passphraseAgain")} value={again} onChange={setAgain} type="password" autoComplete="new-password" error={passphraseError} />
          </div>
        }
        confirmLabel={t("platform.backup.export.confirm")}
        tone="danger"
        confirmDisabled={!ready}
        onConfirm={submitExport}
        onCancel={closeDialog}
      />
    </Card>
  );
}
