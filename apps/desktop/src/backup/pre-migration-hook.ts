import type Database from "better-sqlite3";
import { createBackup, type BackupResult } from "./backup-service.js";
import { BackupReason } from "./manifest.js";

/**
 * Runs one "pre-migration" backup. Wired to run before any schema-changing
 * startup step — currently that's just `createSqliteUnitOfWork`'s idempotent
 * `CREATE TABLE IF NOT EXISTS`, but this is the seam docs/archive/plan.md §2.3
 * requires ("Desktop upgrades run migrations on launch, after an automatic
 * pre-migration backup ... with a rollback-to-backup path if anything
 * throws") for once a real migration runner lands. Call this, then run
 * migrations, then — only on failure — restore from `result.archivePath`.
 */
export async function runPreMigrationBackup(params: {
  sqlite: Database.Database;
  backupsDir: string;
  appVersion: string;
  /** True when `sqlite` is keyed — keeps the archive encrypted (backup-service.ts). */
  encrypted?: boolean;
  /**
   * Names the archive in the file system, so "revert to before the update" can
   * find it. Omitted by the one-off pre-encryption safety copy, which is not an
   * update and must not be what a revert picks up.
   */
  label?: string;
  /** Raw tenant key — moves the copy off the caller's process. See `createBackup`. */
  cipher?: { readonly key: string };
}): Promise<BackupResult> {
  return createBackup({
    sqlite: params.sqlite,
    backupsDir: params.backupsDir,
    appVersion: params.appVersion,
    reason: params.label ? BackupReason.PreUpdate : BackupReason.PreMigration,
    encrypted: params.encrypted,
    cipher: params.cipher,
    label: params.label,
  });
}
