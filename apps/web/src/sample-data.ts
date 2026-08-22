import type { CommandItem, NavGroup, NavItem } from "@mezan/ui";
import { createEntitlements, type Entitlements, type Role, type User } from "@mezan/domain";

/** Demo tenant: "Cyag" (شركة سياج), current user محمد الشهابي — matches the approved mockup's sample data. */
export const demoUser = {
  name: "محمد الشهابي",
  role: "Company Admin",
  initials: "م.ش",
};

export const demoCompanyName = "Cyag";

export const topNavItem: NavItem = { key: "dashboard", label: "لوحة التحكم" };

export const navGroups: NavGroup[] = [
  {
    key: "sales",
    label: "المبيعات",
    items: [
      { key: "customers", label: "العملاء" },
      { key: "quotes", label: "عروض الأسعار", tag: { label: "قريباً", tone: "soon" } },
      { key: "sales-invoices", label: "فواتير المبيعات", tag: { label: "نمط", tone: "pattern" } },
      { key: "sales-returns", label: "مرتجعات المبيعات", tag: { label: "قريباً", tone: "soon" } },
    ],
  },
  {
    key: "purchases",
    label: "المشتريات",
    items: [
      { key: "vendors", label: "الموردون" },
      { key: "purchase-orders", label: "أوامر الشراء", tag: { label: "قريباً", tone: "soon" } },
      { key: "purchase-invoices", label: "فواتير المشتريات", tag: { label: "قريباً", tone: "soon" } },
    ],
  },
  {
    key: "inventory",
    label: "المخزون",
    items: [
      { key: "items", label: "الأصناف" },
      { key: "stock-balance", label: "أرصدة المخزون", tag: { label: "قريباً", tone: "soon" } },
      { key: "stock-transfers", label: "تحويلات المخزون", tag: { label: "قريباً", tone: "soon" } },
      { key: "stock-adjustments", label: "تسويات المخزون", tag: { label: "قريباً", tone: "soon" } },
      { key: "physical-counts", label: "الجرد الفعلي", tag: { label: "قريباً", tone: "soon" } },
    ],
  },
  {
    key: "accounting",
    label: "المحاسبة",
    items: [
      { key: "coa", label: "دليل الحسابات" },
      { key: "cost-centers", label: "مراكز التكلفة" },
      { key: "journals", label: "القيود المحاسبية" },
      { key: "fiscal-periods", label: "الفترات المالية" },
      { key: "taxes", label: "الضرائب" },
      { key: "trial-balance-report", label: "ميزان المراجعة", tag: { label: "نمط", tone: "pattern" } },
    ],
  },
  {
    key: "treasury",
    label: "الخزينة",
    items: [
      { key: "treasury-accounts", label: "حسابات الخزينة" },
      { key: "treasury-vouchers", label: "السندات النقدية" },
    ],
  },
  {
    key: "settings",
    label: "الإعدادات",
    defaultCollapsed: true,
    items: [
      { key: "settings-general", label: "عام" },
      { key: "settings-branches", label: "الفروع" },
      { key: "settings-warehouses", label: "المستودعات" },
      { key: "settings-print", label: "قوالب الطباعة" },
      { key: "users", label: "المستخدمون" },
      { key: "roles", label: "الأدوار والصلاحيات" },
    ],
  },
];

export const commandItems: CommandItem[] = [
  { id: "cmd-invoice", label: "فاتورة مبيعات جديدة", group: "إجراءات سريعة", hint: "N" },
  { id: "cmd-receipt", label: "سند نقدي جديد", group: "إجراءات سريعة" },
  { id: "cmd-coa", label: "دليل الحسابات", group: "الانتقال إلى" },
  { id: "cmd-journals", label: "القيود المحاسبية", group: "الانتقال إلى" },
].map((item) => ({ ...item, onSelect: () => {} }));

export interface DemoInvoice {
  id: string;
  number: string;
  date: string;
  customer: string;
  dueDate: string;
  status: "draft" | "confirmed" | "partial" | "paid" | "cancelled";
  total: number;
  remaining: number;
}

export const demoInvoices: DemoInvoice[] = [
  { id: "1", number: "INV-000123", date: "2026-08-10", customer: "شركة الأمل للتجارة", dueDate: "2026-09-10", status: "confirmed", total: 1150.0, remaining: 450.0 },
  { id: "2", number: "INV-000122", date: "2026-08-09", customer: "مؤسسة النور للمقاولات", dueDate: "2026-09-09", status: "paid", total: 3420.5, remaining: 0 },
  { id: "3", number: "INV-000121", date: "2026-08-08", customer: "شركة سياج للصناعات", dueDate: "2026-09-08", status: "paid", total: 890.0, remaining: 0 },
  { id: "4", number: "INV-000120", date: "2026-08-05", customer: "مجموعة الفجر التجارية", dueDate: "2026-08-20", status: "partial", total: 2100.0, remaining: 700.0 },
  { id: "5", number: "INV-000119", date: "2026-07-28", customer: "شركة الأمل للتجارة", dueDate: "2026-08-12", status: "cancelled", total: 560.0, remaining: 0 },
  { id: "6", number: "INV-000118", date: "2026-07-22", customer: "مصنع الوادي الأخضر", dueDate: "2026-07-30", status: "confirmed", total: 939.3, remaining: 939.3 },
  { id: "7", number: "INV-000117", date: "2026-07-15", customer: "مؤسسة النور للمقاولات", dueDate: "2026-08-14", status: "draft", total: 1275.0, remaining: 1275.0 },
];

