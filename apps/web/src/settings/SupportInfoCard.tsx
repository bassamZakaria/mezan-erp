import { useState } from "react";
import { Button, Card } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { isDesktopHost, useDesktopLicence } from "../data/hooks";
import { useAppVersion } from "../data/hub-hooks";
import { pickMessage } from "../data/server-message";
import { useAppTranslation } from "../i18n";

/**
 * «معلومات الدعم» — the card that answers the first four questions of every
 * support call, in one place, in one copy.
 *
 * Before it, none of them had an answer a user could give. «ما هي نسختك؟» met
 * three disagreeing sources (a literal on the login screen, the web package on
 * System Status, the manifest in the backup table). The `LIC-*` codes existed
 * and were unreachable. The machine fingerprint — the one value support needs
 * to reissue a licence for a replacement PC — could not be read anywhere in the
 * product, so `FINGERPRINT_MISMATCH` had no recovery path at all. The database
 * and backup paths went to a console.
 *
 * Everything here is READ from a live source. Nothing is defaulted: a fact this
 * build cannot know renders as «غير معروف», never as a plausible value that
 * would send support down the wrong path.
 */

/**
 * A verbatim value the operator reads off the screen or copies — a path, a
 * fingerprint, a version. `dir="ltr"` and `select-all` because all of them are
 * Latin/hex inside an RTL page, where an unmarked run reorders and two strings
 * that differ only in layout look different.
 */
export function CopyableValue({
  value,
  copyLabel,
  copiedLabel,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  // Read at render, not in the handler: a button that cannot copy must not be
  // on screen. The value stays selectable either way.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <code
        dir="ltr"
        className="mz-num select-all break-all rounded-[6px] bg-surface-2 px-[8px] py-[4px] text-[12.5px] font-semibold text-ink"
      >
        {value}
      </code>
      {clipboard ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void clipboard
              .writeText(value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copyLabel}
        </Button>
      ) : null}
      {copied ? <span className="text-[11.5px] text-ink-muted">{copiedLabel}</span> : null}
    </div>
  );
}

interface SupportFact {
  readonly label: string;
  readonly value: string | null;
  /** True for Latin/hex runs that must not be reordered by the RTL page. */
  readonly verbatim?: boolean;
}

interface SupportBridge {
  saveDiagnostic?(
    sessionToken: string,
    body: string,
  ): Promise<{ ok: true; path: string | null } | { ok: false; code: string; message: string; messageEn?: string }>;
  saveLogs?(
    sessionToken: string,
    diagnostic: string,
  ): Promise<{ ok: true; path: string | null } | { ok: false; code: string; message: string; messageEn?: string }>;
  reveal?(
    sessionToken: string,
    target: "key-card" | "plaintext-archive" | "log",
  ): Promise<{ ok: true; path: string | null } | { ok: false; code: string; message: string; messageEn?: string }>;
  remove?(
    sessionToken: string,
    target: "key-card" | "plaintext-archive",
  ): Promise<{ ok: true; path: string | null } | { ok: false; code: string; message: string; messageEn?: string }>;
}

function supportBridge(): SupportBridge | undefined {
  return (globalThis as { mezan?: { support?: SupportBridge } }).mezan?.support;
}

