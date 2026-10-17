import {
  LeaveAccrualRunTypeCode,
  ScheduledAccrualFrequency,
  createEmployeeDirectory,
  missedAccrualPeriods,
  periodStartDate,
  runLeaveAccrual,
  type EmployeeRepository,
  type LeaveAccrualBatchRepository,
  type LeaveBalanceRepository,
  type LeavePolicyRepository,
} from "@mezan/domain";

export enum ScheduledJobKind {
  LeaveAccrual = "leave_accrual",
}

export interface ScheduledJobResult {
  readonly kind: ScheduledJobKind;
  /** Period keys this tick recorded a batch for; empty when nothing was owed. */
  readonly recorded: readonly string[];
}

export interface ScheduledJob {
  readonly kind: ScheduledJobKind;
  run(today: string, stillRunning: () => boolean): Promise<ScheduledJobResult>;
}

export interface LeaveAccrualJobDeps {
  readonly batches: LeaveAccrualBatchRepository;
  readonly balances: LeaveBalanceRepository;
  readonly policies: LeavePolicyRepository;
  readonly employees: Pick<EmployeeRepository, "findById" | "list">;
  readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
  readonly transactor: { run<T>(fn: () => Promise<T>): Promise<T> };
  readonly generateId: () => string;
  /** False while the tenant may not write HR records (module not licensed, or read-only). */
  readonly allowed?: () => boolean;
}

const SCHEDULED_ACCRUAL_NOTE = "استحقاق تلقائي — سجّله المجدول";

/**
 * Catches up every accrual period owed, one batch per period.
 *
 * Reuses `runLeaveAccrual` unchanged. Each period runs in its own transaction
 * with its number minted inside it, after re-checking that no batch exists —
 * so a manual run racing the scheduler either lands first (and the scheduler
 * skips) or loses to the UNIQUE `period_key` and rolls back whole, crediting
 * nothing twice.
 */
export function createLeaveAccrualJob(deps: LeaveAccrualJobDeps): ScheduledJob {
  const directory = createEmployeeDirectory(deps.employees);
  return {
    kind: ScheduledJobKind.LeaveAccrual,
    async run(today, stillRunning) {
      const recorded: string[] = [];
      if (deps.allowed && !deps.allowed()) return { kind: ScheduledJobKind.LeaveAccrual, recorded };
      const policies = (await deps.policies.list()).filter((p) => p.active);
      const batches = await deps.batches.list();
      for (const frequency of [ScheduledAccrualFrequency.Annual, ScheduledAccrualFrequency.Monthly]) {
        if (!policies.some((p) => p.accrualFrequency === frequency)) continue;
        for (const periodKey of missedAccrualPeriods(batches, today, frequency)) {
          if (!stillRunning()) return { kind: ScheduledJobKind.LeaveAccrual, recorded };
          const created = await deps.transactor
            .run(async () => {
              if (await deps.batches.findByPeriodKey(periodKey)) return false;
              const result = await runLeaveAccrual(
                {
                  id: deps.generateId(),
                  number: (await deps.numbering.next("LEAVE_ACCRUAL_BATCH")).formatted,
                  runDate: periodStartDate(periodKey, frequency),
                  frequency,
                  runType: LeaveAccrualRunTypeCode.Scheduled,
                  notes: SCHEDULED_ACCRUAL_NOTE,
                  runBy: null,
                },
                { batches: deps.batches, balances: deps.balances, policies: deps.policies, employees: directory, generateId: deps.generateId },
              );
              return result.created;
            })
            .catch(async (err: unknown) => {
              if (await deps.batches.findByPeriodKey(periodKey)) return false;
              throw err;
            });
          if (created) recorded.push(periodKey);
        }
      }
      return { kind: ScheduledJobKind.LeaveAccrual, recorded };
    },
  };
}

export interface ScheduledJobsOptions {
  readonly jobs: readonly ScheduledJob[];
  /** The tenant's calendar day, from its own timezone setting — never the host's UTC day. */
  readonly today: () => Promise<string>;
  /** Every tick takes the connection's turn, like any other background writer. */
  readonly turn: <T>(work: () => Promise<T>) => Promise<T>;
  readonly intervalMs?: number;
  readonly firstRunDelayMs?: number;
  readonly onError?: (kind: ScheduledJobKind, error: unknown) => void;
}

export interface ScheduledJobStatus {
  readonly kind: ScheduledJobKind;
  readonly lastRunAt: string | null;
  readonly lastOkAt: string | null;
  readonly lastError: string | null;
  readonly lastRecorded: number;
  readonly nextRunAt: string | null;
  readonly intervalMs: number;
}

export interface ScheduledJobs {
  status(): readonly ScheduledJobStatus[];
  runNow(): Promise<readonly ScheduledJobResult[]>;
  /** Resolves once a tick already in flight has settled. */
  settle(): Promise<void>;
  stop(): void;
}

export const SCHEDULED_JOBS_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5_000;

/**
 * The scheduler both editions share. It runs a short while after the backend
 * opens — catching up whatever came due while the desktop was closed or the
 * cloud tenant was evicted — then hourly while it stays open; every job is
 * idempotent per period, so a tick that finds nothing owed writes nothing.
 */
export function startScheduledJobs(options: ScheduledJobsOptions): ScheduledJobs {
  let stopped = false;
  let current: Promise<readonly ScheduledJobResult[]> = Promise.resolve([]);
  const stillRunning = () => !stopped;
  const intervalMs = options.intervalMs ?? SCHEDULED_JOBS_INTERVAL_MS;
  const states = new Map<ScheduledJobKind, { lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; lastRecorded: number }>();
  for (const job of options.jobs) states.set(job.kind, { lastRunAt: null, lastOkAt: null, lastError: null, lastRecorded: 0 });
  let nextTickAt = Date.now() + (options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);

  const tick = (): Promise<readonly ScheduledJobResult[]> => {
    const previous = current;
    current = previous.then(async () => {
      const results: ScheduledJobResult[] = [];
      if (stopped) return results;
      for (const job of options.jobs) {
        if (stopped) break;
        try {
          const today = await options.today();
          const result = await options.turn(() => job.run(today, stillRunning));
          results.push(result);
          const at = new Date().toISOString();
          Object.assign(states.get(job.kind)!, { lastRunAt: at, lastOkAt: at, lastError: null, lastRecorded: result.recorded.length });
        } catch (err) {
          Object.assign(states.get(job.kind)!, {
            lastRunAt: new Date().toISOString(),
            lastError: (err instanceof Error ? err.message : String(err)).slice(0, 240),
          });
          options.onError?.(job.kind, err);
        }
      }
      nextTickAt = Date.now() + intervalMs;
      return results;
    });
    return current;
  };

  const first = setTimeout(() => void tick(), options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);
  first.unref?.();
  const every = setInterval(() => void tick(), intervalMs);
  every.unref?.();

  return {
    status: () =>
      options.jobs.map((job) => ({
        kind: job.kind,
        ...states.get(job.kind)!,
        nextRunAt: stopped ? null : new Date(nextTickAt).toISOString(),
        intervalMs,
      })),
    runNow: tick,
    settle: () => current.then(() => undefined),
    stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
