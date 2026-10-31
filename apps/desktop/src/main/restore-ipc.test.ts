import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionGrant } from "@mezan/api";
import type { SessionLookup } from "./backend-bridge.js";
import { createBackup } from "../backup/index.js";
import {
  cipherDriver,
  openTenantConnection,
  type TenantCipher,
} from "./encrypted-database.js";
import {
  MEZAN_BACKUP_CREATE_CHANNEL,
  MEZAN_BACKUP_LIST_CHANNEL,
  MEZAN_BACKUP_RESTORE_CHANNEL,
  MEZAN_BACKUP_REVERT_CHANNEL,
  MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_RECOVERY_SET_CHANNEL,
  RecoveryMode,
  type BackupRecoveryResult,
  type BackupCreateResult,
  type BackupExportResult,
  type BackupEntryDTO,
  type BackupFailure,
  type BackupListResult,
  type BackupRestoreResult,
} from "../shared/ipc-contract.js";
import { BackupReason } from "../backup/manifest.js";

/**
 * `backup/restore-service.ts` implemented a fully verified restore and was
 * called from nothing — no IPC, no menu, no screen — so the product shipped
 * backups nobody could put back. These channels are its only caller, which
 * makes them the only place the restore's preconditions can be got wrong: the
 * name comes from the renderer, and the connections have to be shut before the
 * file underneath them is replaced.
 */

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

/**
 * A stand-in for the Electron invoke event, carrying the renderer frame the
 * `guarded` wrapper (main/ipc-guard.ts, audit S-5) checks. `null` used to do —
 * it no longer does, because a channel that answers a frame it cannot identify
 * is the finding.
 */
const RENDERER_EVENT = { senderFrame: { url: "app://mezan/index.html" } } as never;

/**
 * guards Q-1 — ASYNC ON PURPOSE. The session registry lives in the backend
 * process now (main/backend-process.ts), so every one of these channels reads
 * the caller's grant across a MessagePort. A refusal that only holds while the
 * lookup is synchronous is not a refusal.
 */
function fakeSessions(grant: SessionGrant | null): SessionLookup {
  return { find: async (token: string) => (token === "good-token" ? grant : null) };
}

const ADMIN: SessionGrant = {
  userId: "USER-ADMIN",
  permissions: ["*"],
  roleCode: null,
  branchScope: "*",
  warehouseScope: "*",
};

const CLERK: SessionGrant = {
  userId: "USER-CLERK",
  permissions: ["sales.invoice.create", "admin.settings.view"],
  roleCode: "CLERK",
  branchScope: "*",
  warehouseScope: "*",
};

let dir: string;
let dbPath: string;
let backupsDir: string;
let live: Database.Database;
let closed: number;
let relaunched: number;

async function register(grant: SessionGrant | null, cipher?: TenantCipher): Promise<void> {
  handlers.clear();
  const { registerRestoreOverIpc } = await import("./restore-ipc.js");
  registerRestoreOverIpc({
    dbPath,
    backupsDir,
    appVersion: "9.9.9",
    sqlite: () => live,
    cipher,
    closeLiveConnections: () => {
      closed += 1;
      live.close();
    },
    relaunch: () => {
      relaunched += 1;
    },
    sessions: fakeSessions(grant),
  });
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return handlers.get(channel)!(RENDERER_EVENT, ...args) as Promise<T>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  dir = mkdtempSync(path.join(tmpdir(), "mezan-restore-ipc-"));
  dbPath = path.join(dir, "mezan.db");
  backupsDir = path.join(dir, "backups");
  closed = 0;
  relaunched = 0;

  live = new Database(dbPath);
  live.exec("CREATE TABLE invoice (id TEXT PRIMARY KEY, memo TEXT NOT NULL)");
  live.prepare("INSERT INTO invoice VALUES (?, ?)").run("INV-1", "فاتورة أولى");
});

