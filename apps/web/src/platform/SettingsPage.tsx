import { useEffect, useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import {
  ENV_SETTINGS,
  EnvReadOnlyKey,
  EnvSettingGroup,
  EnvSettingKey,
  EnvSettingKind,
  EnvSettingSource,
  type EnvSettingDTO,
} from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { FormError, FormPage, SectionCard, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { PlatformApiError, usePlatformApi } from "./api";
import { useEnvSettingsQuery, useRestartServerMutation, useSaveEnvSettingsMutation } from "./env-settings-hooks";

const RESTART_POLL_MS = 2000;

enum ConfirmAction {
  Save = "save",
  Restart = "restart",
}
const FLAG_ON = "1";

const GROUP_LABEL: Readonly<Record<EnvSettingGroup, AppTranslationKey>> = {
  [EnvSettingGroup.Contact]: "platform.envSettings.group.contact",
  [EnvSettingGroup.Site]: "platform.envSettings.group.site",
  [EnvSettingGroup.Mail]: "platform.envSettings.group.mail",
  [EnvSettingGroup.Payments]: "platform.envSettings.group.payments",
  [EnvSettingGroup.Operations]: "platform.envSettings.group.operations",
  [EnvSettingGroup.Network]: "platform.envSettings.group.network",
  [EnvSettingGroup.Demo]: "platform.envSettings.group.demo",
};

const SOURCE_LABEL: Readonly<Record<EnvSettingSource, AppTranslationKey>> = {
  [EnvSettingSource.Override]: "platform.envSettings.source.override",
  [EnvSettingSource.EnvFile]: "platform.envSettings.source.envFile",
  [EnvSettingSource.Unset]: "platform.envSettings.source.unset",
};

const LABEL: Readonly<Record<EnvSettingKey, AppTranslationKey>> = {
  [EnvSettingKey.SupportEmail]: "platform.envSettings.key.supportEmail",
  [EnvSettingKey.SupportPhone]: "platform.envSettings.key.supportPhone",
  [EnvSettingKey.WhatsappNumber]: "platform.envSettings.key.whatsappNumber",
  [EnvSettingKey.AlertEmail]: "platform.envSettings.key.alertEmail",
  [EnvSettingKey.PublicLanding]: "platform.envSettings.key.publicLanding",
  [EnvSettingKey.PublicUrl]: "platform.envSettings.key.publicUrl",
  [EnvSettingKey.TenantDomain]: "platform.envSettings.key.tenantDomain",
  [EnvSettingKey.AnalyticsToken]: "platform.envSettings.key.analyticsToken",
  [EnvSettingKey.SmtpHost]: "platform.envSettings.key.smtpHost",
  [EnvSettingKey.SmtpPort]: "platform.envSettings.key.smtpPort",
  [EnvSettingKey.SmtpSecurity]: "platform.envSettings.key.smtpSecurity",
  [EnvSettingKey.SmtpUsername]: "platform.envSettings.key.smtpUsername",
  [EnvSettingKey.SmtpPassword]: "platform.envSettings.key.smtpPassword",
  [EnvSettingKey.SmtpFromEmail]: "platform.envSettings.key.smtpFromEmail",
  [EnvSettingKey.SmtpFromName]: "platform.envSettings.key.smtpFromName",
  [EnvSettingKey.PaymobSecretKey]: "platform.envSettings.key.paymobSecretKey",
  [EnvSettingKey.PaymobPublicKey]: "platform.envSettings.key.paymobPublicKey",
  [EnvSettingKey.PaymobHmacSecret]: "platform.envSettings.key.paymobHmacSecret",
  [EnvSettingKey.PaymobIntegrationId]: "platform.envSettings.key.paymobIntegrationId",
  [EnvSettingKey.PaymobApiKey]: "platform.envSettings.key.paymobApiKey",
  [EnvSettingKey.PaymobPublicUrl]: "platform.envSettings.key.paymobPublicUrl",
  [EnvSettingKey.PaymobBaseUrl]: "platform.envSettings.key.paymobBaseUrl",
  [EnvSettingKey.PaymobTestMode]: "platform.envSettings.key.paymobTestMode",
  [EnvSettingKey.PaymobNotFoundConfirmed]: "platform.envSettings.key.paymobNotFoundConfirmed",
  [EnvSettingKey.BackupIntervalMinutes]: "platform.envSettings.key.backupIntervalMinutes",
  [EnvSettingKey.TenantRetentionDays]: "platform.envSettings.key.tenantRetentionDays",
  [EnvSettingKey.AuditAnchorIntervalMinutes]: "platform.envSettings.key.auditAnchorIntervalMinutes",
  [EnvSettingKey.AuditAnchorDir]: "platform.envSettings.key.auditAnchorDir",
  [EnvSettingKey.AuditAnchorPublicKey]: "platform.envSettings.key.auditAnchorPublicKey",
  [EnvSettingKey.AuditAnchorTrustedPublicKeys]: "platform.envSettings.key.auditAnchorTrustedPublicKeys",
  [EnvSettingKey.AuditAnchorS3Bucket]: "platform.envSettings.key.auditAnchorS3Bucket",
  [EnvSettingKey.AuditAnchorS3Region]: "platform.envSettings.key.auditAnchorS3Region",
  [EnvSettingKey.AuditAnchorS3Endpoint]: "platform.envSettings.key.auditAnchorS3Endpoint",
  [EnvSettingKey.AuditAnchorS3Prefix]: "platform.envSettings.key.auditAnchorS3Prefix",
  [EnvSettingKey.TrustProxy]: "platform.envSettings.key.trustProxy",
  [EnvSettingKey.TrustedProxyHops]: "platform.envSettings.key.trustedProxyHops",
  [EnvSettingKey.OriginSecret]: "platform.envSettings.key.originSecret",
  [EnvSettingKey.SeedDemo]: "platform.envSettings.key.seedDemo",
  [EnvSettingKey.DemoPassword]: "platform.envSettings.key.demoPassword",
  [EnvSettingKey.ReviewTenantCode]: "platform.envSettings.key.reviewTenantCode",
  [EnvSettingKey.ReviewPin]: "platform.envSettings.key.reviewPin",
};

type Edits = Partial<Record<EnvSettingKey, string | null>>;

const errorText = (err: unknown, fallback: string): string => (err instanceof PlatformApiError ? err.message : fallback);

/** «إعدادات الخادم» — the server's environment, changed from the console and applied when the server restarts. */
export function SettingsPage() {
  const { t } = useAppTranslation();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const query = useEnvSettingsQuery();
  const save = useSaveEnvSettingsMutation();
  const restart = useRestartServerMutation();
  const [edits, setEdits] = useState<Edits>({});
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!restarting) return;
    let wentDown = false;
    const timer = setInterval(() => {
      void fetch("/healthz", { cache: "no-store" })
        .then((res) => {
          if (res.ok && wentDown) window.location.reload();
          if (!res.ok) wentDown = true;
        })
        .catch(() => {
          wentDown = true;
        });
    }, RESTART_POLL_MS);
    return () => clearInterval(timer);
  }, [restarting]);

  const settings = query.data?.settings ?? [];
  const changedCount = Object.keys(edits).length;

  function edit(key: EnvSettingKey, value: string | null) {
    setEdits((current) => ({ ...current, [key]: value }));
  }

  function closeDialog() {
    setConfirming(null);
    setPassword("");
  }

  function submit() {
    const action = confirming;
    const typed = password;
    closeDialog();
    setError(null);
    if (action === ConfirmAction.Save) {
      save.mutate({ password: typed, changes: edits }, { onSuccess: () => setEdits({}), onError: (err) => setError(errorText(err, t("platform.envSettings.saveFailed"))) });
    } else if (action === ConfirmAction.Restart) {
      restart.mutate({ password: typed }, { onSuccess: () => setRestarting(true), onError: (err) => setError(errorText(err, t("platform.envSettings.restartFailed"))) });
    }
  }

  if (query.isError) {
    return (
      <FormPage eyebrow={t("platform.nav.settings")} title={t("platform.envSettings.title")}>
        <FormError message={query.error.message} />
      </FormPage>
    );
  }

  return (
    <FormPage
      eyebrow={t("platform.nav.settings")}
      title={t("platform.envSettings.title")}
      description={t("platform.envSettings.description")}
      actions={
        isOwner ? (
          <>
            <Button variant="ghost" disabled={changedCount === 0 || save.isPending} onClick={() => setEdits({})}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={changedCount === 0 || save.isPending} onClick={() => setConfirming(ConfirmAction.Save)}>
              {save.isPending ? t("platform.envSettings.saving") : t("platform.envSettings.save")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-[16px]">
        <FormError message={error} />
        {restarting ? (
          <p role="status" className="rounded-md border border-border bg-surface-2 p-[12px] text-[13px] font-semibold text-ink">
            {t("platform.envSettings.restarting")}
          </p>
        ) : query.data?.restartPending ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-[10px] rounded-md border border-warning bg-warning-soft p-[12px]">
            <p className="text-[13px] font-semibold text-warning-ink">{t("platform.envSettings.restartPending")}</p>
            {isOwner ? (
              <Button variant="primary" size="sm" disabled={restart.isPending} onClick={() => setConfirming(ConfirmAction.Restart)}>
                {t("platform.envSettings.restart")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {Object.values(EnvSettingGroup).map((group) => (
          <SectionCard key={group} title={t(GROUP_LABEL[group])}>
            {settings
              .filter((s) => ENV_SETTINGS[s.key].group === group)
              .map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  edited={setting.key in edits}
                  value={edits[setting.key]}
                  readOnly={!isOwner}
                  onChange={(v) => edit(setting.key, v)}
                />
              ))}
          </SectionCard>
        ))}

        <SectionCard title={t("platform.envSettings.readOnly.title")} description={t("platform.envSettings.readOnly.description")} columns={1}>
          <ul className="flex flex-col gap-[6px] text-[12.5px]">
            {(query.data?.readOnly ?? []).map((row) => (
              <li key={row.key} className="flex flex-wrap items-center justify-between gap-[10px]">
                <span className="mz-lat font-mono text-[12px] text-ink">{row.key}</span>
                <span className="text-ink-muted">{row.hasValue ? t("platform.envSettings.hasValue") : t("platform.envSettings.source.unset")}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-muted">{t("platform.envSettings.recovery", { file: "env-overrides.json", key: EnvReadOnlyKey.PlatformDir })}</p>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === ConfirmAction.Restart ? t("platform.envSettings.restartConfirm.title") : t("platform.envSettings.saveConfirm.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{confirming === ConfirmAction.Restart ? t("platform.envSettings.restartConfirm.consequence") : t("platform.envSettings.saveConfirm.consequence", { count: changedCount })}</p>
            <TextField label={t("platform.envSettings.password")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </div>
        }
        confirmLabel={confirming === ConfirmAction.Restart ? t("platform.envSettings.restart") : t("platform.envSettings.save")}
        tone={confirming === ConfirmAction.Restart ? "danger" : undefined}
        confirmDisabled={password === ""}
        onConfirm={submit}
        onCancel={closeDialog}
      />
    </FormPage>
  );
}

function SettingField({
  setting,
  edited,
  value,
  readOnly,
  onChange,
}: {
  setting: EnvSettingDTO;
  edited: boolean;
  value: string | null | undefined;
  readOnly: boolean;
  onChange: (value: string | null) => void;
}) {
  const { t } = useAppTranslation();
  const spec = ENV_SETTINGS[setting.key];
  const label = t(LABEL[setting.key]);
  const status = !edited
    ? t(SOURCE_LABEL[setting.source])
    : value === null
      ? t("platform.envSettings.willReset")
      : value === "" && spec.secret
        ? t("platform.envSettings.willClear")
        : t("platform.envSettings.edited");
  const hint = `${setting.key} · ${status}`;
  const shown = edited ? (value ?? "") : (setting.value ?? "");
  const canReset = !readOnly && setting.source === EnvSettingSource.Override && !(edited && value === null);
  const canClear = !readOnly && spec.secret === true && setting.hasValue && !(edited && value === "");
  const reset =
    canReset || canClear ? (
      <div className="flex flex-wrap gap-[6px]">
        {canReset ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {t("platform.envSettings.resetToEnvFile")}
          </Button>
        ) : null}
        {canClear ? (
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>
            {t("platform.envSettings.clearSecret")}
          </Button>
        ) : null}
      </div>
    ) : null;

  let control;
  if (spec.kind === EnvSettingKind.Flag) {
    control = <ToggleField label={label} hint={hint} checked={shown === FLAG_ON} disabled={readOnly} onChange={(on) => onChange(on ? FLAG_ON : "")} />;
  } else if (spec.kind === EnvSettingKind.Choice) {
    control = (
      <SelectField
        label={label}
        hint={hint}
        value={shown}
        disabled={readOnly}
        onChange={onChange}
        options={(spec.choices ?? []).map((choice) => ({ value: choice, label: choice }))}
      />
    );
  } else if (spec.secret) {
    control = (
      <TextField
        label={label}
        hint={`${hint} · ${setting.hasValue ? t("platform.envSettings.hasValue") : t("platform.envSettings.source.unset")}`}
        type="password"
        autoComplete="new-password"
        value={edited ? (value ?? "") : ""}
        placeholder={t("platform.envSettings.secretPlaceholder")}
        disabled={readOnly}
        onChange={(v) => onChange(v)}
      />
    );
  } else {
    control = (
      <TextField
        label={label}
        hint={hint}
        type={spec.kind === EnvSettingKind.Number ? "number" : spec.kind === EnvSettingKind.Email ? "email" : "text"}
        value={shown}
        disabled={readOnly}
        onChange={(v) => onChange(v)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[4px]">
      {control}
      {reset}
    </div>
  );
}
