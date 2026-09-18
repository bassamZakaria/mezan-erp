import { boot } from "./scenarios/harness.js";
import { run as sales } from "./scenarios/sales.js";
import { run as purchases } from "./scenarios/purchases.js";
import { run as inventory } from "./scenarios/inventory.js";
import { run as accounting } from "./scenarios/accounting.js";
import { run as hr } from "./scenarios/hr.js";
import { run as crm } from "./scenarios/crm.js";
import { run as platform } from "./scenarios/platform.js";
import { run as shell } from "./scenarios/shell.js";
import { run as crossModule } from "./scenarios/cross-module.js";
import { run as seams } from "./scenarios/seams.js";
import { run as eta } from "./scenarios/eta.js";
import {
  run as reports,
  agingLaddersTieToTheirControlAccounts_D192,
  foreignInvoicesOnAccountReceiptsAndChequeVouchers_D194_D196,
  everyPartyTiesItsOwedLadderAndStatement,
} from "./scenarios/reports.js";
import { run as salesParity } from "./scenarios/sales-parity.js";
import { run as itemsForms } from "./scenarios/items-forms.js";
import { run as security } from "./scenarios/security.js";
import { run as securityUnits } from "./scenarios/security-units.js";

/**
 * `pnpm scenarios` — the executable half of docs/TESTING.md §2 Phase 3.
 *
 * Order matters: every module runs against the same seeded tenant, so a module
 * that moves stock or money changes what a later one sees. Read-mostly modules
 * run first, and the cross-module money trails run last because they spend both.
 *
 * `pnpm scenarios cross-module sales` runs only the named suites.
 */
const ctx = await boot();
const start = await ctx.invariants();
console.log(`baseline  tb ${start.tb.toFixed(6)} · inventory ${start.inventory.toFixed(6)} · ap ${start.ap.toFixed(6)} · ar ${start.ar.toFixed(6)}`);
const exactlyZero = (label: string, inv: Awaited<ReturnType<typeof ctx.invariants>>) => {
  for (const key of ["tb", "inventory", "ap", "ar"] as const) {
    if (inv.exact[key] !== 0n) ctx.failures.push(`${label} invariants · ${key} is ${inv[key].toFixed(6)}, not exactly 0`);
  }
};
exactlyZero("baseline", start);

const only = new Set(process.argv.slice(2));

if (!only.size || only.has("reports")) {
  process.stdout.write("  seeded-tenant…");
  const before = ctx.passes.length + ctx.failures.length;
  await agingLaddersTieToTheirControlAccounts_D192(ctx);
  await foreignInvoicesOnAccountReceiptsAndChequeVouchers_D194_D196(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

for (const [name, fn] of [
  ["security-units", securityUnits], ["security", security], ["shell", shell], ["items-forms", itemsForms], ["accounting", accounting], ["crm", crm], ["platform", platform], ["eta", eta],
  ["hr", hr], ["inventory", inventory], ["purchases", purchases], ["sales", sales], ["reports", reports],
  ["sales-parity", salesParity],
  ["cross-module", crossModule], ["seams", seams],
] as const) {
  if (only.size && !only.has(name)) continue;
  process.stdout.write(`  ${name}…`);
  const before = ctx.passes.length + ctx.failures.length;
  await fn(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

if (!only.size || only.has("reports")) {
  process.stdout.write("  end-of-run parties…");
  const before = ctx.passes.length + ctx.failures.length;
  await everyPartyTiesItsOwedLadderAndStatement(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

const end = await ctx.invariants();
console.log(`final     tb ${end.tb.toFixed(6)} · inventory ${end.inventory.toFixed(6)} · ap ${end.ap.toFixed(6)} · ar ${end.ar.toFixed(6)}`);
exactlyZero("final", end);
process.exit(ctx.report());
