import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@mezan/persistence";

/**
 * `backup-hooks.ts` imports electron's `app` for the on-close schedule. The
 * hook under test here never touches it, but the module-level import would
 * still fail outside an Electron runtime.
 */
const electronApp = {
  listeners: new Map<string, (event: { preventDefault: () => void }) => void>(),
  quitCalls: 0,
  on(event: string, listener: (event: { preventDefault: () => void }) => void) {
    electronApp.listeners.set(event, listener);
  },
  removeListener(event: string) {
    electronApp.listeners.delete(event);
  },
  quit() {
    electronApp.quitCalls += 1;
  },
};

vi.mock("electron", () => ({ app: electronApp }));

const { backupThenMigrate, isMigrationPending, scheduleBackups } = await import("./backup-hooks.js");
const { extractArchive } = await import("../backup/archive.js");
const { withBackupLock } = await import("../backup/backup-lock.js");
const { parseManifest } = await import("../backup/manifest.js");

const dirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function seededDb(): Promise<{ db: Database.Database; backupsDir: string; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-premigrate-"));
  dirs.push(dir);
  const db = new Database(path.join(dir, "live.sqlite"));
  dbs.push(db);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE journal_entry (id TEXT PRIMARY KEY, memo TEXT NOT NULL);");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-1", "cash sale");
  return { db, backupsDir: path.join(dir, "backups"), dir };
}

const archives = async (backupsDir: string) =>
  (await readdir(backupsDir).catch(() => [] as string[])).filter((f) => f.endsWith(".mezanbak"));

describe("backupThenMigrate — the books are safe before the schema moves", () => {
  it("finishes the backup BEFORE the migration starts, not merely before it returns", async () => {
    const { db, backupsDir } = await seededDb();
    let archivesWhenMigrationRan: string[] = [];

    await backupThenMigrate({
      sqlite: db,
      backupsDir,
      appVersion: "1.2.3",
      migrate: async () => {
        // The whole point of the hook: by the time a migration can touch the
        // schema, a restorable archive must already exist on disk.
        archivesWhenMigrationRan = await archives(backupsDir);
      },
    });

    expect(archivesWhenMigrationRan).toHaveLength(1);
  });

  it("aborts the migration when the backup fails — the schema is never touched unprotected", async () => {
    const { db } = await seededDb();
    const migrate = vi.fn(async () => {});

    // A backups directory inside a file, so the backup cannot be written.
    const impossible = path.join(dirs[0] as string, "live.sqlite", "backups");

    await expect(
      backupThenMigrate({ sqlite: db, backupsDir: impossible, appVersion: "1.2.3", migrate }),
    ).rejects.toBeTruthy();

    expect(migrate).not.toHaveBeenCalled();
  });

  it("preserves the archive when the migration itself throws, and rethrows", async () => {
    const { db, backupsDir } = await seededDb();
    const boom = new Error("migration 004 failed");

    await expect(
      backupThenMigrate({
        sqlite: db,
        backupsDir,
        appVersion: "1.2.3",
        migrate: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    // The archive survives the failure — it is the only way back.
    expect(await archives(backupsDir)).toHaveLength(1);
  });

  it("names the surviving archive in what it logs, so an operator can find it", async () => {
    const { db, backupsDir } = await seededDb();
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    await expect(
      backupThenMigrate({
        sqlite: db,
        backupsDir,
        appVersion: "1.2.3",
        migrate: async () => {
          throw new Error("migration 004 failed");
        },
      }),
    ).rejects.toThrow();

    const [archive] = await archives(backupsDir);
    const logged = errors.map((args) => String(args[0])).join("\n");
    expect(logged).toContain(archive as string);
    // It has to name a place a PERSON can go. This used to say "restore it via
    // the backup module's restoreBackup()" — a function call, not a step a
    // shop owner can perform, and at the time also the only instruction the
    // product gave, because nothing called that function.
    expect(logged).toContain("الإعدادات");
    expect(logged).toContain("الاستعادة");
  });

  it("tags the archive's manifest as the pre-update one, so retention keeps it under its own rule", async () => {
    const { db, backupsDir, dir } = await seededDb();
    await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" });

    const [archive] = await archives(backupsDir);
    const extracted = await extractArchive(path.join(backupsDir, archive as string), path.join(dir, "unpacked"));
    const manifest = parseManifest(extracted.manifestJson);

    expect(manifest.reason).toBe("pre-update");
    expect(manifest.appVersion).toBe("1.2.3");
    // The database really travelled: an archive whose db file is missing would
    // mean the "restore it and retry" instruction has nothing behind it.
    const { statSync } = await import("node:fs");
    expect(statSync(extracted.dbFilePath).size).toBeGreaterThan(0);
  });

  it("runs with no migration step at all, which is what the desktop ships today", async () => {
    const { db, backupsDir } = await seededDb();
    await expect(backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" })).resolves.toEqual({
      skipped: false,
      archivePath: expect.stringContaining(".mezanbak"),
    });
    expect(await archives(backupsDir)).toHaveLength(1);
  });

  /**
   * GUARDS Q-3. The launch backup was unconditional and ran before the window
   * existed: a cold start copied, hashed, tarred, extracted and integrity-
   * checked the whole database against a dock icon — minutes at 2 GB, which is
   * a force-quit, on every launch, to protect a migration that was not
   * happening.
   */
  it("takes NO backup when the database is already at this build's schema", async () => {
    const { db, backupsDir } = await seededDb();
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);

    const result = await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" });

    expect(result).toEqual({ skipped: true, archivePath: null });
    expect(await archives(backupsDir)).toHaveLength(0);
  });

  it("still runs the migration step on a launch that skips the backup", async () => {
    const { db, backupsDir } = await seededDb();
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    const migrate = vi.fn(async () => {});

    await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3", migrate });

    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("a file that holds no books yet has nothing to protect: a first launch is not a migration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-premigrate-"));
    dirs.push(dir);
    const db = new Database(path.join(dir, "fresh.sqlite"));
    dbs.push(db);
    expect(isMigrationPending(db)).toBe(false);
  });

  it("backs up when the stored schema is older than this build's", async () => {
    const { db, backupsDir } = await seededDb();
    db.pragma("user_version = 0");
    expect(isMigrationPending(db)).toBe(true);

    await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" });

    expect(await archives(backupsDir)).toHaveLength(1);
  });

  /** GUARDS U-9: the archive has to be findable by the revert button. */
  it("names the archive after the version it was taken before", async () => {
    const { db, backupsDir } = await seededDb();
    await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.4.0" });

    const [archive] = await archives(backupsDir);
    expect(archive).toContain("pre-update-1.4.0");
  });
});

