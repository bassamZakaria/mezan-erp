import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink } from "@mezan/persistence";
import type { PlatformHandle } from "@mezan/backend";
import { createAuditAnchorSigner, createFileAuditAnchorSink, PLATFORM_ANCHOR_SCOPE } from "./audit-anchor.js";
import { AnchorLogEvent, runAuditAnchorSweep, type AnchorLogRecord } from "./audit-anchor-job.js";
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
      router: { openTenants: () => [{ id: "T-1", code: "t1" }], backendOf: async () => ({ audit: tenantAudit }) } as unknown as TenantRouter,
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
        backendOf: async () => {
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
});
