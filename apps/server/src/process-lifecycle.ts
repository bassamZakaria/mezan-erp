import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LogEvent, createLogger, flushLogs } from "@mezan/api";
import { AlertKind, type Alerter } from "./alerter.js";

const RUNNING_MARKER = "mezan-running.json";
const SHUTDOWN_BUDGET_MS = 10_000;
const UNCAUGHT_EXIT_CODE = 1;

const log = createLogger("process");

export interface RunningMarker {
  readonly previous: { readonly startedAt?: string; readonly pid?: number } | null;
  clear(): void;
}

/**
 * A file that exists exactly while the server runs. Found at boot, it means the previous run
 * never reached its clean shutdown: a crash, an OOM kill, or a host that lost power.
 */
export function markRunning(dir: string, now: () => Date = () => new Date()): RunningMarker {
  const file = path.join(dir, RUNNING_MARKER);
  let previous: RunningMarker["previous"] = null;
  if (existsSync(file)) {
    try {
      previous = JSON.parse(readFileSync(file, "utf8")) as RunningMarker["previous"];
    } catch {
      previous = {};
    }
  }
  writeFileSync(file, JSON.stringify({ startedAt: now().toISOString(), pid: process.pid }), { mode: 0o600 });
  return { previous, clear: () => rmSync(file, { force: true }) };
}

export interface ProcessHandlersOptions {
  readonly alerter: Alerter;
  readonly marker: RunningMarker;
  readonly close: () => Promise<void>;
}

/**
 * `uncaughtException` leaves the process in an unknown state, so it is logged as fatal and the
 * process exits non-zero for Docker's restart policy to bring up a clean one; the running marker
 * is left in place so that boot mails the unclean-exit alert.
 *
 * `unhandledRejection` does NOT exit. One process serves every tenant, and every route already
 * answers its own failures through `onError`; a rejection that reaches here is a background
 * promise someone forgot to catch, and taking every tenant offline for it is the worse outcome.
 * It is logged at error and alerted instead, so it gets fixed.
 */
export function installProcessHandlers(options: ProcessHandlersOptions): void {
  process.on("uncaughtException", (err) => {
    try {
      log.fatal({ event: LogEvent.ProcessUncaughtException, err }, "uncaught exception; exiting for a clean restart");
      flushLogs();
    } finally {
      process.exit(UNCAUGHT_EXIT_CODE);
    }
  });

  process.on("unhandledRejection", (reason) => {
    log.error({ event: LogEvent.ProcessUnhandledRejection, err: reason }, "unhandled promise rejection");
    options.alerter.raise({ kind: AlertKind.UnhandledRejection, summary: "an unhandled promise rejection reached the process" });
  });

  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log.info({ event: LogEvent.ProcessStopping, signal }, "stopping");
    const budget = setTimeout(() => {
      log.warn({ event: LogEvent.ProcessStopping, signal }, "clean shutdown took too long; exiting anyway");
      flushLogs();
      process.exit(UNCAUGHT_EXIT_CODE);
    }, SHUTDOWN_BUDGET_MS);
    budget.unref();
    options
      .close()
      .then(() => {
        options.marker.clear();
        flushLogs();
        process.exit(0);
      })
      .catch((err: unknown) => {
        log.error({ event: LogEvent.ProcessStopping, err }, "clean shutdown failed");
        flushLogs();
        process.exit(UNCAUGHT_EXIT_CODE);
      });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
