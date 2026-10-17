import { dialog } from "electron";
import { handleGuarded } from "./ipc-guard.js";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { extract as tarExtract } from "tar";
import type Database from "better-sqlite3";
import type { SessionLookup } from "./backend-bridge.js";
import { createAuditEvent } from "@mezan/domain";
import {
  CURRENT_SCHEMA_VERSION,
  createSqliteAuditSink,
  deriveAuditChainKey,
  openSqliteConnection,
} from "@mezan/persistence";
import {
  copyToSecondTarget,
  createBackup,
  decryptFile,
  DRILL_STALE_AFTER_DAYS,
  exportPortableBackup,
  isDrillRunning,
  lastGoodDrill,
  readDrillHistory,
  readSecondTarget,
  runRestoreDrill,
  setSecondTargetDir,
  verifyArchive,
  withBackupLock,
  SchemaTooNewForRestoreError,
  PORTABLE_FILE_EXTENSION,
  type SecondTargetState,
  isPreUpdateArchive,
  listBackups,
  parseManifest,
  restoreBackup,
  BackupKeyMismatchError,
  ArchiveDamagedError,
  BackupReason,
  BACKUP_FILE_EXTENSION,
  MANIFEST_ENTRY_NAME,
  MIN_PASSPHRASE_LENGTH,
  WeakPassphraseError,
  type BackupManifest,
  type RestoreCipher,
} from "../backup/index.js";
import { encryptPlaintextDatabase } from "./encrypted-database.js";
import {
  DrillTrigger,
  MEZAN_BACKUP_CREATE_CHANNEL,
  MEZAN_BACKUP_DRILL_CHANNEL,
  MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_IMPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_LIST_CHANNEL,
  MEZAN_BACKUP_PICK_PORTABLE_CHANNEL,
  MEZAN_BACKUP_RESTORE_CHANNEL,
  MEZAN_BACKUP_REVERT_CHANNEL,
  MEZAN_BACKUP_SECOND_TARGET_CHOOSE_CHANNEL,
  MEZAN_BACKUP_SECOND_TARGET_CLEAR_CHANNEL,
  MEZAN_BACKUP_STATUS_CHANNEL,
  type BackupDrillResult,
  type BackupPickPortableResult,
  type BackupSecondTargetResult,
  type BackupStatusResult,
  type SecondTargetStatusDTO,
  type BackupCreateResult,
  type BackupEntryDTO,
  type BackupExportResult,
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

function newestBackupAt(entries: ReadonlyArray<{ createdAt: Date }>): string | null {
  let newest: Date | null = null;
  for (const entry of entries) if (newest === null || entry.createdAt > newest) newest = entry.createdAt;
  return newest ? newest.toISOString() : null;
}

async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    const fsStats = await statfs(dir);
    return Number(fsStats.bavail) * Number(fsStats.bsize);
  } catch {
    return null;
  }
}

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
   * The key and an opener for it, used ONLY by «تصدير نسخة قابلة للنقل» —
   * decrypting a copy is the only way an archive can be restored on replacement
   * hardware, and the copy is then re-encrypted under the operator's passphrase
   * before it reaches the backups folder. Nothing else in this module may use
   * it: a scheduled archive that took this path would be the books in the clear.
   */
  readonly portable?: {
    readonly key: string;
    readonly open: (file: string, key: string) => Database.Database;
  };
  /**
   * Closes EVERY connection to `dbPath`. Must close the backend's own
   * connection too, not just the backup one: on Windows the atomic rename in
   * `restoreBackup` fails outright while a handle is open, and on POSIX it
   * succeeds and leaves the still-running backend writing into an unlinked
   * inode — the restore appears to work and the next launch shows the old data.
   */
  readonly closeLiveConnections: () => void | Promise<void>;
  /** `app.relaunch(); app.exit(0)`, injected so this module needs no Electron lifecycle of its own. */
  readonly relaunch: () => void;
  /** Reads the caller's grant from the live session registry (api/session-auth.ts). */
  readonly sessions: SessionLookup;
  /**
   * Lets the portable import run with no session only while nobody has claimed
   * the tenant — the first-run screen on replacement hardware, where no account
   * exists yet. Omitted, a session is always required.
   */
  readonly tenantIsClaimed?: () => Promise<boolean>;
}

