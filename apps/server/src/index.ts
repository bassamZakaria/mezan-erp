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

serve({ fetch: root.fetch, port: env.port }, (info) => {
  console.log(`[server] Mezan platform listening on http://127.0.0.1:${info.port} (platform dir: ${env.platformDir})`);
  console.log(`[server] try: POST /api/platform/auth/login , GET /api/platform/resolve`);
  console.log(`[server] try: POST /api/auth/login (with x-mezan-tenant) , GET /api/dashboard/summary`);
});
