# Parity task list

The ordered work list derived from `gap-inventory.md`. Every item traces to a gap id
there. Tick an item only when it has been driven in the running app on seeded data,
in **both locales** (ar/RTL and en/LTR) and **both themes**.

Legend: `[ ]` open · `[~]` in progress · `[x]` done and verified live

---

## Phase P0 — defects (block everything else)

- [ ] **D43** Remove the four "(المرحلة الثانية)" placeholders and wire the real data:
  - [ ] item detail → المخزون حسب المستودع, reading the same source as `/reports/inventory/stock-levels`
  - [ ] item detail → cost, from the WAC layers
  - [ ] chart-of-accounts detail → account movements, from the GL
  - [ ] treasury account detail → account movements, from the voucher postings
  - [ ] delete the two tests that assert the placeholder is present
- [ ] **D44** Give `accounting/cost-centers` its own columns (الكود / الاسم / النوع / مرتبط بـ / المركز الرئيسي / الحالة)
- [ ] **D45** Seed `configurable-products`, `custom-manufacturing`, `installment-follow-ups`; add all three to `pnpm check:seed`'s surface list so an empty list fails the gate

## Phase P1 — shell (A1, H12)

- [ ] Extend `NavGroup` with an optional third level (`sections?: NavSection[]`) in `packages/ui/src/shell/types.ts` and render it in the sidebar
- [ ] Regroup `nav-config.tsx` to the reference tree:
  - [ ] التقارير → المبيعات / المشتريات / المخزون / التصنيع / الأعمار / الأقساط
  - [ ] المخزون → المنتجات / الحركات
  - [ ] التصنيع → الإنتاج / التعريفات
  - [ ] الإعدادات → عام / المستخدمون والصلاحيات / الفروع والمستودعات / سير العمل / الطباعة والترقيم / التكاملات
  - [ ] المحاسبة → التعريفات / الدورة / التقارير
  - [ ] الموارد البشرية → الموظفون / الحضور والإجازات / الرواتب
- [ ] Header: system-status indicator, support entry point, notification badge

## Phase P2 — reports engine (A2–A7, A10)

- [ ] `ReportDefinition` gains `kpis`, `charts`, and richer `paramFields`; server handlers return the aggregates
- [ ] `ReportRunner` renders a KPI strip, a chart row, and quick period chips
- [ ] Replace the hardcoded `TODAY` with the real current date
- [ ] Add % contribution to by-item / by-customer / top-products / by-supplier / by-salesperson
- [ ] Add the GL-reconciliation tile to sales-by-item and purchases-by-item
- [ ] Add a drill-down side panel from entity cells
- [ ] Roll the above across all 22 reports, then the 7 financial statements
- [ ] Keep CSV/Excel export everywhere (already ahead of the reference — do not drop)

## Phase P3 — document detail (F, H11)

- [ ] Sales invoice: add الأقساط and المرفقات tabs; add تحصيل, مرتجع جديد, إنشاء خطة أقساط, إرسال ETA actions; add المجموع الفرعي and الضريبة to the totals block
- [ ] Purchase invoice: add التكاليف الإضافية and المرفقات tabs; add المستهلك / المستلم to the line grid
- [ ] Attachments (H11) as a shared capability on invoices, orders, quotes, returns, items, customers, suppliers, employees
- [ ] Quick-preview side panel over the list, with "فتح في صفحة كاملة"
- [ ] Extend "تأثيرات هذا المستند" to the reference's three-card form, including the "لا تحصيل تلقائي" card

## Phase P4 — entity 360 (H2, H3, H4, H5, H6, H7, H8)

- [ ] Customer: كشف حساب tab (التاريخ/المرجع/النوع/مدين/دائن/الرصيد الجاري), الأقساط, المرتجعات, المرفقات, سجل المراجعة
- [ ] Customer action bar: إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد
- [ ] Supplier: كشف حساب المورد + the purchase equivalents of the above
- [ ] Item detail: المخزون حسب المستودع (with محجوز), طبقات التكلفة, قوائم الأسعار, المواصفات, المرفقات, السجل
- [ ] Item header actions: تعديل المخزون / نقل إلى مستودع آخر / طلب شراء / عرض سجل الحركات
- [ ] Row overflow menus (عرض / تعديل / تعطيل / حذف) on every list
- [ ] Inline contextual actions: تحديد الرصيد الافتتاحي on a zero-stock item, إضافة رصيد افتتاحي on a treasury account
- [ ] **Loyalty points** (H2) — decide in or out for v1; if in, it is a sub-ledger, not a counter

## Phase P5 — missing features (H1, H9, H10, H13, H14, G)

- [ ] **Voucher types 4 → 11** (H1), each picked from a card grid with its explanatory sentence: رد مبلغ لعميل، دفعة مقدمة من عميل مقاولات، استرداد من مورد، إيراد آخر، ضخ رأس مال من الشريك، سحب شخصي للشريك، دفع لمصلحة الضرائب
- [ ] **Item type taxonomy 2 → 6** (H9): منتج / خدمة / مادة خام / منتج نهائي / مستهلك / وصفة
- [ ] **Purchase-invoice line types** مخزني / مصروف / شحن (H13)
- [ ] **Stock-adjustment reason wizard** (G): رصيد افتتاحي / تصحيح جرد / تلف / سرقة / انتهاء صلاحية / نقص أو فقدان / مرتجع للمورد / أخرى
- [ ] **Work-order shop-floor actions** (H14): صرف إضافي، إرجاع مواد، تسجيل فاقد، تسجيل تكلفة، استلام المنتج; materials grid with المتاح and النقص
- [ ] **Coupon codes** on the sales invoice (H10)
- [ ] Item form: صورة الصنف, الوصف, المورد الافتراضي, الموسم, القنوات والظهور, per-price-list prices, المواصفات
- [ ] Customer form: الشعار, رقم التسجيل التجاري, إعفاء ضريبي, نوع العميل, جهة الاتصال, phone country
- [ ] Transfer form: استيراد من إكسل; المخزون المتاح in the line grid
- [ ] Confirm returns must start from a source document (both sales and purchase)

## Phase P6 — list-surface parity (B, C, D, D2)

One task per row of the round-1 per-screen tables. Start with the money-bearing ones:

- [ ] فواتير المشتريات — payment-status chips and money KPIs
- [ ] الأصناف — stock column, type chips, categories, export
- [ ] أرصدة المخزون — warehouse/status filters, reorder-level column
- [ ] مرتجعات المبيعات — the missing filter bar
- [ ] الفاتورة الإلكترونية — the four config tabs
- [ ] الإعدادات العامة — the five missing policy tabs
- [ ] دليل الحسابات — توجيه الحسابات tab
- [ ] الموافقات — طلباتي / إجراءاتي tabs
- [ ] طلبات الإجازات — the create button
- [ ] لوحة الموارد البشرية — charts and the absence/lateness KPIs
- [ ] خط المبيعات — board view
- [ ] …then the remaining rows of B/C/D/D2 in order

## Explicitly out of scope for v1

POS (9 screens + 2 reports), `/settings/shifts`, a standalone label-templates screen,
statutory payroll computation. All four stay descoped; payroll must remain visibly
flagged rather than silently computing a wrong net.

## Do not copy from the reference

C1–C13 in `gap-inventory.md`. In particular: keep report export, keep the hubs linked,
keep the daily attendance list, and do not reproduce the 0.00 treasury balance bug.