afterEach(() => {
  vi.useRealTimers();
  try {
    live.close();
  } catch {
    // Already closed by a restore under test.
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("who may drive a restore", () => {
  it("refuses every channel without a session the SERVER minted", async () => {
    await register(ADMIN);
    for (const token of [undefined, "", 42, "not-a-real-token"]) {
      expect((await call<BackupFailure>(MEZAN_BACKUP_LIST_CHANNEL, token)).code).toBe("UNAUTHORIZED");
      expect((await call<BackupFailure>(MEZAN_BACKUP_CREATE_CHANNEL, token)).code).toBe("UNAUTHORIZED");
      expect(
        (await call<BackupFailure>(MEZAN_BACKUP_RESTORE_CHANNEL, token, "anything.mezanbak")).code,
      ).toBe("UNAUTHORIZED");
    }
    // Nothing was closed and nothing relaunched on the way to those refusals.
    expect(closed).toBe(0);
    expect(relaunched).toBe(0);
  });

  it("refuses a real session that does not hold the settings grant", async () => {
    await register(CLERK);
    const denied = await call<BackupFailure>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(denied.code).toBe("UNAUTHORIZED");
    // Arabic, ready to render — the screen must never show the code.
    expect(denied.message).toContain("صلاحية");
  });
});

describe("what a file name may be", () => {
  it("refuses anything that is not one of our own names in our own folder", async () => {
    await register(ADMIN);
    for (const name of [
      "../../../etc/passwd",
      "/etc/passwd",
      "..\\..\\windows\\system32\\config\\sam",
      "mezan.db",
      "notes.txt",
      "",
      42,
    ]) {
      const res = await call<BackupFailure>(MEZAN_BACKUP_RESTORE_CHANNEL, "good-token", name);
      expect([name, res.code]).toEqual([name, "INVALID_NAME"]);
    }
    expect(closed).toBe(0);
  });

  it("reports a missing archive rather than closing the database to find out", async () => {
    await register(ADMIN);
    const res = await call<BackupFailure>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      "mezan-backup-2020-01-01T00-00-00-000Z.mezanbak",
    );
    expect(res.code).toBe("NOT_FOUND");
    expect(closed).toBe(0);
  });
});

describe("list and create", () => {
  it("lists archives newest first, with what the manifest says is inside them", async () => {
    await register(ADMIN);
    await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: BackupReason.Manual,
      now: new Date("2026-08-01T10:00:00.000Z"),
    });
    await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: BackupReason.Scheduled,
      now: new Date("2026-08-20T10:00:00.000Z"),
    });

    const listed = await call<BackupListResult>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(listed.backupsDir).toBe(backupsDir);
    expect(listed.entries).toHaveLength(2);
    expect(listed.entries[0]!.createdAt).toBe("2026-08-20T10:00:00.000Z");
    expect(listed.entries[0]!.reason).toBe("scheduled");
    expect(listed.archivesEncrypted).toBe(false);
    expect(listed.entries[0]!.appVersion).toBe("9.9.9");
    expect(listed.entries[0]!.readable).toBe(true);
    expect(listed.entries[0]!.tables).toMatchObject({ invoice: 1 });
    expect(listed.entries[0]!.sizeBytes).toBeGreaterThan(0);
    // The name is what restore takes back — a bare file name, never a path.
    expect(listed.entries[0]!.fileName).toBe(path.basename(listed.entries[0]!.fileName));
  });

  it("still lists a damaged archive, marked unreadable, instead of hiding it", async () => {
    // A shop owner hunting for last Tuesday's file needs to see that it is
    // there and broken. A list that quietly drops it says the backup was never
    // taken, which is a different and much worse thing to believe.
    await register(ADMIN);
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(backupsDir, { recursive: true });
    const broken = path.join(backupsDir, "mezan-backup-2026-08-05T10-00-00-000Z.mezanbak");
    await writeFile(broken, "this is not a tar archive");

    const listed = await call<BackupListResult>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]!.readable).toBe(false);
    expect(listed.entries[0]!.appVersion).toBeNull();
    // Falls back to the timestamp encoded in the name, so the row still sorts.
    expect(listed.entries[0]!.createdAt).toBe("2026-08-05T10:00:00.000Z");
  });

  it("takes a backup on demand and describes the file it wrote", async () => {
    await register(ADMIN);
    const created = await call<BackupCreateResult>(MEZAN_BACKUP_CREATE_CHANNEL, "good-token");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.entry.reason).toBe("manual");
    expect(created.entry.tables).toMatchObject({ invoice: 1 });
    await expect(readFile(path.join(backupsDir, created.entry.fileName))).resolves.toBeDefined();
  });
});