enum RestoreSource {
  Archive = "archive",
  PreUpdate = "pre-update",
  Portable = "portable",
}

const PICK_TTL_MS = 30 * 60 * 1000;
const picks = new Map<string, { readonly path: string; readonly fileName: string; readonly at: number }>();

function rememberPick(filePath: string): string {
  const now = Date.now();
  for (const [id, pick] of picks) if (now - pick.at > PICK_TTL_MS) picks.delete(id);
  const id = randomUUID();
  picks.set(id, { path: filePath, fileName: path.basename(filePath), at: now });
  return id;
}

function secondTargetDto(state: SecondTargetState): SecondTargetStatusDTO {
  return {
    dir: state.dir,
    lastCopyAt: state.lastCopyAt,
    lastCopyOk: state.lastCopyOk,
    lastCopyFile: state.lastCopyFile,
    lastCopyError: state.lastCopyError,
  };
}

function failure(code: BackupFailure["code"], message: string): BackupFailure {
  return { ok: false, code, message };
}

/** Who the SERVER says made this request. Never a name the caller asserts. */
async function actorOf(deps: RestoreIpcDeps, token: unknown): Promise<string> {
  if (typeof token !== "string") return "unknown";
  return (await deps.sessions.find(token))?.userId ?? "unknown";
}

/**
 * Records the restore in the RESTORED database's audit trail (audit S-3).
 *
 * AFTER the file swap, and this is the whole point: a restore replaces the
 * trail wholesale, so an event written before the swap is destroyed by the very
 * act it was recording. Written into the archive's own trail, the row survives
 * — and it is CRITICAL, because "somebody replaced the books with an older
 * copy" is the single most consequential thing that can happen to this file.
 *
 * A failure here never fails the restore: the data is already in place and
 * relaunch is scheduled. It goes to the console and the operator keeps their
 * books.
 */
async function recordRestoredEvent(
  deps: RestoreIpcDeps,
  actor: string,
  archiveFileName: string,
  manifestCreatedAt: string,
  safetyBackupFileName: string | null,
  source: RestoreSource,
): Promise<void> {
  let sqlite: Database.Database | undefined;
  try {
    const opened = openSqliteConnection(
      deps.dbPath,
      deps.cipher ? { driver: deps.cipher.driver, key: deps.cipher.key } : undefined,
    );
    sqlite = opened.sqlite;
    const sink = createSqliteAuditSink(
      sqlite,
      deps.cipher ? { chainKey: deriveAuditChainKey(deps.cipher.key) } : {},
    );
    await sink.append(
      createAuditEvent({
        stream: "security",
        module: "backup",
        entityType: "DATABASE",
        entityId: archiveFileName,
        action: "backup.restored",
        actor,
        severity: "CRITICAL",
        details: {
          archive: archiveFileName,
          archiveCreatedAt: manifestCreatedAt,
          safetyBackup: safetyBackupFileName,
          appVersion: deps.appVersion,
          source,
        },
      }),
    );
  } catch (err) {
    console.error("[backup] could not record the restore in the audit trail", err);
  } finally {
    sqlite?.close();
  }
}

/**
 * Records a change to where the second-copy backups land (audit S-3's
 * twin for the second target). This is exactly the change an auditor needs
 * to see: it decides which machine or share a copy of the books is written
 * to next, unlike the console.log the two channels below used to settle for.
 *
 * Written against the LIVE connection (unlike `recordRestoredEvent`, nothing
 * here swaps the database file) and never fails the request it follows — a
 * shop owner picking a USB drive must not be blocked by an audit-trail glitch.
 */
