# Sales Domain — Reference System Catalog

Captured: 2026-08-21 · Login: <redacted> / <redacted> (session was already authenticated on entry)
Tenant seen: "النور للتجارة والتوزيع" (demo company).

## Screen inventory (in scope)

- العملاء — Customers — `/sales/customers` (list, detail, add dialog, categories dialog)
- فواتير المبيعات — Sales Invoices — `/sales/invoices` (list, new form, detail)
- عروض الأسعار — Quotations — `/sales/quotes` (list, new form, detail)
- مرتجعات المبيعات — Sales Returns — `/sales/returns` (list, new form)
- قوائم الأسعار — Price Lists — `/sales/price-lists` (list, new dialog)
- العروض — Promotions / discount rules — `/sales/promotions` (list, new dialog)
- تقرير العروض — Promotions Report — `/sales/promotions/report`
- رحلات المندوبين — Van/Rep Trips — `/field/van-trips` (list, detail) — reachable from the Sales nav dropdown but belongs to a separate "المبيعات الميدانية" (Field Sales) module; documented briefly for completeness.
- إدارة المبيعات — Sales Hub (domain landing page) — `/sales/hub` — **not linked from the sidebar nav**, found by bundle route extraction; added by verification pass.

No standalone "delivery note" or "دليل تسليم" screen exists anywhere under Sales — see Notes.

---

### العملاء (Customers — Customer master)
- **Route**: `/sales/customers` (list), `/sales/customers/{id}` (detail)
- **Purpose**: Central customer master — contact info, credit terms/limit, pricing category, and a rollup of each customer's invoices, statement, installments, returns, loyalty and audit history.
- **List view**:
  - KPI strip: عملاء برصيد مستحق (customers with outstanding balance) + إجمالي مبالغ التحصيل (total to collect), clickable to filter/see summary.
  - Filter chips: الكل / نشط / غير نشط / عملاء برصيد مستحق (counts shown, e.g. 4/4/0/3).
  - Search box (بحث بالاسم أو الكود), "تصفية النتائج" (Filters) panel with: الهاتف, الحد الائتماني (من/إلى), الرصيد المستحق (من/إلى).
  - Columns: (avatar), اسم العميل + code, الهاتف, شروط الدفع (أيام), مديونية العميل, التصنيف والتسعير (category + price list), الحد الائتماني (with "متبقي من الحد" remaining-credit sub-line), row action menu.
  - Pagination: "عرض 1 - N من N", page-size selector (25 default).
  - Row click opens the customer detail page.
- **Detail/form view** ("Add customer" dialog — `إضافة عميل`):
  - Logo upload (الشعار)
  - اسم العميل * (text, required)
  - شروط الدفع (أيام) (number, default 30)
  - العملة (dropdown, default EGP — جنيه مصري)
  - الحد الائتماني (EGP) (number, default 0) — always in base currency regardless of customer currency
  - الكود (text, "تلقائي إذا فارغ" = auto-generated if blank)
  - قائمة الأسعار (search/select, default "بدون قائمة أسعار")
  - التصنيف (dropdown "بدون تصنيف" + inline "تصنيف جديد" quick-add)
  - "خيارات متقدمة" (Advanced options, expandable):
    - الهاتف (phone with country-code selector, defaults Egypt +20)
    - البريد الإلكتروني (email)
    - الرقم الضريبي (tax number, placeholder `300xxxxxxxxx`)
    - نوع المشتري (ETA) (dropdown, default "تلقائي (منشأة إذا وُجد رقم ضريبي، وإلا فرد)")
    - الرقم القومي (national ID, required for e-invoices over the individual-buyer legal threshold)
    - إعفاء ضريبي (checkbox) — tax-exempt toggle (government bodies, non-profits, exports, free zones, diplomatic missions)
    - جهة الاتصال (contact person)
    - ملاحظات (notes)
  - Actions: إلغاء / إضافة عميل (not submitted — read-only pass)
  - Customer detail page header: name + status pill (نشط), code, buttons إنشاء فاتورة / المزيد.
  - Summary cards: التصنيف, قائمة الأسعار, شروط الدفع, الحد الائتماني, إجمالي المبيعات; separate card: مديونية العميل + "متبقي من الحد".
  - Quick actions row: إنشاء فاتورة, تحصيل دفعة, عرض سعر جديد, كشف حساب.
  - Tabs: الفواتير (N), كشف حساب (statement), الأقساط (installments), المرتجعات (returns), نقاط الولاء (loyalty points), المرفقات (attachments), سجل المراجعة (audit log).
  - الفواتير tab table columns: رقم الفاتورة (+ date), تاريخ الاستحقاق, المتبقي (with strikethrough original vs. remaining when partially paid), الحالة, row actions (تحصيل button + menu).
