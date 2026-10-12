import type { App } from "@mezan/api";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { step } from "./shared.js";

async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  if (!ctx.licensed("audit")) return;
  await step(app, "GET", "/security-reports/sod");
}

export const seed: SeedFragment = { run };
