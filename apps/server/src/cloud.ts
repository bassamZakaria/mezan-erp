import { serve } from "@hono/node-server";
import type { Context, MiddlewareHandler } from "hono";
import { takeSeededAdminSecrets } from "@mezan/backend";
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
 * REFUSES TO START without a shared credential, and refuses to start on a
 * PUBLISHED admin PIN.
 *
 * What shipped before: an open origin on the public internet serving the same
 * app the desktop serves, seeded with the published `123456` fallback admin, no
 * licence state, and basic auth applied only if an undeclared variable happened
 * to be set. That is a writable admin session on a real ERP handed to anyone
 * who finds the URL. `render.yaml` now declares MEZAN_DEMO_PASSWORD as
 * `sync: false`, so the blueprint stops and asks for a value before it deploys;
 * this is the second half — the process will not come up without one.
 */
const demoPassword = env.demoPassword ?? "";
const MIN_DEMO_PASSWORD_LENGTH = 12;
if (demoPassword.length < MIN_DEMO_PASSWORD_LENGTH) {
  console.error("[cloud] REFUSING TO START: MEZAN_DEMO_PASSWORD is not set, or is shorter than");
  console.error(`[cloud] ${MIN_DEMO_PASSWORD_LENGTH} characters. The demo serves a writable ERP on the public`);
  console.error("[cloud] internet; the shared credential is the only thing in front of it.");
  process.exit(1);
}
if (env.seedAdminPin) {
  console.error("[cloud] REFUSING TO START: MEZAN_SEED_ADMIN_PIN pins the fallback admin to a");
  console.error("[cloud] literal PIN. On a public deploy the PIN must be generated per deploy.");
  process.exit(1);
}
/**
 * REQUIRED ORDERING: this has to be set before `createCloudApp` provisions the
 * demo tenant, because `resolveSeedAdminSecrets` reads it at seed time to
 * decide whether that tenant's fallback admin gets the published `123456` or a
 * generated PIN.
 */
process.env["NODE_ENV"] = "production";

/**
 * The demo tenant's own users are seeded on PINs published in this repo, so the
 * whole origin sits behind one shared credential handed to whoever is being
 * shown the demo. Unconditional: the refusal above guarantees a password
 * exists, so there is no "leave it unset and the demo is open" branch any more.
 *
 * `/healthz` is registered ABOVE this middleware inside `createCloudApp` on
 * purpose — the platform's health probe carries no Authorization header, and a
 * 401 there marks the service unhealthy and restarts it in a loop.
 */
const expectedAuthorization = `Basic ${Buffer.from(`demo:${demoPassword}`).toString("base64")}`;
const authMiddleware: MiddlewareHandler = async (c: Context, next) => {
  if (c.req.header("authorization") !== expectedAuthorization) {
    return c.text("Unauthorized", 401, { "WWW-Authenticate": 'Basic realm="Mezan demo"' });
  }
  await next();
};

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
 * The generated fallback-admin PIN of the seeded demo tenant, printed ONCE into
 * the deploy log.
 *
 * Generating a secret and printing it nowhere seeds an admin nobody can sign in
 * as — the same defect apps/server/src/index.ts closed. The deploy log is the
 * one place a Render operator can read it and nobody else can.
 */
const seeded = takeSeededAdminSecrets();
if (seeded?.generated) {
  console.log("[cloud] ------------------------------------------------------------");
  console.log("[cloud] Demo tenant admin seeded with a GENERATED PIN, shown once, here.");
  console.log(`[cloud]   admin PIN: ${seeded.pin}`);
  console.log("[cloud] ------------------------------------------------------------");
}

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
