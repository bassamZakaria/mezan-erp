import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { serve } from "@hono/node-server";
import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import { hasFeature, LAN_MULTI_TILL_FEATURE, type Entitlements } from "@mezan/domain";
import type { App } from "@mezan/api";

const FALLBACK_LAN_HOST = "0.0.0.0";
const DEFAULT_LAN_PORT = 4173;

export interface LanHostOptions {
  /** The SAME Hono app instance the IPC bridge already serves in-process. */
  readonly app: App;
  readonly entitlements: Entitlements;
  /**
   * Bind address. Defaults to the first non-internal IPv4 interface — NOT
   * `0.0.0.0`; see `resolveBindAddress` below for what that default cost.
   */
  readonly host?: string;
  /** Bind port. Defaults to 4173; pass 0 in tests for an OS-assigned ephemeral port. */
  readonly port?: number;
}

export interface LanHostHandle {
  readonly enabled: boolean;
  readonly host?: string;
  /** Resolves once the socket is actually bound (or immediately with null when !enabled). */
  readonly ready: Promise<AddressInfo | null>;
  /** The real bound address once listening (null before then, or when !enabled). */
  address(): AddressInfo | null;
  /**
   * `http://192.168.1.7:4173` — the URL a till is pointed at — or null when
   * there is none to hand out.
   *
   * This is the "future 'show me the LAN address' UI" the comment below has
   * been promising: the address was logged to a console the shop never opens,
   * so provisioning a till meant a consultant finding the host's IP by hand.
   *
   * NULL IS A REAL ANSWER AND MUST STAY ONE. Before the socket is bound there
   * is no port to name, and when `resolveBindAddress` fell back to `0.0.0.0`
   * there is no dialable address at all — printing either as a URL would put a
   * number on screen that no till can reach.
   */
  url(): string | null;
  close(): Promise<void>;
}

const NOOP_HANDLE: LanHostHandle = {
  enabled: false,
  ready: Promise.resolve(null),
  address: () => null,
  url: () => null,
  close: async () => {},
};

interface LanRoute {
  /** null means "any method" — used only for the `/lan` sub-app. */
  readonly method: string | null;
  readonly path: string;
  /** True when `path` also matches everything below it. */
  readonly subtree?: boolean;
}

/**
 * THE ONLY THINGS THIS SOCKET SERVES.
 *
 * It used to serve `options.app.fetch` directly, and `options.app` is the whole
 * backend `createBackend` composes — so `/bootstrap/admin`, `/bootstrap/seed`,
 * `/users`, `/gl`, `/reports` and `/tenant`'s neighbours were all on the shop
 * wifi the moment a licence carried `lan.multi_till`. `/bootstrap/admin` is the
 * second half of the anonymous-tenant-takeover chain (see auth-routes.ts): on a
 * tenant that read as unclaimed, an anonymous POST from any phone on that wifi
 * came back holding `permissions: ["*"]`. Nothing below reaches it, and nothing
 * below can be widened by a header.
 *
 * DENY BY DEFAULT, and the list is deliberately this short. `POST /auth/login`
 * has to be here — a till signs in over this socket BEFORE it holds a seat, and
 * only then presents the bearer token to `/lan/sessions`, so blocking login
 * bricks every till — and `/lan/*` is the seat protocol itself. `GET /tenant`
 * returns the shop's own name and nothing else; the till's login screen renders
 * its header from it, and the name is on the sign outside. `GET /health` is how
 * a till tells "host is off" from "host refused me".
 *
 * There is no wider "read set a till needs" here because there is no till
 * screen in this build to derive one from (POS is out of v1 scope), and a guess
 * at that list would be a guess at which of ~40 routers leaks the customer
 * ledger. When a real till screen lands, each route it needs gets added here
 * ONE AT A TIME, with the reason, rather than a prefix that quietly re-opens
 * everything mounted under it later.
 */
const LAN_ALLOWED_ROUTES: readonly LanRoute[] = [
  { method: "POST", path: "/auth/login" },
  { method: "POST", path: "/auth/logout" },
  { method: "GET", path: "/tenant" },
  { method: "GET", path: "/health" },
  { method: null, path: "/lan", subtree: true },
];

