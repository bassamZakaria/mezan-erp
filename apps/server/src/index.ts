import { serve } from "@hono/node-server";
import { createApp } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";

/**
 * Cloud-edition mount: the shared Hono app served over an HTTP socket.
 * SQLite here stands in for Postgres (Path A); the app code is unchanged.
 */
const uow = createSqliteUnitOfWork(process.env.MEZAN_DB ?? ":memory:");
const app = createApp(uow);
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Mezan spike API listening on http://127.0.0.1:${info.port}`);
  console.log(`[server] try: POST /journal-entries , GET /journal-entries/:id`);
});
