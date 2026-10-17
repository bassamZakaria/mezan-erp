import type { SeedFragment } from "./fragments.js";
import { ACCOUNTS, step } from "./shared.js";

/**
 * One seeded recurring-journal template — رسوم اشتراك سحابي — so the
 * templates list, the due worklist and the history are never empty on a demo
 * tenant.
 *
 * INVARIANT: every period but the latest is generated, and the latest is left
 * outstanding. Generating with no date bound takes the latest too and the
 * «المستحق» worklist opens empty; `period-close.ts` posts the January-to-July
 * entries this leaves behind, so those must stay generated.
 */
const TEMPLATE_ID = "RJT-DEMO-1";
const FIRST_DAY_OF_PERIOD = 1;

function dayBefore(day: string): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

export const seed: SeedFragment = {
  async run(app) {
    await step(app, "POST", "/gl/recurring/templates", {
      id: TEMPLATE_ID,
      nameAr: "رسوم اشتراك سحابي شهرية",
      nameEn: "Monthly cloud subscription fee",
      memo: "رسوم اشتراك الخدمات السحابية",
      frequency: "monthly",
      dayOfPeriod: FIRST_DAY_OF_PERIOD,
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
    const worklist = (await step(app, "GET", "/gl/recurring/due")) as { due: readonly { templateId: string; periods: readonly string[] }[] };
    const outstanding = worklist.due.find((entry) => entry.templateId === TEMPLATE_ID)?.periods ?? [];
    const latest = outstanding[outstanding.length - 1];
    if (!latest || outstanding.length < 2) return;
    await step(app, "POST", "/gl/recurring/generate-due", {
      templateIds: [TEMPLATE_ID],
      asOfDate: dayBefore(`${latest}-${String(FIRST_DAY_OF_PERIOD).padStart(2, "0")}`),
    });
  },
};
