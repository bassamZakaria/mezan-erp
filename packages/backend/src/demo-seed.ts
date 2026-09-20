import type { App } from "@mezan/api";
import { SUPPORTED_CURRENCY_CODES, type AuditSink } from "@mezan/domain";
import { ADMIN_HEADERS, assertLocalOrTest, setSeedSessionToken, type SeedSessionMinter } from "./demo-seed/shared.js";
import { seedHr } from "./demo-seed/hr.js";
import { seedAccess } from "./demo-seed/access.js";
import { seedAfterHoursActivity } from "./demo-seed/security-activity.js";
import { seedCrm } from "./demo-seed/crm.js";
import { seedInventoryOps } from "./demo-seed/inventory-ops.js";
import { seedPurchasing } from "./demo-seed/purchasing.js";
import { seedTreasury } from "./demo-seed/treasury.js";
import { seedPlatform } from "./demo-seed/platform.js";
import { seedAttachments } from "./demo-seed/attachments.js";
import { seedFragments } from "./demo-seed/fragment-registry.js";
import { seedHistory } from "./demo-seed/history.js";
import { seedContracting, seedContractingProjectInvoice } from "./demo-seed/contracting.js";
import { seedContractingContracts } from "./demo-seed/contracting-contracts.js";
import { seedContractingSite } from "./demo-seed/contracting-site.js";
import { seedContractingGuarantees } from "./demo-seed/contracting-guarantees.js";
import { seedContractingCertificates } from "./demo-seed/contracting-certificates.js";
import { seedContractingSubcontracts } from "./demo-seed/contracting-subcontracts.js";
import { seedContractingRecognition } from "./demo-seed/contracting-recognition.js";
import { seedContractingControls } from "./demo-seed/contracting-controls.js";

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

const BRANCH_ID = "BR-MAIN";
const WAREHOUSE_ID = "WH-MAIN";

/** Standard chart-of-accounts ids from `packages/domain/src/accounts/coa-template.ts`. */
const ACCOUNTS = {
  receivable: "1105",
  inventory: "1200",
  cash: "1300-1",
  bank: "1310",
  bankUsd: "1310-USD",
  inputVat: "1400",
  payable: "2100",
  outputVat: "2200",
  revenue: "4100",
  cogs: "5100",
  capital: "3100",
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
  {
    id: "CUST-DEMO-1",
    code: "C-0001",
    nameAr: "شركة الأمل للتجارة",
    nameEn: "Al Amal Trading",
    phone: "01001234567",
    email: "billing@alamal.example",
    paymentTermsDays: 30,
    creditLimit: "50000",
    taxNumber: "300112233445",
    commercialRegistrationNumber: "CR-114522",
    etaBuyerType: "business" as const,
    contactPerson: "أحمد سيد",
    address: "12 شارع طلعت حرب، وسط البلد، القاهرة",
  },
  {
    id: "CUST-DEMO-2",
    code: "C-0002",
    nameAr: "مؤسسة النور للمقاولات",
    nameEn: "Al Nour Contracting",
    phone: "01112223344",
    paymentTermsDays: 45,
    creditLimit: "120000",
    taxNumber: "300998877665",
    commercialRegistrationNumber: "CR-208814",
    etaBuyerType: "business" as const,
    contactPerson: "هالة منصور",
    address: "7 شارع الهرم، الجيزة",
  },
  {
    id: "CUST-DEMO-3",
    code: "C-0003",
    nameAr: "مجموعة الفجر التجارية",
    nameEn: "Al Fajr Group",
    phone: "01223334455",
    paymentTermsDays: 15,
    creditLimit: "25000",
    // A tax-exempt individual buyer, so the invoice screens have a customer
    // that genuinely zero-rates rather than only the exempt FLAG to look at.
    taxExempt: true,
    etaBuyerType: "individual" as const,
    nationalId: "29001011234567",
    contactPerson: "محمود الفجر",
    address: "34 شارع الجيش، طنطا، الغربية",
  },
];

