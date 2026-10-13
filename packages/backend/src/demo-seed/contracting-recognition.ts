import type { App } from "@mezan/api";
import { step, BRANCH_ID, WAREHOUSE_ID, CORE } from "./shared.js";

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
const VILLAS_CONTRACT = "CTR-DEMO-9";
const VILLAS = "PRJ-DEMO-9";

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

  /**
   * العقد الخاسر. Cost has to be ON the contract before a run can compute a
   * percentage complete, so 620,000 of plaster and marble is posted to
   * PRJ-DEMO-9 first — through the same purchase-invoice path every other
   * project cost takes. The run that follows then reports
   * `provisionRequired` > 0 and the «عقد خاسر — مخصّص واجب» flag, because the
   * 4,600,000 estimate exceeds the 4,150,000 contract value.
   */
  await step(app, "POST", "/purchases/invoices", {
    id: "PI-DEMO-PRJ-9",
    supplierId: CORE.suppliers[0],
    date: "2026-08-12",
    dueDate: "2026-09-11",
    supplierInvoiceNumber: "SZ-2026-0441",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    projectId: VILLAS,
    lines: [
      { itemId: null, kind: "expense", description: "رخام وأرضيات لفيلات الشيخ زايد", qty: "1", unitCost: "380000", taxRateId: "VAT14", costCategory: "materials" },
      { itemId: null, kind: "expense", description: "أعمال محارة وبياض بالمقاولة", qty: "1", unitCost: "240000", taxRatePercent: 0, costCategory: "subcontract" },
    ],
  });
  await step(app, "POST", "/purchases/invoices/PI-DEMO-PRJ-9/confirm", {});

  await step(app, "POST", "/contracting/recognition/runs", {
    id: "RR-DEMO-VILLAS-2026-08-31",
    contractId: VILLAS_CONTRACT,
    periodEnd: "2026-08-31",
  });
}