describe("the restore itself", () => {
  it("takes a safety copy, closes the live database, replaces it, and relaunches", async () => {
    await register(ADMIN);

    const snapshot = await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: BackupReason.Manual,
    });
    const archiveName = path.basename(snapshot.archivePath);

    // Move the live database on from the state that was captured, so a restore
    // that quietly did nothing would still show this row afterwards.
    live.prepare("INSERT INTO invoice VALUES (?, ?)").run("INV-2", "فاتورة بعد النسخة");
    expect(live.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 2 });

    const res = await call<BackupRestoreResult>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      archiveName,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restoredFrom.fileName).toBe(archiveName);
    // The safety copy is the only thing standing between "restored the wrong
    // file" and an irreversible loss, and it can only be taken while the live
    // connection is still open — so it has to come first.
    expect(res.safetyBackupFileName).not.toBeNull();
    expect(closed).toBe(1);

    const reopened = new Database(dbPath, { readonly: true });
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 1 });
    reopened.close();

    // Scheduled, not immediate: `app.exit()` would kill the process before this
    // very reply reached the renderer.
    expect(relaunched).toBe(0);
    vi.runAllTimers();
    expect(relaunched).toBe(1);
  });

  it("leaves the data untouched when the archive fails verification, and comes back up", async () => {
    await register(ADMIN);
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(backupsDir, { recursive: true });
    const corrupt = "mezan-backup-2026-08-10T10-00-00-000Z.mezanbak";
    await writeFile(path.join(backupsDir, corrupt), "not an archive at all");

    const res = await call<BackupRestoreResult>(MEZAN_BACKUP_RESTORE_CHANNEL, "good-token", corrupt);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VERIFICATION_FAILED");
    expect(res.message).toContain("لم تتغيّر بياناتك");

    // Every check in restore-service.ts runs before the atomic rename, so the
    // original file is intact — but its connections are shut, which is why the
    // app relaunches rather than sitting there unable to serve anything.
    const reopened = new Database(dbPath, { readonly: true });
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 1 });
    reopened.close();
    vi.runAllTimers();
    expect(relaunched).toBe(1);
  });

  it("lets the weaker grant read the list, and only the stronger one replace the books", async () => {
    // `admin.backup.view` was declared and never consulted — every channel,
    // listing included, checked `admin.backup.restore` — so the weaker grant
    // was dead, and seeing whether last night's backup ran required the
    // permission that OVERWRITES the company's data.
    await register({
      userId: "USER-VIEWER",
      permissions: ["admin.backup.view"],
      roleCode: "VIEWER",
      branchScope: "*",
      warehouseScope: "*",
    });

    const listed = await call<{ ok?: false }>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(listed.ok).not.toBe(false);

    const restored = await call<{ ok: boolean; code?: string }>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      "anything.mezanbak",
    );
    expect(restored).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});

/**
 * The channels are the only caller of `createBackup`/`restoreBackup` in the
 * product, so they are the only place the encryption can be dropped on the
 * floor: a manual backup taken through an unkeyed call, or a restore that
 * integrity-checks an encrypted archive with the plain driver, would each undo
 * the at-rest guarantee from a screen the owner thinks is routine.
 */
