import { describe, it, expect } from "vitest";
import { auditSeveritySchema, auditStreamSchema, auditEventSchema, auditQuerySchema, auditQueryResponseSchema } from "./audit.js";

describe("auditSeveritySchema", () => {
  it("accepts each known severity", () => {
    for (const s of ["CRITICAL", "ERROR", "WARNING", "INFO"]) {
      expect(auditSeveritySchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a severity outside the enum", () => {
    expect(auditSeveritySchema.safeParse("DEBUG").success).toBe(false);
  });

  it("rejects a lowercase severity — the enum is case-sensitive", () => {
    expect(auditSeveritySchema.safeParse("critical").success).toBe(false);
  });
});

describe("auditStreamSchema", () => {
  it("accepts security and sensitive", () => {
    expect(auditStreamSchema.safeParse("security").success).toBe(true);
    expect(auditStreamSchema.safeParse("sensitive").success).toBe(true);
  });

  it("rejects a stream outside the enum", () => {
    expect(auditStreamSchema.safeParse("general").success).toBe(false);
  });
});

describe("auditEventSchema", () => {
  const event = {
    stream: "security" as const,
    module: "auth",
    entityType: "user",
    entityId: "user-1",
    action: "login",
    actor: "user-1",
    branchId: null,
    timestamp: "2026-08-30T10:00:00.000Z",
    severity: "INFO" as const,
    details: null,
  };

  it("accepts a minimal valid event and preserves every field verbatim", () => {
    const result = auditEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(event);
  });

  it("accepts an open details record", () => {
    const result = auditEventSchema.safeParse({ ...event, details: { ip: "10.0.0.1", success: true } });
    expect(result.success).toBe(true);
  });

  it("rejects an event missing actor", () => {
    const { actor, ...rest } = event;
    const result = auditEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("actor");
  });

  it("rejects an out-of-enum severity", () => {
    const result = auditEventSchema.safeParse({ ...event, severity: "DEBUG" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum stream", () => {
    const result = auditEventSchema.safeParse({ ...event, stream: "general" });
    expect(result.success).toBe(false);
  });
});

describe("auditQuerySchema", () => {
  it("accepts an empty query — every field is optional and AND-combined", () => {
    const result = auditQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("coerces limit and offset from query-string values", () => {
    const result = auditQuerySchema.safeParse({ limit: "50", offset: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  it("rejects a limit above 200", () => {
    const result = auditQuerySchema.safeParse({ limit: "201" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative limit", () => {
    expect(auditQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: "-1" }).success).toBe(false);
  });

  it("rejects an out-of-enum severity filter", () => {
    const result = auditQuerySchema.safeParse({ severity: "DEBUG" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative offset", () => {
    const result = auditQuerySchema.safeParse({ offset: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("auditQueryResponseSchema", () => {
  const response = {
    events: [
      {
        stream: "security" as const,
        module: "auth",
        entityType: "user",
        entityId: "user-1",
        action: "login",
        actor: "user-1",
        branchId: null,
        timestamp: "2026-08-30T10:00:00.000Z",
        severity: "INFO" as const,
        details: null,
      },
    ],
    total: 1,
  };

  it("accepts a minimal valid response and preserves every field verbatim", () => {
    const result = auditQueryResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(response);
  });

  it("accepts an empty events array", () => {
    const result = auditQueryResponseSchema.safeParse({ events: [], total: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects a negative total", () => {
    const result = auditQueryResponseSchema.safeParse({ ...response, total: -1 });
    expect(result.success).toBe(false);
  });
});
