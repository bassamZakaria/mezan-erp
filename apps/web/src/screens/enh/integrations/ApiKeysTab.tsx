import { useState } from "react";
import { Button, Card, Checkbox, ConfirmDialog, EmptyState, StatusPill, TextInput, useFormat, type PillTone } from "@mezan/ui";
import { ApiKeyStatusDTO, type ApiKeyDTO, type ApiKeyScopeDTO, type IntegrationsCatalogDTO } from "@mezan/contracts";
import { Field } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "./hooks";
import { ErrorNotice, OneTimeSecret } from "./OneTimeSecret";

const STATUS_TONE: Readonly<Record<ApiKeyStatusDTO, PillTone>> = {
  [ApiKeyStatusDTO.Active]: "success",
  [ApiKeyStatusDTO.Expired]: "warning",
  [ApiKeyStatusDTO.Revoked]: "neutral",
};

export function scopeLabelKey(scope: ApiKeyScopeDTO): AppTranslationKey {
  return `integrations.scope.${scope}` as AppTranslationKey;
}

function endOfDayIso(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

function CreateKeyForm({ catalog, onCreated, onCancel }: { catalog: IntegrationsCatalogDTO; onCreated: (token: string) => void; onCancel: () => void }) {
  const { t } = useAppTranslation();
  const create = useCreateApiKey();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<ApiKeyScopeDTO>>(new Set());
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);

  function toggle(scope: ApiKeyScopeDTO, on: boolean) {
    setScopes((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  function submit() {
    if (create.isPending) return;
    if (name.trim() === "" || scopes.size === 0) {
      setError(t("integrations.keys.required"));
      return;
    }
    setError(null);
    create.mutate(
      { name: name.trim(), scopes: [...scopes], expiresAt: expires === "" ? null : endOfDayIso(expires) },
      { onSuccess: (created) => onCreated(created.token), onError: (err) => setError(errorMessage(err, t("integrations.keys.createFailed"))) },
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-[16px_18px]">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("integrations.keys.name")}>
          <TextInput value={name} maxLength={80} placeholder={t("integrations.keys.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t("integrations.keys.expiresAt")}>
          <TextInput type="date" value={expires} onChange={(event) => setExpires(event.target.value)} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">{t("integrations.keys.scopes")}</legend>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {catalog.scopes.map((option) => (
            <Checkbox
              key={option.scope}
              checked={scopes.has(option.scope)}
              disabled={!option.grantable}
              onChange={(event) => toggle(option.scope, event.target.checked)}
              label={t(scopeLabelKey(option.scope))}
              hint={option.grantable ? <span dir="ltr" className="font-mono">{option.scope}</span> : t("integrations.keys.scopeNotGrantable")}
            />
          ))}
        </div>
      </fieldset>
      <ErrorNotice message={error} />
      <div className="flex gap-2">
        <Button variant="primary" disabled={create.isPending} onClick={submit}>
          {create.isPending ? t("integrations.keys.creating") : t("integrations.keys.create")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("integrations.cancel")}
        </Button>
      </div>
    </Card>
  );
}

export function ApiKeysTab({ catalog, mayManage }: { catalog: IntegrationsCatalogDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ApiKeyDTO | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function confirmRevoke() {
    const key = confirming;
    setConfirming(null);
    if (!key || revokingId !== null) return;
    setRevokingId(key.id);
    setError(null);
    revoke.mutate(key.id, {
      onError: (err) => setError(errorMessage(err, t("integrations.keys.revokeFailed"))),
      onSettled: () => setRevokingId(null),
    });
  }

  if (keys.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (keys.isError || !keys.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {keys.error?.message ?? t("integrations.loadFailed")}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-muted">{t("integrations.keys.hint")}</p>
      {token ? <OneTimeSecret title={t("integrations.keys.tokenTitle")} body={t("integrations.keys.tokenBody")} secret={token} onDone={() => setToken(null)} /> : null}
      {mayManage && !creating && !token ? (
        <div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("integrations.keys.add")}
          </Button>
        </div>
      ) : null}
      {creating ? (
        <CreateKeyForm
          catalog={catalog}
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setToken(created);
          }}
        />
      ) : null}
      <ErrorNotice message={error} />
      {keys.data.length === 0 ? (
        <EmptyState title={t("integrations.keys.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                <th className="p-3 text-start">{t("integrations.keys.col.name")}</th>
                <th className="p-3 text-start">{t("integrations.keys.col.prefix")}</th>
                <th className="p-3 text-start">{t("integrations.keys.col.scopes")}</th>
                <th className="p-3 text-start">{t("integrations.keys.col.status")}</th>
                <th className="p-3 text-start">{t("integrations.keys.col.createdBy")}</th>
                <th className="p-3 text-start">{t("integrations.keys.col.expires")}</th>
                <th className="p-3 text-start">{t("integrations.keys.col.lastUsed")}</th>
                <th className="p-3 text-start" />
              </tr>
            </thead>
            <tbody>
              {keys.data.map((key) => (
                <tr key={key.id} className="border-b border-border align-top">
                  <td className="p-3 font-semibold text-ink">{key.name}</td>
                  <td className="p-3">
                    <code dir="ltr" className="font-mono text-[12px] text-ink-muted">
                      {key.displayPrefix}…
                    </code>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <StatusPill key={scope} label={t(scopeLabelKey(scope))} tone="info" />
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    <StatusPill label={t(`integrations.keys.status.${key.status}` as AppTranslationKey)} tone={STATUS_TONE[key.status]} />
                  </td>
                  <td className="p-3">
                    <div>{key.createdByName ?? key.createdBy}</div>
                    <div className="text-[11.5px] text-ink-faint mz-num">{fmt.date(key.createdAt)}</div>
                  </td>
                  <td className="p-3 mz-num">{key.expiresAt ? fmt.date(key.expiresAt) : t("integrations.never")}</td>
                  <td className="p-3 mz-num">{key.lastUsedAt ? fmt.dateTime(key.lastUsedAt) : t("integrations.none")}</td>
                  <td className="p-3">
                    {mayManage && key.status !== ApiKeyStatusDTO.Revoked ? (
                      <div className="flex justify-end">
                        <Button size="sm" variant="danger-outline" disabled={revokingId === key.id} onClick={() => setConfirming(key)}>
                          {t("integrations.keys.revoke")}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title={t("integrations.keys.revokeTitle", { name: confirming?.name ?? "" })}
        consequence={t("integrations.keys.revokeConsequence")}
        confirmLabel={t("integrations.keys.revoke")}
        cancelLabel={t("integrations.cancel")}
        onConfirm={confirmRevoke}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
