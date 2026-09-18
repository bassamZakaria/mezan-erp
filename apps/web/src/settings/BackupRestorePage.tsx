import { useCallback, useEffect, useState } from "react";
import { Button, Card, StatusPill, TextInput } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * النسخ الاحتياطي والاستعادة — the screen a restore was missing.
 *
 * `backup/restore-service.ts` implemented the whole verified restore —
 * checksum, `integrity_check`, staged write, atomic rename — and was called
 * from nothing: no IPC, no menu, no screen. `grep restoreBackup` found the
 * export and one unit test. The only instruction a user could find in the
 * product was a `console.error` telling them to "restore it via the backup
 * module's restoreBackup()", which is a function call, not a step a shop owner
 * standing over a dead machine can perform.
 *
 * So the walk on the day the machine dies ended here: install on the new box,
 * hold the archive, and stop. A backup nobody can restore is not a backup.
 *
 * The confirmation is deliberately heavy. Restoring REPLACES the live database
 * and everything entered since the archive was taken is gone, so the screen
 * states the date, states what will be lost, and makes the owner type that date
 * before the button works — the one place in this product where friction is
 * the feature.
 */

type BackupEntry = {
  fileName: string;
  createdAt: string;
  appVersion: string | null;
  reason: string | null;
  sizeBytes: number;
  tables: Record<string, number> | null;
  readable: boolean;
};

type Failure = { ok: false; code: string; message: string };
type ListResult = { backupsDir: string; entries: BackupEntry[] } | Failure;
type CreateResult = { ok: true; entry: BackupEntry } | Failure;
type RestoreResult =
  | { ok: true; restoredFrom: BackupEntry; safetyBackupFileName: string | null; relaunching: boolean }
  | Failure;

type ExportResult = { ok: true; filePath: string } | Failure;

interface BackupBridge {
  list(sessionToken: string): Promise<ListResult>;
  create(sessionToken: string): Promise<CreateResult>;
  restore(sessionToken: string, fileName: string): Promise<RestoreResult>;
  revertToPreUpdate?(sessionToken: string): Promise<RestoreResult>;
  exportPortable?(sessionToken: string, passphrase: string): Promise<ExportResult>;
}

function bridge(): BackupBridge | undefined {
  return (globalThis as { mezan?: { backup?: BackupBridge } }).mezan?.backup;
}

function isFailure(
  result: ListResult | CreateResult | RestoreResult | ExportResult,
): result is Failure {
  return "ok" in result && result.ok === false;
}

/** The archive's own date, which is also what the owner has to type to confirm. */
function archiveDate(entry: BackupEntry): string {
  return entry.createdAt.slice(0, 10);
}

function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

/**
 * The reason an archive exists, in the language of the screen it is on.
 *
 * The column printed `manual` / `scheduled` / `pre-migration` / `on-close` raw:
 * four English machine tokens in an Arabic table, in the one place an owner
 * looks while deciding which copy of their books to restore. An unrecognised
 * value falls through to itself rather than to a guess — a new reason a newer
 * build wrote is better shown as it is than mislabelled as one of these.
 */
const REASON_KEYS: Record<string, AppTranslationKey> = {
  manual: "backup.reason.manual",
  scheduled: "backup.reason.scheduled",
  "pre-migration": "backup.reason.preMigration",
  "on-close": "backup.reason.onClose",
  "pre-update": "backup.reason.preUpdate",
};

