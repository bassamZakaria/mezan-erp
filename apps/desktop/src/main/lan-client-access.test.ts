import { request as httpsRequest } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createBackend, SEED_ADMIN_EMAIL, SEED_ADMIN_PIN } from "@mezan/backend";
import { startLanHost } from "./lan-host.js";
import { createLanClientAuthorizer } from "./lan-authorization.js";
import { loadOrCreateLanTlsIdentity, type LanTlsIdentity } from "./lan-tls.js";

/**
 * THE SECOND MACHINE, end to end, over a real TLS socket.
 *
 * The LAN socket served five routes and refused the rest, which made the
 * multi-user licence a licence to sign in and do nothing: a second machine
 * could authenticate, take a seat, and then read no invoice and post no entry.
 * These tests are the boundary of what widening that actually opened — and each
 * one names a way a stranger on the shop wifi must still be turned away, since
 * "the client can now reach the app" and "anyone can now reach the app" differ
 * by exactly the checks in lan-authorization.ts.
 */
const scratchDirs: string[] = [];
let identityPromise: Promise<LanTlsIdentity> | undefined;

function identity(): Promise<LanTlsIdentity> {
  if (!identityPromise) {
    identityPromise = mkdtemp(path.join(tmpdir(), "mezan-lan-client-")).then((dir) => {
      scratchDirs.push(dir);
      return loadOrCreateLanTlsIdentity(path.join(dir, "mezan.db"));
    });
  }
  return identityPromise;
}

afterAll(async () => {
  for (const dir of scratchDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function lanFetch(
  port: number,
  pathname: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  const ca = (await identity()).cert;
  return new Promise((resolve, reject) => {
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

function multiTill() {
  return createEntitlements({
    plan: "ENTERPRISE",
    activeModules: ["sales", "purchases", "inventory", "accounting"],
    features: { "lan.multi_till": true },
    seats: 2,
    expiresAt: null,
  });
}

/**
 * The whole host, wired exactly as main/index.ts wires it.
 *
 * guards Q-1 — BOTH SEAMS ARE ASYNC HERE, and that is the shipped shape. The
 * backend and the two registries live in a separate process now
 * (main/backend-process.ts), so `app.fetch` and the authorisation decision both
 * cross a MessagePort. The Promise wrappers below stand in for that hop: the
 * seat check must still be taken on EVERY request against the live registries,
 * and every refusal in this file must still be a refusal when the answer
 * arrives a tick later.
 */
async function startHost() {
  const entitlements = multiTill();
  const seatRegistry = new SeatSessionRegistry(entitlements.seats);
  const backend = await createBackend({
    dbPath: ":memory:",
    lan: { resolveEntitlements: () => entitlements, registry: seatRegistry },
  });
  const authorize = createLanClientAuthorizer({
    resolveSessionUser: async (token, origin) => (await backend.sessions.find(token, origin))?.userId ?? null,
    registry: seatRegistry,
  });
  const handle = startLanHost({
    app: {
      fetch: async (request: Request, env?: unknown) =>
        await backend.app.fetch(request, env as Parameters<typeof backend.app.fetch>[1]),
    },
    entitlements,
    tls: identity,
    host: "127.0.0.1",
    port: 0,
    authorizeClientRequest: async (request, remote) => authorize(request, remote),
  });
  const port = (await handle.ready)!.port;
  return {
    backend,
    seatRegistry,
    port,
    async stop() {
      await handle.close();
      backend.close();
    },
  };
}

/** Signs in over the LAN socket — the only way a client gets a token at all. */
async function login(port: number): Promise<string> {
  const res = await lanFetch(port, "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
  });
  expect(res.status).toBe(200);
  return (JSON.parse(res.body) as { token: string }).token;
}

async function takeSeat(port: number, token: string, deviceId = "DEVICE-A"): Promise<void> {
  const res = await lanFetch(port, "/lan/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, deviceLabel: "الكاشير الثاني" }),
  });
  expect(res.status).toBe(201);
}

describe("a connected client reaches the books; nobody else does", () => {
  it("serves an ordinary data route to a client that has signed in AND taken a seat", async () => {
    const host = await startHost();
    const token = await login(host.port);

    // Signed in, not yet connected. This is the state the product used to leave
    // every second machine in permanently.
    const beforeSeat = await lanFetch(host.port, "/items", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beforeSeat.status).toBe(404);

    await takeSeat(host.port, token);

    const afterSeat = await lanFetch(host.port, "/items", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterSeat.status).toBe(200);

    await host.stop();
  });

  it("refuses a caller with no token at all", async () => {
    const host = await startHost();
    // Someone else has a seat — the seat is not what authorises THIS request.
    await takeSeat(host.port, await login(host.port));

    expect((await lanFetch(host.port, "/items")).status).toBe(404);

    await host.stop();
  });

  it("refuses a made-up bearer token", async () => {
    const host = await startHost();
    await takeSeat(host.port, await login(host.port));

    const res = await lanFetch(host.port, "/items", {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(404);

    await host.stop();
  });

  /**
   * The host's own renderer holds a token bound to the in-process mount
   * (`origin` null — session-auth.ts). If that token worked from the wire, then
   * anyone who read it out of the host machine — a support session, a stolen
   * laptop, a shoulder — would hold the shop's books from the car park, without
   * ever consuming a seat or appearing on the connected-devices screen.
   */
  it("refuses the host's own in-process token when it is replayed over the network", async () => {
    const host = await startHost();
    const clientToken = await login(host.port);
    await takeSeat(host.port, clientToken);

    const hostSideLogin = await host.backend.app.fetch(
      new Request("http://ipc/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
      }),
    );
    expect(hostSideLogin.status).toBe(200);
    const hostToken = ((await hostSideLogin.json()) as { token: string }).token;

    const res = await lanFetch(host.port, "/items", {
      headers: { authorization: `Bearer ${hostToken}` },
    });
    expect(res.status).toBe(404);

    await host.stop();
  });

  /**
   * Disconnecting a device from the connected-devices screen used to free a
   * number while the machine kept working. Now it is the authorisation itself,
   * re-read per request.
   */
  it("stops serving a client the moment its seat is released", async () => {
    const host = await startHost();
    const token = await login(host.port);
    await takeSeat(host.port, token, "DEVICE-B");
    expect((await lanFetch(host.port, "/items", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

    const sessionId = host.seatRegistry.list()[0]!.sessionId;
    host.seatRegistry.disconnect(sessionId);

    const after = await lanFetch(host.port, "/items", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(404);

    await host.stop();
  });

  /**
   * The anonymous-tenant-takeover route, from a caller who is as authorised as
   * this socket can make anybody. The never-list is checked before the
   * authorizer for exactly this reason: widening what a client may reach must
   * never be able to widen this.
   */
  it("keeps /bootstrap unreachable even for a fully connected client", async () => {
    const host = await startHost();
    const token = await login(host.port);
    await takeSeat(host.port, token);

    const res = await lanFetch(host.port, "/bootstrap/status", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    // ...and it is genuinely mounted; the socket is what refuses it.
    expect((await host.backend.app.fetch(new Request("http://ipc/bootstrap/status"))).status).toBe(200);

    await host.stop();
  });
});
