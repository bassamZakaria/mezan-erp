import { describe, it, expect, vi } from "vitest";
import { EventBus, type DomainEvent } from "./event-bus.js";

describe("EventBus", () => {
  it("delivers a published event to code-specific subscribers", () => {
    const bus = new EventBus();
    const seen: DomainEvent[] = [];
    bus.subscribe("SALES_INVOICE_CONFIRMED", (e) => seen.push(e));
    bus.publish("SALES_INVOICE_CONFIRMED", { id: "INV-000015" }, "2026-01-01T00:00:00.000Z");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe("SALES_INVOICE_CONFIRMED");
    expect(seen[0]?.payload).toEqual({ id: "INV-000015" });
    expect(seen[0]?.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not deliver to subscribers of other codes", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe("CHEQUE_BOUNCED", handler);
    bus.publish("SALES_INVOICE_CONFIRMED", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers every event to subscribeAll listeners", () => {
    const bus = new EventBus();
    const all = vi.fn();
    bus.subscribeAll(all);
    bus.publish("WORK_ORDER_STARTED", {});
    bus.publish("WORK_ORDER_COMPLETED", {});
    expect(all).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops further delivery", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.subscribe("LOW_STOCK_DETECTED", handler);
    bus.publish("LOW_STOCK_DETECTED", {});
    off();
    bus.publish("LOW_STOCK_DETECTED", {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing handler via onError and still notifies the rest", () => {
    const onError = vi.fn();
    const bus = new EventBus({ onError });
    const good = vi.fn();
    bus.subscribe("TENANT_CREATED", () => {
      throw new Error("boom");
    });
    bus.subscribe("TENANT_CREATED", good);
    bus.publish("TENANT_CREATED", {});
    expect(onError).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("rethrows handler errors when no onError hook is set", () => {
    const bus = new EventBus();
    bus.subscribe("TENANT_CREATED", () => {
      throw new Error("boom");
    });
    expect(() => bus.publish("TENANT_CREATED", {})).toThrow("boom");
  });
});
