import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { parseEnv, PaymobMode } from "./env.js";
import { createCloudApp } from "./cloud-app.js";
import { LogEvent, createLogger } from "@mezan/api";
import { AlertKind } from "./alerter.js";
import { installProcessHandlers, markRunning } from "./process-lifecycle.js";

const log = createLogger("cloud");

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
if (env.paymob.mode === PaymobMode.Test && !env.seedDemo) {
  console.error("[cloud] REFUSING TO START: MEZAN_PAYMOB_TEST_MODE=1 is only allowed with MEZAN_SEED_DEMO=1.");
  console.error("[cloud] Set the four MEZAN_PAYMOB_* keys for real card checkout, or leave it off.");
  process.exit(1);
}

/**
 * REFUSES TO START a reviewer tenant without a support mailbox: it is the
 * account-deletion channel the store listing points at. (`parseEnv` already
 * refuses a reviewer tenant next to the basic-auth demo.)
 */
if (env.reviewTenant && !env.supportEmail) {
  console.error("[cloud] REFUSING TO START: a reviewer tenant needs MEZAN_SUPPORT_EMAIL for the account-deletion page.");
  process.exit(1);
}

/**
 * REFUSES TO START a seeded demo without a shared credential.
 *
 * The demo tenant's personas all sign in with the published `123456`, so on
 * the public internet this basic auth is the only thing in front of a writable
 * ERP. Tied to `MEZAN_SEED_DEMO`, not unconditional: a platform that seeds no demo serves
 * real tenants with their own logins and must not sit behind a `demo:` prompt.
 *
 * `/healthz` is registered ABOVE this middleware inside `createCloudApp` on
 * purpose — the platform's health probe carries no Authorization header, and a
 * 401 there marks the service unhealthy and restarts it in a loop.
 */
const MIN_DEMO_PASSWORD_LENGTH = 12;
const DEMO_GATE_COOKIE = "mezan_demo_gate";
const DEMO_GATE_MAX_AGE_SECONDS = 12 * 60 * 60;
let authMiddleware: MiddlewareHandler | undefined;
if (env.seedDemo) {
  const demoPassword = env.demoPassword ?? "";
  if (demoPassword.length < MIN_DEMO_PASSWORD_LENGTH) {
    console.error("[cloud] REFUSING TO START: MEZAN_SEED_DEMO=1 needs MEZAN_DEMO_PASSWORD, at least");
    console.error(`[cloud] ${MIN_DEMO_PASSWORD_LENGTH} characters. The demo serves a writable ERP on the public`);
    console.error("[cloud] internet; the shared credential is the only thing in front of it.");
    process.exit(1);
  }
  const digestOf = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
  const expectedAuthorization = digestOf(`Basic ${Buffer.from(`demo:${demoPassword}`).toString("base64")}`);
  // SECURITY: compared as fixed-length digests in constant time, so the response time says nothing about how much of the credential matched.
  const gateToken = createHmac("sha256", demoPassword).update("mezan-demo-gate-v1").digest("base64url");
  const expectedGateToken = digestOf(gateToken);
  // SECURITY: browsers drop a cached Basic credential after any 401 the app itself sends (a wrong PIN, an ended session),
  // which bounced demo visitors to the password prompt; the gate also accepts an HttpOnly cookie derived from the password.
  authMiddleware = async (c: Context, next) => {
    const basicOk = timingSafeEqual(digestOf(c.req.header("authorization") ?? ""), expectedAuthorization);
    const cookieOk = timingSafeEqual(digestOf(getCookie(c, DEMO_GATE_COOKIE) ?? ""), expectedGateToken);
    if (!basicOk && !cookieOk) {
      return c.text("Unauthorized", 401, { "WWW-Authenticate": 'Basic realm="Mezan demo"' });
    }
    if (basicOk && !cookieOk) {
      setCookie(c, DEMO_GATE_COOKIE, gateToken, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https",
        maxAge: DEMO_GATE_MAX_AGE_SECONDS,
      });
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

const cloud = await createCloudApp(env, { authMiddleware, transformIndexHtml });
const { root } = cloud;

const marker = markRunning(env.platformDir);
installProcessHandlers({ alerter: cloud.alerter, marker, close: () => cloud.close() });
if (marker.previous) {
  log.error({ event: LogEvent.ProcessUncleanRestart, previousStartedAt: marker.previous.startedAt ?? null }, "the server started after an unclean exit");
  cloud.alerter.raise({
    kind: AlertKind.UncleanRestart,
    summary: "the server started after an unclean exit (crash, kill or power loss)",
    facts: { previousStartedAt: marker.previous.startedAt ?? null, previousPid: marker.previous.pid ?? null },
  });
}

// SECURITY: the socket is passed through, and is the caller's address only
// when no proxy is trusted. With MEZAN_TRUST_PROXY=1 it is the proxy and is
// never read: the address comes from the forwarded chain, and a request whose
// chain yields none is refused (client-source.ts).
serve({ fetch: root.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  log.info({ event: LogEvent.ProcessStarted, port: info.port, platformDir: env.platformDir }, "Mezan platform is serving");
});
