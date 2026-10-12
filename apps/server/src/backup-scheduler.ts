import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlatformHandle } from "@mezan/backend";
import { TenantStatusCode, type Tenant } from "@mezan/domain";
import type { TenantRouter } from "./tenant-router.js";
import {
  appendVerifyRecord,
  BackupVerifyOutcome,
  VERIFY_LOG_FILE_NAME,
  type BackupVerifyRecord,
} from "./backup-verify-core.js";
import type { VerifyWorkerRequest, VerifyWorkerResponse } from "./backup-verify-worker.js";

export { BackupVerifyOutcome, VERIFY_LOG_FILE_NAME, type BackupVerifyRecord };

const DEFAULT_KEEP = 12;

// A literal filesystem path for `fork()`, not an ESM import specifier — the
// `.ts` extension is deliberate (see the `execArgv` note below): unlike an
// `import "./x.js"` this is never rewritten to the sibling `.ts` source.
const VERIFY_WORKER_PATH = fileURLToPath(new URL("./backup-verify-worker.ts", import.meta.url));

function failedRecord(backupPath: string, now: Date, report: string): BackupVerifyRecord {
  return { at: now.toISOString(), file: path.basename(backupPath), outcome: BackupVerifyOutcome.Failed, ms: 0, report };
}

/**
 * Runs `PRAGMA integrity_check` on a copy of `backupPath` in a forked child
 * process instead of the server's main thread (docs/artifacts/audit-2026-09-07.md
 * Q-2's cloud twin) — a full page scan of a multi-GB tenant database can take
 * seconds, and until this moved, that ran on the SAME event loop `hono`
 * serves every tenant's HTTP request on, so one backup cycle stalled every
 * request in flight.
 *
 * A `worker_threads.Worker` was tried first and rejected: tsx's module hooks
 * register on the worker's OWN entry file but do not reliably extend to that
 * file's nested imports (confirmed by hand), so `verifyBackupFile`'s own
 * `@mezan/persistence` import failed to resolve inside a Worker while
 * resolving correctly inside a forked process. `execArgv` is explicit rather
 * than inherited from the parent — which may be `tsx` (`pnpm exec tsx`),
 * plain `node` (a future compiled build) or vitest's own worker pool — so
 * `--import tsx` boots the same loader `tsx`'s own CLI uses regardless of how
 * the server process itself was started.
 *
 * A child that never reports back (crash, killed process) resolves to a
 * FAILED record rather than rejecting: `runBackups` must still see this
 * backup as unverified and move on to the next tenant, exactly as a normal
 * integrity-check failure does. The record is appended to the SAME
 * `verify.jsonl` `verifyBackupFile` itself writes to, even on that crash
 * path, so a child that dies before writing anything is still reported —
 * "failed to even run" is not silence.
 */
function runVerifyOffThread(backupPath: string, now: Date): Promise<BackupVerifyRecord> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess;
    try {
      child = fork(VERIFY_WORKER_PATH, [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    } catch (err) {
      resolve(failedRecordAndLog(backupPath, now, err instanceof Error ? err.message : String(err)));
      return;
    }

    const finish = (record: BackupVerifyRecord) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(record);
    };

    child.once("message", (msg: VerifyWorkerResponse) => {
      finish(msg.ok ? msg.record : failedRecordAndLog(backupPath, now, msg.error));
    });
    child.once("error", (err) => {
      finish(failedRecordAndLog(backupPath, now, err instanceof Error ? err.message : String(err)));
    });
    child.once("exit", (code) => {
      if (code !== 0 && code !== null) finish(failedRecordAndLog(backupPath, now, `backup verify worker exited with code ${code}`));
    });

    const request: VerifyWorkerRequest = { backupPath, now: now.toISOString() };
    child.send(request);
  });
}

function failedRecordAndLog(backupPath: string, now: Date, report: string): BackupVerifyRecord {
  const record = failedRecord(backupPath, now, report);
  try {
    appendVerifyRecord(record, backupPath);
  } catch (err) {
    console.error("[backup] could not append the verify log after an off-thread failure", err);
  }
  return record;
}

export interface RunBackupsOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  /** The platform data directory — backups land under `<dir>/backups/…`. */
  readonly dir: string;
  readonly now?: () => Date;
  /** How many backups to keep per folder, newest first. Defaults to 12. */
  readonly keep?: number;
}

function isoSafeTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-");
}

/**
 * Writes one backup into `folder` at `<stamp>.sqlite`, via a `.tmp` sibling
 * renamed into place on success — a crash mid-copy leaves only a stray `.tmp`
 * file behind, never a truncated file at the name a restore would pick up.
 */
async function writeOneBackup(
  backupTo: (destination: string) => Promise<void>,
  folder: string,
  stamp: string,
): Promise<string> {
  mkdirSync(folder, { recursive: true });
  const finalPath = path.join(folder, `${stamp}.sqlite`);
  const tmpPath = `${finalPath}.tmp`;
  await backupTo(tmpPath);
  renameSync(tmpPath, finalPath);
  return finalPath;
}

