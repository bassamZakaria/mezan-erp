import { describe, it, expect } from "vitest";
import {
  applyRetention,
  DEFAULT_RETENTION_POLICY,
  MANUAL_ARCHIVES_KEPT,
  PRE_RESTORE_ARCHIVES_KEPT,
  PRE_RESTORE_MINIMUM_AGE_DAYS,
  PRE_UPDATE_ARCHIVES_KEPT,
  type RetentionCandidate,
} from "./retention.js";
import { BackupReason } from "./manifest.js";

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

  it("no tier rescues a backup its own bucket already superseded", () => {
    // Four archives on one UTC day — the D291 shape: three copies plus a
    // restore-safety one. Day, week and month are all represented by the
    // newest, so the older three are kept by nothing.
    const candidates: RetentionCandidate[] = [
      { id: "a", createdAt: new Date("2026-08-22T01:00:00.000Z") },
      { id: "b", createdAt: new Date("2026-08-22T02:00:00.000Z") },
      { id: "c", createdAt: new Date("2026-08-22T03:00:00.000Z") },
      { id: "safety", createdAt: new Date("2026-08-22T04:00:00.000Z") },
    ];
    const { keep, remove } = applyRetention(candidates);
    expect(keep.map((c) => c.id)).toEqual(["safety"]);
    expect(remove.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("a weekly bucket the daily tier already covers keeps no extra backup", () => {
    // 2026-08-22 is a Saturday, so the 7 daily picks span ISO weeks W34 and
    // W33. One weekly slot resolves to W34, whose newest member (2026-08-22)
    // the daily tier holds — the tier is satisfied, not slid onto W33.
    const candidates = dailyCandidates(now, 14);
    const { keep, remove } = applyRetention(candidates, { daily: 7, weekly: 1, monthly: 0 });
    expect(keep.map((c) => c.id)).toEqual(candidates.slice(0, 7).map((c) => c.id));
    expect(remove).toHaveLength(7);
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

describe("applyRetention — archives somebody asked for are not bucketed with the automatic ones", () => {
  const now = new Date("2026-10-13T17:46:16.000Z");
  const secondsAgo = (n: number): Date => new Date(now.getTime() - n * 1000);
  const of = (id: string, createdAt: Date, reason: BackupReason | null): RetentionCandidate => ({ id, createdAt, reason });

  it("an on-close archive does not replace the manual one taken 14 seconds before it", () => {
    const { keep, remove } = applyRetention([of("manual", secondsAgo(14), BackupReason.Manual), of("on-close", now, BackupReason.OnClose)], DEFAULT_RETENTION_POLICY, now);
    expect(keep.map((c) => c.id).sort()).toEqual(["manual", "on-close"]);
    expect(remove).toEqual([]);
  });

  it("an on-close archive does not replace the safety copy a restore took 16 seconds before it", () => {
    const { remove } = applyRetention([of("pre-restore", secondsAgo(16), BackupReason.PreRestore), of("on-close", now, BackupReason.OnClose)], DEFAULT_RETENTION_POLICY, now);
    expect(remove).toEqual([]);
  });

  it("the calendar buckets still apply among automatic archives, tagged or from before archives were tagged", () => {
    const { keep, remove } = applyRetention(
      [of("scheduled", secondsAgo(3600), BackupReason.Scheduled), of("untagged", secondsAgo(1800), null), of("on-close", now, BackupReason.OnClose)],
      DEFAULT_RETENTION_POLICY,
      now,
    );
    expect(keep.map((c) => c.id)).toEqual(["on-close"]);
    expect(remove.map((c) => c.id).sort()).toEqual(["scheduled", "untagged"]);
  });

  it(`keeps the newest ${MANUAL_ARCHIVES_KEPT} manual archives and removes older ones`, () => {
    const manual = Array.from({ length: MANUAL_ARCHIVES_KEPT + 3 }, (_, i) => of(`manual-${i}`, daysAgo(now, i), BackupReason.Manual));
    const { keep, remove } = applyRetention(manual, DEFAULT_RETENTION_POLICY, now);
    expect(keep.map((c) => c.id)).toEqual(manual.slice(0, MANUAL_ARCHIVES_KEPT).map((c) => c.id));
    expect(remove.map((c) => c.id)).toEqual(manual.slice(MANUAL_ARCHIVES_KEPT).map((c) => c.id));
  });

  it(`keeps the newest ${PRE_UPDATE_ARCHIVES_KEPT} pre-update archives`, () => {
    const updates = Array.from({ length: PRE_UPDATE_ARCHIVES_KEPT + 2 }, (_, i) => of(`update-${i}`, daysAgo(now, i * 40), BackupReason.PreUpdate));
    const { keep } = applyRetention(updates, DEFAULT_RETENTION_POLICY, now);
    expect(keep.map((c) => c.id)).toEqual(updates.slice(0, PRE_UPDATE_ARCHIVES_KEPT).map((c) => c.id));
  });

  it(`keeps the newest ${PRE_RESTORE_ARCHIVES_KEPT} safety copies, and never removes one younger than ${PRE_RESTORE_MINIMUM_AGE_DAYS} days`, () => {
    const recent = Array.from({ length: PRE_RESTORE_ARCHIVES_KEPT + 4 }, (_, i) => of(`recent-${i}`, daysAgo(now, i), BackupReason.PreRestore));
    expect(applyRetention(recent, DEFAULT_RETENTION_POLICY, now).remove).toEqual([]);

    const old = Array.from({ length: PRE_RESTORE_ARCHIVES_KEPT + 4 }, (_, i) => of(`old-${i}`, daysAgo(now, PRE_RESTORE_MINIMUM_AGE_DAYS + 1 + i), BackupReason.PreRestore));
    const pruned = applyRetention(old, DEFAULT_RETENTION_POLICY, now);
    expect(pruned.keep.map((c) => c.id)).toEqual(old.slice(0, PRE_RESTORE_ARCHIVES_KEPT).map((c) => c.id));
    expect(pruned.remove).toHaveLength(4);
  });

  it("a safety copy exactly at the age limit is still protected; one day older is not", () => {
    const crowd = Array.from({ length: PRE_RESTORE_ARCHIVES_KEPT }, (_, i) => of(`newer-${i}`, daysAgo(now, i), BackupReason.PreRestore));
    const atLimit = of("at-limit", daysAgo(now, PRE_RESTORE_MINIMUM_AGE_DAYS), BackupReason.PreRestore);
    const past = of("past", daysAgo(now, PRE_RESTORE_MINIMUM_AGE_DAYS + 1), BackupReason.PreRestore);
    expect(applyRetention([...crowd, atLimit, past], DEFAULT_RETENTION_POLICY, now).remove.map((c) => c.id)).toEqual(["past"]);
  });
});
