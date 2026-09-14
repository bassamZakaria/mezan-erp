import { createBackend, SEED_ADMIN_EMAIL, SEED_ADMIN_PIN } from "@mezan/backend";
import { createEntitlements, MODULE_CATALOG } from "@mezan/domain";

/**
 * Smoke check — "does the code still run?", not "is the business logic right?".
 *
 * Boots the real backend, runs the demo seed through the real routes (so every
 * confirm path, GL posting and stock movement executes at least once), then
 * GETs every read surface the web app depends on. It fails on a crash, a 5xx,
 * or an unmounted route — the failure modes that make the product not start.
 * It deliberately asserts nothing about the VALUES returned.
 *
 * Run with `pnpm smoke`. See docs/TESTING.md §1.
 */

/**
 * Smoke signs in the way a user does.
 *
 * It used to declare `x-permissions: "*"` and be believed. Once the server
 * started resolving callers from its own sessions, that header stopped meaning
 * anything — and because this script only failed on 5xx and 404, all 193 read
 * surfaces answered 403 and it still reported a pass. An unauthenticated smoke
 * run proves nothing, so 401 and 403 are failures here now.
 */
const SCOPE_HEADERS = {
  "x-branch-scope": "*",
  "x-warehouse-scope": "*",
};

async function signIn(app: { fetch: (r: Request) => Promise<Response> }): Promise<Record<string, string>> {
  const res = await app.fetch(
    new Request("http://smoke/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
    }),
  );
  if (!res.ok) throw new Error(`smoke could not sign in: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const session = (await res.json()) as { token: string };
  return { ...SCOPE_HEADERS, authorization: `Bearer ${session.token}` };
}

/** Read surfaces the web app calls. A 404 here means a route is not mounted. */
const READ_PATHS = [
  "/health",
  "/dashboard/summary",
  "/settings",
  "/branches",
  "/warehouses",
  "/customers",
  "/customers/counts",
  "/customers/stats",
  "/suppliers",
  "/suppliers/counts",
  "/suppliers/stats",
  "/items",
  "/items/counts",
  "/items/stats",
  "/item-units",
  "/item-categories",
  "/item-brands",
  "/item-seasons",
  "/item-specifications",
  "/attachments",
  "/label-layouts",
  "/inventory/product-templates",
  "/accounts",
  "/accounting/account-routing",
  "/tax-rates",
  "/tax-groups",
  "/cost-centers",
  "/cost-center-pl",
  "/treasury-accounts",
  "/treasury-accounts/counts",
  "/treasury-accounts/stats",
  "/fiscal-periods",
  "/exchange-rates",
  "/bank-statements",
  "/reconciliation",
  "/eta/config",
  "/eta/submissions",
  "/cheques",
  "/cheques/counts",
  "/cheques/stats",
  "/vouchers",
  "/vouchers/counts",
  "/vouchers/stats",
  "/price-lists",
  "/promotions",
  "/sales-invoices",
  "/sales-invoices/counts",
  "/sales-invoices/stats",
  "/sales-quotes",
  "/sales-quotes/counts",
  "/sales-quotes/stats",
  "/sales-returns",
  "/sales-returns/counts",
  "/sales-returns/stats",
  "/purchases/invoices",
  "/purchases/invoices/counts",
  "/purchases/invoices/stats",
  "/purchases/orders",
  "/purchases/orders/counts",
  "/purchases/orders/stats",
  "/purchases/receipts",
  "/purchases/receipts/counts",
  "/purchases/receipts/stats",
  "/purchase-returns",
  "/purchase-returns/counts",
  "/purchase-returns/stats",
  "/landed-costs",
  "/rfqs",
  "/rfqs/counts",
  "/rfqs/stats",
  "/inventory/stock-balance",
  "/inventory/adjustments",
  "/inventory/transfers",
  "/inventory/physical-counts",
  "/inventory/physical-counts/counts",
  "/inventory/physical-counts/stats",
  "/inventory/stock-adjustments",
  "/inventory/stock-adjustments/counts",
  "/inventory/stock-adjustments/stats",
  "/inventory/stock-transfers",
  "/inventory/stock-transfers/counts",
  "/inventory/stock-transfers/stats",
  "/inventory/valuation",
  "/inventory/drift",
  "/installments/plans",
  "/installments/plans/counts",
  "/installments/plans/stats",
  "/installments/follow-ups",
  "/installments/follow-ups/counts",
  "/installments/follow-ups/stats",
  "/crm/leads",
  "/crm/opportunities",
  "/crm/pipeline-stages",
  "/crm/activities",
  "/projects",
  "/contracting/site/issues",
  "/contracting/site/receipts",
  "/contracting/site/consumptions",
  "/contracting/site/custody",
  "/contracting/site/equipment-logs",
  "/contracting/site/unreceived?olderThanDays=7",
  "/contracting/site/consumption-by-boq-line?projectId=PRJ-DEMO-1",
  "/contracting/site/equipment-hours?projectId=PRJ-DEMO-1",
  "/projects/pnl",
  "/contracting/contracts",
  "/contracting/variation-orders",
  "/contracting/certificates",
  "/contracting/certificates?contractId=CTR-DEMO-1",
  "/contracting/certificates/internal?contractId=CTR-DEMO-1",
  "/contracting/guarantees",
  "/contracting/guarantees/summary",
  "/contracting/guarantees/expiring",
  "/contracting/recognition/runs",
  "/contracting/recognition/status?periodEnd=2026-08-31",
  "/contracting/recognition/preview?contractId=CTR-DEMO-1&periodEnd=2026-08-31",
  "/contracting/subcontracts",
  "/contracting/subcontracts?contractId=CTR-DEMO-1",
  "/contracting/subcontracts/SUB-DEMO-1",
  "/contracting/subcontracts/SUB-DEMO-1/retention",
  "/contracting/subcontracts/SUB-DEMO-3",
  "/contracting/subcontracts/SUB-DEMO-3/retention",
  "/contracting/subcontract-certificates",
  "/contracting/subcontract-certificates?subcontractId=SUB-DEMO-1",
  "/contracting/site/consumptions?subcontractId=SUB-DEMO-1",
  "/contracting/reports/summary",
  "/contracting/reports/boq-overrun",
  "/contracting/reports/unreceived-issues?olderThanDays=7",
  "/contracting/reports/consumption-variance?thresholdPercent=10",
  "/contracting/reports/equipment-without-certificate?olderThanDays=30",
  "/contracting/reports/late-variation-approvals",
  "/contracting/reports/early-retention-release",
  "/contracting/reports/cost-overrun-vs-estimate?thresholdPercent=10&stalenessMonths=6",
  "/contracting/retention/calendar",
  "/contracting/retention/releases",
  "/contracting/retention/releases/RET-DEMO-1",
  "/contracting/retention/headroom?contractId=CTR-DEMO-1&kind=provisional",
  "/assets",
  "/assets/counts",
  "/assets/stats",
  "/assets/depreciation/runs/counts",
  "/assets/depreciation/runs/stats",
  "/assets/categories",
  "/field/van-trips",
  "/field/vans",
  "/manufacturing/work-orders",
  "/manufacturing/work-orders/counts",
  "/manufacturing/work-orders/stats",
  "/manufacturing/work-stations",
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
  "/reports/tax/withholding",
  "/financial-reports/trial-balance",
  "/financial-reports/income-statement",
  "/financial-reports/balance-sheet",
  "/financial-reports/cash-flow",
  "/financial-reports/vat-return",
  "/financial-reports/general-ledger",
  "/financial-reports/account-ledger",
  "/reports/drill-down/customer/CUST-DEMO-1",
  "/reports/drill-down/supplier/SUPP-DEMO-1",
  "/reports/drill-down/item/ITEM-DEMO-1",
  "/reports/drill-down/account/1105",
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
  "/eta/activity-codes",
  "/eta/unit-codes",
  "/eta/branch-codes",
  "/eta/item-mappings",
  "/eta/unit-mappings",
  "/eta/tax-subtypes",
  "/hr/payroll/components",
  "/settings/currencies",
  "/inventory/availability?itemId=ITEM-DEMO-1&warehouseId=WH-MAIN",
  "/gl/balances-by-currency",
  "/gl/journal-entries",
  "/gl/journal-entries/counts",
  "/gl/journal-entries/stats",
  "/cost-centers/importable-departments",
];

interface Failure {
  path: string;
  detail: string;
}

async function main(): Promise<void> {
  const failures: Failure[] = [];

  process.stdout.write("booting backend with the demo seed…\n");
  // The demo seed creates more accounts than the platform default's 10 seats
  // allow (A3's SEAT_LIMIT_REACHED); this stand-in resolver keeps every cap off.
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });
  const handle = await createBackend({ dbPath: ":memory:", seedDemoData: true, resolveEntitlements });
  process.stdout.write("boot + seed OK\n\n");
  const headers = await signIn(handle.app);

  for (const path of READ_PATHS) {
    try {
      const res = await handle.app.fetch(new Request(`http://smoke${path}`, { headers }));
      if (res.status >= 500) {
        failures.push({ path, detail: `${res.status} ${(await res.text()).slice(0, 200)}` });
      } else if (res.status === 404) {
        failures.push({ path, detail: "404 — route not mounted" });
      } else if (res.status === 401 || res.status === 403) {
        failures.push({ path, detail: `${res.status} — signed in as the seeded admin and still refused` });
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
