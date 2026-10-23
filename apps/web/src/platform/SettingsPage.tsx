import { useEffect, useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { ENV_SETTINGS, EnvSettingGroup, EnvSettingKey, EnvSettingKind, EnvSettingSource, type EnvSettingDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { FormError, FormPage, SectionCard, TextField, ToggleField } from "../settings/form-controls";
import { PlatformApiError, usePlatformApi } from "./api";
import { useEnvSettingsQuery, useRestartServerMutation, useSaveEnvSettingsMutation } from "./env-settings-hooks";

const RESTART_POLL_MS = 500;
const RESTART_GIVE_UP_MS = 90_000;
const FLAG_ON = "1";

enum ConfirmAction {
  Save = "save",
  Restart = "restart",
}

enum RestartState {
  Idle = "idle",
  Waiting = "waiting",
  TimedOut = "timed-out",
}

const GROUP_LABEL: Readonly<Record<EnvSettingGroup, AppTranslationKey>> = {
  [EnvSettingGroup.Contact]: "platform.envSettings.group.contact",
  [EnvSettingGroup.Site]: "platform.envSettings.group.site",
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
  [EnvSettingKey.PublicLanding]: "platform.envSettings.key.publicLanding",
};

type Edits = Partial<Record<EnvSettingKey, string | null>>;

const errorText = (err: unknown, fallback: string): string => (err instanceof PlatformApiError ? err.message : fallback);

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
  const [restartState, setRestartState] = useState<RestartState>(RestartState.Idle);

  useEffect(() => {
    if (restartState !== RestartState.Waiting) return;
    const startedAt = Date.now();
    let wentDown = false;
    const timer = setInterval(() => {
      if (Date.now() - startedAt > RESTART_GIVE_UP_MS) {
        clearInterval(timer);
        setRestartState(RestartState.TimedOut);
        return;
      }
      void fetch("/healthz", { cache: "no-store" })
        .then((res) => {
          if (!res.ok) wentDown = true;
          else if (wentDown) window.location.reload();
        })
        .catch(() => {
          wentDown = true;
        });
    }, RESTART_POLL_MS);
    return () => clearInterval(timer);
  }, [restartState]);

  const settings = query.data?.settings ?? [];
  const changedCount = Object.keys(edits).length;

  function edit(setting: EnvSettingDTO, value: string | null) {
    setEdits((current) => {
      const next = { ...current };
      if (value !== null && value === (setting.value ?? "")) delete next[setting.key];
      else next[setting.key] = value;
      return next;
    });
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
      const sent = edits;
      save.mutate(
        { password: typed, changes: sent },
        {
          onSuccess: () =>
            setEdits((current) => {
              const next = { ...current };
              for (const key of Object.values(EnvSettingKey)) if (key in sent && next[key] === sent[key]) delete next[key];
              return next;
            }),
          onError: (err) => setError(errorText(err, t("platform.envSettings.saveFailed"))),
        },
      );
    } else if (action === ConfirmAction.Restart) {
      restart.mutate(
        { password: typed },
        { onSuccess: () => setRestartState(RestartState.Waiting), onError: (err) => setError(errorText(err, t("platform.envSettings.restartFailed"))) },
      );
    }
  }

  if (query.isError && !query.data) {
    return (
      <FormPage eyebrow={t("platform.nav.settings")} title={t("platform.envSettings.title")}>
        <FormError message={query.error.message} />
      </FormPage>
    );
  }

  const locked = !isOwner || save.isPending || restartState !== RestartState.Idle;

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
            <Button variant="primary" disabled={changedCount === 0 || locked} onClick={() => setConfirming(ConfirmAction.Save)}>
              {save.isPending ? t("platform.envSettings.saving") : t("platform.envSettings.save")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-[16px]">
        <FormError message={error} />
        {query.isError ? <FormError message={query.error.message} /> : null}
        {isOwner && changedCount > 0 && query.data?.restartPending ? <p className="text-[12px] text-ink-muted">{t("platform.envSettings.saveBeforeRestart")}</p> : null}
        {query.data?.loadError ? <FormError message={t("platform.envSettings.loadError", { reason: query.data.loadError })} /> : null}
        {restartState === RestartState.Waiting ? (
          <p role="status" className="rounded-md border border-border bg-surface-2 p-[12px] text-[13px] font-semibold text-ink">
            {t("platform.envSettings.restarting")}
          </p>
        ) : restartState === RestartState.TimedOut ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-[10px] rounded-md border border-warning bg-warning-soft p-[12px]">
            <p className="text-[13px] font-semibold text-warning-ink">{t("platform.envSettings.restartTimedOut")}</p>
            <Button size="sm" onClick={() => window.location.reload()}>
              {t("platform.envSettings.reload")}
            </Button>
          </div>
        ) : query.data?.restartPending ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-[10px] rounded-md border border-warning bg-warning-soft p-[12px]">
            <p className="text-[13px] font-semibold text-warning-ink">{t("platform.envSettings.restartPending")}</p>
            {isOwner ? (
              <Button variant="primary" size="sm" disabled={restart.isPending || changedCount > 0} onClick={() => setConfirming(ConfirmAction.Restart)}>
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
                  readOnly={locked}
                  onChange={(v) => edit(setting, v)}
                />
              ))}
          </SectionCard>
        ))}
        <p className="text-[12px] text-ink-muted">{t("platform.envSettings.envOnly")}</p>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === ConfirmAction.Restart ? t("platform.envSettings.restartConfirm.title") : t("platform.envSettings.saveConfirm.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>
              {confirming === ConfirmAction.Restart
                ? t("platform.envSettings.restartConfirm.consequence")
                : t("platform.envSettings.saveConfirm.consequence", { count: changedCount })}
            </p>
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
  const kind = ENV_SETTINGS[setting.key].kind;
  const label = t(LABEL[setting.key]);
  const status = !edited ? t(SOURCE_LABEL[setting.source]) : value === null ? t("platform.envSettings.willReset") : t("platform.envSettings.edited");
  const hint = `${setting.key} · ${status}`;
  const shown = edited ? (value ?? "") : (setting.value ?? "");
  const canReset = !readOnly && setting.source === EnvSettingSource.Override && !(edited && value === null);

  return (
    <div className="flex flex-col gap-[4px]">
      {kind === EnvSettingKind.Flag ? (
        <ToggleField label={label} hint={hint} checked={shown === FLAG_ON} disabled={readOnly} onChange={(on) => onChange(on ? FLAG_ON : "")} />
      ) : (
        <TextField label={label} hint={hint} type={kind === EnvSettingKind.Email ? "email" : "text"} value={shown} disabled={readOnly} onChange={onChange} />
      )}
      {canReset ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {t("platform.envSettings.resetToEnvFile")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
