import type { SeedFragment } from "./fragments.js";
import { step } from "./shared.js";

export const seed: SeedFragment = {
  roleGrants: {
    TREASURY_CASHIER: ["treasury.reconciliation.post_entry"],
    FINANCE_MANAGER: ["treasury.reconciliation.manage", "treasury.reconciliation.post_entry"],
  },
  run: async (app, ctx) => {
    if (!ctx.licensed("treasury")) return;
    const rules = [
      { name: "مصاريف خدمات بنكية", pattern: "مصاريف", priority: 10 },
      { name: "رسوم التحويلات", pattern: "رسوم", priority: 20 },
    ];
    for (const rule of rules) {
      await step(app, "POST", "/bank-statements/rules", {
        name: rule.name,
        pattern: rule.pattern,
        matchType: "contains",
        direction: "out",
        treasuryAccountId: null,
        accountId: "5910",
        costCenterId: null,
        priority: rule.priority,
        active: true,
      });
    }
  },
};
