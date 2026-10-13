import { BackupReason } from "./manifest.js";

/**
 * GFS (Grandfather-Father-Son) retention, per docs/archive/plan.md §3.7: keep 7
 * daily, 4 weekly, 12 monthly backups, size-capped by count rather than
 * bytes (a fixed cap is what keeps a long-lived offline install's backup
 * folder bounded without the app ever having to reason about disk quotas).
 *
 * Pure function over plain data — no filesystem access here — so it is
 * exhaustively unit-testable without touching disk, and the actual
 * deletion (backup-service.ts) stays a thin, obviously-correct caller.
 */

export interface RetentionCandidate {
  readonly id: string;
  readonly createdAt: Date;
  readonly reason?: BackupReason | null;
}

export const MANUAL_ARCHIVES_KEPT = 10;
export const PRE_RESTORE_ARCHIVES_KEPT = 5;
export const PRE_RESTORE_MINIMUM_AGE_DAYS = 30;
export const PRE_UPDATE_ARCHIVES_KEPT = 3;

enum RetentionClass {
  Automatic = "automatic",
  Manual = "manual",
  PreRestore = "pre-restore",
  PreUpdate = "pre-update",
}

const RETENTION_CLASS_OF: Record<BackupReason, RetentionClass> = {
  [BackupReason.Scheduled]: RetentionClass.Automatic,
  [BackupReason.OnClose]: RetentionClass.Automatic,
  [BackupReason.PreMigration]: RetentionClass.Automatic,
  [BackupReason.Manual]: RetentionClass.Manual,
  [BackupReason.PreRestore]: RetentionClass.PreRestore,
  [BackupReason.PreUpdate]: RetentionClass.PreUpdate,
};

const classOf = (candidate: RetentionCandidate): RetentionClass =>
  candidate.reason ? RETENTION_CLASS_OF[candidate.reason] : RetentionClass.Automatic;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  daily: 7,
  weekly: 4,
  monthly: 12,
};

export interface RetentionResult {
  readonly keep: readonly RetentionCandidate[];
  readonly remove: readonly RetentionCandidate[];
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function weekKey(d: Date): string {
  // ISO-8601 week number, UTC-based to avoid local-timezone flakiness.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Picks the single newest candidate per bucket key, in bucket-recency order,
 * up to `limit` buckets. Every tier resolves its buckets over the WHOLE
 * candidate set: a bucket whose newest member a finer tier already kept is
 * satisfied by that same file. Hiding kept ids here instead would promote the
 * bucket's runner-up — a backup this tier's own rule had superseded — and the
 * tiers would stop being a union of one-per-bucket (D306).
 */
function pickNewestPerBucket(
  candidates: readonly RetentionCandidate[],
  keyOf: (d: Date) => string,
  limit: number,
): RetentionCandidate[] {
  const byBucket = new Map<string, RetentionCandidate>();
  for (const c of candidates) {
    const key = keyOf(c.createdAt);
    const existing = byBucket.get(key);
    if (!existing || c.createdAt > existing.createdAt) {
      byBucket.set(key, c);
    }
  }

  return [...byBucket.entries()]
    .sort((a, b) => b[1].createdAt.getTime() - a[1].createdAt.getTime())
    .slice(0, limit)
    .map(([, c]) => c);
}

/**
 * INVARIANT: the calendar buckets rank AUTOMATIC archives against each other and
 * nothing else. An archive somebody asked for — «أخذ نسخة الآن», the safety copy
 * a restore takes of the books it is about to replace, the copy taken before an
 * update — is the only way back from a mistake, and one bucket per day let the
 * on-close archive of the same evening delete it seconds later.
 */
export function applyRetention(
  candidates: readonly RetentionCandidate[],
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
  now: Date = new Date(),
): RetentionResult {
  const sorted = [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const ofClass = (wanted: RetentionClass) => sorted.filter((candidate) => classOf(candidate) === wanted);
  const automatic = ofClass(RetentionClass.Automatic);

  const kept = new Set<string>();
  for (const tier of [
    { keyOf: dayKey, limit: policy.daily },
    { keyOf: weekKey, limit: policy.weekly },
    { keyOf: monthKey, limit: policy.monthly },
  ]) {
    for (const c of pickNewestPerBucket(automatic, tier.keyOf, tier.limit)) kept.add(c.id);
  }
  for (const c of ofClass(RetentionClass.Manual).slice(0, MANUAL_ARCHIVES_KEPT)) kept.add(c.id);
  for (const c of ofClass(RetentionClass.PreUpdate).slice(0, PRE_UPDATE_ARCHIVES_KEPT)) kept.add(c.id);
  const protectedSince = now.getTime() - PRE_RESTORE_MINIMUM_AGE_DAYS * DAY_MS;
  ofClass(RetentionClass.PreRestore).forEach((c, index) => {
    if (index < PRE_RESTORE_ARCHIVES_KEPT || c.createdAt.getTime() >= protectedSince) kept.add(c.id);
  });

  return { keep: sorted.filter((c) => kept.has(c.id)), remove: sorted.filter((c) => !kept.has(c.id)) };
}
