/**
 * لوحة التحكم (Dashboard) demo data — mirrors the Cyag tenant snapshot
 * documented in docs/catalog/09-settings-dashboard-ux.md §Dashboard and the
 * approved mockup (design/mezan-ui-mockups.html, `data-view="dashboard"`).
 * No live API wiring yet (see ChartOfAccountsScreen — every Phase-1 screen is
 * sample-data-driven); the shapes below match the documented
 * `GET /api/dashboard/*` responses so wiring a real fetch later is a
 * drop-in swap.
 */

export const dashboardGreetingName = "محمد";
export const dashboardDateLabel = "الجمعة، ٢١ أغسطس ٢٠٢٦";

export const quickActions = [
  "فاتورة جديدة",
  "سند نقدي",
  "استلام بضاعة",
  "فاتورة مشتريات جديدة",
  "أمر شراء جديد",
  "عرض سعر",
] as const;

export interface KpiTile {
  key: string;
  label: string;
  value: number;
  sub: string;
  subTone: "up" | "down" | "neutral";
  valueTone: "default" | "danger";
}

/** First KPI row — `GET /api/dashboard/stats`. */
export const kpiTiles: KpiTile[] = [
  {
    key: "revenue",
    label: "إجمالي الإيرادات · هذا الشهر",
    value: 86240.0,
    sub: "12.4% مقارنة بالشهر الماضي",
    subTone: "up",
    valueTone: "default",
  },
  {
    key: "expenses",
    label: "المصروفات التشغيلية",
    value: 61930.0,
    sub: "4.1% مقارنة بالشهر الماضي",
    subTone: "down",
    valueTone: "default",
  },
  {
    key: "net-profit",
    label: "صافي الربح",
    value: -18087.5,
    sub: "هامش الربح -643.3%",
    subTone: "down",
    valueTone: "danger",
  },
  {
    key: "cash",
    label: "السيولة النقدية",
    value: 338.0,
    sub: "صناديق وبنوك نشطة",
    subTone: "neutral",
    valueTone: "default",
  },
];

/** Company-wide KPI row below the "يحتاج متابعة" panel — always company-scope, not branch-filtered. */
export const companyKpiTiles: { key: string; label: string; value: number }[] = [
  { key: "ar", label: "مبالغ لدى العملاء", value: 2782.3 },
  { key: "ap", label: "مستحقات الموردين", value: 110.0 },
  { key: "inventory-value", label: "قيمة المخزون", value: 604950.9 },
];

export interface FollowUpItem {
  key: string;
  title: string;
  sub: string;
  actionLabel: string;
  actionVariant: "primary" | "default";
}

/** يحتاج متابعة — `GET /api/dashboard/attention`. */
export const followUpItems: FollowUpItem[] = [
  { key: "overdue-invoices", title: "فاتورتان متأخرتان", sub: "939.30 ج.م", actionLabel: "تحصيل الآن", actionVariant: "primary" },
  { key: "tax-due", title: "ضريبة مستحقة للسداد", sub: "308.70 ج.م", actionLabel: "سداد للمصلحة", actionVariant: "default" },
  { key: "low-stock", title: "٣ أصناف تحت حد الطلب", sub: "مخزون منخفض", actionLabel: "مراجعة", actionVariant: "default" },
];

/** أداء الفترة — trailing-12-month revenue/expenses/net-profit, `GET /api/dashboard/revenue-trend?months=N`. */
const trendMonths = [
  "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير",
  "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس",
] as const;
const trendRevenue = [48500, 50200, 52800, 55100, 57400, 58200, 62800, 68100, 71900, 75600, 79400, 86240.0];
const trendExpenses = [42100, 43300, 44900, 46200, 47800, 51000, 52300, 54800, 55950, 57100, 58300, 61930.0];
const trendNetProfit = [6400, 6900, 7900, 8900, 9600, 7200, 10500, 13300, 15950, 18500, 21100, -18087.5];

export const revenueTrendRangeOptions = [
  { value: "3", label: "3 أشهر" },
  { value: "6", label: "6 أشهر" },
  { value: "12", label: "12 شهر" },
] as const;

export function revenueTrendForRange(months: number) {
  return {
    categories: trendMonths.slice(-months),
    revenue: trendRevenue.slice(-months),
    expenses: trendExpenses.slice(-months),
    netProfit: trendNetProfit.slice(-months),
  };
}

export interface AgingRow {
  key: string;
  entity: string;
  buckets: [number, number, number, number];
}

export const agingBucketLabels = ["1-30 يوم", "31-60 يوم", "61-90 يوم", "+90 يوم"] as const;

/** المبالغ المتأخرة — `GET /api/dashboard/invoice-aging` + `GET /api/dashboard/ap-aging`. */
export const agingRows: AgingRow[] = [
  { key: "customers", entity: "العملاء", buckets: [612.3, 227.0, 100.0, 0.0] },
  { key: "suppliers", entity: "الموردون", buckets: [110.0, 0.0, 0.0, 0.0] },
];

export interface ActivityEntry {
  key: string;
  text: string;
  when: string;
}

/** النشاط الأخير — `GET /api/dashboard/activity?limit=8`. */
export const recentActivity: ActivityEntry[] = [
  { key: "wo-0010", text: "اكتمل أمر التصنيع WO-0010 — الكمية المنتجة: 2", when: "قبل 17 دقيقة" },
  { key: "wire-cu-on", text: "تفعيل منتج قابل للتهيئة WIRE-CU", when: "قبل 3 ساعات" },
  { key: "collect-amal", text: "تحصيل دفعة من عميل — شركة الأمل للتجارة", when: "أمس" },
  { key: "wire-cu-off", text: "إيقاف منتج قابل للتهيئة WIRE-CU", when: "قبل يومين" },
  { key: "po-new", text: "أمر شراء جديد PO-0041 — مصنع الوادي الأخضر", when: "قبل 3 أيام" },
];

