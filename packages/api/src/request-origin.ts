import type { Context } from "hono";

/**
 * Where a request physically came from, or null when it came from inside this
 * process.
 *
 * NOT A HEADER, and that is the whole point. The desktop edition serves ONE
 * Hono app from two mounts (docs/archive/plan.md §2.2): the renderer's IPC
 * bridge, which calls `app.fetch(request)` with no environment at all, and the
 * LAN socket, which `@hono/node-server` gives a real `incoming` message with a
 * socket under it. So the presence of a remote address IS the answer to "did
 * this arrive over the network", and no client can write it.
 *
 * Every earlier attempt in this codebase to answer a security question from a
 * header — `x-permissions`, `x-user-id`, `x-role-codes` — turned out to be the
 * client answering it for itself. This one cannot be.
 */
export function requestOrigin(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  const address = env?.incoming?.socket?.remoteAddress;
  return typeof address === "string" && address !== "" ? address : null;
}
