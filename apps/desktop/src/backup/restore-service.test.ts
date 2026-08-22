import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackup } from "./backup-service.js";
import { restoreBackup } from "./restore-service.js";
import { ChecksumMismatchError, ManifestValidationError } from "./errors.js";
import { extractArchive, createArchive } from "./archive.js";

const dirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmpDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "mezan-restore-"));
  dirs.push(d);
  return d;
}

async function seededFileDb(dir: string, name = "live.sqlite") {
  const dbPath = path.join(dir, name);
  const db = new Database(dbPath);
  dbs.push(db);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE journal_entry (id TEXT PRIMARY KEY, memo TEXT NOT NULL);");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-1", "cash sale");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-2", "refund");
  return { db, dbPath };
}

describe("createBackup -> restoreBackup (end-to-end integrity)", () => {
  it("restores a backup byte-for-byte and the restored db serves identical query results", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");

    const { archivePath } = await createBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.0.0",
      reason: "manual",
    });

    const targetDbPath = path.join(dir, "restored.sqlite");
    const { manifest, dbPath } = await restoreBackup({
      archivePath,
      targetDbPath,
      workDir: path.join(dir, "work"),
    });

    expect(dbPath).toBe(targetDbPath);
    expect(manifest.tables).toEqual({ journal_entry: 2 });

    const restored = new Database(targetDbPath, { readonly: true });
    dbs.push(restored);
    const rows = restored.prepare("SELECT id, memo FROM journal_entry ORDER BY id").all();
    expect(rows).toEqual([
      { id: "JE-1", memo: "cash sale" },
      { id: "JE-2", memo: "refund" },
    ]);
  });

  it("cleans up its extraction working directory after a successful restore", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");
    const { archivePath } = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "manual" });

    const workDir = path.join(dir, "work");
    await restoreBackup({ archivePath, targetDbPath: path.join(dir, "restored.sqlite"), workDir });

    const { readdir } = await import("node:fs/promises");
    await expect(readdir(workDir)).resolves.toEqual([]);
  });

  it("rejects a restore when the archived database's bytes don't match the manifest checksum", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");
    const { archivePath } = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "manual" });

    // Tamper: extract, corrupt the db bytes, repack under the same manifest.
    const extracted = await extractArchive(archivePath, path.join(dir, "tamper"));
    const dbBytes = await readFile(extracted.dbFilePath);
    dbBytes[dbBytes.length - 1] = (dbBytes[dbBytes.length - 1]! + 1) % 256;
    await writeFile(extracted.dbFilePath, dbBytes);

    const tamperedArchive = path.join(dir, "tampered.mezanbak");
    await createArchive({
      dbFilePath: extracted.dbFilePath,
      manifestJson: extracted.manifestJson, // unchanged — checksum now stale
      outputPath: tamperedArchive,
    });

    await expect(
      restoreBackup({
        archivePath: tamperedArchive,
        targetDbPath: path.join(dir, "restored.sqlite"),
        workDir: path.join(dir, "work2"),
      }),
    ).rejects.toThrow(ChecksumMismatchError);
  });

  it("rejects a restore whose archive has a corrupt/invalid manifest.json", async () => {
    const dir = await tmpDir();
    const { db, dbPath } = await seededFileDb(dir);
    void db;

    const badArchive = path.join(dir, "bad.mezanbak");
    await createArchive({ dbFilePath: dbPath, manifestJson: "{not valid json", outputPath: badArchive });

    await expect(
      restoreBackup({
        archivePath: badArchive,
        targetDbPath: path.join(dir, "restored.sqlite"),
        workDir: path.join(dir, "work3"),
      }),
    ).rejects.toThrow(ManifestValidationError);
  });

  it("never mounts a bad restore over an existing target database", async () => {
    const dir = await tmpDir();
    const { db } = await seededFileDb(dir);
    const backupsDir = path.join(dir, "backups");
    const { archivePath } = await createBackup({ sqlite: db, backupsDir, appVersion: "1.0.0", reason: "manual" });

    const extracted = await extractArchive(archivePath, path.join(dir, "tamper2"));
    const dbBytes = await readFile(extracted.dbFilePath);
    dbBytes[0] = (dbBytes[0]! + 1) % 256;
    await writeFile(extracted.dbFilePath, dbBytes);
    const tamperedArchive = path.join(dir, "tampered2.mezanbak");
    await createArchive({
      dbFilePath: extracted.dbFilePath,
      manifestJson: extracted.manifestJson,
      outputPath: tamperedArchive,
    });

    const targetDbPath = path.join(dir, "restored.sqlite");
    await writeFile(targetDbPath, "pre-existing target contents");

    await expect(
      restoreBackup({ archivePath: tamperedArchive, targetDbPath, workDir: path.join(dir, "work4") }),
    ).rejects.toThrow(ChecksumMismatchError);

    // The pre-existing target must survive an aborted restore untouched.
    expect(await readFile(targetDbPath, "utf8")).toBe("pre-existing target contents");
  });
});
