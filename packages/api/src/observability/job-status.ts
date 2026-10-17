import { LogEvent, createLogger } from "./logger.js";

const LAST_ERROR_LENGTH = 240;

export interface JobStatusReading {
  readonly kind: string;
  readonly lastRunAt: string | null;
  readonly lastOkAt: string | null;
  readonly lastError: string | null;
  readonly lastRecorded: number;
  readonly nextRunAt: string | null;
  readonly intervalMs: number;
}

export interface JobFailure {
  readonly kind: string;
  readonly durationMs: number;
}

export interface JobTracker {
  run<T>(work: () => Promise<T>, recordedOf?: (result: T) => number): Promise<T>;
}

export interface JobRegistry {
  track(kind: string, intervalMs: number): JobTracker;
  status(): readonly JobStatusReading[];
  onFailure(listener: (failure: JobFailure) => void): () => void;
}

interface JobState {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastRecorded: number;
  intervalMs: number;
}

const log = createLogger("jobs");

export function errorSummary(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, LAST_ERROR_LENGTH);
}

/**
 * The status of every timer the PLATFORM runs (dunning, owner digest, card checkout sweep,
 * backups, audit anchor), in the same shape the tenant scheduler reports, so one console view
 * reads both. Each run logs `job.succeeded` or `job.failed` with its duration.
 */
export function createJobRegistry(now: () => Date = () => new Date()): JobRegistry {
  const states = new Map<string, JobState>();
  const listeners = new Set<(failure: JobFailure) => void>();

  return {
    track(kind, intervalMs) {
      states.set(kind, { lastRunAt: null, lastOkAt: null, lastError: null, lastRecorded: 0, intervalMs });
      return {
        async run(work, recordedOf) {
          const state = states.get(kind)!;
          const started = performance.now();
          try {
            const result = await work();
            const at = now().toISOString();
            const recorded = recordedOf ? recordedOf(result) : 0;
            Object.assign(state, { lastRunAt: at, lastOkAt: at, lastError: null, lastRecorded: recorded });
            log.info({ event: LogEvent.JobSucceeded, job: kind, durationMs: Math.round(performance.now() - started), recorded }, "job succeeded");
            return result;
          } catch (err) {
            const durationMs = Math.round(performance.now() - started);
            Object.assign(state, { lastRunAt: now().toISOString(), lastError: errorSummary(err) });
            log.error({ event: LogEvent.JobFailed, job: kind, durationMs, err }, "job failed");
            for (const listener of listeners) listener({ kind, durationMs });
            throw err;
          }
        },
      };
    },
    status() {
      return [...states].map(([kind, state]) => ({
        kind,
        lastRunAt: state.lastRunAt,
        lastOkAt: state.lastOkAt,
        lastError: state.lastError,
        lastRecorded: state.lastRecorded,
        nextRunAt: state.lastRunAt ? new Date(new Date(state.lastRunAt).getTime() + state.intervalMs).toISOString() : null,
        intervalMs: state.intervalMs,
      }));
    },
    onFailure(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
