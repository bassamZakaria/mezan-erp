import { z } from "zod";
import type Database from "better-sqlite3";
import { ManifestValidationError } from "./errors.js";

/**
 * Bump this when the manifest's own shape changes (not the app's SQLite
 * schema version, which is `schemaVersion` below). Lets `restore-service.ts`
 * reject an archive written by a manifest format it doesn't understand
 * instead of misreading it.
 */
export const MANIFEST_FORMAT = 1;

/**
 * The current on-disk SQLite schema version this build writes. Desktop has
 * no migration runner yet (Phase 0 — only `journal_entry`/`journal_line`
 * exist, created idempotently by `createSqliteUnitOfWork`); this constant is
 * the seam the migration engine will bump once it exists (docs/archive/plan.md
 * §2.3 "Migrations"). Kept local to the backup module rather than imported
 * from @mezan/persistence so backups stay decoupled from that package's
 * internal schema shape.
 */
export const CURRENT_SCHEMA_VERSION = 1;

export const manifestSchema = z.object({
  manifestFormat: z.number().int().positive(),
  schemaVersion: z.number().int().nonnegative(),
  appVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  /** sha256 hex digest of the packaged database file. */
  checksum: z.string().regex(/^[a-f0-9]{64}$/, "checksum must be a sha256 hex digest"),
  /** Row count per user table, for a cheap post-restore sanity display. */
  tables: z.record(z.string(), z.number().int().nonnegative()),
  /** Reason this backup was taken — surfaced in the restore picker. */
  reason: z.enum(["manual", "scheduled", "pre-migration", "on-close", "pre-update"]),
  /**
   * ISO timestamp of the last successful FULL `PRAGMA integrity_check` this
   * install ran, carried forward on a backup that only re-proved itself the
   * cheaper way (checksum + extract + header) under the weekly cadence.
   * Absent/`null` means never run — always due. Absent entirely on an archive
   * from before this field existed, which restore treats the same as `null`.
   */
  lastIntegrityCheckAt: z.string().datetime().nullable().optional(),
  /**
   * Attachment archive members stored beside the archive, uncompressed,
   * because their file type already is (jpg, mp4, zip, ...) — skipped from
   * the gzip'd tar rather than compressed twice for nothing. Absent/empty on
   * every archive with no attachments, which is every archive so far: the
   * attachments feature itself has not shipped yet.
   */
  looseAttachments: z.array(z.string()).optional(),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export type BackupReason = BackupManifest["reason"];

/** Row counts for every user table (excludes SQLite's own `sqlite_*` tables). */
export function countRows(sqlite: Database.Database): Record<string, number> {
  const tables = sqlite
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all();

  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    // Table names come only from sqlite_master, never user input — safe to
    // interpolate; better-sqlite3 has no parameter binding for identifiers.
    const row = sqlite
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM "${name}"`)
      .get();
    counts[name] = row?.count ?? 0;
  }
  return counts;
}

export function buildManifest(params: {
  checksum: string;
  tables: Record<string, number>;
  appVersion: string;
  reason: BackupReason;
  schemaVersion?: number;
  createdAt?: Date;
  lastIntegrityCheckAt?: string | null;
  looseAttachments?: readonly string[];
}): BackupManifest {
  return {
    manifestFormat: MANIFEST_FORMAT,
    schemaVersion: params.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    appVersion: params.appVersion,
    createdAt: (params.createdAt ?? new Date()).toISOString(),
    checksum: params.checksum,
    tables: params.tables,
    reason: params.reason,
    ...(params.lastIntegrityCheckAt !== undefined ? { lastIntegrityCheckAt: params.lastIntegrityCheckAt } : {}),
    ...(params.looseAttachments && params.looseAttachments.length > 0
      ? { looseAttachments: [...params.looseAttachments] }
      : {}),
  };
}

export function serializeManifest(manifest: BackupManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseManifest(raw: string): BackupManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ManifestValidationError(`not valid JSON (${(err as Error).message})`);
  }

  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    throw new ManifestValidationError(result.error.issues.map((i) => i.message).join("; "));
  }
  if (result.data.manifestFormat > MANIFEST_FORMAT) {
    throw new ManifestValidationError(
      `manifest format ${result.data.manifestFormat} is newer than this app understands (${MANIFEST_FORMAT})`,
    );
  }
  return result.data;
}
