import { useState } from "react";
import { Button, Checkbox, Segmented, StatusPill, TextInput, useFormat, type PillTone } from "@mezan/ui";
import { pickMessage } from "../data/server-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import {
  BackupFailureCode,
  RecoveryMode,
  backupBridge,
  isBackupFailure,
  type RecoveryStatus,
} from "./backup-bridge";

// EXTERNAL CONTRACT: the main process refuses anything shorter (apps/desktop/src/backup/portable-export.ts MIN_PASSPHRASE_LENGTH).
export const RECOVERY_PASSPHRASE_MIN_LENGTH = 10;

export enum PassphraseStrength {
  TooShort = "tooShort",
  Weak = "weak",
  Fair = "fair",
  Strong = "strong",
}

const STRENGTH_KEYS: Record<PassphraseStrength, AppTranslationKey> = {
  [PassphraseStrength.TooShort]: "backupProtection.strength.tooShort",
  [PassphraseStrength.Weak]: "backupProtection.strength.weak",
  [PassphraseStrength.Fair]: "backupProtection.strength.fair",
  [PassphraseStrength.Strong]: "backupProtection.strength.strong",
};

const STRENGTH_TONES: Record<PassphraseStrength, PillTone> = {
  [PassphraseStrength.TooShort]: "danger",
  [PassphraseStrength.Weak]: "warning",
  [PassphraseStrength.Fair]: "info",
  [PassphraseStrength.Strong]: "success",
};

const CHARACTER_CLASSES: readonly RegExp[] = [/[a-z]/, /[A-Z]/, /[0-9\u0660-\u0669]/, /[\u0600-\u065F\u066E-\u06FF]/, /[^\p{L}\p{Nd}\s]/u];

export function passphraseStrength(passphrase: string): PassphraseStrength {
  if (passphrase.length < RECOVERY_PASSPHRASE_MIN_LENGTH) return PassphraseStrength.TooShort;
  const classes = CHARACTER_CLASSES.filter((re) => re.test(passphrase)).length;
  const words = passphrase.trim().split(/\s+/).length;
  const score = classes + (passphrase.length >= 16 ? 1 : 0) + (passphrase.length >= 24 ? 1 : 0) + (words >= 3 ? 1 : 0);
  if (score >= 4) return PassphraseStrength.Strong;
  if (score >= 2) return PassphraseStrength.Fair;
  return PassphraseStrength.Weak;
}

interface BackupProtectionPanelProps {
  readonly sessionToken: string;
  readonly recovery: RecoveryStatus;
  readonly onSaved: (recovery: RecoveryStatus) => void;
}

/**
 * «حماية النسخ الاحتياطية» — the one form the first-run step, the backup
 * screen and the dashboard's one-click flow all render. Setting the secret the
 * first time needs no password; replacing it needs the user's current one, and the main process proves it.
 */