/**
 * Matches against the RAW pathname, never a decoded one. `new URL()` collapses
 * `..` segments, so `/lan/../users` arrives here already normalised to
 * `/users` and is refused; a percent-encoded `/%61uth/login` matches nothing
 * here AND matches nothing in Hono's router either (it routes on the raw path
 * too), so refusing it cannot strand a real caller.
 */
function isAllowedOverLan(method: string, pathname: string): boolean {
  return LAN_ALLOWED_ROUTES.some((route) => {
    if (route.method !== null && route.method !== method) return false;
    if (route.subtree) return pathname === route.path || pathname.startsWith(`${route.path}/`);
    return pathname === route.path;
  });
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/**
 * The remote address as this process should judge it.
 *
 * Node hands back `::ffff:192.168.1.40` for an IPv4 peer on a dual-stack
 * socket, and a bare `192.168.1.40` on an IPv4-only one — the same till, two
 * spellings, and comparing the raw string against the interface list matched
 * only one of them. The zone suffix on a link-local IPv6 (`fe80::1%en0`) is
 * likewise not part of the address.
 */
export function normalizeRemoteAddress(raw: string): string {
  const withoutZone = raw.split("%")[0] ?? raw;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(withoutZone);
  return mapped?.[1] ?? withoutZone.toLowerCase();
}

/**
 * True when `remote` sits inside a subnet this machine is itself attached to.
 *
 * Read fresh on every request rather than cached at bind time, deliberately: a
 * shop laptop that goes home on a phone hotspot, or that a technician moves to
 * a different VLAN, keeps the socket open across the change, and a cached
 * subnet list would go on trusting the network it is no longer on.
 *
 * Loopback is included (it is one of this host's own interfaces) so the
 * host's own tooling and the tests reach the socket the same way a till does.
 */
export function isOnOwnSubnet(remote: string): boolean {
  const remoteV4 = ipv4ToInt(remote);
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const family = String(entry.family);
      if (family === "IPv4" || family === "4") {
        if (remoteV4 === null) continue;
        const localV4 = ipv4ToInt(entry.address);
        const mask = ipv4ToInt(entry.netmask);
        if (localV4 === null || mask === null) continue;
        if (((remoteV4 & mask) >>> 0) === ((localV4 & mask) >>> 0)) return true;
        continue;
      }
      // IPv6 gets exact-address equality only, not prefix arithmetic. A shop
      // LAN is IPv4 in every install this ships to; treating a /64 as "our
      // subnet" would hand trust to a whole ISP-delegated prefix for a case
      // nobody uses, and getting that arithmetic wrong is how an allow-list
      // becomes an allow-everything.
      if (normalizeRemoteAddress(entry.address) === remote) return true;
    }
  }
  return false;
}

/**
 * Which address to actually bind.
 *
 * The default used to be `0.0.0.0`, which is EVERY interface — so a machine
 * with a 4G dongle, a bridged VM adapter, or a second NIC on a guest network
 * published the books past the subnet the shop meant to share them on. The
 * `0.0.0.0` fallback stays only for the case where the host genuinely has no
 * non-internal IPv4 interface (no cable, no wifi), and it says so loudly,
 * because that is a state somebody should look at rather than one to ship into
 * silently.
 */
function resolveBindAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4") continue;
      return entry.address;
    }
  }
  console.warn(
    "[lan] no non-internal IPv4 interface found — binding 0.0.0.0 (EVERY interface, " +
      "including any 4G dongle or bridged adapter). Requests are still refused unless " +
      "they come from one of this host's own subnets.",
  );
  return FALLBACK_LAN_HOST;
}

