import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { listBackups, resolveWorkerEntry } from "./backup-service.js";
import { withBackupLock } from "./backup-lock.js";
import { DRILL_WORKER_FLAG } from "./worker-flags.js";
import type { DrillWorkerJob, DrillWorkerResult } from "./drill-worker.js";
import { DrillCheck, DrillOutcome, DrillTrigger, type DrillRecordDTO } from "../shared/ipc-contract.js";

export const DRILLS_FILE_NAME = "drills.jsonl";
export const DRILL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const DRILL_STALE_AFTER_DAYS = 8;
const DRILL_TIMEOUT_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 50;

interface RunningDrill {
  promise: Promise<DrillRecordDTO>;
  child: ChildProcess | null;
  aborted: boolean;
}

let running: RunningDrill | null = null;

export function isDrillRunning(): boolean {
  return running !== null;
}

export function abortDrill(): void {
  if (!running) return;
  running.aborted = true;
  running.child?.kill();
}

function drillsFile(backupsDir: string): string {
  return path.join(backupsDir, DRILLS_FILE_NAME);
}

function parseRecord(line: string): DrillRecordDTO | null {
  try {
    const value = JSON.parse(line) as DrillRecordDTO;
    if (typeof value?.id !== "string" || typeof value.startedAt !== "string") return null;
    if (!Object.values(DrillOutcome).includes(value.outcome)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function readDrillHistory(backupsDir: string, limit = HISTORY_LIMIT): Promise<DrillRecordDTO[]> {
  let raw: string;
  try {
    raw = await readFile(drillsFile(backupsDir), "utf8");
  } catch {
    return [];
  }
  const records = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseRecord)
    .filter((r): r is DrillRecordDTO => r !== null);
  records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return records.slice(0, limit);
}

/**
 * Removes drill sandboxes and portable-import scratch left by a run the process
 * died in. An import's scratch holds a DECRYPTED archive — the books in the
 * clear — so it must not outlive a crash. Only safe before anything else in
 * this process has started a drill or an import.
 */
export async function sweepBackupScratch(backupsDir: string): Promise<void> {
  const tmpRoot = path.join(backupsDir, ".tmp");
  let entries: string[];
  try {
    entries = await readdir(tmpRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith("drill-") || entry.startsWith("import-")) {
      await rm(path.join(tmpRoot, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function hasArchive(backupsDir: string): Promise<boolean> {
  return (await listBackups(backupsDir)).length > 0;
}

export function lastGoodDrill(history: readonly DrillRecordDTO[]): DrillRecordDTO | null {
  return history.find((r) => r.outcome !== DrillOutcome.Fail) ?? null;
}

export async function isDrillDue(backupsDir: string, now = new Date()): Promise<boolean> {
  const latest = (await readDrillHistory(backupsDir, 1))[0];
  if (!latest) return true;
  const at = new Date(latest.startedAt).getTime();
  return Number.isNaN(at) || now.getTime() - at >= DRILL_INTERVAL_MS;
}

function spawnDrillWorker(job: DrillWorkerJob, onChild: (child: ChildProcess) => void): Promise<DrillWorkerResult> {
  const { modulePath, execArgv } = resolveWorkerEntry("drill-worker");
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(modulePath, [DRILL_WORKER_FLAG], { execArgv });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    onChild(child);
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`the drill did not finish within ${DRILL_TIMEOUT_MS / 60000} minutes`)), DRILL_TIMEOUT_MS);
    timer.unref();
    function finish(outcome: DrillWorkerResult | Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      child.kill();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    }
    child.once("message", (message: DrillWorkerResult) => finish(message));
    child.once("error", (err) => finish(err));
    child.once("exit", (code, signal) =>
      finish(new Error(`the drill worker exited (code ${code}, signal ${signal}) before reporting a result`)),
    );
    child.send(job);
  });
}

function failedRecord(base: Omit<DrillRecordDTO, "outcome" | "failedCheck" | "detail" | "durationMs">, started: number, check: DrillCheck, detail: string): DrillRecordDTO {
  return { ...base, outcome: DrillOutcome.Fail, failedCheck: check, detail, durationMs: Date.now() - started };
}

async function performDrill(params: {
  backupsDir: string;
  cipherKey: string | null;
  appSchemaVersion: number;
  trigger: DrillTrigger;
  onChild: (child: ChildProcess) => void;
}): Promise<DrillRecordDTO> {
  const started = Date.now();
  const base = {
    id: randomUUID(),
    trigger: params.trigger,
    startedAt: new Date(started).toISOString(),
    archive: null as string | null,
    archiveCreatedAt: null,
    archiveBytes: null as number | null,
    schemaVersion: null,
    tables: null,
    rows: null,
    rowMismatches: [],
    invariants: null,
    steps: [],
  };

  const tmpRoot = path.join(params.backupsDir, ".tmp");
  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const sandboxDir = await mkdtemp(path.join(tmpRoot, "drill-"));
  try {
    const picked = await withBackupLock(async () => {
      const archives = await listBackups(params.backupsDir);
      archives.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const newest = archives[0];
      if (!newest) return null;
      const copy = path.join(sandboxDir, path.basename(newest.path));
      await copyFile(newest.path, copy);
      return { name: path.basename(newest.path), copy, bytes: (await stat(copy)).size };
    });
    if (!picked) {
      return failedRecord(base, started, DrillCheck.NoArchive, "there is no archive in the backups folder to drill");
    }
    base.archive = picked.name;
    base.archiveBytes = picked.bytes;

    let result: DrillWorkerResult;
    try {
      result = await spawnDrillWorker(
        {
          archivePath: picked.copy,
          sandboxDir,
          cipherKey: params.cipherKey,
          appSchemaVersion: params.appSchemaVersion,
        },
        params.onChild,
      );
    } catch (err) {
      return failedRecord(base, started, DrillCheck.Crashed, err instanceof Error ? err.message : String(err));
    }
    return { ...base, ...result, durationMs: Date.now() - started };
  } finally {
    await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function runRestoreDrill(params: {
  backupsDir: string;
  cipherKey: string | null;
  appSchemaVersion: number;
  trigger: DrillTrigger;
}): Promise<DrillRecordDTO> {
  if (running) return running.promise;
  const slot: RunningDrill = {
    promise: Promise.resolve(null as unknown as DrillRecordDTO),
    child: null,
    aborted: false,
  };
  slot.promise = (async () => {
    try {
      const record = await performDrill({ ...params, onChild: (child) => (slot.child = child) });
      if (slot.aborted) return record;
      await mkdir(params.backupsDir, { recursive: true, mode: 0o700 });
      await appendFile(drillsFile(params.backupsDir), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      const tag = record.outcome === DrillOutcome.Fail ? `FAILED at ${record.failedCheck}` : record.outcome;
      console.log(`[backup] restore drill ${tag} on ${record.archive ?? "no archive"} in ${record.durationMs}ms`);
      return record;
    } finally {
      running = null;
    }
  })();
  running = slot;
  return slot.promise;
}
