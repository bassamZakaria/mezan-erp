import { describe, it, expect } from "vitest";
import {
  connectDevice,
  disconnectDevice,
  emptySeatSessions,
  withSeatLimit,
  SeatLimitExceededError,
  DeviceSessionNotFoundError,
  SeatSessionRegistry,
} from "./session-registry.js";

describe("connectDevice / disconnectDevice (pure transitions)", () => {
  it("allows connecting up to the seat limit", () => {
    let state = emptySeatSessions(2);
    state = connectDevice(state, { sessionId: "s1", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { sessionId: "s2", deviceId: "till-2", at: 2 });
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("rejects the (seats+1)th connection with SeatLimitExceededError", () => {
    let state = emptySeatSessions(2);
    state = connectDevice(state, { sessionId: "s1", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { sessionId: "s2", deviceId: "till-2", at: 2 });

    expect(() =>
      connectDevice(state, { sessionId: "s3", deviceId: "till-3", at: 3 }),
    ).toThrow(SeatLimitExceededError);

    try {
      connectDevice(state, { sessionId: "s3", deviceId: "till-3", at: 3 });
    } catch (err) {
      expect(err).toBeInstanceOf(SeatLimitExceededError);
      const seatErr = err as SeatLimitExceededError;
      expect(seatErr.code).toBe("SEAT_LIMIT_EXCEEDED");
      expect(seatErr.seats).toBe(2);
      expect(seatErr.connected).toBe(2);
    }
  });

  it("frees a slot on disconnect, allowing a new device to connect", () => {
    let state = emptySeatSessions(1);
    state = connectDevice(state, { sessionId: "s1", deviceId: "till-1", at: 1 });
    expect(() =>
      connectDevice(state, { sessionId: "s2", deviceId: "till-2", at: 2 }),
    ).toThrow(SeatLimitExceededError);

    state = disconnectDevice(state, "s1");
    expect(state.sessions).toHaveLength(0);

    state = connectDevice(state, { sessionId: "s2", deviceId: "till-2", at: 2 });
    expect(state.sessions.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("reconnecting with the same sessionId is idempotent (no double count, refreshes lastSeenAt)", () => {
    let state = emptySeatSessions(1);
    state = connectDevice(state, { sessionId: "s1", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { sessionId: "s1", deviceId: "till-1", at: 99 });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.connectedAt).toBe(1);
    expect(state.sessions[0]!.lastSeenAt).toBe(99);
  });

  it("disconnecting an unknown session throws DeviceSessionNotFoundError", () => {
    const state = emptySeatSessions(2);
    expect(() => disconnectDevice(state, "ghost")).toThrow(DeviceSessionNotFoundError);
  });

  it("defaults deviceLabel to deviceId when omitted", () => {
    const state = connectDevice(emptySeatSessions(1), { sessionId: "s1", deviceId: "till-9" });
    expect(state.sessions[0]!.deviceLabel).toBe("till-9");
  });

  it("withSeatLimit re-points the cap without touching existing sessions", () => {
    let state = emptySeatSessions(1);
    state = connectDevice(state, { sessionId: "s1", deviceId: "till-1", at: 1 });
    state = withSeatLimit(state, 3);
    expect(state.seats).toBe(3);
    expect(state.sessions).toHaveLength(1);

    state = connectDevice(state, { sessionId: "s2", deviceId: "till-2", at: 2 });
    expect(state.sessions).toHaveLength(2);
  });
});

describe("SeatSessionRegistry (stateful convenience wrapper)", () => {
  it("tracks connectedCount and enforces the same seat rule", () => {
    const registry = new SeatSessionRegistry(2);
    expect(registry.connectedCount).toBe(0);

    registry.connect({ sessionId: "s1", deviceId: "till-1" });
    registry.connect({ sessionId: "s2", deviceId: "till-2" });
    expect(registry.connectedCount).toBe(2);

    expect(() => registry.connect({ sessionId: "s3", deviceId: "till-3" })).toThrow(
      SeatLimitExceededError,
    );
  });

  it("frees a slot on disconnect", () => {
    const registry = new SeatSessionRegistry(1);
    registry.connect({ sessionId: "s1", deviceId: "till-1" });
    expect(() => registry.connect({ sessionId: "s2", deviceId: "till-2" })).toThrow(
      SeatLimitExceededError,
    );

    registry.disconnect("s1");
    expect(registry.connectedCount).toBe(0);

    const session = registry.connect({ sessionId: "s2", deviceId: "till-2", deviceLabel: "Front till" });
    expect(session.deviceLabel).toBe("Front till");
    expect(registry.list().map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("setSeats adjusts capacity for subsequent connects", () => {
    const registry = new SeatSessionRegistry(1);
    registry.connect({ sessionId: "s1", deviceId: "till-1" });
    expect(() => registry.connect({ sessionId: "s2", deviceId: "till-2" })).toThrow(
      SeatLimitExceededError,
    );

    registry.setSeats(2);
    registry.connect({ sessionId: "s2", deviceId: "till-2" });
    expect(registry.connectedCount).toBe(2);
  });
});
