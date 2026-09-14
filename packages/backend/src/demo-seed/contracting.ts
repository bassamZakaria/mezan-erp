import type { App } from "@mezan/api";
import { step, BRANCH_ID, WAREHOUSE_ID, ACCOUNTS, CORE } from "./shared.js";

/**
 * المقاولات — the first slice of the contracting module: cost and revenue that
 * reach a project through the two ledger dimensions, projectId and
 * costCategory (docs/artifacts/mezan-contracting-designs.html D-01). One
 * document per posting path the dimension runs through, so the project P&L on
 * «المشاريع» is derived from posted entries and not from anything typed here.
 */

const TOWER = "PRJ-DEMO-1";
const FITOUT = "PRJ-DEMO-3";
const TOWER_CUSTOMER = CORE.customers[1];
const CASH_TREASURY_ID = "TR-DEMO-CASH";
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const CHARGED_LABOUR_GL = "5110";
const SUNDRY_EXPENSE_GL = "5910";
const VAT_PERCENT = 14;

export async function seedContracting(app: App): Promise<void> {
  await step(app, "POST", "/purchases/invoices", {
    id: "PI-DEMO-PRJ-1",
    supplierId: CORE.suppliers[0],
    date: "2026-08-18",
    dueDate: "2026-09-17",
    supplierInvoiceNumber: "GV-2026-0902",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    projectId: TOWER,
    lines: [
      { itemId: null, kind: "expense", description: "أسمنت وحديد تسليح موردان للموقع", qty: "1", unitCost: "85000", taxRatePercent: VAT_PERCENT, costCategory: "materials" },
      { itemId: null, kind: "expense", description: "مقاول باطن — أعمال الحفر والردم", qty: "1", unitCost: "40000", taxRatePercent: 0, costCategory: "subcontract" },
    ],
  });
  await step(app, "POST", "/purchases/invoices/PI-DEMO-PRJ-1/confirm", {});

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-PRJ-1",
    date: "2026-08-20",
    memo: "أجور عمالة يومية — موقع برج الأمل",
    voucherType: "other_expense",
    amount: "18500.00",
    branchId: BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterpartyGlAccountId: CHARGED_LABOUR_GL,
    projectId: TOWER,
    costCategory: "labour",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-PRJ-1/confirm", {});

  // INVARIANT: the site movements draw CORE.items[1], never items[0]. PI-DEMO-1
  // funds ITEM-DEMO-1's only cost layer, and the purchases fulfilment scenario
  // needs stock left on it to move — 52 units taken here emptied it.
  await step(app, "POST", "/inventory/stock-adjustments/draft", {
    id: "ADJ-DEMO-PRJ-1",
    date: "2026-08-22",
    memo: "صرف مواد من المستودع الرئيسي إلى موقع برج الأمل",
    projectId: TOWER,
    costCategory: "materials",
    lines: [{ itemId: CORE.items[1], warehouseId: WAREHOUSE_ID, reason: "OTHER", direction: "OUT", qty: "12" }],
  });
  await step(app, "POST", "/inventory/stock-adjustments/ADJ-DEMO-PRJ-1/confirm", {});

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-PRJ-ADV",
    date: "2026-04-05",
    memo: "دفعة مقدمة على عقد برج الأمل — تُسترد من المستخلصات",
    voucherType: "customer_advance",
    amount: "60000.00",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: BANK_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.bank,
    customerId: TOWER_CUSTOMER,
    projectId: TOWER,
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-PRJ-ADV/confirm", {});


  await step(app, "POST", "/gl/journal-entries", {
    id: "JE-DEMO-PRJ-1",
    date: "2026-08-28",
    memo: "مصروفات غير مباشرة — تجهيز فرع جديد (كهرباء ومياه الموقع)",
    source: "manual",
    lines: [
      { accountId: SUNDRY_EXPENSE_GL, debit: "3200", credit: "0", memo: "كهرباء ومياه الموقع", projectId: FITOUT, costCategory: "indirect" },
      { accountId: ACCOUNTS.cash, debit: "0", credit: "3200", memo: "سداد نقدي", projectId: FITOUT },
    ],
  });
}

/**
 * الفاتورة المباشرة على مشروع بعقد نسبة إتمام — seeded AFTER the works contract
 * exists, because that is the whole point of it.
 *
 * INVARIANT: this invoice's 210,000 credits «فواتير مستخلصات على العقود» 2165,
 * NOT revenue 4100. PRJ-DEMO-1 runs a live cost_to_cost contract, so revenue on
 * it is recognised only by the monthly EAS 48 run; an invoice that credited
 * 4100 put the same work into the P&L twice. The re-route is the sales-invoice
 * confirm's own (`contractBilling`), and it states itself in the invoice memo.
 */
export async function seedContractingProjectInvoice(app: App): Promise<void> {
  await step(app, "POST", "/sales-invoices", {
    id: "INV-DEMO-PRJ-1",
    date: "2026-08-25",
    dueDate: "2026-09-24",
    customerId: TOWER_CUSTOMER,
    customerNameAr: "مؤسسة النور للمقاولات",
    warehouseId: WAREHOUSE_ID,
    branchId: BRANCH_ID,
    currency: "EGP",
    arAccountId: ACCOUNTS.receivable,
    taxAccountId: ACCOUNTS.outputVat,
    projectId: TOWER,
    lines: [
      {
        lineId: "INV-DEMO-PRJ-1-L1",
        itemId: "ITEM-DEMO-10",
        itemNameAr: "أعمال منفذة — الدفعة الأولى",
        isStock: false,
        qty: "1",
        unitPrice: "210000",
        taxRatePercent: VAT_PERCENT,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      },
    ],
  });
  await step(app, "POST", "/sales-invoices/INV-DEMO-PRJ-1/confirm", {});
}
