# Gap inventory — Mezan vs the reference product

Captured 2026-08-26 by sweeping **101 reference routes** and **116 Mezan routes**
live in the browser and diffing each screen's h1, tabs, KPI tiles, filter controls,
action buttons, table columns, chart count and row count. Round 2 (below) then opened
every create form, entity detail panel, tab and row menu on the reference.

Nothing here is inferred from `docs/catalog/`; every line was read from a running DOM.

Status key: **M** = missing in Mezan · **W** = reference is wrong/weak, do not copy ·
**E** = Mezan is already ahead · **S** = seeding gap (screen renders empty here)

---

# Round 1 — list surfaces

## A. Structural gaps (affect every screen)

| # | Gap | Evidence |
|---|---|---|
| A1 | **Sidebar has only two levels.** `NavGroup { items: NavItem[] }` (`packages/ui/src/shell/types.ts:18`) cannot express sub-groups, so التقارير is a flat list of 22, الإعدادات 15, الموارد البشرية 14, المحاسبة 13 — 141 entries dumped flat. | Reference nests three levels: التقارير → المبيعات/المشتريات/المخزون/التصنيع/الأعمار/الأقساط; المخزون → المنتجات; التصنيع → الإنتاج; الإعدادات → عام/المستخدمون/الفروع/سير العمل/الطباعة |
| A2 | **Reports have no KPI strip and no charts.** All 22 operational reports are one component (`apps/web/src/screens/reports/ReportScreen.tsx`) = param bar + flat table + grand total. `ReportRunner`'s single `chart` slot is used by exactly one screen (`FinancialReportsScreen.tsx:116`). | Reference: Sales by Period 5 KPIs + 4 charts; Stock Levels 4 KPIs + 5 charts; Customer/Supplier Aging 8 charts each; Stock Ledger 6; Stock Movement 10; Purchases by Period 14 |
| A3 | **No quick period chips on any report** (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة). | |
| A4 | **Reports default to a hardcoded date** — `TODAY = "2026-08-22"` in `SalesReportsScreens.tsx:11` and siblings. | |
| A5 | **No drill-down side panel** from a customer/supplier/item/account/warehouse cell. | |
| A6 | **No % contribution column** on by-item, by-customer, top-products, by-supplier, by-salesperson. | |
| A7 | **No GL reconciliation tile on reports** (reference's Sales-by-Item ties its total to the GL revenue account). | |
| A8 | **No branch/warehouse filter on most document lists.** | |
| A9 | **No unified "تصفية النتائج" panel with an active-filter count.** | |
| A10 | Reference has **no export on any of its 22 operational reports**; Mezan exports CSV/Excel everywhere. | E |

## B. Per-screen gaps — Sales

| Screen | Missing in Mezan |
|---|---|
| العملاء | "تصنيفات العملاء" manager; KPI "عملاء عليهم رصيد" |
| فواتير المبيعات | KPI "المقبوضات غير المخصصة"; branch + warehouse filters |
| عروض الأسعار | branch filter |
| مرتجعات المبيعات | **no filters at all** — no search, branch, customer or date |
| قوائم الأسعار | inline item grid with "إضافة صنف" on the list page (Mezan uses a separate editor — E) |
| رحلات المندوبين | "الطاقم" (Crew) column |

## C. Per-screen gaps — Purchases

| Screen | Missing in Mezan |
|---|---|
| فواتير المشتريات | **the whole payment-status dimension**: chips متأخرة / تستحق قريباً / مدفوع جزئياً / مدفوع; KPIs المدفوع للموردين، إجمالي المرتجعات، المدفوعات غير المخصصة، رصيد الفواتير غير المدفوعة (Mezan's KPIs are document counts, not money) |
| مرتجعات المشتريات | KPIs قيمة المرتجعات، مسودة; "استيراد مرتجعات سابقة" |
| إيصالات الاستلام | chip "غير مفوترة" |
| أوامر الشراء | date-range filter |
| طلبات عروض الأسعار | date-range filter; branch/warehouse filters |
| التكاليف الإضافية | chips قيد التسوية / ملغي; KPI إجمالي التكلفة المؤكدة |

## D. Per-screen gaps — Inventory

| Screen | Missing in Mezan |
|---|---|
| الأصناف | **"المخزون" column**; chips نفد المخزون / مخزون منخفض / مادة خام / منتج نهائي; KPI نفد المخزون; "تصنيفات الأصناف"; "تصدير"; toggles إخفاء المتغيرات / إظهار الأصناف المولّدة تلقائياً |
| أرصدة المخزون | warehouse filter; status filter; quantity range; chips الكل/منخفض/نفد; "حد إعادة الطلب" column |
| تحويلات المخزون | warehouse filter; date filter; quantity range |
| تسويات المخزون | warehouse filter; date filter; chip ملغي; "إجمالي القيمة" column |
| الجرد الفعلي | warehouse filter; date filter |
| قوالب المنتجات | "عدد المتغيرات" column |
| المنتجات القابلة للتهيئة | "عدد الأوامر" column — **and empty in Mezan (S)** |
| طباعة الملصقات | branch selector; **Document label mode**; 2 of the 3 label sizes |

## D2. Manufacturing · Accounting · Treasury · CRM · HR · Assets · Settings

| Screen | Missing in Mezan |
|---|---|
| أوامر التصنيع | branch/warehouse filters; date range; chip متأخر; columns الكمية المخططة، بواسطة |
| لوحة الإنتاج | the four workflow buckets (بدء الإنتاج / بانتظار صرف الخامات / بانتظار استلام المنتج / جاهز للإقفال) |
| التصنيع المخصص | **empty in Mezan (S)** |
| دليل الحسابات | **"توجيه الحسابات" tab** (default GL mapping per document type) |
| مراكز التكلفة | **renders CoA column headers — defect P2**; "إنشاء من الأقسام" |
| القيود المحاسبية | date-range filter; "الوحدة المصدر" column; "طباعة القيود" |
| الضرائب | "مجموعات الضرائب" |
| أسعار الصرف | search; date filter |
| الفاتورة الإلكترونية | **4 of 5 tabs**: الإعدادات العامة، بيانات الاعتماد، ربط الأصناف، ربط الوحدات |
| القوائم المالية | KPI إجمالي المدين/الدائن; per-statement charts |
| السندات النقدية | branch filter; date filter; chips بانتظار الاعتماد، ملغي |
| سجل الشيكات | branch filter; date-range filter |
| حسابات الخزينة | balance-range filter |
| تسوية كشوف البنك | date filter; "المزيد" overflow menu |
| العملاء المحتملون | **no KPI tiles at all**; الرقم، تاريخ الإنشاء، بواسطة columns; date filter |
| الفرص | "#" column; branch filter; date filter |
| خط المبيعات | **Board (kanban) view**; KPI الفرص الراكدة; branch + customer filters |
| لوحة الموارد البشرية | **4 charts**; KPIs معدل الغياب، التأخيرات; leave columns المستحق / المستخدم / % |
| الموظفون | "الفرع" and "العقد" columns |
| العقود | KPI + chip "قرب الانتهاء" |
| طلبات الإجازات | **create button is absent**; search; branch filter |
| الرواتب | branch filter |
| سجل الأصول | status chips; KPIs تحت الصيانة، مستبعد; "تصنيفات الأصول" |
| خطط الأقساط | columns المبلغ الإجمالي، المدفوع; KPIs المحصل، المتبقي; search; branch/date filters; chips متأخر/مكتمل/ملغي |
| متابعة التحصيل | search; branch filter; date filter — **and empty in Mezan (S)** |
| الإعدادات العامة | **6 of 10 tabs**: البريد الإلكتروني، ضبط الائتمان، سياسة المخزون، ضبط المشتريات، سياسة الخزينة (+2 POS, descoped) |
| الفروع | "قائمة أسعار الفرع" column |
| الموافقات | **the 3 tabs**: صندوق الوارد / طلباتي / إجراءاتي |

## C-ref. Where the reference is wrong or weak — do not copy

| # | Finding |
|---|---|
| C1 | No export on any of the 22 operational reports. |
| C2 | Eight `/{module}/hub` pages built and unreachable — the sidebar's domain entries are pure toggles. |
| C3 | 692 of 710 items read "نفد المخزون" on its own demo data; the KPI is noise. |
| C4 | Cost centres, promotions, leads, projects, POs, cheques, installments all show 0 rows. |
| C5 | `/settings/webhooks` is the only screen whose title stays untranslated English. |
| C6 | Attendance is a 31-column month grid that overflows and cannot show check-in/out times. |
| C7 | Zero charts on every list screen except HR. |
| C8 | "Sales by Salesperson" is POS-only, so it is permanently empty. |

## D-skip. Not needed now

| Item | Reason |
|---|---|
| 9 POS screens + 2 POS reports | descoped from v1 by `docs/plan.md` |
| `/settings/shifts` | POS/HR adjacent, follows POS |
| separate label-templates screen | folded into `inventory/labels` |
| statutory payroll rules | HR descoped; must stay visibly flagged |

---

# Round 2 — deep pass (forms, detail panels, tabs, modals, row menus)

Second sweep, same day. Where round 1 compared list surfaces, this round opened
every create form, entity detail panel and row menu on the reference, walked each
tab, and read the field list, line-grid columns, totals block and action set.

## E. Defects found in Mezan during this pass

| # | Defect | Evidence |
|---|---|---|
| **P1** | **Four shipped "(المرحلة الثانية)" placeholders on surfaces whose data already exists.** The item detail's المخزون tab renders *"ستُعرض أرصدة المخزون حسب المستودع هنا فور ربط حركات المخزون بدفتر المخزون (المرحلة الثانية)"* — while `/reports/inventory/stock-levels` reads exactly that data today. | `apps/web/src/i18n/catalog.ts:2220` `items.thisBecomesDerivedFromStock`, `:2224` `items.stockBalancesByWarehouseWill`, `:3829` `coa.accountMovementWillAppearHere`, `:3887` `treasuryAcc.accountMovementWillAppearHere` — plus two tests that assert the placeholder is present (`ItemsScreen.test.tsx:104`, `ChartOfAccountsScreen.test.tsx:76`) |
| **P2** | `accounting/cost-centers` renders Chart-of-Accounts column headers (اسم الحساب/النوع/الطبيعة/الحالة) instead of cost-centre columns. | live DOM |
| **P3** | Three list surfaces are empty on seeded data: `inventory/configurable-products`, `manufacturing/custom-manufacturing`, `installments/installment-follow-ups`. The reference has 7 / 7 / 1. | live DOM |

## F. Document detail — tab-by-tab

### Sales invoice
Reference opens a **quick-preview side panel over the list**, with a "فتح في صفحة كاملة" link to the full page. Mezan goes straight to a full page.

| | Reference | Mezan |
|---|---|---|
| Tabs | بنود / المدفوعات / المرتجعات / **الأقساط** / القيود المحاسبية / الفاتورة الإلكترونية / **المرفقات** / سجل المراجعة (8) | بنود / القيود المحاسبية / المدفوعات / المرتجعات / الفاتورة الإلكترونية / السجل (6) |
| Header actions | تحصيل, فتح في صفحة كاملة | رجوع only |
| Tab actions | مرتجع جديد (from المرتجعات), إنشاء خطة أقساط (from الأقساط), إرسال (from ETA), إضافة مرفق | none |
| "تأثيرات هذه الفاتورة" | 3 explainer cards with icons — stock decrement, AR increase, **"لا تحصيل تلقائي"** with the instruction to use تحصيل | 2 plain bullets |
| Line grid | الاسم/الكمية/سعر الوحدة/خصم %/ضريبة %/التكلفة/الربح/الإجمالي | same ✅ |
| Totals | المجموع الفرعي (شامل الخصومات)/الضريبة/الإجمالي الكلي/إجمالي التكلفة/إجمالي الربح/هامش الربح | الإجمالي الكلي/إجمالي التكلفة/إجمالي الربح/هامش الربح/خصم المرتجعات المؤكدة/الصافي بعد المرتجعات — **missing المجموع الفرعي and الضريبة**, but adds two lines the reference lacks (E) |

**Missing in Mezan:** الأقساط tab, المرفقات tab, تحصيل action, مرتجع جديد / إنشاء خطة أقساط / إرسال ETA actions from the tabs, the quick-preview panel, المجموع الفرعي + الضريبة total lines.

### Purchase invoice (reference)
7 tabs: البنود / المدفوعات / المرتجعات / **التكاليف الإضافية** / القيود المحاسبية / المرفقات / سجل المراجعة.
Line grid carries **المستهلك / المستلم** (consumed vs received) alongside الكمية.

### Work order (reference)
7 tabs: المواد / التكاليف / استخدام المواد / حركة المواد / الاستلامات / القيود المحاسبية / السجل.
Header actions: **استلام المنتج / تسجيل تكلفة / صرف إضافي / إرجاع مواد / تسجيل فاقد**.
Materials grid: الصنف/الكمية المطلوبة/**المتاحة**/الصادرة/المرجعة/الصافي/**النقص**.

### Item (reference)
Full page, 6 tabs: **المخزون حسب المستودع** (المستودع/متاح/**محجوز**/الإجمالي) / المواصفات / **التكلفة** (cost layers: المستودع/الكمية المتبقية/تكلفة الوحدة/المصدر/التاريخ) / **قوائم الأسعار** (قائمة الأسعار/وحدة/الحد الأدنى للكمية/السعر الأساسي/السعر المخصص/الفرق عن الأساسي) / المرفقات / السجل.
Header actions: تعديل / المزيد / **تعديل المخزون / نقل إلى مستودع آخر / طلب شراء / عرض سجل الحركات**.
Mezan: 5 tabs (عام/الوحدات والباركود/التسعير/الحسابات/المخزون), the المخزون tab is the P1 placeholder, and the only header action is تعديل.

### Customer 360 (reference)
Header actions: **إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد / كشف حساب / المزيد**.
7 tabs: الفواتير / **كشف حساب** (التاريخ/المرجع/النوع/مدين/دائن/الرصيد الجاري) / الأقساط / المرتجعات / **نقاط الولاء** (رصيد النقاط، إجمالي المكتسب، إجمالي المستبدل، تعديل النقاط يدوياً) / المرفقات / سجل المراجعة.

### Supplier 360 (reference)
Header actions: إنشاء فاتورة مشتريات / صرف دفعة / إنشاء أمر شراء / عرض كشف الحساب / المزيد.
6 tabs: فواتير المشتريات / كشف حساب المورد / مرتجعات المشتريات / أوامر الشراء / المرفقات / سجل المراجعة.

### Employee (reference)
8 tabs: المعلومات الشخصية / العقد / الإجازات / كشوف الرواتب / سلف الموظفين / الحضور / المرفقات / السجل.
Header actions: إعادة توظيف / المزيد.

## G. Create forms — reference field sets

| Form | Sections | Notable fields Mezan lacks |
|---|---|---|
| فاتورة مبيعات | **طريقة الإنشاء** / بيانات الفاتورة / بنود الفاتورة / خصم على الفاتورة / المرفقات | a creation-method step (from scratch vs from quote/order), **كود الكوبون + تطبيق الكوبون**, ملاحظات داخلية, المرفقات, per-invoice discount as نسبة مئوية \| مبلغ ثابت, 11-currency selector |
| فاتورة مشتريات | طريقة الإنشاء / بيانات الفاتورة / أصناف الفاتورة / خصم على الفاتورة / ملخص / المرفقات | **line type مخزني \| مصروف \| شحن**, رقم فاتورة المورد, المرفقات |
| أمر شراء | بيانات / بنود / ملخص الطلب / المرفقات | المرفقات |
| مرتجع مبيعات | **فاتورة المصدر** — the return *starts* from a source invoice; free-standing returns are impossible | verify Mezan enforces the same |
| مرتجع مشتريات | معلومات الفاتورة الأصلية — same shape | " |
| تحويل مخزون | معلومات التحويل / بنود | **استيراد من إكسل**, and the line grid shows **المخزون المتاح** next to كمية التحويل |
| تسوية مخزون | a **reason-first wizard**: رصيد افتتاحي / تصحيح جرد / تلف / سرقة / انتهاء صلاحية / نقص أو فقدان / مرتجع للمورد / أخرى — each with its own helper text | Mezan opens a plain form with no reason taxonomy |
| صنف جديد | 10 sections: نوع الصنف / الهوية والتصنيف / التسعير والتكلفة / **القنوات والظهور** / المخزون / الحسابات / تصنيف ETA / وحدات القياس / **أسعار في قوائم الأسعار** / **المواصفات** | Mezan has 5 tabs; missing صورة الصنف, الوصف, المورد الافتراضي, الموسم, القنوات والظهور, per-price-list prices, specifications |
| عميل جديد | modal + **خيارات متقدمة** disclosure | **الشعار (logo)**, country selector on phone, **رقم التسجيل التجاري**, **إعفاء ضريبي** checkbox, **نوع العميل** (تلقائي/منشأة/فرد), جهة الاتصال |
| مستند تكلفة إضافية | المعلومات الأساسية / الفواتير المرتبطة / بنود التكلفة | cost lines are typed (شحن…) with a per-line نوع التكلفة |
| سند نقدي | **11 voucher types**, each a card with an explanatory sentence | see H1 below |

## H. Feature-level gaps discovered in round 2

| # | Gap |
|---|---|
| **H1** | **Voucher types: reference has 11, Mezan surfaces 4.** Reference: تحصيل من عميل، دفع لمورد، رد مبلغ لعميل، **دفعة مقدمة من عميل مقاولات**، استرداد من مورد، إيراد آخر، مصروف آخر، **ضخ رأس مال من الشريك**، **سحب شخصي للشريك**، **دفع لمصلحة الضرائب**، تحويل بين الخزائن. Each is picked from a card grid with a one-line explanation of what it does. |
| **H2** | **Loyalty points** (نقاط الولاء) — a whole sub-ledger on the customer: earned, redeemed, balance, manual adjustment, sourced per invoice. Absent from Mezan. |
| **H3** | **Customer / supplier statement of account** (كشف حساب: التاريخ/المرجع/النوع/مدين/دائن/الرصيد الجاري) as a tab on the entity. Absent from Mezan. |
| **H4** | **Entity 360 action bars** — create invoice / collect payment / new quote straight from the customer, and the purchase equivalents from the supplier. Mezan's entity screens have no cross-document actions. |
| **H5** | **Reserved stock** (محجوز) is tracked per warehouse on the item. Mezan has متاح and إجمالي only. |
| **H6** | **Cost layers are visible on the item** (الكمية المتبقية / تكلفة الوحدة / المصدر / التاريخ). Mezan computes them but shows them nowhere. |
| **H7** | **Per-price-list price overrides on the item**, with الفرق عن الأساسي. Mezan edits price lists only from the price-list side. |
| **H8** | **Row overflow menus** (عرض / تعديل / تعطيل / حذف) on every list row, plus contextual inline actions such as **تحديد الرصيد الافتتاحي** on a zero-stock item and **إضافة رصيد افتتاحي** on a treasury account. |
| **H9** | **Item type taxonomy**: منتج / خدمة / مادة خام / منتج نهائي / مستهلك / الوصفة (6). Mezan has منتج مخزون / خدمة (2). |
| **H10** | **Coupon codes** on the sales invoice (كود الكوبون + تطبيق الكوبون). |
| **H11** | **Attachments** on documents and entities — the reference has an المرفقات tab or uploader on invoices, orders, quotes, items, customers, suppliers, employees. Mezan has none. |
| **H12** | **Global header**: نظام الحالة indicator ("جميع الأنظمة تعمل بشكل طبيعي"), **الدعم الفني** entry point, notification badge. |
| **H13** | Purchase-invoice lines can be **expense or freight**, not just stock — the route by which a service cost lands on a purchase invoice. |
| **H14** | **Work-order shop-floor actions**: صرف إضافي، إرجاع مواد، تسجيل فاقد، تسجيل تكلفة، استلام المنتج — with a materials grid showing المتاح and النقص. |

## I. More reference weaknesses found in round 2 — do not copy

| # | Finding |
|---|---|
| C9 | **Treasury account CASH-001 shows a 0.00 balance** with 15 confirmed vouchers posted — the same opening-vs-live balance bug Mezan fixed as D41. |
| C10 | **The asset register has no asset detail page** — rows are not clickable; there is no asset card, no depreciation schedule per asset. |
| C11 | **`/inventory/physical-counts/new` errors out** and renders only a "إعادة المحاولة" retry button. |
| C12 | **No date filter and no search on several report screens** (installments overview/overdue have neither). |
| C13 | The invoice detail's tab set differs per document with no consistent order; المرفقات sits in different positions. |
