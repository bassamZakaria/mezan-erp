import { describe, it, expect } from "vitest";
import {
  connectDevice,
  disconnectDevice,
  reapStaleSessions,
  emptySeatSessions,
  withSeatLimit,
  SeatLimitExceededError,
  UserSeatLimitExceededError,
  DeviceSessionNotFoundError,
  SeatSessionRegistry,
} from "./session-registry.js";

describe("connectDevice / disconnectDevice (pure transitions)", () => {
  it("allows connecting up to the seat limit", () => {
    let state = emptySeatSessions(2, 2);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { userId: "u2", deviceId: "till-2", at: 2 });
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.map((s) => s.deviceId)).toEqual(["till-1", "till-2"]);
  });

  it("rejects the (seats+1)th connection with SeatLimitExceededError", () => {
    let state = emptySeatSessions(2, 2);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { userId: "u2", deviceId: "till-2", at: 2 });

    expect(() =>
      connectDevice(state, { userId: "u3", deviceId: "till-3", at: 3 }),
    ).toThrow(SeatLimitExceededError);

    try {
      connectDevice(state, { userId: "u3", deviceId: "till-3", at: 3 });
    } catch (err) {
      expect(err).toBeInstanceOf(SeatLimitExceededError);
      const seatErr = err as SeatLimitExceededError;
      expect(seatErr.code).toBe("SEAT_LIMIT_EXCEEDED");
      expect(seatErr.seats).toBe(2);
      expect(seatErr.connected).toBe(2);
    }
  });

  it("frees a slot on disconnect, allowing a new device to connect", () => {
    let state = emptySeatSessions(1, 1);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 1 });
    expect(() =>
      connectDevice(state, { userId: "u2", deviceId: "till-2", at: 2 }),
    ).toThrow(SeatLimitExceededError);

    const sessionId = state.sessions[0]!.sessionId;
    state = disconnectDevice(state, sessionId);
    expect(state.sessions).toHaveLength(0);

    state = connectDevice(state, { userId: "u2", deviceId: "till-2", at: 2 });
    expect(state.sessions.map((s) => s.deviceId)).toEqual(["till-2"]);
  });

  it("reconnecting with the same (userId, deviceId) is idempotent (no double count, refreshes lastSeenAt)", () => {
    let state = emptySeatSessions(1, 1);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 99 });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.connectedAt).toBe(1);
    expect(state.sessions[0]!.lastSeenAt).toBe(99);
  });

  it("the seat identity is server-derived: a caller cannot choose it by supplying a sessionId", () => {
    // Regression guard for PR #54 review finding #1 — the caller used to name
    // its own `sessionId`, so any signed-in account could loop with a fresh
    // random id and burn every seat. The seat key is now userId+deviceId.
    let state = emptySeatSessions(5, 5);
    state = connectDevice(state, { userId: "attacker", deviceId: "till-1", at: 1 });
    state = connectDevice(state, { userId: "attacker", deviceId: "till-1", at: 2 });
    expect(state.sessions).toHaveLength(1);
  });

  it("caps concurrent seats per account regardless of how many device ids it invents", () => {
    // Regression guard for PR #54 review finding #1's second half: varying
    // deviceId alone must not let one account exhaust the tenant's seats.
    let state = emptySeatSessions(5, 2);
    state = connectDevice(state, { userId: "attacker", deviceId: "d1", at: 1 });
    state = connectDevice(state, { userId: "attacker", deviceId: "d2", at: 2 });

    expect(() =>
      connectDevice(state, { userId: "attacker", deviceId: "d3", at: 3 }),
    ).toThrow(UserSeatLimitExceededError);

    try {
      connectDevice(state, { userId: "attacker", deviceId: "d3", at: 3 });
    } catch (err) {
      expect(err).toBeInstanceOf(UserSeatLimitExceededError);
      const userErr = err as UserSeatLimitExceededError;
      expect(userErr.code).toBe("USER_SEAT_LIMIT_EXCEEDED");
      expect(userErr.userId).toBe("attacker");
      expect(userErr.maxSeatsPerUser).toBe(2);
    }

    // A genuinely different account is unaffected — the whole-tenant cap (5)
    // still has room even though "attacker" is maxed out.
    state = connectDevice(state, { userId: "someone-else", deviceId: "till-9", at: 4 });
    expect(state.sessions).toHaveLength(3);
  });

  it("disconnecting an unknown session throws DeviceSessionNotFoundError", () => {
    const state = emptySeatSessions(2, 2);
    expect(() => disconnectDevice(state, "ghost")).toThrow(DeviceSessionNotFoundError);
  });

  it("defaults deviceLabel to deviceId when omitted", () => {
    const state = connectDevice(emptySeatSessions(1, 1), { userId: "u1", deviceId: "till-9" });
    expect(state.sessions[0]!.deviceLabel).toBe("till-9");
  });

  it("withSeatLimit re-points the cap without touching existing sessions", () => {
    let state = emptySeatSessions(1, 1);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 1 });
    state = withSeatLimit(state, 3);
    expect(state.seats).toBe(3);
    expect(state.sessions).toHaveLength(1);

    state = connectDevice(state, { userId: "u2", deviceId: "till-2", at: 2 });
    expect(state.sessions).toHaveLength(2);
  });
});

