import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { create as tarCreate } from "tar";
import { createArchive, extractArchive, DB_ENTRY_NAME, MANIFEST_ENTRY_NAME } from "./archive.js";
import { ArchiveContentsError } from "./errors.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmpDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "mezan-archive-"));
  dirs.push(d);
  return d;
}

describe("createArchive / extractArchive", () => {
  it("round-trips the db file and manifest byte-for-byte", async () => {
    const dir = await tmpDir();
    const dbFilePath = path.join(dir, "source.sqlite");
    const dbBytes = Buffer.from("fake sqlite bytes — not a real db, just fixture content");
    await writeFile(dbFilePath, dbBytes);

    const manifestJson = JSON.stringify({ hello: "manifest" }, null, 2);
    const outputPath = path.join(dir, "backup.mezanbak");

    await createArchive({ dbFilePath, manifestJson, outputPath });

    const destDir = path.join(dir, "extracted");
    const extracted = await extractArchive(outputPath, destDir);

    expect(extracted.manifestJson).toBe(manifestJson);
    const extractedDbBytes = await readFile(extracted.dbFilePath);
    expect(extractedDbBytes.equals(dbBytes)).toBe(true);
    expect(path.basename(extracted.dbFilePath)).toBe(DB_ENTRY_NAME);
  });

  it("includes optional extra files (forward-compat for license/settings/attachments)", async () => {
    const dir = await tmpDir();
    const dbFilePath = path.join(dir, "source.sqlite");
    await writeFile(dbFilePath, "db");
    const licensePath = path.join(dir, "license.txt");
    await writeFile(licensePath, "LICENSE-CONTENT");

    const outputPath = path.join(dir, "backup.mezanbak");
    await createArchive({
      dbFilePath,
      manifestJson: "{}",
      outputPath,
      extraFiles: [{ sourcePath: licensePath, archiveName: "license.txt" }],
    });

    const destDir = path.join(dir, "extracted");
    await extractArchive(outputPath, destDir);
    const extractedLicense = await readFile(path.join(destDir, "license.txt"), "utf8");
    expect(extractedLicense).toBe("LICENSE-CONTENT");
  });

  it("throws ArchiveContentsError when the manifest is missing from the archive", async () => {
    const dir = await tmpDir();
    // Build an archive by hand that only contains a stray file, not our
    // fixed db.sqlite/manifest.json members.
    const { create } = await import("tar");
    const stray = path.join(dir, "stray.txt");
    await writeFile(stray, "nope");
    const outputPath = path.join(dir, "broken.mezanbak");
    await create({ gzip: true, file: outputPath, cwd: dir }, ["stray.txt"]);

    await expect(extractArchive(outputPath, path.join(dir, "out"))).rejects.toThrow(
      ArchiveContentsError,
    );
  });

  it(`throws ArchiveContentsError when only ${MANIFEST_ENTRY_NAME} is present`, async () => {
    const dir = await tmpDir();
    const { create } = await import("tar");
    await writeFile(path.join(dir, MANIFEST_ENTRY_NAME), "{}");
    const outputPath = path.join(dir, "broken.mezanbak");
    await create({ gzip: true, file: outputPath, cwd: dir }, [MANIFEST_ENTRY_NAME]);

    await expect(extractArchive(outputPath, path.join(dir, "out"))).rejects.toThrow(
      ArchiveContentsError,
    );
  });
});

describe("extractArchive — a hostile archive", () => {
  /**
   * A backup file is attacker-influenced input at restore time: it travels on a
   * USB stick or a network share, and the operator is told to trust it. These
   * tests pack archives by hand rather than through `createArchive`, because
   * the question is what the EXTRACTOR does with a file it did not write.
   */
  async function packRaw(dir: string, entries: readonly { name: string; body: string }[]): Promise<string> {
    const staging = path.join(dir, "hostile-staging");
    await mkdir(staging, { recursive: true });
    const members: string[] = [];
    for (const entry of entries) {
      const target = path.join(staging, entry.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.body, "utf8");
      members.push(entry.name);
    }
    const archivePath = path.join(dir, "hostile.mezanbak");
    await tarCreate({ gzip: true, file: archivePath, cwd: staging, portable: true }, members);
    return archivePath;
  }

  it("does not write outside the destination when an entry name climbs out of it", async () => {
    const dir = await tmpDir();
    const outside = path.join(dir, "outside");
    await mkdir(outside, { recursive: true });

    // The entry is named so that a naive extractor would drop it in the
    // PARENT of destDir — the classic tar-slip.
    const archivePath = await packRaw(dir, [
      { name: MANIFEST_ENTRY_NAME, body: "{}" },
      { name: DB_ENTRY_NAME, body: "not a database" },
      { name: "../outside/planted.txt", body: "written outside the restore directory" },
    ]);

    // Packing the archive necessarily wrote the file at that relative path on
    // the way in; remove it, so what the check below sees can only have come
    // from the EXTRACTION.
    await rm(path.join(outside, "planted.txt"), { force: true });
    expect(await readFile(path.join(outside, "planted.txt"), "utf8").catch(() => null)).toBeNull();

    const destDir = path.join(dir, "restore");
    await extractArchive(archivePath, destDir).catch(() => undefined);

    // Whatever the extractor decides to do with the entry, the one thing it
    // must never do is write it back out here.
    const planted = await readFile(path.join(outside, "planted.txt"), "utf8").catch(() => null);
    expect(planted).toBeNull();
  });

  it("does not follow an absolute entry name to the filesystem root", async () => {
    const dir = await tmpDir();
    const archivePath = await packRaw(dir, [
      { name: MANIFEST_ENTRY_NAME, body: "{}" },
      { name: DB_ENTRY_NAME, body: "not a database" },
    ]);

    const destDir = path.join(dir, "restore");
    await extractArchive(archivePath, destDir).catch(() => undefined);

    // Everything the extraction produced stays under destDir.
    const written = await readdir(destDir).catch(() => [] as string[]);
    for (const name of written) expect(path.resolve(destDir, name).startsWith(path.resolve(destDir))).toBe(true);
  });

  it("refuses an archive with no database inside it, rather than restoring an empty tenant", async () => {
    const dir = await tmpDir();
    const archivePath = await packRaw(dir, [{ name: MANIFEST_ENTRY_NAME, body: "{}" }]);

    await expect(extractArchive(archivePath, path.join(dir, "restore"))).rejects.toBeTruthy();
  });

  it("refuses an archive with no manifest, which is the only record of what it holds", async () => {
    const dir = await tmpDir();
    const archivePath = await packRaw(dir, [{ name: DB_ENTRY_NAME, body: "not a database" }]);

    await expect(extractArchive(archivePath, path.join(dir, "restore"))).rejects.toBeTruthy();
  });

  it("clears the destination first, so a restore cannot inherit a previous one's files", async () => {
    const dir = await tmpDir();
    const destDir = path.join(dir, "restore");
    await mkdir(destDir, { recursive: true });
    await writeFile(path.join(destDir, "leftover.txt"), "from an earlier restore", "utf8");

    const archivePath = await packRaw(dir, [
      { name: MANIFEST_ENTRY_NAME, body: "{}" },
      { name: DB_ENTRY_NAME, body: "not a database" },
    ]);
    await extractArchive(archivePath, destDir);

    expect(await readFile(path.join(destDir, "leftover.txt"), "utf8").catch(() => null)).toBeNull();
  });
});
