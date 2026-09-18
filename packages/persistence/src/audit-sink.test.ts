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

/**
 * guards S-3 — the trail is append-only against the APP's SQL, and was not
 * append-only against the person holding the file: `DROP TRIGGER` works.
 */
describe("SqliteAuditSink hash chain", () => {
  const event = (action: string) =>
    createAuditEvent({
      stream: "security",
      module: "auth",
      entityType: "AUTH_USER",
      action,
      actor: "u1",
      severity: "CRITICAL",
      timestamp: "2026-09-07T10:00:00.000Z",
    });

  /** What an attacker does first: the triggers are their own SQL, so they go. */
  function dropTriggers(sink: { db: { exec(sql: string): unknown } }): void {
    sink.db.exec("DROP TRIGGER audit_event_no_update; DROP TRIGGER audit_event_no_delete;");
  }

  it("chains every row and verifies an untouched trail", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      for (const a of ["FIRST", "SECOND", "THIRD"]) await sink.append(event(a));

      const rows = sink.db
        .prepare("SELECT id, prev_hash, row_hash FROM audit_event ORDER BY id")
        .all() as { id: number; prev_hash: string; row_hash: string }[];
      expect(rows).toHaveLength(3);
      expect(rows[0]?.prev_hash).toBe("");
      expect(rows[1]?.prev_hash).toBe(rows[0]?.row_hash);
      expect(rows[2]?.prev_hash).toBe(rows[1]?.row_hash);
      expect(new Set(rows.map((r) => r.row_hash)).size).toBe(3);

      expect(await sink.verifyChain()).toEqual({
        ok: true,
        checked: 3,
        unchained: 0,
        brokenRowId: null,
        reason: "OK",
      });
    } finally {
      sink.close();
    }
  });

  it("names the row whose contents were edited after the triggers were dropped", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      for (const a of ["FIRST", "SECOND", "THIRD"]) await sink.append(event(a));
      dropTriggers(sink);
      sink.db.exec("UPDATE audit_event SET actor = 'somebody-else' WHERE id = 2");

      const result = await sink.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("ROW_ALTERED");
      expect(result.brokenRowId).toBe(2);
      // The first row still verified, so the report says where the trail stops
      // being trustworthy rather than condemning all of it.
      expect(result.checked).toBe(1);
    } finally {
      sink.close();
    }
  });

  it("sees a row deleted from the middle", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      for (const a of ["FIRST", "SECOND", "THIRD"]) await sink.append(event(a));
      dropTriggers(sink);
      sink.db.exec("DELETE FROM audit_event WHERE id = 2");

      const result = await sink.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("CHAIN_BROKEN");
      expect(result.brokenRowId).toBe(3);
    } finally {
      sink.close();
    }
  });

  it("sees rows cut off the END, which the row hashes alone cannot", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      for (const a of ["FIRST", "SECOND", "THIRD"]) await sink.append(event(a));
      dropTriggers(sink);
      // Every surviving row still links to its predecessor — only the sealed
      // head knows the trail used to be longer.
      sink.db.exec("DELETE FROM audit_event WHERE id = 3");

      const result = await sink.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("TRUNCATED");
    } finally {
      sink.close();
    }
  });

  it("refuses a head re-sealed without the key", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      await sink.append(event("FIRST"));
      sink.db.exec("UPDATE audit_chain_head SET mac = 'deadbeef'");
      const result = await sink.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("HEAD_ALTERED");
    } finally {
      sink.close();
    }
  });

  it("counts pre-chain rows as unchained rather than as tampering", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      // A row as a database written before this build had it: no hash at all.
      sink.db
        .prepare(
          `INSERT INTO audit_event (stream, module, entity_type, action, actor, timestamp, severity)
             VALUES ('security','auth','AUTH_USER','LEGACY','u0','2026-01-01T00:00:00.000Z','INFO')`,
        )
        .run();
      await sink.append(event("FIRST"));

      const result = await sink.verifyChain();
      expect(result).toEqual({ ok: true, checked: 1, unchained: 1, brokenRowId: null, reason: "OK" });
    } finally {
      sink.close();
    }
  });
});