const SUPPLIERS = [
  { id: "SUPP-DEMO-1", code: "S-0001", nameAr: "مصنع الوادي الأخضر", nameEn: "Green Valley Factory", phone: "01098765432", paymentTermsDays: 30 },
  { id: "SUPP-DEMO-2", code: "S-0002", nameAr: "شركة سياج للصناعات", nameEn: "Siyaj Industries", phone: "01187654321", paymentTermsDays: 60 },
];

const ITEMS = [
  // Sold both loose and by the carton — the tenant that proves per-line units
  // convert into base units in the stock ledger (R2.4).
  {
    id: "ITEM-DEMO-1",
    code: "IT-0001",
    nameAr: "أرز أبيض 5 كجم",
    nameEn: "White Rice 5kg",
    salePrice: "180",
    costPrice: "140",
    alternateUnits: [{ code: "CTN", name: "كرتونة (12 قطعة)", factor: 12 }],
  },
  { id: "ITEM-DEMO-2", code: "IT-0002", nameAr: "زيت عباد الشمس 1 لتر", nameEn: "Sunflower Oil 1L", salePrice: "95", costPrice: "72" },
  { id: "ITEM-DEMO-3", code: "IT-0003", nameAr: "سكر أبيض 1 كجم", nameEn: "White Sugar 1kg", salePrice: "42", costPrice: "31" },
  // Reorder points, so the items list's مخزون منخفض chip has something to
  // filter to — a low-stock state is only derivable where one is set.
  { id: "ITEM-DEMO-4", code: "IT-0004", nameAr: "شاي أسود 500 جم", nameEn: "Black Tea 500g", salePrice: "260", costPrice: "205", reorderPoint: 60, reorderQty: 100 },
  { id: "ITEM-DEMO-5", code: "IT-0005", nameAr: "خليط شاي بالسكر 1 كجم", nameEn: "Sweetened Tea Blend 1kg", salePrice: "150", costPrice: "108.60" },
  { id: "ITEM-DEMO-6", code: "IT-0006", nameAr: "خليط شاي بالنعناع 1 كجم", nameEn: "Mint Tea Blend 1kg", salePrice: "170", costPrice: "124.00", reorderPoint: 50, reorderQty: 80 },
  { id: "ITEM-DEMO-9", code: "IT-0009", nameAr: "علبة شاي هدايا حسب الطلب", nameEn: "Custom Gift Tea Box", salePrice: "0", costPrice: "0" },
];

/**
 * One item per non-product type (R5.1), so each type chip on the items list
 * has something to filter to and the capability rules are visible: the service
 * and the recipe hold no stock, the raw material and the consumable cannot be
 * sold, the finished good cannot be purchased.
 */
const TYPED_ITEMS = [
  { id: "ITEM-DEMO-10", code: "IT-0010", nameAr: "خدمة توصيل الطلبات", nameEn: "Delivery Service", type: "service" as const, salePrice: "75", costPrice: "0" },
  { id: "ITEM-DEMO-11", code: "IT-0011", nameAr: "أوراق شاي خام", nameEn: "Raw Tea Leaves", type: "raw_material" as const, salePrice: "0", costPrice: "180" },
  { id: "ITEM-DEMO-12", code: "IT-0012", nameAr: "عبوة شاي جاهزة للبيع", nameEn: "Packed Tea, Finished", type: "finished_good" as const, salePrice: "190", costPrice: "140" },
  { id: "ITEM-DEMO-13", code: "IT-0013", nameAr: "أكياس تغليف", nameEn: "Packaging Bags", type: "consumable" as const, salePrice: "0", costPrice: "2.50" },
  { id: "ITEM-DEMO-14", code: "IT-0014", nameAr: "وصفة خليط الشاي بالنعناع", nameEn: "Mint Tea Blend Recipe", type: "recipe" as const, salePrice: "0", costPrice: "0" },
];

/**
 * قوائم المواد (BOMs) for the two manufactured items above — demo data for
 * the make-vs-buy report. Both BOMs cost their tea/sugar lines at the SAME
 * purchase history `PURCHASE_INVOICES` below records, so the report's
 * material-cost rollup is checkable by hand against real numbers.
 */
