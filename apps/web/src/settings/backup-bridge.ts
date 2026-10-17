export enum DrillOutcome {
  Pass = "pass",
  Warn = "warn",
  Fail = "fail",
}

export enum DrillCheck {
  NoArchive = "no_archive",
  Archive = "archive",
  Manifest = "manifest",
  Checksum = "checksum",
  Key = "key",
  Integrity = "integrity",
  Open = "open",
  Schema = "schema",
  RowCounts = "row_counts",
  Invariants = "invariants",
  Crashed = "crashed",
}

export enum DrillTrigger {
  Manual = "manual",
  Scheduled = "scheduled",
}

export type BackupEntry = {
  fileName: string;
  createdAt: string;
  appVersion: string | null;
  reason: string | null;
  sizeBytes: number;
  tables: Record<string, number> | null;
  readable: boolean;
};

export type BackupFailure = { ok: false; code: string; message: string };

export type DrillRecord = {
  id: string;
  trigger: DrillTrigger;
  startedAt: string;
  durationMs: number;
  outcome: DrillOutcome;
  failedCheck: DrillCheck | null;
  detail: string | null;
  archive: string | null;
  archiveCreatedAt: string | null;
  archiveBytes: number | null;
  tables: number | null;
  rows: number | null;
  invariants: { trialBalance: string; inventory: string; payables: string; receivables: string } | null;
};

export type SecondTarget = {
  dir: string | null;
  lastCopyAt: string | null;
  lastCopyOk: boolean | null;
  lastCopyFile: string | null;
  lastCopyError: string | null;
};

export type ListResult = { backupsDir: string; entries: BackupEntry[]; archivesEncrypted?: boolean } | BackupFailure;
export type CreateResult = { ok: true; entry: BackupEntry } | BackupFailure;
export type RestoreResult =
  | { ok: true; restoredFrom: BackupEntry; safetyBackupFileName: string | null; relaunching: boolean }
  | BackupFailure;
export type ExportResult = { ok: true; filePath: string } | BackupFailure;
export type StatusResult =
  | {
      ok: true;
      drills: DrillRecord[];
      lastGoodDrillAt: string | null;
      staleAfterDays: number;
      drillRunning: boolean;
      secondTarget: SecondTarget;
      lastBackupAt?: string | null;
      diskFreeBytes?: number | null;
    }
  | BackupFailure;
export type DrillResult = { ok: true; drill: DrillRecord } | BackupFailure;
export type PickResult = { ok: true; pickId: string; fileName: string; sizeBytes: number } | BackupFailure;
export type SecondTargetResult = { ok: true; secondTarget: SecondTarget } | BackupFailure;

export interface BackupBridge {
  list(sessionToken: string): Promise<ListResult>;
  create(sessionToken: string): Promise<CreateResult>;
  restore(sessionToken: string, fileName: string): Promise<RestoreResult>;
  revertToPreUpdate?(sessionToken: string): Promise<RestoreResult>;
  exportPortable?(sessionToken: string, passphrase: string): Promise<ExportResult>;
  drill?(sessionToken: string): Promise<DrillResult>;
  status?(sessionToken: string): Promise<StatusResult>;
  pickPortable?(sessionToken: string): Promise<PickResult>;
  importPortable?(sessionToken: string, pickId: string, passphrase: string): Promise<RestoreResult>;
  chooseSecondTarget?(sessionToken: string): Promise<SecondTargetResult>;
  clearSecondTarget?(sessionToken: string): Promise<SecondTargetResult>;
}

export function backupBridge(): BackupBridge | undefined {
  return (globalThis as { mezan?: { backup?: BackupBridge } }).mezan?.backup;
}

export function isBackupFailure(result: object): result is BackupFailure {
  return "ok" in result && (result as { ok: unknown }).ok === false;
}

export function daysSince(iso: string, now: Date = new Date()): number {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - at) / 86_400_000);
}

export function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}
