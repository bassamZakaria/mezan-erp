import { createBackend } from "../../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Does changing the branch / warehouse scope actually change what the API returns? */

const dir = mkdtempSync(join(tmpdir(), "mezan-scope-"));
const { app } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true });

async function get(path: string, branch: string, warehouse: string) {
  const res = await app.fetch(new Request(`http://scope${path}`, {
    headers: {
      "x-user-id": "USER-ADMIN", "x-permissions": "*", "x-role-codes": "*",
      "x-branch-scope": branch, "x-warehouse-scope": warehouse,
    },
  }));
  if (!res.ok) return { n: -res.status, sample: "" };
  const b: any = await res.json().catch(() => null);
  const arr = Array.isArray(b) ? b : (b?.items ?? b?.rows ?? b?.data ?? b?.entries ?? []);
  return { n: Array.isArray(arr) ? arr.length : -1, sample: JSON.stringify(arr).slice(0, 60) };
}

const branches: any[] = await (await app.fetch(new Request("http://scope/branches", { headers: { "x-user-id": "USER-ADMIN", "x-permissions": "*", "x-branch-scope": "*" } }))).json();
const warehouses: any[] = await (await app.fetch(new Request("http://scope/warehouses", { headers: { "x-user-id": "USER-ADMIN", "x-permissions": "*", "x-warehouse-scope": "*" } }))).json();
console.log("branches:", branches.map((b) => b.id + " " + b.name).join(" | "));
console.log("warehouses:", warehouses.map((w) => w.id + " " + (w.nameAr ?? w.name)).join(" | "));

const BRANCH_SCOPED = ["/sales-invoices", "/purchases/invoices", "/vouchers", "/journal-entries", "/gl/journal-entries", "/audit", "/hr/employees", "/projects", "/crm/leads"];
const WAREHOUSE_SCOPED = ["/inventory/stock-balance", "/inventory/transfers", "/inventory/adjustments", "/inventory/physical-counts", "/reports/inventory/valuation", "/reports/inventory/stock-levels"];

const b0 = branches[0]?.id, b1 = branches[1]?.id;
const w0 = warehouses[0]?.id, w1 = warehouses[1]?.id;

console.log(`\n=== branch scope: "*" vs "${b0}" vs "${b1 ?? "(only one branch)"}" ===`);
for (const p of BRANCH_SCOPED) {
  const all = await get(p, "*", "*");
  const one = await get(p, b0, "*");
  const other = b1 ? await get(p, b1, "*") : { n: NaN, sample: "" };
  const narrows = all.n > 0 && (one.n < all.n || (b1 !== undefined && other.n !== one.n));
  console.log(`  ${narrows ? "scoped " : "SAME   "} ${p.padEnd(30)} all=${all.n} ${b0}=${one.n}${b1 ? ` ${b1}=${other.n}` : ""}`);
}

console.log(`\n=== warehouse scope: "*" vs "${w0}" vs "${w1 ?? "(only one)"}" ===`);
for (const p of WAREHOUSE_SCOPED) {
  const all = await get(p, "*", "*");
  const one = await get(p, "*", w0);
  const other = w1 ? await get(p, "*", w1) : { n: NaN, sample: "" };
  const narrows = all.n > 0 && (one.n < all.n || (w1 !== undefined && other.n !== one.n));
  console.log(`  ${narrows ? "scoped " : "SAME   "} ${p.padEnd(30)} all=${all.n} ${w0}=${one.n}${w1 ? ` ${w1}=${other.n}` : ""}`);
}
