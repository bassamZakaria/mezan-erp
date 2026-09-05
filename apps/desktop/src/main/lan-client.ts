import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { ClientConfig } from "./client-config.js";

/**
 * The client half of "multiple users, same data": every renderer request on a
 * CLIENT machine, forwarded to the host over a certificate-pinned TLS socket.
 *
 * It slots in exactly where main/ipc.ts's `registerHonoOverIpc` slots in on the
 * host — same IPC channel, same request and response shape — so nothing in
 * apps/web branches on which machine it is running on. The renderer calls
 * `window.mezan.fetch("/sales-invoices")` and does not know, and must not need
 * to know, whether that was answered by a Hono app in this process or by one
 * three metres away.
 *
 * PINNING, AND WHY IT IS DONE BY HAND HERE.
 *
 * The host's certificate is self-signed (main/lan-tls.ts) — there is no CA on a
 * shop LAN and no DNS name to certify — so ordinary chain validation cannot
 * pass and `rejectUnauthorized: true` would refuse every legitimate host. The
 * replacement is not "turn verification off": it is to check the ONE thing that
 * actually identifies this host, its certificate's SHA-256 fingerprint, against
 * the value a human compared on screen at setup (docs/INSTALL.md §6.3).
 *
 * THE HANDSHAKE HAPPENS FIRST, ON ITS OWN, and the HTTP request is only handed
 * a socket that has already been verified. The obvious shape — `https.request`
 * with a `secureConnect` listener — DOES NOT WORK, and it fails in the one
 * direction that matters: Node's HTTP client attaches its own socket handling
 * first, so by the time a listener added afterwards runs, the request line,
 * headers and body have already been written to the impostor. That was caught
 * by the test that asserts the server saw NOTHING (lan-client.test.ts), which
 * is the only assertion that can tell the two implementations apart — a test
 * that merely checked for a thrown error passes on both.
 *
 * Every request this transport carries has either a PIN in its body
 * (`/auth/login`) or a bearer token in its headers, so "sent it, then decided
 * it was the wrong machine" is indistinguishable from having no pin at all.
 *
 * The cost is one handshake per request: there is no connection reuse here yet.
 * On a shop LAN that is a sub-millisecond round trip, and it buys an ordering
 * that is obviously correct rather than one that depends on the order Node
 * attaches its own listeners in.
 */
export interface LanClientResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export class LanClientError extends Error {
  constructor(
    message: string,
    readonly code: "PIN_MISMATCH" | "UNREACHABLE" | "TIMEOUT",
  ) {
    super(message);
    this.name = "LanClientError";
  }
}

export interface LanClientOptions {
  readonly config: ClientConfig;
  /** How long to wait for the host before giving up. Default 30s. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeFingerprint(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/**
 * Constant-time-ish equality on the fingerprint. Not because a timing attack on
 * a hash comparison over a shop LAN is a realistic threat, but because the
 * alternative — `===` on a value an attacker controls one half of — is the kind
 * of thing that gets copied into a place where it does matter.
 */
function fingerprintMatches(expected: string, presented: string): boolean {
  const a = normalizeFingerprint(expected);
  const b = normalizeFingerprint(presented);
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Completes a TLS handshake and resolves ONLY if the peer is the pinned host.
 *
 * On a mismatch the socket is destroyed and this rejects — nothing has been
 * written to it, because nothing but the handshake has happened yet.
 */
function connectPinned(
  host: URL,
  expectedFingerprint: string,
  timeoutMs: number,
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      {
        host: host.hostname,
        port: Number(host.port),
        // SNI only for a real name. RFC 6066 forbids an IP literal there, and
        // a host is almost always addressed by IP on a shop LAN — Node warns
        // today and will ignore it outright in a future version. Nothing is
        // lost: the identity comes from the fingerprint, not the name.
        ...(isIP(host.hostname) ? {} : { servername: host.hostname }),
        // The chain cannot validate — the certificate is self-signed and there
        // is no CA on a shop LAN. The fingerprint below is the identity check
        // that replaces it, and it is made before this function resolves.
        rejectUnauthorized: false,
      },
      () => {
        const presented = socket.getPeerCertificate().fingerprint256 ?? "";
        if (!fingerprintMatches(expectedFingerprint, presented)) {
          socket.destroy();
          reject(
            new LanClientError(
              `The machine answering at ${host.origin} is not the host this client was paired with. ` +
                `Expected certificate ${expectedFingerprint}, got ${presented || "none"}. ` +
                `Nothing was sent. If the host was reinstalled, re-pair this client; otherwise somebody else is answering on that address.`,
              "PIN_MISMATCH",
            ),
          );
          return;
        }
        socket.setTimeout(0);
        resolve(socket);
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(
        new LanClientError(
          `No answer from ${host.origin} within ${timeoutMs}ms. Is the host machine on, and on this network?`,
          "TIMEOUT",
        ),
      );
    });

    socket.on("error", (err) => {
      reject(
        new LanClientError(`Could not reach the Mezan host at ${host.origin}: ${err.message}`, "UNREACHABLE"),
      );
    });
  });
}

