import { appendFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSqliteConnection } from "@mezan/persistence";

/**
 * The O(db size) half of the cloud backup check — verifying a just-written
 * archive by opening a COPY of it and running `PRAGMA integrity_check`. Split
 * out of `backup-scheduler.ts` so `backup-verify-worker.ts` can run it inside
 * a worker thread: this module touches only a file path and a clock, never a
 * live tenant connection, so it has nothing that cannot cross a thread
 * boundary (see `runVerifyOffThread` in `backup-scheduler.ts`).
 */

export const VERIFY_LOG_FILE_NAME = "verify.jsonl";

export enum BackupVerifyOutcome {
  Ok = "ok",
  Failed = "failed",
}

export interface BackupVerifyRecord {
  readonly at: string;
  readonly file: string;
  readonly outcome: BackupVerifyOutcome;
  readonly ms: number;
  readonly report: string;
}

export function appendVerifyRecord(record: BackupVerifyRecord, backupPath: string): void {
  appendFileSync(path.join(path.dirname(backupPath), VERIFY_LOG_FILE_NAME), `${JSON.stringify(record)}\n`);
}

// The COPY is opened, never the backup itself: opening a SQLite file can write to it.
export async function verifyBackupFile(backupPath: string, now: Date = new Date()): Promise<BackupVerifyRecord> {
  const started = Date.now();
  const sandbox = await mkdtemp(path.join(tmpdir(), "mezan-backup-verify-"));
  let outcome = BackupVerifyOutcome.Failed;
  let report: string;
  try {
    const copy = path.join(sandbox, "restore.sqlite");
    await copyFile(backupPath, copy);
    const { sqlite } = openSqliteConnection(copy);
    try {
      const rows = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
      report = rows.map((r) => r.integrity_check).join("; ");
      if (report === "ok") outcome = BackupVerifyOutcome.Ok;
    } finally {
      sqlite.close();
    }
  } catch (err) {
    report = err instanceof Error ? err.message : String(err);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
  const record: BackupVerifyRecord = {
    at: now.toISOString(),
    file: path.basename(backupPath),
    outcome,
    ms: Date.now() - started,
    report,
  };
  appendVerifyRecord(record, backupPath);
  return record;
}