const BOMS = [
  {
    id: "BOM-DEMO-1",
    productItemId: "ITEM-DEMO-5",
    standardQty: "10",
    unit: "PCS",
    laborCost: "50",
    overheadCost: "30",
    lines: [
      { itemId: "ITEM-DEMO-4", qty: "4" },
      { itemId: "ITEM-DEMO-3", qty: "6" },
    ],
  },
  {
    id: "BOM-DEMO-2",
    productItemId: "ITEM-DEMO-6",
    standardQty: "10",
    unit: "PCS",
    laborCost: "40",
    overheadCost: "20",
    lines: [
      { itemId: "ITEM-DEMO-4", qty: "5" },
      { itemId: "ITEM-DEMO-3", qty: "5" },
    ],
  },
];

/** Perishables — the only items that carry batches and expiry dates (FEFO). */
const PERISHABLE_ITEMS = [
  { id: "ITEM-DEMO-7", code: "IT-0007", nameAr: "لبن كامل الدسم 1 لتر", nameEn: "Full-Fat Milk 1L", salePrice: "38", costPrice: "27" },
  { id: "ITEM-DEMO-8", code: "IT-0008", nameAr: "زبادي طبيعي 100 جم", nameEn: "Plain Yoghurt 100g", salePrice: "12", costPrice: "8" },
];

/**
 * Sales reps. A salesperson on an invoice is an HR employee id — the same
 * concept a van trip's crew references — so the reps المبيعات حسب المندوب
 * groups by are real employee records, created through `/hr/employees`.
 */
const SALESPEOPLE = [
  { id: "EMP-DEMO-1", firstName: "Kareem", lastName: "Adel", firstNameAr: "كريم", lastNameAr: "عادل", hireDate: "2024-03-01" },
  { id: "EMP-DEMO-2", firstName: "Salma", lastName: "Fouad", firstNameAr: "سلمى", lastNameAr: "فؤاد", hireDate: "2025-01-15" },
];

/**
 * A live campaign covering the seeded sales window. `requiresCoupon` is false
 * so the engine picks it up on any qualifying invoice — the seeded promoted
 * invoice therefore earns its discount from the real engine, not a literal.
 */
/**
 * The two coupon-gated campaigns exist to exercise R3.12's caps, thresholds
 * and bundles without changing what the seeded invoices take: a promotion
 * that requires a coupon never applies to a document that carries none.
 */
const PROMOTIONS = [
  {
    id: "PROMO-DEMO-1",
    code: "SUMMER10",
    nameAr: "خصم الصيف 10٪",
    nameEn: "Summer 10%",
    type: "percentage" as const,
    percentValue: 10,
    minInvoiceValue: "2000",
    requiresCoupon: false,
    scope: { type: "item" as const, ids: ["ITEM-DEMO-4"] },
    startDate: "2026-08-19",
    endDate: "2026-12-31",
  },
  {
    id: "PROMO-DEMO-2",
    code: "BULK15",
    nameAr: "خصم الجملة 15٪ بسقف 500",
    nameEn: "Bulk 15% capped at 500",
    type: "percentage" as const,
    percentValue: 15,
    minQty: "20",
    maxDiscountAmount: "500",
    priority: 5,
    requiresCoupon: true,
    scope: { type: "item" as const, ids: ["ITEM-DEMO-1"] },
    startDate: "2026-07-01",
    endDate: "2026-12-31",
  },
  {
    id: "PROMO-DEMO-3",
    code: "COMBO",
    nameAr: "حزمة الطابعة والحبر",
    nameEn: "Printer and ink bundle",
    type: "bundle" as const,
    amountValue: "300",
    priority: 3,
    requiresCoupon: true,
    bundleComponents: [
      { itemId: "ITEM-DEMO-1", qty: "1" },
      { itemId: "ITEM-DEMO-2", qty: "2" },
    ],
    scope: { type: "all" as const, ids: [] },
    startDate: "2026-07-01",
    endDate: "2026-12-31",
  },
];