export function createLanClient(options: LanClientOptions) {
  const host = new URL(options.config.hostUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function forward(
    pathAndQuery: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<LanClientResponse> {
    // Rejects before a byte is written when the peer is not the pinned host.
    const socket = await connectPinned(host, options.config.fingerprintSha256, timeoutMs);

    return new Promise((resolve, reject) => {
      const target = new URL(pathAndQuery, host);
      const requestOptions: RequestOptions = {
        // The socket is already connected AND already verified; `createConnection`
        // hands it to the HTTP client rather than letting it open its own.
        createConnection: () => socket,
        protocol: "https:",
        hostname: host.hostname,
        port: host.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers: {
          ...init.headers,
          // The host reads the seat and the session from the request; it must
          // never see a Host header naming something else.
          host: host.host,
        },
        timeout: timeoutMs,
      };

      const req = httpsRequest(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") headers[key] = value;
            else if (Array.isArray(value)) headers[key] = value.join(", ");
          }
          resolve({
            status: res.statusCode ?? 502,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(
          new LanClientError(
            `No answer from ${options.config.hostUrl} within ${timeoutMs}ms. Is the host machine on, and on this network?`,
            "TIMEOUT",
          ),
        );
      });

      req.on("error", (err) => {
        // A pin mismatch destroys the socket, which then also surfaces here as
        // an ordinary socket error. The first rejection wins, so this cannot
        // overwrite the specific message with a generic one — but the guard is
        // written down because the ordering is not obvious.
        reject(
          err instanceof LanClientError
            ? err
            : new LanClientError(
                `Could not reach the Mezan host at ${options.config.hostUrl}: ${err.message}`,
                "UNREACHABLE",
              ),
        );
      });

      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
  };
}

export type LanForward = ReturnType<typeof createLanClient>;

const LOGIN_PATH = "/auth/login";
const LOGOUT_PATH = "/auth/logout";

/**
 * SIGNING IN IS NOT CONNECTING, and the client has to do both.
 *
 * A seat is what the licence actually counts, and the host refuses every data
 * route to a session that does not hold one (main/lan-authorization.ts). The
 * renderer cannot claim it: the seat belongs to this MACHINE, and the machine's
 * stable `deviceId` lives in client.json, in this process — a renderer-chosen id
 * would mint a new seat on every launch until the shop ran out.
 *
 * WITHOUT THIS the client logs in successfully, renders the whole shell, and
 * then 404s on every screen — which is exactly what the first live two-machine
 * run did. A login that leaves the app unable to load a single page is worse
 * than a refused one, because it looks like the product is broken rather than
 * like the shop is out of seats.
 *
 * So a failed seat claim is returned AS the login result. The renderer already
 * knows how to show a refused login; it has nothing to show for "logged in but
 * seatless", because that state should not exist.
 */
/**
 * How often a client re-announces itself to the host.
 *
 * `SeatSessionRegistry` reaps any session whose `lastSeenAt` is older than
 * `DEFAULT_STALE_AFTER_MS` (45s in @mezan/domain), and it reaps on READ — so a
 * client that claims a seat and then goes quiet loses it inside a minute, and
 * every request after that gets the stranger's 404. The live two-machine run
 * showed exactly this: the dashboard loaded on login and was empty again a
 * minute later, with nothing in any log to say why.
 *
 * Well under half the stale window, so one dropped beat is not a disconnection.
 * `POST /lan/sessions` is idempotent per (user, device) and refreshes
 * `lastSeenAt`, which is why the heartbeat is the same call as the claim.
 */
const SEAT_HEARTBEAT_MS = 15_000;

export function withSeatClaim(forward: LanForward, config: ClientConfig): LanForward {
  let heldSessionId: string | null = null;
  let heartbeat: NodeJS.Timeout | undefined;
  let lastToken: string | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const claimSeat = async (token: string): Promise<boolean> => {
    const seat = await forward("/lan/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: config.deviceId, deviceLabel: config.deviceLabel }),
    });
    if (seat.status !== 201) {
      console.error(`[client] the host refused this device a seat (HTTP ${seat.status}): ${seat.body}`);
      return false;
    }
    try {
      heldSessionId = (JSON.parse(seat.body) as { sessionId?: string }).sessionId ?? null;
    } catch {
      heldSessionId = null;
    }
    lastToken = token;

    if (!heartbeat) {
      heartbeat = setInterval(() => {
        if (!lastToken) return;
        void forward("/lan/sessions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${lastToken}` },
          body: JSON.stringify({ deviceId: config.deviceId, deviceLabel: config.deviceLabel }),
        }).then(
          (res) => {
            // A 401 means the session died on the host (restart, revocation,
            // expiry). Stop beating rather than knocking every 15 seconds
            // forever; the next real request re-claims through the 404 path.
            if (res.status === 401 || res.status === 403) {
              heldSessionId = null;
              lastToken = null;
              stopHeartbeat();
            }
          },
          () => undefined,
        );
      }, SEAT_HEARTBEAT_MS);
      // Do not hold the process open for a heartbeat: quitting is quitting.
      heartbeat.unref?.();
    }
    return true;
  };

  const bearerOf = (headers?: Record<string, string>): string | null => {
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (key.toLowerCase() !== "authorization") continue;
      const [scheme, token] = value.split(" ");
      if (scheme?.toLowerCase() === "bearer" && token) return token;
    }
    return null;
  };

  return async (pathAndQuery, init = {}) => {
    const pathname = pathAndQuery.split("?")[0];

    if (pathname === LOGOUT_PATH && heldSessionId) {
      // Free the seat before the token dies, not after: once the session is
      // revoked the host has no way to attribute the disconnect, and the seat
      // sits occupied until the stale-session reaper gets to it.
      await forward(`/lan/sessions/${encodeURIComponent(heldSessionId)}`, {
        method: "DELETE",
        headers: init.headers,
      }).catch(() => undefined);
      heldSessionId = null;
      lastToken = null;
      stopHeartbeat();
      return forward(pathAndQuery, init);
    }

    const response = await forward(pathAndQuery, init);

    if (pathname === LOGIN_PATH && response.status === 200) {
      let token: string | undefined;
      try {
        token = (JSON.parse(response.body) as { token?: string }).token;
      } catch {
        token = undefined;
      }
      if (token && !(await claimSeat(token))) {
        // The seat refusal IS the login result. See the note above: "logged in
        // but seatless" is a state with no screen and no recovery.
        return {
          status: 403,
          headers: { "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            error: "NO_SEAT",
            message:
              "لا توجد مقاعد شاغرة في ترخيص الجهاز الرئيسي. افصل جهازاً آخر من شاشة «الأجهزة المتصلة» أو زد عدد المقاعد.",
          }),
        };
      }
      return response;
    }

    /**
     * RECOVERY, and it must NOT be conditional on believing we still hold a seat.
     *
     * Two live failures land here, and an earlier version of this guarded on
     * `heldSessionId === null` and therefore fixed only the first:
     *
     *   1. THE RESUMED SESSION. The renderer keeps its token across restarts, so
     *      a client reopened in the morning posts no login at all — it goes
     *      straight to the dashboard holding yesterday's token and no seat.
     *   2. THE LAPSED SEAT. The host reaps a session that has not been seen for
     *      45 seconds. `heldSessionId` still names a seat this process no longer
     *      has, so a check for "do I hold one" answers yes and the client sits
     *      there 404ing forever. This is what made the dashboard load on login
     *      and go empty a minute later.
     *
     * So: any 404 on a request that carries a token is a reason to (re-)claim
     * and retry ONCE. The claim is idempotent per (user, device), so doing it
     * when it was not needed costs one round trip and changes nothing. A route
     * that is genuinely not there simply 404s twice.
     */
    if (!isLanRefusal(response) || pathname === "/lan/sessions") return response;

    const token = bearerOf(init.headers);
    if (token && (await claimSeat(token))) {
      const retried = await forward(pathAndQuery, init);
      if (!isLanRefusal(retried)) return retried;
      return unauthorized();
    }

    /**
     * No token, or the host would not seat us. Either way this is NOT "the
     * document you asked for is missing", and returning 404 says exactly that.
     *
     * The client's boot sequence fires BEFORE the renderer restores its stored
     * session — a dozen unauthenticated calls to `/settings`, `/profile`,
     * `/branches`, `/users`. On the host those get 401 and the shell shows the
     * login screen. Over the LAN socket they got 404, which the shell reads as
     * "no such screen": it rendered the whole navigation over an empty app and
     * put «الصفحة غير موجودة» in the content area, with a healthy host three
     * metres away. Answering 401 makes a client behave exactly like the host.
     */
    return unauthorized();
  };
}

/**
 * A refusal by the LAN socket itself, as opposed to a 404 the app genuinely
 * produced (an id that is not there). See the header's note in lan-host.ts for
 * why the two must be distinguishable and why saying so leaks nothing.
 */
function isLanRefusal(response: LanClientResponse): boolean {
  if (response.status !== 404) return false;
  return Object.entries(response.headers).some(
    ([key, value]) => key.toLowerCase() === "x-mezan-lan-refused" && value === "1",
  );
}

function unauthorized(): LanClientResponse {
  return {
    status: 401,
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      error: "UNAUTHORIZED",
      message: "انتهت الجلسة على الجهاز الرئيسي. سجّل الدخول من جديد.",
    }),
  };
}