describe("an encrypted install", () => {
  const KEY = "c".repeat(64);
  const cipher: TenantCipher = { driver: cipherDriver, key: KEY };
  const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

  async function encryptedLive(key: TenantCipher = cipher): Promise<void> {
    live.close();
    rmSync(dbPath, { force: true });
    live = openTenantConnection(dbPath, key);
    live.exec("CREATE TABLE invoice (id TEXT PRIMARY KEY, memo TEXT NOT NULL)");
    live.prepare("INSERT INTO invoice VALUES (?, ?)").run("INV-1", "فاتورة أولى");
    await register(ADMIN, key);
  }

  it("tells the screen its archives are encrypted, which only a keyed install may claim", async () => {
    await encryptedLive();
    expect((await call<BackupListResult>(MEZAN_BACKUP_LIST_CHANNEL, "good-token")).archivesEncrypted).toBe(true);
  });

  it("writes an archive nobody can read off a USB stick", async () => {
    await encryptedLive();
    const created = await call<{ ok: true; entry: BackupEntryDTO }>(
      MEZAN_BACKUP_CREATE_CHANNEL,
      "good-token",
    );
    expect(created.ok).toBe(true);

    const extractDir = path.join(dir, "peek");
    const { extractArchive } = await import("../backup/archive.js");
    const extracted = await extractArchive(
      path.join(backupsDir, created.entry.fileName),
      extractDir,
    );
    const head = (await readFile(extracted.dbFilePath)).subarray(0, SQLITE_HEADER.length);
    expect(head.equals(SQLITE_HEADER)).toBe(false);
    expect(created.entry.tables).toEqual({ invoice: 1 });
  });

  it("restores its own archive end to end", async () => {
    await encryptedLive();
    const created = await call<{ ok: true; entry: BackupEntryDTO }>(
      MEZAN_BACKUP_CREATE_CHANNEL,
      "good-token",
    );
    live.prepare("INSERT INTO invoice VALUES (?, ?)").run("INV-2", "بعد النسخة");

    const restored = await call<BackupRestoreResult>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      created.entry.fileName,
    );
    expect(restored.ok).toBe(true);
    expect(closed).toBe(1);
    vi.runAllTimers();
    expect(relaunched).toBe(1);

    const reopened = openTenantConnection(dbPath, cipher);
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 1 });
    reopened.close();
  });

  it("tells the owner an archive from other hardware needs that machine's key", async () => {
    await encryptedLive();
    const created = await call<{ ok: true; entry: BackupEntryDTO }>(
      MEZAN_BACKUP_CREATE_CHANNEL,
      "good-token",
    );

    // Different hardware: THIS machine's books are keyed with its own key and
    // are perfectly readable — it is the imported archive that is not. Only
    // re-keying the live database too makes the install self-consistent;
    // swapping the registered key alone leaves the shell holding a connection
    // it can no longer read, and the pre-restore safety copy fails first, on
    // an unrelated error.
    await encryptedLive({ driver: cipherDriver, key: "d".repeat(64) });
    const failed = await call<BackupFailure>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      created.entry.fileName,
    );
    expect(failed.ok).toBe(false);
    expect(failed.code).toBe("VERIFICATION_FAILED");
    // Not "your backup is corrupt": it is intact and it needs a key.
    expect(failed.message).toContain("مفتاح");
    expect(failed.message).toContain("لم تتغيّر بياناتك");
  });
});

/**
 * GUARDS U-9. The pre-update archive was already being written and had no route
 * back: the only way to use it was for an owner to recognise which timestamp in
 * a list came before the version that broke their books.
 */
describe("revert to the copy taken before the update", () => {
  it("restores the newest pre-update archive through the same verified path", async () => {
    await register(ADMIN);
    // An ordinary scheduled archive, and a pre-update one taken after it.
    await createBackup({ sqlite: live, backupsDir, appVersion: "9.9.8", reason: BackupReason.Scheduled });
    await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: BackupReason.PreUpdate,
      label: "pre-update-9.9.9",
    });

    const result = await call<BackupRestoreResult>(MEZAN_BACKUP_REVERT_CHANNEL, "good-token");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.restoredFrom.fileName).toContain("pre-update-9.9.9");
      // The same safety copy the manual restore takes: reverting is still
      // replacing the books.
      expect(result.safetyBackupFileName).not.toBeNull();
    }
    expect(closed).toBe(1);
  });

  it("says in Arabic that there is none, rather than restoring some other archive", async () => {
    await register(ADMIN);
    await createBackup({ sqlite: live, backupsDir, appVersion: "9.9.8", reason: BackupReason.Scheduled });

    const result = await call<BackupRestoreResult>(MEZAN_BACKUP_REVERT_CHANNEL, "good-token");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_FOUND");
      expect(result.message).toContain("قبل التحديث");
    }
    expect(closed).toBe(0);
  });

  it("needs the restore grant, not merely the view one", async () => {
    await register(CLERK);
    expect((await call<BackupFailure>(MEZAN_BACKUP_REVERT_CHANNEL, "good-token")).code).toBe(
      "UNAUTHORIZED",
    );
  });
});

/**
 * GUARDS N-11. `portable` used to be passed on every scheduled backup, so each
 * daily archive was rekeyed to plaintext in a folder people copy to a USB
 * stick. It is now one deliberate action, and the file that leaves is encrypted
 * under a passphrase the operator chose.
 */
