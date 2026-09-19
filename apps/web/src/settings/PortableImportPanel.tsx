import { useState } from "react";
import { Button, TextInput } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { backupBridge, isBackupFailure, megabytes } from "./backup-bridge";

interface PortableImportPanelProps {
  /** Empty on the first-run screen, where the main process allows it only while the tenant is unclaimed. */
  readonly sessionToken: string;
  readonly firstRun?: boolean;
}

export function PortableImportPanel({ sessionToken, firstRun = false }: PortableImportPanelProps) {
  const { t } = useAppTranslation();
  const api = backupBridge();
  const [picked, setPicked] = useState<{ pickId: string; fileName: string; sizeBytes: number } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [understood, setUnderstood] = useState(firstRun);
  const [running, setRunning] = useState<"pick" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!api?.pickPortable || !api.importPortable) return null;
  const pickPortable = api.pickPortable.bind(api);
  const importPortable = api.importPortable.bind(api);

  async function handlePick() {
    if (running) return;
    setRunning("pick");
    setError(null);
    setNotice(null);
    try {
      const result = await pickPortable(sessionToken);
      if (isBackupFailure(result)) {
        if (result.code !== "CANCELLED") setError(result.message);
        return;
      }
      setPicked({ pickId: result.pickId, fileName: result.fileName, sizeBytes: result.sizeBytes });
    } finally {
      setRunning(null);
    }
  }

  async function handleImport() {
    if (running || !picked) return;
    setRunning("import");
    setError(null);
    setNotice(null);
    try {
      const result = await importPortable(sessionToken, picked.pickId, passphrase);
      if (isBackupFailure(result)) {
        setError(result.message);
        if (result.code === "NOT_FOUND") setPicked(null);
        return;
      }
      setPassphrase("");
      setNotice(t("portableImport.done"));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      <div className="text-[13px] font-semibold text-ink">{t("portableImport.title")}</div>
      <p className="mt-[4px] text-[12.5px] text-ink-muted">
        {firstRun ? t("portableImport.firstRunHint") : t("portableImport.hint")}
      </p>
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        <Button variant="default" disabled={running !== null} onClick={() => void handlePick()}>
          {t("portableImport.pick")}
        </Button>
        {picked ? (
          <span className="mz-lat text-[12px] text-ink-muted">
            {t("portableImport.picked", { name: picked.fileName, size: megabytes(picked.sizeBytes) })}
          </span>
        ) : null}
      </div>
      {picked ? (
        <div className="mt-[12px] flex flex-col gap-[10px]">
          <div className="max-w-[280px]">
            <TextInput
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-label={t("portableImport.passphrase")}
              placeholder={t("portableImport.passphrase")}
            />
          </div>
          {firstRun ? null : (
            <label className="flex items-start gap-[8px] text-[12.5px] text-danger-ink">
              <input
                type="checkbox"
                className="mt-[3px]"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              <span>{t("portableImport.confirm")}</span>
            </label>
          )}
          <div>
            <Button
              variant={firstRun ? "primary" : "danger-outline"}
              disabled={running !== null || passphrase.length === 0 || !understood}
              onClick={() => void handleImport()}
            >
              {running === "import" ? t("portableImport.working") : t("portableImport.run")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-[10px] text-[12px] text-success-ink">{notice}</p> : null}
    </div>
  );
}
