import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { createBackend, takeSeededAdminSecrets } from "@mezan/backend";

/**
 * Cloud demo mount: ONE origin serving the built web bundle at `/` and the
 * shared Hono app under `/api`, because apps/web/src/data/transport.ts calls
 * `/api` with no host of its own. Keep that prefix in step with this file.
 *
 * The database is deliberately container-local: the free host has an ephemeral
 * disk, so every restart reseeds the demo tenant from scratch.
 */
const dbPath = process.env.MEZAN_DB ?? "/tmp/mezan-demo.db";
const staticRoot = process.env.MEZAN_WEB_DIST ?? "./apps/web/dist";

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
const demoPassword = process.env.MEZAN_DEMO_PASSWORD ?? "";
const MIN_DEMO_PASSWORD_LENGTH = 12;
if (demoPassword.length < MIN_DEMO_PASSWORD_LENGTH) {
  console.error("[cloud] REFUSING TO START: MEZAN_DEMO_PASSWORD is not set, or is shorter than");
  console.error(`[cloud] ${MIN_DEMO_PASSWORD_LENGTH} characters. The demo serves a writable ERP on the public`);
  console.error("[cloud] internet; the shared credential is the only thing in front of it.");
  process.exit(1);
}
if (process.env.MEZAN_SEED_ADMIN_PIN) {
  console.error("[cloud] REFUSING TO START: MEZAN_SEED_ADMIN_PIN pins the fallback admin to a");
  console.error("[cloud] literal PIN. On a public deploy the PIN must be generated per deploy.");
  process.exit(1);
}
/**
 * REQUIRED ORDERING: this has to be set before `createBackend` seeds, because
 * `resolveSeedAdminSecrets` reads it at seed time to decide whether the
 * fallback admin gets the published `123456` or a generated PIN.
 */
process.env.NODE_ENV = "production";

const { app } = await createBackend({ dbPath, seedDemoData: true });

/**
 * The generated fallback-admin PIN, printed ONCE into the deploy log.
 *
 * Generating a secret and printing it nowhere seeds an admin nobody can sign in
 * as — the same defect apps/server/src/index.ts closed. The deploy log is the
 * one place a Render operator can read it and nobody else can.
 */
const seeded = takeSeededAdminSecrets();
if (seeded?.generated) {
  console.log("[cloud] ------------------------------------------------------------");
  console.log("[cloud] Fallback admin seeded with a GENERATED PIN, shown once, here.");
  console.log(`[cloud]   admin PIN: ${seeded.pin}`);
  console.log("[cloud] ------------------------------------------------------------");
}

const root = new Hono();
root.get("/healthz", (c) => c.text("ok"));

/**
 * The demo tenant's own users are seeded on PINs published in this repo, so the
 * whole origin sits behind one shared credential handed to whoever is being
 * shown the demo. Unconditional: the refusal above guarantees a password
 * exists, so there is no "leave it unset and the demo is open" branch any more.
 *
 * `/healthz` is registered ABOVE this middleware on purpose — the platform's
 * health probe carries no Authorization header, and a 401 there marks the
 * service unhealthy and restarts it in a loop.
 */
const expectedAuthorization = `Basic ${Buffer.from(`demo:${demoPassword}`).toString("base64")}`;
root.use("/*", async (c, next) => {
  if (c.req.header("authorization") !== expectedAuthorization) {
    return c.text("Unauthorized", 401, { "WWW-Authenticate": 'Basic realm="Mezan demo"' });
  }
  await next();
});

root.route("/api", app);
root.use("/*", serveStatic({ root: staticRoot }));

const indexHtml = await readFile(`${staticRoot}/index.html`, "utf8");
root.notFound((c) => c.html(indexHtml));

const port = Number(process.env.PORT ?? 8080);
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
serve({ fetch: (request: Request) => root.fetch(request), port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[cloud] Mezan demo on :${info.port} (db: ${dbPath}, demo seed ON)`);
});
