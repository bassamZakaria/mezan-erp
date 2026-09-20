import { verifyBackupFile, type BackupVerifyRecord } from "./backup-verify-core.js";

/**
 * The forked-process entry point `runVerifyOffThread` (backup-scheduler.ts)
 * spawns one of per backup file — never imported for its exports, only run as
 * a `child_process.fork()` script. A real process rather than a
 * `worker_threads.Worker`: tsx's module hooks (`--import tsx`) register
 * cleanly on a freshly-started process but do not reliably reach a Worker
 * thread's OWN nested imports (confirmed by hand — `verifyBackupFile`'s own
 * `import { openSqliteConnection } from "@mezan/persistence"` resolved under
 * `fork()` and failed under `Worker`), so a fork is the one primitive proven
 * to run this file's real import graph off the main thread.
 *
 * Kept to exactly this job: read the message, verify, report the result back,
 * exit — so a crash here never carries a live tenant connection or anything
 * else that cannot cross a process boundary.
 */

export interface VerifyWorkerRequest {
  readonly backupPath: string;
  readonly now: string;
}

export type VerifyWorkerResponse = { readonly ok: true; readonly record: BackupVerifyRecord } | { readonly ok: false; readonly error: string };

if (process.send) {
  process.once("message", (msg: VerifyWorkerRequest) => {
    verifyBackupFile(msg.backupPath, new Date(msg.now))
      .then((record) => ({ ok: true, record }) satisfies VerifyWorkerResponse)
      .catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }) satisfies VerifyWorkerResponse)
      .then((response) => {
        process.send?.(response, () => process.exit(0));
      });
  });
}
