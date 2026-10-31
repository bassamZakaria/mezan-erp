import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { createServer as createTcpServer, connect as tcpConnect, type AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, it, expect, vi } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createApp, createSessionAuthContextResolver, createSessionRegistry } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { createBackend, SEED_ADMIN_EMAIL } from "@mezan/backend";
import {
  createSourceRateLimiter,
  isOnOwnSubnet,
  normalizeRemoteAddress,
  startLanHost,
} from "./lan-host.js";
import { loadOrCreateLanTlsIdentity, type LanTlsIdentity } from "./lan-tls.js";

/**
 * ONE identity for the whole file, minted into a scratch directory. Reusing it
 * is not just speed: it is the same reuse the product does, so a test that
 * pins a fingerprint pins the one every socket below presents.
 */
const scratchDirs: string[] = [];
let identityPromise: Promise<LanTlsIdentity> | undefined;

function identity(): Promise<LanTlsIdentity> {
  if (!identityPromise) {
    identityPromise = mkdtemp(path.join(tmpdir(), "mezan-lan-host-")).then((dir) => {
      scratchDirs.push(dir);
      return loadOrCreateLanTlsIdentity(path.join(dir, "mezan.db"));
    });
  }
  return identityPromise;
}

afterAll(async () => {
  for (const dir of scratchDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface LanResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * A request over the LAN socket, the way a till makes one: TLS, with the
 * host's own certificate as the trust anchor. `ca` rather than
 * `rejectUnauthorized: false` deliberately — it means these tests would also
 * fail if the certificate stopped covering `127.0.0.1` in its SAN.
 */
async function lanFetch(
  port: number,
  pathname: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<LanResponse> {
  const ca = (await identity()).cert;
  return new Promise<LanResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: init?.method ?? "GET",
        headers: init?.headers,
        ca: [ca],
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    if (init?.body !== undefined) req.write(init.body);
    req.end();
  });
}

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
    const tls = vi.fn(identity);

    const handle = startLanHost({ app, entitlements, tls, port: 0 });
    expect(handle.enabled).toBe(false);
    expect(handle.address()).toBeNull();
    // Not even the certificate is touched: an unlicensed install writes no key
    // to disk and advertises no fingerprint.
    expect(tls).not.toHaveBeenCalled();
    expect(handle.fingerprint()).toBeNull();

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

    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
    expect(handle.enabled).toBe(true);

    const address = await handle.ready;
    expect(address).not.toBeNull();
    const port = address!.port;
    expect(port).toBeGreaterThan(0);
    expect(handle.address()).not.toBeNull();

    // Prove it's actually the shared app: /lan/status (mounted via createApp's
    // lan option) is reachable over the real socket, not just in-process.
    const res = await lanFetch(port, "/lan/status");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ licensed: true, seats: 2, connected: 0 });

    await handle.close();
    close();
  });
});

/**
 * THE WIRE ITSELF.
 *
 * The socket served plain HTTP, so `POST /auth/login`'s password and the bearer
 * token it answers with crossed a WPA2-PSK shop network in clear text — a key
 * the staff, the delivery drivers and the customers all hold. The token is
 * bound to no device, no address and no seat and lives twelve hours
 * (api/session-auth.ts), so one capture is an admin until closing time.
 *
 * Encryption alone would not have been enough: the certificate is self-signed
 * and validated against no chain, so a laptop answering first on the host's
 * address can present its own. What closes that is the till PINNING the
 * fingerprint — which only works if the value on the host's screen is
 * byte-identical to what the till's TLS stack computes. That equality is what
 * the first test below asserts, over a real handshake.
 */
