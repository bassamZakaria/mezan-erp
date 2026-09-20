import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupFileName } from "./backup-service.js";
import { copyToSecondTarget, readSecondTarget, setSecondTargetDir } from "./secondary-target.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Writes a real, correctly-named archive (so retention's date bucketing works) and returns its path. */
async function writeArchive(dir: string, createdAt: Date): Promise<string> {
  const file = path.join(dir, backupFileName(createdAt));
  await mkdir(dir, { recursive: true });
  await writeFile(file, "sqlite-bytes");
  return file;
}

/**
 * A run long enough that `applyRetention`'s GFS tiers (daily 7 / weekly 4 /
 * monthly 12) are guaranteed to actually remove SOMETHING — the exact count
 * retention keeps for a run of consecutive daily backups is that function's
 * own concern (`retention.test.ts`), not this file's. What THIS file proves
 * is narrower and unconditional: whatever gets removed is never a file this
 * machine did not itself write.
 */
const RUN_DAYS = 60;

describe("copyToSecondTarget — per-machine retention scoping", () => {
  it("never deletes a file this machine did not itself copy there, even once retention starts removing its own", async () => {
    const backupsDirA = await tempDir("mezan-second-target-a-");
    const sharedTarget = await tempDir("mezan-second-target-shared-");

    // A file that lives in the shared folder but was never recorded as this
    // machine's own — standing in for a sibling machine's backup, or any file
    // that predates the own-files ledger.
    const foreignFile = path.join(sharedTarget, "mezan-backup-2020-01-01T00-00-00-000Z.sqlite");
    await writeFile(foreignFile, "someone else's backup");

    await setSecondTargetDir(backupsDirA, sharedTarget);

    const base = new Date("2026-01-01T00:00:00.000Z");
    let lastState = await readSecondTarget(backupsDirA);
    for (let day = 0; day < RUN_DAYS; day += 1) {
      const createdAt = new Date(base.getTime() + day * 24 * 60 * 60 * 1000);
      const archive = await writeArchive(await tempDir("mezan-source-"), createdAt);
      lastState = await copyToSecondTarget(backupsDirA, archive, createdAt);
    }

    // Sanity: retention actually pruned something over 60 daily copies —
    // otherwise this test would trivially pass without exercising the fix.
    expect(lastState.ownFiles.length).toBeLessThan(RUN_DAYS);

    const filesLeft = await readdir(sharedTarget);
    expect(filesLeft).toContain(path.basename(foreignFile));
    // Every file this machine still claims as its own is physically present,
    // and nothing else survives besides the foreign file.
    for (const f of lastState.ownFiles) expect(filesLeft).toContain(f);
    expect(filesLeft).toHaveLength(lastState.ownFiles.length + 1);
  });

  it("two machines sharing one folder each prune only their own files", async () => {
    const backupsDirA = await tempDir("mezan-second-target-a-");
    const backupsDirB = await tempDir("mezan-second-target-b-");
    const sharedTarget = await tempDir("mezan-second-target-shared-");

    await setSecondTargetDir(backupsDirA, sharedTarget);
    await setSecondTargetDir(backupsDirB, sharedTarget);

    const base = new Date("2026-01-01T00:00:00.000Z");
    let stateA = await readSecondTarget(backupsDirA);
    let stateB = await readSecondTarget(backupsDirB);
    for (let day = 0; day < RUN_DAYS; day += 1) {
      const createdAt = new Date(base.getTime() + day * 24 * 60 * 60 * 1000);
      const archiveA = await writeArchive(await tempDir("mezan-source-a-"), createdAt);
      stateA = await copyToSecondTarget(backupsDirA, archiveA, createdAt);
      // Machine B backs up a little later in the day so its filename never
      // collides with A's.
      const createdAtB = new Date(createdAt.getTime() + 60_000);
      const archiveB = await writeArchive(await tempDir("mezan-source-b-"), createdAtB);
      stateB = await copyToSecondTarget(backupsDirB, archiveB, createdAtB);
    }

    // Sanity: both machines' retention actually pruned something.
    expect(stateA.ownFiles.length).toBeLessThan(RUN_DAYS);
    expect(stateB.ownFiles.length).toBeLessThan(RUN_DAYS);

    const filesLeft = await readdir(sharedTarget);
    // Both machines' surviving files must still be physically present —
    // neither machine's retention run deleted the other's.
    for (const f of stateA.ownFiles) expect(filesLeft).toContain(f);
    for (const f of stateB.ownFiles) expect(filesLeft).toContain(f);
    expect(filesLeft).toHaveLength(stateA.ownFiles.length + stateB.ownFiles.length);
  });
});
