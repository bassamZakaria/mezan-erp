import { describe, it, expect } from "vitest";
import { deviceSessionSchema, connectDeviceRequestSchema, lanStatusSchema, lanSessionsListSchema } from "./lan.js";

describe("deviceSessionSchema", () => {
  const session = { sessionId: "sess-1", userId: "u-1", deviceId: "dev-1", deviceLabel: "Till 1", connectedAt: 1000, lastSeenAt: 2000 };

  it("accepts a minimal valid session and preserves every field verbatim", () => {
    const result = deviceSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(session);
  });

  it("rejects a session missing deviceId", () => {
    const { deviceId, ...rest } = session;
    const result = deviceSessionSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("deviceId");
  });

  it("rejects a negative connectedAt timestamp", () => {
    const result = deviceSessionSchema.safeParse({ ...session, connectedAt: -1 });
    expect(result.success).toBe(false);
  });
});

describe("connectDeviceRequestSchema", () => {
  // NO `sessionId`. The caller used to name its own seat identity, and
  // `connectDevice` is idempotent only on that id — so any signed-in cashier
  // could loop with a fresh random one and burn every seat. The seat key is
  // derived server-side now, from the authenticated session plus the device.
  const request = { deviceId: "dev-1" };

  it("accepts a minimal valid request with the optional label omitted", () => {
    const result = connectDeviceRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(request);
  });

  it("rejects a request missing deviceId", () => {
    const { deviceId, ...rest } = request;
    const result = connectDeviceRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("deviceId");
  });

  it("silently strips a caller-supplied sessionId, so it cannot choose its own seat key", () => {
    const result = connectDeviceRequestSchema.safeParse({ ...request, sessionId: "mine-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("sessionId");
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = connectDeviceRequestSchema.safeParse({ ...request, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("lanStatusSchema", () => {
  const status = { licensed: true, seats: 5, connected: 2 };

  it("accepts a minimal valid status and preserves every field verbatim", () => {
    const result = lanStatusSchema.safeParse(status);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(status);
  });

  it("rejects a negative seats value", () => {
    const result = lanStatusSchema.safeParse({ ...status, seats: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing licensed flag", () => {
    const { licensed, ...rest } = status;
    const result = lanStatusSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("licensed");
  });
});

describe("lanSessionsListSchema", () => {
  const list = {
    seats: 5,
    connected: 1,
    sessions: [{ sessionId: "sess-1", userId: "u-1", deviceId: "dev-1", deviceLabel: "Till 1", connectedAt: 1000, lastSeenAt: 2000 }],
  };

  it("accepts a minimal valid list and preserves every field verbatim", () => {
    const result = lanSessionsListSchema.safeParse(list);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(list);
  });

  it("accepts an empty sessions array", () => {
    const result = lanSessionsListSchema.safeParse({ ...list, sessions: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a list missing sessions", () => {
    const { sessions, ...rest } = list;
    const result = lanSessionsListSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("sessions");
  });
});
