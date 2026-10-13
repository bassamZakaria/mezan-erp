import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, describe, expect, it } from "vitest";
import { createBackup } from "./backup-service.js";
import { extractArchive } from "./archive.js";
import { verifyArchive } from "./restore-service.js";
import { BackupReason } from "./manifest.js";

/**
 * Portable backups, against a REAL encrypted database.
 *
 * The whole feature is a claim about a file's first sixteen bytes, and the
 * failure it guards against — an archive that says it is restorable and is not —
 * only surfaces on replacement hardware, which is the one moment a shop cannot
 * afford a surprise. So this opens a keyed database, backs it up both ways, and
 * reads the bytes back.
 */
const dirs: string[] = [];
const KEY = "correct-horse-battery-staple";

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function encryptedDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-"));
  dirs.push(dir);
  const db = new Database(path.join(dir, "mezan.db"));
  db.pragma(`key='${KEY}'`);
  db.exec("CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT)");
  db.prepare("INSERT INTO customers VALUES (?, ?)").run("C1", "شركة الأمل للتجارة");
  return { dir, db };
}

async function snapshotOf(archivePath: string, into: string): Promise<string> {
  const extracted = await extractArchive(archivePath, into);
  return extracted.dbFilePath;
}

describe("portable backups", () => {
  it("writes an archive another machine can open, and it still holds the rows", async () => {
    const { dir, db } = await encryptedDb();
    const backupsDir = path.join(dir, "backups");

    const result = await createBackup({
      sqlite: db as unknown as Parameters<typeof createBackup>[0]["sqlite"],
      backupsDir,
      appVersion: "test",
      reason: BackupReason.Scheduled,
      encrypted: true,
      portable: {
        key: KEY,
        open: (file: string, key: string) => {
          const conn = new Database(file);
          conn.pragma(`key='${key}'`);
          return conn as unknown as Parameters<typeof createBackup>[0]["sqlite"];
        },
      },
    });

    // Opened with NO key at all — which is exactly what a replacement machine
    // would be able to do, and what the encrypted path deliberately prevents.
    const out = path.join(dir, "restored");
    const restored = new Database(await snapshotOf(result.archivePath, out), { readonly: true });
    const row = restored.prepare("SELECT name FROM customers WHERE id = 'C1'").get() as {
      name: string;
    };
    expect(row.name).toBe("شركة الأمل للتجارة");
    restored.close();
    db.close();
  });

  it("still refuses to call an encrypted snapshot portable", async () => {
    const { dir, db } = await encryptedDb();
    const backupsDir = path.join(dir, "backups");

    // The non-portable path keeps the cipher, and the archive is unreadable
    // without the key — the property the default protects.
    const result = await createBackup({
      sqlite: db as unknown as Parameters<typeof createBackup>[0]["sqlite"],
      backupsDir,
      appVersion: "test",
      reason: BackupReason.Scheduled,
      encrypted: true,
    });

    const out = path.join(dir, "restored-encrypted");
    const file = await snapshotOf(result.archivePath, out);
    expect(() => new Database(file, { readonly: true }).prepare("SELECT 1 FROM customers").get()).toThrow();
    db.close();
  });
});

describe("write-time verification", () => {
  it("reads the archive back and reports the row counts it really contains", async () => {
    const { dir, db } = await encryptedDb();
    const result = await createBackup({
      sqlite: db as unknown as Parameters<typeof createBackup>[0]["sqlite"],
      backupsDir: path.join(dir, "backups"),
      appVersion: "test",
      reason: BackupReason.Scheduled,
      encrypted: true,
      portable: {
        key: KEY,
        open: (file: string, key: string) => {
          const conn = new Database(file);
          conn.pragma(`key='${key}'`);
          return conn as unknown as Parameters<typeof createBackup>[0]["sqlite"];
        },
      },
    });

    const verified = await verifyArchive({
      archivePath: result.archivePath,
      workDir: path.join(dir, "verify"),
    });
    expect(verified.ok).toBe(true);
    expect(verified.tables["customers"]).toBe(1);
    db.close();
  });

  /**
   * The point of verifying at write time: a file that is not a usable archive
   * must be refused NOW, not discovered on the day the shop needs it.
   */
  it("refuses a corrupt archive instead of calling it a backup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-corrupt-"));
    dirs.push(dir);
    const bogus = path.join(dir, "mezan-backup-2026-09-05T00-00-00-000Z.mezanbak");
    await writeFile(bogus, "this is not a tar archive");

    await expect(
      verifyArchive({ archivePath: bogus, workDir: path.join(dir, "verify") }),
    ).rejects.toThrow();
  });
});
