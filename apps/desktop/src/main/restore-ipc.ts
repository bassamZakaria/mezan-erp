import { ipcMain } from "electron";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { extract as tarExtract } from "tar";
import type Database from "better-sqlite3";
import type { SessionRegistry } from "@mezan/api";
import {
  createBackup,
  listBackups,
  parseManifest,
  restoreBackup,
  BackupKeyMismatchError,
  BACKUP_FILE_EXTENSION,
  MANIFEST_ENTRY_NAME,
  type BackupManifest,
  type RestoreCipher,
} from "../backup/index.js";
import {
  MEZAN_BACKUP_CREATE_CHANNEL,
  MEZAN_BACKUP_LIST_CHANNEL,
  MEZAN_BACKUP_RESTORE_CHANNEL,
  type BackupCreateResult,
  type BackupEntryDTO,
  type BackupFailure,
  type BackupListResult,
  type BackupRestoreResult,
} from "../shared/ipc-contract.js";

/**
 * The permission a restore needs.
 *
 * `admin.tenant.settings.edit` rather than a backup-specific code, because the
 * permission catalogue has none and inventing one here would put a permission
 * string in the desktop shell that no role can ever be granted. It is the right
 * tier regardless: replacing the database is the single most destructive act in
 * the product, and this is the catalogue's company-admin-only settings grant.
 */
/**
 * Restoring REPLACES the books, so it has a permission of its own rather than
 * riding on the tenant-settings grant: the person who holds the recovery
 * runbook should be able to do this without also being handed every setting in
 * the product.
 */
const RESTORE_PERMISSION = "admin.backup.restore";
/**
 * Reading the archive list is a weaker act than replacing the books with one,
 * so it takes the weaker grant. Taking a backup keeps the stronger one: it
 * writes a file into the backups directory that a later restore can be pointed
 * at, which is a step on the same path.
 */
const VIEW_PERMISSION = "admin.backup.view";

/**
 * Long enough for the `ipcMain.handle` reply to reach the renderer and paint,
 * short enough that nobody starts typing into a window that is about to close.
 */
const RELAUNCH_DELAY_MS = 750;

export interface RestoreIpcDeps {
  readonly dbPath: string;
  readonly backupsDir: string;
  readonly appVersion: string;
  /**
   * The live backup connection main/index.ts holds — the same dedicated
   * better-sqlite3 handle the scheduled backups use. Read through a getter
   * because it is undefined in dev (`:memory:`, nothing on disk to copy).
   */
  readonly sqlite: () => Database.Database | undefined;
  /**
   * The driver + key this install's database is encrypted with
   * (main/encrypted-database.ts). Undefined in dev (`:memory:`) and on an
   * install running with `--allow-unencrypted-database`.
   *
   * Both channels below need it, for opposite reasons: a backup TAKEN from a
   * keyed connection has to stay encrypted in the archive, and an archive that
   * IS encrypted cannot be integrity-checked before mounting without it.
   */
  readonly cipher?: RestoreCipher;
  /**
   * Closes EVERY connection to `dbPath`. Must close the backend's own
   * connection too, not just the backup one: on Windows the atomic rename in
   * `restoreBackup` fails outright while a handle is open, and on POSIX it
   * succeeds and leaves the still-running backend writing into an unlinked
   * inode — the restore appears to work and the next launch shows the old data.
   */
  readonly closeLiveConnections: () => void;
  /** `app.relaunch(); app.exit(0)`, injected so this module needs no Electron lifecycle of its own. */
  readonly relaunch: () => void;
  /** Reads the caller's grant from the live session registry (api/session-auth.ts). */
  readonly sessions: SessionRegistry;
}

function failure(code: BackupFailure["code"], message: string): BackupFailure {
  return { ok: false, code, message };
}

const UNAUTHORIZED = failure(
  "UNAUTHORIZED",
  "لا تملك صلاحية إدارة النسخ الاحتياطية. راجع مدير النظام.",
);

/**
 * The caller is who the SERVER says they are.
 *
 * An IPC channel carries no `authorization` header, so the token travels in the
 * payload — but it is still a token the server minted at login and holds in
 * `session-auth.ts`'s registry, never a permission the caller asserts about
 * itself. That distinction is the whole of this codebase's authorization
 * history: `x-permissions` was the client answering its own question, and these
 * three channels would otherwise be the one write surface in the product that
 * asks nobody anything.
 */
