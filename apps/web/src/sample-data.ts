import type { CommandItem, NavGroup, NavItem } from "@mezan/ui";
import { createEntitlements, type Entitlements } from "@mezan/domain";

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
    key: "workflow",
    label: "سير العمل",
    items: [{ key: "approvals", label: "الموافقات" }],
  },
  {
    key: "sales",
    label: "المبيعات",
    items: [
      { key: "customers", label: "العملاء" },
      { key: "quotes", label: "عروض الأسعار" },
      { key: "sales-invoices", label: "فواتير المبيعات", tag: { label: "نمط", tone: "pattern" } },
      { key: "sales-returns", label: "مرتجعات المبيعات" },
      { key: "price-lists", label: "قوائم الأسعار" },
      { key: "promotions", label: "العروض" },
    ],
  },
  {
    key: "purchases",
    label: "المشتريات",
    items: [
      { key: "vendors", label: "الموردون" },
      { key: "rfqs", label: "طلبات عروض الأسعار" },
      { key: "purchase-orders", label: "أوامر الشراء" },
      { key: "goods-receipts", label: "استلام البضائع" },
      { key: "purchase-invoices", label: "فواتير المشتريات" },
      { key: "purchase-returns", label: "مرتجعات المشتريات" },
      { key: "landed-costs", label: "التكاليف الإضافية" },
    ],
  },
  {
    key: "inventory",
    label: "المخزون",
    items: [
      { key: "items", label: "الأصناف" },
      { key: "stock-balance", label: "أرصدة المخزون" },
      { key: "stock-transfers", label: "تحويلات المخزون" },
      { key: "stock-adjustments", label: "تسويات المخزون" },
      { key: "physical-counts", label: "الجرد الفعلي" },
      { key: "configurable-products", label: "منتجات قابلة للتهيئة" },
    ],
  },
  {
    key: "manufacturing",
    label: "التصنيع",
    items: [
      { key: "work-orders", label: "أوامر التصنيع" },
      { key: "boms", label: "قوائم المواد" },
      { key: "custom-manufacturing", label: "التصنيع المخصص" },
    ],
  },
  {
    key: "accounting",
    label: "المحاسبة",
    items: [
      { key: "coa", label: "دليل الحسابات" },
      { key: "cost-centers", label: "مراكز التكلفة" },
      { key: "cost-center-pl", label: "أرباح مراكز التكلفة" },
      { key: "journals", label: "القيود المحاسبية" },
      { key: "fiscal-periods", label: "الفترات المالية" },
      { key: "taxes", label: "الضرائب" },
      { key: "exchange-rates", label: "أسعار الصرف" },
      { key: "revaluation", label: "إعادة تقييم العملات الأجنبية" },
      { key: "reconciliation", label: "مطابقة الأرصدة" },
      { key: "eta", label: "الفاتورة الإلكترونية" },
      { key: "trial-balance-report", label: "ميزان المراجعة", tag: { label: "نمط", tone: "pattern" } },
      { key: "financial-reports", label: "التقارير المالية", tag: { label: "نمط", tone: "pattern" } },
    ],
  },
  {
    key: "treasury",
    label: "الخزينة",
    items: [
      { key: "treasury-accounts", label: "حسابات الخزينة" },
      { key: "treasury-vouchers", label: "السندات النقدية" },
      { key: "bank-reconciliation", label: "تسوية كشوف البنك" },
    ],
  },
  {
    key: "financial-papers",
    label: "الأوراق المالية",
    items: [{ key: "cheques", label: "سجل الشيكات" }],
  },
  {
    key: "crm",
    label: "إدارة علاقات العملاء",
    items: [
      { key: "leads", label: "العملاء المحتملون" },
      { key: "opportunities", label: "الفرص" },
      { key: "pipeline", label: "خط المبيعات" },
      { key: "pipeline-stages", label: "مراحل خط المبيعات" },
      { key: "crm-activities", label: "الأنشطة" },
    ],
  },
  {
    key: "hr",
    label: "الموارد البشرية",
    items: [
      { key: "hr-dashboard", label: "لوحة الموارد البشرية" },
      { key: "employees", label: "الموظفون" },
      { key: "departments", label: "الأقسام" },
      { key: "job-titles", label: "المسميات الوظيفية" },
      { key: "contracts", label: "العقود" },
      { key: "holidays", label: "الإجازات الرسمية" },
      { key: "my-leave", label: "إجازاتي" },
    ],
  },
  {
    key: "projects",
    label: "المشاريع",
    items: [{ key: "projects", label: "المشاريع والمقاولات" }],
  },
  {
    key: "assets",
    label: "الأصول الثابتة",
    items: [
      { key: "asset-register", label: "سجل الأصول" },
      { key: "depreciation-runs", label: "الإهلاك" },
      { key: "asset-categories", label: "تصنيفات الأصول" },
    ],
  },
  {
    key: "field",
    label: "المبيعات الميدانية",
    items: [{ key: "van-trips", label: "رحلات المندوبين" }],
  },
  {
    key: "installments",
    label: "الأقساط",
    items: [
      { key: "installment-plans", label: "خطط الأقساط" },
      { key: "installment-follow-ups", label: "متابعة التحصيل" },
    ],
  },
  {
    key: "reports",
    label: "التقارير",
    items: [
      { key: "report-sales-by-period", label: "المبيعات حسب الفترة" },
      { key: "report-sales-by-item", label: "المبيعات حسب الصنف" },
      { key: "report-sales-by-customer", label: "المبيعات حسب العميل" },
      { key: "report-sales-top-products", label: "أفضل المنتجات" },
      { key: "report-purchases-by-period", label: "المشتريات حسب الفترة" },
      { key: "report-purchases-by-supplier", label: "المشتريات حسب المورد" },
      { key: "report-purchases-by-item", label: "المشتريات حسب الصنف" },
      { key: "report-inventory-stock-levels", label: "مستويات المخزون" },
      { key: "report-inventory-movement", label: "حركة المخزون" },
      { key: "report-inventory-ledger", label: "سجل المخزون" },
      { key: "report-inventory-valuation", label: "تقييم المخزون" },
      { key: "report-inventory-aging", label: "أعمار المخزون" },
      { key: "report-inventory-slow-moving", label: "أصناف بطيئة الحركة" },
      { key: "report-inventory-drift", label: "انحراف تقييم المخزون" },
      { key: "report-aging-customers", label: "أعمار ديون العملاء" },
      { key: "report-aging-suppliers", label: "أعمار ديون الموردين" },
      { key: "report-installments-overview", label: "نظرة عامة على الأقساط" },
      { key: "report-installments-overdue", label: "الأقساط المتأخرة" },
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
      { key: "settings-workflow", label: "إعدادات الموافقات" },
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

// Roles/users moved to the real /roles and /users API (see App.tsx's
// useRoles/useUsers) — this tenant's data now lives in the seeded backend.