export const expenseBreakdownRangeOptions = [
  { value: "month", label: "هذا الشهر" },
  { value: "3", label: "آخر 3 أشهر" },
  { value: "6", label: "آخر 6 أشهر" },
  { value: "12", label: "آخر 12 شهرا" },
] as const;

/** توزيع المصروفات — `GET /api/dashboard/expense-breakdown?dateFrom=&dateTo=`. */
export const expenseBreakdown = {
  centerLabel: "21.4 ألف",
  centerSub: "الإجمالي (ج.م)",
  segments: [
    { key: "cogs", label: "تكلفة البضاعة المباعة", value: 20330, color: "var(--chart-1)" },
    { key: "waste", label: "هالك التصنيع", value: 1070, color: "var(--chart-3)" },
    { key: "shrinkage", label: "خسارة المخزون / النقص", value: 0, color: "var(--chart-2)" },
    { key: "external", label: "خدمات خارجية ومقاولات", value: 0, color: "var(--chart-4)" },
  ],
};

export interface TopItemRow {
  key: string;
  name: string;
  qty: number;
  revenueIncTax: number;
}

/** الأصناف الأعلى مبيعاً — `GET /api/dashboard/top-products`. */
export const topItems: TopItemRow[] = [
  { key: "wire-2.5", name: "سلك نحاس 2.5مم", qty: 420, revenueIncTax: 18900.0 },
  { key: "breaker-32a", name: "قاطع كهرباء 32A", qty: 310, revenueIncTax: 14260.0 },
  { key: "panel-12", name: "لوحة توزيع 12 خط", qty: 96, revenueIncTax: 9880.0 },
  { key: "breaker-auto", name: "مفتاح دائرة أوتوماتيكي", qty: 74, revenueIncTax: 6150.0 },
  { key: "cable-1.5", name: "كابل مرن 1.5مم", qty: 260, revenueIncTax: 5420.0 },
];

export interface TopCustomerRow {
  key: string;
  name: string;
  invoiceCount: number;
  revenueIncTax: number;
}

/** أعلى العملاء مبيعاً — `GET /api/dashboard/top-customers`; includes the synthetic POS cash-customer row. */
export const topCustomers: TopCustomerRow[] = [
  { key: "amal", name: "شركة الأمل للتجارة", invoiceCount: 12, revenueIncTax: 24850.0 },
  { key: "noor", name: "مؤسسة النور للمقاولات", invoiceCount: 9, revenueIncTax: 18420.0 },
  { key: "pos-cash", name: "عميل نقدي (نقطة بيع)", invoiceCount: 34, revenueIncTax: 15760.0 },
  { key: "cyag", name: "شركة سياج للصناعات", invoiceCount: 6, revenueIncTax: 9340.0 },
  { key: "fajr", name: "مجموعة الفجر التجارية", invoiceCount: 5, revenueIncTax: 7120.0 },
];

export const rankListDateRangeOptions = [
  { value: "month", label: "هذا الشهر" },
  { value: "3", label: "3 أشهر" },
  { value: "6", label: "6 أشهر" },
  { value: "12", label: "12 أشهر" },
] as const;

/**
 * Maps a range-chip value ("month"/"3"/"6"/"12") to a month count. The demo
 * data below only has one month's worth of rows, so wider ranges scale the
 * "هذا الشهر" figures up proportionally — a stand-in for the real
 * `?dateFrom=&dateTo=`-filtered aggregation the documented endpoints do.
 */
function monthsForRange(range: string): number {
  return range === "month" ? 1 : Number(range) || 1;
}

/** الأصناف الأعلى مبيعاً, scoped to a range chip's value — same source as `topItems`. */
export function topItemsForRange(range: string): TopItemRow[] {
  const scale = monthsForRange(range);
  return topItems.map((row) => ({
    ...row,
    qty: Math.round(row.qty * scale),
    revenueIncTax: Math.round(row.revenueIncTax * scale * 100) / 100,
  }));
}

/** أعلى العملاء مبيعاً, scoped to a range chip's value — same source as `topCustomers`. */
export function topCustomersForRange(range: string): TopCustomerRow[] {
  const scale = monthsForRange(range);
  return topCustomers.map((row) => ({
    ...row,
    invoiceCount: Math.round(row.invoiceCount * scale),
    revenueIncTax: Math.round(row.revenueIncTax * scale * 100) / 100,
  }));
}

/** توزيع المصروفات, scoped to a range chip's value — same source as `expenseBreakdown`. */
export function expenseBreakdownForRange(range: string): typeof expenseBreakdown {
  const scale = monthsForRange(range);
  const segments = expenseBreakdown.segments.map((segment) => ({ ...segment, value: Math.round(segment.value * scale) }));
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return { centerLabel: `${(total / 1000).toFixed(1)} ألف`, centerSub: expenseBreakdown.centerSub, segments };
}

/** 14% — matches settings/sample-data.ts's sampleSettings.defaultTaxRate for the excl.-tax toggle. */
export const DEFAULT_TAX_RATE = 14;

export const dashboardFooterDisclaimer =
  "جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة";