const COST_CENTERS = [
  { id: "CC-DEMO-1", code: "CC-100", nameAr: "المبيعات", nameEn: "Sales" },
  { id: "CC-DEMO-2", code: "CC-200", nameAr: "الإدارة", nameEn: "Administration" },
];

/**
 * The opening bank deposit, dated before the first purchase so every later
 * disbursement draws on funded cash. Sized to cover the seeded payroll and
 * supplier payments with a working balance left over.
 */
const OPENING_BALANCE_DATE = "2026-07-01";
const OPENING_BANK_BALANCE = "250000";

const TREASURY_ACCOUNTS = [
  { id: "TR-DEMO-CASH", code: "CASH-001", name: "الخزينة الرئيسية", nameEn: "Main Cash Drawer", type: "cash", currency: "EGP", bankAccountNumber: null, glAccountId: ACCOUNTS.cash },
  {
    id: "TR-DEMO-BANK",
    code: "BANK-001",
    name: "البنك الأهلي — جاري",
    nameEn: "National Bank — Current",
    type: "bank",
    currency: "EGP",
    bankAccountNumber: "EG380003000100000000263180002",
    glAccountId: ACCOUNTS.bank,
  },
  {
    id: "TR-DEMO-BANK-USD",
    code: "BANK-USD",
    name: "البنك الأهلي — دولار",
    nameEn: "National Bank — USD",
    type: "bank",
    currency: "USD",
    bankAccountNumber: "EG380003000100000000263180777",
    glAccountId: ACCOUNTS.bankUsd,
  },
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
  {
    id: "PI-DEMO-3",
    supplierId: "SUPP-DEMO-1",
    date: "2026-07-28",
    lines: [{ itemId: "ITEM-DEMO-5", qty: "50", unitCost: "130" }],
  },
];

/**
 * The perishable receipts arrive OUT of expiry order on purpose: PI-DEMO-4
 * lands the LATER-expiring milk batch first, PI-DEMO-5 the earlier one. The
 * sale below then proves the issue took the earliest-expiring layer rather
 * than the earliest-received one.
 */
const PERISHABLE_PURCHASE_INVOICES = [
  {
    id: "PI-DEMO-4",
    supplierId: "SUPP-DEMO-1",
    date: "2026-07-28",
    lines: [
      { itemId: "ITEM-DEMO-7", qty: "150", unitCost: "27", batchNo: "MLK-2607", expiryDate: "2026-10-20" },
      { itemId: "ITEM-DEMO-8", qty: "400", unitCost: "8", batchNo: "YOG-2607", expiryDate: "2026-09-30" },
    ],
  },
  {
    id: "PI-DEMO-5",
    supplierId: "SUPP-DEMO-2",
    date: "2026-08-06",
    lines: [
      { itemId: "ITEM-DEMO-7", qty: "100", unitCost: "29", batchNo: "MLK-2708", expiryDate: "2026-09-05" },
      { itemId: "ITEM-DEMO-8", qty: "250", unitCost: "9", batchNo: "YOG-2708", expiryDate: "2026-08-27" },
    ],
  },
];

/**
 * INV-DEMO-2 is deliberately left without a rep so المبيعات حسب المندوب has a
 * real «غير محدد» row to show — an unattributed sale must be visible, not
 * silently dropped. INV-DEMO-4 is priced past SUMMER10's minimum on a scoped
 * item, so the engine grants a discount on it at confirm.
 */
