import { accrualPeriodKey, type LeaveAccrualBatch } from "./leave-balance.js";

export enum ScheduledAccrualFrequency {
  Monthly = "monthly",
  Annual = "annual",
}

export enum LeaveAccrualRunTypeCode {
  Manual = "manual",
  Scheduled = "scheduled",
}

/** How far back a catch-up reaches, so a machine left off for years cannot credit years in one boot. */
export const MAX_CATCH_UP_PERIODS: Readonly<Record<ScheduledAccrualFrequency, number>> = {
  [ScheduledAccrualFrequency.Monthly]: 12,
  [ScheduledAccrualFrequency.Annual]: 2,
};

function nextPeriodKey(key: string, frequency: ScheduledAccrualFrequency): string {
  if (frequency === ScheduledAccrualFrequency.Annual) return String(Number(key) + 1);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** The first day of a period, used as the run date of a batch the scheduler records for it. */
export function periodStartDate(key: string, frequency: ScheduledAccrualFrequency): string {
  return frequency === ScheduledAccrualFrequency.Annual ? `${key}-01-01` : `${key}-01`;
}

/**
 * The periods the scheduler still owes, oldest first.
 *
 * With no batch of this frequency ever recorded, only the current period is
 * owed: history before the first run is the tenant's opening balance, not a
 * backlog. Otherwise every period after the latest recorded one, up to and
 * including today's, capped at `MAX_CATCH_UP_PERIODS` (the most recent ones).
 */
export function missedAccrualPeriods(
  batches: readonly Pick<LeaveAccrualBatch, "periodKey" | "frequency">[],
  today: string,
  frequency: ScheduledAccrualFrequency,
): string[] {
  const current = accrualPeriodKey(today, frequency);
  const latest = batches
    .filter((b) => b.frequency === frequency)
    .map((b) => b.periodKey)
    .sort()
    .at(-1);
  if (latest === undefined) return [current];
  const owed: string[] = [];
  for (let key = nextPeriodKey(latest, frequency); key <= current; key = nextPeriodKey(key, frequency)) owed.push(key);
  return owed.slice(-MAX_CATCH_UP_PERIODS[frequency]);
}
