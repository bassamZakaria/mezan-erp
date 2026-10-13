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

/**
 * Thrown when an archive holds an ENCRYPTED database this install cannot open.
 *
 * Distinct from `IntegrityCheckFailedError` on purpose: both surface as "the
 * file will not open", but the causes are opposite and so are the remedies.
 * A corrupt archive is gone; an archive from another machine is intact and
 * needs that machine's key (the card `main/encrypted-database.ts` writes).
 * Telling an owner their backup is corrupt when it is merely foreign is how a
 * usable restore gets thrown away.
 */
export class BackupKeyMismatchError extends Error {
  constructor(cause?: unknown) {
    super(
      "The backup archive is encrypted with a different key than this installation holds — " +
        "it was taken on other hardware or under another OS user account.",
      cause === undefined ? undefined : { cause },
    );
    this.name = "BackupKeyMismatchError";
  }
}

export class SchemaTooNewForRestoreError extends Error {
  constructor(
    readonly fileVersion: number,
    readonly appVersion: number,
  ) {
    super(`The archive's database schema (${fileVersion}) is newer than this build understands (${appVersion}).`);
    this.name = "SchemaTooNewForRestoreError";
  }
}

export class ArchiveDamagedError extends Error {
  readonly messageEn = "The backup file is damaged or incomplete and cannot be opened. Your data was not changed. Use another backup, or copy this file again from where it is kept.";
  constructor(cause?: unknown) {
    super(
      "ملف النسخة الاحتياطية تالف أو غير مكتمل ولا يمكن فتحه. لم تتغيّر بياناتك. استخدم نسخة أخرى، أو انسخ هذا الملف من مصدره مرة ثانية.",
      cause === undefined ? undefined : { cause },
    );
    this.name = "ArchiveDamagedError";
  }
}
