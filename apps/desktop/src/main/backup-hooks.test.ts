import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `backup-hooks.ts` imports electron's `app` for the on-close schedule. The
 * hook under test here never touches it, but the module-level import would
 * still fail outside an Electron runtime.
 */
vi.mock("electron", () => ({ app: { on: vi.fn(), removeListener: vi.fn() } }));

const { backupThenMigrate } = await import("./backup-hooks.js");
const { extractArchive } = await import("../backup/archive.js");
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

  it("tags the archive's manifest as the pre-migration one, so retention can tell it apart", async () => {
    const { db, backupsDir, dir } = await seededDb();
    await backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" });

    const [archive] = await archives(backupsDir);
    const extracted = await extractArchive(path.join(backupsDir, archive as string), path.join(dir, "unpacked"));
    const manifest = parseManifest(extracted.manifestJson);

    expect(manifest.reason).toBe("pre-migration");
    expect(manifest.appVersion).toBe("1.2.3");
    // The database really travelled: an archive whose db file is missing would
    // mean the "restore it and retry" instruction has nothing behind it.
    const { statSync } = await import("node:fs");
    expect(statSync(extracted.dbFilePath).size).toBeGreaterThan(0);
  });

  it("runs with no migration step at all, which is what the desktop ships today", async () => {
    const { db, backupsDir } = await seededDb();
    await expect(backupThenMigrate({ sqlite: db, backupsDir, appVersion: "1.2.3" })).resolves.toBeUndefined();
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
