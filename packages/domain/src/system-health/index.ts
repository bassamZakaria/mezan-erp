export enum HealthLevel {
  Ok = "ok",
  Warn = "warn",
  Critical = "critical",
  Unknown = "unknown",
}

export enum HealthItemKey {
  Outbox = "outbox",
  Eta = "eta",
  AuditChain = "audit_chain",
  Licence = "licence",
  Seats = "seats",
  Jobs = "jobs",
  Database = "database",
  Devices = "devices",
  Backup = "backup",
  Drill = "drill",
  Disk = "disk",
}

export enum AuditChainHeadReason {
  Ok = "OK",
  Empty = "EMPTY",
  HeadMissing = "HEAD_MISSING",
  HeadAltered = "HEAD_ALTERED",
  Truncated = "TRUNCATED",
}

export enum DrillVerdict {
  Pass = "pass",
  Warn = "warn",
  Fail = "fail",
}

export const HEALTH_THRESHOLDS = {
  outboxWarnMinutes: 60,
  outboxCriticalMinutes: 24 * 60,
  etaWarnHours: 12,
  etaCriticalHours: 72,
  licenceWarnDays: 30,
  licenceCriticalDays: 7,
  jobStaleFactor: 3,
  backupWarnDays: 2,
  backupCriticalDays: 7,
  drillWarnDays: 8,
  drillCriticalDays: 30,
  diskWarnBytes: 2 * 1024 ** 3,
  diskCriticalBytes: 512 * 1024 ** 2,
  deviceIdleWarnSeconds: 120,
} as const;

const RANK: Readonly<Record<HealthLevel, number>> = {
  [HealthLevel.Ok]: 0,
  [HealthLevel.Unknown]: 1,
  [HealthLevel.Warn]: 2,
  [HealthLevel.Critical]: 3,
};

export function worstLevel(levels: readonly HealthLevel[]): HealthLevel {
  let worst = HealthLevel.Ok;
  for (const level of levels) if (RANK[level] > RANK[worst]) worst = level;
  return worst;
}

export function minutesBetween(fromIso: string, now: Date): number | null {
  const at = new Date(fromIso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 60_000));
}

export function healthDaysBetween(fromIso: string, now: Date): number | null {
  const minutes = minutesBetween(fromIso, now);
  return minutes === null ? null : Math.floor(minutes / (60 * 24));
}

export function outboxLevel(input: { queued: number; oldestAgeMinutes: number | null; mailConfigured: boolean }): HealthLevel {
  if (input.queued === 0) return HealthLevel.Ok;
  const age = input.oldestAgeMinutes ?? 0;
  if (age >= HEALTH_THRESHOLDS.outboxCriticalMinutes) return HealthLevel.Critical;
  if (age >= HEALTH_THRESHOLDS.outboxWarnMinutes || !input.mailConfigured) return HealthLevel.Warn;
  return HealthLevel.Ok;
}

export function etaLevel(input: { errors: number; unsent: number; oldestUnsentAgeHours: number | null; clientSecretNeedsReentry?: boolean }): HealthLevel {
  const age = input.oldestUnsentAgeHours ?? 0;
  if (input.clientSecretNeedsReentry) return input.unsent > 0 ? HealthLevel.Critical : HealthLevel.Warn;
  if (input.unsent > 0 && age >= HEALTH_THRESHOLDS.etaCriticalHours) return HealthLevel.Critical;
  if (input.errors > 0 || (input.unsent > 0 && age >= HEALTH_THRESHOLDS.etaWarnHours)) return HealthLevel.Warn;
  return HealthLevel.Ok;
}

export function auditChainLevel(reason: AuditChainHeadReason): HealthLevel {
  return reason === AuditChainHeadReason.Ok || reason === AuditChainHeadReason.Empty ? HealthLevel.Ok : HealthLevel.Critical;
}

export function licenceLevel(input: { usable: boolean; canWrite: boolean; grace: boolean; daysLeft: number | null }): HealthLevel {
  if (!input.usable || !input.canWrite) return HealthLevel.Critical;
  if (input.grace) return HealthLevel.Warn;
  if (input.daysLeft === null) return HealthLevel.Ok;
  if (input.daysLeft <= HEALTH_THRESHOLDS.licenceCriticalDays) return HealthLevel.Critical;
  if (input.daysLeft <= HEALTH_THRESHOLDS.licenceWarnDays) return HealthLevel.Warn;
  return HealthLevel.Ok;
}

export function seatsLevel(input: { licensed: number; used: number }): HealthLevel {
  if (input.licensed <= 0) return HealthLevel.Unknown;
  if (input.used > input.licensed) return HealthLevel.Critical;
  return input.used === input.licensed ? HealthLevel.Warn : HealthLevel.Ok;
}

export function jobLevel(input: {
  lastError: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  intervalMs: number;
  now: Date;
}): HealthLevel {
  if (input.lastRunAt === null) return HealthLevel.Unknown;
  if (input.lastError !== null && (input.lastOkAt === null || input.lastOkAt < input.lastRunAt)) return HealthLevel.Warn;
  const sinceRun = input.now.getTime() - new Date(input.lastRunAt).getTime();
  return sinceRun > input.intervalMs * HEALTH_THRESHOLDS.jobStaleFactor ? HealthLevel.Warn : HealthLevel.Ok;
}

export function backupLevel(ageDays: number | null): HealthLevel {
  if (ageDays === null) return HealthLevel.Critical;
  if (ageDays >= HEALTH_THRESHOLDS.backupCriticalDays) return HealthLevel.Critical;
  return ageDays >= HEALTH_THRESHOLDS.backupWarnDays ? HealthLevel.Warn : HealthLevel.Ok;
}

export function drillLevel(input: { lastGoodAgeDays: number | null; newestVerdict: DrillVerdict | null }): HealthLevel {
  if (input.newestVerdict === DrillVerdict.Fail) return HealthLevel.Critical;
  if (input.lastGoodAgeDays === null) return HealthLevel.Warn;
  if (input.lastGoodAgeDays >= HEALTH_THRESHOLDS.drillCriticalDays) return HealthLevel.Critical;
  if (input.lastGoodAgeDays >= HEALTH_THRESHOLDS.drillWarnDays || input.newestVerdict === DrillVerdict.Warn) return HealthLevel.Warn;
  return HealthLevel.Ok;
}

export function diskLevel(freeBytes: number | null): HealthLevel {
  if (freeBytes === null) return HealthLevel.Unknown;
  if (freeBytes <= HEALTH_THRESHOLDS.diskCriticalBytes) return HealthLevel.Critical;
  return freeBytes <= HEALTH_THRESHOLDS.diskWarnBytes ? HealthLevel.Warn : HealthLevel.Ok;
}

export function deviceLevel(input: { idleSeconds: number }): HealthLevel {
  return input.idleSeconds >= HEALTH_THRESHOLDS.deviceIdleWarnSeconds ? HealthLevel.Warn : HealthLevel.Ok;
}
