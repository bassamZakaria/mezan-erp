import type { App } from "@mezan/api";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { HISTORY_CUSTOMERS, HISTORY_ITEMS } from "./history-data.js";
import { ACCOUNTS, BRANCH_ID, VAT_RATE_ID, WAREHOUSE_ID, seedToday, step } from "./shared.js";

const WHOLESALE_CATEGORY = "جملة";
const FLOOR_ITEM = HISTORY_ITEMS[0];
const WHOLESALE_CUSTOMER = HISTORY_CUSTOMERS.find((customer) => customer.category === WHOLESALE_CATEGORY);
const BELOW_FLOOR_PRICE = "21.00";
const SOLD_QTY = 5;

async function onHandOf(app: App, itemId: string, code: string): Promise<number> {
  const rows = (await step(app, "GET", `/items?q=${encodeURIComponent(code)}`)) as { readonly id: string; readonly onHand: string | null }[];
  const row = rows.find((r) => r.id === itemId);
  return row?.onHand ? Math.floor(Number(row.onHand)) : 0;
}

// INVARIANT: approve-mode rules only — a later fragment confirming as a non-admin user must never be refused by a seeded Block rule.
async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  if (!ctx.licensed("sales") || !ctx.licensed("inventory") || !FLOOR_ITEM || !WHOLESALE_CUSTOMER) return;

  await step(app, "POST", "/workflow/configs", {
    actionType: "SALES_PRICE_FLOOR_OVERRIDE",
    steps: [{ role: "BRANCH_MANAGER", description: "اعتماد مدير الفرع للبيع دون الحد الأدنى للسعر أو هامش الربح" }],
  });

  await step(app, "POST", "/pricing-guard/rules", {
    id: "PGR-DEMO-1",
    nameAr: `حد أدنى لسعر ${FLOOR_ITEM.nameAr}`,
    itemId: FLOOR_ITEM.id,
    categoryId: null,
    customerCategory: null,
    floorPrice: "25.00",
    minMarginPercent: null,
    mode: "approval",
    note: "لا يباع تحت 25 جنيهاً للوحدة إلا باعتماد مدير الفرع.",
  });
  await step(app, "POST", "/pricing-guard/rules", {
    id: "PGR-DEMO-2",
    nameAr: "هامش ربح أدنى لعملاء الجملة",
    itemId: null,
    categoryId: null,
    customerCategory: WHOLESALE_CATEGORY,
    floorPrice: null,
    minMarginPercent: 8,
    mode: "approval",
    note: null,
  });
  const today = seedToday();
  await step(app, "POST", "/sales-quotes", {
    id: "SQ-DEMO-PF-1",
    date: today,
    expiryDate: today,
    customerId: WHOLESALE_CUSTOMER.id,
    customerNameAr: WHOLESALE_CUSTOMER.nameAr,
    branchId: BRANCH_ID,
    currency: "EGP",
    notes: "عرض بسعر خاص دون الحد الأدنى",
    lines: [{ lineId: "SQ-DEMO-PF-1-L1", itemId: FLOOR_ITEM.id, itemNameAr: FLOOR_ITEM.nameAr, qty: "20", unitPrice: BELOW_FLOOR_PRICE, taxRateId: VAT_RATE_ID }],
  });
  await step(app, "POST", "/sales-quotes/SQ-DEMO-PF-1/send", {});

  if ((await onHandOf(app, FLOOR_ITEM.id, FLOOR_ITEM.code)) < SOLD_QTY) return;
  const invoiceId = "INV-DEMO-PF-1";
  await step(app, "POST", "/sales-invoices", {
    id: invoiceId,
    date: today,
    dueDate: today,
    customerId: WHOLESALE_CUSTOMER.id,
    customerNameAr: WHOLESALE_CUSTOMER.nameAr,
    warehouseId: WAREHOUSE_ID,
    branchId: BRANCH_ID,
    currency: "EGP",
    arAccountId: ACCOUNTS.receivable,
    taxAccountId: ACCOUNTS.outputVat,
    lines: [
      {
        lineId: `${invoiceId}-L1`,
        itemId: FLOOR_ITEM.id,
        itemNameAr: FLOOR_ITEM.nameAr,
        isStock: true,
        qty: String(SOLD_QTY),
        unitPrice: BELOW_FLOOR_PRICE,
        taxRateId: VAT_RATE_ID,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      },
    ],
  });
  await step(app, "POST", `/sales-invoices/${invoiceId}/confirm`, {});
}

export const seed: SeedFragment = {
  roleGrants: {
    SUPERVISOR: ["sales.pricing_guard.view"],
    BRANCH_MANAGER: ["sales.pricing_guard.view", "sales.pricing_guard.manage", "workflow.approve", "workflow.reject"],
    FINANCE_MANAGER: ["sales.pricing_guard.view"],
    AUDITOR: ["sales.pricing_guard.view"],
  },
  run,
};
