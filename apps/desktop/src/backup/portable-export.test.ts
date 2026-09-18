import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MIN_PASSPHRASE_LENGTH,
  PORTABLE_FILE_EXTENSION,
  WeakPassphraseError,
  decryptFile,
  encryptFile,
  exportPortableBackup,
} from "./portable-export.js";
import { extractArchive } from "./archive.js";
import { parseManifest } from "./manifest.js";

/**
 * GUARDS N-11. Every scheduled backup used to be written with `portable`, which
 * rekeys the snapshot to plaintext: `~/Mezan Backups` held the shop's complete
 * books in the clear, with default permissions, on a machine the whole shop
 * uses. Portability is now an act somebody performs, with a passphrase, and the
 * archive that leaves is encrypted under it.
 */

const dirs: string[] = [];
const dbs: Database.Database[] = [];
const PASSPHRASE = "kalimat-sirr-2026";

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function seeded(): Promise<{ db: Database.Database; backupsDir: string; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-export-"));
  dirs.push(dir);
  const db = new Database(path.join(dir, "live.sqlite"));
  dbs.push(db);
  db.exec("CREATE TABLE journal_entry (id TEXT PRIMARY KEY, memo TEXT NOT NULL);");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-1", "cash sale");
  return { db, backupsDir: path.join(dir, "backups"), dir };
}

describe("encryptFile / decryptFile", () => {
  it("round-trips a file under the passphrase", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-crypto-"));
    dirs.push(dir);
    const source = path.join(dir, "plain.bin");
    await writeFile(source, "the whole books");

    await encryptFile(source, path.join(dir, "sealed.enc"), PASSPHRASE);
    await decryptFile(path.join(dir, "sealed.enc"), path.join(dir, "back.bin"), PASSPHRASE);

    expect(await readFile(path.join(dir, "back.bin"), "utf8")).toBe("the whole books");
  });

  it("does not leave the content readable in the encrypted file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-crypto-"));
    dirs.push(dir);
    const source = path.join(dir, "plain.bin");
    await writeFile(source, "SALARY 9500 EGP");

    await encryptFile(source, path.join(dir, "sealed.enc"), PASSPHRASE);

    const sealed = await readFile(path.join(dir, "sealed.enc"));
    expect(sealed.includes(Buffer.from("SALARY 9500 EGP"))).toBe(false);
  });

  it("refuses the wrong passphrase rather than producing garbage", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-crypto-"));
    dirs.push(dir);
    const source = path.join(dir, "plain.bin");
    await writeFile(source, "the whole books");
    await encryptFile(source, path.join(dir, "sealed.enc"), PASSPHRASE);

    await expect(
      decryptFile(path.join(dir, "sealed.enc"), path.join(dir, "back.bin"), "wrong-passphrase"),
    ).rejects.toBeTruthy();
  });

  it("refuses a tampered archive — the GCM tag is what makes that a refusal", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-crypto-"));
    dirs.push(dir);
    const source = path.join(dir, "plain.bin");
    await writeFile(source, "the whole books");
    const sealedPath = path.join(dir, "sealed.enc");
    await encryptFile(source, sealedPath, PASSPHRASE);

    const sealed = await readFile(sealedPath);
    sealed[sealed.length - 20] = (sealed[sealed.length - 20]! + 1) % 256;
    await writeFile(sealedPath, sealed);

    await expect(decryptFile(sealedPath, path.join(dir, "back.bin"), PASSPHRASE)).rejects.toBeTruthy();
  });

  it("refuses a passphrase too short to be worth the scrypt cost", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-portable-crypto-"));
    dirs.push(dir);
    const source = path.join(dir, "plain.bin");
    await writeFile(source, "x");
    await expect(encryptFile(source, path.join(dir, "sealed.enc"), "short")).rejects.toBeInstanceOf(
      WeakPassphraseError,
    );
    expect(MIN_PASSPHRASE_LENGTH).toBeGreaterThanOrEqual(8);
  });
});

describe("exportPortableBackup", () => {
  it("writes ONE encrypted file and no readable archive beside it", async () => {
    const { db, backupsDir } = await seeded();

    const result = await exportPortableBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.4.0",
      passphrase: PASSPHRASE,
    });

    const entries = await readdir(backupsDir);
    expect(entries).toEqual([path.basename(result.filePath)]);
    expect(result.filePath.endsWith(PORTABLE_FILE_EXTENSION)).toBe(true);
    // The staging copy — the readable one — is gone.
    expect(entries.some((name) => name.endsWith(".mezanbak"))).toBe(false);
  });

  it("produces an archive another machine can open with the passphrase, holding the rows", async () => {
    const { db, backupsDir, dir } = await seeded();

    const result = await exportPortableBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.4.0",
      passphrase: PASSPHRASE,
    });

    const archivePath = path.join(dir, "recovered.mezanbak");
    await decryptFile(result.filePath, archivePath, PASSPHRASE);
    const extracted = await extractArchive(archivePath, path.join(dir, "unpacked"));
    expect(parseManifest(extracted.manifestJson).appVersion).toBe("1.4.0");

    const restored = new Database(extracted.dbFilePath);
    dbs.push(restored);
    const row = restored.prepare("SELECT memo FROM journal_entry WHERE id = 'JE-1'").get() as
      | { memo: string }
      | undefined;
    expect(row?.memo).toBe("cash sale");
  });

  it("refuses a weak passphrase before it copies anything", async () => {
    const { db, backupsDir } = await seeded();

    await expect(
      exportPortableBackup({ sqlite: db, backupsDir, appVersion: "1.4.0", passphrase: "1234" }),
    ).rejects.toBeInstanceOf(WeakPassphraseError);
    await expect(readdir(backupsDir)).rejects.toBeTruthy();
  });

  it("creates the backups directory private to this user", async () => {
    const { db, backupsDir } = await seeded();
    await exportPortableBackup({
      sqlite: db,
      backupsDir,
      appVersion: "1.4.0",
      passphrase: PASSPHRASE,
    });

    // 0700. The default umask left the folder that holds the whole books
    // readable by every account on a shared shop PC.
    expect((await stat(backupsDir)).mode & 0o777).toBe(0o700);
  });
});
