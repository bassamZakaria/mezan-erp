import { describe, it, expect } from "vitest";
import { applyRetention, DEFAULT_RETENTION_POLICY, type RetentionCandidate } from "./retention.js";

function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

/** One synthetic candidate per day for `days` days, newest first, back from `now`. */
function dailyCandidates(now: Date, days: number): RetentionCandidate[] {
  return Array.from({ length: days }, (_, i) => ({
    id: `backup-${i}`,
    createdAt: daysAgo(now, i),
  }));
}

describe("applyRetention (GFS)", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("keeps everything when fewer backups exist than the daily allowance", () => {
    const candidates = dailyCandidates(now, 3);
    const { keep, remove } = applyRetention(candidates);
    expect(keep).toHaveLength(3);
    expect(remove).toHaveLength(0);
  });

  it("keeps exactly 7 daily backups when 7 consecutive days exist and nothing is older", () => {
    const candidates = dailyCandidates(now, 7);
    const { keep, remove } = applyRetention(candidates);
    expect(keep).toHaveLength(7);
    expect(remove).toHaveLength(0);
    expect(keep.map((c) => c.id)).toEqual(candidates.map((c) => c.id));
  });

  it("over one year of daily backups keeps at most 7 + 4 + 12 = 23 total", () => {
    const candidates = dailyCandidates(now, 400);
    const { keep, remove } = applyRetention(candidates);
    expect(keep.length).toBeLessThanOrEqual(
      DEFAULT_RETENTION_POLICY.daily + DEFAULT_RETENTION_POLICY.weekly + DEFAULT_RETENTION_POLICY.monthly,
    );
    expect(keep.length + remove.length).toBe(candidates.length);
    // The most recent 7 calendar days must all survive.
    for (let i = 0; i < 7; i++) {
      expect(keep.some((c) => c.id === `backup-${i}`)).toBe(true);
    }
  });

  it("keeps the newest backup within every kept bucket, not an arbitrary one", () => {
    // Two backups the same UTC day: an early-morning one and a late one.
    const candidates: RetentionCandidate[] = [
      { id: "morning", createdAt: new Date("2026-08-22T01:00:00.000Z") },
      { id: "evening", createdAt: new Date("2026-08-22T23:00:00.000Z") },
    ];
    const { keep, remove } = applyRetention(candidates, { daily: 7, weekly: 0, monthly: 0 });
    expect(keep.map((c) => c.id)).toEqual(["evening"]);
    expect(remove.map((c) => c.id)).toEqual(["morning"]);
  });

  it("never double-counts a single backup across daily/weekly/monthly tiers", () => {
    const candidates = dailyCandidates(now, 60);
    const { keep } = applyRetention(candidates);
    const ids = keep.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an empty history keeps nothing and removes nothing", () => {
    const { keep, remove } = applyRetention([]);
    expect(keep).toHaveLength(0);
    expect(remove).toHaveLength(0);
  });

  it("a monthly-only backup older than a year still survives if within the monthly cap", () => {
    const elevenMonthsAgo = new Date(now);
    elevenMonthsAgo.setUTCMonth(elevenMonthsAgo.getUTCMonth() - 11);
    const candidates: RetentionCandidate[] = [{ id: "old", createdAt: elevenMonthsAgo }];
    const { keep } = applyRetention(candidates);
    expect(keep.map((c) => c.id)).toEqual(["old"]);
  });

  it("keep + remove partitions the full input with no overlap", () => {
    const candidates = dailyCandidates(now, 90);
    const { keep, remove } = applyRetention(candidates);
    const keptIds = new Set(keep.map((c) => c.id));
    const removedIds = new Set(remove.map((c) => c.id));
    for (const id of keptIds) expect(removedIds.has(id)).toBe(false);
    expect(keptIds.size + removedIds.size).toBe(candidates.length);
  });
});
