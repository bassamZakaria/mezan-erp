import { serve } from "@hono/node-server";
import { createApp } from "@mezan/api";
import {
  createSqliteUnitOfWork,
  createSqliteAccountRepository,
  createSqliteSettingsStore,
  createSqliteBranchStore,
  createSqliteWarehouseStore,
  createSqliteCustomerRepository,
  createSqliteSupplierRepository,
} from "@mezan/persistence";
import { seedStandardChartOfAccounts } from "@mezan/domain";

/**
 * Cloud-edition mount: the shared Hono app served over an HTTP socket.
 * SQLite here stands in for Postgres (Path A); the app code is unchanged.
 */
const dbPath = process.env.MEZAN_DB ?? ":memory:";
const uow = createSqliteUnitOfWork(dbPath);
const settingsStore = createSqliteSettingsStore(dbPath === ":memory:" ? ":memory:" : dbPath);
const branchStore = createSqliteBranchStore(dbPath === ":memory:" ? ":memory:" : dbPath);
const warehouseStore = createSqliteWarehouseStore(dbPath === ":memory:" ? ":memory:" : dbPath);

const accountRepo = createSqliteAccountRepository(process.env.MEZAN_COA_DB ?? ":memory:");
if ((await accountRepo.list()).length === 0) {
  await seedStandardChartOfAccounts(accountRepo);
}

const customerStore = createSqliteCustomerRepository(process.env.MEZAN_CUSTOMERS_DB ?? ":memory:");
const supplierStore = createSqliteSupplierRepository(process.env.MEZAN_SUPPLIERS_DB ?? ":memory:");

const app = createApp(uow, {
  settingsStore,
  branchStore,
  warehouseStore,
  accounts: { repo: accountRepo },
  customerStore,
  supplierStore,
});
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Mezan spike API listening on http://127.0.0.1:${info.port}`);
  console.log(`[server] try: POST /journal-entries , GET /journal-entries/:id`);
  console.log(`[server] try: GET /accounts/tree (x-permissions: accounting.coa.view)`);
  console.log(
    `[server] try: GET/PUT /settings , GET/POST/PUT /branches , GET/POST/PUT /warehouses (x-permissions: admin.settings.view / admin.branches.view / admin.warehouses.view, etc.)`,
  );
  console.log(
    `[server] try: GET/POST/PATCH /customers , GET/POST/PATCH /suppliers (x-permissions: sales.customer.view / purchases.supplier.view, etc.)`,
  );
  console.log(`[server] try: GET/POST /roles , GET/PUT/DELETE /roles/:id`);
  console.log(`[server] try: GET/POST /users , GET/PUT /users/:id , POST /users/:id/(de)activate`);
});
