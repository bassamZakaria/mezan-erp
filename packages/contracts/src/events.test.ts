import { describe, it, expect } from "vitest";
import { domainEventSchema } from "./events.js";

describe("domainEventSchema", () => {
  const event = {
    code: "sales-invoice.posted",
    occurredAt: "2026-08-30T10:00:00.000Z",
    payload: { invoiceId: "inv-1" },
  };

  it("accepts a minimal valid event and preserves every field verbatim", () => {
    const result = domainEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(event);
  });

  it("accepts any code string — the closed set of codes lives in @mezan/domain, not the wire schema", () => {
    const result = domainEventSchema.safeParse({ ...event, code: "some-future-event.happened" });
    expect(result.success).toBe(true);
  });

  it("accepts any payload shape, including primitives and null", () => {
    expect(domainEventSchema.safeParse({ ...event, payload: null }).success).toBe(true);
    expect(domainEventSchema.safeParse({ ...event, payload: "raw-string" }).success).toBe(true);
    expect(domainEventSchema.safeParse({ ...event, payload: 42 }).success).toBe(true);
  });

  it("rejects an event missing code", () => {
    const { code, ...rest } = event;
    const result = domainEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("code");
  });

  it("rejects an event missing occurredAt", () => {
    const { occurredAt, ...rest } = event;
    const result = domainEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("occurredAt");
  });

  it("rejects an empty code string", () => {
    const result = domainEventSchema.safeParse({ ...event, code: "" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = domainEventSchema.safeParse({ ...event, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
