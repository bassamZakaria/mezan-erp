import type { SeatSessionRegistry } from "@mezan/domain";

/**
 * The gate that decides whether a LAN request is a CONNECTED CLIENT's or a
 * stranger's, for every route outside `LAN_PUBLIC_ROUTES` (main/lan-host.ts).
 *
 * WHY THIS EXISTS. The LAN socket used to forward five routes and refuse the
 * rest, which meant the second machine in a shop could sign in and take a seat
 * and then do nothing with it: no invoice list, no stock, no posting. Serving
 * the whole app instead needs an answer to "who is this", and a licence is not
 * one — `lan.multi_till` says the shop paid for two tills, not that the laptop
 * currently talking to us is one of them.
 *
 * WHAT IT CHECKS, and each of the three is load-bearing:
 *
 *   1. THE TOKEN IS A LIVE SESSION FOR THIS ORIGIN. `SessionRegistry.find`
 *      takes the caller's origin and refuses a token bound to a different one
 *      (packages/api/src/session-auth.ts) — so the host's own in-process token,
 *      which is bound to `null`, cannot be replayed from the wire, and a token
 *      minted for one till cannot be moved to another machine.
 *   2. THAT SESSION'S USER HOLDS A SEAT. Signing in is not connecting. A device
 *      becomes a till by `POST /lan/sessions`, which is what counts against the
 *      licensed seat count; without this check a shop with one seat could run
 *      six machines, and disconnecting a device from the admin panel would free
 *      a number while the machine kept working.
 *   3. THE SEAT IS STILL THERE ON EVERY REQUEST, not just at connect time. The
 *      registry reaps stale sessions on read, so a till that was disconnected —
 *      by an admin, or by going quiet — stops being authorised on its next call
 *      rather than at some later renewal.
 *
 * What it deliberately does NOT do is decide what the caller may then DO. That
 * is the app's own permission gate, unchanged, reading the same session: this
 * only decides whether the request is allowed to reach it at all.
 */
export interface LanAuthorizationOptions {
  /**
   * Resolves a token to its user id for a caller at `origin`, or null. Narrower
   * than handing this module the whole `SessionRegistry`: it needs the identity
   * and nothing else, and it must never be able to mint or revoke one.
   */
  readonly resolveSessionUser: (token: string, origin: string) => Promise<string | null>;
  readonly registry: SeatSessionRegistry;
}

/** The same two spellings `readSessionToken` accepts on the server side. */
export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [scheme, value] = authorization.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value) return value;
  }
  return request.headers.get("x-session-token");
}

/**
 * The policy itself, over a token rather than a `Request`.
 *
 * Split out because the two registries it consults moved into the backend
 * process with the database (Q-1): the LAN socket runs in the main process and
 * only the token and the peer address can cross the port, so the DECISION has
 * to be taken on the far side. Keeping one definition here — rather than a
 * second copy inside main/backend-worker.ts — is what stops the two drifting.
 */
export async function authorizeSeatedSession(
  options: LanAuthorizationOptions,
  token: string,
  remote: string,
): Promise<boolean> {
  if (!token) return false;

  const userId = await options.resolveSessionUser(token, remote);
  if (userId === null) return false;

  // `list()` reaps stale sessions as it reads, which is why the check is made
  // against it rather than against a cached count.
  return options.registry.list().some((session) => session.userId === userId);
}

export function createLanClientAuthorizer(
  options: LanAuthorizationOptions,
): (request: Request, remote: string) => Promise<boolean> {
  return async (request, remote) => {
    const token = readBearerToken(request);
    if (!token) return false;
    return authorizeSeatedSession(options, token, remote);
  };
}
