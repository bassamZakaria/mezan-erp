import { readdir } from "node:fs/promises";
import path from "node:path";

export const BACKUPS_FOLDER_NAME = "Mezan Backups";

export interface BackupStatusReading {
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
}

/** The folder the shell writes archives to: a sibling of the app's user-data folder. The backend worker has no `electron`, so it derives the same path from the user-data path it is handed. */
export function backupsDirBesideUserData(userDataDir: string): string {
  return path.join(path.dirname(userDataDir), BACKUPS_FOLDER_NAME);
}

// INVARIANT: mirrors `backupFileName` / `parseCreatedAtFromFileName` in backup-service.ts. Kept here because the backend worker must not load the archiver stack that module pulls in.
const ARCHIVE_STAMP = /^mezan-backup-(?:.+?-)?(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.mezanbak$/;

function createdAtOf(fileName: string): Date | null {
  const match = ARCHIVE_STAMP.exec(fileName);
  if (!match) return null;
  const [, day, hh, mm, ss, ms] = match;
  const created = new Date(`${day}T${hh}:${mm}:${ss}.${ms}Z`);
  return Number.isNaN(created.getTime()) ? null : created;
}

/**
 * What the owner digest reports about backups: the newest archive the folder holds. A missing folder
 * means no backup was ever taken, which is itself the finding; an unreadable one is not reported.
 */
export async function readBackupStatus(backupsDir: string): Promise<BackupStatusReading | null> {
  let names: string[];
  try {
    names = await readdir(backupsDir);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { lastSuccessAt: null, lastFailureAt: null } : null;
  }
  let newest: Date | null = null;
  for (const name of names) {
    const created = createdAtOf(name);
    if (created && (newest === null || created > newest)) newest = created;
  }
  return { lastSuccessAt: newest ? newest.toISOString() : null, lastFailureAt: null };
}
