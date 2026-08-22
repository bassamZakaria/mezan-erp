import { create as tarCreate, extract as tarExtract } from "tar";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveContentsError } from "./errors.js";

/** Fixed member names inside every archive — see createArchive() below. */
export const DB_ENTRY_NAME = "db.sqlite";
export const MANIFEST_ENTRY_NAME = "manifest.json";

export interface ArchiveExtraFile {
  /** Absolute path to the source file on disk. */
  readonly sourcePath: string;
  /** Name to store it under inside the archive. */
  readonly archiveName: string;
}

/**
 * Packages the backed-up database file + manifest.json (+ optional extra
 * files — license/settings/attachments, none of which exist as real
 * desktop features yet, so this stays an opt-in empty array today) into one
 * gzip'd tar archive at `outputPath`.
 *
 * Uses `tar` (pure JS, no native module) rather than a raw file copy — an
 * archive format keeps this forward-compatible with the "database +
 * attachment files + license + settings" contents docs/plan.md §3.7 asks
 * for, without redesigning the container when those features land.
 */
export async function createArchive(params: {
  dbFilePath: string;
  manifestJson: string;
  outputPath: string;
  extraFiles?: readonly ArchiveExtraFile[];
}): Promise<void> {
  const { dbFilePath, manifestJson, outputPath, extraFiles = [] } = params;
  const stagingDir = `${outputPath}.staging`;
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  try {
    await copyFile(dbFilePath, path.join(stagingDir, DB_ENTRY_NAME));
    await writeFile(path.join(stagingDir, MANIFEST_ENTRY_NAME), manifestJson, "utf8");

    const members = [MANIFEST_ENTRY_NAME, DB_ENTRY_NAME];
    for (const extra of extraFiles) {
      await copyFile(extra.sourcePath, path.join(stagingDir, extra.archiveName));
      members.push(extra.archiveName);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await tarCreate({ gzip: true, file: outputPath, cwd: stagingDir, portable: true }, members);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export interface ExtractedArchive {
  readonly dbFilePath: string;
  readonly manifestJson: string;
  readonly destDir: string;
}

/** Extracts an archive built by createArchive() into `destDir`. */
export async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<ExtractedArchive> {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  await tarExtract({ file: archivePath, cwd: destDir });

  const dbFilePath = path.join(destDir, DB_ENTRY_NAME);
  const manifestPath = path.join(destDir, MANIFEST_ENTRY_NAME);

  let manifestJson: string;
  try {
    manifestJson = await readFile(manifestPath, "utf8");
  } catch {
    throw new ArchiveContentsError(`missing ${MANIFEST_ENTRY_NAME}`);
  }

  try {
    await readFile(dbFilePath);
  } catch {
    throw new ArchiveContentsError(`missing ${DB_ENTRY_NAME}`);
  }

  return { dbFilePath, manifestJson, destDir };
}
