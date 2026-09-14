import { serve } from "@hono/node-server";
import { createBackend, takeSeededAdminSecrets } from "@mezan/backend";
import { createEntitlements, MODULE_CATALOG } from "@mezan/domain";

/**
 * Cloud-edition mount: the shared, seeded Hono app served over an HTTP socket.
 * SQLite here stands in for Postgres (Path A); the app code is unchanged. Point
 * MEZAN_DB at a real file for durable storage (defaults to a local file so the
 * web dev build always has a live backend); the DB is bootstrapped + seeded on
 * first start.
 */
const dbPath = process.env.MEZAN_DB ?? "./mezan.db";
const seedDemoData = process.env.MEZAN_SEED_DEMO === "1";
/**
 * The demo tenant seeds more accounts than the platform default's 10 seats
 * allow (A3's SEAT_LIMIT_REACHED). Slice C replaces this with the demo
 * tenant's real subscription; until then, seat/branch/warehouse caps stay off.
 */
const resolveEntitlements = () =>
  createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });
const { app } = await createBackend({ dbPath, seedDemoData, resolveEntitlements });

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
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Mezan API listening on http://127.0.0.1:${info.port} (db: ${dbPath}${seedDemoData ? ", demo seed ON" : ""})`);
  console.log(`[server] try: POST /auth/login , GET /dashboard/summary`);
  console.log(`[server] try: GET /reports/sales/by-period , /reports/inventory/valuation , /reports/aging/customers , etc. (docs/archive/catalog/08-reports.md)`);
});
