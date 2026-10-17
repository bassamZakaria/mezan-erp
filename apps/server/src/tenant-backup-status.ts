import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { OwnerDigestBackupReading } from "@mezan/api";
import { tenantBackupFolder } from "./backup-scheduler.js";
import { BackupVerifyOutcome, VERIFY_LOG_FILE_NAME, type BackupVerifyRecord } from "./backup-verify-core.js";

const VERIFY_LOG_TAIL = 50;

function mtimeMs(file: string): number {
  return existsSync(file) ? statSync(file).mtimeMs : 0;
}

/**
 * The backup sweep only snapshots tenants that are open, so an idle tenant's newest snapshot is old
 * without anything being unprotected. A snapshot newer than the last write to the books (database and
 * WAL) therefore counts as taken now.
 */
export function readTenantBackupStatus(platformDir: string, tenantId: string, dbPath: string, now: () => Date = () => new Date()): OwnerDigestBackupReading {
  const folder = tenantBackupFolder(platformDir, tenantId);
  const snapshots = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".sqlite")).sort() : [];
  const newest = snapshots.at(-1);
  const snapshotMs = newest ? mtimeMs(path.join(folder, newest)) : 0;
  const booksMs = Math.max(mtimeMs(dbPath), mtimeMs(`${dbPath}-wal`));
  const lastSuccessAt = newest ? new Date(booksMs <= snapshotMs ? now().getTime() : snapshotMs).toISOString() : null;

  let lastFailureAt: string | null = null;
  const log = path.join(folder, VERIFY_LOG_FILE_NAME);
  if (existsSync(log)) {
    for (const line of readFileSync(log, "utf8").trim().split("\n").slice(-VERIFY_LOG_TAIL)) {
      try {
        const record = JSON.parse(line) as BackupVerifyRecord;
        if (record.outcome === BackupVerifyOutcome.Failed) lastFailureAt = record.at;
      } catch {
        continue;
      }
    }
  }
  return { lastSuccessAt, lastFailureAt };
}
