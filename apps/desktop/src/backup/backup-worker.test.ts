import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runBackupWorkerJob, lightVerify, type BackupWorkerJob } from "./backup-worker.js";
import { createArchive, extractArchive } from "./archive.js";
import { serializeManifest, buildManifest } from "./manifest.js";
import { ChecksumMismatchError } from "./errors.js";
import { BackupReason } from "./manifest.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmpDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "mezan-backup-worker-"));
  dirs.push(d);
  return d;
}

function baseJob(overrides: Partial<BackupWorkerJob> & { dbFilePath: string; archivePath: string; workDir: string }): BackupWorkerJob {
  return {
    snapshot: null,
    manifestInput: {
      appVersion: "1.0.0",
      reason: BackupReason.Manual,
      createdAt: new Date("2026-09-07T00:00:00.000Z").toISOString(),
      tables: {},
      lastIntegrityCheckAt: null,
    },
    extraFiles: [],
    looseAttachments: [],
    looseDir: path.join(overrides.workDir, "loose"),
    verifiable: true,
    runFullIntegrityCheck: true,
    verifyCipherKey: null,
    ...overrides,
  };
}

describe("runBackupWorkerJob — off-thread pipeline (guards Q-2)", () => {
  it("routes an already-compressed attachment beside the archive, uncompressed, and records it in the manifest", async () => {
    const dir = await tmpDir();
    const dbFilePath = path.join(dir, "snapshot.sqlite");
    await writeFile(dbFilePath, "fake db bytes");
    const pngPath = path.join(dir, "logo.png");
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await writeFile(pngPath, pngBytes);
    const txtPath = path.join(dir, "note.txt");
    await writeFile(txtPath, "plain text, still compressible");

    const archivePath = path.join(dir, "backup.mezanbak");
    const job = baseJob({
      dbFilePath,
      archivePath,
      workDir: dir,
      looseAttachments: [{ sourcePath: pngPath, archiveName: "logo.png" }],
      extraFiles: [{ sourcePath: txtPath, archiveName: "note.txt" }],
      verifiable: false,
    });

    const result = await runBackupWorkerJob(job);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.looseAttachments).toEqual(["logo.png"]);

    const looseBytes = await readFile(path.join(job.looseDir, "logo.png"));
    expect(looseBytes.equals(pngBytes)).toBe(true);

    const extracted = await extractArchive(archivePath, path.join(dir, "extracted"));
    const entries = await readdir(extracted.destDir);
    expect(entries).toContain("note.txt");
    expect(entries).not.toContain("logo.png");
  });

  it("stamps the manifest with now() on the day a full integrity check runs, and carries the old timestamp forward when it doesn't", async () => {
    const dir = await tmpDir();
    const dbFilePath = path.join(dir, "snapshot.sqlite");
    const db = new Database(dbFilePath);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.close();

    const dueJob = baseJob({
      dbFilePath,
      archivePath: path.join(dir, "due.mezanbak"),
      workDir: dir,
      runFullIntegrityCheck: true,
      manifestInput: {
        appVersion: "1.0.0",
        reason: BackupReason.Scheduled,
        createdAt: new Date("2026-09-07T00:00:00.000Z").toISOString(),
        tables: {},
        lastIntegrityCheckAt: null,
      },
    });
    const dueResult = await runBackupWorkerJob(dueJob);
    expect(dueResult.ok).toBe(true);
    if (!dueResult.ok) return;
    expect(dueResult.ranFullIntegrityCheck).toBe(true);
    expect(dueResult.manifest.lastIntegrityCheckAt).toBe("2026-09-07T00:00:00.000Z");

    const notDueJob = baseJob({
      dbFilePath,
      archivePath: path.join(dir, "not-due.mezanbak"),
      workDir: dir,
      runFullIntegrityCheck: false,
      manifestInput: {
        appVersion: "1.0.0",
        reason: BackupReason.Scheduled,
        createdAt: new Date("2026-09-08T00:00:00.000Z").toISOString(),
        tables: {},
        lastIntegrityCheckAt: "2026-09-07T00:00:00.000Z",
      },
    });
    const notDueResult = await runBackupWorkerJob(notDueJob);
    expect(notDueResult.ok).toBe(true);
    if (!notDueResult.ok) return;
    expect(notDueResult.ranFullIntegrityCheck).toBe(false);
    // Carried forward, NOT re-stamped to today — the weekly cadence recorded
    // truthfully rather than every archive claiming to have just been proven.
    expect(notDueResult.manifest.lastIntegrityCheckAt).toBe("2026-09-07T00:00:00.000Z");
  });

  it("still quarantines a corrupt snapshot instead of calling it a backup — verify runs before retention would ever see it", async () => {
    const dir = await tmpDir();
    const dbFilePath = path.join(dir, "snapshot.sqlite");
    const db = new Database(dbFilePath);
    db.exec(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); " +
        Array.from({ length: 200 }, (_, i) => `INSERT INTO t VALUES (${i}, 'row-${i}');`).join(" "),
    );
    db.close();
    // Truncate off the tail: the header (and hence `sha256File`/checksum
    // machinery) still runs, but the page structure `PRAGMA integrity_check`
    // walks is now incomplete — a real, not simulated, corrupt snapshot.
    const bytes = await readFile(dbFilePath);
    await writeFile(dbFilePath, bytes.subarray(0, Math.floor(bytes.length * 0.6)));

    const archivePath = path.join(dir, "backup.mezanbak");
    const job = baseJob({
      dbFilePath,
      archivePath,
      workDir: dir,
      verifiable: true,
      runFullIntegrityCheck: true,
    });

    const result = await runBackupWorkerJob(job);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.quarantinedPath).toBe(`${archivePath}.unverified`);
    await expect(readFile(archivePath)).rejects.toThrow();
    const quarantined = await readFile(result.quarantinedPath!);
    expect(quarantined.length).toBeGreaterThan(0);
  });

  it("lightVerify (the skip-the-full-check path) still catches a checksum mismatch — the cheap proof stays mandatory", async () => {
    const dir = await tmpDir();
    const dbFilePath = path.join(dir, "snapshot.sqlite");
    await writeFile(dbFilePath, "real bytes on disk");

    const archivePath = path.join(dir, "backup.mezanbak");
    // A manifest whose checksum does not match `dbFilePath` — the shape a
    // tampered-in-transit or bit-rotted archive takes.
    const staleManifest = buildManifest({
      checksum: "a".repeat(64),
      tables: {},
      appVersion: "1.0.0",
      reason: BackupReason.Scheduled,
      createdAt: new Date(),
    });
    await createArchive({ dbFilePath, manifestJson: serializeManifest(staleManifest), outputPath: archivePath });

    await expect(lightVerify({ archivePath, workDir: dir, cipherKey: null })).rejects.toBeInstanceOf(
      ChecksumMismatchError,
    );
  });
});
