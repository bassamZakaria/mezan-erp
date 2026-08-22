import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBackup,
  listBackups,
  backupFileName,
  parseCreatedAtFromFileName,
  BACKUP_FILE_EXTENSION,
} from "./backup-service.js";
import { extractArchive } from "./archive.js";
import { parseManifest } from "./manifest.js";

const dirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmpDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "mezan-backup-svc-"));
  dirs.push(d);
  return d;
}

/** A real on-disk (not :memory:) WAL database — .backup() requires a file source. */
async function seededFileDb(dir: string): Promise<{ db: Database.Database; dbPath: string }> {
  const dbPath = path.join(dir, "live.sqlite");
  const db = new Database(dbPath);
  dbs.push(db);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE journal_entry (id TEXT PRIMARY KEY, memo TEXT NOT NULL);");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-1", "cash sale");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-2", "refund");
  return { db, dbPath };
}

describe("createBackup", () => {
  it("produces an archive whose manifest matches the live database's row counts and checksum", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");

    const result = await createBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.2.3",
      reason: "manual",
    });

    expect(result.manifest.tables).toEqual({ journal_entry: 2 });
    expect(result.manifest.appVersion).toBe("1.2.3");
    expect(result.manifest.reason).toBe("manual");
    expect(result.archivePath.startsWith(backupsDir)).toBe(true);

    // The archive really contains what the manifest claims.
    const extracted = await extractArchive(result.archivePath, path.join(dir, "verify"));
    const manifestFromArchive = parseManifest(extracted.manifestJson);
    expect(manifestFromArchive).toEqual(result.manifest);
  });

  it("captures a consistent snapshot via the online backup API — not a raw file copy of the live WAL file", async () => {
    const dir = await tmpDir();
    const { db, dbPath } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");

    const result = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "manual" });

    // The archived snapshot is a standalone, valid SQLite file distinct from
    // the live db path (proves .backup() ran rather than a plain fs.copyFile).
    const extracted = await extractArchive(result.archivePath, path.join(dir, "verify2"));
    expect(extracted.dbFilePath).not.toBe(dbPath);
    const restored = new Database(extracted.dbFilePath, { readonly: true });
    const rows = restored.prepare("SELECT id, memo FROM journal_entry ORDER BY id").all();
    restored.close();
    expect(rows).toEqual([
      { id: "JE-1", memo: "cash sale" },
      { id: "JE-2", memo: "refund" },
    ]);
  });

  it("cleans up its temp snapshot file after archiving", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");

    await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "manual" });

    const tmpContents = await readdir(path.join(backupsDir, ".tmp"));
    expect(tmpContents).toHaveLength(0);
  });

  it("prunes old backups down to the GFS retention policy after each run", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");
    await rm(backupsDir, { recursive: true, force: true });
    await mkdir(backupsDir, { recursive: true });

    // Seed 10 fake daily backups (no weekly/monthly overlap needed for this
    // assertion) by writing filenames directly — createBackup()'s retention
    // pass only needs filenames it can parse a timestamp out of.
    const now = new Date("2026-08-22T12:00:00.000Z");
    for (let i = 1; i <= 10; i++) {
      const createdAt = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      await writeFile(path.join(backupsDir, backupFileName(createdAt)), "placeholder");
    }

    await createBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.0.0",
      reason: "scheduled",
      retentionPolicy: { daily: 3, weekly: 0, monthly: 0 },
      now,
    });

    const remaining = await listBackups(backupsDir);
    // 11 same-policy candidates (10 seeded + the one just created), each on
    // a distinct UTC day, daily cap 3 -> only the 3 most recent days survive
    // (the just-created backup's day is always one of them).
    expect(remaining).toHaveLength(3);
    expect(remaining.some((b) => b.createdAt.getTime() === now.getTime())).toBe(true);
  });
});

describe("listBackups / backupFileName / parseCreatedAtFromFileName", () => {
  it("round-trips a timestamp through the filename encoding", () => {
    const createdAt = new Date("2026-08-22T13:45:07.123Z");
    const fileName = backupFileName(createdAt);
    expect(fileName.endsWith(BACKUP_FILE_EXTENSION)).toBe(true);
    expect(parseCreatedAtFromFileName(fileName)?.toISOString()).toBe(createdAt.toISOString());
  });

  it("returns null for a filename that doesn't match the naming scheme", () => {
    expect(parseCreatedAtFromFileName("not-a-backup.txt")).toBeNull();
  });

  it("returns an empty list for a backups directory that doesn't exist yet", async () => {
    const dir = await tmpDir();
    expect(await listBackups(path.join(dir, "does-not-exist"))).toEqual([]);
  });

  it("ignores non-.mezanbak files in the backups directory", async () => {
    const dir = await tmpDir();
    await writeFile(path.join(dir, "readme.txt"), "not a backup");
    expect(await listBackups(dir)).toEqual([]);
  });
});
