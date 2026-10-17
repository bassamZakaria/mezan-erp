import { createCipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCb } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { create as tarCreate } from "tar";
import { TenantBackupRefusalError, type PlatformTenantBackupsPort } from "@mezan/backend";
import {
  TENANT_EXPORT_MIN_PASSPHRASE_LENGTH,
  TenantBackupDrillOutcome,
  TenantBackupRefusal,
  type TenantBackupDrillResultDTO,
  type TenantExportOfferDTO,
} from "@mezan/contracts";
import type { Tenant } from "@mezan/domain";
import { CURRENT_SCHEMA_VERSION, openSqliteConnection } from "@mezan/persistence";
import { BackupVerifyOutcome, type BackupInspection } from "./backup-verify-core.js";
import { inspectBackupOffThread, tenantBackupFolder } from "./backup-scheduler.js";
import type { TenantRouter } from "./tenant-router.js";

export const EXPORTS_FOLDER = "exports";
export const EXPORT_TTL_MS = 10 * 60 * 1000;
const EXPORT_FILE_SUFFIX = ".enc";
const PORTABLE_EXTENSION = ".mezanbak.enc";
const MAGIC = Buffer.from("MEZANPBK1");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const MANIFEST_FORMAT = 1;
const MANIFEST_REASON = "manual";
const APP_VERSION = "cloud";
const LARGEST_TABLES = 8;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const TOKEN_BYTES = 32;
const WORK_DIR_PREFIX = "work-";
const SCRUBBED_TABLES = [
  { name: "sign_in_attempt", clear: "DELETE FROM sign_in_attempt" },
  { name: "resource_lease", clear: "DELETE FROM resource_lease" },
  { name: "auth_session", clear: "DELETE FROM auth_session" },
  { name: "auth_session_displaced", clear: "DELETE FROM auth_session_displaced" },
] as const;

const refuse = (code: TenantBackupRefusal, message: string, messageEn: string, status: 404 | 409 | 422 | 503): TenantBackupRefusalError =>
  new TenantBackupRefusalError(code, message, messageEn, status);

interface PendingExport {
  readonly tenantId: string;
  readonly file: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly expiresAt: number;
  readonly timer: NodeJS.Timeout;
}

export interface TenantBackupsOptions {
  readonly dir: string;
  readonly router: Pick<TenantRouter, "backendOf">;
  readonly now: () => Date;
  readonly inspect?: (file: string) => Promise<BackupInspection>;
  readonly ttlMs?: number;
}