- **Actions**: "المزيد" menu on detail page → تعديل (Edit), نظرة 360° (360° view), تعطيل (Deactivate), دمج مع عميل آخر (Merge with another customer). List page: "تصنيفات العملاء" dialog manages customer categories (empty state: "لا توجد تصنيفات" + "إضافة فئة" — categories organize customers and auto-apply price lists).
- **Workflows/statuses**: نشط / غير نشط (active/inactive) only; no document-style status machine for the customer record itself.
- **API observed**:
  - `GET /api/sales/customers?page=1&limit=25`
  - `GET /api/sales/customers/counts`
  - `GET /api/sales/customers/balance-by-currency`
  - `GET /api/sales/customers/{id}`
  - `GET /api/sales/customers/{id}/balance`
  - `GET /api/sales/customers/{id}/total-sales`
  - `GET /api/sales/customers/{id}/balance-by-currency`
  - `GET /api/treasury/customers/{id}/unallocated` (unallocated cash-voucher payments)
- **Notes**: Credit-limit math and tax logic are prominent (base-currency credit limit, ETA buyer-type auto-detection, tax-exemption flag). Customer categories double as auto price-list assignment — links Customers to قوائم الأسعار.

---

### فواتير المبيعات (Sales Invoices)
- **Route**: `/sales/invoices` (list), `/sales/invoices/new` (create), `/sales/invoices/{id}` (detail; also has a quick-view side panel from list rows)
- **Purpose**: Create and manage confirmed sales invoices — the document that actually deducts stock and books customer receivables.
- **List view**:
  - Header actions: استيراد فواتير سابقة (Import previous invoices), فاتورة جديدة (New invoice).
  - "تحتاج متابعة" banner: N overdue invoices needing follow-up (deep-links to filtered view) + a "مدفوع جزئياً" (partially paid) count chip.
  - KPI strip: إجمالي المبيعات, إجمالي المحصل, إجمالي المرتجع, إجمالي المتبقي, plus "دفعات غير مخصصة" (unallocated payments).
  - Status filter chips with counts: الكل / مفتوح / متأخر / مسودة / مؤكد / مدفوع جزئياً / مدفوع / ملغي.
  - Filters panel: تصفية بالعميل (customer search), من/إلى تاريخ, المستودع, مصدر الفاتورة (dropdown "الكل").
  - Columns: رقم الفاتورة (+ customer name & date), تاريخ الاستحقاق (+ "متأخر N يوم" badge), الرصيد المتبقي (shows original + returned + remaining when applicable), الحالة, بواسطة (created-by, opens side panel), row actions (تحصيل quick button + menu).
  - Row click opens a quick-view side panel ("لوحة جانبية") with a "فتح في صفحة كاملة" (open full page) link.
