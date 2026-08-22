import { serve } from "@hono/node-server";
import { createApp } from "@mezan/api";
import { createSqliteUnitOfWork, createSqliteAccountRepository } from "@mezan/persistence";
import { seedStandardChartOfAccounts } from "@mezan/domain";

/**
 * Cloud-edition mount: the shared Hono app served over an HTTP socket.
 * SQLite here stands in for Postgres (Path A); the app code is unchanged.
 */
const uow = createSqliteUnitOfWork(process.env.MEZAN_DB ?? ":memory:");

const accountRepo = createSqliteAccountRepository(process.env.MEZAN_COA_DB ?? ":memory:");
if ((await accountRepo.list()).length === 0) {
  await seedStandardChartOfAccounts(accountRepo);
}

const app = createApp(uow, { accounts: { repo: accountRepo } });
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Mezan spike API listening on http://127.0.0.1:${info.port}`);
  console.log(`[server] try: POST /journal-entries , GET /journal-entries/:id`);
  console.log(`[server] try: GET /accounts/tree (x-permissions: accounting.coa.view)`);
});