export interface TenantBackupsService extends PlatformTenantBackupsPort {
  close(): void;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(passphrase.normalize("NFKC"), salt, KEY_BYTES, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: 1, maxmem: SCRYPT_MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

// EXTERNAL CONTRACT: the byte layout the desktop edition's `decryptFile` reads
// (apps/desktop/src/backup/portable-export.ts): MAGIC | salt | iv | AES-256-GCM body | 16-byte tag.
async function encryptPortable(source: string, target: string, passphrase: string): Promise<void> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
  const out = createWriteStream(target, { mode: FILE_MODE });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => {
    out.once("error", reject);
    out.end(cipher.getAuthTag(), () => resolve());
  });
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

const hashOfToken = (token: string): string => createHash("sha256").update(token).digest("hex");

function stampOf(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function describeTables(tables: Readonly<Record<string, number>>) {
  const entries = Object.entries(tables);
  const sorted = [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    tableCount: entries.length,
    totalRows: entries.reduce((sum, [, rows]) => sum + rows, 0),
    emptyTables: entries.filter(([, rows]) => rows === 0).length,
    largestTables: sorted.filter(([, rows]) => rows > 0).slice(0, LARGEST_TABLES).map(([name, rows]) => ({ name, rows })),
  };
}

// SECURITY/CORRECTNESS: only entries older than an offer can live are removed. Another instance
// sharing this folder may be encrypting or serving a younger file right now.
function removeOrphans(root: string, olderThan: number): void {
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith(WORK_DIR_PREFIX) && !entry.endsWith(EXPORT_FILE_SUFFIX)) continue;
    const target = path.join(root, entry);
    try {
      if (statSync(target).mtimeMs < olderThan) rmSync(target, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}

// SECURITY: the sign-in log holds accounts and source addresses of failed sign-ins, the session tables
// hold live sessions a restored copy must not bring back, and the lease table is another instance's
// coordination state. Neither belongs in a file that leaves the platform; the live
// database is never touched, and VACUUM drops the deleted rows from free pages.
function scrubSnapshot(file: string): void {
  const { sqlite } = openSqliteConnection(file);
  try {
    for (const table of SCRUBBED_TABLES) {
      if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table.name)) sqlite.exec(table.clear);
    }
    sqlite.exec("VACUUM");
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    sqlite.close();
  }
}

export function createTenantBackups(options: TenantBackupsOptions): TenantBackupsService {
  const { dir, router, now } = options;
  const inspect = options.inspect ?? inspectBackupOffThread;
  const ttlMs = options.ttlMs ?? EXPORT_TTL_MS;
  const root = path.join(dir, EXPORTS_FOLDER);
  const offers = new Map<string, PendingExport>();
  const busy = new Set<string>();

  mkdirSync(root, { recursive: true, mode: DIR_MODE });
  removeOrphans(root, Date.now() - ttlMs);

  const discard = (hash: string): void => {
    const offer = offers.get(hash);
    if (!offer) return;
    offers.delete(hash);
    clearTimeout(offer.timer);
    rmSync(offer.file, { force: true });
  };

  const discardOffersOf = (tenantId: string): void => {
    for (const [hash, offer] of offers) if (offer.tenantId === tenantId) discard(hash);
  };

  const exclusive = async <T>(tenantId: string, work: () => Promise<T>): Promise<T> => {
    if (busy.has(tenantId)) {
      throw refuse(TenantBackupRefusal.Busy, "عملية نسخ أخرى جارية لهذه المنشأة. انتظر حتى تنتهي.", "Another backup operation is running for this tenant. Wait for it to finish.", 409);
    }
    busy.add(tenantId);
    try {
      return await work();
    } finally {
      busy.delete(tenantId);
    }
  };

  const backupFilesOf = (tenantId: string): string[] => {
    const folder = tenantBackupFolder(dir, tenantId);
    try {
      return readdirSync(folder).filter((f) => f.endsWith(".sqlite")).sort().reverse();
    } catch {
      return [];
    }
  };

  async function exportTenant({ tenant, passphrase }: { tenant: Tenant; passphrase: string }): Promise<TenantExportOfferDTO> {
    if (passphrase.length < TENANT_EXPORT_MIN_PASSPHRASE_LENGTH) {
      throw refuse(TenantBackupRefusal.ExportFailed, "كلمة سر الملف قصيرة جدًا", "The file passphrase is too short", 422);
    }
    return exclusive(tenant.id, async () => {
      discardOffersOf(tenant.id);
      const work = await mkdtemp(path.join(root, WORK_DIR_PREFIX));
      await mkdir(work, { recursive: true, mode: DIR_MODE });
      try {
        const stage = path.join(work, "stage");
        await mkdir(stage, { mode: DIR_MODE });
        const dbFile = path.join(stage, "db.sqlite");
        const backend = await router.backendOf(tenant.id);
        await backend.backupTo(dbFile);
        scrubSnapshot(dbFile);

        const inspection = await inspect(dbFile);
        if (inspection.outcome !== BackupVerifyOutcome.Ok) {
          throw refuse(TenantBackupRefusal.ExportFailed, "فشل فحص سلامة النسخة فلم يُنشأ ملف التصدير", `The snapshot failed its integrity check, so no export was made: ${inspection.report}`, 422);
        }
        if (inspection.boundTenantId !== null && inspection.boundTenantId !== tenant.id) {
          throw refuse(TenantBackupRefusal.ExportFailed, "قاعدة البيانات مرتبطة بمنشأة أخرى فلم يُنشأ ملف التصدير", "The database is bound to another tenant, so no export was made", 422);
        }

        const createdAt = now();
        await writeFile(
          path.join(stage, "manifest.json"),
          JSON.stringify({
            manifestFormat: MANIFEST_FORMAT,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            appVersion: APP_VERSION,
            createdAt: createdAt.toISOString(),
            checksum: await sha256Of(dbFile),
            tables: inspection.tables,
            reason: MANIFEST_REASON,
          }),
          { mode: FILE_MODE },
        );

        const archive = path.join(work, "archive.tar.gz");
        await tarCreate({ gzip: true, file: archive, cwd: stage, portable: true }, ["manifest.json", "db.sqlite"]);

        const staged = path.join(work, "export.enc");
        await encryptPortable(archive, staged, passphrase);

        const file = path.join(root, `${randomUUID()}${EXPORT_FILE_SUFFIX}`);
        await rename(staged, file);
        const bytes = (await stat(file)).size;

        const token = randomBytes(TOKEN_BYTES).toString("base64url");
        const hash = hashOfToken(token);
        const expiresAt = createdAt.getTime() + ttlMs;
        const timer = setTimeout(() => discard(hash), ttlMs);
        timer.unref();
        const fileName = `mezan-portable-${stampOf(createdAt)}${PORTABLE_EXTENSION}`;
        offers.set(hash, { tenantId: tenant.id, file, fileName, bytes, expiresAt, timer });

        const { tableCount, totalRows } = describeTables(inspection.tables);
        return {
          downloadPath: `/tenants/${encodeURIComponent(tenant.id)}/export/${token}`,
          fileName,
          bytes,
          expiresAt: new Date(expiresAt).toISOString(),
          tableCount,
          totalRows,
        };
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  }

  async function takeExport({ tenant, token }: { tenant: Tenant; token: string }) {
    const hash = hashOfToken(token);
    const offer = offers.get(hash);
    if (!offer || offer.tenantId !== tenant.id || offer.expiresAt <= now().getTime()) {
      if (offer && offer.expiresAt <= now().getTime()) discard(hash);
      return null;
    }
    offers.delete(hash);
    clearTimeout(offer.timer);
    const stream = createReadStream(offer.file);
    stream.once("close", () => rmSync(offer.file, { force: true }));
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, fileName: offer.fileName, bytes: offer.bytes };
  }

  async function list(tenant: Tenant) {
    const folder = tenantBackupFolder(dir, tenant.id);
    return backupFilesOf(tenant.id).flatMap((file) => {
      try {
        const info = statSync(path.join(folder, file));
        return [{ file, bytes: info.size, createdAt: info.mtime.toISOString() }];
      } catch {
        return [];
      }
    });
  }

  async function drill({ tenant, file }: { tenant: Tenant; file?: string }): Promise<TenantBackupDrillResultDTO> {
    const files = backupFilesOf(tenant.id);
    if (files.length === 0) {
      throw refuse(TenantBackupRefusal.NoBackup, "لا توجد نسخة احتياطية لهذه المنشأة بعد", "This tenant has no stored backup yet", 409);
    }
    const chosen = file === undefined ? files[0]! : files.find((f) => f === file);
    if (chosen === undefined) {
      throw refuse(TenantBackupRefusal.BackupNotFound, "النسخة المختارة غير موجودة", "The chosen backup does not exist", 404);
    }
    return exclusive(tenant.id, async () => {
      const inspection = await inspect(path.join(tenantBackupFolder(dir, tenant.id), chosen));
      const summary = describeTables(inspection.tables);
      let outcome = inspection.outcome === BackupVerifyOutcome.Ok ? TenantBackupDrillOutcome.Pass : TenantBackupDrillOutcome.Fail;
      let report = inspection.report;
      if (outcome === TenantBackupDrillOutcome.Pass && summary.tableCount === 0) {
        outcome = TenantBackupDrillOutcome.Fail;
        report = "the backup holds no tables";
      }
      if (outcome === TenantBackupDrillOutcome.Pass && inspection.boundTenantId !== null && inspection.boundTenantId !== tenant.id) {
        outcome = TenantBackupDrillOutcome.Fail;
        report = "the backup is bound to another tenant";
      }
      return { file: chosen, at: now().toISOString(), outcome, report, ...summary, ms: inspection.ms };
    });
  }

  return {
    list,
    drill,
    exportTenant,
    takeExport,
    close() {
      for (const hash of [...offers.keys()]) discard(hash);
    },
  };
}
