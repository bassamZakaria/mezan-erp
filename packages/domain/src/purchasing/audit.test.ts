import { describe, it, expect } from "vitest";
import { recordPurchaseAudit } from "./audit.js";
import type { AuditEvent, AuditStream, AuditSink } from "../audit/index.js";

class RecordingAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async query(_stream: AuditStream, _limit?: number): Promise<readonly AuditEvent[]> {
    return this.events;
  }
}

describe("recordPurchaseAudit", () => {
  it("does nothing when no sink is wired", async () => {
    await expect(
      recordPurchaseAudit({}, "PURCHASE_ORDER", "CONFIRM", { orderId: "po-1" }, "po-1"),
    ).resolves.toBeUndefined();
  });

  it("records a CONFIRM as INFO severity, module purchases, with actor defaulted to system", async () => {
    const audit = new RecordingAuditSink();
    await recordPurchaseAudit({ audit }, "PURCHASE_ORDER", "CONFIRM", { orderId: "po-1" }, "po-1");
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      stream: "sensitive",
      module: "purchases",
      entityType: "PURCHASE_ORDER",
      entityId: "po-1",
      action: "CONFIRM",
      actor: "system",
      severity: "INFO",
      details: { orderId: "po-1" },
    });
  });

  it("records a CANCEL as WARNING severity", async () => {
    const audit = new RecordingAuditSink();
    await recordPurchaseAudit({ audit }, "GOODS_RECEIPT", "CANCEL", { receiptId: "gr-1" }, "gr-1");
    expect(audit.events[0]?.severity).toBe("WARNING");
  });

  it("carries the supplied actor instead of the system default", async () => {
    const audit = new RecordingAuditSink();
    await recordPurchaseAudit({ audit, actor: "user-42" }, "PURCHASE_INVOICE", "CONFIRM", {}, "pi-1");
    expect(audit.events[0]?.actor).toBe("user-42");
  });

  it("records a null entityId when none is supplied", async () => {
    const audit = new RecordingAuditSink();
    await recordPurchaseAudit({ audit }, "PURCHASE_ORDER", "CONFIRM", { note: "no id" });
    expect(audit.events[0]?.entityId).toBeNull();
  });
});
