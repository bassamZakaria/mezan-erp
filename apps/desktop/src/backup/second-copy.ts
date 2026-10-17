import type Database from "better-sqlite3";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "./backup-service.js";
import type { BackupReason } from "./manifest.js";
import { loadRecoveryKey, type RecoveryKey, type RecoveryKeyStore } from "./recovery-key.js";
import { copyToSecondTarget, readSecondTarget, sealToSecondTarget, type SecondTargetState } from "./secondary-target.js";

export const SECOND_COPY_SCRATCH_PREFIX = "second-copy-";

export interface SecondCopySource {
  readonly sqlite: Database.Database;
  readonly appVersion: string;
  readonly encrypted: boolean;
  readonly cipher?: { readonly key: string };
  readonly portable?: { readonly key: string; readonly open: (file: string, key: string) => Database.Database };
  readonly recoveryKeyStore?: RecoveryKeyStore;
}

async function recoveryKeyOf(backupsDir: string, keyStore: RecoveryKeyStore | undefined): Promise<RecoveryKey | null> {
  if (!keyStore) return null;
  try {
    return await loadRecoveryKey(backupsDir, keyStore);
  } catch (err) {
    console.error("[backup] the recovery key could not be unsealed; the second copy stays machine-keyed", err);
    return null;
  }
}

/**
 * The copy that leaves the machine. With a recovery secret set it is a
 * MEZANPBK1 file sealed under that secret, which opens on replacement hardware;
 * without one, it is the machine-keyed archive as before, and the state says
 * `lastCopyPortable: false` so the screen can tell the owner. Never throws.
 *
 * SECURITY: an encrypted install's portable snapshot is plaintext for the
 * seconds it takes to seal it, inside a private scratch directory under
 * `.tmp` that is removed in `finally` and swept on the next launch — never in
 * the backups folder itself, never in the second folder.
 */
export async function copyBackupToSecondTarget(params: {
  readonly backupsDir: string;
  readonly archivePath: string;
  readonly reason: BackupReason;
  readonly source: SecondCopySource;
  readonly now?: Date;
}): Promise<SecondTargetState> {
  const { backupsDir, archivePath, source } = params;
  const now = params.now ?? new Date();
  const state = await readSecondTarget(backupsDir);
  if (!state.dir) return state;

  const recovery = await recoveryKeyOf(backupsDir, source.recoveryKeyStore);
  if (!recovery) return copyToSecondTarget(backupsDir, archivePath, now);
  if (!source.encrypted) {
    return sealToSecondTarget(backupsDir, archivePath, path.basename(archivePath), recovery, now);
  }
  if (!source.portable) return copyToSecondTarget(backupsDir, archivePath, now);

  const tmpRoot = path.join(backupsDir, ".tmp");
  let scratch: string | null = null;
  try {
    await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    scratch = await mkdtemp(path.join(tmpRoot, SECOND_COPY_SCRATCH_PREFIX));
    const plain = await createBackup({
      sqlite: source.sqlite,
      backupsDir: scratch,
      appVersion: source.appVersion,
      reason: params.reason,
      encrypted: true,
      portable: source.portable,
      ...(source.cipher ? { cipher: source.cipher } : {}),
      retentionPolicy: { daily: 365, weekly: 0, monthly: 0 },
      now,
    });
    return await sealToSecondTarget(backupsDir, plain.archivePath, path.basename(archivePath), recovery, now);
  } catch (err) {
    console.error("[backup] the portable second copy could not be prepared; copying the machine-keyed archive", err);
    return copyToSecondTarget(backupsDir, archivePath, now);
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
