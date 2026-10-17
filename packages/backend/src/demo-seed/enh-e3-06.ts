import type { App } from "@mezan/api";
import type { SeedFragment } from "./fragments.js";
import { BRANCH_ID, CORE, SEED_TENANT_DOMAIN, VAT_RATE_ID, seedToday, step } from "./shared.js";

const REP_LOCAL = "karim.fouad";
const MANAGER_LOCAL = "sameh.fathy";
const QUOTED_DEAL_ID = "OPP-DEMO-E306-3";
const QUOTED_ITEM = { id: "ITEM-DEMO-2", nameAr: "زيت عباد الشمس 1 لتر", unitPrice: "95" };
const QUOTED_CUSTOMER_NAME_AR = "مجموعة الفجر التجارية";

function monthsAhead(day: string, months: number): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.toISOString().slice(0, 10);
}

async function run(app: App): Promise<void> {
  const users = (await step(app, "GET", "/users")) as readonly { id: string; email: string }[];
  const idOf = (local: string): string => {
    const user = users.find((u) => u.email === `${local}@${SEED_TENANT_DOMAIN}`);
    if (!user) throw new Error(`[demo-seed] no seeded user "${local}"`);
    return user.id;
  };
  const rep = idOf(REP_LOCAL);
  const manager = idOf(MANAGER_LOCAL);

  for (const [dealId, owner] of [
    ["OPP-DEMO-1", rep],
    ["OPP-DEMO-3", rep],
    ["OPP-DEMO-7", rep],
    ["OPP-DEMO-2", manager],
    ["OPP-DEMO-4", manager],
  ] as const) {
    await step(app, "POST", `/crm/opportunities/${dealId}/assign`, { ownerUserId: owner });
  }

  const today = seedToday();
  await step(app, "POST", "/crm/opportunities", {
    id: "OPP-DEMO-E306-1",
    title: "توريد دوري لمطاعم المجموعة",
    customerId: CORE.customers[0],
    branchId: BRANCH_ID,
    stageId: "STAGE-QUOTE",
    expectedValue: "72000",
    probability: 40,
    expectedCloseDate: monthsAhead(today, 1),
    notes: "بانتظار رد المشتريات على العرض.",
    ownerUserId: rep,
  });
  await step(app, "POST", "/crm/opportunities", {
    id: "OPP-DEMO-E306-2",
    title: "عقد صيانة وتوريد ربع سنوي",
    customerId: CORE.customers[1],
    branchId: BRANCH_ID,
    stageId: "STAGE-NEGOTIATION",
    expectedValue: "310000",
    probability: 60,
    expectedCloseDate: monthsAhead(today, 2),
    notes: "التفاوض على جدول الدفعات.",
    ownerUserId: manager,
  });

  await step(app, "POST", "/crm/opportunities", {
    id: QUOTED_DEAL_ID,
    title: "توريد زيوت للفروع — مجموعة الفجر",
    customerId: CORE.customers[2],
    branchId: BRANCH_ID,
    stageId: "STAGE-QUOTE",
    expectedValue: "13000",
    probability: 40,
    expectedCloseDate: today,
    notes: "أُرسل عرض السعر وقبله العميل، فتُغلق الفرصة رابحة تلقائياً.",
    ownerUserId: rep,
  });

  await step(app, "POST", "/crm/activities", {
    id: "ACT-DEMO-E306-1",
    subject: "الاتصال بالمشتريات لمتابعة العرض",
    type: "call",
    relatedOpportunityId: "OPP-DEMO-E306-1",
    dueDate: today,
    assigneeUserId: rep,
    notes: "تذكير تلقائي في يوم الاستحقاق.",
  });
  await step(app, "POST", "/crm-pipeline/reminders/run", {});

  const quoteId = "SQ-DEMO-E306-1";
  await step(app, "POST", "/sales-quotes", {
    id: quoteId,
    date: today,
    expiryDate: monthsAhead(today, 1),
    customerId: CORE.customers[2],
    customerNameAr: QUOTED_CUSTOMER_NAME_AR,
    branchId: BRANCH_ID,
    opportunityId: QUOTED_DEAL_ID,
    currency: "EGP",
    notes: "عرض مرتبط بفرصة البيع.",
    lines: [
      {
        lineId: `${quoteId}-L1`,
        itemId: QUOTED_ITEM.id,
        itemNameAr: QUOTED_ITEM.nameAr,
        qty: "120",
        unitPrice: QUOTED_ITEM.unitPrice,
        taxRateId: VAT_RATE_ID,
      },
    ],
  });
  await step(app, "POST", `/sales-quotes/${quoteId}/send`, {});
  await step(app, "POST", `/sales-quotes/${quoteId}/accept`, {});
}

export const seed: SeedFragment = {
  roleGrants: {
    SALES_REP: [
      "crm.opportunity.view_own",
      "crm.opportunity.create",
      "crm.opportunity.edit",
      "crm.activity.view",
      "crm.activity.create",
      "crm.activity.edit",
      "crm.pipeline.view",
    ],
    SUPERVISOR: ["crm.opportunity.view", "crm.pipeline.view"],
    CRM_MANAGER: ["crm.opportunity.assign"],
  },
  run,
};