describe("the LAN socket is TLS, and it is the certificate the screen names", () => {
  const multiTill = () =>
    createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });

  it("presents exactly the fingerprint the connected-devices screen is told to display", async () => {
    const entitlements = multiTill();
    const { app, close } = buildHonoApp(entitlements);
    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
    const port = (await handle.ready)!.port;

    const peerFingerprint = await new Promise<string>((resolve, reject) => {
      // `rejectUnauthorized: false` is what a PINNING client does: it does not
      // consult a chain at all, it compares this one value.
      const socket = tlsConnect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        resolve(cert.fingerprint256);
      });
      socket.on("error", reject);
    });

    expect(peerFingerprint).toBe(handle.fingerprint());
    expect(handle.fingerprint()).toBe((await identity()).fingerprintSha256);

    await handle.close();
    close();
  });

  it("does not answer a plain-HTTP request — there is no clear-text mount to fall back to", async () => {
    const entitlements = multiTill();
    const { app, close } = buildHonoApp(entitlements);
    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
    const port = (await handle.ready)!.port;

    // The exact call the old build answered with 200 and a JSON body.
    await expect(fetch(`http://127.0.0.1:${port}/lan/status`)).rejects.toThrow();
    await expect(
      fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, password: "wrong-password" }),
      }),
    ).rejects.toThrow();

    await handle.close();
    close();
  });

  it("spells the URL https, because that is what a till must dial", async () => {
    const entitlements = multiTill();
    const { app, close } = buildHonoApp(entitlements);
    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
    const port = (await handle.ready)!.port;

    expect(handle.url()).toBe(`https://127.0.0.1:${port}`);

    await handle.close();
    close();
  });

  /**
   * The one branch that must never quietly degrade. A socket the shop believes
   * is encrypted, and is not, is worse than no LAN feature: nobody goes
   * looking for plaintext they have been told cannot be there.
   */
  it("leaves the socket CLOSED when the identity cannot be read — it never falls back to HTTP", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const entitlements = multiTill();
    const { app, close } = buildHonoApp(entitlements);

    // A known-free port, so "nothing is listening" is provable rather than
    // inferred from an ephemeral port that was never assigned.
    const port = await new Promise<number>((resolve) => {
      const probe = createTcpServer();
      probe.listen(0, "127.0.0.1", () => {
        const assigned = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(assigned));
      });
    });

    const handle = startLanHost({
      app,
      entitlements,
      tls: () => Promise.reject(new Error("no key on disk")),
      host: "127.0.0.1",
      port,
    });

    expect(await handle.ready).toBeNull();
    expect(handle.address()).toBeNull();
    expect(handle.url()).toBeNull();
    expect(handle.fingerprint()).toBeNull();

    const refused = await new Promise<string>((resolve) => {
      const socket = tcpConnect(port, "127.0.0.1");
      socket.on("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", (err: NodeJS.ErrnoException) => resolve(err.code ?? "error"));
    });
    expect(refused).toBe("ECONNREFUSED");

    // And it said so, loudly, rather than starting a plain socket in silence.
    expect(errors.mock.calls.flat().join(" ")).toMatch(/STAYED CLOSED/);

    await handle.close();
    close();
    errors.mockRestore();
  });

  it("reports a port it cannot bind instead of hanging on `ready` forever", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const entitlements = multiTill();
    const { app, close } = buildHonoApp(entitlements);

    // 4173 is the default port, and a second Mezan instance — or anything else
    // holding it — is the ordinary way this fails in a shop.
    const squatter = createTcpServer();
    const port = await new Promise<number>((resolve) => {
      squatter.listen(0, "127.0.0.1", () => resolve((squatter.address() as AddressInfo).port));
    });

    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port });

    expect(await handle.ready).toBeNull();
    expect(handle.url()).toBeNull();
    // The identity was read, so it is still nameable — but nothing is serving
    // it, and `listening` (licence-ipc.ts) is false because `address()` is null.
    expect(handle.address()).toBeNull();
    expect(errors).toHaveBeenCalled();

    await handle.close();
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
    close();
    errors.mockRestore();
  });
});

