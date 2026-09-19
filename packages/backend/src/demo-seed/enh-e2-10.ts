import type { App } from "@mezan/api";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { step } from "./shared.js";

/**
 * ENH-051 — no fixtures to seed: the role-level conflicts this report shows
 * (FINANCE_MANAGER holding both `accounting.journal.post` and
 * `accounting.period.close`; TREASURY_CASHIER holding both
 * `treasury.cash_voucher.create` and `.confirm`) already exist in the base
 * seed's own role grants (`demo-seed/access.ts`) — a realistic SMB finding,
 * not a fixture invented for this screen. This only primes the report once so
 * an empty first read is never mistaken for a broken route.
 */
async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  if (!ctx.licensed("audit")) return;
  await step(app, "GET", "/security-reports/sod");
}

export const seed: SeedFragment = { run };