const SALES_INVOICES = [
  {
    id: "INV-DEMO-1",
    customerId: "CUST-DEMO-1",
    salespersonId: "EMP-DEMO-1",
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
    salespersonId: null,
    date: "2026-08-11",
    dueDate: "2026-09-25",
    lines: [{ itemId: "ITEM-DEMO-2", qty: "90", unitPrice: "95" }],
  },
  {
    id: "INV-DEMO-3",
    customerId: "CUST-DEMO-3",
    salespersonId: "EMP-DEMO-2",
    date: "2026-08-18",
    dueDate: "2026-09-02",
    lines: [
      { itemId: "ITEM-DEMO-4", qty: "12", unitPrice: "260" },
      { itemId: "ITEM-DEMO-1", qty: "15", unitPrice: "180" },
    ],
  },
  {
    id: "INV-DEMO-4",
    customerId: "CUST-DEMO-1",
    salespersonId: "EMP-DEMO-1",
    date: "2026-08-20",
    dueDate: "2026-09-19",
    lines: [{ itemId: "ITEM-DEMO-4", qty: "20", unitPrice: "260" }],
  },
  {
    id: "INV-DEMO-5",
    customerId: "CUST-DEMO-1",
    salespersonId: "EMP-DEMO-2",
    date: "2026-08-20",
    dueDate: "2026-09-19",
    lines: [
      { itemId: "ITEM-DEMO-7", qty: "60", unitPrice: "38" },
      { itemId: "ITEM-DEMO-8", qty: "300", unitPrice: "12" },
    ],
  },
];

const VAT_PERCENT = 14;

/** EGS codes registered with the authority for part of the catalogue. */
const ETA_ITEM_CODES = [
  { itemId: "ITEM-DEMO-1", etaItemCode: "EG-100200300-1001", gpcCode: "10000159" },
  { itemId: "ITEM-DEMO-2", etaItemCode: "EG-100200300-1002", gpcCode: "10000165" },
  { itemId: "ITEM-DEMO-3", etaItemCode: "EG-100200300-1003", gpcCode: "10000172" },
  { itemId: "ITEM-DEMO-4", etaItemCode: "EG-100200300-1004", gpcCode: "10000184" },
];

function salespersonNameOf(employeeId: string | null): string | null {
  if (employeeId === null) return null;
  const person = SALESPEOPLE.find((p) => p.id === employeeId);
  if (!person) throw new Error(`[demo-seed] unknown salesperson ${employeeId}`);
  return `${person.firstNameAr} ${person.lastNameAr}`;
}

