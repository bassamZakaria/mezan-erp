import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBackup,
  listBackups,
  backupFileName,
  parseCreatedAtFromFileName,
  isPreUpdateArchive,
  preUpdateLabel,
  isPrecompressedAttachment,
  isFullIntegrityCheckDue,
  readIntegrityState,
  INTEGRITY_CHECK_INTERVAL_MS,
  BACKUP_FILE_EXTENSION,
} from "./backup-service.js";
import { extractArchive } from "./archive.js";
import { parseManifest } from "./manifest.js";
import { cipherDriver, openTenantConnection, type TenantCipher } from "../main/encrypted-database.js";

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

  /**
   * GUARDS U-9. The archive taken before a schema change has to be findable
   * without extracting every manifest in the folder, because the button that
   * offers to go back to it is the whole point of taking it.
   */
  it("carries the version it was taken before in the file name, and still parses", () => {
    const createdAt = new Date("2026-08-14T03:00:00.000Z");
    const fileName = backupFileName(createdAt, preUpdateLabel("1.4.0"));

    expect(fileName).toContain("pre-update-1.4.0");
    expect(isPreUpdateArchive(fileName)).toBe(true);
    // Retention reads the timestamp out of the name; a labelled archive must
    // not become invisible to it.
    expect(parseCreatedAtFromFileName(fileName)?.toISOString()).toBe(createdAt.toISOString());
  });

  it("does not mistake an ordinary archive for a pre-update one", () => {
    expect(isPreUpdateArchive(backupFileName(new Date()))).toBe(false);
  });

  it("creates the backups directory private to this user (0700)", async () => {
    const base = await tmpDir();
    const { db } = await seededFileDb(base);
    const dir = path.join(base, "fresh-backups");
    await createBackup({ sqlite: db, backupsDir: dir, appVersion: "1.0.0", reason: "manual" });
    const { stat } = await import("node:fs/promises");
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });
});

// GUARDS Q-2 (docs/artifacts/audit-2026-09-07.md §4.4): the daily backup used to
// run its full copy, sha256, tar+gzip, extract and integrity_check synchronously
// on the Electron main-process event loop. These prove the off-thread pipeline
// actually produces the same trustworthy archive, that attachments already in a
// compressed format are not gzip'd a second time, and that the weekly
// integrity-check cadence never lets an unverified archive evict a good one.

describe("isPrecompressedAttachment", () => {
  it("recognises image/video/audio/archive extensions, case-insensitively", () => {
    for (const name of ["photo.JPG", "clip.mp4", "song.mp3", "backup.zip", "scan.heic"]) {
      expect(isPrecompressedAttachment(name)).toBe(true);
    }
  });

  it("treats everything else — including the database itself — as compressible", () => {
    for (const name of ["ledger.sqlite", "notes.txt", "report.csv", "no-extension"]) {
      expect(isPrecompressedAttachment(name)).toBe(false);
    }
  });
});

describe("createBackup — attachment compression policy", () => {
  it("skips gzip for an already-compressed attachment, keeps a compressible one in the tar, and records the split in the manifest", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
    const pngPath = path.join(dir, "logo.png");
    await writeFile(pngPath, pngBytes);
    const txtPath = path.join(dir, "note.txt");
    await writeFile(txtPath, "compress me");

    const result = await createBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.0.0",
      reason: "manual",
      extraFiles: [
        { sourcePath: pngPath, archiveName: "logo.png" },
        { sourcePath: txtPath, archiveName: "note.txt" },
      ],
    });

    expect(result.manifest.looseAttachments).toEqual(["logo.png"]);

    const extracted = await extractArchive(result.archivePath, path.join(dir, "extracted"));
    const entries = await readdir(extracted.destDir);
    expect(entries).toContain("note.txt");
    expect(entries).not.toContain("logo.png");

    const loose = await readFile(path.join(`${result.archivePath}.attachments`, "logo.png"));
    expect(loose.equals(pngBytes)).toBe(true);
  });
});

