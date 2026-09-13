import type { App } from "@mezan/api";
import { step } from "./shared.js";

/**
 * تشغيل الاعتراف بالإيراد — the monthly EAS 48 cost-to-cost run (design D-03,
 * D-12), seeded month by month through the SAME route the «تشغيل» button hits.
 *
 * Nothing here states a figure: the run derives the cost to date, what has been
 * billed and what sits in أعمال تحت التنفيذ from the posted ledger, so after
 * the last month 1230 reads zero for the project and 1170 − 2175 equals
 * revenue recognised less billed.
 */

const TOWER_CONTRACT = "CTR-DEMO-1";
const FITOUT_CONTRACT = "CTR-DEMO-3";

/** Consecutive months: the run refuses a month whose predecessor has not been run. */
const TOWER_PERIODS = ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"];

export async function seedContractingRecognition(app: App): Promise<void> {
  for (const periodEnd of TOWER_PERIODS) {
    await step(app, "POST", "/contracting/recognition/runs", {
      id: `RR-DEMO-TOWER-${periodEnd}`,
      contractId: TOWER_CONTRACT,
      periodEnd,
    });
  }

  // The fit-out was handed over in July, but a cost still landed on it in
  // August — which is exactly why a completed contract keeps being run until
  // its months are closed.
  await step(app, "POST", "/contracting/recognition/runs", {
    id: "RR-DEMO-FITOUT-2026-08-31",
    contractId: FITOUT_CONTRACT,
    periodEnd: "2026-08-31",
  });
}
