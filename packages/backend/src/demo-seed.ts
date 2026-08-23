import type { App } from "@mezan/api";

/**
 * SEED PROFILE FOR TESTS AND LOCAL DEVELOPMENT ONLY.
 *
 * Never call this from a shipped edition. `createBackend` runs it only when
 * `seedDemoData: true` is passed explicitly, which apps/server does solely on
 * `MEZAN_SEED_DEMO=1` and apps/desktop never does — a real install must reach a
 * screen with zero rows rather than with invented ones.
 *
 * Everything below enters through the SAME HTTP routes a user's clicks hit, so
 * the data it produces is real in every sense that matters: documents are
 * confirmed through their services, stock moves at the real weighted-average
 * cost, and the general ledger receives balanced postings. Nothing here is a
 * fixture the UI reads directly.
 */

const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-user-id": "SEED-ADMIN",
  "x-permissions": "*",
  "x-branch-scope": "*",
  "x-warehouse-scope": "*",
};

const BRANCH_ID = "BR-MAIN";
const WAREHOUSE_ID = "WH-MAIN";

/** Standard chart-of-accounts ids from `packages/domain/src/accounts/coa-template.ts`. */
const ACCOUNTS = {
  receivable: "1105",
  inventory: "1200",
  cash: "1300-1",
  bank: "1310",
  inputVat: "1400",
  payable: "2100",
  outputVat: "2200",
  revenue: "4100",
  cogs: "5100",
} as const;

