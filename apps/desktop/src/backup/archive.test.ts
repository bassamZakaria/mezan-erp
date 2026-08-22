import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