describe("exporting a portable copy", () => {
  it("refuses a passphrase too short to protect the whole books", async () => {
    await register(ADMIN);
    const result = await call<BackupExportResult>(
      MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
      "good-token",
      "1234",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("كلمة سر");
  });

  it("refuses a caller without the restore grant", async () => {
    await register(CLERK);
    const result = await call<BackupExportResult>(
      MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
      "good-token",
      "kalimat-sirr-2026",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
  });

  it("writes one encrypted file and leaves no readable archive behind", async () => {
    await register(ADMIN);
    const result = await call<BackupExportResult>(
      MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
      "good-token",
      "kalimat-sirr-2026",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { readdirSync } = await import("node:fs");
    const written = readdirSync(backupsDir);
    expect(written).toEqual([path.basename(result.filePath)]);
    expect(written[0]).toMatch(/\.mezanbak\.enc$/);
  });
});

/**
 * guards S-3 — "a restore replaces the trail wholesale and writes no audit
 * event". The whole difficulty is ordering: an event written before the swap is
 * destroyed by the swap it records.
 */
describe("a restore is recorded in the trail it lands in", () => {
  it("writes a CRITICAL backup.restored row into the RESTORED database", async () => {
    await register(ADMIN);

    const snapshot = await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: BackupReason.Manual,
    });
    const archiveName = path.basename(snapshot.archivePath);

    const res = await call<BackupRestoreResult>(MEZAN_BACKUP_RESTORE_CHANNEL, "good-token", archiveName);
    expect(res.ok).toBe(true);

    // Read the file that is now on disk — the archive's own database, which the
    // event has to have survived into.
    const reopened = new Database(dbPath, { readonly: true });
    try {
      const row = reopened
        .prepare(
          "SELECT stream, module, action, actor, severity, details, row_hash FROM audit_event WHERE action = 'backup.restored'",
        )
        .get() as
        | { stream: string; module: string; action: string; actor: string; severity: string; details: string; row_hash: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.severity).toBe("CRITICAL");
      expect(row?.stream).toBe("security");
      expect(row?.module).toBe("backup");
      // The actor is the userId the SERVER holds for that token, not a name the
      // renderer sent.
      expect(row?.actor).toBe("USER-ADMIN");
      expect(JSON.parse(row?.details ?? "{}")).toMatchObject({ archive: archiveName });
      // It is chained like every other row, so deleting it is detectable.
      expect(row?.row_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      reopened.close();
    }
  });
});

describe("replacing the backup protection re-checks the user's password", () => {
  const checked: string[] = [];

  async function registerWithRecovery(): Promise<void> {
    handlers.clear();
    checked.length = 0;
    const { registerRestoreOverIpc, PasswordCheckOutcome } = await import("./restore-ipc.js");
    registerRestoreOverIpc({
      dbPath,
      backupsDir,
      appVersion: "9.9.9",
      sqlite: () => live,
      closeLiveConnections: () => {
        live.close();
      },
      relaunch: () => undefined,
      sessions: fakeSessions(ADMIN),
      recoveryKeyStore: {
        isAvailable: () => true,
        seal: (plain) => Buffer.from(plain, "utf8"),
        unseal: (sealed) => sealed.toString("utf8"),
      },
      verifyPassword: async (_token, password) => {
        checked.push(password);
        return password === "Owner-Pass-9"
          ? { outcome: PasswordCheckOutcome.Confirmed, message: null }
          : { outcome: PasswordCheckOutcome.Refused, message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." };
      },
    });
  }

  const set = (body: Record<string, unknown>) =>
    call<BackupRecoveryResult>(MEZAN_BACKUP_RECOVERY_SET_CHANNEL, "good-token", { mode: RecoveryMode.Passphrase, ...body });

  it("sets the first secret with no password, then refuses a replacement without the right one", async () => {
    await registerWithRecovery();
    expect((await set({ passphrase: "first long passphrase" })).ok).toBe(true);
    expect(checked).toEqual([]);

    const missing = await set({ passphrase: "second long passphrase" });
    expect(missing.ok === false && missing.code).toBe("PASSWORD_REQUIRED");

    const wrong = await set({ passphrase: "second long passphrase", password: "guess" });
    expect(wrong.ok === false && wrong.code).toBe("WRONG_PASSWORD");

    expect((await set({ passphrase: "second long passphrase", password: "Owner-Pass-9" })).ok).toBe(true);
    expect(checked).toEqual(["guess", "Owner-Pass-9"]);
  });
});
