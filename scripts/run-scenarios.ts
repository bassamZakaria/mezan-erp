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
import { run as salesParity } from "./scenarios/sales-parity.js";

/**
 * `pnpm scenarios` — the executable half of docs/testing-plan.md Phase 3.
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

const only = new Set(process.argv.slice(2));

for (const [name, fn] of [
  ["shell", shell], ["accounting", accounting], ["crm", crm], ["platform", platform], ["eta", eta],
  ["hr", hr], ["inventory", inventory], ["purchases", purchases], ["sales", sales],
  ["sales-parity", salesParity],
  ["cross-module", crossModule], ["seams", seams],
] as const) {
  if (only.size && !only.has(name)) continue;
  process.stdout.write(`  ${name}…`);
  const before = ctx.passes.length + ctx.failures.length;
  await fn(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

process.exit(ctx.report());