/**
 * GUARDS Q-4. `void run("on-close")` on `will-quit` was not awaited and did not
 * prevent the quit, so the process exited while the copy was still being
 * written: the nightly close backup effectively never completed.
 */
describe("scheduleBackups — the on-close backup actually completes", () => {
  it("holds the quit until the backup is written, then quits", async () => {
    const { db, backupsDir } = await seededDb();
    electronApp.listeners.clear();
    electronApp.quitCalls = 0;

    const dispose = scheduleBackups({ sqlite: db, backupsDir, appVersion: "1.2.3" });
    const onBeforeQuit = electronApp.listeners.get("before-quit");
    expect(onBeforeQuit).toBeDefined();

    let prevented = false;
    onBeforeQuit?.({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    // Nothing has quit yet, and no archive exists yet either.
    expect(electronApp.quitCalls).toBe(0);

    // Let the awaited backup finish.
    for (let i = 0; i < 200 && electronApp.quitCalls === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(electronApp.quitCalls).toBe(1);
    expect(await archives(backupsDir)).toHaveLength(1);
    dispose();
  });

  it("quits anyway, loudly, when the backup outruns its bound", async () => {
    const { db, backupsDir } = await seededDb();
    electronApp.listeners.clear();
    electronApp.quitCalls = 0;
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(String(args[0]));
    });

    const dispose = scheduleBackups({
      sqlite: db,
      backupsDir,
      appVersion: "1.2.3",
      onCloseTimeoutMs: 0,
    });
    electronApp.listeners.get("before-quit")?.({ preventDefault: () => {} });

    for (let i = 0; i < 200 && electronApp.quitCalls === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(electronApp.quitCalls).toBe(1);
    // An app that will not close is worse than a missed archive, but a machine
    // that keeps hitting the bound has to be diagnosable.
    expect(errors.join("\n")).toContain("did not finish within");
    dispose();
    // The abandoned backup is still running, and it goes on writing into the
    // directory AFTER its archive appears (the integrity-check state, the
    // snapshot's removal). Queue behind it, so the directory is torn down only
    // once it has finished.
    await withBackupLock(async () => undefined);
    expect(await archives(backupsDir)).toHaveLength(1);
  });


  it("backs up the live rows, not an empty file", async () => {
    const { db, backupsDir } = await seededDb();
    db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-2", "refund");

    await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" });

    const [archive] = await archives(backupsDir);
    const { statSync } = await import("node:fs");
    // A backup of a two-row database is not zero bytes; an empty archive here
    // would be a silent total loss at the moment it is most needed.
    expect(statSync(path.join(backupsDir, archive as string)).size).toBeGreaterThan(0);
  });
});
