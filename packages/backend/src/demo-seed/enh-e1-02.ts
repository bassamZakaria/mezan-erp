import type { App } from "@mezan/api";
import { Money } from "@mezan/domain";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { step } from "./shared.js";

const THOUSAND = 1_000_000_000n;

function roundDownToThousand(scaled: bigint): bigint {
  const rounded = (scaled / THOUSAND) * THOUSAND;
  return rounded > 0n ? rounded : THOUSAND;
}

async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  if (!ctx.licensed("treasury")) return;
  const forecast = (await step(app, "GET", "/cash-forecast?horizon=90")) as { openingCash: string; lowest: { balance: string } };
  const opening = Money.fromMajor(forecast.openingCash).scaled;
  const lowest = Money.fromMajor(forecast.lowest.balance).scaled;
  const threshold = lowest < opening ? roundDownToThousand(lowest + (opening - lowest) / 2n) : roundDownToThousand(opening / 2n);
  await step(app, "PUT", "/cash-forecast/threshold", { amount: Money.fromScaled(threshold).toString() });
  await step(app, "GET", "/cash-forecast?horizon=90");
}

export const seed: SeedFragment = {
  roleGrants: {
    FINANCE_MANAGER: ["treasury.cash_forecast.view", "treasury.cash_forecast.manage"],
    TREASURY_CASHIER: ["treasury.cash_forecast.view"],
    AUDITOR: ["treasury.cash_forecast.view"],
  },
  run,
};