export function SupportInfoCard() {
  const { t, locale } = useAppTranslation();
  const { session } = useApi();
  const appVersion = useAppVersion();
  const licence = useDesktopLicence();
  const desktop = isDesktopHost();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const data = licence.data && licence.data.ok ? licence.data : null;
  const unknown = t("support.unknown");

  const seats =
    data && typeof data.seatsUsed === "number"
      ? `${data.seatsUsed} / ${data.seats}`
      : data
        ? `— / ${data.seats}`
        : null;

  const facts: readonly SupportFact[] = [
    { label: t("support.version"), value: appVersion, verbatim: true },
    { label: t("support.licenceCode"), value: data?.code ?? null, verbatim: true },
    { label: t("support.plan"), value: data?.plan ?? null, verbatim: true },
    {
      label: t("support.role"),
      value: data ? (data.role === "client" ? t("support.roleClient") : t("support.roleHost")) : null,
    },
    { label: t("support.hostUrl"), value: data?.lan.url ?? null, verbatim: true },
    { label: t("support.seats"), value: seats },
    {
      label: t("support.daysSinceCheckin"),
      value:
        data && typeof data.daysSinceCheckin === "number" ? String(data.daysSinceCheckin) : null,
    },
    { label: t("support.fingerprint"), value: data?.fingerprint ?? null, verbatim: true },
    { label: t("support.database"), value: data?.databasePath ?? null, verbatim: true },
    { label: t("support.backups"), value: data?.backupsDir ?? null, verbatim: true },
    { label: t("support.licenceFile"), value: data?.licenceFilePath ?? null, verbatim: true },
  ];

  const plainText = facts
    .map((fact) => `${fact.label}: ${fact.value ?? unknown}`)
    .join("\n");

  const diagnostic = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      appVersion,
      licence: data
        ? {
            code: data.code,
            state: data.state ?? null,
            reason: data.reason ?? null,
            canWrite: data.canWrite ?? null,
            plan: data.plan,
            seats: data.seats,
            seatsUsed: data.seatsUsed ?? null,
            modules: data.modules ?? null,
            expiresAt: data.expiresAt,
            daysSinceCheckin: data.daysSinceCheckin ?? null,
            fingerprint: data.fingerprint ?? null,
            licenceFilePath: data.licenceFilePath ?? null,
          }
        : null,
      role: data?.role ?? null,
      lan: data?.lan ?? null,
      paths: {
        database: data?.databasePath ?? null,
        backups: data?.backupsDir ?? null,
        keyCard: data?.keyCardPath ?? null,
        plaintextArchive: data?.plaintextArchivePath ?? null,
      },
    },
    null,
    2,
  );

  const clipboard = navigator.clipboard as Clipboard | undefined;

  async function handleSaveDiagnostic() {
    const bridge = supportBridge();
    const token = session?.token ?? null;
    if (!bridge?.saveDiagnostic || !token) {
      setError(t("support.diagnosticDesktopOnly"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.saveDiagnostic(token, diagnostic);
      if (result.ok) {
        if (result.path) setNotice(t("support.diagnosticSaved", { path: result.path }));
      } else if (result.code !== "CANCELLED") {
        setError(pickMessage(result, locale));
      }
    } catch {
      // An unregistered IPC channel rejects with an English
      // "Error invoking remote method …"; it never reaches a screen.
      setError(t("support.diagnosticFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLogs() {
    const bridge = supportBridge();
    const token = session?.token ?? null;
    if (!bridge?.saveLogs || !token) {
      setError(t("support.logsDesktopOnly"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.saveLogs(token, diagnostic);
      if (result.ok) {
        if (result.path) setNotice(t("support.logsSaved", { path: result.path }));
      } else if (result.code !== "CANCELLED") {
        setError(pickMessage(result, locale));
      }
    } catch {
      setError(t("support.logsFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenLogs() {
    const bridge = supportBridge();
    const token = session?.token ?? null;
    if (!bridge?.reveal || !token) {
      setError(t("support.logsDesktopOnly"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.reveal(token, "log");
      if (!result.ok) setError(pickMessage(result, locale));
    } catch {
      setError(t("support.logsOpenFailed"));
    }
  }

  return (
    <Card className="p-[18px]">
      <div className="text-[13px] font-semibold text-ink">{t("support.title")}</div>
      <p className="mt-[4px] text-[12px] text-ink-muted">{t("support.hint")}</p>

      <dl className="mt-[14px] grid grid-cols-1 gap-[10px] sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-[3px]">
            <dt className="text-[11.5px] text-ink-faint">{fact.label}</dt>
            <dd
              {...(fact.verbatim && fact.value ? { dir: "ltr" as const } : {})}
              className={`text-[12.5px] font-semibold text-ink ${
                fact.verbatim && fact.value ? "mz-lat select-all break-all text-start" : ""
              }`}
            >
              {fact.value ?? <span className="font-normal text-ink-faint">{unknown}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {!desktop ? (
        <p className="mt-[12px] text-[11.5px] text-ink-muted">{t("support.browserOnly")}</p>
      ) : null}

      <div className="mt-[14px] flex flex-wrap items-center gap-[10px]">
        {clipboard ? (
          <Button
            type="button"
            onClick={() => {
              void clipboard
                .writeText(plainText)
                .then(() => {
                  setError(null);
                  setNotice(t("support.copied"));
                })
                .catch(() => setError(t("support.copyFailed")));
            }}
          >
            {t("support.copy")}
          </Button>
        ) : null}
        {desktop ? (
          <Button type="button" disabled={saving} onClick={() => void handleSaveDiagnostic()}>
            {saving ? t("support.saving") : t("support.saveDiagnostic")}
          </Button>
        ) : null}
        {desktop ? (
          <Button type="button" disabled={saving} onClick={() => void handleSaveLogs()}>
            {saving ? t("support.saving") : t("support.saveLogs")}
          </Button>
        ) : null}
        {desktop ? (
          <Button type="button" variant="ghost" onClick={() => void handleOpenLogs()}>
            {t("support.openLogs")}
          </Button>
        ) : null}
      </div>

      {notice ? <p className="mt-[10px] text-[12px] text-success-ink">{notice}</p> : null}
      {error ? (
        <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * THE TWO PLAINTEXT FILES, said out loud, on every screen, until they are gone.
 *
 * `database-key.txt` is the only plaintext copy of the key that opens this
 * shop's backups, and the pre-conversion archive is the whole unencrypted
 * database. Both were warned about on every launch — to a console a shop never
 * opens — so «قلت لي انسخ ملف المفتاح، فين هو؟» had no answer, and the failure
 * surfaced years later as "the books are gone".
 *
 * Deleting asks twice, because the key card is unrecoverable: lose it before
 * copying it and every archive taken on this machine is unopenable on any other.
 */
export function PlaintextKeyRiskBanner() {
  const { t, locale } = useAppTranslation();
  const { session } = useApi();
  const licence = useDesktopLicence();
  const [confirming, setConfirming] = useState<"key-card" | "plaintext-archive" | null>(null);
  const [busy, setBusy] = useState<"key-card" | "plaintext-archive" | null>(null);
  const [gone, setGone] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const data = licence.data && licence.data.ok ? licence.data : null;
  if (!data) return null;

  const risks = (
    [
      { target: "key-card" as const, path: data.keyCardPath ?? null, body: t("keyRisk.keyCard") },
      {
        target: "plaintext-archive" as const,
        path: data.plaintextArchivePath ?? null,
        body: t("keyRisk.archive"),
      },
    ] as const
  ).filter((risk) => risk.path !== null && !gone.includes(risk.target));

  if (risks.length === 0) return null;

  async function act(target: "key-card" | "plaintext-archive", action: "reveal" | "remove") {
    const bridge = supportBridge();
    const token = session?.token ?? null;
    if (!bridge || !token) {
      setError(t("keyRisk.failed"));
      return;
    }
    // One file at a time: a second click while one is in flight is a no-op,
    // never a second unlink of a path that is already gone.
    if (busy !== null) return;
    setBusy(target);
    setError(null);
    try {
      const call = action === "reveal" ? bridge.reveal : bridge.remove;
      const result = call ? await call(token, target) : null;
      if (!result) {
        setError(t("keyRisk.failed"));
      } else if (!result.ok) {
        setError(pickMessage(result, locale));
      } else if (action === "remove") {
        setGone((prev) => [...prev, target]);
        setConfirming(null);
      }
    } catch {
      setError(t("keyRisk.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="alert"
      className="mb-[14px] rounded-md border border-warning bg-warning-soft px-[14px] py-[12px] text-[12.5px] text-warning-ink"
    >
      <div className="text-[13px] font-semibold">{t("keyRisk.title")}</div>
      {risks.map((risk) => (
        <div key={risk.target} className="mt-[8px]">
          <p>{risk.body}</p>
          <p dir="ltr" className="mz-lat mt-[4px] select-all break-all text-[11.5px] text-start">
            {risk.path}
          </p>
          {confirming === risk.target ? (
            <div className="mt-[8px]">
              <p className="font-semibold">{t("keyRisk.confirm")}</p>
              <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
                <Button
                  type="button"
                  size="sm"
                  variant="danger-outline"
                  disabled={busy === risk.target}
                  onClick={() => void act(risk.target, "remove")}
                >
                  {t("keyRisk.confirmDelete")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  {t("keyRisk.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
              <Button
                type="button"
                size="sm"
                disabled={busy === risk.target}
                onClick={() => void act(risk.target, "reveal")}
              >
                {t("keyRisk.reveal")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger-outline"
                onClick={() => setConfirming(risk.target)}
              >
                {t("keyRisk.delete")}
              </Button>
            </div>
          )}
        </div>
      ))}
      {error ? <p className="mt-[8px] font-semibold text-danger-ink">{error}</p> : null}
    </div>
  );
}