async function call(app: App, method: string, path: string, body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers: ADMIN_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/**
 * A seeded step must not fail silently: a route that changed shape would
 * otherwise leave a half-populated tenant that looks like a product bug.
 */
async function step(app: App, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await call(app, method, path, body);
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

const CUSTOMERS = [
  { id: "CUST-DEMO-1", code: "C-0001", nameAr: "شركة الأمل للتجارة", nameEn: "Al Amal Trading", phone: "01001234567", paymentTermsDays: 30, creditLimit: "50000" },
  { id: "CUST-DEMO-2", code: "C-0002", nameAr: "مؤسسة النور للمقاولات", nameEn: "Al Nour Contracting", phone: "01112223344", paymentTermsDays: 45, creditLimit: "120000" },
  { id: "CUST-DEMO-3", code: "C-0003", nameAr: "مجموعة الفجر التجارية", nameEn: "Al Fajr Group", phone: "01223334455", paymentTermsDays: 15, creditLimit: "25000" },
];

const SUPPLIERS = [
  { id: "SUPP-DEMO-1", code: "S-0001", nameAr: "مصنع الوادي الأخضر", nameEn: "Green Valley Factory", phone: "01098765432", paymentTermsDays: 30 },
  { id: "SUPP-DEMO-2", code: "S-0002", nameAr: "شركة سياج للصناعات", nameEn: "Siyaj Industries", phone: "01187654321", paymentTermsDays: 60 },
];

const ITEMS = [
  { id: "ITEM-DEMO-1", code: "IT-0001", nameAr: "أرز أبيض ٥ كجم", nameEn: "White Rice 5kg", salePrice: "180", costPrice: "140" },
  { id: "ITEM-DEMO-2", code: "IT-0002", nameAr: "زيت عباد الشمس ١ لتر", nameEn: "Sunflower Oil 1L", salePrice: "95", costPrice: "72" },
  { id: "ITEM-DEMO-3", code: "IT-0003", nameAr: "سكر أبيض ١ كجم", nameEn: "White Sugar 1kg", salePrice: "42", costPrice: "31" },
  { id: "ITEM-DEMO-4", code: "IT-0004", nameAr: "شاي أسود ٥٠٠ جم", nameEn: "Black Tea 500g", salePrice: "260", costPrice: "205" },
];

const COST_CENTERS = [
  { id: "CC-DEMO-1", code: "CC-100", nameAr: "المبيعات", nameEn: "Sales" },
  { id: "CC-DEMO-2", code: "CC-200", nameAr: "الإدارة", nameEn: "Administration" },
];

const TREASURY_ACCOUNTS = [
  { id: "TR-DEMO-CASH", code: "CASH-001", name: "الخزينة الرئيسية", type: "cash", glAccountId: ACCOUNTS.cash },
  { id: "TR-DEMO-BANK", code: "BANK-001", name: "البنك الأهلي — جاري", type: "bank", glAccountId: ACCOUNTS.bank },
];

/** Purchases run first: sales cannot issue stock the warehouse never received. */
const PURCHASE_INVOICES = [
  {
    id: "PI-DEMO-1",
    supplierId: "SUPP-DEMO-1",
    date: "2026-07-06",
    lines: [
      { itemId: "ITEM-DEMO-1", qty: "200", unitCost: "140" },
      { itemId: "ITEM-DEMO-3", qty: "500", unitCost: "31" },
    ],
  },
  {
    id: "PI-DEMO-2",
    supplierId: "SUPP-DEMO-2",
    date: "2026-07-21",
    lines: [
      { itemId: "ITEM-DEMO-2", qty: "300", unitCost: "72" },
      { itemId: "ITEM-DEMO-4", qty: "80", unitCost: "205" },
    ],
  },
];

const SALES_INVOICES = [
  {
    id: "INV-DEMO-1",
    customerId: "CUST-DEMO-1",
    date: "2026-08-04",
    dueDate: "2026-09-03",
    lines: [
      { itemId: "ITEM-DEMO-1", qty: "40", unitPrice: "180" },
      { itemId: "ITEM-DEMO-3", qty: "120", unitPrice: "42" },
    ],
  },
  {
    id: "INV-DEMO-2",
    customerId: "CUST-DEMO-2",
    date: "2026-08-11",
    dueDate: "2026-09-25",
    lines: [{ itemId: "ITEM-DEMO-2", qty: "90", unitPrice: "95" }],
  },
  {
    id: "INV-DEMO-3",
    customerId: "CUST-DEMO-3",
    date: "2026-08-18",
    dueDate: "2026-09-02",
    lines: [
      { itemId: "ITEM-DEMO-4", qty: "12", unitPrice: "260" },
      { itemId: "ITEM-DEMO-1", qty: "15", unitPrice: "180" },
    ],
  },
];

const VAT_PERCENT = 14;

function itemNameOf(itemId: string): string {
  const item = ITEMS.find((i) => i.id === itemId);
  if (!item) throw new Error(`[demo-seed] unknown item ${itemId}`);
  return item.nameAr;
}

/** True once this profile has run, so a restart against a durable file is a no-op. */
async function alreadySeeded(app: App): Promise<boolean> {
  const probe = CUSTOMERS[0];
  if (!probe) return true;
  const res = await call(app, "GET", `/customers/${probe.id}`);
  return res.ok;
}

export async function seedDemoTenant(app: App): Promise<void> {
  if (await alreadySeeded(app)) return;

  for (const customer of CUSTOMERS) {
    await step(app, "POST", "/customers", { ...customer, currency: "EGP", active: true });
  }
  for (const supplier of SUPPLIERS) {
    await step(app, "POST", "/suppliers", { ...supplier, currency: "EGP", active: true });
  }
  for (const item of ITEMS) {
    await step(app, "POST", "/items", {
      ...item,
      type: "stock",
      baseUnitCode: "PCS",
      taxRatePercent: VAT_PERCENT,
      trackInventory: true,
      revenueAccountId: ACCOUNTS.revenue,
      cogsAccountId: ACCOUNTS.cogs,
      inventoryAccountId: ACCOUNTS.inventory,
    });
  }
  for (const costCenter of COST_CENTERS) {
    await step(app, "POST", "/cost-centers", { ...costCenter, branchId: BRANCH_ID });
  }
  for (const account of TREASURY_ACCOUNTS) {
    await step(app, "POST", "/treasury-accounts", { ...account, currency: "EGP", branchId: BRANCH_ID });
  }

  for (const invoice of PURCHASE_INVOICES) {
    await step(app, "POST", "/purchases/invoices", {
      id: invoice.id,
      supplierId: invoice.supplierId,
      date: invoice.date,
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      currency: "EGP",
      lines: invoice.lines.map((line) => ({ ...line, kind: "inventory", taxRatePercent: VAT_PERCENT })),
    });
    await step(app, "POST", `/purchases/invoices/${invoice.id}/confirm`, {});
  }

  for (const invoice of SALES_INVOICES) {
    await step(app, "POST", "/sales-invoices", {
      id: invoice.id,
      date: invoice.date,
      dueDate: invoice.dueDate,
      customerId: invoice.customerId,
      customerNameAr: CUSTOMERS.find((c) => c.id === invoice.customerId)?.nameAr ?? invoice.customerId,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: ACCOUNTS.receivable,
      taxAccountId: ACCOUNTS.outputVat,
      lines: invoice.lines.map((line, index) => ({
        lineId: `${invoice.id}-L${index + 1}`,
        itemId: line.itemId,
        itemNameAr: itemNameOf(line.itemId),
        isStock: true,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxRatePercent: VAT_PERCENT,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      })),
    });
    await step(app, "POST", `/sales-invoices/${invoice.id}/confirm`, {});
  }
}