const PLATFORM_BACKUP_FOLDER = "platform";
const TENANT_BACKUPS_FOLDER = "tenants";

// SECURITY: a tenant's backups are filed by tenant id, under their own parent
// folder. A code is reused once its tenant is released, and a code could spell
// the platform's own folder; an id does neither.
export function tenantBackupFolder(dir: string, tenantId: string): string {
  return path.join(dir, "backups", TENANT_BACKUPS_FOLDER, tenantId);
}

function stampOf(date: string): string {
  return isoSafeTimestamp(new Date(date));
}

// REQUIRED ORDERING: only a backup stamped at or after the tenant was created
// is moved, and never over a file already there. Anything older was written
// for an earlier holder of the same code and stays exactly where it is.
function adoptLegacyBackups(dir: string, tenant: Tenant): void {
  const legacy = path.join(dir, "backups", tenant.code);
  if (tenant.code === PLATFORM_BACKUP_FOLDER || tenant.code === TENANT_BACKUPS_FOLDER || !existsSync(legacy)) return;
  const folder = tenantBackupFolder(dir, tenant.id);
  const earliest = `${stampOf(tenant.createdAt)}.sqlite`;
  for (const file of readdirSync(legacy)) {
    if (!file.endsWith(".sqlite") || file < earliest || existsSync(path.join(folder, file))) continue;
    mkdirSync(folder, { recursive: true });
    renameSync(path.join(legacy, file), path.join(folder, file));
  }
}

/** Deletes every backup in `folder` older than the newest `keep` (by filename, which sorts with the timestamp). */
function pruneOldBackups(folder: string, keep: number): void {
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".sqlite"))
    .sort();
  const excess = files.length - keep;
  for (let i = 0; i < excess; i += 1) {
    rmSync(path.join(folder, files[i]!));
  }
}

/**
 * Snapshots the platform database and every currently OPEN tenant backend
 * (task C2 — docs/superpowers/plans/2026-09-14-saas-slice-c-deploy.md). A
 * tenant whose backend is idle-evicted or never opened is deliberately
 * skipped: its file is at rest on disk, not being written to, so a filesystem-
 * level backup covers it — running the in-app backup would only cost an
 * `open` this sweep has no other reason to make.
 */
export async function runBackups(options: RunBackupsOptions): Promise<void> {
  const now = options.now ?? (() => new Date());
  const keep = options.keep ?? DEFAULT_KEEP;
  const stamp = isoSafeTimestamp(now());

  const failures: string[] = [];
  const verify = async (file: string): Promise<void> => {
    const record = await runVerifyOffThread(file, now());
    if (record.outcome !== BackupVerifyOutcome.Ok) failures.push(`${file}: ${record.report}`);
  };

  const platformFolder = path.join(options.dir, "backups", PLATFORM_BACKUP_FOLDER);
  await verify(await writeOneBackup((destination) => options.platform.backupTo(destination), platformFolder, stamp));
  pruneOldBackups(platformFolder, keep);

  for (const open of options.router.openTenants()) {
    const tenant = await options.platform.stores.tenants.findById(open.id);
    if (!tenant || tenant.status === TenantStatusCode.Archived) continue;
    const backend = await options.router.backendFor(tenant.code);
    const folder = tenantBackupFolder(options.dir, tenant.id);
    adoptLegacyBackups(options.dir, tenant);
    await verify(await writeOneBackup((destination) => backend.backupTo(destination), folder, stamp));
    pruneOldBackups(folder, keep);
  }

  if (failures.length > 0) {
    throw new Error(`backup verification failed: ${failures.join(" | ")}`);
  }
}

export interface StartBackupTimerOptions extends RunBackupsOptions {
  readonly intervalMs: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Runs `runBackups` immediately, then again on every `intervalMs` tick,
 * `unref`d so an idle process can still exit. Matches the shape
 * `apps/server/src/cloud-app.ts`'s `options.backups.start()` seam expects.
 * The returned `stop` resolves once any in-flight run has settled, so
 * callers (and tests) can know no further writes are coming.
 */
export function startBackupTimer(options: StartBackupTimerOptions): () => Promise<void> {
  let current: Promise<void> = Promise.resolve();
  const run = () => {
    current = runBackups(options).catch((error: unknown) => options.onError?.(error));
  };
  run();

  const timer = setInterval(run, options.intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    return current;
  };
}

export interface BackupScheduler {
  start(): () => Promise<void>;
}

/** Wraps `startBackupTimer` in the `{ start(): () => void }` shape `createCloudApp`'s `options.backups` seam is typed as. */
export function createBackupScheduler(options: StartBackupTimerOptions): BackupScheduler {
  return {
    start: () => startBackupTimer(options),
  };
}
