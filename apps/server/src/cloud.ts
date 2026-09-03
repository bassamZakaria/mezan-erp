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

root.route("/api", app);
root.use("/*", serveStatic({ root: staticRoot }));

const indexHtml = await readFile(`${staticRoot}/index.html`, "utf8");
root.notFound((c) => c.html(indexHtml));

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: root.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[cloud] Mezan demo on :${info.port} (db: ${dbPath}, demo seed ON)`);
});
