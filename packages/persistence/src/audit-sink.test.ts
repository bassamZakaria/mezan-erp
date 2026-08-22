import { describe, it, expect } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink } from "./audit-sink.js";

describe("SqliteAuditSink", () => {
  it("appends and reads back per stream, newest-first, round-tripping details", async () => {
    const sink = createSqliteAuditSink();
    try {
      await sink.append(
        createAuditEvent({
          stream: "security",
          module: "auth",
          entityType: "AUTH_USER",
          action: "ACCOUNT_LOCKED",
          actor: "u1",
          severity: "CRITICAL",
          timestamp: "2026-08-07T00:52:01.000Z",
        }),
      );
      await sink.append(
        createAuditEvent({
          stream: "sensitive",
          module: "hr",
          entityType: "CONTRACT",
          action: "CREATE",
          actor: "u2",
          severity: "WARNING",
          timestamp: "2026-08-11T09:59:38.000Z",
          details: { contractId: "CTR-0002" },
        }),
      );

      const security = await sink.query("security");
      const sensitive = await sink.query("sensitive");
      expect(security).toHaveLength(1);
      expect(sensitive).toHaveLength(1);
      expect(security[0]?.action).toBe("ACCOUNT_LOCKED");
      expect(security[0]?.details).toBeNull();
      expect(sensitive[0]?.details).toEqual({ contractId: "CTR-0002" });
    } finally {
      sink.close();
    }
  });

  it("orders results newest-first", async () => {
    const sink = createSqliteAuditSink();
    try {
      for (const action of ["FIRST", "SECOND", "THIRD"]) {
        await sink.append(
          createAuditEvent({
            stream: "security",
            module: "auth",
            entityType: "AUTH_USER",
            action,
            actor: "u",
            severity: "INFO",
          }),
        );
      }
      const rows = await sink.query("security");
      expect(rows.map((r) => r.action)).toEqual(["THIRD", "SECOND", "FIRST"]);
    } finally {
      sink.close();
    }
  });

  it("is append-only: UPDATE and DELETE are rejected at the storage layer", async () => {
    const sink = createSqliteAuditSink();
    try {
      await sink.append(
        createAuditEvent({
          stream: "security",
          module: "auth",
          entityType: "AUTH_USER",
          action: "ACCOUNT_LOCKED",
          actor: "u1",
          severity: "CRITICAL",
        }),
      );
      expect(() =>
        sink.db.exec("UPDATE audit_event SET action = 'TAMPERED'"),
      ).toThrow(/append-only/);
      expect(() => sink.db.exec("DELETE FROM audit_event")).toThrow(
        /append-only/,
      );
    } finally {
      sink.close();
    }
  });
});
