import { describe, it, expect } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createApp, createSessionAuthContextResolver, createSessionRegistry } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { startLanHost } from "./lan-host.js";

function buildHonoApp(entitlements: ReturnType<typeof createEntitlements>) {
  const uow = createSqliteUnitOfWork(":memory:");
  const registry = new SeatSessionRegistry(entitlements.seats);
  const app = createApp(uow, { lan: { resolveEntitlements: () => entitlements, registry } });
  return { app, close: () => uow.close() };
}

describe("startLanHost", () => {
  it("does not open a socket when the license lacks lan.multi_till (safe default: closed)", async () => {
    const entitlements = createEntitlements({
      plan: "STANDARD",
      activeModules: ["sales"],
      features: {},
      seats: 3,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, port: 0 });
    expect(handle.enabled).toBe(false);
    expect(handle.address()).toBeNull();

    await handle.close();
    close();
  });

  it("binds a real LAN-visible socket serving the SAME shared app when the flag is on", async () => {
    const entitlements = createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, host: "127.0.0.1", port: 0 });
    expect(handle.enabled).toBe(true);

    const address = await handle.ready;
    expect(address).not.toBeNull();
    const port = address!.port;
    expect(port).toBeGreaterThan(0);
    expect(handle.address()).not.toBeNull();

    // Prove it's actually the shared app: /lan/status (mounted via createApp's
    // lan option) is reachable over the real socket, not just in-process.
    const res = await fetch(`http://127.0.0.1:${port}/lan/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ licensed: true, seats: 2, connected: 0 });

    await handle.close();
    close();
  });
});


/**
 * What the LAN socket exposes, over the exact composition
 * `apps/desktop/src/main/index.ts` ships: `createApp(uow, { lan })` with no
 * `resolveAuthContext`, so the default header resolver governs — and the
 * legacy `POST /journal-entries` route, which is mounted unconditionally.
 *
 * That route now carries a permission gate (D99), so the socket no longer
 * hands the books to a stranger on the shop wifi. These tests hold both halves:
 * the refusal, and the fact that nothing was written behind it.
 */
describe("what the LAN socket exposes to a stranger (D109, D99)", () => {
  const multiTill = () =>
    createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales", "accounting"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });

  async function openSocket() {
    const entitlements = multiTill();
    const uow = createSqliteUnitOfWork(":memory:");
    const registry = new SeatSessionRegistry(entitlements.seats);
    const app = createApp(uow, { lan: { resolveEntitlements: () => entitlements, registry } });
    const handle = startLanHost({ app, entitlements, host: "127.0.0.1", port: 0 });
    const address = await handle.ready;
    return { uow, handle, port: (address as { port: number }).port };
  }

  const entry = {
    id: "JE-FROM-THE-WIFI",
    date: "2026-08-22",
    memo: "قيد من جهاز على الشبكة",
    lines: [
      { accountId: "1300-1", debit: "5000.00", credit: "0" },
      { accountId: "4000", debit: "0", credit: "5000.00" },
    ],
  };

  it("D99: an unauthenticated device on the shop wifi is refused, and nothing reaches the books", async () => {
    const { uow, handle, port } = await openSocket();

    // No credential, no session, no permission header — just a POST to the
    // socket the licence opens for other tills.
    const res = await fetch(`http://127.0.0.1:${port}/journal-entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });

    expect(res.status).toBe(403);

    // The status code is the smaller half; the books are the point.
    expect(await uow.journal.findById("JE-FROM-THE-WIFI")).toBeNull();

    const read = await fetch(`http://127.0.0.1:${port}/journal-entries/JE-FROM-THE-WIFI`);
    expect(read.status).toBe(403);

    await handle.close();
    uow.close();
  });

  it("LIMITATION (D109): the desktop composition passes no session resolver, so `x-permissions` is what governs", async () => {
    const { uow, handle, port } = await openSocket();

    // `/lan/status` is the one surface that is meant to be open. What matters
    // is that nothing in this composition ever checks a session: the app was
    // built without `resolveAuthContext`, so any gated route mounted into it
    // later would trust this header.
    const status = await fetch(`http://127.0.0.1:${port}/lan/status`, {
      headers: { "x-permissions": "*", "x-user-id": "stranger" },
    });
    expect(status.status).toBe(200);

    await handle.close();
    uow.close();
  });

  it("the same entry is refused with a 401 when the app is built with a real session resolver", async () => {
    const entitlements = multiTill();
    const uow = createSqliteUnitOfWork(":memory:");
    const sessions = createSessionRegistry();
    const registry = new SeatSessionRegistry(entitlements.seats);
    const app = createApp(uow, {
      lan: { resolveEntitlements: () => entitlements, registry },
      resolveAuthContext: createSessionAuthContextResolver(sessions),
    });
    const handle = startLanHost({ app, entitlements, host: "127.0.0.1", port: 0 });
    const address = await handle.ready;
    const port = (address as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/journal-entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entry, id: "JE-STILL-OPEN" }),
    });

    // With a real session resolver the stranger has no session at all, so the
    // gate D99 added answers 401 rather than 403 — and either way nothing is
    // written.
    expect(res.status).toBe(401);
    expect(await uow.journal.findById("JE-STILL-OPEN")).toBeNull();

    await handle.close();
    uow.close();
  });
});
