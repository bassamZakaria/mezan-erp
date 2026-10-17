import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { createSqliteSessionStore, openSqliteConnection } from "@mezan/persistence";
import { createSessionRegistry, DEVICE_MISMATCH_LIMIT, MAX_SESSION_MS, SessionRefusalKind, type SessionLimits, type SessionRegistry } from "./session-auth.js";

type Connection = ReturnType<typeof openSqliteConnection>["sqlite"];

const TILL = "192.168.1.20";
const PHONE = "41.33.10.10";
const LIMITS: SessionLimits = { idleMs: 30 * 60 * 1000, maxMs: 8 * 60 * 60 * 1000 };
const grantOf = (userId: string) => ({ userId, permissions: ["sales.view"], roleCode: "clerk", branchScope: ["B-1"], warehouseScope: ALL_SCOPE });

const dirs: string[] = [];
const connections: Connection[] = [];

afterEach(() => {
  for (const sqlite of connections.splice(0)) if (sqlite.open) sqlite.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function databaseFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-sessions-"));
  dirs.push(dir);
  return path.join(dir, "tenant.db");
}

function instance(file: string, clock: { at: number }): { readonly sessions: SessionRegistry; readonly sqlite: Connection } {
  const { sqlite } = openSqliteConnection(file);
  connections.push(sqlite);
  return { sessions: createSessionRegistry(() => clock.at, LIMITS, createSqliteSessionStore(sqlite)), sqlite };
}

function count(sqlite: Connection, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("sessions held in the database two server instances share", () => {
  it("lets a token minted on one instance be used on the other, with the grant it was issued", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const token = a.sessions.issue(grantOf("u-1"), TILL);

    expect(b.sessions.find(token, TILL)).toMatchObject({ userId: "u-1", permissions: ["sales.view"], roleCode: "clerk", branchScope: ["B-1"], warehouseScope: ALL_SCOPE });
  });

  it("ends a session on both instances when one revokes it, or revokes its user", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const signedOut = a.sessions.issue(grantOf("u-1"), TILL);
    const first = a.sessions.issue(grantOf("u-2"), TILL);
    const second = b.sessions.issue(grantOf("u-2"), TILL);

    a.sessions.revoke(signedOut);
    b.sessions.revokeUser("u-2");

    expect(b.sessions.inspect(signedOut, TILL)).toEqual({ grant: null, refusal: null });
    expect(a.sessions.find(first, TILL)).toBeNull();
    expect(a.sessions.find(second, TILL)).toBeNull();
  });

  it("refuses a token moved to another address on every instance once one has refused it", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const token = a.sessions.issue(grantOf("u-1"), TILL);

    expect(b.sessions.inspect(token, "192.168.1.99").refusal?.reason).toBe(SessionRefusalKind.Moved);
    expect(a.sessions.find(token, TILL)).toBeNull();
  });

  it("counts refusals of a missing device secret across instances and ends the session at the limit", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const { token, deviceSecret } = a.sessions.issueDeviceBound(grantOf("u-1"), PHONE);

    for (let refused = 1; refused < DEVICE_MISMATCH_LIMIT; refused += 1) {
      const on = refused % 2 === 0 ? a : b;
      clock.at += 1000;
      expect(on.sessions.inspect(token, PHONE, "a-guess").refusal).toMatchObject({ reason: SessionRefusalKind.Device, sessionEnded: false });
    }
    clock.at += 1000;
    expect(a.sessions.inspect(token, PHONE, "a-guess").refusal).toMatchObject({ reason: SessionRefusalKind.Device, sessionEnded: true });
    expect(b.sessions.find(token, PHONE, deviceSecret)).toBeNull();
  });

  it("tells the first user's tab on the other instance that another user signed in on the device", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const first = a.sessions.issueDeviceBound(grantOf("u-1"), PHONE);
    const second = a.sessions.issueDeviceBound(grantOf("u-2"), PHONE, first.deviceSecret);

    const ended = b.sessions.inspect(first.token, PHONE, second.deviceSecret);
    expect(ended.grant).toBeNull();
    expect(ended.refusal).toMatchObject({ reason: SessionRefusalKind.Displaced, userId: "u-1" });
    expect(b.sessions.find(second.token, PHONE, second.deviceSecret)?.userId).toBe("u-2");
  });

  it("ends the same user's earlier session on the device when they sign in again with the secret it holds", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const first = a.sessions.issueDeviceBound(grantOf("u-1"), PHONE);
    const again = b.sessions.issueDeviceBound(grantOf("u-1"), PHONE, first.deviceSecret);

    expect(again.deviceSecret).toBe(first.deviceSecret);
    expect(a.sessions.inspect(first.token, PHONE, first.deviceSecret)).toEqual({ grant: null, refusal: null });
    expect(a.sessions.find(again.token, PHONE, again.deviceSecret)?.userId).toBe("u-1");
  });

  it("asks for the PIN again on the other instance after a move, and stops asking once one instance has it", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const b = instance(file, clock);
    const { token, deviceSecret } = a.sessions.issueDeviceBound(grantOf("u-1"), PHONE);

    expect(a.sessions.inspect(token, "102.44.7.1", deviceSecret).addressChange).toMatchObject({ from: PHONE, to: "102.44.7.1" });
    expect(b.sessions.needsStepUp(token)).toBe(true);
    b.sessions.confirmStepUp(token);
    expect(a.sessions.needsStepUp(token)).toBe(false);
    expect(a.sessions.inspect(token, "102.44.7.1", deviceSecret).addressChange ?? null).toBeNull();
  });

  it("keeps a session across a restart of the server", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const before = instance(file, clock);
    const token = before.sessions.issue(grantOf("u-1"), TILL);
    before.sqlite.close();

    clock.at += 60_000;
    expect(instance(file, clock).sessions.find(token, TILL)?.userId).toBe("u-1");
  });

  it("stores only the token's hash, never the token or the device secret", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const { token, deviceSecret } = a.sessions.issueDeviceBound(grantOf("u-1"), PHONE);

    const dump = JSON.stringify(a.sqlite.prepare("SELECT * FROM auth_session").all());
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(deviceSecret);
  });

  it("refuses a session idle past its bound or older than its cap, and sweeps both from the table", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const idle = a.sessions.issue(grantOf("u-1"), TILL);
    const busy = a.sessions.issue(grantOf("u-2"), TILL);

    for (let at = 0; at < LIMITS.maxMs; at += LIMITS.idleMs / 2) {
      clock.at += LIMITS.idleMs / 2;
      expect(a.sessions.find(busy, TILL)?.userId).toBe("u-2");
    }
    expect(a.sessions.inspect(idle, TILL).refusal?.reason).toBe(SessionRefusalKind.Idle);
    clock.at += LIMITS.idleMs / 2;
    expect(a.sessions.inspect(busy, TILL).refusal?.reason).toBe(SessionRefusalKind.Aged);

    const stale = a.sessions.issue(grantOf("u-3"), TILL);
    clock.at += LIMITS.idleMs + 1;
    a.sessions.issue(grantOf("u-4"), TILL);
    expect(a.sessions.find(stale, TILL)).toBeNull();
    expect(count(a.sqlite, "auth_session")).toBe(1);
  });

  it("writes the last-seen time at most once a minute, however often the session is used", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const a = instance(file, clock);
    const token = a.sessions.issue(grantOf("u-1"), TILL);
    const lastSeen = () => (a.sqlite.prepare("SELECT last_seen_at AS at FROM auth_session").get() as { at: number }).at;

    clock.at += 30_000;
    a.sessions.find(token, TILL);
    expect(lastSeen()).toBe(1_000_000);
    clock.at += 30_000;
    a.sessions.find(token, TILL);
    expect(lastSeen()).toBe(1_060_000);
  });

  it("holds a cloud tenant to the shorter cap a later release sets, for a session issued under a longer one", () => {
    const file = databaseFile();
    const clock = { at: 1_000_000 };
    const { sqlite } = openSqliteConnection(file);
    connections.push(sqlite);
    const lenient = createSessionRegistry(() => clock.at, { idleMs: MAX_SESSION_MS, maxMs: MAX_SESSION_MS }, createSqliteSessionStore(sqlite));
    const token = lenient.issue(grantOf("u-1"), TILL);

    clock.at += LIMITS.idleMs + 1;
    expect(instance(file, clock).sessions.inspect(token, TILL).refusal?.reason).toBe(SessionRefusalKind.Idle);
  });
});