export function BackupProtectionPanel({ sessionToken, recovery, onSaved }: BackupProtectionPanelProps) {
  const { t, locale } = useAppTranslation();
  const fmt = useFormat();
  const api = backupBridge();
  const changing = recovery.mode !== null;
  const [editing, setEditing] = useState(!changing);
  const [mode, setMode] = useState<RecoveryMode>(RecoveryMode.Passphrase);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [keyCardPath, setKeyCardPath] = useState<string | null>(null);
  const [keyCardStored, setKeyCardStored] = useState(false);
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!api?.setRecovery) return null;
  const setRecovery = api.setRecovery.bind(api);
  const saveKeyCard = api.saveKeyCard?.bind(api);

  if (!recovery.keyStoreAvailable) {
    return <p className="text-[12.5px] text-warning-ink">{t("backupProtection.noKeyStore")}</p>;
  }

  const strength = passphraseStrength(passphrase);
  const passphraseReady =
    strength !== PassphraseStrength.TooShort && passphrase === confirmation && understood;
  const keyCardReady = keyCardPath !== null && keyCardStored;
  const passwordReady = !changing || password !== "";
  const ready = passwordReady && (mode === RecoveryMode.Passphrase ? passphraseReady : keyCardReady);

  async function handleSaveKeyCard() {
    if (running || !saveKeyCard) return;
    setRunning(true);
    setError(null);
    try {
      const result = await saveKeyCard(sessionToken);
      if (isBackupFailure(result)) {
        if (result.code !== BackupFailureCode.Cancelled) setError(pickMessage(result, locale));
        return;
      }
      setKeyCardPath(result.filePath);
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmit() {
    if (running || !ready) return;
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setRecovery(sessionToken, {
        mode,
        ...(mode === RecoveryMode.Passphrase ? { passphrase } : {}),
        ...(changing ? { password } : {}),
      });
      if (isBackupFailure(result)) {
        setError(pickMessage(result, locale));
        if (result.code === BackupFailureCode.WrongPassword) setPassword("");
        if (result.code === BackupFailureCode.KeyCardNotSaved) setKeyCardPath(null);
        return;
      }
      setPassphrase("");
      setConfirmation("");
      setPassword("");
      setUnderstood(false);
      setKeyCardPath(null);
      setKeyCardStored(false);
      setEditing(false);
      setNotice(t(changing ? "backupProtection.changed" : "backupProtection.done"));
      onSaved(result.recovery);
    } finally {
      setRunning(false);
    }
  }

  const methodOptions = [
    { key: RecoveryMode.Passphrase, label: t("backupProtection.method.passphrase") },
    ...(recovery.keyCardAvailable && saveKeyCard
      ? [{ key: RecoveryMode.KeyCard, label: t("backupProtection.method.keyCard") }]
      : []),
  ];

  return (
    <div>
      <p className="text-[12.5px] text-ink-muted">{t("backupProtection.intro")}</p>
      {recovery.mode && recovery.setAt ? (
        <p className="mt-[8px] text-[12.5px] font-semibold text-success-ink">
          {t(recovery.mode === RecoveryMode.KeyCard ? "backupProtection.activeKeyCard" : "backupProtection.activePassphrase", {
            date: fmt.dateTime(recovery.setAt),
          })}
        </p>
      ) : null}
      {notice ? <p className="mt-[8px] text-[12px] text-success-ink">{notice}</p> : null}

      {!editing ? (
        <div className="mt-[12px]">
          <Button variant="default" onClick={() => setEditing(true)}>
            {t("backupProtection.change")}
          </Button>
        </div>
      ) : (
        <div className="mt-[12px] flex flex-col gap-[12px]">
          <p role="note" className="rounded-md border border-warning bg-warning-soft p-[10px_12px] text-[12.5px] text-warning-ink">
            {t("backupProtection.warning")}
          </p>
          {changing ? (
            <p role="note" className="rounded-md border border-border p-[10px_12px] text-[12.5px] text-ink">
              {t("backupProtection.oldCopies")}
            </p>
          ) : null}
          {methodOptions.length > 1 ? (
            <Segmented
              aria-label={t("backupProtection.method")}
              options={methodOptions}
              value={mode}
              onChange={(key) => setMode(key === RecoveryMode.KeyCard ? RecoveryMode.KeyCard : RecoveryMode.Passphrase)}
            />
          ) : null}

          {mode === RecoveryMode.Passphrase ? (
            <div className="flex flex-col gap-[10px]">
              <label className="flex max-w-[360px] flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("backupProtection.passphrase")}</span>
                <TextInput
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <span className="text-[11px] text-ink-faint">
                  {t("backupProtection.passphraseHint", { min: String(RECOVERY_PASSPHRASE_MIN_LENGTH) })}
                </span>
              </label>
              {passphrase.length > 0 ? (
                <div className="flex items-center gap-[8px]" aria-live="polite">
                  <StatusPill
                    label={t("backupProtection.strengthLabel", { level: t(STRENGTH_KEYS[strength]) })}
                    tone={STRENGTH_TONES[strength]}
                  />
                </div>
              ) : null}
              <label className="flex max-w-[360px] flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("backupProtection.passphraseConfirm")}</span>
                <TextInput
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              {confirmation.length > 0 && confirmation !== passphrase ? (
                <p className="text-[12px] text-danger-ink">{t("backupProtection.mismatch")}</p>
              ) : null}
              <Checkbox
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                label={t("backupProtection.understood")}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              <p className="text-[12.5px] text-ink-muted">{t("backupProtection.keyCardIntro")}</p>
              <div>
                <Button variant="default" disabled={running} onClick={() => void handleSaveKeyCard()}>
                  {t("backupProtection.saveKeyCard")}
                </Button>
              </div>
              {keyCardPath ? (
                <>
                  <p className="text-[12px] text-success-ink">
                    {t("backupProtection.keyCardSaved")}{" "}
                    <span dir="ltr" className="mz-lat select-all break-all">
                      {keyCardPath}
                    </span>
                  </p>
                  <Checkbox
                    checked={keyCardStored}
                    onChange={(e) => setKeyCardStored(e.target.checked)}
                    label={t("backupProtection.keyCardStored")}
                  />
                </>
              ) : null}
            </div>
          )}

          {changing ? (
            <label className="flex max-w-[360px] flex-col gap-[6px]">
              <span className="text-[12.5px] font-semibold text-ink">{t("backupProtection.password")}</span>
              <TextInput
                type="password"
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="text-[11px] text-ink-faint">{t("backupProtection.passwordHint")}</span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" disabled={running || !ready} onClick={() => void handleSubmit()}>
              {running ? t("backupProtection.saving") : t(changing ? "backupProtection.saveChange" : "backupProtection.save")}
            </Button>
            {changing ? (
              <Button variant="ghost" disabled={running} onClick={() => setEditing(false)}>
                {t("backupProtection.cancelChange")}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-[10px] text-[12px] font-semibold text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
