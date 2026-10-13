import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditSink, UnrecordedSecurityEvent } from "@mezan/domain";
import { recordSecurityAdminEventOrFallback } from "./admin-audit.js";

const HAND_OVER = { module: "admin", entityType: "USER", entityId: "U-2", action: "COMPANY_OWNER_HAND_OVER", details: { outcome: "pending" } };

function appWith(sink: AuditSink): Hono {
  const app = new Hono();
  app.post("/done", async (c) => {
    await recordSecurityAdminEventOrFallback(sink, c, HAND_OVER);
    return c.json({ ok: true });
  });
  return app;
}

describe("a security event about a change that has already committed", () => {
  it("goes to the unrecorded-events file, and the request still answers, when the audit log refuses it", async () => {
    const kept: UnrecordedSecurityEvent[] = [];
    const refusing: AuditSink = {
      append: async () => {
        throw new Error("disk full");
      },
      query: async () => [],
      unrecorded: { record: (event) => void kept.push(event), summary: () => ({ count: kept.length, recent: kept, dropped: 0, corrupted: 0 }) },
    };

    const res = await appWith(refusing).fetch(new Request("http://x/done", { method: "POST" }));

    expect(res.status).toBe(200);
    expect(kept).toMatchObject([{ action: "COMPANY_OWNER_HAND_OVER", severity: "CRITICAL", entityId: "U-2", reason: "disk full" }]);
  });

  it("is appended to the security stream when the audit log takes it", async () => {
    const rows: AuditEvent[] = [];
    const sink: AuditSink = { append: async (event) => void rows.push(event), query: async () => [] };

    await appWith(sink).fetch(new Request("http://x/done", { method: "POST" }));

    expect(rows).toMatchObject([{ stream: "security", action: "COMPANY_OWNER_HAND_OVER", severity: "CRITICAL", details: { outcome: "pending", origin: "host" } }]);
  });
});