function itemNameOf(itemId: string): string {
  const item = [...ITEMS, ...PERISHABLE_ITEMS].find((i) => i.id === itemId);
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

export async function seedDemoTenant(
  app: App,
  session: { token: string; mint: SeedSessionMinter; audit: AuditSink },
): Promise<void> {
  assertLocalOrTest();
  // Every module below calls the real routes, and those routes now resolve
  // their caller from the server's session registry rather than from headers.
  setSeedSessionToken(session.token, session.mint);
  if (await alreadySeeded(app)) return;

  // The demo tenant imports in USD and EUR and holds rates for both, so it is a
  // tenant that has switched تعدد العملات on. A brand-new tenant still starts
  // single-currency — that is what the setting is for.
  const baseSettings = (await step(app, "GET", "/settings")) as Record<string, unknown>;
  await step(app, "PUT", "/settings", {
    ...baseSettings,
    // An Egyptian tax invoice must carry the SELLER's tax registration number
    // and commercial register; a demo tenant without them prints a document
    // that would be refused, and the printed page is what a buyer judges.
    taxRegistrationNumber: "203-456-789",
    commercialRegistrationNumber: "112233",
    phone: "0223456789",
    email: "info@cyag.example",
    address: "٣٤ شارع جامعة الدول العربية، المهندسين، الجيزة",
    multiCurrencyEnabled: true,
    // All ten foreign codes the platform supports, so the document currency
    // picker offers the eleven of R1.15 rather than a shorter historical list.
    secondaryCurrencies: SUPPORTED_CURRENCY_CODES.filter((c) => c !== baseSettings.currency),
  });

  for (const customer of CUSTOMERS) {
    await step(app, "POST", "/customers", { ...customer, currency: "EGP", active: true });
  }
  for (const supplier of SUPPLIERS) {
    await step(app, "POST", "/suppliers", { ...supplier, currency: "EGP", active: true });
  }
  // A partner on each side that trades in USD, so the eleven document
  // currencies (R1.15) and the per-currency AR/AP balances (R1.16) can be
  // exercised on real records instead of on a currency nobody deals in.
  await step(app, "POST", "/customers", {
    id: "CUST-DEMO-USD",
    code: "C-0010",
    nameAr: "شركة دلتا للتصدير",
    nameEn: "Delta Export Co.",
    phone: "01555667788",
    paymentTermsDays: 30,
    creditLimit: "200000",
    currency: "USD",
    active: true,
  });
  await step(app, "POST", "/suppliers", {
    id: "SUPP-DEMO-USD",
    code: "S-0010",
    nameAr: "مورد المعدات الدولي",
    nameEn: "International Equipment Supply",
    phone: "01555112233",
    paymentTermsDays: 45,
    currency: "USD",
    active: true,
  });
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
  /**
   * مجموعات الضرائب (R6.4) — a second rate and a compounding group, so the
   * screen has a group whose parts are genuinely owed to different
   * authorities. A group of one would demonstrate nothing.
   */
  await step(app, "POST", "/tax-rates", {
    id: "TABLE5",
    code: "TABLE5",
    name: "ضريبة الجدول",
    rate: 5,
    calculationType: "exclusive",
    isDefault: false,
    etaSubType: "auto",
    status: "active",
  });
  await step(app, "POST", "/tax-groups", {
    id: "TXG-DEMO-1",
    code: "VAT-TABLE",
    nameAr: "قيمة مضافة + ضريبة جدول",
    nameEn: "VAT plus table tax",
    members: [
      { taxRateId: "VAT14", compounding: false },
      // Charged on the base PLUS the VAT above it, which is why the group's
      // effective rate is 19.7%, not 19%.
      { taxRateId: "TABLE5", compounding: true },
    ],
  });

  for (const item of TYPED_ITEMS) {
    const tracksStock = item.type !== "service" && item.type !== "recipe";
    await step(app, "POST", "/items", {
      ...item,
      baseUnitCode: "PCS",
      taxRatePercent: VAT_PERCENT,
      trackInventory: tracksStock,
      revenueAccountId: ACCOUNTS.revenue,
      cogsAccountId: ACCOUNTS.cogs,
      inventoryAccountId: ACCOUNTS.inventory,
    });
  }
  for (const item of PERISHABLE_ITEMS) {
    await step(app, "POST", "/items", {
      ...item,
      type: "stock",
      baseUnitCode: "PCS",
      taxRatePercent: VAT_PERCENT,
      trackInventory: true,
      trackBatches: true,
      trackExpiry: true,
      revenueAccountId: ACCOUNTS.revenue,
      cogsAccountId: ACCOUNTS.cogs,
      inventoryAccountId: ACCOUNTS.inventory,
    });
  }
  for (const person of SALESPEOPLE) {
    await step(app, "POST", "/hr/employees", { ...person, branchId: BRANCH_ID });
  }
  for (const promotion of PROMOTIONS) {
    await step(app, "POST", "/promotions", { ...promotion, active: true });
  }
  for (const costCenter of COST_CENTERS) {
    await step(app, "POST", "/cost-centers", { ...costCenter, branchId: BRANCH_ID });
  }
  await step(app, "POST", "/accounts", {
    id: ACCOUNTS.bankUsd,
    code: ACCOUNTS.bankUsd,
    nameAr: "حساب بنكي بالدولار",
    nameEn: "USD Bank Account",
    type: "asset",
    naturalBalance: "debit",
    parentId: "1300",
    isHeader: false,
  });
  for (const account of TREASURY_ACCOUNTS) {
    await step(app, "POST", "/treasury-accounts", { ...account, branchId: BRANCH_ID });
  }

  // The tenant's opening capital. Without it the bank account was never funded
  // at all: payroll and every supplier payment disbursed from an account with
  // no opening balance, so the dashboard's cash tile read −100,524.88 and the
  // whole demo looked broken (D17).
  await step(app, "POST", "/gl/journal-entries", {
    id: "JE-DEMO-OPENING-CAPITAL",
    date: OPENING_BALANCE_DATE,
    memo: "رأس المال الافتتاحي — إيداع بنكي",
    source: "manual",
    lines: [
      { accountId: ACCOUNTS.bank, debit: OPENING_BANK_BALANCE, credit: "0", memo: "الرصيد الافتتاحي للبنك" },
      { accountId: ACCOUNTS.capital, debit: "0", credit: OPENING_BANK_BALANCE, memo: "رأس المال المدفوع" },
    ],
  });

  /**
   * Two and a half years of ordinary trading, in its own customers, suppliers
   * and items. It runs HERE — after the core master data, before the
   * hand-authored 2026-07 documents — because the ledger must be written in
   * date order: a backdated confirm would issue stock at a weighted-average
   * cost the earlier receipt had not yet set.
   */
  // The branch's registration with the authority, and the POS device bound to
  // it, are seeded BEFORE any sale is confirmed: a consumer sale is reported as
  // an e-receipt, and the authority identifies the issuing till by the serial
  // registered here — a branch with no registered device cannot receipt at all.
  // No POS credentials: with any on file, الإرسال التلقائي would report every
  // seeded receipt to the authority's real gateway, where invented ones fail.
  await step(app, "PUT", `/eta/branch-codes/${BRANCH_ID}`, {
    etaBranchCode: "1",
    deviceSerialNumber: "MEZAN-POS-0001",
  });

  /*
   * The tenant's e-invoicing registration, seeded BEFORE THE FIRST SALE of the
   * whole run — the history's included.
   *
   * It used to sit below, after `seedHistory`, next to the hand-authored 2026
   * invoices it said it preceded. But a consumer sale issues its e-receipt in
   * its own confirm, and the payload carries whatever is registered AT THAT
   * MOMENT, so two and a half years of trading confirmed against an
   * unregistered tenant and every one of those receipts was lost with
   * `ETA_RECEIPT_NOT_READY` on the way out. The registration belongs with the
   * branch code above, for the same reason the branch code is up there.
   *
   * No POS credentials: with any on file, الإرسال التلقائي would report every
   * seeded receipt to the authority's real gateway, where invented ones fail.
   */
  await step(app, "PUT", "/eta/config", {
    environment: "preproduction",
    taxRegistrationNumber: "100200300",
    activityCode: "4610",
    address: {
      governorate: "القاهرة",
      city: "مدينة نصر",
      street: "شارع عباس العقاد",
      buildingNumber: "27",
      postalCode: "11765",
    },
    buyerDataThreshold: 25000,
    documentVersion: "1.0",
    autoSubmitOnConfirm: true,
    signingMethod: "none",
    clientId: "mezan-demo-client",
    clientSecret: "demo-secret-never-returned",
  });
  // Every item in this catalogue sells in PCS, and a line the authority cannot
  // read a unit for cannot be receipted at all — so the base unit is mapped
  // here. الكرتونة stays unmapped on purpose: it is a real alternate unit on
  // the shelf, so ربط الوحدات and تطبيق الاقتراحات still open on a row that
  // needs a decision.
  await step(app, "PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "EA" });
  for (const mapping of ETA_ITEM_CODES) {
    await step(app, "PUT", `/eta/item-mappings/${mapping.itemId}`, {
      etaCodeType: "EGS",
      etaItemCode: mapping.etaItemCode,
      gpcCode: mapping.gpcCode,
    });
  }

  await seedHistory(app);

  for (const invoice of [...PURCHASE_INVOICES, ...PERISHABLE_PURCHASE_INVOICES]) {
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

  for (const bom of BOMS) {
    await step(app, "POST", "/manufacturing/boms", bom);
  }

  await seedConfigurableProduct(app);

  for (const invoice of SALES_INVOICES) {
    await step(app, "POST", "/sales-invoices", {
      id: invoice.id,
      date: invoice.date,
      dueDate: invoice.dueDate,
      customerId: invoice.customerId,
      customerNameAr: CUSTOMERS.find((c) => c.id === invoice.customerId)?.nameAr ?? invoice.customerId,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      salespersonId: invoice.salespersonId,
      salespersonNameAr: salespersonNameOf(invoice.salespersonId),
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

  // Order matters: every module below references the core entities above.
  await seedAccess(app);
  await seedHr(app);
  await seedCrm(app);
  await seedInventoryOps(app);
  await seedPurchasing(app);
  await seedTreasury(app);
  await seedContracting(app);
  await seedContractingContracts(app);
  // After the contract, so the invoice's project HAS one: a direct invoice on a
  // cost_to_cost project bills through 2165 rather than crediting revenue twice.
  await seedContractingProjectInvoice(app);
  await seedContractingSite(app);
  await seedContractingGuarantees(app);
  await seedContractingCertificates(app);
  await seedContractingSubcontracts(app);
  await seedContractingRecognition(app);
  await seedContractingControls(app);
  await seedPlatform(app);
  await seedAttachments(app);
  await seedFragments(app);
  await seedAfterHoursActivity(app, session.audit);
  // LAST. Everything above is dated into 2024–2026 and needs its period open
  // to post; the close is what the accountant would have done at each
  // year-end, and it has to happen after the books are written.
  await closeHistoricPeriods(app);
}

/**
 * إقفال الفترات السابقة — every period before the current year is CLOSED
 * through the real close path.
 *
 * The demo shipped 36 open periods, so a document could be backdated two years
 * into a "closed" year with nothing refusing it, and the period gate — the one
 * control that stops a posted month from being restated — was never exercised
 * by anything the demo contained.
 */
const OPEN_FROM_PERIOD = "2026-01";

async function closeHistoricPeriods(app: App): Promise<void> {
  const periods = (await step(app, "GET", "/fiscal-periods")) as readonly {
    id: string;
    year: number;
    periodNumber: number;
    status: string;
  }[];
  const historic = periods
    .filter((p) => `${p.year}-${String(p.periodNumber).padStart(2, "0")}` < OPEN_FROM_PERIOD)
    .filter((p) => p.status === "open")
    .sort((a, b) => (a.year === b.year ? a.periodNumber - b.periodNumber : a.year - b.year));
  for (const period of historic) {
    await step(app, "POST", `/fiscal-periods/${period.id}/close`, {});
  }
}

/**
 * التصنيع حسب الطلب — a made-to-measure product plus one live order for it.
 * Its materials are the SAME tea and sugar the BOMs above consume, so the
 * formula's material cost resolves against real purchase history rather than
 * an invented unit cost, and the preview figure on screen is checkable.
 */
async function seedConfigurableProduct(app: App): Promise<void> {
  await step(app, "POST", "/manufacturing/configurable-products", {
    id: "CFGP-DEMO-1",
    code: "CFG-0001",
    nameAr: "علبة شاي هدايا حسب الطلب",
    nameEn: "Custom Gift Tea Box",
    outputItemId: "ITEM-DEMO-9",
    unit: "PCS",
    description: "علبة تُجهَّز بوزن الشاي والسكر الذي يطلبه العميل",
    inputs: [
      { id: "teaKg", labelAr: "وزن الشاي (كجم)", labelEn: "Tea weight (kg)", type: "number", min: 1, max: 20 },
      { id: "sugarKg", labelAr: "وزن السكر (كجم)", labelEn: "Sugar weight (kg)", type: "number", min: 0, max: 20 },
    ],
    materials: [
      { itemId: "ITEM-DEMO-4", qtyFormula: "teaKg*2", wastePercent: 2 },
      { itemId: "ITEM-DEMO-3", qtyFormula: "sugarKg", wastePercent: 1 },
    ],
    pricingMethod: "formula",
    priceFormula: "teaKg*320+sugarKg*70",
    laborFormula: "teaKg*12",
    overheadFormula: "teaKg*6",
  });

  await step(app, "POST", "/manufacturing/config-instances", {
    id: "CFGI-DEMO-1",
    configurableProductId: "CFGP-DEMO-1",
    spec: { teaKg: "3", sugarKg: "5" },
    qty: "4",
    customerId: "CUST-DEMO-1",
    notes: "طلب خاص لمعرض رمضان",
    sourceWarehouseId: WAREHOUSE_ID,
    wipWarehouseId: "WH-WIP",
    destinationWarehouseId: WAREHOUSE_ID,
    scheduledStartDate: "2026-08-24",
  });
}