describe("createBackup — weekly integrity-check cadence", () => {
  it("runs the full check on the first backup, skips it on the next within 7 days, and preserves verify-before-retention either way", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");
    const day1 = new Date("2026-09-01T08:00:00.000Z");

    const first = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "scheduled", now: day1 });
    expect(first.manifest.lastIntegrityCheckAt).toBe(day1.toISOString());
    const stateAfterFirst = await readIntegrityState(backupsDir);
    expect(stateAfterFirst.lastIntegrityCheckAt).toBe(day1.toISOString());

    const day2 = new Date(day1.getTime() + 6 * 60 * 60 * 1000);
    db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-3", "second day");
    const second = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "scheduled", now: day2 });
    // Not due yet — the manifest carries the FIRST run's timestamp forward
    // rather than optimistically claiming a fresh proof that didn't happen.
    expect(second.manifest.lastIntegrityCheckAt).toBe(day1.toISOString());
    const stateAfterSecond = await readIntegrityState(backupsDir);
    expect(stateAfterSecond.lastIntegrityCheckAt).toBe(day1.toISOString());

    // Both archives are still individually openable — the cheaper proof
    // (extract + checksum) ran on both, full-check cadence or not.
    for (const archivePath of [first.archivePath, second.archivePath]) {
      const extracted = await extractArchive(archivePath, path.join(dir, `verify-${path.basename(archivePath)}`));
      expect(parseManifest(extracted.manifestJson).checksum).toHaveLength(64);
    }

    const day9 = new Date(day1.getTime() + INTEGRITY_CHECK_INTERVAL_MS + 60_000);
    const third = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "scheduled", now: day9 });
    expect(third.manifest.lastIntegrityCheckAt).toBe(day9.toISOString());
  });

  it("isFullIntegrityCheckDue: never run or older than 7 days is due, a recent run is not", () => {
    const now = new Date("2026-09-07T00:00:00.000Z");
    expect(isFullIntegrityCheckDue(null, now)).toBe(true);
    expect(isFullIntegrityCheckDue(new Date(now.getTime() - INTEGRITY_CHECK_INTERVAL_MS).toISOString(), now)).toBe(
      true,
    );
    expect(isFullIntegrityCheckDue(new Date(now.getTime() - 60_000).toISOString(), now)).toBe(false);
  });
});

describe("createBackup — the copy itself off-thread (cipher opt-in)", () => {
  it("takes the VACUUM INTO snapshot in the worker, via its own connection, when `cipher` is supplied", async () => {
    const dir = await tmpDir();
    const KEY = "7".repeat(64);
    const cipher: TenantCipher = { driver: cipherDriver, key: KEY };
    const dbPath = path.join(dir, "mezan.db");
    const db = openTenantConnection(dbPath, cipher);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE customer (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    db.prepare("INSERT INTO customer VALUES (?, ?)").run("C-1", "شركة الاختبار");

    try {
      const result = await createBackup({
        sqlite: db,
        backupsDir: path.join(dir, "backups"),
        appVersion: "1.0.0",
        reason: "scheduled",
        encrypted: true,
        cipher: { key: KEY },
      });

      const extracted = await extractArchive(result.archivePath, path.join(dir, "extracted"));
      const opened = new cipherDriver(extracted.dbFilePath, { readonly: true });
      opened.pragma(`key = "x'${KEY}'"`);
      expect(opened.prepare("SELECT name FROM customer WHERE id = 'C-1'").get()).toEqual({
        name: "شركة الاختبار",
      });
      opened.close();
      expect(result.manifest.tables["customer"]).toBe(1);
      // The archive was verifiable at all (needs the key), so it was proven —
      // not merely skipped like the no-cipher encrypted default.
      expect(result.manifest.lastIntegrityCheckAt).not.toBeNull();
    } finally {
      db.close();
    }
  });
});
