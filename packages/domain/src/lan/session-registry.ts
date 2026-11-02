/**
 * Seat-session registry — session-level SEAT ENFORCEMENT for LAN multi-till
 * (docs/archive/plan.md §2.5/§6.3.3, licensing memory: the license binds to the HOST;
 * other devices connect over LAN as clients; `seats` is the max number of
 * CONCURRENT connected devices, enforced by the host).
 *
 * A "device session" is one connected till/tablet, identified by a seat key
 * the SERVER derives from the authenticated `userId` (resolved by the caller
 * from a real session token, never from the request body) plus a caller-named
 * `deviceId` label (see @mezan/api's `/lan/sessions` routes). Before the PR
 * #54 review this seat key WAS the caller-supplied `sessionId` — connecting
 * is idempotent only for a repeat of the same id, so any signed-in account
 * could loop with a fresh random id and burn every seat until
 * `SeatLimitExceededError`, the same "the client computed the limit" shape as
 * the return-quantity defect this codebase keeps a standing rule about. The
 * `deviceId` label alone does not close that hole (an attacker can still mint
 * fresh labels), so `maxSeatsPerUser` bounds how many concurrent seats one
 * authenticated account may hold regardless of how many device labels it
 * invents — the exhaustion attack now costs one valid account per seat
 * instead of one HTTP request per seat.
 *
 * This module owns only the capacity rule; transport (HTTP, SSE, IPC) is
 * entirely the adapter's job, same split as workflow/gate.ts.
 *
 * State transitions are pure functions over an immutable `SeatSessionsState`
 * so they are trivial to unit test; `SeatSessionRegistry` is a thin mutable
 * wrapper for callers that want a single shared instance to call methods on
 * (mirrors `EventBus` in events/event-bus.ts).
 */
import { ArabicCase, CountedNoun, CountLocale, countPhrase } from "../text/counted-noun.js";

export interface DeviceSession {
  /** Server-derived seat key (`userId` + `deviceId`), never a caller-chosen id. */
  readonly sessionId: string;
  /** Resolved from the authenticated session at connect time — never the request body. */
  readonly userId: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly appVersion?: string;
  /** Epoch ms of first connect. */
  readonly connectedAt: number;
  /** Epoch ms of the most recent connect/heartbeat. */
  readonly lastSeenAt: number;
}

export interface SeatSessionsState {
  readonly seats: number;
  /** Concurrent-seat cap per authenticated account (see module doc). */
  readonly maxSeatsPerUser: number;
  readonly sessions: readonly DeviceSession[];
}

export class SeatLimitExceededError extends Error {
  readonly code = "SEAT_LIMIT_EXCEEDED";
  readonly messageEn: string;
  constructor(
    readonly seats: number,
    readonly connected: number,
  ) {
    super(`اكتمل عدد الأجهزة التي يسمح بها الترخيص (${connected} من ${seats}). افصل جهازاً من «الأجهزة المتصلة» قبل توصيل جهاز آخر.`);
    this.messageEn =
      `The licence allows ${countPhrase(CountLocale.En, seats, CountedNoun.Device)} and ${connected} ${connected === 1 ? "is" : "are"} connected. ` +
      'Disconnect a device from "Connected devices" before connecting another.';
    this.name = "SeatLimitExceededError";
  }
}

/**
 * Thrown when one account already holds `maxSeatsPerUser` concurrent device
 * sessions. Distinct from `SeatLimitExceededError` (the whole-tenant cap) so
 * the caller can tell "the shop is full" from "YOUR account is holding too
 * many devices" — the latter is what stops a single signed-in account from
 * looping fresh device ids to exhaust every seat by itself.
 */
export class UserSeatLimitExceededError extends Error {
  readonly code = "USER_SEAT_LIMIT_EXCEEDED";
  readonly messageEn: string;
  constructor(
    readonly userId: string,
    readonly maxSeatsPerUser: number,
  ) {
    super(
      `هذا الحساب متصل بالفعل من ${countPhrase(CountLocale.Ar, maxSeatsPerUser, CountedNoun.Device, { grammaticalCase: ArabicCase.Oblique })}، وهو الحد الأقصى للحساب الواحد. ` +
        "افصل أحد أجهزته من «الأجهزة المتصلة» ثم أعد المحاولة، أو استخدم حساباً آخر على هذا الجهاز.",
    );
    this.messageEn =
      `This account is already connected from ${countPhrase(CountLocale.En, maxSeatsPerUser, CountedNoun.Device)}, the limit for one account. ` +
      'Disconnect one of its devices from "Connected devices" and try again, or use another account on this device.';
    this.name = "UserSeatLimitExceededError";
  }
}

export class DeviceSessionNotFoundError extends Error {
  readonly code = "DEVICE_SESSION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly sessionId: string) {
    super(`لا توجد جلسة جهاز متصلة بالمعرّف '${sessionId}'.`);
    this.messageEn = `No connected device session '${sessionId}'`;
    this.name = "DeviceSessionNotFoundError";
  }
}

/**
 * One authenticated account may hold this many concurrent seats by default.
 *
 * ONE, not two. At two, a single cashier account holds BOTH seats of the
 * two-seat licence every small shop buys — so one person signing in on a till
 * and on the back-office machine locks the owner out of their own system, and
 * an attacker who has one account needs no second one to do it deliberately.
 * The legitimate case for a second concurrent seat on one account — the same
 * person on two machines at once — is the case the seat count is meant to be
 * SOLD for, so allowing it by default gave the shop a seat it had not bought.
 *
 * It is still a parameter: a shop that genuinely wants one login on a counter
 * till and a tablet raises it in one place, deliberately.
 */
