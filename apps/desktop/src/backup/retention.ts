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
}

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
 * up to `limit` buckets. Candidates already kept (by id) are skipped so the
 * same backup can't be double-counted across the daily/weekly/monthly tiers.
 */
function pickNewestPerBucket(
  candidates: readonly RetentionCandidate[],
  keyOf: (d: Date) => string,
  limit: number,
  alreadyKept: Set<string>,
): RetentionCandidate[] {
  const byBucket = new Map<string, RetentionCandidate>();
  for (const c of candidates) {
    if (alreadyKept.has(c.id)) continue;
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
 * Applies the GFS policy to a set of existing backups and returns which to
 * keep and which to remove. `now` is injectable so tests are deterministic.
 */
export function applyRetention(
  candidates: readonly RetentionCandidate[],
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): RetentionResult {
  const sorted = [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const kept = new Set<string>();
  const keep: RetentionCandidate[] = [];

  for (const tier of [
    { keyOf: dayKey, limit: policy.daily },
    { keyOf: weekKey, limit: policy.weekly },
    { keyOf: monthKey, limit: policy.monthly },
  ]) {
    const picked = pickNewestPerBucket(sorted, tier.keyOf, tier.limit, kept);
    for (const c of picked) {
      kept.add(c.id);
      keep.push(c);
    }
  }

  keep.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const remove = sorted.filter((c) => !kept.has(c.id));

  return { keep, remove };
}
