# Purchases Domain — Reference System Catalog

> **Archived 2026-08-29 — a record, not current state.** Read `../../ROADMAP.md` for what is
> built and open, and `../../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `../README.md` in the archive root maps them.


Captured: 2026-08-21. Tenant: "النور للتجارة والتوزيع" (<redacted>).

## Screen inventory (Purchases nav group)

- الموردون (Suppliers) — `/purchases/suppliers`, `/purchases/suppliers/:id`
- تصنيفات الموردين (Supplier Categories) — modal launched from Suppliers list (no dedicated route)
- طلبات عروض الأسعار (RFQs / Purchase Quote Requests) — `/purchases/rfqs`, `/purchases/rfqs/new`
- أوامر الشراء (Purchase Orders) — `/purchases/orders`, `/purchases/orders/new`
- استلام البضائع / إيصالات الاستلام (Goods Receipts) — `/purchases/receipts`, `/purchases/receipts/new`
- فواتير المشتريات (Purchase Invoices) — `/purchases/invoices`, `/purchases/invoices/new`, `/purchases/invoices/:id`, plus "استيراد فواتير سابقة" historical-import modal
- مرتجعات المشتريات (Purchase Returns) — `/purchases/returns`, `/purchases/returns/new`
- التكاليف الإضافية (Landed Costs) — `/purchases/landed-costs`, `/purchases/landed-costs/new`
- إدارة المشتريات (Purchases Hub, domain landing page) — `/purchases/hub` — **not linked from the sidebar nav**; added by verification pass.

No separate "purchase requisitions" screen exists — RFQs is the closest analogue (pre-PO price comparison document). No standalone "supplier categories" page — categories are managed entirely inside a modal opened from the Suppliers list.

Out-of-scope items referenced from this domain but belonging to other modules: **تقارير المشتريات** (Purchases by period / by supplier / by item) live under the global Reports module (`/reports/purchases/*`); **أعمار ديون الموردين** (Supplier aging) lives under Reports → Debt Aging (`/reports/aging/suppliers`); Inventory items (`/inventory/items`), Warehouses (`/settings/warehouses`), Branches (`/settings/branches`), and Treasury vouchers/payments (`/treasury/*`) are all cross-linked from purchase documents but documented in their own domains.

---

### الموردون (Suppliers)
- **Route**: `/purchases/suppliers` (list), `/purchases/suppliers/:id` (detail)
- **Purpose**: Master list of vendors/suppliers with balances owed, payment terms, and linked purchase documents (invoices, orders, returns).
- **List view**:
  - KPI strip: "المستحق للموردين" (total payable, with "موردون برصيد مستحق" count) as an expandable button; secondary tiles — إجمالي الموردين (total suppliers), موردون نشطون (active suppliers), المستحق للموردين (repeated), موردون برصيد مستحق.
  - Search box: "ابحث باسم المورد أو الكود أو الهاتف..." (search by name/code/phone) + "تصفية النتائج" (filter) toggle.
  - Status tabs: الكل / نشط / غير نشط (All / Active / Inactive), each with live counts.
  - Filter panel: الهاتف (phone), من/إلى رصيد مستحق (balance-due range, spinbuttons: 0 → غير محدود/unlimited).
  - Table columns: (avatar) · المورد (name + status badge + code, e.g. "جاري · نشط · S000001") · الهاتف · شروط الدفع (payment terms) · المستحق للمورد (balance) · التصنيف (category) · (row action arrow).
  - Pagination: "عرض 1 - N من N" + prev/next + rows-per-page selector (default 25). Row click opens supplier detail page (full navigation, not a drawer, despite tooltip text "يفتح في لوحة جانبية" on the name button elsewhere).
  - Header actions: "تصنيفات الموردين" (Supplier Categories modal), "إضافة مورد" (Add Supplier modal).
- **Detail/form view** (Add/Edit Supplier modal — same field set for create and edit):
  - شعار (logo upload, create only)
  - اسم المورد * (Supplier name, text, required)
  - الكود (Code, text, auto-generated if blank — disabled on edit once assigned, e.g. "S000001")
  - الهاتف (Phone, with a full country-code combobox defaulting to Egypt +20, placeholder "01xxxxxxxx")
  - شروط الدفع (أيام) (Payment terms in days, spinbutton, default 30)
  - العملة (Currency, combobox/typeahead, default "EGP — جنيه مصري")
  - التصنيف (Category, typeahead against supplier-categories list, default "لا توجد تصنيف" / none)
  - "خيارات متقدمة" (Advanced options, expandable) reveals:
    - الاسم بالعربي (Arabic name, text)
    - البريد الإلكتروني (Email)
    - الرقم الضريبي (Tax number, placeholder "300xxxxxxxxx")
    - جهة الاتصال (Contact person)
    - العنوان: المدينة / الحي / الشارع (Address: City / District / Street)
    - ملاحظات (Notes, textarea)
  - Actions: إلغاء (Cancel) / حفظ التعديلات or إضافة مورد (Save/Create).
- **Detail page (`/purchases/suppliers/:id`)**:
  - Header: avatar-letter, name + status badge (نشط/غير نشط), code, breadcrumb. Actions: "إنشاء فاتورة مشتريات" (New Purchase Invoice), "المزيد" (More) menu → تعديل (Edit — opens the modal above), نظرة 360° (360° view, not explored further), separator, تعطيل (Deactivate).
  - Summary strip: التصنيف, شروط الدفع, العملة, الهاتف (tel: link), تاريخ الإنشاء (created date); right-aligned "المستحق للمورد" balance card.
  - Quick-action row: إنشاء فاتورة مشتريات / صرف دفعة (Pay/disburse) / إنشاء أمر شراء (New PO) / عرض كشف الحساب (View statement).
  - Tabs: فواتير المشتريات (N) · كشف حساب المورد (Statement) · مرتجعات المشتريات (Returns) · أوامر الشراء (Orders) · المرفقات (Attachments) · سجل المراجعة (Audit log).
    - فواتير المشتريات tab: table of رقم الفاتورة (+ issue date) / تاريخ الاستحقاق / المتبقي / الحالة / row actions (تسجيل دفعة "Record payment" + menu). Paginated.
    - كشف حساب المورد tab: date-range filter (الكل/من تاريخ/إلى تاريخ), opening/closing balance cards (**note**: opening-balance label rendered as raw i18n key `customers.openingBalance` — untranslated bug), running-balance ledger table: التاريخ / المرجع (linked doc) / النوع (e.g. "فاتورة مشتريات") / مدين / دائن / الرصيد الجاري.
    - المرفقات tab: generic empty-state "لا توجد مرفقات" + "إضافة مرفق" button (shared attachments-widget pattern, seen also on Purchase Invoice detail).
- **Actions**: Add / Edit / Deactivate supplier; create Purchase Invoice / Purchase Order / record a payment directly from supplier context; 360° view (unexplored).
- **Workflows/statuses**: نشط / غير نشط (Active / Inactive) — no multi-step workflow; this is a master-data entity.
- **API observed**:
  - `GET /api/purchases/suppliers?page=1&limit=25`
  - `GET /api/purchases/suppliers/counts`
  - `GET /api/purchases/suppliers/balance-by-currency`
  - `GET /api/purchases/suppliers/:id`
  - `GET /api/purchases/suppliers/:id/balance`
  - `GET /api/purchases/suppliers/:id/balance-by-currency`
  - `GET /api/treasury/suppliers/:id/unallocated` (unallocated payment credits)
  - `GET /api/purchases/supplier-categories?limit=200[&isActive=true]`
- **Notes**: Only 1 seed supplier ("جاري", code S000001) exists in this tenant. Currency field, while "EGP" is shown as base, suggests multi-currency support at the supplier level. The "التصنيف" (category) field ties directly into the standalone Supplier Categories modal (see below).

---

### تصنيفات الموردين (Supplier Categories)
- **Route**: no dedicated route — opened as a modal from the Suppliers list header button.
- **Purpose**: Simple tagging/grouping of suppliers by activity type (e.g. "Raw Materials", "Services"), used as a filter/column on the Suppliers list.
- **List view**: Inside the modal — empty-state "لا توجد تصنيفات بعد" (no categories yet) with description "أضف تصنيفات لتنظيم موردينك حسب نوع النشاط" and an "إضافة تصنيف" (Add category) button. No categories exist in this tenant, so grid/table layout for populated state wasn't observed.
- **Detail/form view** (inline "Add category" panel inside the same modal):
  - اسم التصنيف * (Category name, text, required)
  - الاسم بالعربية (Arabic name, text)
  - Actions: حفظ (Save) / إلغاء (Cancel)
- **Actions**: Add category; modal close via "إغلاق".
- **Workflows/statuses**: None — flat master list, `isActive` flag exists at the API level (see below) but no UI toggle was found for it in this pass.
- **API observed**:
  - `GET /api/purchases/supplier-categories?limit=200&isActive=true`
  - `GET /api/purchases/supplier-categories?limit=200`
- **Notes**: Zero categories currently defined for this tenant.

---

### طلبات عروض الأسعار (RFQs — Request for Quotation)
- **Route**: `/purchases/rfqs` (list), `/purchases/rfqs/new` (create)
- **Purpose**: Pre-purchase-order document to solicit and compare supplier price quotes before issuing a Purchase Order.
- **List view**:
  - Search: "ابحث برقم الطلب" (search by request number) + filter toggle.
  - Status tabs: الكل / مسودة (Draft) / مرسل (Sent) / مغلق (Closed) / ملغي (Cancelled), each with counts.
  - Filter panel: من/إلى تاريخ (date range), البنود (line-item count range), العروض (quote-count range), أمر الشراء (linked-PO filter combobox, default "الكل").
  - Table columns: رقم الطلب / التاريخ / البنود (item count) / العروض (quote count) / أمر الشراء (linked PO) / الحالة / row action.
  - Empty state: "لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء" + CTA.
- **Detail/form view** (`/purchases/rfqs/new`, full-page form):
  - التاريخ * (Date, default today)
  - مطلوب بحلول (Required-by date)
  - الفرع * (Branch, typeahead)
  - المستودع * (Warehouse, typeahead)
  - ملاحظات (Notes)
  - "الأصناف المطلوبة" (Requested items) line table: الصنف (item typeahead) / الكمية (qty, default 1) / ملاحظات (line notes) / remove row; "إضافة بند" (Add line) button.
  - Save action: "حفظ" only observed at header (no separate "send" action visible pre-save — presumably status transitions happen after items/suppliers are attached post-creation).
- **Actions**: Create RFQ; (list-level) filter by linked PO — implies an RFQ can convert into / be linked to a Purchase Order once quotes are compared.
- **Workflows/statuses**: مسودة (Draft) → مرسل (Sent) → مغلق (Closed), with ملغي (Cancelled) as a terminal alt-state.
- **API observed**:
  - `GET /api/purchases/rfqs?page=1&limit=25&sortDir=DESC`
  - `GET /api/purchases/rfqs/counts`
- **Notes**: No RFQs exist in this tenant (all counts 0). The create form only captures header info + requested items — supplier invitations / quote entry are presumably a separate step not reachable without an existing RFQ (not tested further to respect read-only scope).

---

### أوامر الشراء (Purchase Orders)
- **Route**: `/purchases/orders` (list), `/purchases/orders/new` (create)
- **Purpose**: Formal order sent to a supplier requesting goods; drives Goods Receipts and can flow into Purchase Invoices.
- **List view**:
  - KPI strip: إجمالي الأوامر (total orders), طلبات مرسلة (sent), إجمالي قيمة الأوامر (total value), مستلم بالكامل (fully received).
  - Search: "بحث برقم الأمر أو اسم المورد..." + filter toggle (badge "1" = one active filter).
  - Status tabs: الكل / مسودة / مرسل / مستلم جزئياً (Partially Received) / مستلم بالكامل (Fully Received) / ملغي.
  - Filter panel: المستودع (warehouse), تصفية حسب المورد (supplier filter), من/إلى تاريخ.
  - Table columns: رقم الأمر / تاريخ التسليم المتوقع (expected delivery) / الإجمالي / الحالة / بواسطة (created by) / row action.
  - Empty state CTA: "أنشئ أمر شراء لطلب البضائع من الموردين".
- **Detail/form view** (`/purchases/orders/new`):
  - "بيانات أمر الشراء" section: المورد * (Supplier typeahead) / التاريخ * (default today) / تاريخ التسليم المتوقع (expected delivery date) / الفرع (Branch, default "الفرع الرئيسي") / المستودع * (Warehouse) / العملة (default "EGP (العملة الأساسية)").
  - "بنود أمر الشراء" (Order lines) table: الصنف (item typeahead, with "اختيار متغير" = pick variant, and "إضافة صنف" = add new item inline) / الكمية / سعر الوحدة (unit price) / إجمالي البند (line total) / remove-row; "إضافة صنف" button to add another line.
  - ملاحظات (Notes).
  - "ملخص الطلب" (Order summary) sidebar: المجموع الفرعي (subtotal) / الإجمالي (total).
  - "المرفقات" (Attachments) sidebar widget: "إضافة مرفق".
  - Header + sidebar duplicate action buttons: "حفظ مسودة" (Save draft) / "تأكيد وإرسال" (Confirm & Send).
- **Actions**: Save as draft or confirm-and-send (which presumably transmits/finalizes to the supplier and locks the doc into "مرسل" status).
- **Workflows/statuses**: مسودة → مرسل → مستلم جزئياً / مستلم بالكامل, with ملغي as a cancel path. Receiving is handled by separate Goods Receipt documents linked to the PO (see below).
- **API observed**:
  - `GET /api/purchases/orders?page=1&limit=25`
  - `GET /api/purchases/orders/counts`
- **Notes**: No POs exist yet in this tenant. The supplier-detail page also exposes "إنشاء أمر شراء" as a shortcut that presumably pre-fills the supplier.

---

### استلام البضائع / إيصالات الاستلام (Goods Receipts)
- **Route**: `/purchases/receipts` (list — nav label "استلام البضائع", page header "إيصالات الاستلام"), `/purchases/receipts/new` (create)
- **Purpose**: Records physical receipt of goods against a confirmed Purchase Order, increasing stock on hand ahead of/independent from invoicing.
- **List view**:
  - KPI strip: إجمالي إيصالات الاستلام (total receipts) / مؤكدة (confirmed) / إجمالي قيمة الاستلام (total received value) / مسودة (draft).
  - Search: "بحث برقم أمر الشراء أو الإيصال أو المورد..." + filter toggle.
  - Status tabs: الكل / مسودة / مؤكد / غير مفوترة (Not yet invoiced).
  - Filter panel: المستودع, المورد, من/إلى تاريخ, التكلفة من/إلى (cost range).
  - Table columns: رقم الإيصال / المورد / أمر الشراء (linked PO) / إجمالي التكلفة / حالة الفاتورة (invoicing status) / بواسطة / row action.
  - Empty state CTA: "تظهر إيصالات الاستلام هنا عند إنشائها".
- **Detail/form view** (`/purchases/receipts/new`):
  - Banner note: "إيصال مسودة — أكده ليثبت البضاعة في المخزون. الضريبة تسجل لاحقاً عند فاتورة المشتريات المطابقة." (Draft receipt — confirm to post stock; tax is recorded later on the matching purchase invoice.)
  - أمر الشراء * (Purchase Order picker — **the only way to start a receipt**; line items are presumably auto-populated from the selected PO once chosen)
  - تاريخ الاستلام * (Receipt date, default today)
  - ملاحظات (optional notes)
  - Header action: "حفظ مسودة" (Save draft) only visible before a PO is picked.
- **Actions**: Create receipt from a PO; (implied, not directly tested) confirm receipt to post stock; create a follow-on Purchase Invoice from a confirmed receipt (see Invoice creation method below).
- **Workflows/statuses**: مسودة (Draft) → مؤكد (Confirmed); separately tracked "غير مفوترة" (not-yet-invoiced) filter shows receipts awaiting a Purchase Invoice.
- **API observed**:
  - `GET /api/purchases/receipts?page=1&limit=25`
  - `GET /api/purchases/receipts/counts`
- **Notes**: Because no PO exists in this tenant, the item-line table that appears after selecting a PO could not be captured. Confirms the intended chain: PO → Goods Receipt → Purchase Invoice (invoice can alternatively be created "from receipt" to auto-fill items, per the invoice-creation screen).

---

### فواتير المشتريات (Purchase Invoices)
- **Route**: `/purchases/invoices` (list), `/purchases/invoices/new` (create), `/purchases/invoices/:id` (detail)
- **Purpose**: The AP (accounts payable) document — records the supplier's bill, increases stock (for inventory items) and increases the payable balance to the supplier.
- **List view**:
  - KPI strip: إجمالي المشتريات (total purchases) / المدفوع للموردين (paid to suppliers) / إجمالي المرتجع (total returned) / رصيد الفواتير غير المسددة (outstanding balance); expandable to also show "دفعات صرف غير مخصصة" (unallocated payments).
  - Search: "بحث برقم الفاتورة أو اسم المورد..." + filter toggle.
  - Status tabs: الكل / متأخر (Overdue) / مستحقة قريباً (Due soon) / مسودة / مؤكد / مدفوع جزئياً (Partially paid) / مدفوع (Paid) / ملغي.
  - Filter panel: المستودع, تصفية حسب المورد, من/إلى تاريخ.
  - Table columns: رقم الفاتورة (+ supplier name/date subtext) / تاريخ الاستحقاق / المبلغ المتبقي / الحالة / بواسطة / row actions ("صرف دفعة"/Record payment + menu).
  - Header actions: "استيراد فواتير سابقة" (Import historical invoices) and "فاتورة مشتريات جديدة" (New invoice).
- **Detail/form view — create (`/purchases/invoices/new`)**:
  - "طريقة الإنشاء" (Creation method) toggle: إنشاء فاتورة جديدة (manual entry) vs. إنشاء من إيصال استلام (from a confirmed Goods Receipt, auto-fills items).
  - "بيانات الفاتورة": المورد * / التاريخ * (default today) / تاريخ الاستحقاق (due date) / رقم فاتورة المورد (supplier's own invoice number, free text) / الفرع * (default "الفرع الرئيسي") / المستودع * / العملة (default EGP).
  - "أصناف الفاتورة" line table with a type toggle per add-action: مخزني (inventory item) / مصروف شحن (freight/shipping expense line) — columns: الصنف / الكمية / تكلفة الوحدة / إجمالي البند / remove; "إضافة صنف".
  - ملاحظات.
  - Sidebar: "ملخص الفاتورة" (المجموع الفرعي / الإجمالي الكلي), "المرفقات" widget.
  - Actions: "حفظ مسودة" (Save draft) / "تأكيد الفاتورة" (Confirm invoice), duplicated in header and sidebar.
- **Detail/form view — historical import modal** (from list header):
  - Explains: fully-paid historical invoices are archived without a journal entry; invoices with a remaining balance record that remaining amount as a payable; stock is **not** affected (goods already in warehouse pre-go-live).
  - Fields: file upload ("اختيار ملف", one line per item row, header data repeats per line) + "تحميل النموذج" link to an Excel template (`/templates/historical-purchase-invoices-template.xlsx`).
  - Actions: إلغاء / "استيراد N فاتورة" (disabled until a file with ≥1 row is chosen).
- **Detail/form view — existing invoice (`/purchases/invoices/:id`)**:
  - Header: invoice number + status badge; breadcrumb; actions "مشاركة" (Share), "تسجيل دفعة" (Record payment), "المزيد" menu → طباعة (Print) / إنشاء مرتجع (Create return) / separator / إلغاء الفاتورة (Cancel invoice).
  - Summary strip: التاريخ, المورد (linked, opens side panel per tooltip), تاريخ الاستحقاق, المستودع (linked), الفرع (linked); right card "الرصيد المتبقي" (remaining balance) + "من إجمالي X ج.م" (of total).
  - "تأثيرات هذه الفاتورة" (Effects of this invoice) — a 3-point plain-language explainer panel: (1) items added to inventory (stock-tracked items only), (2) supplier payable increased, (3) no automatic payment — use "دفع" button to record one.
  - Tabs: البنود (N) (Line items) · المدفوعات (Payments) · المرتجعات (Returns) · التكاليف الإضافية (Landed costs) · القيود المحاسبية (Journal entries) · المرفقات (Attachments) · سجل المراجعة (Audit log).
    - البنود tab table columns: الاسم (item, linked) / الكمية / المستهلك / المستلم (consumed/received, e.g. "0 / 1") / تكلفة الوحدة / خصم % / ضريبة % / الإجمالي; footer: المجموع الفرعي (شامل الخصومات) / الإجمالي الكلي (with currency).
- **Actions**: Create manually or from a receipt; import historical invoices in bulk; record payment; share; print; create a return; cancel invoice.
- **Workflows/statuses**: مسودة → مؤكد → (مدفوع جزئياً | مدفوع) with متأخر/مستحقة قريباً as derived due-date states, ملغي as a cancel path.
- **API observed**:
  - `GET /api/purchases/invoices?page=1&limit=25`
  - `GET /api/purchases/invoices/counts`
  - `GET /api/purchases/invoices/stats`
  - `GET /api/purchases/invoices/:id`
  - `GET /api/purchases/invoices/:id/sold-tracking` (tracks how much of a purchased qty has since been sold/consumed)
- **Notes**: Two seed invoices exist (PI-000001: 100 ج.م, PI-000002: 10 ج.م), both "مؤكد" against supplier "جاري". This is the richest detail screen in the domain — the "تأثيرات هذه الفاتورة" explainer pattern (and "لا دفع تلقائي" / no-auto-payment framing) is a notable UX device that may repeat elsewhere (e.g. Sales Invoices) worth cross-checking in other passes.

---

### مرتجعات المشتريات (Purchase Returns)
- **Route**: `/purchases/returns` (list), `/purchases/returns/new` (create)
- **Purpose**: Return goods to a supplier against an existing confirmed Purchase Invoice, decreasing stock and the supplier payable (or creating a refund-receivable).
- **List view**:
  - KPI strip: إجمالي المرتجعات (total returns) / مؤكدة (confirmed) / إجمالي قيمة المرتجعات (total value) / مسودة.
  - Search: "بحث برقم المرتجع أو اسم المورد..." + filter toggle.
  - Status tabs: الكل / مسودة / مؤكد / بانتظار استلام المبلغ (Awaiting refund receipt).
  - Filter panel: المستودع, المورد, من/إلى تاريخ.
  - Table columns: رقم المرتجع / المورد / الإجمالي / الحالة / بواسطة / row action.
  - Header actions: "استيراد مرتجعات سابقة" (Import historical returns) and "مرتجع جديد" (New return).
- **Detail/form view** (`/purchases/returns/new`):
  - "معلومات الفاتورة الأصلية": الفاتورة الأصلية * — a typeahead/dropdown of confirmed invoices (shown as "PI-000002 — جاري · 10.00 ج.م | 20/08/2026" style rows). **A return can only be created against an existing confirmed invoice** — no supplier-only or PO-only return path was found.
  - After picking an invoice, an info panel renders: رقم الفاتورة, المورد, تاريخ الفاتورة, إجمالي الفاتورة, الحالة (read-only, pulled from the source invoice).
  - السبب * (Reason, required combobox) — options: بضاعة معيبة (Defective goods) / صنف خاطئ (Wrong item) / كمية زائدة (Excess quantity) / مشكلة جودة (Quality issue) / أخرى (Other).
  - "بنود المرتجع" (Return lines) table, auto-populated from the source invoice's items: اسم الصنف / سعر الوحدة / وحدة (unit) / الكمية الأصلية (original qty) / الكمية المتاحة (available-to-return qty) / كمية المرتجع (return qty, editable spinbutton, default 0) / المبلغ (computed amount, "—" until qty entered).
  - ملاحظات.
  - Actions: "حفظ مسودة" / "تأكيد المرتجع" (Confirm return).
- **Actions**: Create return against a confirmed invoice (or via list-level "استيراد مرتجعات سابقة" bulk import, modal not opened in this pass but presumably mirrors the invoice-import pattern).
- **Workflows/statuses**: مسودة → مؤكد → بانتظار استلام المبلغ (awaiting refund cash-in) as an additional terminal-ish state, implying returns can result in a supplier refund rather than only a payable offset.
- **API observed**: no return-specific network calls captured in this pass beyond page navigation (list load uses the same counts/list pattern as other purchase docs — not individually filtered/recorded).
- **Notes**: The "إنشاء مرتجع" action was also seen directly on a Purchase Invoice's "المزيد" menu, which likely deep-links into this same create form pre-filled with that invoice.

---

### التكاليف الإضافية (Landed Costs)
- **Route**: `/purchases/landed-costs` (list), `/purchases/landed-costs/new` (create)
- **Purpose**: Allocates additional acquisition costs (freight, customs, insurance, clearance, etc.) across one or more purchase invoices' inventory items, adjusting their landed unit cost.
- **List view**:
  - KPI strip: إجمالي المستندات (total documents) / التكلفة المؤكدة (confirmed cost) / مسودات (drafts); expandable also shows مؤكدة (confirmed count) and ملغاة (cancelled count).
  - Search: "بحث برقم المستند أو الوصف..." + filter toggle.
  - Status tabs: الكل / مسودة / مؤكد / بانتظار التسوية (Awaiting settlement) / ملغي.
  - Filter panel: المستودع, طريقة التوزيع (distribution method), من/إلى تاريخ, من/إلى المبلغ (amount range).
  - Table columns: رقم المستند / التاريخ / المستودع / طريقة التوزيع / الفواتير المرتبطة (linked invoices) / إجمالي التكلفة / الحالة / row action.
  - Empty state CTA: "أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات".
- **Detail/form view** (`/purchases/landed-costs/new`):
  - "المعلومات الأساسية": المستودع * (Warehouse) / طريقة التوزيع * (Distribution method combobox — options: حسب القيمة [By value] / حسب الكمية [By quantity], default "حسب القيمة") / التاريخ * (default today) / الوصف (Description) / ملاحظات.
  - "الفواتير المرتبطة" (Linked invoices) — placeholder text "اختر المستودع أولاً لعرض الفواتير" (select a warehouse first to list eligible invoices); presumably becomes a multi-select of purchase invoices from that warehouse once chosen.
  - "بنود التكلفة" (Cost line items) table: نوع التكلفة * (Cost type combobox — options: شحن [Shipping] / جمارك [Customs] / تأمين [Insurance] / تخليص [Clearance] / أخرى [Other], default "شحن") / الوصف (line description) / المبلغ * (amount) / remove-row; "إضافة بند" (Add line); footer "إجمالي التكلفة" (total cost).
  - Actions: "حفظ" (Save) / "تأكيد التوزيع" (Confirm allocation).
- **Actions**: Create a cost-allocation document across selected invoices/items; confirm to post the allocation (adjusting item landed costs).
- **Workflows/statuses**: مسودة → مؤكد → (implicitly) بانتظار التسوية as an intermediate/awaiting state, ملغي as cancel path.
- **API observed**:
  - `GET /api/purchases/landed-costs?page=1&limit=25`
  - `GET /api/purchases/landed-costs/counts`
- **Notes**: No landed-cost documents exist yet in this tenant. This screen is also reachable as a tab ("التكاليف الإضافية") directly on a confirmed Purchase Invoice's detail page, suggesting invoices can show their allocated landed costs inline as well as via this standalone list.

---

## Cross-cutting observations

- **Document chain**: RFQ (optional) → Purchase Order → Goods Receipt (confirms PO, posts stock) → Purchase Invoice (either manual, or "from receipt" to auto-fill, records payable + inventory + tax) → optional Purchase Return (against a confirmed invoice) and/or Landed Cost allocation (against one or more confirmed invoices).
- **Shared UI patterns across all 7 purchase document types**: KPI stat strip with an expandable "more metrics" popover; search + status-tabs-with-counts + collapsible advanced-filter panel; consistent "المزيد" (More) header menu for secondary actions (edit/print/cancel/return); a generic "المرفقات" (Attachments) tab/widget with identical empty-state copy reused verbatim across Suppliers and Invoices (and likely elsewhere); a "سجل المراجعة" (Audit log) tab present on both Suppliers and Purchase Invoices.
- **Historical-data import**: Both Purchase Invoices and Purchase Returns expose an "استيراد ... سابقة" (import historical ...) bulk-upload path with a downloadable Excel template, aimed at go-live data migration without re-triggering accounting/stock effects for already-settled documents.
- **Bug/i18n note**: On the Supplier detail → "كشف حساب المورد" (Statement) tab, the opening-balance label renders the raw i18n key `customers.openingBalance` instead of translated Arabic text — a leftover from customer/supplier code sharing.
- **Naming inconsistency**: The left-nav label "استلام البضائع" (Goods Receiving) does not match the page's own header/breadcrumb text "إيصالات الاستلام" (Receipt Slips) — cosmetic but worth flagging.
- **Read-only limits of this pass**: No Purchase Orders, RFQs, Goods Receipts, Purchase Returns, or Landed Cost documents exist in this tenant's seed data, so several line-item auto-population behaviors (e.g. PO→Receipt item fill, Invoice-from-Receipt fill, Landed-Cost invoice picker) could not be observed end-to-end — only their entry points and static field layouts were captured.

---

### إدارة المشتريات (Purchases Hub / Domain Landing Page) — added by verification pass
- **Route**: `/purchases/hub` — a real, fully-rendered route not linked anywhere in the sidebar (the "المشتريات" sidebar entry is an expand/collapse toggle only, no `/url`). Found by extracting route-literal strings from the production JS bundle and test-navigating; the same `/{module}/hub` pattern exists once per domain across the whole app (see `01-sales.md` for the fullest write-up of the pattern and why it's undocumented in every original pass).
- **Purpose**: Domain dashboard/launcher — "ابدأ من المنطقة التي تريد العمل عليها" — duplicates entry points already in the sidebar rather than adding new functionality.
- **List view** (tile/dashboard layout):
  - "ابدأ بسرعة" quick-create row: أمر شراء جديد, استلام جديد, فاتورة مشتريات جديدة, مورد جديد.
  - "مسار الشراء" (purchase flow) mini-stepper: أوامر الشراء → استلام البضائع → فواتير الموردين, with the hint text "ابدأ بإنشاء أمر الشراء، ثم سجل الاستلام، ثم أدخل فاتورة المورد" (start with the PO, then log the receipt, then enter the supplier invoice) — the clearest one-line statement anywhere in the app of the intended document chain, matching this file's own §"Document chain" note above.
  - "مناطق العمل" tile grid with live counts and "عرض" links: أوامر الشراء (N أمر), استلام البضائع (N استلام), فواتير الموردين (N فاتورة), الموردون (N مورد · N نشط, + "تصنيفات الموردين" link), مرتجعات المشتريات (N مرتجع), التكاليف الإضافية (N / N مؤكد).
  - "آخر النشاط" → "آخر الفواتير" recent-purchase-invoices list (supplier/status label, invoice #, date, status pill, amount).
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above.
- **Actions**: Quick-create shortcuts; tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls (`/api/auth/me`, `/api/branches`, `/api/warehouses`, `/api/notifications*`, `/api/status/summary`, `/api/workflow/pending`, `/api/workflow/my-rejected`, `/api/banners/active`) plus per-tile counts/recent-activity calls for orders, receipts, invoices, suppliers, returns, landed costs (not individually isolated in this pass).
- **Notes**: See `01-sales.md`'s Sales Hub entry for the full discussion of why this whole class of screen (one per domain) was missed by the original recon and what it means for the rebuild scope.

## Screenshots
All saved to `/Users/bassamsalah/My Data/Projects/mezan/recon/catalog/img/`:
- `purchases-suppliers-list.png` — Suppliers list
- `purchases-supplier-detail.png` — Supplier detail page
- `purchases-supplier-add-dialog.png` — Add Supplier modal
- `purchases-rfq-new.png` — New RFQ form
- `purchases-order-new.png` — New Purchase Order form
- `purchases-receipt-new.png` — New Goods Receipt form
- `purchases-invoices-list.png` — Purchase Invoices list
- `purchases-invoice-detail.png` — Purchase Invoice detail (PI-000001)
- `purchases-invoice-new.png` — New Purchase Invoice form
- `purchases-return-new.png` — New Purchase Return form (empty)
- `purchases-return-filled.png` — New Purchase Return form (invoice selected, lines populated)
- `purchases-landed-cost-new.png` — New Landed Cost document form
