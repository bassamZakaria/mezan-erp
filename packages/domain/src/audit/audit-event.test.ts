import { describe, it, expect } from "vitest";
import {
  AUDIT_SEVERITIES,
  AUDIT_STREAMS,
  createAuditEvent,
  recordSecurityEvent,
  recordSensitiveEvent,
  type AuditEvent,
  type AuditSink,
  type AuditStream,
} from "./audit-event.js";

/** Append-only in-memory sink for domain-level tests. */
class MemorySink implements AuditSink {
  private events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async query(stream: AuditStream, limit = 100): Promise<readonly AuditEvent[]> {
    return this.events
      .filter((e) => e.stream === stream)
      .slice(-limit)
      .reverse();
  }
}

describe("audit taxonomy", () => {
  it("defines the four-severity taxonomy and two streams", () => {
    expect([...AUDIT_SEVERITIES].sort()).toEqual(
      ["CRITICAL", "ERROR", "INFO", "WARNING"].sort(),
    );
    expect(AUDIT_STREAMS).toEqual(["security", "sensitive"]);
  });
});

describe("createAuditEvent", () => {
  it("stamps a timestamp and defaults details to null", () => {
    const e = createAuditEvent({
      stream: "security",
      module: "auth",
      entityType: "AUTH_USER",
      action: "ACCOUNT_LOCKED",
      actor: "user-1",
      severity: "CRITICAL",
    });
    expect(e.details).toBeNull();
    expect(() => new Date(e.timestamp).toISOString()).not.toThrow();
    expect(e.timestamp).toBe(new Date(e.timestamp).toISOString());
  });

  it("rejects missing required fields", () => {
    expect(() =>
      createAuditEvent({
        stream: "security",
        module: "",
        entityType: "AUTH_USER",
        action: "X",
        actor: "u",
        severity: "INFO",
      }),
    ).toThrow();
  });
});

describe("recording helpers route to the right stream", () => {
  it("appends security and sensitive events to their streams", async () => {
    const sink = new MemorySink();
    await recordSecurityEvent(sink, {
      module: "auth",
      entityType: "AUTH_USER",
      action: "ACCOUNT_LOCKED",
      actor: "u1",
      severity: "CRITICAL",
    });
    await recordSensitiveEvent(sink, {
      module: "hr",
      entityType: "CONTRACT",
      action: "CREATE",
      actor: "u2",
      severity: "WARNING",
      details: { contractId: "CTR-0002" },
    });

    const security = await sink.query("security");
    const sensitive = await sink.query("sensitive");
    expect(security).toHaveLength(1);
    expect(sensitive).toHaveLength(1);
    expect(security[0]?.action).toBe("ACCOUNT_LOCKED");
    expect(sensitive[0]?.details).toEqual({ contractId: "CTR-0002" });
  });
});