/* ------------------------------------------------------------------ */
/* Users & Roles — docs/catalog/09-settings-dashboard-ux.md §المستخدمون  */
/* ------------------------------------------------------------------ */

/** Cyag's single branch + its two warehouses (one of them a van/vehicle stock location). */
export const demoBranches = [{ id: "MAIN", name: "الفرع الرئيسي" }];

export const demoWarehouses = [
  { id: "MAIN-WH", name: "مستودع الفرع الرئيسي", branchId: "MAIN" },
  { id: "VAN-1", name: "سياره نقل", branchId: "MAIN" },
];

/** A driver login can link to its HR employee record (docs/catalog/09 §الموظف المرتبط). */
export const demoEmployees = [{ id: "emp-1", name: "كريم عزت", position: "مندوب مبيعات ميداني" }];

/** Matches the tenant module list observed in the recon (docs/catalog/09 §1). */
export const demoActiveModules = [
  "sales",
  "purchases",
  "inventory",
  "accounting",
  "treasury",
  "installments",
  "financial_papers",
  "crm",
  "pos",
  "hr",
  "manufacturing",
  "assets",
  "notifications",
  "loyalty",
  "field",
];

export const demoEntitlements: Entitlements = createEntitlements({
  plan: "ENTERPRISE",
  activeModules: demoActiveModules,
  features: {},
  seats: 10,
  expiresAt: null,
});

const VAN_SALES_ROLE_ID = "role-van-sales";

/** The one custom role in this tenant — 4 permissions across 2 modules, exactly as recon'd. */
export const demoRoles: Role[] = [
  {
    id: VAN_SALES_ROLE_ID,
    code: "VAN_SALES",
    name: "مندوب مبيعات",
    description: "دور السائق/المندوب الميداني — تحميل السيارة وتسجيل فواتير المبيعات أثناء الجولة.",
    permissions: [
      "sales.invoice.view_own",
      "sales.invoice.create",
      "field.van_trip.view_own",
      "field.van_trip.open",
    ],
    isSystem: false,
    createdAt: "2026-08-08T09:00:00.000Z",
  },
];

/** `demo:<password>` — the web demo's placeholder hasher (see `local-store.ts`); never real auth. */
function demoHash(secret: string) {
  return `demo:${secret}`;
}

export const demoUsers: User[] = [
  {
    id: "user-1",
    fullName: "محمد الشهابي",
    email: "mohamed@cyag.test",
    phone: "+201001234567",
    passwordHash: demoHash("Passw0rd!"),
    pinHash: demoHash("1234"),
    roleId: null,
    isCompanyAdmin: true,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    lastLoginAt: "2026-08-21T08:12:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
  },
  {
    id: "user-2",
    fullName: "سارة عبد الله",
    email: "sara@cyag.test",
    phone: "+201009876543",
    passwordHash: demoHash("Passw0rd!"),
    pinHash: null,
    roleId: null,
    isCompanyAdmin: true,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    lastLoginAt: "2026-08-20T14:40:00.000Z",
    createdAt: "2026-06-02T09:00:00.000Z",
  },
  {
    id: "user-3",
    fullName: "يوسف محمد",
    email: "youssef@cyag.test",
    phone: "+201005556677",
    passwordHash: demoHash("Passw0rd!"),
    pinHash: null,
    roleId: null,
    isCompanyAdmin: true,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    lastLoginAt: null,
    createdAt: "2026-07-11T09:00:00.000Z",
  },
  {
    id: "user-4",
    fullName: "أحمد الجندي",
    email: "ahmed@cyag.test",
    phone: null,
    passwordHash: demoHash("Passw0rd!"),
    pinHash: null,
    roleId: null,
    isCompanyAdmin: true,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "inactive",
    lastLoginAt: "2026-07-30T11:05:00.000Z",
    createdAt: "2026-06-15T09:00:00.000Z",
  },
  {
    id: "user-5",
    fullName: "كريم عزت",
    email: "kareem@cyag.test",
    phone: "+201002223344",
    passwordHash: demoHash("Van12345"),
    pinHash: demoHash("4321"),
    roleId: VAN_SALES_ROLE_ID,
    isCompanyAdmin: false,
    employeeId: "emp-1",
    branchScope: ["MAIN"],
    warehouseScope: ["MAIN-WH", "VAN-1"],
    status: "active",
    lastLoginAt: "2026-08-21T06:30:00.000Z",
    createdAt: "2026-08-08T09:15:00.000Z",
  },
];
