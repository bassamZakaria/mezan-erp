import { createBackend } from "@mezan/backend";

/**
 * Smoke check — "does the code still run?", not "is the business logic right?".
 *
 * Boots the real backend, runs the demo seed through the real routes (so every
 * confirm path, GL posting and stock movement executes at least once), then
 * GETs every read surface the web app depends on. It fails on a crash, a 5xx,
 * or an unmounted route — the failure modes that make the product not start.
 * It deliberately asserts nothing about the VALUES returned.
 *
 * Run with `pnpm smoke`. See docs/testing-policy.md.
 */

const HEADERS = {
  // "USER-ADMIN" is the fixed id of the seeded first admin (packages/backend/src/seed.ts) —
  // used (not "smoke") so self-service reads like GET /profile, which look the caller
  // up by id, hit a real user instead of a spurious 404.
  "x-user-id": "USER-ADMIN",
  "x-permissions": "*",
  "x-branch-scope": "*",
  "x-warehouse-scope": "*",
};

/** Read surfaces the web app calls. A 404 here means a route is not mounted. */
const READ_PATHS = [
  "/health",
  "/dashboard/summary",
  "/settings",
  "/branches",
  "/warehouses",
  "/customers",
  "/suppliers",
  "/items",
  "/item-units",
  "/item-categories",
  "/item-brands",
  "/item-seasons",
  "/item-specifications",
  "/label-layouts",
  "/inventory/product-templates",
  "/accounts",
  "/accounting/account-routing",
  "/tax-rates",
  "/tax-groups",
  "/cost-centers",
  "/cost-center-pl",
  "/treasury-accounts",
  "/fiscal-periods",
  "/exchange-rates",
  "/reconciliation",
  "/eta/config",
  "/eta/submissions",
  "/cheques",
  "/vouchers",
  "/vouchers/counts",
  "/price-lists",
  "/promotions",
  "/sales-invoices",
  "/sales-invoices/counts",
  "/sales-invoices/stats",
  "/sales-quotes",
  "/sales-returns",
  "/purchases/invoices",
  "/purchases/invoices/counts",
  "/purchases/invoices/stats",
  "/purchases/orders",
  "/purchases/receipts",
  "/purchase-returns",
  "/landed-costs",
  "/rfqs",
  "/inventory/stock-balance",
  "/inventory/adjustments",
  "/inventory/transfers",
  "/inventory/physical-counts",
  "/inventory/valuation",
  "/inventory/drift",
  "/installments/plans",
  "/installments/follow-ups",
  "/crm/leads",
  "/crm/opportunities",
  "/crm/pipeline-stages",
  "/crm/activities",
  "/projects",
  "/assets",
  "/assets/categories",
  "/field/van-trips",
  "/manufacturing/work-orders",
  "/manufacturing/boms",
  "/manufacturing/configurable-products",
  "/manufacturing/config-instances",
  "/roles",
  "/entitlements",
  "/users",
  "/reports/sales/by-period",
  "/reports/sales/by-item",
  "/reports/sales/by-customer",
  "/reports/sales/top-products",
  "/reports/purchases/by-period",
  "/reports/purchases/by-supplier",
  "/reports/purchases/by-item",
  "/reports/inventory/stock-levels",
  "/reports/inventory/movement",
  "/reports/inventory/ledger",
  "/reports/inventory/valuation",
  "/reports/inventory/aging",
  "/reports/inventory/expiring",
  "/reports/inventory/slow-moving",
  "/reports/inventory/drift",
  "/reports/aging/customers",
  "/reports/aging/suppliers",
  "/reports/installments/overview",
  "/reports/installments/overdue",
  "/reports/field/van-sales",
  "/reports/manufacturing/make-vs-buy",
  "/financial-reports/trial-balance",
  "/financial-reports/income-statement",
  "/financial-reports/balance-sheet",
  "/financial-reports/cash-flow",
  "/financial-reports/vat-return",
  "/financial-reports/general-ledger",
  "/sequences",
  "/barcode-config",
  "/audit",
  "/profile",
  "/profile/activity",
  "/api-keys",
  "/webhooks",
  "/notification-rules",
  "/notification-rules/triggers",
  "/notifications",
  "/workflow/configs",
  "/hr/departments",
  "/hr/job-titles",
  "/hr/employees",
  "/hr/contracts",
  "/hr/holidays",
  "/hr/leave-requests/me",
  "/hr/leave-requests",
  "/hr/leave-requests/counts",
  "/hr/attendance",
  "/hr/leave-policies",
  "/hr/leave-policies/presets",
  "/hr/leave-balances",
  "/hr/leave-accrual-batches",
  "/hr/dashboard",
  "/hr/advances",
  "/hr/advances/outstanding",
  "/hr/payroll/runs",
  "/hr/payroll/payslips",
  "/print-template-config",
  "/data-migration/status",
  "/inventory/writedown-runs",
  "/workflow/requests",
  "/hr/payroll/components",
];

interface Failure {
  path: string;
  detail: string;
}

async function main(): Promise<void> {
  const failures: Failure[] = [];

  process.stdout.write("booting backend with the demo seed…\n");
  const handle = await createBackend({ dbPath: ":memory:", seedDemoData: true });
  process.stdout.write("boot + seed OK\n\n");

  for (const path of READ_PATHS) {
    try {
      const res = await handle.app.fetch(new Request(`http://smoke${path}`, { headers: HEADERS }));
      if (res.status >= 500) {
        failures.push({ path, detail: `${res.status} ${(await res.text()).slice(0, 200)}` });
      } else if (res.status === 404) {
        failures.push({ path, detail: "404 — route not mounted" });
      } else {
        process.stdout.write(`  ok  ${res.status}  ${path}\n`);
      }
    } catch (err) {
      failures.push({ path, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  handle.close();

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} smoke failure(s):\n`);
    for (const f of failures) process.stderr.write(`  FAIL  ${f.path}  ${f.detail}\n`);
    process.exit(1);
  }

  process.stdout.write(`\nsmoke passed — boot, seed and ${READ_PATHS.length} read surfaces all responded\n`);
}

await main();
