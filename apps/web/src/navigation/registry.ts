import type { NavGroup, NavItem } from "@mezan/ui";

/**
 * The sidebar nav registry — config, not data. Every routable key here must
 * exist in `App.tsx`'s `ROUTABLE_SCREENS` (or be one of `users`/`roles`) to
 * actually navigate; everything else keeps its static "قريباً" tag.
 */

export const topNavItem: NavItem = { key: "dashboard", label: "لوحة التحكم" };

export const navGroups: NavGroup[] = [
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
      { key: "specifications", label: "المواصفات" },
      { key: "product-templates", label: "منتجات بخيارات" },
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
      { key: "settings-sequences", label: "تسلسلات الترقيم" },
      { key: "settings-profile", label: "الملف الشخصي" },
      { key: "settings-api-keys", label: "مفاتيح API" },
      { key: "settings-webhooks", label: "الويب هوك" },
      { key: "audit", label: "سجل المراجعة" },
      { key: "users", label: "المستخدمون" },
      { key: "roles", label: "الأدوار والصلاحيات" },
    ],
  },
];