describe("reapStaleSessions", () => {
  it("drops sessions whose lastSeenAt is older than staleAfterMs", () => {
    let state = emptySeatSessions(3, 3);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 0 });
    state = connectDevice(state, { userId: "u2", deviceId: "till-2", at: 40_000 });

    state = reapStaleSessions(state, 50_000, 45_000);

    expect(state.sessions.map((s) => s.deviceId)).toEqual(["till-2"]);
  });

  it("is a no-op — returns the same reference — when nothing is stale", () => {
    let state = emptySeatSessions(2, 2);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 0 });
    const reaped = reapStaleSessions(state, 1_000, 45_000);
    expect(reaped).toBe(state);
  });

  it("a reaped seat is available again for a new connect", () => {
    let state = emptySeatSessions(1, 1);
    state = connectDevice(state, { userId: "u1", deviceId: "till-1", at: 0 });
    expect(() =>
      connectDevice(state, { userId: "u2", deviceId: "till-2", at: 1_000 }),
    ).toThrow(SeatLimitExceededError);

    state = reapStaleSessions(state, 50_000, 45_000);
    state = connectDevice(state, { userId: "u2", deviceId: "till-2", at: 50_000 });
    expect(state.sessions.map((s) => s.deviceId)).toEqual(["till-2"]);
  });
});

describe("SeatSessionRegistry (stateful convenience wrapper)", () => {
  it("tracks connectedCount and enforces the same seat rule", () => {
    const registry = new SeatSessionRegistry(2, { maxSeatsPerUser: 2 });
    expect(registry.connectedCount).toBe(0);

    registry.connect({ userId: "u1", deviceId: "till-1" });
    registry.connect({ userId: "u2", deviceId: "till-2" });
    expect(registry.connectedCount).toBe(2);

    expect(() => registry.connect({ userId: "u3", deviceId: "till-3" })).toThrow(
      SeatLimitExceededError,
    );
  });

  it("frees a slot on disconnect", () => {
    const registry = new SeatSessionRegistry(1, { maxSeatsPerUser: 1 });
    const first = registry.connect({ userId: "u1", deviceId: "till-1" });
    expect(() => registry.connect({ userId: "u2", deviceId: "till-2" })).toThrow(
      SeatLimitExceededError,
    );

    registry.disconnect(first.sessionId);
    expect(registry.connectedCount).toBe(0);

    const session = registry.connect({ userId: "u2", deviceId: "till-2", deviceLabel: "Front till" });
    expect(session.deviceLabel).toBe("Front till");
    expect(registry.list().map((s) => s.deviceId)).toEqual(["till-2"]);
  });

  it("setSeats adjusts capacity for subsequent connects", () => {
    const registry = new SeatSessionRegistry(1, { maxSeatsPerUser: 2 });
    registry.connect({ userId: "u1", deviceId: "till-1" });
    expect(() => registry.connect({ userId: "u2", deviceId: "till-2" })).toThrow(
      SeatLimitExceededError,
    );

    registry.setSeats(2);
    registry.connect({ userId: "u2", deviceId: "till-2" });
    expect(registry.connectedCount).toBe(2);
  });

  it("reaps a stale session automatically on connect", () => {
    let now = 0;
    const registry = new SeatSessionRegistry(1, {
      maxSeatsPerUser: 1,
      staleAfterMs: 45_000,
      now: () => now,
    });
    registry.connect({ userId: "u1", deviceId: "till-1" });

    now = 50_000;
    // A second, different account's till connecting is what proves the dead
    // seat was actually reclaimed rather than just idle-refreshed.
    const session = registry.connect({ userId: "u2", deviceId: "till-2" });
    expect(session.deviceId).toBe("till-2");
    expect(registry.connectedCount).toBe(1);
  });

  it("reaps a stale session automatically on list", () => {
    let now = 0;
    const registry = new SeatSessionRegistry(2, { now: () => now });
    registry.connect({ userId: "u1", deviceId: "till-1" });

    now = 50_000;
    expect(registry.list()).toHaveLength(0);
    expect(registry.connectedCount).toBe(0);
  });
});
