export {
  createBackup,
  listBackups,
  backupFileName,
  parseCreatedAtFromFileName,
  BACKUP_FILE_EXTENSION,
  PRE_UPDATE_LABEL_PREFIX,
  isPreUpdateArchive,
  preUpdateLabel,
  type BackupResult,
} from "./backup-service.js";
export {
  exportPortableBackup,
  encryptFile,
  decryptFile,
  portableFileName,
  WeakPassphraseError,
  MIN_PASSPHRASE_LENGTH,
  PORTABLE_FILE_EXTENSION,
} from "./portable-export.js";
export {
  restoreBackup,
  verifyArchive,
  assertIntegrityOk,
  openArchiveDatabase,
  readDbSchemaVersion,
  type RestoreResult,
  type RestoreCipher,
} from "./restore-service.js";
export { runPreMigrationBackup } from "./pre-migration-hook.js";
export {
  buildManifest,
  parseManifest,
  serializeManifest,
  countRows,
  manifestSchema,
  MANIFEST_FORMAT,
  CURRENT_SCHEMA_VERSION,
  BackupReason,
  type BackupManifest,
} from "./manifest.js";
export { sha256File } from "./checksum.js";
export {
  applyRetention,
  DEFAULT_RETENTION_POLICY,
  MANUAL_ARCHIVES_KEPT,
  PRE_RESTORE_ARCHIVES_KEPT,
  PRE_RESTORE_MINIMUM_AGE_DAYS,
  PRE_UPDATE_ARCHIVES_KEPT,
  type RetentionCandidate,
  type RetentionPolicy,
  type RetentionResult,
} from "./retention.js";
export {
  createArchive,
  extractArchive,
  DB_ENTRY_NAME,
  MANIFEST_ENTRY_NAME,
  type ArchiveExtraFile,
  type ExtractedArchive,
} from "./archive.js";
export {
  ManifestValidationError,
  ChecksumMismatchError,
  IntegrityCheckFailedError,
  ArchiveContentsError,
  BackupKeyMismatchError,
  ArchiveDamagedError,
  SchemaTooNewForRestoreError,
} from "./errors.js";
export { withBackupLock } from "./backup-lock.js";
export {
  readSecondTarget,
  setSecondTargetDir,
  copyToSecondTarget,
  type SecondTargetState,
} from "./secondary-target.js";
export {
  runRestoreDrill,
  readDrillHistory,
  lastGoodDrill,
  isDrillDue,
  sweepBackupScratch,
  hasArchive,
  isDrillRunning,
  abortDrill,
  DRILLS_FILE_NAME,
  DRILL_STALE_AFTER_DAYS,
} from "./drill-service.js";
