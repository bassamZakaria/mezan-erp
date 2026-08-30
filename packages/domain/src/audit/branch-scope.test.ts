import { describe, it, expect } from "vitest";
import { ALL_SCOPE } from "../permissions/auth-context.js";
import { auditBranchFromScope, branchScopedAuditSink } from "./branch-scope.js";
import type { AuditEvent, AuditSink, AuditStream } from "./audit-event.js";

describe("auditBranchFromScope", () => {
  it("returns null for the all-branches scope", () => {
    expect(auditBranchFromScope(ALL_SCOPE)).toBeNull();
  });

  it("returns the single branch id when scope narrows to exactly one", () => {
    expect(auditBranchFromScope(["BR-MAIN"])).toBe("BR-MAIN");
  });

  it("returns null for a multi-branch grant (never guesses one)", () => {
    expect(auditBranchFromScope(["BR-MAIN", "BR-2"])).toBeNull();
  });

  it("returns null for an empty scope array", () => {
    expect(auditBranchFromScope([])).toBeNull();
  });
});

function fakeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    stream: "sensitive",
    module: "treasury",
    entityType: "VOUCHER",
    entityId: "v-1",
    action: "CREATE",
    actor: "u1",
    branchId: null,
    timestamp: "2026-08-22T10:00:00.000Z",
    severity: "INFO",
    details: null,
    ...overrides,
  };
}

class RecordingSink implements AuditSink {
  readonly appended: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.appended.push(event);
  }
  async query(_stream: AuditStream): Promise<readonly AuditEvent[]> {
    return this.appended;
  }
}

describe("branchScopedAuditSink", () => {
  it("returns the same sink unchanged when branchId is null", () => {
    const sink = new RecordingSink();
    expect(branchScopedAuditSink(sink, null)).toBe(sink);
  });

  it("stamps branchId onto an event that doesn't already name one", async () => {
    const sink = new RecordingSink();
    const wrapped = branchScopedAuditSink(sink, "BR-MAIN");
    await wrapped.append(fakeEvent({ branchId: null }));
    expect(sink.appended[0]?.branchId).toBe("BR-MAIN");
  });

  it("keeps the event's own branch when it already names one — the caller's knowledge wins", async () => {
    const sink = new RecordingSink();
    const wrapped = branchScopedAuditSink(sink, "BR-MAIN");
    await wrapped.append(fakeEvent({ branchId: "BR-OTHER" }));
    expect(sink.appended[0]?.branchId).toBe("BR-OTHER");
  });

  it("query passes through to the wrapped sink", async () => {
    const sink = new RecordingSink();
    const wrapped = branchScopedAuditSink(sink, "BR-MAIN");
    await wrapped.append(fakeEvent());
    const result = await wrapped.query("sensitive");
    expect(result).toHaveLength(1);
  });
});
