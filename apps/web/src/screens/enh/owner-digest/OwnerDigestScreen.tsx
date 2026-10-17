import { useEffect, useState } from "react";
import { Button, Card, Checkbox, DecimalStringInput, EmptyState, Select, TextInput } from "@mezan/ui";
import { OwnerDigestCadence, OwnerDigestLanguage, type OwnerDigestSettingsInputDTO, type OwnerDigestThresholdsDTO } from "@mezan/contracts";
import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../../../data/ApiContext";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { Field } from "../../../settings/form-controls";
import { ScreenTabs } from "../../ScreenTabs";
import {
  useOwnerDigestPreview,
  useOwnerDigestRecipients,
  useOwnerDigestSettings,
  useSaveOwnerDigestSettings,
  useSendOwnerDigest,
} from "./hooks";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

enum ThresholdKind {
  Count = "count",
  Percent = "percent",
  Amount = "amount",
}

const THRESHOLD_FIELDS: readonly { readonly key: keyof OwnerDigestThresholdsDTO; readonly kind: ThresholdKind }[] = [
  { key: "voidCount", kind: ThresholdKind.Count },
  { key: "largeDiscountPercent", kind: ThresholdKind.Percent },
  { key: "belowFloorCount", kind: ThresholdKind.Count },
  { key: "cashVarianceAmount", kind: ThresholdKind.Amount },
  { key: "overdueAmount", kind: ThresholdKind.Amount },
  { key: "lowStockItems", kind: ThresholdKind.Count },
  { key: "approvalWaitingHours", kind: ThresholdKind.Count },
  { key: "failedEtaCount", kind: ThresholdKind.Count },
  { key: "backupMaxAgeHours", kind: ThresholdKind.Count },
];