async function recordSecondTargetEvent(
  deps: RestoreIpcDeps,
  actor: string,
  action: "backup.secondTarget.set" | "backup.secondTarget.cleared",
  dir: string | null,
): Promise<void> {
  const sqlite = deps.sqlite();
  if (!sqlite) return;
  try {
    const sink = createSqliteAuditSink(sqlite, deps.cipher ? { chainKey: deriveAuditChainKey(deps.cipher.key) } : {});
    await sink.append(
      createAuditEvent({
        stream: "security",
        module: "backup",
        entityType: "BACKUP_SECOND_TARGET",
        entityId: null,
        action,
        actor,
        severity: "WARNING",
        details: { dir },
      }),
    );
  } catch (err) {
    console.error("[backup] could not record the second-target change in the audit trail", err);
  }
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
async function authorize(
  deps: RestoreIpcDeps,
  token: unknown,
  permission: string,
): Promise<BackupFailure | null> {
  if (typeof token !== "string" || token === "") return UNAUTHORIZED;
  const grant = await deps.sessions.find(token);
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
async function authorizeOrFirstRun(
  deps: RestoreIpcDeps,
  token: unknown,
): Promise<{ denied: BackupFailure | null; actor: string }> {
  if (typeof token === "string" && token !== "") {
    const denied = await authorize(deps, token, RESTORE_PERMISSION);
    return { denied, actor: denied ? "unknown" : await actorOf(deps, token) };
  }
  const claimed = deps.tenantIsClaimed ? await deps.tenantIsClaimed().catch(() => true) : true;
  return claimed ? { denied: UNAUTHORIZED, actor: "unknown" } : { denied: null, actor: "first-run" };
}

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
  handleGuarded(
    MEZAN_BACKUP_LIST_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupListResult | BackupFailure> => {
      const denied = await authorize(deps, sessionToken, VIEW_PERMISSION);
      if (denied) return denied;

      const found = await listBackups(deps.backupsDir);
      found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const entries = await Promise.all(found.map((b) => describeArchive(b.path, b.createdAt)));
      return { backupsDir: deps.backupsDir, entries, archivesEncrypted: deps.cipher !== undefined };
    },
  );

  handleGuarded(
    MEZAN_BACKUP_CREATE_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupCreateResult> => {
      const denied = await authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;

      const sqlite = deps.sqlite();
      if (!sqlite) {
        return failure(
          "UNAVAILABLE",
          "لا توجد قاعدة بيانات على القرص في هذه النسخة التطويرية، فلا يمكن أخذ نسخة احتياطية.",
        );
      }

      try {
        const result = await withBackupLock(() =>
          createBackup({
            sqlite,
            backupsDir: deps.backupsDir,
            appVersion: deps.appVersion,
            reason: BackupReason.Manual,
            encrypted: deps.cipher !== undefined,
            cipher: deps.cipher ? { key: deps.cipher.key } : undefined,
          }),
        );
        await copyToSecondTarget(deps.backupsDir, result.archivePath);
        return { ok: true, entry: await describeArchive(result.archivePath, new Date()) };
      } catch (err) {
        console.error("[backup] manual backup failed", err);
        return failure("FAILED", "تعذّر إنشاء النسخة الاحتياطية. تأكد من وجود مساحة كافية على القرص.");
      }
    },
  );

  handleGuarded(
    MEZAN_BACKUP_RESTORE_CHANNEL,
    async (_event, sessionToken: unknown, fileName: unknown): Promise<BackupRestoreResult> => {
      const denied = await authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;

      const archivePath = resolveArchivePath(deps.backupsDir, fileName);
      if (!archivePath) {
        return failure("INVALID_NAME", "اسم ملف النسخة الاحتياطية غير صالح.");
      }
      if (!(await stat(archivePath).catch(() => null))) {
        return failure("NOT_FOUND", "ملف النسخة الاحتياطية غير موجود. حدّث القائمة وحاول مرة أخرى.");
      }
      return performRestore(deps, archivePath, await actorOf(deps, sessionToken), RestoreSource.Archive);
    },
  );

  /**
   * «الرجوع إلى ما قبل التحديث» — the same verified restore, pointed at the
   * archive this build took before it moved the schema.
   *
   * The archive existed and nothing surfaced it: the only route back was for an
   * owner to recognise a timestamp. The path is deliberately IDENTICAL to the
   * manual restore below — safety copy first, verify, atomic rename, relaunch —
   * so there is one restore in this product, not two.
   */
  handleGuarded(
    MEZAN_BACKUP_REVERT_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupRestoreResult> => {
      const denied = await authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;

      const candidates = (await listBackups(deps.backupsDir)).filter((entry) =>
        isPreUpdateArchive(path.basename(entry.path)),
      );
      candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const newest = candidates[0];
      if (!newest) {
        return failure(
          "NOT_FOUND",
          "لا توجد نسخة محفوظة قبل التحديث على هذا الجهاز. تُؤخذ هذه النسخة تلقائياً عند أول تشغيل بعد تحديث يغيّر قاعدة البيانات.",
        );
      }
      return performRestore(deps, newest.path, await actorOf(deps, sessionToken), RestoreSource.PreUpdate);
    },
  );

  /**
   * «تصدير نسخة قابلة للنقل», and it is the only route to a non-machine-keyed
   * archive in the product.
   */
  handleGuarded(
    MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
    async (_event, sessionToken: unknown, passphrase: unknown): Promise<BackupExportResult> => {
      const denied = await authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;

      if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
        return failure(
          "INVALID_NAME",
          `اكتب كلمة سر لا تقل عن ${MIN_PASSPHRASE_LENGTH} حروف. هذه الكلمة هي الشيء الوحيد الذي يحمي النسخة المنقولة، ولا يمكن استرجاعها إذا نُسيت.`,
        );
      }

      const sqlite = deps.sqlite();
      if (!sqlite) {
        return failure(
          "UNAVAILABLE",
          "لا توجد قاعدة بيانات على القرص في هذه النسخة التطويرية، فلا يمكن تصدير نسخة قابلة للنقل.",
        );
      }

      try {
        const exported = await exportPortableBackup({
          sqlite,
          backupsDir: deps.backupsDir,
          appVersion: deps.appVersion,
          passphrase,
          encrypted: deps.cipher !== undefined,
          ...(deps.portable ? { portable: deps.portable } : {}),
        });
        return { ok: true, filePath: exported.filePath };
      } catch (err) {
        if (err instanceof WeakPassphraseError) {
          return failure(
            "INVALID_NAME",
            `اكتب كلمة سر لا تقل عن ${MIN_PASSPHRASE_LENGTH} حروف.`,
          );
        }
        console.error("[backup] portable export failed", err);
        return failure(
          "FAILED",
          "تعذّر تصدير نسخة قابلة للنقل. تأكد من وجود مساحة كافية على القرص.",
        );
      }
    },
  );

  handleGuarded(
    MEZAN_BACKUP_DRILL_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupDrillResult> => {
      const denied = await authorize(deps, sessionToken, VIEW_PERMISSION);
      if (denied) return denied;
      try {
        const drill = await runRestoreDrill({
          backupsDir: deps.backupsDir,
          cipherKey: deps.cipher?.key ?? null,
          appSchemaVersion: CURRENT_SCHEMA_VERSION,
          trigger: DrillTrigger.Manual,
        });
        return { ok: true, drill };
      } catch (err) {
        console.error("[backup] restore drill could not run", err);
        return failure("FAILED", "تعذّر تشغيل اختبار الاستعادة. تأكد من وجود مساحة كافية على القرص.");
      }
    },
  );

  handleGuarded(
    MEZAN_BACKUP_STATUS_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupStatusResult | BackupFailure> => {
      const denied = await authorize(deps, sessionToken, VIEW_PERMISSION);
      if (denied) return denied;
      const drills = await readDrillHistory(deps.backupsDir);
      return {
        ok: true,
        drills,
        lastGoodDrillAt: lastGoodDrill(drills)?.startedAt ?? null,
        staleAfterDays: DRILL_STALE_AFTER_DAYS,
        drillRunning: isDrillRunning(),
        secondTarget: secondTargetDto(await readSecondTarget(deps.backupsDir)),
        lastBackupAt: newestBackupAt(await listBackups(deps.backupsDir)),
        diskFreeBytes: await freeDiskBytes(deps.backupsDir),
      };
    },
  );

  handleGuarded(
    MEZAN_BACKUP_SECOND_TARGET_CHOOSE_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupSecondTargetResult> => {
      const denied = await authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;
      let chosen: string | undefined;
      try {
        const picked = await dialog.showOpenDialog({
          title: "اختر مجلداً ثانياً للنسخ الاحتياطية",
          properties: ["openDirectory", "createDirectory"],
        });
        if (picked.canceled) return failure("CANCELLED", "لم يتم اختيار أي مجلد.");
        chosen = picked.filePaths[0];
      } catch (err) {
        console.error("[backup] the folder picker could not be opened", err);
        return failure("FAILED", "تعذّر فتح نافذة اختيار المجلد.");
      }
      if (!chosen) return failure("CANCELLED", "لم يتم اختيار أي مجلد.");
      try {
        await setSecondTargetDir(deps.backupsDir, chosen);
      } catch {
        return failure("INVALID_NAME", "لا يمكن أن يكون المجلد الثاني هو مجلد النسخ نفسه. اختر فلاشة أو مجلداً على جهاز آخر.");
      }
      console.log(`[backup] second backup target set to ${chosen}`);
      await recordSecondTargetEvent(deps, await actorOf(deps, sessionToken), "backup.secondTarget.set", chosen);
      const newest = (await listBackups(deps.backupsDir)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const state = newest
        ? await withBackupLock(() => copyToSecondTarget(deps.backupsDir, newest.path))
        : await readSecondTarget(deps.backupsDir);
      return { ok: true, secondTarget: secondTargetDto(state) };
    },
  );

  handleGuarded(
    MEZAN_BACKUP_SECOND_TARGET_CLEAR_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupSecondTargetResult> => {
      const denied = await authorize(deps, sessionToken, RESTORE_PERMISSION);
      if (denied) return denied;
      console.log("[backup] second backup target cleared");
      const state = await setSecondTargetDir(deps.backupsDir, null);
      await recordSecondTargetEvent(deps, await actorOf(deps, sessionToken), "backup.secondTarget.cleared", null);
      return { ok: true, secondTarget: secondTargetDto(state) };
    },
  );

  handleGuarded(
    MEZAN_BACKUP_PICK_PORTABLE_CHANNEL,
    async (_event, sessionToken: unknown): Promise<BackupPickPortableResult> => {
      const { denied } = await authorizeOrFirstRun(deps, sessionToken);
      if (denied) return denied;
      let chosen: string | undefined;
      try {
        const picked = await dialog.showOpenDialog({
          title: "اختر ملف النسخة القابلة للنقل",
          properties: ["openFile"],
          filters: [{ name: "Mezan portable backup", extensions: ["enc"] }],
        });
        if (picked.canceled) return failure("CANCELLED", "لم يتم اختيار أي ملف.");
        chosen = picked.filePaths[0];
      } catch (err) {
        console.error("[backup] the file picker could not be opened", err);
        return failure("FAILED", "تعذّر فتح نافذة اختيار الملف.");
      }
      if (!chosen) return failure("CANCELLED", "لم يتم اختيار أي ملف.");
      if (!chosen.endsWith(PORTABLE_FILE_EXTENSION)) {
        return failure("INVALID_NAME", `هذا ليس ملف نسخة قابلة للنقل من ميزان (${PORTABLE_FILE_EXTENSION}).`);
      }
      const size = await stat(chosen).then((s) => s.size).catch(() => null);
      if (size === null) return failure("NOT_FOUND", "تعذّرت قراءة الملف المختار.");
      return { ok: true, pickId: rememberPick(chosen), fileName: path.basename(chosen), sizeBytes: size };
    },
  );

  /**
   * The only route by which a portable archive becomes the books again — and so
   * the only answer to a dead machine whose key card was never kept (ROADMAP
   * §5.2). Decrypt and verify BEFORE anything live is touched: a wrong
   * passphrase or a damaged file must leave the running install exactly as it
   * was, not closed and relaunching.
   */
  handleGuarded(
    MEZAN_BACKUP_IMPORT_PORTABLE_CHANNEL,
    async (_event, sessionToken: unknown, pickId: unknown, passphrase: unknown): Promise<BackupRestoreResult> => {
      const { denied, actor } = await authorizeOrFirstRun(deps, sessionToken);
      if (denied) return denied;
      const pick = typeof pickId === "string" ? picks.get(pickId) : undefined;
      if (!pick || Date.now() - pick.at > PICK_TTL_MS) {
        return failure("NOT_FOUND", "اختر ملف النسخة مرة أخرى.");
      }
      if (typeof passphrase !== "string" || passphrase === "") {
        return failure("WRONG_PASSPHRASE", "اكتب كلمة سر النسخة المنقولة.");
      }

      const tmpRoot = path.join(deps.backupsDir, ".tmp");
      await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
      const importDir = await mkdtemp(path.join(tmpRoot, "import-"));
      const decrypted = path.join(importDir, `portable-import${BACKUP_FILE_EXTENSION}`);
      try {
        try {
          await decryptFile(pick.path, decrypted, passphrase);
        } catch (err) {
          if (err instanceof Error && err.message === "Not a Mezan portable archive.") {
            return failure("INVALID_NAME", "هذا الملف ليس نسخة قابلة للنقل من ميزان، أو أنه تالف.");
          }
          return failure(
            "WRONG_PASSPHRASE",
            "كلمة السر غير صحيحة، أو أن الملف تالف. لم يتغيّر شيء في بياناتك.",
          );
        }
        try {
          await verifyArchive({
            archivePath: decrypted,
            workDir: importDir,
            cipher: deps.cipher,
            maxSchemaVersion: CURRENT_SCHEMA_VERSION,
          });
        } catch (err) {
          console.error("[backup] portable archive failed verification", err);
          if (err instanceof SchemaTooNewForRestoreError) {
            return failure(
              "VERIFICATION_FAILED",
              "هذه النسخة أُخذت بإصدار أحدث من ميزان. حدّث البرنامج على هذا الجهاز أولاً ثم أعد الاستيراد. لم يتغيّر شيء في بياناتك.",
            );
          }
          return failure(
            "VERIFICATION_FAILED",
            "فُكّ تشفير الملف لكن قاعدة البيانات بداخله لم تجتز التحقق. لم يتغيّر شيء في بياناتك.",
          );
        }
        picks.delete(pickId as string);
        console.log(`[backup] importing portable archive ${pick.fileName}`);
        return await performRestore(deps, decrypted, actor, RestoreSource.Portable, pick.fileName);
      } finally {
        await rm(importDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );
}

/**
 * ONE restore, used by both the manual pick and the revert-to-pre-update
 * button. The archive path has already been proven to be inside the backups
 * directory by the caller.
 */
async function performRestore(
  deps: RestoreIpcDeps,
  archivePath: string,
  actor: string,
  source: RestoreSource,
  archiveLabel: string = path.basename(archivePath),
): Promise<BackupRestoreResult> {
  if (source === RestoreSource.Portable) {
    return performVerifiedRestore(deps, archivePath, actor, source, archiveLabel);
  }
  // The safety backup below prunes the backups folder by GFS retention, which
  // can delete the very archive being restored when several share its day.
  const tmpRoot = path.join(deps.backupsDir, ".tmp");
  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const holdDir = await mkdtemp(path.join(tmpRoot, "restore-"));
  const held = path.join(holdDir, path.basename(archivePath));
  try {
    try {
      await copyFile(archivePath, held);
    } catch (err) {
      console.error("[backup] could not stage the archive for restore", err);
      return failure("FAILED", "تعذّر تجهيز ملف النسخة للاستعادة. تأكد من وجود مساحة كافية على القرص.");
    }
    return await performVerifiedRestore(deps, held, actor, source, archiveLabel);
  } finally {
    await rm(holdDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function performVerifiedRestore(
  deps: RestoreIpcDeps,
  archivePath: string,
  actor: string,
  source: RestoreSource,
  archiveLabel: string,
): Promise<BackupRestoreResult> {
  // The safety copy comes FIRST, and from the live connection, because after
  // the next few lines there is no live connection to take one from.
  // Without it, restoring the wrong file — which is exactly what a worried
  // owner does at 9pm with the shop shut — is irreversible.
  let safetyBackupFileName: string | null = null;
  const sqlite = deps.sqlite();
  if (sqlite) {
    try {
      const safety = await withBackupLock(() =>
        createBackup({
          sqlite,
          backupsDir: deps.backupsDir,
          appVersion: deps.appVersion,
          reason: BackupReason.PreRestore,
          encrypted: deps.cipher !== undefined,
          cipher: deps.cipher ? { key: deps.cipher.key } : undefined,
        }),
      );
      safetyBackupFileName = path.basename(safety.archivePath);
    } catch (err) {
      console.error("[backup] safety backup before restore failed", err);
      return failure(
        "FAILED",
        "تعذّر أخذ نسخة احتياطية من بياناتك الحالية قبل الاستعادة، ولم تتم الاستعادة.",
      );
    }
  }

  const restoredFrom = { ...(await describeArchive(archivePath, new Date())), fileName: archiveLabel };
  await deps.closeLiveConnections();

  try {
    const restored = await restoreBackup({
      archivePath,
      targetDbPath: deps.dbPath,
      workDir: path.dirname(deps.dbPath),
      cipher: deps.cipher,
      maxSchemaVersion: CURRENT_SCHEMA_VERSION,
    });
    if (source === RestoreSource.Portable && deps.cipher) {
      // A portable archive is plaintext once decrypted. Re-keyed here, before
      // relaunch, so the next launch's conversion never writes its plaintext
      // safety copy of the books into the backups folder.
      await encryptPlaintextDatabase({ dbPath: deps.dbPath, key: deps.cipher.key, driver: deps.cipher.driver }).catch(
        (err: unknown) => console.error("[backup] could not re-key the imported database; the next launch converts it", err),
      );
    }
    console.log(
      `[backup] restored ${archiveLabel} ` +
        `(taken ${restored.manifest.createdAt} by app ${restored.manifest.appVersion})`,
    );
    // REQUIRED ORDERING: after the swap, into the database that just landed.
    // The trail this row belongs to is the one the archive brought with it;
    // written a moment earlier it would have been overwritten by the restore
    // it records.
    await recordRestoredEvent(
      deps,
      actor,
      archiveLabel,
      restored.manifest.createdAt,
      safetyBackupFileName,
      source,
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
    if (err instanceof SchemaTooNewForRestoreError) {
      return failure(
        "VERIFICATION_FAILED",
        "هذه النسخة أُخذت بإصدار أحدث من ميزان، ولا يستطيع هذا الإصدار فتحها. حدّث البرنامج ثم أعد المحاولة. لم تتغيّر بياناتك.",
      );
    }
    if (err instanceof BackupKeyMismatchError) {
      return failure(
        "VERIFICATION_FAILED",
        "هذه النسخة الاحتياطية مشفّرة بمفتاح جهاز آخر، ولا يمكن فتحها هنا. استخدم مفتاح التشفير الخاص بالجهاز الذي أخذها. لم تتغيّر بياناتك.",
      );
    }
    if (err instanceof ArchiveDamagedError) {
      return failure("VERIFICATION_FAILED", `${err.message} سيُعاد تشغيل البرنامج الآن.`);
    }
    return failure(
      "VERIFICATION_FAILED",
      "فشل التحقق من ملف النسخة الاحتياطية، ولم تتغيّر بياناتك. سيُعاد تشغيل البرنامج الآن.",
    );
  }
}

/**
 * The backup channels on a CLIENT machine, answering honestly instead of not
 * existing at all.
 *
 * A client holds no database, so it has nothing to back up and nothing to
 * restore into. But an `ipcMain.handle` channel that was never registered does
 * NOT degrade to "no data": it rejects, and the renderer shows
 * `Error invoking remote method 'mezan:backup:list': No handler registered` —
 * an English Electron internal, on a settings screen, in an Arabic product.
 * That exact failure appeared above the shell on the first live client run
 * (see `registerClientLicenceStatusOverIpc`), which is why every channel the
 * preload bridge exposes now has an answer in BOTH roles.
 *
 * The message names the host, because the person at this machine is not being
 * told "no" — they are being told which machine to walk to.
 */
export function registerClientBackupRefusalsOverIpc(hostUrl: string): void {
  const refusal: BackupFailure = {
    ok: false,
    code: "UNAVAILABLE",
    message: `النسخ الاحتياطي يُدار من الجهاز الرئيسي (${hostUrl}). هذا الجهاز محطة متصلة ولا يحتفظ بقاعدة بيانات خاصة به.`,
  };
  handleGuarded(MEZAN_BACKUP_LIST_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_CREATE_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_RESTORE_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_REVERT_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_DRILL_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_STATUS_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_PICK_PORTABLE_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_IMPORT_PORTABLE_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_SECOND_TARGET_CHOOSE_CHANNEL, () => refusal);
  handleGuarded(MEZAN_BACKUP_SECOND_TARGET_CLEAR_CHANNEL, () => refusal);
}