/**
 * What the LAN socket exposes, over the exact composition
 * `apps/desktop/src/main/index.ts` ships.
 *
 * D109 was: the socket served `app.fetch` whole, so every router the backend
 * mounts — `/bootstrap/*`, `/users`, `/gl/*`, `/reports` — answered anyone on
 * the shop wifi. The allow-list in lan-host.ts is what closed it; these are the
 * tests that keep it closed, because a route added to the backend next month
 * must not become LAN-reachable by default.
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
    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
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

  /**
   * The address went to a console the shop never opens, and provisioning a
   * till meant a consultant finding the host's IP by hand.
   */
  it("hands out the dialable URL a till is pointed at, once the socket is bound", async () => {
    const entitlements = createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
    // Before the bind completes there is no port to name, so there is no URL
    // either — null, never a plausible-looking default.
    expect(handle.url()).toBeNull();

    const address = await handle.ready;
    expect(handle.url()).toBe(`https://127.0.0.1:${address!.port}`);

    await handle.close();
    close();
  });

  it("gives no URL at all when LAN mode is unlicensed", () => {
    const entitlements = createEntitlements({
      plan: "STANDARD",
      activeModules: ["sales"],
      features: {},
      seats: 3,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, tls: identity, port: 0 });
    expect(handle.url()).toBeNull();
    close();
  });

  // `0.0.0.0` is EVERY interface, not an address; printing it as a URL would
  // put a number on screen that no till can reach.
  it("refuses to spell the 0.0.0.0 fallback as a URL", async () => {
    const entitlements = createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, tls: identity, host: "0.0.0.0", port: 0 });
    await handle.ready;
    expect(handle.address()).not.toBeNull();
    expect(handle.url()).toBeNull();
    // The fingerprint is still knowable, and still the thing to pin: it is a
    // property of the identity, not of whether the address is printable.
    expect(handle.fingerprint()).toBe((await identity()).fingerprintSha256);

    await handle.close();
    close();
  });

  it("refuses the posting route to a stranger, and writes nothing", async () => {
    const { uow, handle, port } = await openSocket();

    const res = await lanFetch(port, "/gl/journal-entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });

    expect(res.status).toBe(404);
    expect(await uow.journal.findById("JE-FROM-THE-WIFI")).toBeNull();

    const read = await lanFetch(port, "/gl/journal-entries/JE-FROM-THE-WIFI");
    expect(read.status).toBe(404);

    await handle.close();
    uow.close();
  });

  it("answers 404 — not 403 — for a route it holds back, so the refusal confirms nothing", async () => {
    const { uow, handle, port } = await openSocket();

    for (const pathname of ["/bootstrap/status", "/bootstrap/seed", "/users", "/gl/accounts"]) {
      const res = await lanFetch(port, pathname, { method: "POST" });
      expect([pathname, res.status]).toEqual([pathname, 404]);
    }

    // A path that never existed answers identically, so "fenced off" and
    // "not a route" are indistinguishable from the wifi.
    const nonsense = await lanFetch(port, "/there-is-no-such-route");
    expect(nonsense.status).toBe(404);

    await handle.close();
    uow.close();
  });

  /**
   * guards Q-1 — THE AUTHORISER ANSWERS A TICK LATER NOW.
   *
   * The session and seat registries moved into the backend process with the
   * database, so this socket asks across a MessagePort and the answer is a
   * promise. A refusal that is only a refusal while the check is synchronous is
   * not a refusal: an un-awaited promise is truthy, and every stranger on the
   * shop wifi would have been let straight through.
   */
  it("waits for an asynchronous authorisation before serving a fenced route", async () => {
    const entitlements = multiTill();
    const backend = await createBackend({
      dbPath: ":memory:",
      lan: { resolveEntitlements: () => entitlements, registry: new SeatSessionRegistry(2) },
    });

    const asked: string[] = [];
    const handle = startLanHost({
      app: backend.app,
      entitlements,
      tls: identity,
      host: "127.0.0.1",
      port: 0,
      authorizeClientRequest: async (request) => {
        await Promise.resolve();
        asked.push(new URL(request.url).pathname);
        return false;
      },
    });
    const port = (await handle.ready)!.port;

    // 404 is the SOCKET's refusal. If the promise had been used unawaited it
    // would have been truthy, the request would have reached the app, and the
    // app would have answered 401 — which is what the paired test above sees.
    const res = await lanFetch(port, "/customers");
    expect(res.status).toBe(404);
    expect(asked).toEqual(["/customers"]);

    await handle.close();
    backend.close();
  });

  it("serves a fenced route once the asynchronous authorisation says yes", async () => {
    const entitlements = multiTill();
    const backend = await createBackend({
      dbPath: ":memory:",
      lan: { resolveEntitlements: () => entitlements, registry: new SeatSessionRegistry(2) },
    });
    const handle = startLanHost({
      app: backend.app,
      entitlements,
      tls: identity,
      host: "127.0.0.1",
      port: 0,
      authorizeClientRequest: async () => {
        await Promise.resolve();
        return true;
      },
    });
    const port = (await handle.ready)!.port;

    // `/customers` is fenced — a stranger gets the socket's own 404. Reached,
    // it is the APP that answers, and it answers 401 because this caller holds
    // no session. Telling those two apart is the whole point.
    const refusedByTheSocket = await lanFetch(port, "/customers");
    expect(refusedByTheSocket.status).toBe(401);

    await handle.close();
    backend.close();
  });

  it("does not let a path trick reach a held-back route", async () => {
    const { uow, handle, port } = await openSocket();

    for (const pathname of [
      "/lan/../gl/journal-entries",
      "/lan/../../bootstrap/status",
      "/%62ootstrap/status",
    ]) {
      const res = await lanFetch(port, pathname);
      expect([pathname, res.status]).toEqual([pathname, 404]);
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
    const handle = startLanHost({
      app: backend.app,
      entitlements,
      tls: identity,
      host: "127.0.0.1",
      port: 0,
    });
    const port = (await handle.ready)!.port;

    // A till signs in over this socket BEFORE it holds a seat, then presents
    // the token to /lan/sessions. 401 is the route answering; 404 would mean
    // the till can never boot at all.
    const login = await lanFetch(port, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: SEED_ADMIN_EMAIL, password: "wrong-password" }),
    });
    expect(login.status).toBe(401);

    expect((await lanFetch(port, "/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await lanFetch(port, "/health")).status).toBe(200);
    expect((await lanFetch(port, "/tenant")).status).toBe(200);
    expect((await lanFetch(port, "/lan/status")).status).toBe(401);
    // A temporary-password till holds no seat until it changes the password,
    // so the change must reach the app (401 without a token), not the socket's 404.
    expect((await lanFetch(port, "/profile")).status).toBe(401);
    expect(
      (await lanFetch(port, "/profile/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
    ).toBe(401);

    // The takeover chain's second half, on the composition that actually
    // mounts it: unreachable, and indistinguishable from a route that is not
    // there. The same POST over the IPC mount still works.
    const takeover = await lanFetch(port, "/bootstrap/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nameAr: "دخيل", nameEn: null, email: "x@y.com", password: "Intruder-123", companyName: "متجر الاختبار" }),
    });
    expect(takeover.status).toBe(404);
    expect((await backend.app.fetch(new Request("http://ipc/bootstrap/status"))).status).toBe(200);

    await handle.close();
    backend.close();
  });

  it("still refuses the posting route when the app carries a real session resolver", async () => {
    const entitlements = multiTill();
    const uow = createSqliteUnitOfWork(":memory:");
    const sessions = createSessionRegistry();
    const registry = new SeatSessionRegistry(entitlements.seats);
    const app = createApp(uow, {
      lan: { resolveEntitlements: () => entitlements, registry },
      resolveAuthContext: createSessionAuthContextResolver(sessions),
    });
    const handle = startLanHost({ app, entitlements, tls: identity, host: "127.0.0.1", port: 0 });
    const address = await handle.ready;
    const port = (address as { port: number }).port;

    const res = await lanFetch(port, "/gl/journal-entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entry, id: "JE-STILL-OPEN" }),
    });

    // `POST /gl/journal-entries` carries a permission gate, so with a real
    // session resolver a stranger would get 401 from the gate. This still
    // asserts 404, and that difference is the point: the allow-list refuses the
    // route before any gate is consulted, so the socket's safety does not
    // depend on every route below it having been remembered.
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

/** The licensed-for-multi-till entitlements every case below starts from. */
function multiTillEntitlements() {
  return createEntitlements({
    plan: "ENTERPRISE",
    activeModules: ["sales"],
    features: { "lan.multi_till": true },
    seats: 2,
    expiresAt: null,
  });
}

/**
 * guards N-5: «الشبكة المحلية غير مشغّلة» covered four unrelated faults with
 * four different fixes, and the distinguishing reason went to a console the
 * shop never opens. One sentence and no named cause is one support call per
 * install.
 */
describe("why the local network is not serving", () => {
  it("says NOT_LICENSED when the licence does not carry multi-till", () => {
    const handle = startLanHost({
      app: { fetch: () => new Response("") } as never,
      entitlements: createEntitlements({
        plan: "STANDARD",
        activeModules: ["sales"],
        features: {},
        seats: 1,
        expiresAt: null,
      }),
      tls: () => Promise.reject(new Error("never reached")),
    });

    expect(handle.enabled).toBe(false);
    expect(handle.closedReason()).toBe("NOT_LICENSED");
  });

  it("says TLS_UNAVAILABLE — not a plain-HTTP fallback — when the identity cannot be read", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = startLanHost({
      app: { fetch: () => new Response("") } as never,
      entitlements: multiTillEntitlements(),
      port: 0,
      host: "127.0.0.1",
      tls: () => Promise.reject(new Error("the certificate is not readable")),
    });

    await handle.ready;
    expect(handle.address()).toBeNull();
    expect(handle.closedReason()).toBe("TLS_UNAVAILABLE");
    await handle.close();
    warn.mockRestore();
  });

  it("says PORT_IN_USE when something else already holds the port", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const squatter = createTcpServer(() => {});
    await new Promise<void>((resolve) => squatter.listen(0, "127.0.0.1", () => resolve()));
    const port = (squatter.address() as AddressInfo).port;

    const tls = await identity();
    const handle = startLanHost({
      app: { fetch: () => new Response("") } as never,
      entitlements: multiTillEntitlements(),
      host: "127.0.0.1",
      port,
      tls: async () => tls,
    });

    await handle.ready;
    expect(handle.closedReason()).toBe("PORT_IN_USE");

    await handle.close();
    await new Promise<void>((r) => squatter.close(() => r()));
    error.mockRestore();
  });

  it("reports null once the socket is genuinely serving", async () => {
    const tls = await identity();
    const handle = startLanHost({
      app: { fetch: () => new Response("ok") } as never,
      entitlements: multiTillEntitlements(),
      host: "127.0.0.1",
      port: 0,
      tls: async () => tls,
    });

    await handle.ready;
    expect(handle.closedReason()).toBeNull();
    // guards N-6: the host can reach its own advertised address, which is the
    // one probe that separates "not listening" from "a firewall is dropping
    // the packets" — the failure INSTALL.md §7A.3 calls the likeliest there is.
    const reachability = await handle.testReachability(2_000);
    expect(reachability.reachable).toBe(true);
    expect(reachability.detail).toBeNull();

    await handle.close();
  });
});

/**
 * guards N-12: the login ladder counts CREDENTIAL failures; nothing counted
 * requests, so a device on the shop wifi could hold the host's single-threaded
 * event loop — the one every SQLite call runs on — at whatever rate it liked,
 * with no account at all.
 */
describe("createSourceRateLimiter", () => {
  it("lets a busy till through and stops a loop, per source address", () => {
    let now = 1_000_000;
    const within = createSourceRateLimiter(() => now, 5, 1_000);

    for (let i = 0; i < 5; i += 1) expect(within("192.168.1.40")).toBe(true);
    expect(within("192.168.1.40")).toBe(false);
    // A second till is unaffected: the ceiling belongs to the address.
    expect(within("192.168.1.41")).toBe(true);

    // The window rolls, and the till that hit the ceiling is served again.
    now += 1_000;
    expect(within("192.168.1.40")).toBe(true);
  });
});
