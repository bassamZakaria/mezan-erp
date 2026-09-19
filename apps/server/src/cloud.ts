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
 * REFUSES TO START on a literal fallback-admin PIN, whatever else is set.
 *
 * `MEZAN_SEED_ADMIN_PIN` is PROCESS-WIDE: `resolveSeedAdminSecrets` reads it for
 * every tenant this process seeds, including every real tenant the platform
 * console provisions, each of which would open with a known company-admin PIN.
 * The demo tenant's published PIN is set in `demo-tenant.ts`, for that tenant
 * alone, and needs no variable.
 */
if (env.seedAdminPin) {
  console.error("[cloud] REFUSING TO START: MEZAN_SEED_ADMIN_PIN pins the fallback admin to a");
  console.error("[cloud] literal PIN. On a public deploy the PIN must be generated per deploy.");
  process.exit(1);
}

/**
 * REFUSES TO START card checkout in test mode on a real platform. The test
 * double's fake checkout renews a subscription for free by design; it is only
 * acceptable where every tenant is seeded demo data.
 */
if (env.paymob.mode === "test" && !env.seedDemo) {
  console.error("[cloud] REFUSING TO START: MEZAN_PAYMOB_TEST_MODE=1 is only allowed with MEZAN_SEED_DEMO=1.");
  console.error("[cloud] Set the four MEZAN_PAYMOB_* keys for real card checkout, or leave it off.");
  process.exit(1);
}

/**
 * REFUSES TO START a seeded demo without a shared credential.
 *
 * The demo tenant's personas all sign in with the published `123456`, so on
 * the public internet this basic auth is the only thing in front of a writable
 * ERP. `render.yaml` declares MEZAN_DEMO_PASSWORD as `sync: false`, so the
 * blueprint asks for a value before it deploys; this is the second half. Tied to
 * `MEZAN_SEED_DEMO`, not unconditional: a platform that seeds no demo serves
 * real tenants with their own logins and must not sit behind a `demo:` prompt.
 *
 * `/healthz` is registered ABOVE this middleware inside `createCloudApp` on
 * purpose — the platform's health probe carries no Authorization header, and a
 * 401 there marks the service unhealthy and restarts it in a loop.
 */
const MIN_DEMO_PASSWORD_LENGTH = 12;
let authMiddleware: MiddlewareHandler | undefined;
if (env.seedDemo) {
  const demoPassword = env.demoPassword ?? "";
  if (demoPassword.length < MIN_DEMO_PASSWORD_LENGTH) {
    console.error("[cloud] REFUSING TO START: MEZAN_SEED_DEMO=1 needs MEZAN_DEMO_PASSWORD, at least");
    console.error(`[cloud] ${MIN_DEMO_PASSWORD_LENGTH} characters. The demo serves a writable ERP on the public`);
    console.error("[cloud] internet; the shared credential is the only thing in front of it.");
    process.exit(1);
  }
  const expectedAuthorization = `Basic ${Buffer.from(`demo:${demoPassword}`).toString("base64")}`;
  authMiddleware = async (c: Context, next) => {
    if (c.req.header("authorization") !== expectedAuthorization) {
      return c.text("Unauthorized", 401, { "WWW-Authenticate": 'Basic realm="Mezan demo"' });
    }
    await next();
  };
}

/**
 * REQUIRED ORDERING: set before `createCloudApp`, the first call that can open
 * and seed a tenant database. Every tenant this process seeds — one the
 * platform console provisions, or an empty one the router opens — must see
 * `production`, so `resolveSeedAdminSecrets` generates its fallback admin's PIN
 * instead of handing out the published `123456`. The demo tenant does not
 * depend on this: `demo-tenant.ts` pins its PIN for that tenant alone.
 */
process.env["NODE_ENV"] = "production";

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
