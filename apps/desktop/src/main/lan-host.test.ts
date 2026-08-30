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
 * legacy `POST /journal-entries` route, which is mounted unconditionally and
 * has no permission gate at all (D99), is reachable across it.
 */
describe("what the LAN socket exposes to a stranger (D109)", () => {
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

  it("LIMITATION (D109 + D99): an unauthenticated device on the shop wifi can post a journal entry into the books", async () => {
    const { uow, handle, port } = await openSocket();

    // No credential, no session, no permission header — just a POST to the
    // socket the licence opens for other tills.
    const res = await fetch(`http://127.0.0.1:${port}/journal-entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });

    expect(res.status).toBe(201);

    // And it is really in the books, not merely echoed back.
    const stored = await uow.journal.findById("JE-FROM-THE-WIFI");
    expect(stored).not.toBeNull();
    expect(stored?.lines).toHaveLength(2);

    // Readable back over the same socket, by the same stranger.
    const read = await fetch(`http://127.0.0.1:${port}/journal-entries/JE-FROM-THE-WIFI`);
    expect(read.status).toBe(200);

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

  it("the same entry is refused when the app is built with a real session resolver", async () => {
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

    // The legacy route is ungated regardless of the resolver, which is what
    // makes D99 the more serious half of this pair: swapping the resolver on
    // the desktop app would NOT close it.
    expect(res.status).toBe(201);
    expect(await uow.journal.findById("JE-STILL-OPEN")).not.toBeNull();

    await handle.close();
    uow.close();
  });
});
