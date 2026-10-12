import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordSecurityEventOrFallback, type AuditSink, type UnrecordedSecurityEvent } from "@mezan/domain";
import { createFileSecurityEventFallback, securityFallbackFor } from "./security-fallback-file.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-fallback-"));
  dirs.push(dir);
  return path.join(dir, "tenant.db.security-fallback.jsonl");
}

function entry(n: number): UnrecordedSecurityEvent {
  return { at: `2026-10-12T10:00:${String(n % 60).padStart(2, "0")}.000Z`, module: "auth", action: "LOGIN_FAILED", severity: "WARNING", actor: `u-${n}`, entityId: null, details: { n }, reason: "disk full" };
}

const failingSink: AuditSink = {
  append: async () => {
    throw new Error("database is locked");
  },
  query: async () => [],
};

describe("the file a security event goes to when the audit log refuses it", () => {
  it("keeps each event as one appended line and counts it, across a restart", () => {
    const file = tempFile();
    const first = createFileSecurityEventFallback({ file });
    first.record(entry(1));
    first.record(entry(2));

    const reopened = createFileSecurityEventFallback({ file });
    reopened.record(entry(3));

    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(3);
    const summary = reopened.summary();
    expect(summary.count).toBe(3);
    expect(summary.recent.map((e) => e.actor)).toEqual(["u-3", "u-2", "u-1"]);
  });

  it("stays under its size cap by starting a new file, and still counts every event it was ever given", () => {
    const file = tempFile();
    const fallback = createFileSecurityEventFallback({ file, maxBytes: 2_000 });
    for (let n = 0; n < 200; n += 1) fallback.record(entry(n));

    expect(statSync(file).size).toBeLessThanOrEqual(2_000);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(2_000);
    const summary = fallback.summary(5);
    expect(summary.count).toBe(200);
    expect(summary.recent.map((e) => e.actor)).toEqual(["u-199", "u-198", "u-197", "u-196", "u-195"]);
  });

  it("receives a sign-in event the audit log refused, without the credential that came with it", async () => {
    const file = tempFile();
    const fallback = createFileSecurityEventFallback({ file });

    await recordSecurityEventOrFallback({ ...failingSink, unrecorded: fallback }, {
      module: "auth", entityType: "AUTH_USER", entityId: "u-1", action: "LOGIN_FAILED", actor: "u-1", severity: "WARNING",
      details: { userId: "u-1", origin: "41.33.10.10", pin: "482913", sessionToken: "tok-abc", unlockCode: "991122", password: "hunter2" },
    });

    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/482913|tok-abc|991122|hunter2/);
    expect(fallback.summary().recent[0]).toMatchObject({ action: "LOGIN_FAILED", actor: "u-1", details: { userId: "u-1", origin: "41.33.10.10" }, reason: "database is locked" });
  });

  it("is a file beside a database on disk and memory beside one that is not", () => {
    const file = tempFile();
    const onDisk = securityFallbackFor(file.replace(/\.security-fallback\.jsonl$/, ""));
    onDisk.record(entry(1));
    expect(existsSync(file)).toBe(true);

    const inMemory = securityFallbackFor(":memory:");
    inMemory.record(entry(1));
    expect(inMemory.summary().count).toBe(1);
  });
});
