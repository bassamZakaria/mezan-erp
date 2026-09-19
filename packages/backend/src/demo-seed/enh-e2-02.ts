import type { SeedFragment } from "./fragments.js";
import { ACCOUNTS, step } from "./shared.js";

/**
 * One seeded recurring-journal template — رسوم اشتراك سحابي — so the
 * templates list, the due worklist and (once generated) the history are
 * never empty on a demo tenant. `startDate` is well before any seeding run,
 * so at least one period is already due the moment the screen opens.
 */
const TEMPLATE_ID = "RJT-DEMO-1";

export const seed: SeedFragment = {
  async run(app) {
    await step(app, "POST", "/gl/recurring/templates", {
      id: TEMPLATE_ID,
      nameAr: "رسوم اشتراك سحابي شهرية",
      nameEn: "Monthly cloud subscription fee",
      memo: "رسوم اشتراك الخدمات السحابية",
      frequency: "monthly",
      dayOfPeriod: 1,
      yearlyMonth: null,
      startDate: "2026-01-01",
      endDate: null,
      autoReverseNextPeriod: false,
      lines: [
        // 5910 — مصروفات أخرى (Other Expenses), the standard chart's catch-all
        // operating-expense account (coa-template.ts); not in `ACCOUNTS` since
        // no other seed module needed it yet.
        { accountId: "5910", debit: "500.00", credit: "0.00" },
        { accountId: ACCOUNTS.cash, debit: "0.00", credit: "500.00" },
      ],
    });
    // One generated period, so the History tab is never empty either.
    await step(app, "POST", "/gl/recurring/generate-due", { templateIds: [TEMPLATE_ID] });
  },
};