export function BackupRestorePage() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [backupsDir, setBackupsDir] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** WHICH archive is being confirmed — never a page-wide "confirming" flag. */
  const [confirming, setConfirming] = useState<BackupEntry | null>(null);
  const [typedDate, setTypedDate] = useState("");
  const [passphrase, setPassphrase] = useState("");
  /** Per-action, never a page-wide flag: two buttons must not disable each other. */
  const [running, setRunning] = useState<"revert" | "export" | null>(null);

  function reasonLabel(reason: string | null): string {
    if (reason === null) return "—";
    const key = REASON_KEYS[reason];
    return key ? t(key) : reason;
  }

  const api = bridge();
  const token = session?.token ?? null;

  const refresh = useCallback(async () => {
    if (!api || !token) return;
    const result = await api.list(token);
    if (isFailure(result)) {
      setError(result.message);
      return;
    }
    setEntries([...result.entries]);
    setBackupsDir(result.backupsDir);
    setError(null);
  }, [api, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The desktop shell is the only edition that holds the database file, so on
  // the web build there is nothing here to operate — say so rather than
  // rendering a dead table.
  if (!api) {
    return (
      <div className="p-[20px]">
        <h1 className="mb-[4px] font-display text-[18px] font-bold text-ink">{t("backup.title")}</h1>
        <Card className="p-[18px]">
          <p className="text-[12.5px] text-ink-muted">{t("backup.desktopOnly")}</p>
        </Card>
      </div>
    );
  }

  async function handleCreate() {
    if (!api || !token || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.create(token);
      if (isFailure(result)) setError(result.message);
      else setNotice(t("backup.created"));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /**
   * «الرجوع إلى ما قبل التحديث». The main process picks the archive — the same
   * verified restore, the same relaunch — because the owner should not have to
   * recognise which timestamp came before the version that broke their books.
   */
  async function handleRevert() {
    if (!api?.revertToPreUpdate || !token || running) return;
    setRunning("revert");
    setNotice(null);
    setError(null);
    try {
      const result = await api.revertToPreUpdate(token);
      if (isFailure(result)) setError(result.message);
      else setNotice(t("backup.restoredRelaunching"));
    } finally {
      setRunning(null);
    }
  }

  async function handleExportPortable() {
    if (!api?.exportPortable || !token || running) return;
    setRunning("export");
    setNotice(null);
    setError(null);
    try {
      const result = await api.exportPortable(token, passphrase);
      if (isFailure(result)) setError(result.message);
      else {
        setNotice(t("backup.portableDone", { path: result.filePath }));
        // The passphrase leaves the screen the moment it has been used.
        setPassphrase("");
      }
      await refresh();
    } finally {
      setRunning(null);
    }
  }

  async function handleRestore(entry: BackupEntry) {
    if (!api || !token || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.restore(token, entry.fileName);
      if (isFailure(result)) {
        setError(result.message);
        return;
      }
      // The app relaunches itself a moment after this reply, so this notice is
      // the last thing the screen shows rather than the start of a new state.
      setNotice(t("backup.restoredRelaunching"));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-[20px]">
      <h1 className="mb-[4px] font-display text-[18px] font-bold text-ink">{t("backup.title")}</h1>
      <p className="mb-[16px] text-[12.5px] text-ink-muted">{t("backup.hint")}</p>

      <Card className="mb-[16px] p-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <div>
            <div className="text-[13px] font-semibold text-ink">{t("backup.archivesFolder")}</div>
            <p className="mt-[2px] mz-lat text-[11.5px] text-ink-faint">{backupsDir || "—"}</p>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => void handleCreate()}>
            {t("backup.createNow")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">
            {error}
          </p>
        ) : null}
        {notice ? <p className="mt-[10px] text-[12px] text-success-ink">{notice}</p> : null}
      </Card>

      {api.revertToPreUpdate ? (
        <Card className="mb-[16px] p-[18px]">
          <div className="text-[13px] font-semibold text-ink">{t("backup.revertTitle")}</div>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("backup.revertHint")}</p>
          <div className="mt-[12px]">
            <Button
              variant="danger-outline"
              disabled={running !== null}
              onClick={() => void handleRevert()}
            >
              {t("backup.revert")}
            </Button>
          </div>
        </Card>
      ) : null}

      {api.exportPortable ? (
        <Card className="mb-[16px] p-[18px]">
          <div className="text-[13px] font-semibold text-ink">{t("backup.portableTitle")}</div>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("backup.portableHint")}</p>
          <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
            <div className="max-w-[280px] grow">
              <TextInput
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                aria-label={t("backup.portablePassphrase")}
                placeholder={t("backup.portablePassphrase")}
              />
            </div>
            <Button
              variant="default"
              disabled={running !== null || passphrase.trim().length === 0}
              onClick={() => void handleExportPortable()}
            >
              {t("backup.portableExport")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-[18px]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-ink-muted">
                <th className="p-[8px] text-start font-semibold">{t("backup.takenOn")}</th>
                <th className="p-[8px] text-start font-semibold">{t("backup.reason")}</th>
                <th className="p-[8px] text-start font-semibold">{t("backup.version")}</th>
                <th className="p-[8px] text-start font-semibold">{t("backup.size")}</th>
                <th className="p-[8px] text-start font-semibold">{t("devices.action")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-[16px] text-center text-ink-faint">
                    {t("backup.noArchives")}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.fileName} className="border-b border-border last:border-b-0">
                    <td className="p-[8px] mz-num font-semibold text-ink">{archiveDate(entry)}</td>
                    <td className="p-[8px] text-ink-muted">{reasonLabel(entry.reason)}</td>
                    {/*
                      The version the archive RECORDS, which is the build that
                      wrote it — never this build's version, which would tell an
                      owner restoring a year-old copy that it came from today.
                    */}
                    <td className="p-[8px] mz-lat text-ink-muted">{entry.appVersion ?? t("support.unknown")}</td>
                    <td className="p-[8px] mz-num text-ink-muted">{megabytes(entry.sizeBytes)} MB</td>
                    <td className="p-[8px]">
                      {entry.readable ? (
                        <Button
                          size="sm"
                          variant="danger-outline"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(entry);
                            setTypedDate("");
                          }}
                        >
                          {t("backup.restore")}
                        </Button>
                      ) : (
                        <StatusPill label={t("backup.damaged")} tone="danger" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {confirming ? (
        <Card className="mt-[16px] border-danger p-[18px]">
          <div className="text-[13px] font-semibold text-danger-ink">{t("backup.confirmTitle")}</div>
          <p className="mt-[6px] text-[12.5px] text-ink">
            {t("backup.confirmBody")} <span className="mz-num font-semibold">{archiveDate(confirming)}</span>.
          </p>
          <p className="mt-[6px] text-[12.5px] text-danger-ink">{t("backup.confirmLoss")}</p>
          <div className="mt-[12px] max-w-[240px]">
            <TextInput
              value={typedDate}
              onChange={(e) => setTypedDate(e.target.value)}
              placeholder={archiveDate(confirming)}
              aria-label={t("backup.typeTheDate")}
            />
          </div>
          <div className="mt-[12px] flex items-center gap-[8px]">
            <Button
              variant="danger-outline"
              // The date has to be typed, not clicked past. Restoring replaces
              // the books; a single misclick here loses everything entered
              // since the archive.
              disabled={busy || typedDate.trim() !== archiveDate(confirming)}
              onClick={() => void handleRestore(confirming)}
            >
              {t("backup.restoreConfirm")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
