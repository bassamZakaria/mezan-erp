import type { App } from "@mezan/api";
import type { SeedFragment } from "./fragments.js";
import { ACCOUNTS, CORE, VAT_PERCENT, call, seedBranchActorHeaders, step } from "./shared.js";

/**
 * A second branch with its own warehouse, cash drawer and trade (D111).
 *
 * Every other seeded document is raised in BR-MAIN, so a branch filter over
 * the seeded books had one branch and the unattributed bucket to choose from
 * and could not be shown to narrow anything.
 */
export const SECOND_BRANCH_ID = "BR-ALEX";
export const SECOND_BRANCH_WAREHOUSE_ID = "WH-ALEX";
export const SECOND_BRANCH_CASH_GL_ACCOUNT_ID = "1300-ALEX";
const SECOND_BRANCH_TREASURY_ID = "TR-DEMO-CASH-ALEX";
const PURCHASE_INVOICE_ID = "PI-DEMO-ALEX-1";
const SALES_INVOICE_ID = "INV-DEMO-ALEX-1";
const COLLECTION_VOUCHER_ID = "VCH-DEMO-ALEX-1";
export const PENDING_PRICING_ITEM_ID = "ITEM-DEMO-ALEX-PENDING";
const BRANCH_CLERK_USER_ID = "USER-DEMO-ALEX-CLERK";
const LIMIT_REFUSALS = new Set(["BRANCH_LIMIT_REACHED", "WAREHOUSE_LIMIT_REACHED"]);

/** Creates a location, or reports that the tenant's plan holds no room for it. Any other refusal is a real failure. */
async function createWithinPlan(app: App, path: string, body: unknown): Promise<boolean> {
  const res = await call(app, "POST", path, body);
  if (res.ok) return true;
  const text = await res.text();
  const refusal = (() => {
    try {
      return (JSON.parse(text) as { error?: string }).error ?? "";
    } catch {
      return "";
    }
  })();
  if (LIMIT_REFUSALS.has(refusal)) return false;
  throw new Error(`[demo-seed] POST ${path} failed with ${res.status}: ${text}`);
}

async function run(app: App): Promise<void> {
  const branchCreated = await createWithinPlan(app, "/branches", {
    id: SECOND_BRANCH_ID,
    code: "ALEX",
    name: "فرع الإسكندرية",
    address: "طريق الحرية، الإسكندرية",
  });
  if (!branchCreated) {
    console.warn(`[demo-seed] ${SECOND_BRANCH_ID} was NOT seeded: the tenant's plan holds no room for a second branch. Every seeded posting is in one branch, so a branch filter has nothing to narrow.`);
    return;
  }
  const warehouseCreated = await createWithinPlan(app, "/warehouses", {
    id: SECOND_BRANCH_WAREHOUSE_ID,
    code: "WH-ALEX",
    name: "مستودع الإسكندرية",
    nameEn: "Alexandria Warehouse",
    branchId: SECOND_BRANCH_ID,
  });
  if (!warehouseCreated) {
    console.warn(`[demo-seed] ${SECOND_BRANCH_WAREHOUSE_ID} was NOT seeded: the tenant's plan holds no room for another warehouse, so ${SECOND_BRANCH_ID} exists with no trade in it.`);
    return;
  }

  await step(app, "POST", "/accounts", {
    id: SECOND_BRANCH_CASH_GL_ACCOUNT_ID,
    code: SECOND_BRANCH_CASH_GL_ACCOUNT_ID,
    nameAr: "خزينة فرع الإسكندرية",
    nameEn: "Alexandria Cash Drawer",
    type: "asset",
    naturalBalance: "debit",
    parentId: "1300",
    isHeader: false,
  });
  await step(app, "POST", "/treasury-accounts", {
    id: SECOND_BRANCH_TREASURY_ID,
    code: "CASH-ALEX",
    name: "خزينة فرع الإسكندرية",
    nameEn: "Alexandria Cash Drawer",
    type: "cash",
    currency: "EGP",
    bankAccountNumber: null,
    glAccountId: SECOND_BRANCH_CASH_GL_ACCOUNT_ID,
    branchId: SECOND_BRANCH_ID,
  });

  await step(app, "POST", "/purchases/invoices", {
    id: PURCHASE_INVOICE_ID,
    supplierId: CORE.suppliers[0],
    date: "2026-08-12",
    branchId: SECOND_BRANCH_ID,
    warehouseId: SECOND_BRANCH_WAREHOUSE_ID,
    currency: "EGP",
    lines: [{ itemId: CORE.items[0], qty: "40", unitCost: "140", kind: "inventory", taxRatePercent: VAT_PERCENT }],
  });
  await step(app, "POST", `/purchases/invoices/${PURCHASE_INVOICE_ID}/confirm`, {});

  await step(app, "POST", "/sales-invoices", {
    id: SALES_INVOICE_ID,
    date: "2026-08-14",
    dueDate: "2026-09-13",
    customerId: CORE.customers[1],
    customerNameAr: "مؤسسة النور للمقاولات",
    warehouseId: SECOND_BRANCH_WAREHOUSE_ID,
    branchId: SECOND_BRANCH_ID,
    currency: "EGP",
    arAccountId: ACCOUNTS.receivable,
    taxAccountId: ACCOUNTS.outputVat,
    lines: [
      {
        lineId: `${SALES_INVOICE_ID}-L1`,
        itemId: CORE.items[0],
        itemNameAr: "أرز أبيض 5 كجم",
        isStock: true,
        qty: "12",
        unitPrice: "210",
        taxRatePercent: VAT_PERCENT,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      },
    ],
  });
  await step(app, "POST", `/sales-invoices/${SALES_INVOICE_ID}/confirm`, {});

  await step(app, "POST", "/vouchers", {
    id: COLLECTION_VOUCHER_ID,
    date: "2026-08-16",
    memo: "تحصيل نقدي بفرع الإسكندرية",
    voucherType: "customer_collection",
    amount: "1000.00",
    branchId: SECOND_BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: SECOND_BRANCH_TREASURY_ID,
    treasuryGlAccountId: SECOND_BRANCH_CASH_GL_ACCOUNT_ID,
    counterpartyGlAccountId: ACCOUNTS.receivable,
    customerId: CORE.customers[1],
  });
  await step(app, "POST", `/vouchers/${COLLECTION_VOUCHER_ID}/confirm`, {});
  await step(app, "POST", `/vouchers/${COLLECTION_VOUCHER_ID}/allocations`, { invoiceId: SALES_INVOICE_ID, amount: "1000.00" });

  const asBranchClerk = seedBranchActorHeaders(BRANCH_CLERK_USER_ID, ["inventory.item.view", "inventory.item.create"], [SECOND_BRANCH_ID]);
  const created = await app.fetch(
    new Request("http://demo-seed/items", {
      method: "POST",
      headers: asBranchClerk,
      body: JSON.stringify({ id: PENDING_PRICING_ITEM_ID, nameAr: "شاي أخضر 250 جم — طلب فرع الإسكندرية", nameEn: "Green tea 250g — Alexandria branch request", type: "stock", baseUnitCode: "PCS" }),
    }),
  );
  if (!created.ok) throw new Error(`[demo-seed] POST /items as the branch clerk failed with ${created.status}: ${await created.text()}`);
}

export const seed: SeedFragment = { run };
