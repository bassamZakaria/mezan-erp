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
  type BackupManifest,
  type BackupReason,
} from "./manifest.js";
export { sha256File } from "./checksum.js";
export {
  applyRetention,
  DEFAULT_RETENTION_POLICY,
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
  isDrillRunning,
  abortDrill,
  DRILLS_FILE_NAME,
  DRILL_STALE_AFTER_DAYS,
} from "./drill-service.js";
