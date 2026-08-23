import { serve } from "@hono/node-server";
import { createBackend } from "@mezan/backend";

/**
 * Cloud-edition mount: the shared, seeded Hono app served over an HTTP socket.
 * SQLite here stands in for Postgres (Path A); the app code is unchanged. Point
 * MEZAN_DB at a real file for durable storage (defaults to a local file so the
 * web dev build always has a live backend); the DB is bootstrapped + seeded on
 * first start.
 */
const dbPath = process.env.MEZAN_DB ?? "./mezan.db";
const { app } = await createBackend({ dbPath });
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Mezan API listening on http://127.0.0.1:${info.port} (db: ${dbPath})`);
  console.log(`[server] try: POST /auth/login , GET /dashboard/summary`);
  console.log(`[server] try: GET /reports/sales/by-period , /reports/inventory/valuation , /reports/aging/customers , etc. (docs/catalog/08-reports.md)`);
});
