import { serve } from "@hono/node-server";
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

serve({ fetch: root.fetch, port: env.port }, (info) => {
  console.log(`[server] Mezan platform listening on http://127.0.0.1:${info.port} (platform dir: ${env.platformDir})`);
  console.log(`[server] try: POST /api/platform/auth/login , GET /api/platform/resolve`);
  console.log(`[server] try: POST /api/auth/login (with x-mezan-tenant) , GET /api/dashboard/summary`);
});