- **Detail/form view** (New Invoice — `/sales/invoices/new`):
  - "طريقة الإنشاء" (creation method) toggle: إنشاء فاتورة جديدة (manual) vs. إنشاء من عرض سعر (from an accepted quote).
  - بيانات الفاتورة section: العميل * (search + inline "إضافة عميل"), تاريخ الإنشاء * (default today), تاريخ الاستحقاق (auto-computed from customer payment terms, editable), الفرع * / المستودع * (both required, branch defaults to current), العملة (default EGP — base currency).
  - بنود الفاتورة (line items) table: الصنف (item search + "اختيار متغير" variant picker + "إضافة صنف" quick-add), الكمية, سعر الوحدة, الإجمالي (shows tax rate badge e.g. "ضريبة 14%"), row delete. Footer buttons: إضافة بند (add line), إضافة منتج مخصص (add custom/ad-hoc product).
  - خصم على الفاتورة (invoice-level discount): نوع الخصم (نسبة مئوية / amount — dropdown), قيمة الخصم.
  - كود الكوبون (coupon code) with "تطبيق الكوبون" button (disabled until entered); ملاحظات (customer-facing notes); ملاحظات داخلية (internal notes, not printed).
  - Summary sidebar: قائمة الأسعار (defaults "السعر الافتراضي للأصناف"), المجموع الفرعي, الإجمالي الكلي, branch tag; المرفقات (attachments) uploader.
  - Header actions: حفظ كمسودة (Save as draft), تأكيد الفاتورة (Confirm invoice) — status pill shows "التغييرات غير المحفوظة" (unsaved changes) while editing.
- **Detail view** (existing invoice, e.g. INV-000014):
  - Header: invoice number + status pill, مشاركة (Share), تحصيل دفعة (Collect payment), المزيد (More menu).
  - Tax-exempt banner shown when customer is exempt.
  - Summary fields: التاريخ, العميل, تاريخ الاستحقاق (+ "متأخر" flag), المستودع, الفرع; balances: الرصيد المتبقي, إجمالي الفاتورة, إجمالي المرتجع.
  - "تأثيرات هذه الفاتورة" (effects) explainer block: stock deducted on confirm, customer debt increases, no automatic collection (must use تحصيل button to create a payment voucher).
  - Tabs: بنود الفاتورة (N), المدفوعات, المرتجعات (N), الأقساط, القيود المحاسبية, الفاتورة الإلكترونية (ETA), المرفقات, سجل المراجعة.
  - Line-item table columns: الاسم, الكمية, سعر الوحدة, خصم %, ضريبة % ("إعفاء" shown for exempt items), التكلفة, الربح (+ info tooltip: profit computed on pre-tax revenue), الإجمالي. Footer: المجموع الفرعي (شامل الخصومات), الخصم, الإجمالي الكلي (currency), إجمالي التكلفة, إجمالي الربح, هامش الربح %, خصم المرتجعات المؤكدة, الصافي بعد المرتجعات.
- **Actions**: تحصيل (row-level, opens collection flow), مشاركة (share), تحصيل دفعة (collect payment). "المزيد" menu on detail: طباعة (Print), تصدير ملف ETA JSON (Export ETA e-invoice JSON), إنشاء خطة أقساط (Create installment plan), إنشاء مرتجع مبيعات (Create sales return), إلغاء الفاتورة (Cancel invoice).
- **Workflows/statuses**: مسودة (Draft, count 0 seen) → مؤكد (Confirmed) → مدفوع جزئياً (Partially paid) → مدفوع (Paid); متأخر (Overdue) as a derived flag on due date; ملغي (Cancelled, count 0 seen).
- **API observed**:
  - `GET /api/sales/invoices?page=1&limit=25`
  - `GET /api/sales/invoices/counts`, `GET /api/sales/invoices/stats`
  - `GET /api/sales/invoices/{id}`
- **Notes**: Invoice creation can originate from an accepted quote (see Quotes). Stock deduction, customer receivable posting, and lack of auto-collection are explicitly called out in-UI. ETA (Egyptian Tax Authority e-invoice) integration is a first-class tab + export action. Tax-exempt customers skip tax entirely on invoice lines.

---

### عروض الأسعار (Quotations / Sales Quotes)
- **Route**: `/sales/quotes` (list), `/sales/quotes/new` (create), `/sales/quotes/{id}` (detail)
- **Purpose**: Pre-sale quotations sent to customers; convertible into a confirmed sales invoice once accepted.
- **List view**:
  - Header action: عرض سعر جديد (New quote).
  - KPI cards: إجمالي قيمة العروض, قيمة المقبولة, قيمة المحولة (accepted / converted values).
  - Status chips with counts: الكل / مسودة / مرسل / مقبول / مرفوض / منتهي / محول.
  - Filters: تصفية بالعميل, تصفية بالتاريخ (من/إلى).
  - Columns: رقم العرض (+ customer & date), تاريخ الانتهاء (+ "انتهت منذ N يوم" badge), الإجمالي, الحالة, بواسطة, row action (إرسال للموافقة button + menu).
