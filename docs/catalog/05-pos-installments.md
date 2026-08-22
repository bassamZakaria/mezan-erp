# Pass 5 — POS & Installments Domain

## Screen Inventory

### POS
| Screen (AR) | EN | Route |
|---|---|---|
| الأجهزة | Devices/Terminals | /pos/terminals |
| الورديات | Shifts/Sessions | /pos/sessions |
| المبيعات | Sales | /pos/sales |
| المرتجعات | Refunds | /pos/refunds |
| شاشة المطبخ | Kitchen screen | /pos/kitchen |
| إدارة الطاولات | Table management | /pos/tables |
| التوصيل | Delivery | /pos/deliveries |
| اعتمادات الخصم | Discount approvals | /pos/discount-approvals |
| الحجوزات | Reservations | /pos/reservations |
| إعدادات الوردية | Shift settings (cashier settings) | /settings/shifts |
| (selling screen) | POS sell screen | TBD — launched from a session/terminal, not a top-level nav link |
| نقاط البيع (hub) | POS Hub, domain landing page | /pos/hub — **not linked from the sidebar nav**; added by verification pass |

### Installments
| Screen (AR) | EN | Route |
|---|---|---|
| خطط الأقساط | Installment plans | /installments/plans |
| متابعة التحصيل | Collection follow-up | /installments/follow-ups |

Related report screens exist under `/reports/pos/*` and `/reports/installments/*` — these belong to the Reports domain pass (08-reports.md) and are only referenced here, not documented in full.

---

## POS Domain

### الأجهزة (Devices/Terminals — POS Devices/Stations Config)
- **Route**: `/pos/terminals`
- **Purpose**: Configure POS hardware/terminal stations — link each terminal to a branch, warehouse, cash drawer account, enabled payment methods, and a thermal printer address.
- **List view**: Table columns: كود الجهاز (device code + branch subtitle), نوع الجهاز (device type, e.g. "بيع تجزئة" = Retail sale), الفرع (branch — opens branch quick-panel), الجاهزية (readiness status, e.g. "جاهز للعمل" = Ready), طريقة الدفع الافتراضية (default payment method), row action menu. Summary cards: إجمالي الأجهزة (total devices), نشط (active), غير نشط (inactive). Search box "ابحث بكود الجهاز أو الاسم أو الفرع" (search by device code/name/branch). Status filter tabs: الكل / نشط / غير نشط. Additional filter: نوع الجهاز (device type) combobox + "تصفية النتائج" (filter results) button. Pagination "عرض 1 - 1 من 1" with rows-per-page selector (default 25). Staging data: 1 terminal (POS-001, فرع 1 / الفرع الرئيسي, ready, cash default).
- **Detail/form view** ("إضافة جهاز" / Add device dialog):
  - اسم الجهاز * (device name, text, required)
  - نوع الجهاز * (device type, combobox, required, default "بيع تجزئة" Retail sale)
  - الفرع * (branch, combobox, required, default "اختر الفرع" placeholder)
  - المستودع (warehouse, combobox, disabled until branch chosen)
  - حساب الدرج النقدي (cash drawer account, combobox, disabled until branch chosen) — helper text: "الحساب اللي بتدخل فيه المبيعات النقدية وبيتقفل عليه الجرد آخر الوردية. لازم يكون حساب نقدي." (the account cash sales post to and shift closing reconciles against; must be a cash-type account)
  - طرق الدفع على هذا الجهاز (payment methods enabled on this device) — checklist with per-method account combobox (e.g. بطاقة/Card shown, disabled until branch selected); helper text explains only methods with a default account run automatically on the device, cash always uses the device's own drawer above.
  - عنوان الطابعة الحرارية (thermal printer address, text, placeholder `tcp://192.168.1.100`) — optional, falls back to device default if blank
  - طريقة الدفع الافتراضية (default payment method, combobox, default "نقدي" Cash)
  - Actions: إلغاء (Cancel), إضافة (Add)
  - Row action menu (⋮): تعديل (Edit), تعطيل (Disable)
- **Actions**: إضافة جهاز (Add device) opens the dialog above; row menu Edit/Disable.
- **Workflows/statuses**: جاهز للعمل (Ready) readiness state observed; نشط/غير نشط (Active/Inactive) toggle via تعطيل.
- **API observed**:
  - `GET /api/pos/terminals?page=1&limit=25` (list)
  - `GET /api/pos/terminals?isActive=true&limit=1` / `?isActive=false&limit=1` / `?limit=1` (summary counts)
- **Notes**: Clicking the branch name in the row opens the generic Branch quick-panel (out of scope, shared component — shows branch overview/inventory/employees/assets/POS/activity tabs and treasury account balances). Device type combobox suggests multiple POS device types exist beyond "بيع تجزئة" (retail sale) — not enumerated since dropdown wasn't expanded to avoid mutating anything mid-flow; to revisit if time allows.

---

### نقطة البيع — شاشة البيع (POS Selling Screen) — NOT AVAILABLE ON WEB
- **Route**: `/pos/sell` → renders an explicit "moved off web" notice instead of the selling UI.
- **Finding**: Navigating to `/pos/sell` (and `/pos` itself, which 404s) shows: heading "نقطة البيع انتقلت إلى تطبيقات الجوال وسطح المكتب" (POS moved to mobile & desktop apps) with body text "لم تعد شاشة البيع متاحة على الويب. استخدم تطبيق الجوال أو تطبيق سطح المكتب (Electron) لإجراء عمليات البيع. يبقى سجل المبيعات متاحاً هنا للعرض." (The selling screen is no longer available on the web. Use the mobile app or the desktop [Electron] app to make sales. The sales record remains viewable here.) A single button "العودة إلى سجل المبيعات" (Back to sales record) returns to `/pos/sales`.
- **Implication for this recon pass**: The product grid / cart / payment dialog / barcode entry / hold-sale / discount controls that the task asked to observe **do not exist in the web app** — they only exist in the native mobile and Electron desktop clients, which are out of scope for this browser-based recon. This entire sub-scope (selling screen UI) is a hard gap, not an oversight. The web app's role for POS is admin/back-office: configure terminals, manage shifts/sessions, view sales/refunds history, manage tables/kitchen/deliveries/reservations (back-office side of restaurant mode), and approve discounts.
- **Screenshot**: pos-sell-not-available-web.png

---

