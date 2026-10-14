import { describe, expect, it } from "vitest";
import { createAuditEvent, type AuditStream } from "@mezan/domain";
import { createSqliteAuditSink } from "./audit-sink.js";
import { withSqliteTransaction } from "./sqlite-connection.js";

const event = (stream: AuditStream, action: string) => createAuditEvent({ stream, module: "admin", entityType: "USER", entityId: "U-1", action, actor: "u1", severity: "CRITICAL" });

class Refused extends Error {}

describe("a security event recorded inside a transaction that is rolled back", () => {
  it("is still in the trail afterwards, the chain verifies, and what the transaction did to the records is gone with it", async () => {
    const sink = createSqliteAuditSink();
    try {
      await sink.append(event("sensitive", "BEFORE"));
      await expect(
        sink.securityEventsOutlive(() =>
          withSqliteTransaction(sink.db, async () => {
            await sink.append(event("sensitive", "CREATE"));
            await sink.append(event("security", "PRIVILEGE_ESCALATION_DENIED"));
            throw new Refused();
          }),
        ),
      ).rejects.toBeInstanceOf(Refused);

      expect((await sink.query("security")).map((row) => row.action)).toEqual(["PRIVILEGE_ESCALATION_DENIED"]);
      expect((await sink.query("sensitive")).map((row) => row.action)).toEqual(["BEFORE"]);
      expect((await sink.verifyChain()).ok).toBe(true);
    } finally {
      sink.close();
    }
  });

  it("is written once when the transaction commits", async () => {
    const sink = createSqliteAuditSink();
    try {
      await sink.securityEventsOutlive(() =>
        withSqliteTransaction(sink.db, async () => {
          await sink.append(event("security", "PERMISSION_DENIED"));
        }),
      );
      expect((await sink.query("security")).map((row) => row.action)).toEqual(["PERMISSION_DENIED"]);
      expect((await sink.verifyChain()).ok).toBe(true);
    } finally {
      sink.close();
    }
  });

  it("leaves a security event recorded outside any such scope atomic with its transaction", async () => {
    const sink = createSqliteAuditSink();
    try {
      await expect(
        withSqliteTransaction(sink.db, async () => {
          await sink.append(event("security", "SOD_OVERRIDE"));
          throw new Refused();
        }),
      ).rejects.toBeInstanceOf(Refused);
      expect(await sink.query("security")).toEqual([]);
    } finally {
      sink.close();
    }
  });

  it("writes at once an event recorded by work the scope started and did not wait for", async () => {
    const sink = createSqliteAuditSink();
    try {
      let later!: () => Promise<void>;
      await sink.securityEventsOutlive(async () => {
        later = async () => {
          await Promise.resolve();
          await sink.append(event("security", "SESSION_ORIGIN_REJECTED"));
        };
        later = later.bind(null);
        const started = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(later);
        later = () => started;
      });
      await later();
      expect((await sink.query("security")).map((row) => row.action)).toEqual(["SESSION_ORIGIN_REJECTED"]);
    } finally {
      sink.close();
    }
  });

  it("does not hold back another request's events while this one's transaction is open", async () => {
    const sink = createSqliteAuditSink();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const scoped = sink.securityEventsOutlive(async () => { await held; });
      await sink.append(event("security", "LOGIN_FAILED"));
      expect((await sink.query("security")).map((row) => row.action)).toEqual(["LOGIN_FAILED"]);
      release();
      await scoped;
    } finally {
      sink.close();
    }
  });
});
