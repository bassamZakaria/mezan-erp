/** Thrown when an archive's `manifest.json` fails schema validation. */
export class ManifestValidationError extends Error {
  constructor(details: string) {
    super(`Backup manifest failed validation: ${details}`);
    this.name = "ManifestValidationError";
  }
}

/** Thrown when the extracted database's checksum does not match the manifest. */
export class ChecksumMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Backup checksum mismatch — archive is corrupt or was tampered with (expected ${expected}, got ${actual}).`,
    );
    this.name = "ChecksumMismatchError";
  }
}

/** Thrown when `PRAGMA integrity_check` on a restored database fails. */
export class IntegrityCheckFailedError extends Error {
  constructor(readonly report: string) {
    super(`SQLite integrity check failed on restored database: ${report}`);
    this.name = "IntegrityCheckFailedError";
  }
}

/** Thrown when an archive is missing an expected member (db file / manifest). */
export class ArchiveContentsError extends Error {
  constructor(details: string) {
    super(`Backup archive is missing expected contents: ${details}`);
    this.name = "ArchiveContentsError";
  }
}