/**
 * Binds the SAME shared Hono app (docs/archive/plan.md §2.2's "one HTTP app, two
 * mount points") to a LAN-visible HTTP socket, ALONGSIDE — never instead of
 * — the host's own no-port IPC mount (main/ipc.ts). Tills/tablets on the shop
 * LAN then reach the exact app the host itself uses in-process, including
 * `/lan/sessions` seat enforcement, over plain http+SSE (§2.6, §6.3.3).
 *
 * Gated by the `lan.multi_till` license flag: when the resolved entitlements
 * don't carry it, this is a pure no-op — no socket is ever opened, so an
 * unlicensed install exposes nothing on the LAN. Closed by default, exactly
 * like every other license-gated capability in this codebase.
 *
 * Two further filters sit in front of `app.fetch` — the path allow-list
 * (`LAN_ALLOWED_ROUTES`) and the own-subnet check (`isOnOwnSubnet`) — because
 * a licence is not a credential and a subnet is not an authorisation: they
 * shrink what a stranger on the wifi can even address, and the session gates
 * inside the app still decide who may do it.
 *
 * Deliberately free of any `electron` import (unlike main/index.ts) so it is
 * exercised directly by vitest — same split as main/backup-hooks.ts.
 */
export function startLanHost(options: LanHostOptions): LanHostHandle {
  if (!hasFeature(options.entitlements, LAN_MULTI_TILL_FEATURE)) {
    return NOOP_HANDLE;
  }

  const hostname = options.host ?? resolveBindAddress();
  const port = options.port ?? DEFAULT_LAN_PORT;

  const handle = (
    request: Request,
    env: HttpBindings | Http2Bindings,
  ): Response | Promise<Response> => {
    const remoteRaw = env.incoming.socket.remoteAddress;
    const remote = remoteRaw ? normalizeRemoteAddress(remoteRaw) : null;

    if (remote === null || !isOnOwnSubnet(remote)) {
      console.warn(`[lan] refused ${request.method} from off-subnet address ${remoteRaw ?? "unknown"}`);
      return Response.json(
        {
          error: "OFF_SUBNET",
          message: "هذا الجهاز ليس على شبكة المنشأة. This device is not on the company network.",
        },
        { status: 403 },
      );
    }

    const pathname = new URL(request.url).pathname;
    if (!isAllowedOverLan(request.method, pathname)) {
      // 404, not 403, and byte-identical to Hono's own not-found body: a 403
      // would confirm that `/bootstrap/admin` exists and is merely fenced off,
      // which is the one fact a stranger on the wifi should not be handed.
      return new Response("404 Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=UTF-8" },
      });
    }

    // `env` is FORWARDED, not dropped. The backend reads the peer address off
    // it (packages/api/src/request-origin.ts) to decide whether a login is
    // host-local or came over the network, and swallowing it here would have
    // counted every remote login attempt against the host's own throttle key.
    return options.app.fetch(request, env);
  };

  let resolveReady!: (info: AddressInfo) => void;
  const ready = new Promise<AddressInfo | null>((resolve) => {
    resolveReady = resolve;
  });

  // Node's `server.listen(port, host, cb)` only binds synchronously when no
  // hostname is given (or one that skips DNS lookup entirely); passing an
  // explicit hostname — which this always does — defers the actual bind, so
  // callers that need the resolved address (tests; the connected-devices
  // screen, via `url()`) must await `ready` rather than read it right away.
  const server = serve({ fetch: handle, hostname, port }, (info: AddressInfo) => {
    console.log(
      `[lan] multi-till host listening on http://${hostname}:${info.port} ` +
        `(seats=${options.entitlements.seats}, ` +
        `routes=${LAN_ALLOWED_ROUTES.map((r) => r.path).join(" ")})`,
    );
    resolveReady(info);
  });

  const boundAddress = (): AddressInfo | null => (server.address() as AddressInfo | null) ?? null;

  return {
    enabled: true,
    host: hostname,
    ready,
    address: boundAddress,
    url: () => {
      const info = boundAddress();
      if (!info) return null;
      if (hostname === FALLBACK_LAN_HOST) return null;
      // An IPv6 literal is only a legal URL host inside brackets; a caller may
      // pass one via `options.host` even though `resolveBindAddress` never does.
      const authority = hostname.includes(":") ? `[${hostname}]` : hostname;
      return `http://${authority}:${info.port}`;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