/**
 * Checks the caller against the permission the ACTION needs, not against the
 * strongest one this module knows about.
 *
 * `admin.backup.view` was declared here and then never consulted — every
 * channel, listing included, checked `admin.backup.restore` — so the weaker
 * grant was dead code and reading the archive list required the permission that
 * REPLACES the books. That is the wrong way round: an owner should be able to
 * let somebody confirm a backup ran last night without also letting them
 * overwrite the company's data.
 */
function authorize(deps: RestoreIpcDeps, token: unknown, permission: string): BackupFailure | null {
  if (typeof token !== "string" || token === "") return UNAUTHORIZED;
  const grant = deps.sessions.find(token);
  if (!grant) return UNAUTHORIZED;
  if (!grant.permissions.includes("*") && !grant.permissions.includes(permission)) {
    return UNAUTHORIZED;
  }
  return null;
}

/**
 * Turns a caller-supplied name back into a path INSIDE the backups directory,
 * or refuses.
 *
 * The renderer never hands over a path, and this never trusts one: a name with
 * a separator, a `..`, or anything that is not one of our own
 * `mezan-backup-*.mezanbak` files is refused before it reaches the filesystem.
 * Passing absolute paths across the bridge instead would let anything running
 * in the renderer nominate any file on the machine to be opened,
 * integrity-checked and copied over the company's database.
 */
function resolveArchivePath(backupsDir: string, fileName: unknown): string | null {
  if (typeof fileName !== "string" || fileName === "") return null;
  if (fileName !== path.basename(fileName)) return null;
  if (!fileName.endsWith(BACKUP_FILE_EXTENSION)) return null;
  const resolved = path.resolve(backupsDir, fileName);
  if (path.dirname(resolved) !== path.resolve(backupsDir)) return null;
  return resolved;
}

/**
 * Reads an archive's manifest and nothing else — `manifest.json` only, not the
 * database beside it. Listing ten backups the other way would copy ten whole
 * databases through the temp directory to render one screen.
 *
 * A manifest that will not parse does NOT drop the archive from the list. A
 * shop owner looking for last Tuesday's file needs to see that it is there and
 * damaged; a list that quietly omits it tells them the backup was never taken.
 */
