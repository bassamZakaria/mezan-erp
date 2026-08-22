/**
 * Seat-session registry — session-level SEAT ENFORCEMENT for LAN multi-till
 * (docs/plan.md §2.5/§6.3.3, licensing memory: the license binds to the HOST;
 * other devices connect over LAN as clients; `seats` is the max number of
 * CONCURRENT connected devices, enforced by the host).
 *
 * A "device session" is one connected till/tablet, identified by a caller-
 * supplied `sessionId` (the LAN client mints it once at connect time and
 * reuses it for reconnects/heartbeats — see @mezan/api's `/lan/sessions`
 * routes). This module owns only the capacity rule; transport (HTTP, SSE,
 * IPC) is entirely the adapter's job, same split as workflow/gate.ts.
 *
 * State transitions are pure functions over an immutable `SeatSessionsState`
 * so they are trivial to unit test; `SeatSessionRegistry` is a thin mutable
 * wrapper for callers that want a single shared instance to call methods on
 * (mirrors `EventBus` in events/event-bus.ts).
 */

export interface DeviceSession {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  /** Epoch ms of first connect. */
  readonly connectedAt: number;
  /** Epoch ms of the most recent connect/heartbeat. */
  readonly lastSeenAt: number;
}

export interface SeatSessionsState {
  readonly seats: number;
  readonly sessions: readonly DeviceSession[];
}

export class SeatLimitExceededError extends Error {
  readonly code = "SEAT_LIMIT_EXCEEDED";
  constructor(
    readonly seats: number,
    readonly connected: number,
  ) {
    super(
      `Seat limit reached: ${connected}/${seats} devices already connected. ` +
        "Disconnect a device before connecting another.",
    );
    this.name = "SeatLimitExceededError";
  }
}

export class DeviceSessionNotFoundError extends Error {
  readonly code = "DEVICE_SESSION_NOT_FOUND";
  constructor(readonly sessionId: string) {
    super(`No connected device session '${sessionId}'`);
    this.name = "DeviceSessionNotFoundError";
  }
}

export function emptySeatSessions(seats: number): SeatSessionsState {
  return { seats, sessions: [] };
}

export interface ConnectDeviceInput {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly deviceLabel?: string;
  readonly at?: number;
}

/**
 * Registers a new device session, enforcing the seat cap. Reconnecting with
 * the SAME `sessionId` (a client retrying a dropped connect, or a periodic
 * heartbeat) is idempotent — it only refreshes `lastSeenAt` and never
 * double-counts or re-checks capacity, so a flaky LAN link cannot strand a
 * device that already legitimately holds a seat.
 *
 * @throws SeatLimitExceededError when at capacity and this is a genuinely new session.
 */
export function connectDevice(
  state: SeatSessionsState,
  input: ConnectDeviceInput,
): SeatSessionsState {
  const now = input.at ?? Date.now();
  const existingIndex = state.sessions.findIndex((s) => s.sessionId === input.sessionId);

  if (existingIndex >= 0) {
    const sessions = state.sessions.slice();
    const existing = sessions[existingIndex]!;
    sessions[existingIndex] = { ...existing, lastSeenAt: now };
    return { ...state, sessions };
  }

  if (state.sessions.length >= state.seats) {
    throw new SeatLimitExceededError(state.seats, state.sessions.length);
  }

  const session: DeviceSession = {
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel?.trim() || input.deviceId,
    connectedAt: now,
    lastSeenAt: now,
  };
  return { ...state, sessions: [...state.sessions, session] };
}

/**
 * Frees the seat held by `sessionId`. This is the ONLY way a seat is
 * released short of the host process restarting — an explicit disconnect
 * (client-initiated, or an admin action from the connected-devices panel).
 *
 * @throws DeviceSessionNotFoundError when no such session is connected.
 */
export function disconnectDevice(
  state: SeatSessionsState,
  sessionId: string,
): SeatSessionsState {
  const exists = state.sessions.some((s) => s.sessionId === sessionId);
  if (!exists) throw new DeviceSessionNotFoundError(sessionId);
  return { ...state, sessions: state.sessions.filter((s) => s.sessionId !== sessionId) };
}

/** Re-points the seat cap at a freshly re-verified entitlements value. */
export function withSeatLimit(state: SeatSessionsState, seats: number): SeatSessionsState {
  return { ...state, seats };
}

/**
 * Mutable convenience wrapper around the pure transitions above, for callers
 * (the `/lan/sessions` routes, the LAN host bootstrap) that want one shared,
 * stateful registry rather than threading state through themselves. Mirrors
 * `EventBus`'s shape in events/event-bus.ts.
 */
export class SeatSessionRegistry {
  private state: SeatSessionsState;

  constructor(seats: number) {
    this.state = emptySeatSessions(seats);
  }

  get seats(): number {
    return this.state.seats;
  }

  get connectedCount(): number {
    return this.state.sessions.length;
  }

  setSeats(seats: number): void {
    this.state = withSeatLimit(this.state, seats);
  }

  connect(input: ConnectDeviceInput): DeviceSession {
    this.state = connectDevice(this.state, input);
    // connectDevice always leaves the session present under input.sessionId.
    return this.state.sessions.find((s) => s.sessionId === input.sessionId)!;
  }

  disconnect(sessionId: string): void {
    this.state = disconnectDevice(this.state, sessionId);
  }

  list(): readonly DeviceSession[] {
    return this.state.sessions;
  }
}
