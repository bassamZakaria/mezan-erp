import { serve } from "@hono/node-server";
import { takeSeededAdminSecrets } from "@mezan/backend";
import { parseEnv } from "./env.js";
import { createCloudApp } from "./cloud-app.js";

/**
 * Dev entrypoint: the same cloud composition `cloud.ts` runs, pointed at a
 * local, gitignored data directory instead of `.data/platform` so a
 * developer's platform and tenant databases never collide with a deployed
 * one on the same machine.
 */
const env = parseEnv({
  ...process.env,
  MEZAN_PLATFORM_DIR: process.env["MEZAN_PLATFORM_DIR"] ?? "./.data/dev-platform",
  PORT: process.env["PORT"] ?? "3000",
});

const { root } = await createCloudApp(env);

/**
 * A generated seed PIN is PRINTED, once, on the run that generated it.
 *
 * On `NODE_ENV=production` the fallback admin gets a random PIN rather than the
 * published `123456`, which is right — every install sharing one working
 * company-admin login was the defect that change closed. But the secret was
 * then printed nowhere, so a headless deployment seeded an admin nobody could
 * ever sign in as, with none of the desktop first-run wizard to recover
 * through: the install was unusable from the moment it started. It goes to
 * stdout here, once, and the operator is expected to sign in and change it.
 */
const seeded = takeSeededAdminSecrets();
if (seeded?.generated) {
  console.log("[server] ------------------------------------------------------------");
  console.log("[server] A fallback admin was seeded with a GENERATED PIN. It is shown");
  console.log("[server] once, here, and is not recoverable from the database.");
  console.log(`[server]   admin PIN: ${seeded.pin}`);
  console.log("[server] Sign in, create your own admin, and disable this account.");
  console.log("[server] ------------------------------------------------------------");
}

/**
 * A rejected promise that reaches the process must not end it. Node's default
 * on an unhandled rejection is to exit, and a single refused posting — a
 * document approved into a closed fiscal period — was taking the whole backend
 * with it, which on a LAN install means every till at once. Logged, never
 * fatal; `app.onError` has already answered the request. Registered AFTER the
 * boot above, so a failure to start is still fatal and visible.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection (ignored, server stays up):", reason);
});

/**
 * SECURITY: LOOPBACK BY DEFAULT.
 *
 * `serve()` with no `hostname` binds every interface, and this line then
 * PRINTED `http://127.0.0.1:…` — so a developer running the dev backend on a
 * café network was serving an unlicensed, seeded ERP to that network while
 * being told it was local-only. Set MEZAN_BIND deliberately (a container needs
 * `0.0.0.0`); the address actually bound is printed below, never a guess.
 */
const hostname = process.env["MEZAN_BIND"] ?? "127.0.0.1";

serve({ fetch: root.fetch, port: env.port, hostname }, (info) => {
  const shown = info.family === "IPv6" ? `[${info.address}]` : info.address;
  console.log(`[server] Mezan platform listening on http://${shown}:${info.port} (platform dir: ${env.platformDir})`);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    console.log(`[server] NOTE: bound to ${hostname} — reachable from other machines on this network.`);
  }
  console.log(`[server] try: POST /api/platform/auth/login , GET /api/platform/resolve`);
  console.log(`[server] try: POST /api/auth/login (with x-mezan-tenant) , GET /api/dashboard/summary`);
});
