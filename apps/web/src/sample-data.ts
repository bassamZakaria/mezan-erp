import type { CommandItem, NavGroup, NavItem } from "@mezan/ui";

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
      { key: "users", label: "المستخدمون", tag: { label: "قريباً", tone: "soon" } },
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
