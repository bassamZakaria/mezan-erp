import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { listBackups } from "./backup-service.js";
import { applyRetention, DEFAULT_RETENTION_POLICY } from "./retention.js";

const SETTINGS_FILE_NAME = ".backup-target.json";

export interface SecondTargetState {
  readonly dir: string | null;
  readonly lastCopyAt: string | null;
  readonly lastCopyOk: boolean | null;
  readonly lastCopyFile: string | null;
  readonly lastCopyError: string | null;
  /**
   * Filenames THIS machine copied into `dir` that retention has not yet
   * removed — stored locally, beside `backupsDir` (never inside the shared
   * `dir` itself), so it never travels to another machine. A second target is
   * commonly a network share or a USB stick several machines write to; without
   * this ledger, retention would enumerate every `.sqlite` file it finds there
   * and prune by GFS bucket across ALL of them, deleting a sibling machine's
   * still-needed backups. Retention only ever touches a file whose name is in
   * this list — a file it did not write is invisible to it.
   */
  readonly ownFiles: readonly string[];
}

const EMPTY: SecondTargetState = {
  dir: null,
  lastCopyAt: null,
  lastCopyOk: null,
  lastCopyFile: null,
  lastCopyError: null,
  ownFiles: [],
};

function settingsPath(backupsDir: string): string {
  return path.join(backupsDir, SETTINGS_FILE_NAME);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function readSecondTarget(backupsDir: string): Promise<SecondTargetState> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(backupsDir), "utf8")) as Record<string, unknown>;
    return {
      dir: asString(raw["dir"]),
      lastCopyAt: asString(raw["lastCopyAt"]),
      lastCopyOk: typeof raw["lastCopyOk"] === "boolean" ? raw["lastCopyOk"] : null,
      lastCopyFile: asString(raw["lastCopyFile"]),
      lastCopyError: asString(raw["lastCopyError"]),
      ownFiles: asStringArray(raw["ownFiles"]),
    };
  } catch {
    return EMPTY;
  }
}

async function writeSecondTarget(backupsDir: string, state: SecondTargetState): Promise<void> {
  await mkdir(backupsDir, { recursive: true, mode: 0o700 });
  await writeFile(settingsPath(backupsDir), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export async function setSecondTargetDir(backupsDir: string, dir: string | null): Promise<SecondTargetState> {
  if (dir !== null && path.resolve(dir) === path.resolve(backupsDir)) {
    throw new Error("The second target cannot be the backups folder itself.");
  }
  const next: SecondTargetState = dir === null ? EMPTY : { ...EMPTY, dir: path.resolve(dir) };
  await writeSecondTarget(backupsDir, next);
  return next;
}

/**
 * Copies one sealed archive to the operator's second folder (a USB stick or a
 * share) and prunes THIS MACHINE'S OWN files there with the same GFS policy —
 * never a file another machine wrote, even if it sits in the same folder (see
 * {@link SecondTargetState.ownFiles}). Never throws: a missing stick must not
 * fail the backup it follows. The outcome is kept so the screen can say the
 * last copy failed instead of letting a silent gap grow.
 */
export async function copyToSecondTarget(backupsDir: string, archivePath: string, now = new Date()): Promise<SecondTargetState> {
  const current = await readSecondTarget(backupsDir);
  if (!current.dir) return current;
  const fileName = path.basename(archivePath);
  const target = path.join(current.dir, fileName);
  const partial = `${target}.partial`;
  let next: SecondTargetState;
  try {
    const dirStat = await stat(current.dir);
    if (!dirStat.isDirectory()) throw new Error(`${current.dir} is not a folder`);
    await copyFile(archivePath, partial);
    const [source, copied] = await Promise.all([stat(archivePath), stat(partial)]);
    if (source.size !== copied.size) {
      throw new Error(`copied ${copied.size} of ${source.size} bytes`);
    }
    await rename(partial, target);
    const ownAfterCopy = new Set([...current.ownFiles, fileName]);
    const existing = await listBackups(current.dir);
    const ownCandidates = existing.filter((b) => ownAfterCopy.has(path.basename(b.path)));
    const { remove, keep } = applyRetention(
      ownCandidates.map((b) => ({ id: b.path, createdAt: b.createdAt })),
      DEFAULT_RETENTION_POLICY,
    );
    for (const r of remove) await rm(r.id, { force: true });
    const survivingOwnFiles = keep.map((k) => path.basename(k.id));
    next = {
      ...current,
      ownFiles: survivingOwnFiles,
      lastCopyAt: now.toISOString(),
      lastCopyOk: true,
      lastCopyFile: fileName,
      lastCopyError: null,
    };
  } catch (err) {
    await rm(partial, { force: true }).catch(() => undefined);
    next = {
      ...current,
      lastCopyAt: now.toISOString(),
      lastCopyOk: false,
      lastCopyFile: fileName,
      lastCopyError: err instanceof Error ? err.message : String(err),
    };
    console.error(`[backup] copy to the second target ${current.dir} failed`, err);
  }
  await writeSecondTarget(backupsDir, next).catch((err: unknown) =>
    console.error("[backup] could not record the second-target copy", err),
  );
  return next;
}