### الورديات (Shifts/Sessions)
- **Route**: `/pos/sessions` (list) → `/pos/sessions/{id}/report` (detail/settlement report)
- **Purpose**: Track POS cash-drawer sessions (shifts) per device/cashier — opening balance, running sales, and settlement/close-out with cash-count variance.
- **List view**: Alert banner when shifts are open and need closing ("1 ورديات مفتوحة تحتاج إغلاقاً"). Summary cards: الإجمالي (total), مفتوحة (open), بها فرق نقدي (with cash variance). Search "بحث برقم الوردية أو الكاشير أو الجهاز..." (by session #, cashier, or device). Status filter tabs: الكل / مفتوحة / مغلقة / بها فرق نقدي. Filters: جهاز (device combobox), من تاريخ / إلى تاريخ (date range). Table columns: رقم الوردية (session # + opened-at timestamp), جهاز (device — shows branch + cashier name), الورديات (shift-template assignment, e.g. "خارج الورديات" = outside configured shift schedule), المدة (duration, e.g. "420س 51د"), إجمالي المبيعات (total sales, sortable), الفرق (variance, sortable), الحالة (status: "قيد التشغيل" running / "نشط" active), row action ("إغلاق الوردية" close-shift button + overflow menu). Pagination with rows-per-page (default 25). Staging data: 1 session, SES-000001, opened 04/08/2026, فرع 1, cashier يوسف محمد, 34.20 ج.م sales, status نشط/قيد التشغيل.
- **Detail/form view** (Session report, tabs):
  - Header: session #, live status badge ("قيد التشغيل"), "إغلاق الوردية" (Close shift) button.
  - Info strip: جهاز (device/branch label), الكاشير (cashier), الفرع (branch — opens branch side panel), الحالة (status), وقت الفتح (open time), الورديات (shift-template), وقت الإغلاق (close time, "قيد التشغيل" while open), الرصيد الافتتاحي (opening balance).
  - KPI: صافي المبيعات (net sales) + sale count ("١ المبيعات").
  - Tabs:
    - **التسوية** (Settlement): الرصيد الافتتاحي (opening balance), + مبيعات نقدية (cash sales), النقدية المتوقعة (expected cash — "لم تحسب بعد" not calculated until close), النقدية الفعلية (actual cash — not calculated until close), status pill "قيد التشغيل".
    - **تفصيل المدفوعات (N)** (Payment breakdown): table — طريقة الدفع (payment method), العدد (count), الإجمالي (total). Observed: نقدي/Cash, 1, 34.20 ج.م.
    - **تحصيلات الآجل** (Credit/installment collections) — collections recorded against this shift (relevant to installments domain; not populated in staging data observed).
    - **حركات النقدية** (Cash movements) — manual drawer operations table: النوع (type), المبلغ (amount), السبب (reason), التاريخ (date). Empty-state copy clarifies scope: "حركات النقدية هي عمليات يدوية على درج النقد خلال الوردية (سحب من المدير، إضافة فكة، صرف من الدرج). مبيعات النقدية من الزبائن لا تحسب هنا — تظهر في «ملخص المبيعات» و«تفصيل المدفوعات»." (Cash movements are manual drawer ops — manager withdrawals, float top-ups, drawer payouts; customer cash sales are NOT counted here, they show in Sales Summary / Payment Breakdown.)
    - **ملخص المبيعات** (Sales summary): إجمالي المبيعات (total sales), مبيعات نقدية (cash sales), مبيعات بطاقة (card sales); إجمالي المرتجعات (total refunds), المرتجعات الملغاة (cancelled refunds), صافي المرتجعات (net refunds).
    - **المبيعات حسب البائع** (Sales by salesperson) — not populated with distinguishing data in this single-cashier session.
- **Actions**:
  - Row/detail "إغلاق الوردية" (Close shift) opens a dialog: read-only recap — الرصيد الافتتاحي (opening balance), مبيعات نقدية (cash sales), إجمالي الباقي المسلم (total change given), إيداع نقدي (cash deposit), إجمالي المرتجعات (total refunds), سحب نقدي (cash withdrawal), النقدية المتوقعة (expected cash, computed = opening + cash sales − withdrawals etc.) — then editable fields: **النقدية الفعلية \*** (actual cash counted, numeric, required) and **ملاحظات الإغلاق** (closing notes, optional textarea). Actions: إلغاء (Cancel), إغلاق الوردية (Close shift — submits and presumably posts a variance). NOT submitted during this recon per scope rules.
- **Workflows/statuses**: Session status values observed: نشط (Active) / قيد التشغيل (Running) while open. List-level status filters imply مغلقة (Closed) and بها فرق نقدي (has cash variance) states also exist. Session lifecycle: opened (from device, presumably via mobile/desktop POS app) → running, accumulating sales/payments/cash movements → closed via "إغلاق الوردية" with counted cash entered → variance (الفرق) computed as actual vs. expected cash.
- **API observed**:
  - `GET /api/pos/sessions?page=1&limit=25` (list)
  - `GET /api/pos/sessions/stats` (summary counts)
  - `GET /api/pos/sessions/{id}/report` (detail/report, tabs)
  - `GET /api/pos/sessions/{id}/close-preview` (pre-fills the close-shift dialog recap figures)
- **Notes**: Sessions can only be *opened* from a POS device (mobile/Electron app, out of scope) — no "create session" affordance exists in the web admin UI. The web UI is close/monitor-only. "الورديات: خارج الورديات" on the observed session suggests a separate shift-template/scheduling concept configured at `/settings/shifts` (see below) that sessions can optionally be tagged against.
- **Screenshots**: pos-sessions-list.png, pos-session-report-settlement.png, pos-close-shift-dialog.png

---

### إعدادات الوردية (Shift Settings — Cashier/Shift Templates)
- **Route**: `/settings/shifts`
- **Purpose**: Define named shift-time templates (e.g. morning/evening shift) used purely for reporting — to bucket POS sales/cash-movements by time-of-day period, independent of the per-cashier session lifecycle in `/pos/sessions`. Page subtitle: "عرف فترات الورديات؛ تستخدمها التقارير لتوزيع المبيعات والحركات حسب الوردية" (Define shift periods; used by reports to distribute sales and movements by shift).
- **List view**: Simple table — اسم الوردية (shift name), الفترة (time period), الفرع (branch), الحالة (status), row menu. Staging data: empty ("لا توجد ورديات" — no shifts defined), matching the "خارج الورديات" (outside shift templates) label seen on the one live POS session.
- **Detail/form view** ("وردية جديدة" New shift dialog):
  - اسم الوردية * (shift name, text, required, placeholder "مثال: الوردية الصباحية" e.g. "Morning shift")
  - الاسم بالعربية (Arabic name, text, optional — implies the "name" field above may be intended as a secondary/English label)
  - من * (from time, required, default 08:00)
  - إلى * (to time, required, default 16:00)
  - الفرع (branch, text/combobox, optional, placeholder "كل الفروع" All branches) — helper text: "اتركه فارغاً لتطبيق الوردية على كل الفروع" (leave blank to apply to all branches)
  - نشط (Active, checkbox, default checked)
  - Actions: إلغاء (Cancel), إضافة (Add)
- **Actions**: وردية جديدة (New shift) — top-right button and repeated in empty-state.
- **Workflows/statuses**: نشط/غير نشط (active/inactive) toggle per template only; no lifecycle beyond CRUD.
- **API observed**: not captured (dialog was cancelled before any list-refresh call; underlying list GET not distinctly filtered in the network log during this pass).
- **Notes**: This is a reporting taxonomy, not the cash-drawer session mechanism — distinct from `/pos/sessions` (actual open/close shift instances). A session can apparently be tagged to a shift-template (see "الورديات" field in the session report), but with zero templates defined in this tenant, the live session shows "خارج الورديات" (outside/unassigned).
- **Screenshot**: pos-shift-settings-new-dialog.png

---

### المبيعات (POS Sales List & Detail)
- **Route**: `/pos/sales` (list) → `/pos/sales/{id}` (detail)
- **Purpose**: Read-only ledger of completed POS sale transactions (created from the mobile/desktop selling app) with drill-down to line items, payments, accounting entries, attachments, and audit log; entry point for creating a refund against a sale.
- **List view**: Summary cards: إجمالي العمليات (total transactions), إجمالي المبيعات (total sales value), إجمالي قيمة المرتجعات (total refund value), مكتمل (completed count). Search "ابحث برقم البيع أو اسم العميل..." (search by sale # or customer name) + "تصفية النتائج" filter button. Status filter tabs: الكل / مكتمل (Completed) / مرتجع جزئياً (Partially refunded) / مرتجع بالكامل (Fully refunded). Filters: من تاريخ / إلى تاريخ (date range), طريقة الدفع (payment method). Table columns: رقم البيع (sale # + date/branch subtitle), العميل (customer, sortable), البائع (salesperson), الإجمالي (total, sortable), طريقة الدفع (payment method), الحالة (status, sortable), بواسطة (created-by user — opens user side-panel), row menu. Pagination with rows-per-page (default 25). Staging data: 1 sale, SALE-000001, زبون عابر (walk-in/"passing customer"), 34.2 ج.م, نقدي (cash), status مؤكد (Confirmed).
- **Detail/form view** (`/pos/sales/{id}`):
  - Header: sale #, "إنشاء مرتجع" (Create refund) button.
  - Info strip: التاريخ (date/time), العميل (customer), الحالة (status), جهاز (device — shown as branch label), البائع (salesperson, "بدون بائع" = no salesperson), نوع البيع (sale type, e.g. "بيع تجزئة" retail), الفرع (branch, opens side panel); الإجمالي (grand total) shown prominently.
  - "تأثيرات هذه العملية" (Effects of this transaction) — plain-language explainer chips: "تم خصم الأصناف من المخزون" (items deducted from inventory — quantities left the warehouse linked to the POS device when recorded), "تم استلام قيمة البيع" (sale value received — amount recorded on the payment method used), "البيع مدفوع بالكامل" (sale fully paid — no amount owed by customer on this transaction).
  - Tabs:
    - **عناصر (N)** (Items): table — الاسم (item, opens item side-panel, shows SKU), الكمية (qty + UoM), سعر الوحدة (unit price), خصم % (discount %), ضريبة % (tax %), الإجمالي (line total); footer totals: المجموع الفرعي (شامل الخصومات) (subtotal incl. discounts), الضريبة (tax, "+"), الإجمالي الكلي (grand total).
    - **المدفوعات (N)** (Payments): table — طريقة الدفع (method), المبلغ (amount), المرجع (reference, "—" if none). Observed: نقدي (Cash), 34.2 ج.م.
    - **القيود المحاسبية** (Accounting entries) — journal entries generated by this sale (not expanded; standard linked-journal pattern seen elsewhere in the app).
    - **المرفقات** (Attachments).
    - **سجل المراجعة** (Audit log).
- **Actions**: "إنشاء مرتجع" (Create refund) — navigates to `/pos/refunds/new?saleId={id}` (see Refunds below), pre-loading this sale as the source transaction.
- **Workflows/statuses**: مؤكد (Confirmed) observed; list-level filters imply مرتجع جزئياً (Partially refunded) and مرتجع بالكامل (Fully refunded) states also exist once refunds are applied.
- **API observed**: `GET /api/pos/terminals...` (unrelated, noise); sale list/detail endpoints inferred as `GET /api/pos/sales?...` and `GET /api/pos/sales/{id}` (pattern consistent with refunds/sessions/terminals below; not independently re-confirmed in the network log snapshot due to log-window limits, but UI/URL structure is unambiguous).
- **Notes**: "زبون عابر" = walk-in/passing customer (POS default when no customer selected). Customer, salesperson, and item names all deep-link to shared side-panels (out of scope, generic components). No edit/delete/void actions are exposed here — POS sales are immutable from the web; the only forward action is issuing a refund.
- **Screenshots**: pos-sales-list.png, pos-sale-detail.png

---

### المرتجعات (POS Refunds)
- **Route**: `/pos/refunds` (list) → `/pos/refunds/new?saleId={id}` (create form, reachable both from this list's "مرتجع جديد" button and from a sale detail's "إنشاء مرتجع" button)
- **Purpose**: Process/record returns of previously sold POS items against an original sale, with per-line partial-quantity return, refund method selection, and shift association.
- **List view**: Summary cards: إجمالي المرتجعات (total refunds), مكتمل (completed), إجمالي قيمة المرتجعات (total refund value), ملغي (cancelled). Search "ابحث برقم البيع أو اسم العميل..." + filter button. Status tabs: الكل / مكتمل / ملغي. Filters: من تاريخ / إلى تاريخ, طريقة الاسترداد (refund method). Table columns: رقم المرتجع (refund #), الإجمالي (total), طريقة الاسترداد (refund method), الحالة (status), row menu. Empty state observed: "لا توجد مرتجعات نقطة بيع" (No POS refunds) — "تظهر مرتجعات نقطة البيع هنا عند تسجيلها من إيصالات الكاشير" (POS refunds appear here once recorded from cashier receipts). Staging tenant currently has 0 refunds.
- **Detail/form view** (`مرتجع جديد` / New refund):
  - **معلومات البيع الأصلي** (Original sale info) section: البيع الأصلي * (Original sale, searchable combobox "ابحث برقم البيع أو اسم العميل..." — required; can be pre-filled via `?saleId=`), then read-only recap once selected: رقم البيع (sale #), العميل (customer), التاريخ (date), الإجمالي (total), الحالة (status).
  - **اختر العناصر المرجعة** (Select items to return) — line table pulled from the original sale: الاسم (item), سعر الوحدة (unit price), ضريبة % (tax %), الحد الأقصى (max returnable qty — caps at originally sold qty minus already-refunded), الكمية المرتجعة (qty to return — stepper/spinbutton, starts at 0, capped by "الحد الأقصى"), الإجمالي (computed line refund total); footer row "إجمالي المسترجع" (total to be refunded).
  - **تفاصيل الاسترداد** (Refund details) section:
    - سبب الإرجاع * (Return reason, required combobox) — options observed: معيب (Defective), صنف خاطئ (Wrong item), كمية زائدة (Excess quantity), تغيير رأي العميل (Customer changed mind), أخرى (Other).
    - طريقة الاسترداد * (Refund method, required combobox, default "نفس طريقة الدفع الأصلية" = Same as original payment method) — implies alternate refund methods (e.g. store credit/cash override) are selectable.
    - وردية * (Shift, required combobox) — pre-filled to the active session, e.g. "SES-000001 — فرع 1"; ties the refund to a specific open POS session for cash-drawer accounting.
  - Actions: إلغاء (Cancel), تنفيذ الاسترداد (Execute refund/Submit — NOT clicked during this recon).
- **Actions**: "مرتجع جديد" (New refund) on the list (opens the form with an empty/searchable original-sale field); "إنشاء مرتجع" on a sale detail page (opens the form pre-scoped to that sale).
- **Workflows/statuses**: مكتمل (Completed) / ملغي (Cancelled) filters imply a two-state refund lifecycle once created; a refund requires an active/selectable POS session (شفت) to post against, mirroring how sale-side cash movements are tied to sessions.
- **API observed**: `GET /api/pos/refunds?page=1&limit=25` (list), `GET /api/pos/refunds/counts` (summary counts).
- **Notes**: Refund quantity is capped per-line at the still-returnable quantity ("الحد الأقصى"), preventing over-refunding. The reason field is a closed enum (no free-text option beyond "أخرى" Other, which itself doesn't reveal a follow-up text box in this pass). No screenshot was taken of the reason dropdown open, but options are fully enumerated above.
- **Screenshots**: pos-refund-new-form.png, pos-refunds-list-empty.png

---

### اعتمادات الخصم (Discount Approvals)
- **Route**: `/pos/discount-approvals`
- **Purpose**: Manager approval queue for discounts a cashier requests on a POS sale that exceed their allowed limit — read/act interface for a mobile/desktop-app-initiated approval workflow.
- **List view**: Period toggle: اليوم (Today) / كل الفترات (All periods). Summary cards: الإجمالي (total), قيد الانتظار (Pending), تم الاعتماد (Approved), تم الرفض (Rejected) — expanded card also shows منتهية (Expired) and ملغية (Cancelled). Search "ابحث باسم الكاشير أو رقم الطلب…" (search by cashier name or request #). Status filter tabs: الكل / قيد الانتظار / تم الاعتماد / تم الرفض / منتهية / ملغية. Table columns: الكاشير (cashier, sortable), الخصم (discount amount/%), إجمالي الفاتورة (invoice total), الحالة (status), وقت الطلب (request time, sortable), تم الرد بواسطة (responded by). Empty state: "لا توجد طلبات اعتماد" / "ستظهر طلبات اعتماد الخصم من نقاط البيع هنا" (Discount approval requests from POS will appear here). Staging tenant: 0 requests.
- **Detail/form view**: Not directly reachable in this pass — with 0 requests, no row exists to open an approve/reject panel; presumably clicking a row opens a side panel with the requested discount, cashier, invoice line context, and Approve/Reject actions (consistent with the "الموافقات" approvals module pattern used elsewhere in the app).
- **Actions**: (inferred, not observed) Approve / Reject a pending discount request. No creation action here — requests originate from the POS device app.
- **Workflows/statuses**: قيد الانتظار (Pending) → تم الاعتماد (Approved) or تم الرفض (Rejected); also منتهية (Expired — presumably a request that times out unanswered) and ملغية (Cancelled — presumably cashier-cancelled).
- **API observed**: not captured (no distinct network calls isolated in this pass beyond the standard list/counts pattern).
- **Notes**: This is the manager-side control for over-limit discounts on POS sales; the cashier-side "request a discount over my limit" UI lives only in the mobile/Electron POS app, consistent with the selling screen being unavailable on web.
- **Screenshot**: pos-discount-approvals-list.png

---

### شاشة المطبخ (Kitchen Display Screen)
- **Route**: `/pos/kitchen`
- **Purpose**: Kitchen Display System (KDS) view of open food-prep orders coming from POS sales, restaurant tables, takeaway, and delivery — for restaurant-mode operations.
- **List view**: Summary cards: الطلبات داخل المطبخ (orders currently in kitchen), طلبات عاجلة (urgent orders), جاهزة للاستلام (ready for pickup), متوسط الانتظار (average wait time, in minutes). Filter/segment buttons: الكل (All), عاجل (Urgent), جاهزة للاستلام (Ready for pickup), الطاولات (Dine-in/Tables), سفري (Takeaway), توصيل (Delivery) — these double as order-channel filters. Empty state observed: "المطبخ خالٍ" / "لا توجد طلبات مفتوحة في المطبخ حالياً" (Kitchen is empty / no open kitchen orders currently).
- **Detail/form view**: Not observed — no open orders in staging data to inspect an order ticket/card. Expected (by convention with similar KDS screens) to show per-order item lines with a stage/status control (e.g. preparing → ready) but not confirmed here.
- **Actions**: Presumably per-order "mark ready"/"bump" actions once an order card is present; none observable with an empty queue.
- **Workflows/statuses**: Implied pipeline: order received → in kitchen (queued/preparing) → عاجل (urgent, likely SLA-breach flag) → جاهزة للاستلام (ready for pickup) → picked up/served (leaves the KDS queue).
- **API observed**: not isolated in this pass (page issued 2-3 console errors, likely a WebSocket/polling connection for live updates that isn't reachable/relevant in this recon context — not investigated further as it's non-blocking).
- **Notes**: This is the back-of-house restaurant-mode screen; it only surfaces content once orders are placed via the (web-unavailable) POS selling app, and this tenant currently has none in-flight. The channel filter (Tables/Takeaway/Delivery) confirms POS supports at least these three order-fulfillment types, tying together with `/pos/tables` and `/pos/deliveries`.
- **Screenshot**: pos-kitchen-screen.png

---

### إدارة الطاولات (Table Management — Restaurant Mode)
- **Route**: `/pos/tables` (tabs via query param: `?tab=layout`, `?tab=reservations`, `?tab=stats`)
- **Purpose**: Restaurant floor-plan management — design the dining room layout, monitor live table occupancy/orders, manage reservations, and view per-table performance stats.
- **List view** (الصالة / Floor tab — default): Branch selector (الفرع, defaults to current branch). KPI cards row 1: إجمالي الطلبات اليوم (today's total orders), طلبات مكتملة (completed orders), محصل اليوم (collected today), مفتوحة (لم تحصل بعد) (open, not yet collected), ضيوف اليوم (today's guests). KPI cards row 2: إجمالي الطاولات (total tables), مشغولة (occupied), محجوزة (reserved). Tables are grouped by section/زone, shown as clickable status chips (e.g. "بدون قسم" = No section, containing table "1" — status متاحة/Available, capacity "4 مقعد" = 4 seats). Hint text: "اضغط على طاولة لعرض تفاصيلها" (Click a table to view its details). Staging data: 1 table total, 0 occupied, 0 reserved.
  - Clicking a table opens an inline detail card: table number heading, close (×) button, and stats — إشغالات اليوم (today's occupations count), طلبات اليوم (today's orders), إيرادات اليوم (today's revenue), متوسط مدة الإشغال (average occupancy duration, "—" if none yet).
- **Tabs**:
  - **تصميم الصالة** (Floor design, `?tab=layout`): Drag-and-drop layout editor. Instruction text: "اسحب الطاولات وأفلتها على المربعات لترتيب الصالة. استخدم منطقة التحضير للطاولات الجديدة." (Drag and drop tables onto the grid squares to arrange the floor. Use the staging area for new tables.) "منطقة التحضير" (Staging area) holds unplaced tables (shown as a chip: number, capacity "★", shape code e.g. "RECT", with move/delete icon buttons). "الصالة" (Floor) section below is the placement grid (empty in this pass beyond the one staged table).
    - "إضافة طاولة" (Add table) dialog fields: رقم الطاولة * (table number/label, text, required, placeholder "T1"), القسم (section/zone, text, optional, placeholder "مثل: الصالة الرئيسية، الشرفة" e.g. "Main hall, Terrace"), السعة * (capacity, numeric spinbutton, required, default 4), الشكل (shape, combobox, default "مستطيل" Rectangle — implies other shapes like round/square selectable). Actions: إلغاء (Cancel), إضافة (Add, disabled until required fields valid).
  - **الحجوزات** (Reservations, `?tab=reservations`): Date filter "من تاريخ" (from date, defaults to today) + "إضافة حجز" (Add reservation) button. Empty state: "لا توجد حجوزات" / "لم يتم إنشاء أي حجوزات لهذا التاريخ" (No reservations created for this date). This is the same reservation data/creation flow as the standalone `/pos/reservations` screen (see below), scoped here to table-context.
    - "إضافة حجز" (Add reservation) dialog fields: طاولة * (table, required combobox, placeholder "اختر الطاولة" Choose table), الحالة (status, combobox, default "مؤكد" Confirmed), اسم الضيف * (guest name, text, required), رقم الهاتف (phone, text, optional), عدد الضيوف * (party size, numeric, required, default 2), وقت البداية * (start time, datetime, required, default same-day 21:00), وقت النهاية * (end time, datetime, required, default same-day 19:30 — note: observed default end-time precedes start-time, likely a stale/uninitialized default rather than intentional), ملاحظات (notes, text, optional). Helper text: "سيتم التحقق من تعارض الحجز مع الحجوزات الأخرى تلقائيا" (Reservation conflicts with other bookings are checked automatically). Actions: إلغاء (Cancel), إضافة (Add, disabled until valid).
  - **الإحصائيات** (Statistics, `?tab=stats`): Per-table stat cards — same metric set as the inline table-detail card (إشغالات اليوم, طلبات اليوم, إيرادات اليوم, متوسط مدة الإشغال) — presumably one card per table; only 1 table exists in staging so only one card renders.
- **Actions**: إضافة طاولة (Add table, layout tab), إضافة حجز (Add reservation, reservations tab); implicit drag-drop to arrange tables (not exercised — read-only recon).
- **Workflows/statuses**: Table status observed: متاحة (Available). KPIs imply مشغولة (Occupied) and محجوزة (Reserved) also exist as table states. Reservation statuses (from list columns/filters, shared with `/pos/reservations`): قيد الانتظار (Pending) → مؤكدة (Confirmed) → تم الجلوس (Seated) → مكتملة (Completed); alternate terminal states ملغاة (Cancelled), لم يحضر (No-show).
- **API observed**: not isolated (branch-scoped GETs consistent with other list screens; no distinct pos/tables endpoint captured in the network log window during this pass).
- **Notes**: This confirms "restaurant mode" is present and reachable without needing to toggle any setting — the nav item "إدارة الطاولات" is always visible regardless of whether the tenant is configured as a restaurant. No explicit feature-flag/toggle for enabling restaurant mode was found in `/settings`; it appears to be always-on functionality rather than gated.
- **Screenshots**: pos-tables-floor.png, pos-table-detail-panel.png, pos-tables-layout-design.png, pos-table-add-dialog.png, pos-reservation-add-dialog.png

---

### التوصيل (Deliveries)
- **Route**: `/pos/deliveries`
- **Purpose**: Track POS delivery orders (courier/driver dispatch) from preparation through drop-off.
- **List view**: "الخريطة المباشرة" (Live map) button in header — presumably a live driver-tracking map view. Summary cards: الإجمالي (total), تم الإرسال (Dispatched), تم التسليم (Delivered) — expanded card adds فشل (Failed). Search "بحث برقم التوصيل أو اسم العميل..." (search by delivery # or customer name) + filter button. Status filter tabs: الكل / قيد الانتظار (Pending) / مجهز (Prepared) / تم الإرسال (Dispatched) / تم التسليم (Delivered) / فشل (Failed) / مرتجع (Returned). Filters: من/إلى تاريخ (date range), طريقة الدفع (payment method), السائق (driver, text search). Table columns: رقم التوصيل (delivery #, sortable), اسم العميل (customer name, sortable), السائق (driver), عمر الطلب (order age), طريقة الدفع (payment method), المبلغ الإجمالي (total amount, sortable), row menu. Empty state: "طلبات التوصيل" / "لا توجد طلبات توصيل في الوقت الحالي" (No delivery orders at the moment). Staging tenant: 0 deliveries.
- **Detail/form view**: Not reachable — no delivery records exist in staging to open.
- **Actions**: "الخريطة المباشرة" (Live map) — not opened in this pass (button present, unclicked to preserve scope focus on documented list); presumably per-row actions to assign/reassign a driver or mark delivered exist but unconfirmed with 0 records.
- **Workflows/statuses**: قيد الانتظار (Pending) → مجهز (Prepared) → تم الإرسال (Dispatched) → تم التسليم (Delivered); alternate/terminal states فشل (Failed), مرتجع (Returned).
- **API observed**: not isolated in this pass.
- **Notes**: Deliveries are a third POS fulfillment channel alongside dine-in (tables) and takeaway, matching the kitchen screen's channel filters. Driver assignment/tracking implies integration with a driver/courier concept not otherwise surfaced in this recon pass (out of scope to chase further — likely HR/CRM-adjacent "driver" user type).
- **Screenshot**: pos-deliveries-list.png

---

### الحجوزات (Reservations — standalone)
- **Route**: `/pos/reservations`
- **Purpose**: Same reservation system as the "الحجوزات" tab under Table Management, exposed as a standalone top-level screen with a longer look-back/date-range view and fuller status breakdown.
- **List view**: Period toggle: اليوم (Today) / كل الفترات (All periods). "حجز جديد" (New reservation) button in header. Summary cards: اليوم (Today count), مؤكدة (Confirmed), تم الجلوس (Seated) — expanded card adds قيد الانتظار (Pending), مكتملة (Completed), ملغاة (Cancelled), لم يحضر (No-show). Search "ابحث باسم الضيف أو رقم الهاتف…" (search by guest name or phone). Status filter tabs: الكل / قيد الانتظار / مؤكدة / تم الجلوس / مكتملة / ملغاة / لم يحضر. Table columns: اسم الضيف (guest name, sortable), عدد الضيوف (party size), الطاولة (table), من (start time, sortable), إلى (end time), الحالة (status), row menu. Empty state: "لا توجد حجوزات" / "ابدأ بحجز طاولة لضيفك" (Start by reserving a table for your guest). Staging tenant: 0 reservations.
- **Detail/form view**: "حجز جديد" (New reservation) dialog — identical field set to the one documented under Table Management → Reservations tab (طاولة *, الحالة, اسم الضيف *, رقم الهاتف, عدد الضيوف *, وقت البداية *, وقت النهاية *, ملاحظات).
- **Actions**: حجز جديد (New reservation).
- **Workflows/statuses**: Full lifecycle: قيد الانتظار (Pending) → مؤكدة (Confirmed) → تم الجلوس (Seated) → مكتملة (Completed); alternate terminal states ملغاة (Cancelled), لم يحضر (No-show).
- **API observed**: not isolated in this pass.
- **Notes**: Functionally a duplicate surface of the tables-tab reservations view but without the table-context scoping — useful as a cross-table reservations book. No distinguishing fields or behavior found versus the embedded tab version.
- **Screenshot**: pos-reservations-standalone.png

---

### إعدادات نقطة البيع (Cashier / POS & Loyalty Settings)
- **Route**: `/settings?tab=pos` (also `?tab=payment_methods` for POS payment methods, `?tab=credit` for credit control)
- **Purpose**: Company-wide POS behavior configuration — cashier receipt UX, restaurant meal/course sections, on-device discount-approval thresholds (feeds `/pos/discount-approvals`), loyalty points program, and the catalog of payment methods offered across all POS devices.
- **Detail/form view** — tab "نقطة البيع والولاء" (POS & Loyalty), sections:
  - **نقطة البيع** (POS): مدة عرض الإيصال (بالثواني) (Receipt screen display duration in seconds, numeric, default 30) — helper: default time to keep the receipt screen open post-sale before auto-close; cashier can always close manually. **السماح بتحصيل الآجل من الكاشير** (Allow credit/AR collection from the cashier, toggle, default ON) — helper: "عند التفعيل يستطيع الكاشير تحصيل مديونية العملاء من شاشة الكاشير على الكمبيوتر، وتظهر التحصيلات في تقارير الورديات. عند الإيقاف تختفي شاشة التحصيل وعمود التحصيلات في التقارير. لا يؤثر على تطبيق الموبايل." (When enabled, the cashier can collect customer AR/debt from the desktop cashier screen, and collections appear in shift reports; when off, the collection screen and the collections column disappear from reports; does not affect the mobile app.) — **this is the master switch for the "تحصيلات الآجل" tab seen on the POS session report**, directly tying cashier/shift functionality to installment/AR collection.
  - **أقسام الوجبة (المطاعم)** (Meal/course sections — Restaurants): free-text list of named course sections (observed: المقبلات/Appetizers, الأطباق الرئيسية/Main dishes, التحلية/Dessert) used so the cashier can route items to the kitchen by course/sequence; each row has a delete icon; "إضافة قسم" (Add section) button appends a new named section. This is restaurant-mode's course-sequencing config, feeding the kitchen display's ordering.
  - **اعتماد الخصومات على نقطة البيع** (POS discount approvals — direct source of `/pos/discount-approvals` thresholds): حد الكاشير (نسبة %) (Cashier limit, percent, default 10 — max discount % a cashier can apply without approval; 0 disables this discount type entirely on the POS), حد الكاشير (مبلغ) (Cashier limit, amount, default 50 EGP — whichever threshold is hit first triggers an approval requirement), حد المدير (نسبة %) (Manager limit, percent, default 30 — max a manager can apply without a second-level approval), حد المدير (مبلغ) (Manager limit, amount, default 500 EGP), مدة صلاحية طلب الاعتماد (دقائق) (Approval request validity window in minutes, default 5 — after which the request presumably auto-expires, matching the "منتهية" / Expired status seen in the Discount Approvals screen).
  - **إعدادات نقاط الولاء** (Loyalty points settings): تفعيل نقاط الولاء (Enable loyalty points — platform-managed toggle, shown active/"نشط", not directly editable by tenant admin: "تدار هذه الميزة من قبل مدير المنصة" managed by the platform admin), عدد النقاط (points earned per amount unit, default 1), المبلغ لكل نقطة (currency amount required per point, default 10), قيمة النقطة (redemption cash value per point, default 0.1), مدة صلاحية النقاط (أيام) (points expiry in days, default 365, placeholder "بدون انتهاء" = no expiry if blank). Live example text: "كل 10 EGP يكتسب العميل 1 نقطة. كل نقطة تساوي 0.1 EGP خصم." (Every 10 EGP spent earns 1 point; each point is worth 0.1 EGP discount.)
- **Tab "طرق الدفع في نقاط البيع" (POS Payment Methods)**: Company-wide catalog of payment methods available to assign per-device (see Devices/Terminals above). Intro copy: "عرف طرق الدفع مرة واحدة هنا (شبكة، فوري، فودافون كاش…) عشان تظهر بنفس الاسم في كل الأجهزة والتقارير. بعد كده اختر من إعدادات كل جهاز الطرق اللي تظهر عليه والحساب اللي تستقبل عليه." (Define payment methods once here — e.g. card network, Fawry, Vodafone Cash — so they appear consistently across devices/reports; then per-device settings choose which show and which account receives them.) Table-like rows, one per method: اسم طريقة الدفع (name, editable text), الكود (code, read-only after creation — "الكود هو المعرف الثابت اللي بيتسجل على كل عملية بيع — مايتغيرش بعد الإنشاء" the code is the permanent identifier recorded on every sale, cannot change after creation), نوع الحساب (account type combobox, e.g. "نقدي" Cash / "بنكي" Bank — determines which ledger accounts are selectable, "طريقة نوعها «محفظة» متقدرش تتربط بحساب بطاقة" a wallet-type method can't link to a card account), الحساب الافتراضي (default account, searchable, disabled/locked for the built-in نقدي method which always uses the device's own cash drawer). Two built-in, non-deletable methods observed: نقدي (Cash, code CASH) and بطاقة (Card, code CARD) — both marked "طريقة أساسية في النظام — لا يمكن حذفها" (core system method — cannot be deleted). Add-new-method mini-form: اسم الطريقة الجديدة (text, placeholder "مثال: شبكة"), الكود (text, placeholder "NETWORK"), نوع الحساب (combobox, default "بنكي" Bank), "إضافة طريقة" (Add method) button.
- **Notes**: This settings page is the single source of truth for every payment-method label/default-account seen throughout POS (terminal config, sale/refund/session payment breakdowns). The discount-approval thresholds here are the actual business rule engine behind `/pos/discount-approvals`. No changes were saved during this recon (all fields left at their existing values; the page-level "حفظ الإعدادات" Save button was disabled throughout, indicating no dirty state was introduced).
- **Screenshots**: pos-settings-cashier-tab.png, pos-settings-payment-methods.png

---

### نقاط البيع — POS Hub / Domain Landing Page — added by verification pass
- **Route**: `/pos/hub` — a real, fully-rendered route not linked from the sidebar (the "نقاط البيع" sidebar entry only toggles its submenu open, no `/url`). Found by extracting route-literal strings from the production JS bundle and test-navigating; every domain in the app has one of these at `/{module}/hub` (see `01-sales.md`'s Sales Hub entry for the full write-up of the pattern).
- **Purpose**: Domain dashboard/launcher — "مركز العمليات اليومية للبيع والورديات والمطبخ" (daily operations center for selling, shifts, and the kitchen).
- **List view** (tile/dashboard layout):
  - "بدء سريع" quick-start row: ابدأ البيع (Start selling — links to the web-unavailable `/pos/sell`, see that entry above), فتح وردية (Open shift), شاشة المطبخ (Kitchen display).
  - "مناطق العمل" tile grid: الورديات (N مفتوحة, "عرض الورديات"), البيع ("ابدأ البيع" — same target as the quick-start shortcut), شاشة المطبخ ("شاشة المطبخ"), التوصيل (N إجمالي, "عرض التوصيل"), المبيعات ("عرض"), المرتجعات ("عرض"), الأجهزة ("عرض").
  - "الورديات المفتوحة" (open shifts) panel — branch name, session #, "مفتوحة" status pill, running cash total; "عرض الكل" link to the full Sessions list.
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above. Notably absent from the tile grid: اعتمادات الخصم (Discount Approvals) and الحجوزات (Reservations) — both exist as sidebar screens but are not surfaced as hub tiles, unlike every other POS sub-screen.
- **Actions**: Quick-start shortcuts (including the same "start selling" dead-end as the sidebar, since `/pos/sell` is web-unavailable); tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls plus per-tile counts/recent-activity calls for sessions, deliveries (not individually isolated in this pass).
- **Notes**: This hub is the second place in the app (after the sidebar's own "نقاط البيع" entry) that dead-ends into the "moved to mobile/desktop" notice for `/pos/sell` — reinforcing that a from-scratch POS-selling screen is unavoidable scope for Mezan's web edition, not an oversight in the original recon. See `01-sales.md`'s Sales Hub entry for the full discussion of why this whole class of screen was missed by the original recon.

---

## Installments Domain

### خطط الأقساط (Installment Plans)
- **Route**: `/installments/plans` (list) → `/installments/create` (new plan form, always invoice-driven)
- **Purpose**: Split an existing sales invoice's balance into a scheduled series of equal (or custom) installment payments, then track collection progress per plan.
- **List view**: Header actions: معالجة المتأخرات (Process overdue — batch action, see below), خطة جديدة (New plan). Summary cards: إجمالي الخطط (total plans), خطط نشطة (active plans), المتبقي (remaining balance) — expanded card adds المحصل (collected). Search "بحث برقم الخطة أو اسم العميل..." (search by plan # or customer name) + filter button. Status filter tabs: الكل / متأخر (Overdue) / نشط (Active) / مكتمل (Completed) / ملغي (Cancelled). Filters: العميل (customer, text, default "الكل" All), من/إلى تاريخ (date range). Table columns: رقم الخطة (plan #, sortable), العميل (customer, sortable), الفاتورة (source invoice, sortable), المبلغ الكلي (total amount, sortable), المبلغ المدفوع (paid amount, sortable), المبلغ المتبقي (remaining amount, sortable), التكرار (frequency, sortable), بواسطة (created by, sortable), row menu. Empty state: "لا توجد خطط أقساط" / "أنشئ خطة أقساط لتقسيم مبلغ الفاتورة على دفعات" (Create an installment plan to split an invoice amount into payments) with an inline "إنشاء خطة أقساط" button. Staging tenant: 0 plans.
- **Detail/form view** (`/installments/create` — "خطة جديدة" New plan):
  - **تفاصيل الخطة** (Plan details) panel:
    - الفاتورة * (Invoice, required, searchable combobox, placeholder "اختر فاتورة..." — typing filters a dropdown of unpaid/open invoices shown as "INV-000NNN - CustomerName" with their outstanding balance, e.g. "INV-000014 - اسلام / 375.00 ج.م"; only invoices with an outstanding balance appear to populate the list, confirming plans are always created **from an existing sales invoice**, not standalone/from-scratch)
    - عدد الأقساط * (Number of installments, required, numeric spinbutton, default 6)
    - التكرار * (Frequency, required combobox, default "شهري" Monthly) — full option set: شهري (Monthly), كل أسبوعين (Biweekly), أسبوعي (Weekly), ربع سنوي (Quarterly)
    - تاريخ البدء * (Start date, required date, defaults to today)
    - دفعة مقدمة (Down payment, numeric, default 0, optional)
    - ملاحظات (Notes, text, optional)
  - **معاينة الجدول** (Schedule preview) panel: live-computed summary — المبلغ الكلي (total amount), دفعة مقدمة (down payment), المبلغ المتبقي (remaining amount) — plus, once an invoice is selected, a full generated schedule table: # (installment #), تاريخ الاستحقاق (due date), قيمة القسط (installment amount), المبلغ المتبقي (running remaining balance). Verified example: invoice INV-000014 (375.00 ج.م, 6 monthly installments, no down payment, start 2026-08-21) generated 6 equal installments of 62.50 ج.م each, due on the 21st of each successive month (21/08/2026 → 21/01/2027), with the remaining-balance column counting down to 0.00 on the final installment. Before an invoice is picked: "اختر فاتورة لمعاينة الجدول الزمني" (Select an invoice to preview the schedule).
  - Actions: إلغاء (Cancel), حفظ (Save — NOT clicked in this recon).
- **Actions**: خطة جديدة (New plan, opens create form); **معالجة المتأخرات** (Process overdue) — a confirmation dialog, not a form: subtitle "سيتم تحديث حالة الأقساط المتأخرة وتطبيق غرامات التأخير حسب إعدادات المنشأة" (Will update overdue installments' status and apply late-payment penalties per company settings). Lists two automatic effects: "تحديث حالة الأقساط المستحقة إلى متأخر" (Update due installments' status to Overdue — تلقائي/Automatic) and "تطبيق غرامات التأخير" (Apply late penalties — تلقائي/Automatic). Actions: إلغاء (Cancel), معالجة المتأخرات (Process — NOT executed in this recon). This is effectively a manually-triggerable batch job (likely also runs on a schedule) that (a) flips any installment past its due date into "متأخر" status and (b) applies configured late fees.
- **Workflows/statuses**: Plan-level: متأخر (Overdue) / نشط (Active) / مكتمل (Completed) / ملغي (Cancelled). Overdue logic: an installment becomes "متأخر" once its due date passes and "معالجة المتأخرات" has run (manually or scheduled) — late penalties are then auto-applied per company settings (settings location for the penalty rules themselves was not found in this pass — likely bundled into the same processor rather than exposed as separate configurable fields, or lives outside `/settings` scope explored here).
- **API observed**: `GET /api/installments/plans?page=1&limit=25` (list), `GET /api/installments/plans/counts` (summary counts), `GET /api/installments/overdue/summary` (overdue KPI, likely feeds the "متأخر" filter count and/or the Reports → "الأقساط المتأخرة" screen).
- **Notes**: No standalone/from-scratch plan creation exists — الفاتورة is a hard-required field and the create route is the same whether reached from `/installments/plans` → "خطة جديدة" or (presumably) from a sales invoice detail's own "create installment plan" action (not independently verified from the invoice side in this pass, but the shared `/installments/create` route strongly implies both entry points converge here). Frequency-driven equal-split math (total ÷ count) was confirmed; whether unequal/custom per-installment amounts are supported was not tested (schedule table appeared read-only in the preview, no inline edit affordance seen).
- **Screenshots**: installments-plans-list-empty.png, installments-plan-create-form.png, installments-plan-schedule-preview.png, installments-process-overdue-dialog.png

---

### متابعة التحصيل (Collection Follow-ups)
- **Route**: `/installments/follow-ups`
- **Purpose**: Log collection-activity touchpoints (calls, visits, messages, notes) against customers with outstanding installment balances — a lightweight CRM/collections-agent worklog, independent of any specific installment/plan record in its creation form.
- **List view**: "متابعة جديدة" (New follow-up) button. Summary cards: إجمالي المتابعات (total follow-ups), المعلقة (Pending), المكتملة (Completed) — expanded adds الملغية (Cancelled). Search "بحث في المتابعات..." (search within follow-ups). Status filter tabs: الكل / معلق (Pending) / مكتمل (Completed) / ملغي (Cancelled). Filters: من/إلى تاريخ (date range), نوع المتابعة (follow-up type combobox). Table columns: القسط (the installment this follow-up concerns), نوع المتابعة (type), تاريخ المتابعة (date, sortable), مسؤول المتابعة (assigned owner), النتيجة (outcome/result), row menu. Empty state: "لا توجد متابعات" / "لم يتم إنشاء أي متابعات بعد" (No follow-ups created yet). Staging tenant: 0 follow-ups.
- **Detail/form view** ("متابعة جديدة" New follow-up dialog):
  - العميل * (Customer, required, searchable combobox, placeholder "ابحث عن عميل...") — note: the creation dialog scopes by **customer**, not by a specific installment/plan, even though the list's "القسط" column implies each follow-up is ultimately tied to an installment (likely auto-linked server-side to the customer's active overdue installment(s), or selectable in a later step not reached before Cancel/Escape closed the dialog).
  - نوع المتابعة * (Follow-up type, required combobox, default "اتصال" Call) — full option set: اتصال (Call), زيارة (Visit), رسالة نصية (SMS), بريد إلكتروني (Email), ملاحظة (Note).
  - تاريخ المتابعة * (Follow-up date, required date, defaults to today).
  - مسؤول المتابعة (Assigned owner, text/user-search, optional, placeholder "اتركه فارغاً لتعيين المتابعة لنفسك" leave blank to assign to yourself).
  - ملاحظات (Notes, free text, optional).
  - Actions: إلغاء (Cancel), إضافة (Add — NOT submitted in this recon).
- **Actions**: متابعة جديدة (New follow-up).
- **Workflows/statuses**: معلق (Pending) → مكتمل (Completed); alternate ملغي (Cancelled). "النتيجة" (Outcome/result) column on the list suggests each follow-up is closed out with a result note (e.g. "promised to pay", "no answer") — not directly observed since no records existed to open.
- **API observed**: not isolated in this pass (list/counts pattern consistent with other installments screens; no distinct network call captured).
- **Notes**: This is the collections/late-payment workflow screen — pairs with Reports → "الأقساط المتأخرة" (Overdue installments) and the Plans list's "متأخر" filter and "معالجة المتأخرات" batch action to form the full late/overdue handling loop: overdue detection (materialized by معالجة المتأخرات) → collector logs a متابعة (follow-up) per customer touchpoint → plan eventually reaches مكتمل or gets written off/cancelled.
- **Screenshots**: installments-followups-list-empty.png, installments-followup-new-dialog.png

---

### إعدادات الأقساط (Installment Settings) — NOT FOUND AS A DEDICATED SCREEN
- **Finding**: No standalone "إعدادات الأقساط" (Installment settings) page was found under `/settings`. The settings tabs enumerated are: عام (General), بيانات المنشأة (Company info), البريد الإلكتروني (Email), الضريبة (Tax), الرقابة الائتمانية (Credit Control), سياسة المخزون (Inventory policy), التحكم في المشتريات (Purchasing control), سياسة الخزينة (Treasury policy), نقطة البيع والولاء (POS & Loyalty), طرق الدفع في نقاط البيع (POS payment methods) — none specifically named for installments/late-fee configuration.
- **Closest related settings**: "الرقابة الائتمانية" (Credit Control) tab has: تفعيل الرقابة الائتمانية (Enable credit control, toggle, off by default) and وضع الرقابة (Control mode, combobox, default "تحذير فقط (WARNING)" Warning-only) with helper text "تحذير: يعرض تنبيه عند تجاوز الحد. منع تام: يمنع إنشاء الفاتورة." (Warning shows an alert when the limit is exceeded; Hard block prevents invoice creation) — this governs customer credit limits generally, not installment-specific late fees/grace periods. The late-penalty rule itself (referenced by the "معالجة المتأخرات" dialog's "تطبيق غرامات التأخير" line) is not exposed as an editable setting anywhere found in this pass — it may be a fixed/backend-only rule, or configured elsewhere not discovered (e.g. per-customer, or a platform-level setting outside tenant admin reach, mirroring the loyalty-points toggle's "تدار هذه الميزة من قبل مدير المنصة" platform-managed pattern seen on the POS & Loyalty tab).
- **Notes**: Given the "تفعيل قوائم الأسعار" and loyalty-points precedent of platform-managed toggles, it's plausible installment late-fee % / grace-period days are similarly platform-managed and simply not surfaced to tenant admins — but this is inference, not confirmed.
