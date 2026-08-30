import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import PlainDatabase from "better-sqlite3";
import { cipherDriver, openTenantConnection, type TenantCipher } from "../main/encrypted-database.js";
import { createBackup } from "./backup-service.js";
import { restoreBackup } from "./restore-service.js";
import { extractArchive } from "./archive.js";
import { BackupKeyMismatchError } from "./errors.js";

/**
 * The backups directory is what gets copied onto a USB stick and carried out of
 * the shop. If the archive holds a decrypted database, the encryption at rest is
 * decorative — the live file is unreadable and the copy beside it is not. These
 * tests read the actual bytes inside the archive rather than trusting a flag.
 */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-encbak-"));
  dirs.push(dir);
  return dir;
}

const KEY = "9".repeat(64);
const OTHER_KEY = "1".repeat(64);
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");
const cipher: TenantCipher = { driver: cipherDriver, key: KEY };

function isPlaintextSqlite(filePath: string): boolean {
  return readFileSync(filePath).subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER);
}

function seedEncrypted(dbPath: string): ReturnType<typeof openTenantConnection> {
  const db = openTenantConnection(dbPath, cipher);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE customer (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)");
  db.prepare("INSERT INTO customer VALUES (?, ?, ?)").run("C-1", "شركة النور", 1_500_000);
  return db;
}

describe("backups of an encrypted database", () => {
  it("packages an encrypted snapshot — the archive is not a readable copy of the books", async () => {
    const dir = workDir();
    const db = seedEncrypted(path.join(dir, "mezan.db"));
    try {
      const result = await createBackup({
        sqlite: db,
        backupsDir: path.join(dir, "backups"),
        appVersion: "1.2.3",
        reason: "manual",
        encrypted: true,
      });

      const extracted = await extractArchive(result.archivePath, path.join(dir, "extract"));
      expect(isPlaintextSqlite(extracted.dbFilePath)).toBe(false);
      expect(() => new PlainDatabase(extracted.dbFilePath, { readonly: true }).pragma("integrity_check")).toThrow();

      const opened = new cipherDriver(extracted.dbFilePath, { readonly: true });
      opened.pragma(`key = "x'${KEY}'"`);
      expect(opened.prepare("SELECT name FROM customer WHERE id = 'C-1'").get()).toEqual({
        name: "شركة النور",
      });
      opened.close();

      // The manifest still describes the real contents, so the restore picker
      // is not reduced to a filename and a size.
      expect(result.manifest.tables["customer"]).toBe(1);
    } finally {
      db.close();
    }
  });

  it("refuses to write the archive when the snapshot came out readable", async () => {
    const dir = workDir();
    const plain = new PlainDatabase(path.join(dir, "mezan.db"));
    plain.exec("CREATE TABLE customer (id TEXT PRIMARY KEY)");
    try {
      // `encrypted: true` against an UNKEYED connection is the composition
      // mistake that would put the whole customer list in the archive.
      await expect(
        createBackup({
          sqlite: plain,
          backupsDir: path.join(dir, "backups"),
          appVersion: "1.2.3",
          reason: "manual",
          encrypted: true,
        }),
      ).rejects.toThrow(/refusing to write a plaintext archive/);
    } finally {
      plain.close();
    }
  });
});

describe("restoring an encrypted archive", () => {
  it("round-trips: encrypted archive in, encrypted live database out", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    const db = seedEncrypted(dbPath);
    const { archivePath } = await createBackup({
      sqlite: db,
      backupsDir: path.join(dir, "backups"),
      appVersion: "1.2.3",
      reason: "manual",
      encrypted: true,
    });
    db.prepare("INSERT INTO customer VALUES (?, ?, ?)").run("C-2", "بعد النسخة", 1);
    db.close();

    const restored = await restoreBackup({
      archivePath,
      targetDbPath: dbPath,
      workDir: dir,
      cipher,
    });
    expect(restored.manifest.appVersion).toBe("1.2.3");
    expect(isPlaintextSqlite(dbPath)).toBe(false);

    const reopened = openTenantConnection(dbPath, cipher);
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM customer").get()).toEqual({ n: 1 });
    reopened.close();
  });

  it("names the real problem when the archive belongs to other hardware", async () => {
    const dir = workDir();
    const db = seedEncrypted(path.join(dir, "mezan.db"));
    const { archivePath } = await createBackup({
      sqlite: db,
      backupsDir: path.join(dir, "backups"),
      appVersion: "1.2.3",
      reason: "manual",
      encrypted: true,
    });
    db.close();

    const target = path.join(dir, "restored.db");
    await expect(
      restoreBackup({
        archivePath,
        targetDbPath: target,
        workDir: dir,
        cipher: { driver: cipherDriver, key: OTHER_KEY },
      }),
    ).rejects.toBeInstanceOf(BackupKeyMismatchError);

    // And with no key at all — an install running unencrypted.
    await expect(
      restoreBackup({ archivePath, targetDbPath: target, workDir: dir }),
    ).rejects.toBeInstanceOf(BackupKeyMismatchError);

    // Nothing was mounted either way.
    expect(() => readFileSync(target)).toThrow();
  });

  it("still restores an archive taken before encryption shipped", async () => {
    const dir = workDir();
    const legacyPath = path.join(dir, "legacy.db");
    const legacy = new PlainDatabase(legacyPath);
    legacy.exec("CREATE TABLE customer (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    legacy.prepare("INSERT INTO customer VALUES (?, ?)").run("C-9", "عميل قديم");
    const { archivePath } = await createBackup({
      sqlite: legacy,
      backupsDir: path.join(dir, "backups"),
      appVersion: "0.9.0",
      reason: "manual",
    });
    legacy.close();

    // Mounted onto an install that IS encrypted: the archive is plaintext, so
    // the verification runs on the plain driver and the key is not consulted.
    // The next launch converts the file (main/encrypted-database.ts).
    const target = path.join(dir, "mezan.db");
    await restoreBackup({ archivePath, targetDbPath: target, workDir: dir, cipher });
    expect(isPlaintextSqlite(target)).toBe(true);
    const check = new PlainDatabase(target, { readonly: true });
    expect(check.prepare("SELECT name FROM customer WHERE id = 'C-9'").get()).toEqual({
      name: "عميل قديم",
    });
    check.close();
  });
});
