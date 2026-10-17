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

export interface BackupInspection {
  readonly outcome: BackupVerifyOutcome;
  readonly report: string;
  readonly tables: Readonly<Record<string, number>>;
  readonly boundTenantId: string | null;
  readonly ms: number;
}

function countUserTables(sqlite: { prepare(sql: string): { all(): unknown[]; get(): unknown } }): Record<string, number> {
  const names = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>;
  const counts: Record<string, number> = {};
  for (const { name } of names) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${name.replace(/"/g, '""')}"`).get() as { count: number } | undefined;
    counts[name] = row?.count ?? 0;
  }
  return counts;
}

function boundTenantIdOf(sqlite: { prepare(sql: string): { get(): unknown } }): string | null {
  try {
    const row = sqlite.prepare(`SELECT tenant_id FROM tenant_binding LIMIT 1`).get() as { tenant_id: string } | undefined;
    return row?.tenant_id ?? null;
  } catch {
    return null;
  }
}

// The COPY is opened, never the backup itself: opening a SQLite file can write to it.
export async function inspectBackupFile(backupPath: string): Promise<BackupInspection> {
  const started = Date.now();
  const sandbox = await mkdtemp(path.join(tmpdir(), "mezan-backup-verify-"));
  let outcome = BackupVerifyOutcome.Failed;
  let report: string;
  let tables: Record<string, number> = {};
  let boundTenantId: string | null = null;
  try {
    const copy = path.join(sandbox, "restore.sqlite");
    await copyFile(backupPath, copy);
    const { sqlite } = openSqliteConnection(copy);
    try {
      const rows = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
      report = rows.map((r) => r.integrity_check).join("; ");
      if (report === "ok") {
        outcome = BackupVerifyOutcome.Ok;
        tables = countUserTables(sqlite);
        boundTenantId = boundTenantIdOf(sqlite);
      }
    } finally {
      sqlite.close();
    }
  } catch (err) {
    report = err instanceof Error ? err.message : String(err);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
  return { outcome, report, tables, boundTenantId, ms: Date.now() - started };
}

export async function verifyBackupFile(backupPath: string, now: Date = new Date()): Promise<BackupVerifyRecord> {
  const { outcome, report, ms } = await inspectBackupFile(backupPath);
  const record: BackupVerifyRecord = { at: now.toISOString(), file: path.basename(backupPath), outcome, ms, report };
  appendVerifyRecord(record, backupPath);
  return record;
}
