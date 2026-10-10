import { describe, it, expect } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink } from "./audit-sink.js";
import { withSqliteTransaction } from "./sqlite-connection.js";

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

describe("SqliteAuditSink inside a caller's transaction", () => {
  const changed = (action: string) =>
    createAuditEvent({
      stream: "sensitive",
      module: "sales",
      entityType: "CUSTOMER",
      entityId: "C1",
      action,
      actor: "u1",
      severity: "WARNING",
      timestamp: "2026-10-10T10:00:00.000Z",
      details: { changes: [{ field: "creditLimit", from: "0", to: "5000" }] },
    });
  const countOf = (sink: { db: { prepare(sql: string): { get(): unknown } } }, table: string) =>
    (sink.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

  it("keeps the chain valid after the transaction an event was appended in rolls back", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      await expect(
        sink.atomic(async () => {
          await sink.append(changed("ROLLED_BACK"));
          throw new Error("the entity write failed");
        }),
      ).rejects.toThrow("the entity write failed");

      expect(countOf(sink, "audit_event")).toBe(0);
      expect(countOf(sink, "audit_event_field")).toBe(0);
      expect(countOf(sink, "audit_chain_head")).toBe(0);
      expect((await sink.verifyChain()).ok).toBe(true);

      await sink.append(changed("KEPT"));
      expect(await sink.verifyChain()).toEqual({ ok: true, checked: 1, unchained: 0, brokenRowId: null, reason: "OK" });
      expect(countOf(sink, "audit_event_field")).toBe(1);
    } finally {
      sink.close();
    }
  });

  it("keeps the chain valid when a rolled-back attempt sits between two committed events", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      await sink.append(changed("FIRST"));
      await sink
        .atomic(async () => {
          await sink.append(changed("ROLLED_BACK"));
          throw new Error("rolled back");
        })
        .catch(() => undefined);
      await sink.append(changed("SECOND"));

      const actions = (sink.db.prepare("SELECT action FROM audit_event ORDER BY id").all() as { action: string }[]).map((r) => r.action);
      expect(actions).toEqual(["FIRST", "SECOND"]);
      expect(await sink.verifyChain()).toEqual({ ok: true, checked: 2, unchained: 0, brokenRowId: null, reason: "OK" });
    } finally {
      sink.close();
    }
  });

  it("commits the event together with the write it shares a transaction with", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      sink.db.exec("CREATE TABLE entity (id TEXT PRIMARY KEY, credit_limit TEXT NOT NULL)");
      await sink.atomic(async () => {
        sink.db.prepare("INSERT INTO entity VALUES ('C1', '5000')").run();
        await sink.append(changed("UPDATE"));
      });
      expect(countOf(sink, "entity")).toBe(1);
      expect(countOf(sink, "audit_event")).toBe(1);
      expect((await sink.verifyChain()).ok).toBe(true);
    } finally {
      sink.close();
    }
  });

  it("is already written when an un-awaited append inside a transaction returns", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      await sink.atomic(async () => {
        void sink.append(changed("NOT_AWAITED"));
        expect(countOf(sink, "audit_event")).toBe(1);
      });
      expect(await sink.verifyChain()).toEqual({ ok: true, checked: 1, unchained: 0, brokenRowId: null, reason: "OK" });
    } finally {
      sink.close();
    }
  });

  it("does not join an unrelated transaction that happens to be open on the shared connection", async () => {
    const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
    try {
      let opened!: () => void;
      const isOpen = new Promise<void>((resolve) => { opened = resolve; });
      const other = withSqliteTransaction(sink.db, async () => {
        opened();
        await new Promise((resolve) => setImmediate(resolve));
        throw new Error("the other request rolled back");
      }).catch(() => undefined);
      await isOpen;
      expect(sink.db.inTransaction).toBe(true);
      await sink.append(changed("UNRELATED"));
      await other;

      expect(countOf(sink, "audit_event")).toBe(1);
      expect(await sink.verifyChain()).toEqual({ ok: true, checked: 1, unchained: 0, brokenRowId: null, reason: "OK" });
    } finally {
      sink.close();
    }
  });
});