- **Detail/form view** (New Quote):
  - بيانات العرض: العميل *, الفرع * (اختر الفرع), التاريخ *, تاريخ الانتهاء (expiry date), العملة (default EGP).
  - البنود (line items) table: الصنف, الكمية, سعر الوحدة, الإجمالي (tax badge), row delete; إضافة بند / إضافة منتج مخصص.
  - تعديلات التسعير (pricing adjustments): discount type dropdown (نسبة مئوية...).
  - ملاحظات / ملاحظات داخلية (لن تظهر في المطبوعات — internal notes not printed).
  - Summary: قائمة الأسعار (default "السعر الافتراضي للأصناف"), المجموع الفرعي, الضريبة, الإجمالي الكلي. المرفقات uploader.
  - Header actions: إلغاء, حفظ كمسودة. No المستودع field (quotes don't touch stock).
- **Detail view** (existing quote, e.g. QT-000001):
  - Header: quote number + status pill, customer name, تعديل / المزيد.
  - Status explainer banner (e.g. "مسودة — لم ترسل بعد للعميل / قيد التحرير — لم تشارك مع العميل بعد").
  - Summary: العميل, التاريخ, تاريخ الانتهاء (+ "منتهي" flag), الفرع, الإجمالي.
  - Contextual next-step CTA (e.g. "الخطوة التالية: إرسال العرض للعميل" → button "إرسال للعميل").
  - Visual 4-step progress: 1 مسودة → 2 مرسل → 3 مقبول → 4 محول.
  - "ما الذي سيحدث؟" explainer: no stock impact, no customer debt yet, quote not yet sent — effects transfer to the invoice only on conversion.
  - Tabs: تفاصيل العرض, المرفقات, السجل (history/audit).
  - Line-item table: الصنف (with item image + code), الكمية, سعر الوحدة, خصم %, ضريبة %, الإجمالي; footer: المجموع الفرعي, الضريبة, الإجمالي الكلي; ملاحظات section below.
- **Actions**: إرسال للعميل / إرسال للموافقة (send to customer/for approval — row and detail level). "المزيد" menu on detail: طباعة (Print), حذف (Delete).
- **Workflows/statuses**: مسودة → مرسل → مقبول → محول (linear 4-step happy path), with مرفوض (Rejected) and منتهي (Expired) as terminal/side states.
- **API observed**:
  - `GET /api/sales/quotes?page=1&limit=25`
  - `GET /api/sales/quotes/counts`, `GET /api/sales/quotes/stats`
  - `GET /api/sales/quotes?expiringBefore=...&status=SENT&limit=1&page=1` (expiring-soon widget)
- **Notes**: "إنشاء من عرض سعر" on the New Invoice screen is the conversion path (quote → invoice); no separate "convert" button was found on the quote detail itself in this data set (likely appears once quote status = مقبول).

---

### مرتجعات المبيعات (Sales Returns)
- **Route**: `/sales/returns` (list), `/sales/returns/new` (create, requires selecting a source invoice first)
- **Purpose**: Process customer returns against a specific confirmed sales invoice — returns stock to inventory and reduces the customer's receivable; does not auto-refund cash.
- **List view**:
  - Header action: مرتجع جديد (New return).
  - "يتطلب إجراء" (needs action) banner: count + value "بانتظار دفع المبلغ" (awaiting refund payment).
  - KPI cards: عدد المرتجعات, مرتجعات مؤكدة, قيمة المرتجعات المؤكدة.
  - Status chips: الكل / مسودة / مؤكد / بانتظار دفع المبلغ / ملغي.
  - Filters: العميل, من/إلى تاريخ.
  - Columns: رقم المرتجع (+ reason + source invoice link + date), العميل, قيمة المرتجع (original invoice total + returned amount with ↩ icon), الحالة, بواسطة, row menu.
- **Detail/form view** (New Return):
  - Banner: "المرتجع لا يعني استرداد المبلغ تلقائيا" — return restocks items & reduces customer balance; cash refund requires a separate treasury voucher after confirmation.
  - فاتورة المصدر (source invoice): searchable combobox "اختر الفاتورة *" (typeahead against confirmed invoices, shows customer + total + date). Once selected, shows read-only: رقم الفاتورة, العميل, التاريخ, المستودع, الفرع, إجمالي الفاتورة, الحالة.
  - سبب الإرجاع * (return reason, required dropdown): معيب (Defective) / صنف خاطئ (Wrong item) / كمية زائدة (Excess quantity) / تغيير رأي العميل (Customer changed mind) / أخرى (Other).
  - بنود المرتجع (return line items) table, per original invoice line: الصنف, سعر الوحدة, الكمية الأصلية, مرتجع سابق (already returned), المتاح للإرجاع (available to return), كمية الإرجاع (editable spinbutton, 0 = excluded), إجمالي السطر. Helper text: "حدد كمية الإرجاع لكل بند. اتركه صفر لاستثنائه."
  - ملاحظات (notes), المرفقات (attachments).
  - Header actions: حفظ كمسودة (Save as draft).
- **Actions**: Row menu (unopened, but list implies confirm/cancel available given status chips). "إنشاء مرتجع مبيعات" is also reachable from an invoice's "المزيد" menu, pre-filling the source invoice.
- **Workflows/statuses**: مسودة → مؤكد → بانتظار دفع المبلغ (awaiting cash refund) → (implicitly) settled; ملغي (Cancelled) as a side state.
- **API observed**:
  - `GET /api/sales/returns?page=1&limit=25`
  - `GET /api/sales/returns/counts`, `GET /api/sales/returns/stats`
- **Notes**: Tightly coupled to Invoices (must originate from a confirmed invoice) and to Treasury (refund requires a manual صرف/disbursement voucher — return itself never moves cash).

---

### قوائم الأسعار (Price Lists)
- **Route**: `/sales/price-lists`
- **Purpose**: Define custom sell-price lists that can be assigned to customers or customer categories (seen referenced from the Customer add form and detail page, e.g. "قائمة الأسعار الأساسية").
- **List view**: Empty state observed ("لا توجد قوائم أسعار") despite an existing customer showing a "قائمة الأسعار الأساسية" assignment — suggests a system/base list exists outside this list, or this demo tenant's lists were not yet materialized under this endpoint. Header action: قائمة أسعار جديدة.
- **Detail/form view** (New Price List dialog):
  - الاسم * (name), الكود * (code, placeholder `PL-001`), الوصف (description), قائمة أساسية (switch — mark as base/default list).
  - Actions: إلغاء / حفظ.
- **Actions**: Create only observed (no existing rows to inspect edit/detail view or line-level price rules screen).
- **Workflows/statuses**: None observed (no status field on the create form).
- **API observed**: `GET /api/sales/price-lists?limit=200`
- **Notes**: Because the list was empty, the per-item price-override screen (where individual SKU prices would presumably be set for a given list) was not reachable in this pass — flag for a follow-up capture once a price list exists.

---

### العروض (Promotions / discount & pricing rules)
- **Route**: `/sales/promotions` (list), `/sales/promotions/report` (report)
- **Purpose**: Rule-based promotional discounts/bundles applied automatically (or via coupon) to sales invoices and POS sales — percentage discount, fixed-amount discount, special price, buy-X-get-Y, and bundle pricing.
- **List view**:
  - Header actions: تقرير العروض (Promotions report), إضافة عرض (Add promotion).
  - KPI cards: الإجمالي, فعال (active), مجدول (scheduled), قرب الانتهاء (expiring soon).
  - Filter chips: الكل / فعال. Search box.
  - Columns: الرمز (code), النوع (type), النطاق (scope), الفترة (period), الأولوية (priority), row menu. Empty state observed ("لا توجد عروض").
- **Detail/form view** (New Promotion dialog, 2 tabs):
  - **البيانات الأساسية** tab: الرمز * (code, e.g. `SUMMER25`), الأولوية (priority, number), الاسم * / الاسم بالعربية (name EN/AR), النوع * (type dropdown: نسبة خصم / خصم مبلغ / سعر خاص — percentage / fixed amount / special price), قيمة الخصم * (0–100), حد أدنى لقيمة الفاتورة (min invoice value — turns it into a "spend ≥ X" offer, incompatible with special price), اشتر (كمية) / احصل على (كمية) (buy-X-get-Y quantities), تاريخ البداية * / تاريخ الانتهاء * (default start = today), الوصف.
  - **النطاق** tab: مكونات الحزمة (bundle components — "إضافة صنف للحزمة"; adding items turns the reward into a bundle price/discount and makes the scope-below optional), يتطلب كوبون (toggle — requires coupon code entry, else auto-applies), تقييد الأيام والساعات (toggle — restrict to specific days/hours), النطاق * (add scope: item or category — "إضافة نطاق"; empty state "لم يحدد نطاق بعد — أضف صنفاً أو فئة").
  - Actions: إلغاء / إضافة.
- **Actions**: Row menu (not opened, list was empty). Coupon code field also appears directly on the New Invoice / New Quote screens ("كود الكوبون" + "تطبيق الكوبون").
- **Workflows/statuses**: فعال (Active) / مجدول (Scheduled) / قرب الانتهاء (Expiring soon) as derived states from start/end dates; no explicit draft/approval workflow observed.
- **API observed**: `GET /api/sales/promotions?page=1&limit=25&sortDir=DESC`, `GET /api/sales/promotions/counts`
- **Notes**: This is effectively the "discounts / pricing rules" engine referenced in scope — combines coupon-based discounts, automatic promotions, and bundle pricing in one screen, separate from قوائم الأسعار.

### تقرير العروض (Promotions Report)
- **Route**: `/sales/promotions/report`
- **Purpose**: Reports discount granted via promotions across sales invoices and POS sales for a period, net of returns/refunds; excludes drafts and cancelled documents.
- **List view**: KPI cards: عروض مستخدمة (promotions used), عدد مرات الاستخدام (usage count), إجمالي الخصم الممنوح (total discount granted), صافي الخصم (net discount). Period filter chips: هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة + من/إلى تاريخ + الفرع filter. Table columns: الرمز, الاسم, النوع, مرات الاستخدام, الخصم الممنوح, خصم معكوس (مرتجعات) (reversed via returns), صافي الخصم. Empty state observed.
- **API observed**: `GET /api/sales/promotions/report?dateFrom=...&dateTo=...`

---

### رحلات المندوبين (Van/Rep Trips — Field Sales)
- **Route**: `/field/van-trips` (list), `/field/van-trips/{id}` (detail)
- **Purpose**: Manage van-sales/rep trips — loaded stock, in-field sales & collections, cash drawer reconciliation, and trip settlement. Breadcrumb reads "المبيعات الميدانية" (Field Sales), a distinct module surfaced inside the Sales nav dropdown rather than a native Sales screen.
- **List view**: Header action فتح رحلة (Open trip). KPI cards: الإجمالي, جارية (in progress), مسواة (settled), ملغاة (cancelled) with matching filter chips. Search "ابحث برقم الرحلة". Columns: رقم الرحلة (+date), الڤان (van), الفرع, الطاقم (crew), المبيعات (sales count), الحالة, النقدية المحصلة (cash collected), row menu.
- **Detail/form view**: Header action تسوية وإغلاق الرحلة (Settle & close trip). Fields: الحالة, حالة الرحلة (trip sub-status e.g. "لم تبدأ" = not started), الڤان, الفرع, تاريخ الفتح, النقدية الافتتاحية (opening cash, with "بدون تحويل (رحلة قديمة)" note), خزينة الڤان (van cash box, editable), طرق الدفع المتاحة (accepted payment methods, e.g. "نقدي فقط" = cash only, editable), المبيعات / التحصيلات counts, الطاقم (crew member + role e.g. مندوب), المتوقع في الدرج (expected cash in drawer). Tabs: مخزون الڤان (van stock — رصيد سابق / المحمل / المباع / مرتجع / المتبقي / تكلفة الوحدة / القيمة per item), المستندات, المسار (route), سجل المراجعة.
- **Workflows/statuses**: جارية (In progress) → مسواة (Settled); ملغاة (Cancelled) side state. Trip sub-status also tracked (e.g. "لم تبدأ").
- **API observed**: `GET /api/field/van-trips?page=1&limit=25`, `GET /api/field/van-trips/counts`
- **Notes**: Out of the strict Sales-invoicing scope but linked directly from the Sales nav; belongs conceptually to a Field Sales / Van Sales module and should probably be captured fully under a separate pass if one exists.

---

### إدارة المبيعات (Sales Hub / Domain Landing Page) — added by verification pass
- **Route**: `/sales/hub` — exists as a real, fully-rendered route but is **not linked from the sidebar nav** (the "المبيعات" sidebar entry is a pure expand/collapse toggle button, not a link — confirmed via ARIA snapshot: `button "المبيعات"`, no `/url`). Reachable only by direct URL. This same pattern repeats once per domain (`/purchases/hub`, `/inventory/hub`, `/treasury/hub`, `/accounting/hub`, `/assets/hub`, `/crm/hub`, `/pos/hub` — see each domain's own catalog file) and was missed by every original capture pass except a passing mention in `07-mfg-projects-assets.md` (which noted `/assets/hub` existed but was "not independently captured").
- **Purpose**: A domain-level dashboard/launcher — "ابدأ من المنطقة التي تريد العمل عليها" (start from the area you want to work on) — surfacing an attention banner, quick-create shortcuts, a tile grid linking to every Sales sub-screen with live counts, and recent-activity feeds. Functions as an alternate entry point to the same screens already reachable from the sidebar, not a distinct workflow.
- **List view** (tile/dashboard layout, not a data table):
  - Attention banner (conditional): "N فاتورة متأخرة بحاجة للمتابعة" (N overdue invoices need follow-up) with a "عرض الفواتير المتأخرة" deep link.
  - "ابدأ بسرعة" (quick start) button row: فاتورة جديدة, عرض سعر جديد, عميل جديد.
  - "مناطق العمل" (work areas) tile grid, one tile per sub-screen, each showing a live count and a "عرض" (view) link: فواتير المبيعات (N إجمالي / N متأخرة), عروض الأسعار (N عرض), العملاء (N عميل · N نشط), مرتجعات المبيعات (N مرتجع), قوائم الأسعار (N / N قائمة نشطة, "إدارة التسعير" link).
  - "آخر النشاط" (recent activity) panel with two sub-lists: "آخر الفواتير" (recent invoices — customer, invoice #, date, status pill, amount) and "آخر العروض" (recent quotes), each with a "عرض الكل" (view all) link.
- **Detail/form view**: n/a — every tile/row deep-links to the already-documented Customers/Invoices/Quotes/Returns/Price Lists screens above; this page itself has no create/edit form beyond the quick-start shortcut buttons (which open the same dialogs documented under their own screens).
- **Actions**: Quick-create shortcuts (فاتورة جديدة, عرض سعر جديد, عميل جديد); tile "عرض"/"عرض الكل" links (navigation only).
- **Workflows/statuses**: n/a (dashboard, no document lifecycle of its own).
- **API observed**: `GET /api/auth/me`, `GET /api/warehouses`, `GET /api/warehouses/select`, `GET /api/workflow/pending?limit=1`, `GET /api/workflow/my-rejected?limit=1`, `GET /api/status/summary`, `GET /api/notifications*`, `GET /api/branches`, `GET /api/banners/active` (shared app-shell calls) plus domain-specific counts/recent-activity calls for invoices, quotes, customers, returns, price lists (not individually isolated in this pass — pattern consistent with the `/{domain}/counts` + `?limit=5` recent-list calls seen on `/accounting/hub`, documented in `04-accounting-treasury.md`).
- **Notes**: Every module in the app (Sales, Purchases, Inventory, Treasury, Accounting, Assets, CRM, POS) has one of these hub pages at `/{module}/hub`, discovered by extracting route-literal strings from the production JS bundle (`index-iKlw9m3b.js`) and test-navigating each candidate. None are linked from the sidebar; the sidebar's top-level domain buttons only toggle their submenu open/closed. It is plausible these hubs are either (a) leftover from an earlier nav design, (b) intended as the landing target when a user clicks the domain breadcrumb root from a sub-page, or (c) reserved for a future "simplified nav" mode — their existence should be confirmed with the product team before deciding whether Mezan needs to replicate them as first-class screens or can treat them as redundant with the sidebar.

---

## Cross-cutting notes

- **No delivery notes / إشعار تسليم screen** exists anywhere under Sales or the rest of the visible nav. Delivery/fulfillment appears to be implicit in invoice confirmation (stock is deducted directly when an invoice is confirmed) — this may live inside a logistics/dispatch module not present in this tenant, or simply isn't a feature.
- **ETA (Egyptian e-invoicing)** is deeply integrated: invoice detail has a dedicated "الفاتورة الإلكترونية" tab, a "تصدير ملف ETA JSON" export action, buyer-type auto-detection on the customer form, and a company-wide `/accounting/eta` settings screen (outside Sales scope, noted only as a link target).
- **Reports**: A full "تقارير المبيعات" report group exists under the main "التقارير" (Reports) nav — المبيعات حسب الفترة/الصنف/العميل/البائع, أفضل المنتجات, مبيعات الڤان — these were NOT captured in this pass (belong to the Reports module) but are listed here for cross-reference: `/reports/sales/by-period`, `/by-item`, `/by-customer`, `/top-products`, `/by-salesperson`, `/van`.
- **POS (نقاط البيع)** has its own parallel "المبيعات"/"المرتجعات" screens (`/pos/sales`, `/pos/refunds`) — out of scope, POS module owns those.
- **CRM** ("إدارة علاقات العملاء": leads, opportunities, pipeline) is a fully separate nav section and module, not covered here despite overlapping conceptually with "customers".
- **Installments** (`/installments/plans`, `/installments/follow-ups`) is its own top-level module; Sales Invoices link into it ("إنشاء خطة أقساط" action, and an "الأقساط" tab on both invoices and customer detail) but the module itself is out of scope for this pass.
- **Treasury linkage**: invoice/customer "تحصيل" (collect) actions and return refunds both create Treasury cash vouchers (`/treasury/vouchers`) — out of scope but tightly coupled.
- All monetary figures in this tenant are EGP (ج.م); base currency is explicitly EGP everywhere a currency field appears.
- The app is Arabic RTL throughout; no language toggle was exercised (a "اللغة" button exists in the header but was not tested per the read-only-forms rule not applying to it — simply not explored to stay focused).

## Screenshots captured

All saved to `/Users/bassamsalah/My Data/Projects/mezan/recon/catalog/img/`:
- sales-customers-list.png
- sales-customer-add-dialog.png
- sales-customer-detail.png
- sales-customer-categories-dialog.png
- sales-invoices-list.png
- sales-invoice-new-form.png
- sales-invoice-detail-panel.png
- sales-invoice-detail-full.png
- sales-quotes-list.png
- sales-quote-new-form.png
- sales-quote-detail.png
- sales-returns-list.png
- sales-return-new-form.png
- sales-price-lists-empty.png
- sales-price-list-new-dialog.png
- sales-promotions-empty.png
- sales-promotion-new-dialog-scope.png
- sales-promotions-report.png
- sales-van-trips-list.png
- sales-van-trip-detail.png

## Access notes

- Everything listed above was reachable with the logged-in demo admin session (no permission errors encountered).
- Price Lists and Promotions lists were empty in this tenant, so per-record detail/edit screens (e.g. price-list line-item price grid, promotion edit view, return confirm/cancel actions) could not be inspected — only their create dialogs.
- Strictly read-only: no create/edit/delete/confirm/send actions were submitted; only the pre-authenticated session was used (no login form was actually submitted since the session was already active).
