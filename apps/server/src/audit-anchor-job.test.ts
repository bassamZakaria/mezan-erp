import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink } from "@mezan/persistence";
import type { PlatformHandle } from "@mezan/backend";
import { AnchorOutcome, AnchorRefusal, createAuditAnchorSigner, createFileAuditAnchorSink, PLATFORM_ANCHOR_SCOPE } from "./audit-anchor.js";
import { acceptRestoreForScope, AnchorLogEvent, anchorStatusOf, runAuditAnchorSweep, type AnchorLogRecord } from "./audit-anchor-job.js";
import type { TenantRouter } from "./tenant-router.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "audit-anchor-job-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const event = () => createAuditEvent({ stream: "security", module: "auth", entityType: "AUTH_USER", action: "X", actor: "u", severity: "INFO" });

describe("runAuditAnchorSweep", () => {
  it("anchors the platform chain and each open tenant, then reports unchanged heads", async () => {
    const platformAudit = createSqliteAuditSink();
    const tenantAudit = createSqliteAuditSink();
    await platformAudit.append(event());
    await tenantAudit.append(event());
    const sink = createFileAuditAnchorSink(path.join(dir, "anchors"));
    const records: AnchorLogRecord[] = [];
    const options = {
      platform: { audit: platformAudit } as unknown as PlatformHandle,
      router: { openTenants: () => [{ id: "T-1", code: "t1" }], openBackendOf: async () => ({ audit: tenantAudit }) } as unknown as TenantRouter,
      signer: createAuditAnchorSigner("33".repeat(32)),
      sink,
      log: (r: AnchorLogRecord) => records.push(r),
    };

    expect(await runAuditAnchorSweep(options)).toEqual({ anchored: 2, unchanged: 0, refused: 0, failed: 0 });
    expect((await sink.list(PLATFORM_ANCHOR_SCOPE, 5)).map((s) => s.anchor.seq)).toEqual([1]);
    expect((await sink.list("T-1", 5)).map((s) => s.anchor.seq)).toEqual([1]);

    expect(await runAuditAnchorSweep(options)).toEqual({ anchored: 0, unchanged: 2, refused: 0, failed: 0 });
    expect(records.filter((r) => r.event === AnchorLogEvent.Anchored)).toHaveLength(2);
  });

  it("logs a failing scope loudly and still anchors the rest", async () => {
    const platformAudit = createSqliteAuditSink();
    await platformAudit.append(event());
    const records: AnchorLogRecord[] = [];
    const result = await runAuditAnchorSweep({
      platform: { audit: platformAudit } as unknown as PlatformHandle,
      router: {
        openTenants: () => [{ id: "T-1", code: "t1" }],
        openBackendOf: async () => {
          throw new Error("books refused");
        },
      } as unknown as TenantRouter,
      signer: createAuditAnchorSigner("33".repeat(32)),
      sink: createFileAuditAnchorSink(path.join(dir, "anchors")),
      log: (r) => records.push(r),
    });
    expect(result).toMatchObject({ anchored: 1, failed: 1 });
    expect(records.find((r) => r.event === AnchorLogEvent.Failed)).toMatchObject({ scope: "T-1", reason: "books refused" });
  });

  it("skips, without counting a failure, a tenant whose handle closed while the sweep reached it", async () => {
    const platformAudit = createSqliteAuditSink();
    await platformAudit.append(event());
    const records: AnchorLogRecord[] = [];
    const result = await runAuditAnchorSweep({
      platform: { audit: platformAudit } as unknown as PlatformHandle,
      router: {
        openTenants: () => [{ id: "T-1", code: "t1" }],
        openBackendOf: async () => {
          throw new TypeError("The database connection is not open");
        },
      } as unknown as TenantRouter,
      signer: createAuditAnchorSigner("33".repeat(32)),
      sink: createFileAuditAnchorSink(path.join(dir, "anchors")),
      log: (r) => records.push(r),
    });
    expect(result).toMatchObject({ anchored: 1, failed: 0 });
    expect(records.find((r) => r.event === AnchorLogEvent.SkippedClosed)).toMatchObject({ scope: "T-1" });
  });

  it("a tenant restored from an older snapshot is refused every sweep until the restore is accepted, then anchoring resumes", async () => {
    const platformAudit = createSqliteAuditSink();
    await platformAudit.append(event());
    const live = createSqliteAuditSink();
    for (let i = 0; i < 3; i += 1) await live.append(event());
    let tenantAudit = live;
    const sink = createFileAuditAnchorSink(path.join(dir, "anchors"));
    const signer = createAuditAnchorSigner("33".repeat(32));
    const records: AnchorLogRecord[] = [];
    const options = {
      platform: { audit: platformAudit } as unknown as PlatformHandle,
      router: { openTenants: () => [{ id: "T-1", code: "t1" }], openBackendOf: async () => ({ audit: tenantAudit }) } as unknown as TenantRouter,
      signer,
      sink,
      log: (r: AnchorLogRecord) => records.push(r),
    };
    await runAuditAnchorSweep(options);

    const restored = createSqliteAuditSink();
    await restored.append(event());
    tenantAudit = restored;
    expect(await runAuditAnchorSweep(options)).toMatchObject({ refused: 1 });
    expect(await runAuditAnchorSweep(options)).toMatchObject({ refused: 1 });
    expect((await anchorStatusOf("T-1", restored, options)).refusal).toBe(AnchorRefusal.RolledBack);
    expect(await sink.list("T-1", 10)).toHaveLength(1);

    const accepted = await acceptRestoreForScope("T-1", restored, { ...options, reason: "restored last night's snapshot after a disk failure", acceptedBy: "owner-1" });
    expect(accepted.accepted).toBe(true);
    const status = await anchorStatusOf("T-1", restored, options);
    expect(status).toMatchObject({ outcome: AnchorOutcome.Unchanged, lastRebase: { acceptedBy: "owner-1", supersededSeq: 3 } });

    await restored.append(event());
    expect(await runAuditAnchorSweep(options)).toMatchObject({ anchored: 1, refused: 0 });
    expect((await sink.list("T-1", 10)).map((s) => s.anchor.seq)).toEqual([3, 1, 2]);
  });
});