function Alert({ children, tone }: { children: string; tone: "danger" | "info" }) {
  const palette = tone === "danger" ? "border-danger bg-danger-soft text-danger-ink" : "border-border bg-surface-2 text-ink";
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border p-3 text-[13px] ${palette}`}>
      {children}
    </div>
  );
}

function PreviewTab({ maySend, defaults }: { maySend: boolean; defaults: OwnerDigestSettingsInputDTO | null }) {
  const { t } = useAppTranslation();
  const [cadence, setCadence] = useState<OwnerDigestCadence | null>(null);
  const [language, setLanguage] = useState<OwnerDigestLanguage | null>(null);
  const activeCadence = cadence ?? defaults?.cadence ?? null;
  const activeLanguage = language ?? defaults?.language ?? null;
  const preview = useOwnerDigestPreview(activeCadence, activeLanguage);
  const send = useSendOwnerDigest();
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function submit() {
    if (send.isPending || !activeCadence || !activeLanguage) return;
    setNote(null);
    setFailure(null);
    send.mutate(
      { cadence: activeCadence, language: activeLanguage },
      {
        onSuccess: (result) => {
          const lines = [t("ownerDigest.sendResult", { queued: result.queued, already: result.alreadySent, skipped: result.skipped.length })];
          if (!result.mailConfigured) lines.push(t("ownerDigest.sendMailOff"));
          for (const skipped of result.skipped) {
            lines.push(t(`ownerDigest.skip.${skipped.reason}` as AppTranslationKey, { name: skipped.name ?? skipped.userId }));
          }
          setNote(lines.join(" "));
        },
        onError: (err) => setFailure(errorMessage(err, t("ownerDigest.sendFailed"))),
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("ownerDigest.cadence")}>
          <Select
            value={activeCadence ?? OwnerDigestCadence.Daily}
            onChange={(value) => setCadence(value as OwnerDigestCadence)}
            options={[
              { value: OwnerDigestCadence.Daily, label: t("ownerDigest.cadence.daily") },
              { value: OwnerDigestCadence.Weekly, label: t("ownerDigest.cadence.weekly") },
            ]}
            aria-label={t("ownerDigest.cadence")}
          />
        </Field>
        <Field label={t("ownerDigest.language")}>
          <Select
            value={activeLanguage ?? OwnerDigestLanguage.Ar}
            onChange={(value) => setLanguage(value as OwnerDigestLanguage)}
            options={[
              { value: OwnerDigestLanguage.Ar, label: t("ownerDigest.language.ar") },
              { value: OwnerDigestLanguage.En, label: t("ownerDigest.language.en") },
            ]}
            aria-label={t("ownerDigest.language")}
          />
        </Field>
        {maySend ? (
          <Button variant="primary" disabled={send.isPending || !activeCadence} onClick={submit}>
            {send.isPending ? t("ownerDigest.sending") : t("ownerDigest.send")}
          </Button>
        ) : null}
      </div>
      {maySend ? <p className="text-[12.5px] text-ink-muted">{t("ownerDigest.sendHint")}</p> : null}
      {defaults && defaults.recipientUserIds.length === 0 ? <Alert tone="info">{t("ownerDigest.noRecipients")}</Alert> : null}
      {note ? <Alert tone="info">{note}</Alert> : null}
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      {preview.isLoading ? <p className="text-[13px] text-ink-muted">{t("ownerDigest.loading")}</p> : null}
      {preview.isError ? <Alert tone="danger">{errorMessage(preview.error, t("ownerDigest.loadFailed"))}</Alert> : null}
      {preview.data ? (
        <Card className="flex flex-col gap-2 p-[16px_18px]">
          <div className="text-[13px] font-semibold text-ink">{t("ownerDigest.previewHeading")}</div>
          <div className="text-[12.5px] text-ink-muted">
            {t("ownerDigest.period", { from: preview.data.digest.period.from, to: preview.data.digest.period.to })}
          </div>
          <iframe title={t("ownerDigest.previewFrame")} sandbox="" srcDoc={preview.data.email.html} className="h-[640px] w-full rounded-lg border border-border bg-surface" />
        </Card>
      ) : null}
    </div>
  );
}

function SettingsTab({ mayManage }: { mayManage: boolean }) {
  const { t } = useAppTranslation();
  const settings = useOwnerDigestSettings();
  const recipients = useOwnerDigestRecipients(mayManage);
  const save = useSaveOwnerDigestSettings();
  const [draft, setDraft] = useState<OwnerDigestSettingsInputDTO | null>(null);
  const [message, setMessage] = useState<{ readonly text: string; readonly tone: "danger" | "info" } | null>(null);

  useEffect(() => {
    if (settings.data && draft === null) {
      const { scheduleEnabled, cadence, sendWeekday, language, recipientUserIds, thresholds } = settings.data;
      setDraft({ scheduleEnabled, cadence, sendWeekday, language, recipientUserIds, thresholds });
    }
  }, [settings.data, draft]);

  if (!settings.data || !draft) return <p className="text-[13px] text-ink-muted">{t("ownerDigest.loading")}</p>;
  const supported = settings.data.scheduleSupported;

  function patch(change: Partial<OwnerDigestSettingsInputDTO>) {
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  function patchThreshold(key: keyof OwnerDigestThresholdsDTO, kind: ThresholdKind, raw: string) {
    setDraft((current) => {
      if (!current) return current;
      const value: string | number = kind === ThresholdKind.Amount ? raw : Number(raw);
      return { ...current, thresholds: { ...current.thresholds, [key]: value } };
    });
  }

  function toggleRecipient(userId: string) {
    if (!draft) return;
    const has = draft.recipientUserIds.includes(userId);
    patch({ recipientUserIds: has ? draft.recipientUserIds.filter((id) => id !== userId) : [...draft.recipientUserIds, userId] });
  }

  function submit() {
    if (!draft || save.isPending) return;
    setMessage(null);
    save.mutate(draft, {
      onSuccess: () => setMessage({ text: t("ownerDigest.settings.saved"), tone: "info" }),
      onError: (err) => setMessage({ text: errorMessage(err, t("ownerDigest.settings.saveFailed")), tone: "danger" }),
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-[16px_18px]">
      {!mayManage ? <Alert tone="info">{t("ownerDigest.settings.noManage")}</Alert> : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold text-ink">{t("ownerDigest.settings.schedule")}</h2>
        {supported ? (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={draft.scheduleEnabled} disabled={!mayManage} onChange={() => patch({ scheduleEnabled: !draft.scheduleEnabled })} aria-label={t("ownerDigest.settings.scheduleOn")} />
            {t("ownerDigest.settings.scheduleOn")}
          </label>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("ownerDigest.settings.scheduleUnsupported")}</p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label={t("ownerDigest.cadence")}>
            <Select
              value={draft.cadence}
              disabled={!mayManage}
              onChange={(value) => patch({ cadence: value as OwnerDigestCadence })}
              options={[
                { value: OwnerDigestCadence.Daily, label: t("ownerDigest.cadence.daily") },
                { value: OwnerDigestCadence.Weekly, label: t("ownerDigest.cadence.weekly") },
              ]}
              aria-label={t("ownerDigest.cadence")}
            />
          </Field>
          <Field label={t("ownerDigest.settings.weekday")}>
            <Select
              value={String(draft.sendWeekday)}
              disabled={!mayManage || draft.cadence !== OwnerDigestCadence.Weekly}
              onChange={(value) => patch({ sendWeekday: Number(value) })}
              options={WEEKDAYS.map((day) => ({ value: String(day), label: t(`ownerDigest.settings.weekday.${day}` as AppTranslationKey) }))}
              aria-label={t("ownerDigest.settings.weekday")}
            />
          </Field>
          <Field label={t("ownerDigest.language")}>
            <Select
              value={draft.language}
              disabled={!mayManage}
              onChange={(value) => patch({ language: value as OwnerDigestLanguage })}
              options={[
                { value: OwnerDigestLanguage.Ar, label: t("ownerDigest.language.ar") },
                { value: OwnerDigestLanguage.En, label: t("ownerDigest.language.en") },
              ]}
              aria-label={t("ownerDigest.language")}
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold text-ink">{t("ownerDigest.settings.recipients")}</h2>
        <p className="text-[12.5px] text-ink-muted">{t("ownerDigest.settings.recipientsHint")}</p>
        {(recipients.data ?? []).map((option) => (
          <label key={option.userId} className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={draft.recipientUserIds.includes(option.userId)} disabled={!mayManage} onChange={() => toggleRecipient(option.userId)} aria-label={option.name} />
            <span>{option.name}</span>
            <span className="text-ink-muted" dir="ltr">
              {option.email}
            </span>
            {option.mayReceive ? null : <span className="text-warning-ink">{t("ownerDigest.settings.recipientBlocked")}</span>}
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold text-ink">{t("ownerDigest.settings.thresholds")}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {THRESHOLD_FIELDS.map(({ key, kind }) => (
            <Field key={key} label={t(`ownerDigest.settings.t.${key}` as AppTranslationKey)}>
              {kind === ThresholdKind.Amount ? (
                <DecimalStringInput
                  value={String(draft.thresholds[key])}
                  disabled={!mayManage}
                  onChange={(value) => patchThreshold(key, kind, value)}
                  aria-label={t(`ownerDigest.settings.t.${key}` as AppTranslationKey)}
                />
              ) : (
                <TextInput
                  inputMode="numeric"
                  value={String(draft.thresholds[key])}
                  disabled={!mayManage}
                  onChange={(event) => patchThreshold(key, kind, event.target.value.replace(/[^\d.]/g, ""))}
                />
              )}
            </Field>
          ))}
        </div>
      </section>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {mayManage ? (
        <div>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? t("ownerDigest.settings.saving") : t("ownerDigest.settings.save")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function OwnerDigestScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, "accounting.owner_digest.view");
  const mayManage = can(auth, "accounting.owner_digest.manage");
  const maySend = can(auth, "accounting.owner_digest.send");
  const settings = useOwnerDigestSettings();

  if (!mayView) {
    return <EmptyState title={t("ownerDigest.noAccessTitle")} description={t("ownerDigest.noAccessBody")} />;
  }

  const defaults: OwnerDigestSettingsInputDTO | null = settings.data
    ? {
        scheduleEnabled: settings.data.scheduleEnabled,
        cadence: settings.data.cadence,
        sendWeekday: settings.data.sendWeekday,
        language: settings.data.language,
        recipientUserIds: settings.data.recipientUserIds,
        thresholds: settings.data.thresholds,
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[20px] font-bold text-ink">{t("ownerDigest.title")}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">{t("ownerDigest.subtitle")}</p>
      </div>
      <ScreenTabs
        ariaLabel={t("ownerDigest.title")}
        tabs={[
          { key: "preview", label: t("ownerDigest.tab.preview"), render: () => <PreviewTab maySend={maySend} defaults={defaults} /> },
          { key: "settings", label: t("ownerDigest.tab.settings"), render: () => <SettingsTab mayManage={mayManage} /> },
        ]}
      />
    </div>
  );
}
