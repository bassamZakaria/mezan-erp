import { describe, it, expect } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createApp, createSessionAuthContextResolver, createSessionRegistry } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { createBackend, SEED_ADMIN_EMAIL } from "@mezan/backend";
import { isOnOwnSubnet, normalizeRemoteAddress, startLanHost } from "./lan-host.js";

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
 * `apps/desktop/src/main/index.ts` ships.
 *
 * D109 was: the socket served `app.fetch` whole, so every router the backend
 * mounts — `/bootstrap/*`, `/users`, `/gl`, `/reports`, and the ungated legacy
 * `POST /journal-entries` (D99) — answered anyone on the shop wifi. The
 * allow-list in lan-host.ts is what closed it; these are the tests that keep
 * it closed, because a route added to the backend next month must not become
 * LAN-reachable by default.
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

  it("refuses the ungated legacy journal-entry route, and writes nothing", async () => {
    const { uow, handle, port } = await openSocket();

    const res = await fetch(`http://127.0.0.1:${port}/journal-entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });

    expect(res.status).toBe(404);
    expect(await uow.journal.findById("JE-FROM-THE-WIFI")).toBeNull();

    const read = await fetch(`http://127.0.0.1:${port}/journal-entries/JE-FROM-THE-WIFI`);
    expect(read.status).toBe(404);

    await handle.close();
    uow.close();
  });

  it("answers 404 — not 403 — for a route it holds back, so the refusal confirms nothing", async () => {
    const { uow, handle, port } = await openSocket();

    for (const path of ["/bootstrap/status", "/bootstrap/seed", "/users", "/gl/accounts"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST" });
      expect([path, res.status]).toEqual([path, 404]);
    }

    // A path that never existed answers identically, so "fenced off" and
    // "not a route" are indistinguishable from the wifi.
    const nonsense = await fetch(`http://127.0.0.1:${port}/there-is-no-such-route`);
    expect(nonsense.status).toBe(404);

    await handle.close();
    uow.close();
  });

  it("does not let a path trick reach a held-back route", async () => {
    const { uow, handle, port } = await openSocket();

    for (const path of ["/lan/../journal-entries", "/lan/../../bootstrap/status", "/%62ootstrap/status"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect([path, res.status]).toEqual([path, 404]);
    }

    await handle.close();
    uow.close();
  });

  /**
   * Against the REAL composition main/index.ts ships (`createBackend`, which
   * is what mounts `/auth`, `/tenant` and `/health` at all), not the bare
   * `createApp` above — otherwise "login answers" would pass on a build where
   * the route was never mounted, which is the failure this asserts against.
   */
  it("keeps the till's boot path open, and only it, on the real backend", async () => {
    const entitlements = multiTill();
    const backend = await createBackend({
      dbPath: ":memory:",
      lan: { resolveEntitlements: () => entitlements, registry: new SeatSessionRegistry(2) },
    });
    const handle = startLanHost({ app: backend.app, entitlements, host: "127.0.0.1", port: 0 });
    const port = (await handle.ready)!.port;

    // A till signs in over this socket BEFORE it holds a seat, then presents
    // the token to /lan/sessions. 401 is the route answering; 404 would mean
    // the till can never boot at all.
    const login = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: "000001" }),
    });
    expect(login.status).toBe(401);

    expect((await fetch(`http://127.0.0.1:${port}/auth/logout`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/tenant`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/lan/status`)).status).toBe(401);

    // The takeover chain's second half, on the composition that actually
    // mounts it: unreachable, and indistinguishable from a route that is not
    // there. The same POST over the IPC mount still works.
    const takeover = await fetch(`http://127.0.0.1:${port}/bootstrap/admin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nameAr: "دخيل", nameEn: null, email: "x@y.com", pin: "123456" }),
    });
    expect(takeover.status).toBe(404);
    expect((await backend.app.fetch(new Request("http://ipc/bootstrap/status"))).status).toBe(200);

    await handle.close();
    backend.close();
  });

  it("still refuses the legacy route when the app carries a real session resolver", async () => {
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

    // `POST /journal-entries` is ungated inside the app regardless of the
    // resolver (D99), which is exactly why the allow-list — not the resolver —
    // is what has to keep it off this socket.
    expect(res.status).toBe(404);
    expect(await uow.journal.findById("JE-STILL-OPEN")).toBeNull();

    await handle.close();
    uow.close();
  });
});

/**
 * The socket used to bind `0.0.0.0` and answer whoever reached it, so a routed
 * address — a 4G dongle's peer, a bridged VM's network, anything the host's
 * default route can carry — was as welcome as the till two metres away. The
 * subnet check is the fence; these are its two directions.
 */
describe("isOnOwnSubnet", () => {
  it("accepts this host's own loopback, in both spellings", () => {
    expect(isOnOwnSubnet("127.0.0.1")).toBe(true);
    expect(isOnOwnSubnet(normalizeRemoteAddress("::ffff:127.0.0.1"))).toBe(true);
    expect(isOnOwnSubnet("::1")).toBe(true);
  });

  it("refuses a routable address that is on no interface of this machine", () => {
    // TEST-NET-3 / the IPv6 documentation prefix — reserved, so no CI runner
    // can accidentally be attached to them and make this pass for free.
    expect(isOnOwnSubnet("203.0.113.7")).toBe(false);
    expect(isOnOwnSubnet(normalizeRemoteAddress("::ffff:203.0.113.7"))).toBe(false);
    expect(isOnOwnSubnet("2001:db8::1")).toBe(false);
  });
});
