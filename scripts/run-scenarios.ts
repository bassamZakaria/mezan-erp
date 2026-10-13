// Must stay the first import: it moves the clock before any module reads it.
import "./scenarios/fake-clock.js";
import { boot } from "./scenarios/harness.js";
import { connectionTurnFindings } from "./connection-turn-guard.js";
import { run as demoClose } from "./scenarios/demo-close.js";
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
import { run as trialFreemium } from "./scenarios/trial-freemium.js";
import { run as eta } from "./scenarios/eta.js";
import {
  run as reports,
  agingLaddersTieToTheirControlAccounts_D192,
  foreignInvoicesOnAccountReceiptsAndChequeVouchers_D194_D196,
  foreignSettlementReportsAndReturns_D201_D203,
  foreignRatesSettleAndReturnInputs_D213_D222,
  foreignSettledInBaseIsNotRevalued_D260,
  allocationUndoneAndMadeAgainSettlesOnce_D265,
  voucherReversalDatedByReversalDay_D270,
  depreciationRunReversalDatedByReversalDay_D275,
  everyPartyTiesItsOwedLadderAndStatement,
  laddersTieOnPastDays_D220,
} from "./scenarios/reports.js";
import { run as salesParity } from "./scenarios/sales-parity.js";
import { run as itemsForms } from "./scenarios/items-forms.js";
import { run as security } from "./scenarios/security.js";
import { run as securityUnits } from "./scenarios/security-units.js";
import { POS_SCENARIOS } from "./scenarios/pos.js";
import { ENH_SCENARIOS } from "./scenarios/enh.js";
import type { Ctx } from "./scenarios/harness.js";

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
console.log(`baseline  tb ${start.tb.toFixed(6)} · inventory ${start.inventory.toFixed(6)} · ap ${start.ap.toFixed(6)} · ar ${start.ar.toFixed(6)} · 2120 ${start.grni.toFixed(6)} · fx residue ${start.fxResidue.toFixed(6)} · stock/ledger dates ${start.stockLedgerDates}`);
const exactlyZero = (label: string, inv: Awaited<ReturnType<typeof ctx.invariants>>) => {
  for (const key of ["tb", "inventory", "ap", "ar", "grni", "fxResidue"] as const) {
    if (inv.exact[key] !== 0n) ctx.failures.push(`${label} invariants · ${key} is ${inv[key].toFixed(6)}, not exactly 0`);
  }
  if (inv.exact.stockLedgerDates !== 0n) ctx.failures.push(`${label} invariants · stockLedgerDates is ${inv.stockLedgerDates}, not exactly 0`);
};
exactlyZero("baseline", start);

const only = new Set(process.argv.slice(2));

{
  process.stdout.write("  demo-close…");
  const before = ctx.passes.length + ctx.failures.length;
  await demoClose(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

if (!only.size || only.has("reports")) {
  process.stdout.write("  seeded-tenant…");
  const before = ctx.passes.length + ctx.failures.length;
  await agingLaddersTieToTheirControlAccounts_D192(ctx);
  await foreignInvoicesOnAccountReceiptsAndChequeVouchers_D194_D196(ctx);
  await foreignSettlementReportsAndReturns_D201_D203(ctx);
  await foreignRatesSettleAndReturnInputs_D213_D222(ctx);
  await foreignSettledInBaseIsNotRevalued_D260(ctx);
  await allocationUndoneAndMadeAgainSettlesOnce_D265(ctx);
  await voucherReversalDatedByReversalDay_D270(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

const fragmentSuites = [...POS_SCENARIOS, ...ENH_SCENARIOS].flatMap(([name, scenario]) =>
  scenario.run ? [[name, scenario.run] as const] : [],
);

const suites: readonly (readonly [string, (ctx: Ctx) => Promise<unknown>])[] = [
  ["security-units", securityUnits], ["security", security], ["shell", shell], ["items-forms", itemsForms], ["accounting", accounting], ["crm", crm], ["platform", platform], ["eta", eta],
  ["hr", hr], ["inventory", inventory], ["purchases", purchases], ["sales", sales], ["reports", reports],
  ["sales-parity", salesParity],
  ...fragmentSuites,
  ["cross-module", crossModule], ["seams", seams],
  // LAST, and on its own cloud app: it moves the process clock forward six
  // weeks to walk the trial, and restores it when it is done.
  ["trial-freemium", trialFreemium],
];

for (const [name, fn] of suites) {
  const family = name.startsWith("pos-") ? "pos" : name.startsWith("enh-") ? "enh" : null;
  if (only.size && !only.has(name) && !(family && only.has(family))) continue;
  process.stdout.write(`  ${name}…`);
  const before = ctx.passes.length + ctx.failures.length;
  await fn(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

if (!only.size || only.has("reports")) {
  process.stdout.write("  end-of-run parties…");
  const before = ctx.passes.length + ctx.failures.length;
  await everyPartyTiesItsOwedLadderAndStatement(ctx);
  await laddersTieOnPastDays_D220(ctx);
  // Runs LAST, like cross-module: it registers a new active asset that would
  // otherwise inflate every eligible-asset count an earlier suite (crm.ts)
  // asserts exactly.
  await depreciationRunReversalDatedByReversalDay_D275(ctx);
  console.log(` ${ctx.passes.length + ctx.failures.length - before} assertions`);
}

const end = await ctx.invariants();
console.log(`final     tb ${end.tb.toFixed(6)} · inventory ${end.inventory.toFixed(6)} · ap ${end.ap.toFixed(6)} · ar ${end.ar.toFixed(6)} · 2120 ${end.grni.toFixed(6)} · fx residue ${end.fxResidue.toFixed(6)} · stock/ledger dates ${end.stockLedgerDates}`);
exactlyZero("final", end);
for (const finding of connectionTurnFindings()) ctx.failures.push(`connection turn · ${finding}`);
process.exit(ctx.report());