export const DEFAULT_MAX_SEATS_PER_USER = 1;

/**
 * A session with no heartbeat in this long is presumed dead and reaped on the
 * next connect/list. Set to 3x the SSE heartbeat's own default (15s in
 * lan/routes.ts): `disconnectDevice` used to be the ONLY way a seat was ever
 * freed short of restarting the host, so a till that crashed — or just lost
 * wifi — held its seat forever and the disconnect route needed an admin
 * anyway (see `admin.devices.manage`), turning a dropped connection into an
 * outage for every other till.
 */
export const DEFAULT_STALE_AFTER_MS = 45_000;

export function emptySeatSessions(
  seats: number,
  maxSeatsPerUser: number = DEFAULT_MAX_SEATS_PER_USER,
): SeatSessionsState {
  return { seats, maxSeatsPerUser, sessions: [] };
}

export interface ConnectDeviceInput {
  /** Resolved by the caller from the authenticated session — never the request body. */
  readonly userId: string;
  /** A label the device names for itself (till id, tablet serial, ...). Not a security boundary. */
  readonly deviceId: string;
  readonly deviceLabel?: string;
  readonly appVersion?: string;
  readonly at?: number;
}

function deviceSeatKey(userId: string, deviceId: string): string {
  return `${userId}::${deviceId}`;
}

/**
 * Registers a new device session, enforcing both the whole-tenant seat cap
 * and the per-account cap. Reconnecting with the SAME (`userId`, `deviceId`)
 * pair (a client retrying a dropped connect, or a periodic heartbeat) is
 * idempotent — it only refreshes `lastSeenAt` and never double-counts or
 * re-checks capacity, so a flaky LAN link cannot strand a device that already
 * legitimately holds a seat.
 *
 * @throws UserSeatLimitExceededError when `userId` already holds `maxSeatsPerUser` seats.
 * @throws SeatLimitExceededError when at capacity and this is a genuinely new session.
 */
export function connectDevice(
  state: SeatSessionsState,
  input: ConnectDeviceInput,
): SeatSessionsState {
  const now = input.at ?? Date.now();
  const sessionId = deviceSeatKey(input.userId, input.deviceId);
  const existingIndex = state.sessions.findIndex((s) => s.sessionId === sessionId);

  if (existingIndex >= 0) {
    const sessions = state.sessions.slice();
    const existing = sessions[existingIndex]!;
    sessions[existingIndex] = { ...existing, lastSeenAt: now, ...(input.appVersion ? { appVersion: input.appVersion } : {}) };
    return { ...state, sessions };
  }

  const userSeats = state.sessions.filter((s) => s.userId === input.userId).length;
  if (userSeats >= state.maxSeatsPerUser) {
    throw new UserSeatLimitExceededError(input.userId, state.maxSeatsPerUser);
  }

  if (state.sessions.length >= state.seats) {
    throw new SeatLimitExceededError(state.seats, state.sessions.length);
  }

  const session: DeviceSession = {
    sessionId,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel?.trim() || input.deviceId,
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    connectedAt: now,
    lastSeenAt: now,
  };
  return { ...state, sessions: [...state.sessions, session] };
}

/**
 * Frees the seat held by `sessionId`. This is one of two ways a seat is now
 * released — the other is `reapStaleSessions` catching a device that stopped
 * heartbeating — either an explicit disconnect (client-initiated, or an
 * admin action from the connected-devices panel).
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

/**
 * Drops every session whose `lastSeenAt` is older than `staleAfterMs`. Pure
 * and a no-op (returns the SAME `state` reference) when nothing is stale, so
 * callers can call it unconditionally on every connect/list without churning
 * state for no reason.
 */
export function reapStaleSessions(
  state: SeatSessionsState,
  now: number,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): SeatSessionsState {
  const sessions = state.sessions.filter((s) => now - s.lastSeenAt <= staleAfterMs);
  if (sessions.length === state.sessions.length) return state;
  return { ...state, sessions };
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
export interface SeatSessionRegistryOptions {
  readonly maxSeatsPerUser?: number;
  readonly staleAfterMs?: number;
  /** Injectable clock for reap timing in tests. */
  readonly now?: () => number;
}

export class SeatSessionRegistry {
  private state: SeatSessionsState;
  private readonly staleAfterMs: number;
  private readonly now: () => number;

  constructor(seats: number, options: SeatSessionRegistryOptions = {}) {
    this.state = emptySeatSessions(seats, options.maxSeatsPerUser ?? DEFAULT_MAX_SEATS_PER_USER);
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.now = options.now ?? Date.now;
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
    const now = input.at ?? this.now();
    this.state = reapStaleSessions(this.state, now, this.staleAfterMs);
    this.state = connectDevice(this.state, { ...input, at: now });
    const sessionId = deviceSeatKey(input.userId, input.deviceId);
    // connectDevice always leaves the session present under this key.
    return this.state.sessions.find((s) => s.sessionId === sessionId)!;
  }

  disconnect(sessionId: string): void {
    this.state = disconnectDevice(this.state, sessionId);
  }

  list(): readonly DeviceSession[] {
    this.state = reapStaleSessions(this.state, this.now(), this.staleAfterMs);
    return this.state.sessions;
  }
}
