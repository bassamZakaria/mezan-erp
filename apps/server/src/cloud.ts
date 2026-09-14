import { serve } from "@hono/node-server";
import type { Context, MiddlewareHandler } from "hono";
import { parseEnv } from "./env.js";
import { createCloudApp } from "./cloud-app.js";

/**
 * Cloud entrypoint: one origin serving the built web bundle at `/`, the
 * platform console under `/api/platform`, and every tenant under `/api` —
 * apps/web/src/data/transport.ts calls `/api` with no host of its own, so
 * keep that prefix in step with this file.
 */
const env = parseEnv(process.env);

/**
 * The demo tenant's PINs are published in the repo, so on the free-tier
 * shared demo host the URL itself is the only thing standing between the
 * public and a working ERP login. Set MEZAN_DEMO_PASSWORD and the whole
 * origin sits behind one shared credential handed to clients; leave it unset
 * and the demo is open.
 */
const demoPassword = env.demoPassword;
const authMiddleware: MiddlewareHandler | undefined = demoPassword
  ? async (c: Context, next) => {
      const expected = `Basic ${Buffer.from(`demo:${demoPassword}`).toString("base64")}`;
      if (c.req.header("authorization") !== expected) {
        return c.text("Unauthorized", 401, { "WWW-Authenticate": 'Basic realm="Mezan demo"' });
      }
      await next();
    }
  : undefined;

/**
 * The analytics beacon is injected HERE, at the cloud mount, and never built
 * into the bundle: the desktop and LAN mounts serve the same dist/ and must
 * stay free of any outbound call. Unset the env var and the demo ships the
 * page untouched.
 */
const analyticsToken = env.analyticsToken;
const transformIndexHtml = analyticsToken
  ? (html: string) => {
      const analyticsTag = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: analyticsToken })}'></script>`;
      return html.replace("</body>", `${analyticsTag}</body>`);
    }
  : undefined;

const { root } = await createCloudApp(env, { authMiddleware, transformIndexHtml });

/**
 * SECURITY-RELEVANT, AND DELIBERATE: the second argument is dropped, so
 * @mezan/api's requestOrigin() sees no `incoming` socket and every session
 * binds to the null "host" origin instead of a peer address.
 *
 * The session-origin binding (packages/api/src/session-auth.ts) revokes a
 * token the moment it arrives from a second address. Behind this host's
 * reverse proxy the peer address is the proxy, not the client, so the control
 * distinguishes nothing here — but if the proxy answers from a second internal
 * address the demo user is signed out mid-click. Binding to null keeps the
 * demo usable and gives up a control that was already blind at this mount.
 * The desktop and LAN mounts pass the socket through and keep the binding.
 */
serve({ fetch: (request: Request) => root.fetch(request), port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[cloud] Mezan platform on :${info.port} (platform dir: ${env.platformDir})`);
});