async function describeArchive(archivePath: string, createdAtFallback: Date): Promise<BackupEntryDTO> {
  const sizeBytes = await stat(archivePath)
    .then((s) => s.size)
    .catch(() => 0);

  const workDir = path.join(tmpdir(), `mezan-manifest-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let manifest: BackupManifest | null = null;
  try {
    await mkdir(workDir, { recursive: true });
    await tarExtract({ file: archivePath, cwd: workDir }, [MANIFEST_ENTRY_NAME]);
    manifest = parseManifest(await readFile(path.join(workDir, MANIFEST_ENTRY_NAME), "utf8"));
  } catch {
    manifest = null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  return {
    fileName: path.basename(archivePath),
    createdAt: manifest?.createdAt ?? createdAtFallback.toISOString(),
    appVersion: manifest?.appVersion ?? null,
    reason: manifest?.reason ?? null,
    sizeBytes,
    tables: manifest?.tables ?? null,
    readable: manifest !== null,
  };
}

/**
 * The three channels the settings screen's «النسخ الاحتياطي والاستعادة» tab
 * drives, mirroring main/ipc.ts's `registerHonoOverIpc` /
 * `registerPrintToPdfOverIpc` shape.
 *
 * Nothing here throws across the bridge. An `ipcMain.handle` rejection reaches
 * the renderer as "Error invoking remote method 'mezan:backup:restore'", which
 * is not something to put in front of a shop owner in any language — so every
 * outcome is a discriminated result carrying an Arabic message the screen can
 * render as-is.
 */
export function registerRestoreOverIpc(deps: RestoreIpcDeps): void {
  ipcMain.handle(
    MEZAN_BACKUP_LIST_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupListResult | BackupFailure> => {
      const denied = authorize(deps, sessionToken, VIEW_PERMISSION);
      if (denied) return denied;

      const found = await listBackups(deps.backupsDir);
      found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const entries = await Promise.all(found.map((b) => describeArchive(b.path, b.createdAt)));
      return { backupsDir: deps.backupsDir, entries };
    },
  );

  ipcMain.handle(
    MEZAN_BACKUP_CREATE_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupCreateResult> => {
      const denied = authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;

      const sqlite = deps.sqlite();
      if (!sqlite) {
        return failure(
          "UNAVAILABLE",
          "لا توجد قاعدة بيانات على القرص في هذه النسخة التطويرية، فلا يمكن أخذ نسخة احتياطية.",
        );
      }

      try {
        const result = await createBackup({
          sqlite,
          backupsDir: deps.backupsDir,
          appVersion: deps.appVersion,
          reason: "manual",
          encrypted: deps.cipher !== undefined,
        });
        return { ok: true, entry: await describeArchive(result.archivePath, new Date()) };
      } catch (err) {
        console.error("[backup] manual backup failed", err);
        return failure("FAILED", "تعذّر إنشاء النسخة الاحتياطية. تأكد من وجود مساحة كافية على القرص.");
      }
    },
  );

  ipcMain.handle(
    MEZAN_BACKUP_RESTORE_CHANNEL,
    async (_event, sessionToken: unknown, fileName: unknown): Promise<BackupRestoreResult> => {
      const denied = authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;

      const archivePath = resolveArchivePath(deps.backupsDir, fileName);
      if (!archivePath) {
        return failure("INVALID_NAME", "اسم ملف النسخة الاحتياطية غير صالح.");
      }
      if (!(await stat(archivePath).catch(() => null))) {
        return failure("NOT_FOUND", "ملف النسخة الاحتياطية غير موجود. حدّث القائمة وحاول مرة أخرى.");
      }

      // The safety copy comes FIRST, and from the live connection, because after
      // the next few lines there is no live connection to take one from.
      // Without it, restoring the wrong file — which is exactly what a worried
      // owner does at 9pm with the shop shut — is irreversible.
      let safetyBackupFileName: string | null = null;
      const sqlite = deps.sqlite();
      if (sqlite) {
        try {
          const safety = await createBackup({
            sqlite,
            backupsDir: deps.backupsDir,
            appVersion: deps.appVersion,
            reason: "manual",
            encrypted: deps.cipher !== undefined,
          });
          safetyBackupFileName = path.basename(safety.archivePath);
        } catch (err) {
          console.error("[backup] safety backup before restore failed", err);
          return failure(
            "FAILED",
            "تعذّر أخذ نسخة احتياطية من بياناتك الحالية قبل الاستعادة، ولم تتم الاستعادة.",
          );
        }
      }

      const restoredFrom = await describeArchive(archivePath, new Date());
      deps.closeLiveConnections();

      try {
        const restored = await restoreBackup({
          archivePath,
          targetDbPath: deps.dbPath,
          workDir: path.dirname(deps.dbPath),
          cipher: deps.cipher,
        });
        console.log(
          `[backup] restored ${path.basename(archivePath)} ` +
            `(taken ${restored.manifest.createdAt} by app ${restored.manifest.appVersion})`,
        );
        // Scheduled, not awaited: `app.exit()` kills the process, and the reply
        // to this invoke has not reached the renderer yet. The screen gets its
        // confirmation, then the window goes.
        setTimeout(deps.relaunch, RELAUNCH_DELAY_MS);
        return { ok: true, restoredFrom, safetyBackupFileName, relaunching: true };
      } catch (err) {
        console.error("[backup] restore failed", err);
        // Every verification step runs BEFORE the atomic rename, so the live
        // database file is untouched — but its connections are now closed and
        // this process can no longer serve anything. Relaunching brings the app
        // back on exactly the data it had a moment ago.
        setTimeout(deps.relaunch, RELAUNCH_DELAY_MS);
        // A foreign key is not a damaged file, and saying so would send an
        // owner to delete a backup that is intact and restorable — it just
        // needs the key card from the machine that wrote it.
        if (err instanceof BackupKeyMismatchError) {
          return failure(
            "VERIFICATION_FAILED",
            "هذه النسخة الاحتياطية مشفّرة بمفتاح جهاز آخر، ولا يمكن فتحها هنا. استخدم مفتاح التشفير الخاص بالجهاز الذي أخذها. لم تتغيّر بياناتك.",
          );
        }
        return failure(
          "VERIFICATION_FAILED",
          "فشل التحقق من ملف النسخة الاحتياطية، ولم تتغيّر بياناتك. سيُعاد تشغيل البرنامج الآن.",
        );
      }
    },
  );
}
