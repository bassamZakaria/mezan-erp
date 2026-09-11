import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { createBackend } from "@mezan/backend";

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
const { app } = await createBackend({ dbPath, seedDemoData: true });

const root = new Hono();
root.get("/healthz", (c) => c.text("ok"));

/**
 * The demo tenant's PINs are published in the repo, so the URL itself is the
 * only thing standing between the public and a working ERP login. Set
 * MEZAN_DEMO_PASSWORD and the whole origin sits behind one shared credential
 * handed to clients; leave it unset and the demo is open.
 */
const demoPassword = process.env.MEZAN_DEMO_PASSWORD;
if (demoPassword) {
  const expected = `Basic ${Buffer.from(`demo:${demoPassword}`).toString("base64")}`;
  root.use("/*", async (c, next) => {
    if (c.req.header("authorization") !== expected) {
      return c.text("Unauthorized", 401, { "WWW-Authenticate": 'Basic realm="Mezan demo"' });
    }
    await next();
  });
}

/**
 * The analytics beacon is injected HERE, at the cloud mount, and never built
 * into the bundle: the desktop and LAN mounts serve the same dist/ and must
 * stay free of any outbound call. Unset the env var and the demo ships the
 * page untouched.
 */
const analyticsToken = process.env.MEZAN_ANALYTICS_TOKEN;
const analyticsTag = analyticsToken
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: analyticsToken })}'></script>`
  : "";

const rawIndexHtml = await readFile(`${staticRoot}/index.html`, "utf8");
const indexHtml = analyticsTag
  ? rawIndexHtml.replace("</body>", `${analyticsTag}</body>`)
  : rawIndexHtml;

root.route("/api", app);
root.get("/", (c) => c.html(indexHtml));
root.get("/index.html", (c) => c.html(indexHtml));
root.use("/*", serveStatic({ root: staticRoot }));

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
