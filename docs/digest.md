# Reference System — Structured Digest for Mezan Plan Document

Source: `/Users/bassamsalah/My Data/Projects/mezan/recon/catalog/01-sales.md` through `10-verification.md`, plus `source-recon.md`. All Arabic labels below are copied verbatim from those files (nav labels / page headers / status-chip text). English is the catalog's own translation unless noted. Routes are as recorded (some duplicated across domains where the app itself cross-links a screen into more than one nav group — noted where relevant).

---

## Part A — Bilingual module & screen inventory

### المبيعات — Sales

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| العملاء | Customers | `/sales/customers` | Customer master, credit terms, balances |
| فواتير المبيعات | Sales Invoices | `/sales/invoices` | Confirmed invoices; deducts stock, books receivable |
| عروض الأسعار | Quotations | `/sales/quotes` | Pre-sale quotes, convertible to invoice |
| مرتجعات المبيعات | Sales Returns | `/sales/returns` | Customer returns against a confirmed invoice |
| قوائم الأسعار | Price Lists | `/sales/price-lists` | Custom sell-price lists per customer/category |
| العروض | Promotions | `/sales/promotions` | Discount/bundle rules engine |
| تقرير العروض | Promotions Report | `/sales/promotions/report` | Discount granted via promotions, by period |
| رحلات المندوبين | Van/Rep Trips | `/field/van-trips` | Van sales trips (cross-linked from Sales; owned by Field Sales) |
| إدارة المبيعات | Sales Hub (domain landing page) | `/sales/hub` | Domain dashboard/launcher — **hidden, not linked from sidebar** |

### المشتريات — Purchases

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| الموردون | Suppliers | `/purchases/suppliers` | Vendor master with balances owed |
| تصنيفات الموردين | Supplier Categories | modal (no route) | Tag/group suppliers by activity type |
| طلبات عروض الأسعار | RFQs | `/purchases/rfqs` | Solicit/compare supplier quotes before a PO |
| أوامر الشراء | Purchase Orders | `/purchases/orders` | Formal order sent to a supplier |
| استلام البضائع / إيصالات الاستلام | Goods Receipts | `/purchases/receipts` | Record physical receipt against a PO |
| فواتير المشتريات | Purchase Invoices | `/purchases/invoices` | AP document; posts stock + payable |
| مرتجعات المشتريات | Purchase Returns | `/purchases/returns` | Return goods against a confirmed invoice |
| التكاليف الإضافية | Landed Costs | `/purchases/landed-costs` | Allocate freight/customs/insurance to invoices |
| إدارة المشتريات | Purchases Hub (domain landing page) | `/purchases/hub` | Domain dashboard/launcher — **hidden** |

### المخزون — Inventory

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| الأصناف | Items | `/inventory/items` | Product/service master; costing, GL, ETA mapping |
| منتجات قابلة للتهيئة | Configurable Products | `/manufacturing/configurable-products` | Formula-priced made-to-order products (nav lives under Inventory) |
| قوالب المنتجات | Product Templates | `/inventory/product-templates` | Attribute-based variant/SKU generator |
| أرصدة المخزون | Stock Balance | `/inventory/stock-balance` | Cross-item stock-level rollup |
| تحويلات المخزون | Stock Transfers | `/inventory/transfers` | Move stock between warehouses, valuation-neutral |
| تسويات المخزون | Stock Adjustments | `/inventory/adjustments` | Qty/value corrections incl. opening balances |
| الجرد الفعلي | Physical Counts | `/inventory/physical-counts` | Structured stocktake sessions |
| طباعة الملصقات | Label Printing | `/inventory/labels` | Print item barcode/price labels |
| تقييم المخزون | Inventory Valuation (report) | `/reports/inventory/valuation` | Qty×cost valuation reconciled to GL |
| إدارة المخزون | Inventory Hub (domain landing page) | `/inventory/hub` | Domain dashboard/launcher — **hidden** |

### الخزينة — Treasury

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| حسابات الخزينة | Treasury Accounts | `/treasury/accounts` | Cash/bank wallets, each tied to a GL account |
| السندات النقدية | Cash/Payment Vouchers | `/treasury/vouchers` | Unified receipt/payment/transfer doc, 10 types |
| تسوية كشوف البنك | Bank Statement Reconciliation | `/treasury/bank-reconciliation` | Import & match bank statements (CSV) |
| سجل الشيكات | Cheque Register | `/financial-papers/cheques` | Track incoming/outgoing cheques, 7-state |
| الخزينة | Treasury Hub (domain landing page) | `/treasury/hub` | Domain dashboard/launcher — **hidden**; its "التخصيصات" tile is a redirect alias, not a separate screen |

### الأقساط — Installments

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| خطط الأقساط | Installment Plans | `/installments/plans` (create: `/installments/create`) | Split an invoice into a scheduled payment series |
| متابعة التحصيل | Collection Follow-ups | `/installments/follow-ups` | Collector touchpoint log per customer |

### المحاسبة — Accounting

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| دليل الحسابات | Chart of Accounts | `/accounting/chart` | Hierarchical GL account tree |
| مراكز التكلفة | Cost Centers | `/accounting/cost-centers` | Dimensional cost/profit tracking |
| أرباح مراكز التكلفة | Cost Center P&L | `/accounting/cost-center-pl` | P&L broken out by cost center |
| القيود المحاسبية | Journal Entries | `/accounting/journals` | Central ledger, system-generated + manual |
| الفترات المالية | Fiscal Periods | `/accounting/fiscal-periods` | Monthly period open/close/lock control |
| الضرائب | Taxes | `/accounting/taxes` | Tax rate definitions + GL/ETA mapping |
| أسعار الصرف | Exchange Rates | `/accounting/exchange-rates` | FX rate maintenance, feeds revaluation |
| الفاتورة الإلكترونية (ETA) | E-Invoicing | `/accounting/eta` | Egyptian Tax Authority integration |
| التقارير المالية | Financial Reports | `/accounting/reports` | 7-tab financial statements page |
| مطابقة الأرصدة | Balance Reconciliation | `/accounting/reconciliation` | Sub-ledger vs GL integrity dashboard |
| إعادة تقييم العملات الأجنبية | FX Revaluation | `/accounting/revaluation` | Period-end FX gain/loss posting |
| المحاسبة | Accounting Hub (domain landing page) | `/accounting/hub` | Domain dashboard/launcher — **hidden** |

### المشاريع — Projects

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| المشاريع والمقاولات | Projects & Contracting | `/projects` | Project cost/billing tracking; auto-creates a `PRJ-{code}` cost center |

### الأصول — Assets

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| سجل الأصول | Asset Register | `/assets/list` | Fixed-asset register, acquisition + depreciation setup |
| الإهلاك | Depreciation Runs | `/assets/depreciation` | Period-based depreciation posting batches |
| تصنيفات الأصول | Asset Categories | `/assets/categories` | Default depreciation method + GL mapping per category |
| الأصول الثابتة | Assets Hub (domain landing page) | `/assets/hub` | Domain dashboard/launcher — **hidden** |

### إدارة علاقات العملاء — CRM

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| العملاء المحتملون | Leads | `/crm/leads` | Capture/qualify prospects |
| الفرص | Opportunities | `/crm/opportunities` | Track sales deals vs. a customer |
| خط المبيعات | Sales Pipeline | `/crm/pipeline` | Kanban view of opportunities by stage |
| مراحل خط المبيعات | Pipeline Stages | `/crm/pipeline-stages` | Configure ordered pipeline stages |
| إدارة علاقات العملاء | CRM Hub (domain landing page) | `/crm/hub` | Domain dashboard/launcher — **hidden** |
| مهامي / الأنشطة | CRM Activities / My Tasks | `/crm/activities` | Personal follow-up task/activity log — **hidden**, only reachable from CRM Hub |

### التصنيع — Manufacturing

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| لوحة الإنتاج | Production Dashboard | `/manufacturing/dashboard` | Shop-floor exception/action cockpit |
| أوامر التصنيع (أوامر العمل) | Work Orders | `/manufacturing/work-orders` | Plan/execute production runs against a BOM |
| قوائم المواد | Bills of Materials (BOMs) | `/manufacturing/boms` | Versioned recipe + standard cost |
| التصنيع المخصص | Custom Manufacturing Orders | `/manufacturing/config-instances` | One-off make-to-order execution |
| التصنيع مقابل الشراء | Make vs Buy (report) | `/reports/manufacturing/make-vs-buy` | Compare make cost vs. buy cost/margin |

### الموارد البشرية — HR

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| لوحة الموارد البشرية | HR Dashboard | `/hr/dashboard` | Headcount/attendance/leave KPIs |
| الموظفون | Employees | `/hr/employees` | Central employee master |
| الأقسام | Departments | `/hr/departments` | Department master data |
| المسميات الوظيفية | Job Titles | `/hr/job-titles` | Job-title master, department-scoped |
| الحضور والانصراف | Attendance | `/hr/attendance` | Monthly attendance grid |
| الإجازات الرسمية | Public/Official Holidays | `/hr/holidays` | Company holiday calendar, year-scoped |
| العقود | Contracts | `/hr/contracts` | Employment contract; pay terms, leave overrides |
| طلبات الإجازات | Leave Requests | `/hr/leave/requests` | Leave request submission/approval |
| الرواتب | Payroll | `/hr/payroll` | Monthly payroll run management |
| سلف الموظفين | Employee Advances | `/hr/advances` | Cash advances against future salary |
| سياسات الإجازات | Leave Policies | `/settings/leave-policies` | Company-wide leave-type policy matrix |
| استحقاقات الإجازات | Leave Accrual Batches | `/hr/leave/batches` | Leave-accrual run history + manual trigger |
| إجازاتي | My Leave (employee self-service) | `/hr/my-leave` | Employee's own leave requests — **hidden**, gated to linked accounts |

### نقاط البيع — POS

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| الأجهزة | Devices/Terminals | `/pos/terminals` | Configure POS hardware/stations |
| الورديات | Shifts/Sessions | `/pos/sessions` | Cash-drawer session open/close/variance |
| المبيعات | Sales | `/pos/sales` | Read-only ledger of completed POS sales |
| المرتجعات | Refunds | `/pos/refunds` | POS return processing against a sale |
| شاشة المطبخ | Kitchen Display (KDS) | `/pos/kitchen` | Restaurant-mode kitchen order queue |
| إدارة الطاولات | Table Management | `/pos/tables` | Floor-plan, occupancy, reservations, stats |
| التوصيل | Deliveries | `/pos/deliveries` | Courier/delivery order dispatch tracking |
| اعتمادات الخصم | Discount Approvals | `/pos/discount-approvals` | Manager queue for over-limit cashier discounts |
| الحجوزات | Reservations (standalone) | `/pos/reservations` | Table reservation book |
| (نقطة البيع — شاشة البيع) | POS Selling Screen | `/pos/sell` | **Not available on web** — mobile/Electron app only |
| نقاط البيع | POS Hub (domain landing page) | `/pos/hub` | Domain dashboard/launcher — **hidden** |

### التقارير — Reports (33 reports across 8 domains, one page `/accounting/reports` hosts 7 of them as tabs)

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| المبيعات حسب الفترة | Sales by Period | `/reports/sales/by-period` | Day/week/month sales trend, net of discount/tax |
| المبيعات حسب الصنف | Sales by Item | `/reports/sales/by-item` | Top revenue-generating items |
| المبيعات حسب العميل | Sales by Customer | `/reports/sales/by-customer` | Top customers by revenue & outstanding |
| أفضل المنتجات | Top Products | `/reports/sales/top-products` | Ranked best-sellers, revenue or qty |
| المبيعات حسب البائع | Sales by Salesperson | `/reports/sales/by-salesperson` | POS sales attributed per salesperson |
| مبيعات الڤان | Van Sales | `/reports/sales/van` | Per-trip/rep/van sales, returns, GL-based gross profit |
| تقرير العروض | Promotions Report | `/sales/promotions/report` | Discount granted via promotions (cross-ref, Sales) |
| المشتريات حسب الفترة | Purchases by Period | `/reports/purchases/by-period` | Day-by-day purchase cost trend |
| المشتريات حسب المورد | Purchases by Supplier | `/reports/purchases/by-supplier` | Supplier concentration & payables |
| المشتريات حسب الصنف | Purchases by Item | `/reports/purchases/by-item` | Highest-cost purchased items |
| مستويات المخزون | Stock Levels | `/reports/inventory/stock-levels` | Point-in-time reorder-need flagging |
| حركة المخزون | Stock Movement | `/reports/inventory/movement` | In/out transactions by source doc type |
| سجل المخزون | Stock Ledger | `/reports/inventory/ledger` | Chronological stock ledger w/ running balance |
| تقييم المخزون | Inventory Valuation | `/reports/inventory/valuation` | Qty×cost, reconciled to GL |
| أعمار المخزون | Inventory Aging | `/reports/inventory/aging` | Oldest-unit age per item/warehouse |
| قرب انتهاء الصلاحية | Expiring Soon | `/reports/inventory/expiring-soon` | FEFO-ordered near-expiry batches |
| أصناف بطيئة الحركة | Slow-Moving Items | `/reports/inventory/slow-moving` | Items with no/low sales tying up capital |
| انحراف تقييم المخزون | Inventory Valuation Drift | `/reports/inventory/drift` | Data-QA: 3 costing sources compared |
| التصنيع مقابل الشراء | Make vs Buy | `/reports/manufacturing/make-vs-buy` | Manufacture vs. purchase cost/margin |
| أعمار ديون العملاء | Customer Debt Aging | `/reports/aging/customers` | AR aging, 5-bucket ladder |
| أعمار ديون الموردين | Supplier Debt Aging | `/reports/aging/suppliers` | AP aging, 5-bucket ladder |
| ملخص المبيعات اليومي | Daily Sales Summary | `/reports/pos/daily` | POS sales/payments/top-items/hourly pattern |
| تقارير الورديات | Shift Reports | `/reports/pos/shifts` | Shift sales volume & cash-drawer variance |
| نظرة عامة على الأقساط | Installments Overview | `/reports/installments/overview` | Portfolio status, collection rate per plan |
| الأقساط المتأخرة | Overdue Installments | `/reports/installments/overdue` | Overdue installments ranked by urgency |
| ميزان المراجعة | Trial Balance | `/accounting/reports` (tab) | Debit/credit balance per account as-of date |
| قائمة الدخل | Income Statement | `/accounting/reports` (tab) | Period P&L, revenue→net income |
| الميزانية العمومية | Balance Sheet | `/accounting/reports` (tab) | Point-in-time A = L + E |
| التدفقات النقدية | Cash Flow Statement | `/accounting/reports` (tab) | Indirect-method operating/investing/financing |
| إقرار ضريبة القيمة المضافة | VAT Return | `/accounting/reports` (tab) | Output vs input VAT by rate |
| دفتر الأستاذ العام | General Ledger | `/accounting/reports` (tab) | Per-account debit/credit summary, on-demand run |
| دفتر حساب | Account Ledger | `/accounting/reports` (tab) | Single-account transaction statement |
| أرباح وخسائر مراكز التكلفة | Cost Center P&L | `/accounting/cost-center-pl` | P&L by cost center (also listed under Accounting) |

### الإعدادات — Settings (incl. Dashboard & global chrome)

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| لوحة التحكم | Dashboard (home) | `/` | Company-wide KPI/chart/activity landing page |
| عام | Settings (general hub, tabbed) | `/settings` | 10-tab tenant config hub |
| نقل البيانات | Data Migration | `/settings/data-migration` | 12/13-step onboarding import wizard |
| المستخدمون | Users | `/settings/users` | Tenant user accounts, branch/warehouse scope |
| الأدوار والصلاحيات | Roles & Permissions | `/settings/roles` | Custom roles + ~268-permission matrix |
| الفروع | Branches | `/settings/branches` | Branch master + "Branch 360" analytics page |
| المستودعات | Warehouses | `/settings/warehouses` | Physical/logical stock-location master |
| إعدادات الوردية | Shift Settings | `/settings/shifts` | Named shift-time templates for reporting |
| إعدادات الموافقات | Workflow/Approvals config | `/settings/workflow` | Per-action-type multi-step approval chain builder |
| قواعد الإشعارات | Notification Rules | `/notifications/rules` | Event → recipient → channel rule engine (39 events) |
| قوالب الطباعة | Print Templates | `/settings/print` | 9-tab print/PDF layout designer |
| أكواد الباركود المدمجة | Embedded-barcode rules | `/settings/barcode` | Rules for scale/weight-embedded barcode parsing |
| تسلسلات الترقيم | Numbering Sequences | `/settings/sequences` | Auto-numbering scheme per document type (25 types) |
| الملف الشخصي | Profile (personal account) | `/settings/profile` | Own name/phone/password/activity — **hidden** |
| مفاتيح API | API Keys | `/settings/api-keys` | Scoped external API tokens + connected apps — **hidden** |
| Webhooks | Webhooks | `/settings/webhooks` | Outbound HMAC-signed event delivery — **hidden** |
| واتساب | WhatsApp integration | `/settings/whatsapp` | WhatsApp channel config — **hidden, module-gated off** |
| الموافقات | Approvals inbox | `/approvals` | Top-level pending-approval inbox |
| سجلات المراجعة والأمان | Audit & Security Logs | `/audit/reports` | Security events + sensitive-operation trail — **hidden, quick-search only** |

### المبيعات الميدانية — Field/Van Sales

| Arabic name | English name | Route | Purpose |
|---|---|---|---|
| رحلات المندوبين | Van/Rep Trips | `/field/van-trips` | Load→sell/collect→settle van-sales trip lifecycle |

**Part A counts**: 15 domains; ~127 distinct screens/reports enumerated (matches the verification pass's "125 real screens" total plus the 2 cross-listed rows for Van Trips and Cost Center P&L counted once each in their primary domain).

---

## Part B — Document lifecycles / status workflows

### Sales quote (عرض سعر — Sales Quote)
مسودة (Draft) → مرسل (Sent) → مقبول (Accepted) → محول (Converted); side: مرفوض (Rejected), منتهي (Expired)
— exact 4-step happy path shown as an in-app visual progress tracker on the quote detail page (1 مسودة → 2 مرسل → 3 مقبول → 4 محول). No explicit "convert" button was observed on the quote detail itself; conversion happens via the invoice's "إنشاء من عرض سعر" creation path once a quote is مقبول.

### Sales invoice (فاتورة مبيعات — Sales Invoice)
مسودة (Draft) → مؤكد (Confirmed) → مدفوع جزئياً (Partially paid) → مدفوع (Paid); side: متأخر (Overdue — derived from due date, not a stored status), ملغي (Cancelled)

### Sales return (مرتجع مبيعات — Sales Return)
مسودة (Draft) → مؤكد (Confirmed) → بانتظار دفع المبلغ (Awaiting refund payment) → settled (inferred, no explicit terminal label observed); side: ملغي (Cancelled)
— return never auto-refunds cash; the "awaiting refund payment" state requires a separate Treasury voucher to close out.

### Purchase chain (سلسلة المشتريات — RFQ → PO → GRN → PI → Return)
- طلب عرض سعر (RFQ): مسودة (Draft) → مرسل (Sent) → مغلق (Closed); side: ملغي (Cancelled)
- أمر الشراء (Purchase Order): مسودة (Draft) → مرسل (Sent) → مستلم جزئياً (Partially received) / مستلم بالكامل (Fully received); side: ملغي (Cancelled)
- استلام البضائع (Goods Receipt / GRN): مسودة (Draft) → مؤكد (Confirmed); a separate "غير مفوترة" (Not yet invoiced) filter tracks confirmed receipts still awaiting a purchase invoice.
- فاتورة المشتريات (Purchase Invoice): مسودة (Draft) → مؤكد (Confirmed) → مدفوع جزئياً (Partially paid) / مدفوع (Paid); side: متأخر (Overdue) / مستحقة قريباً (Due soon) — both derived, ملغي (Cancelled)
- مرتجع المشتريات (Purchase Return): مسودة (Draft) → مؤكد (Confirmed) → بانتظار استلام المبلغ (Awaiting refund receipt)
- التكاليف الإضافية (Landed Cost document): مسودة (Draft) → مؤكد (Confirmed) → بانتظار التسوية (Awaiting settlement, inferred intermediate state); side: ملغي (Cancelled)

### Journal entries (القيود المحاسبية — Journal Entries)
مسودة (Draft) → بانتظار الموافقة (Pending Approval) → مرحل (Posted) → معكوس (Reversed)
— all 78 entries observed in the demo tenant were مرحل (Posted); draft/pending/reversed states are inferred from the list's own filter-chip vocabulary and stat-card set, not observed live.

### Fiscal periods (الفترات المالية — 3-state)
مفتوحة (Open, posting allowed) → مغلقة (Closed) → مقفلة (Locked)
— periods are pre-generated open for the whole year; closing is a manual, typically retroactive, per-period action ("إغلاق" row button).

### Vouchers (السندات النقدية — Treasury Vouchers)
مسودة (Draft) → بانتظار الموافقة (Pending Approval) → مؤكد (Confirmed); side: ملغي (Cancelled); a distinct **بحاجة لتخصيص** (Needs allocation) side-state applies to collection/payment-type vouchers whose amount isn't fully applied to invoices yet. In practice "إنشاء وتأكيد" (Create & Confirm) is a single atomic action — all 15 vouchers observed in the demo tenant were مؤكد.

### Cheque register (سجل الشيكات — 7 states, exact)
قيد الانتظار (Pending) → تحت التحصيل (Under collection) → المستحقة اليوم (Due today) → مودع (Deposited) → محصل (Collected); side branches: مرتد (Bounced) → مستبدل (Replaced)
— all 7 states are the exact filter-chip labels from `/financial-papers/cheques`; 0 cheques existed in the demo tenant so transitions are inferred from the label set, not observed live.

### POS shift/session lifecycle (الورديات — Shifts/Sessions)
opened (from a POS device, mobile/desktop app only) → نشط (Active) / قيد التشغيل (Running) → مغلقة (Closed, via "إغلاق الوردية"); side-flag: بها فرق نقدي (Has cash variance) — a filter state, not a separate lifecycle stage, computed from النقدية الفعلية (actual counted cash) vs. النقدية المتوقعة (expected cash) at close.

### POS discount-approval flow (اعتمادات الخصم — Discount Approvals)
قيد الانتظار (Pending) → تم الاعتماد (Approved) / تم الرفض (Rejected); side: منتهية (Expired), ملغية (Cancelled)
Thresholds (from `/settings?tab=pos`, "اعتماد الخصومات على نقطة البيع"): حد الكاشير (نسبة %) default **10%**; حد الكاشير (مبلغ) default **50 EGP** (whichever hit first triggers approval); حد المدير (نسبة %) default **30%**; حد المدير (مبلغ) default **500 EGP**; مدة صلاحية طلب الاعتماد (دقائق) default **5 minutes** — after which a pending request auto-expires into منتهية.

### Installment plan + overdue processing (خطط الأقساط — Installment Plans)
Plan-level: متأخر (Overdue) / نشط (Active) / مكتمل (Completed) / ملغي (Cancelled)
Overdue processing is a manually-triggerable (and likely also scheduled) batch job, "معالجة المتأخرات" (Process overdue), with two stated automatic effects: تحديث حالة الأقساط المستحقة إلى متأخر (update due installments' status to Overdue) and تطبيق غرامات التأخير (apply late-payment penalties) — both flagged "تلقائي" (Automatic) in the confirmation dialog. The penalty-rate/grace-period configuration itself was not found as an editable tenant setting (inferred (inferred) to be platform-managed or backend-fixed).

### Work orders (أوامر التصنيع — 4-stage, with material issue/return/waste)
Top-level: مخطط (Planned) → قيد التنفيذ (In progress) → مكتمل (Completed); side: ملغي (Cancelled); متأخر (Overdue) is a derived date-flag layered on any active status.
Within قيد التنفيذ, a finer 4-step sub-stage tracker: بدء العمل (Start work) → صرف المواد (Issue materials) → استلام المنتج (Receive product) → إكمال أمر العمل (Complete work order).
Additional material actions (enabled progressively as the WO advances): صرف إضافي (Extra material issue), إرجاع مواد (Return materials), تسجيل فاقد (Log waste) — plus تسجيل تكلفة (Log cost), enabled from the start.

### Van trip open→settle (رحلات المندوبين — Van/Rep Trips)
جارية (Ongoing) → مسواة (Settled); side: ملغاة (Cancelled)
A secondary "حالة الرحلة" (trip sub-status) field also exists independent of the top status pill, observed values: "لم تبدأ" (Not started, inferred (inferred) as one possible value alongside the observed "انتهت الرحلة" / Trip ended). Settlement reconciles both cash (المتوقع vs. المعدود vs. الفرق) and stock (تسوية المخزون table).

### Leave request flow (طلبات الإجازات — Leave Requests)
بانتظار الموافقة (Pending) → موافق عليه (Approved) / مرفوض (Rejected); side: ملغى (Cancelled)
— presumably routed through the global الموافقات (Approvals) engine per `/settings/workflow`'s 9 granular leave-type approval gates (see Approval workflow chain mechanics, below).

### Payroll run (الرواتب — Payroll, 5 states)
مسودة (Draft) → محتسب (Calculated) → معتمد (Approved) → مصروف (Disbursed); side: ملغى (Cancelled)
— exact 5-state set from the `/hr/payroll` filter-chip vocabulary (مسودة/محتسب/معتمد/مصروف/ملغى); the create dialog only captures السنة/الشهر (year/month) — calculation/approval/disbursement steps were not exercised live (0 runs in the demo tenant).

### Depreciation run (الإهلاك — Depreciation Runs)
مسودة (Draft) → مرحل (Posted); side: ملغي (Cancelled)
— gated entirely behind having ≥1 registered fixed asset; with 0 assets in the demo tenant, no "run depreciation" trigger control was even rendered (states inferred (inferred) from filter chips only).

### ETA submission lifecycle (الفاتورة الإلكترونية — e-Invoicing document queue)
جاهز (Ready) → بانتظار التوقيع (Pending signature) → مرسل (Submitted) → مقبول (Accepted); side: أخطاء (Errors), مستبعد (Excluded)
— exact filter-tab labels from `/accounting/eta`'s "الإرسالات" (Submissions) tab. All 15 documents observed in the demo tenant sat at جاهز (in-queue, unsent) since this tenant's ETA connection is unconfigured (22% readiness, test-environment credentials).

### Approval workflow chain mechanics (سير العمل / الموافقات — Approval engine)
Configured per **action type** (26 gateable actions found in `/settings/workflow`'s catalog, spanning Sales/Purchases/Treasury/Inventory/Accounting/HR-Payroll/9 granular HR-Leave types/Manufacturing) as a **multi-step, strictly sequential** (not parallel) chain of role-based approvers — each step has a free-text description + a required approver **role** (only tenant-defined custom roles are selectable; built-in company-admin bypasses workflow via blanket `permissions:["*"]`). No conditional/threshold fields exist on a workflow gate itself (contrast with POS discount approval, which does have amount/percent thresholds) — a configured gate applies unconditionally to every instance of that action type.
Event/notification side of the same engine (from the 39-event Notification Rules catalog): عملية بانتظار الموافقة (`WORKFLOW_APPROVAL_REQUESTED`) → تم اعتماد العملية (`WORKFLOW_APPROVAL_GRANTED`) or تم رفض العملية (`WORKFLOW_APPROVAL_REJECTED`); side: مطلوب تعديل على العملية (`WORKFLOW_MODIFICATION_REQUESTED`, i.e. "request modification" is a distinct third outcome besides approve/reject).
This tenant runs with **zero configured approval gates** (`workflowConfig: []`) — the engine (permissions, inbox, pending-count APIs) is fully wired but unused in the demo data.

### CRM lead states (العملاء المحتملون — Leads, 6 states)
جديد (New) → تم التواصل (Contacted) → مؤهل (Qualified) → محول (Converted); side: خسارة (Lost), غير مؤهل (Unqualified)
— exact 6-state set from the `/crm/leads` filter-chip vocabulary; 0 leads existed in the demo tenant, so the conversion mechanism (lead → opportunity/customer) is inferred (inferred), not observed live.

### CRM opportunity / pipeline stages (الفرص / خط المبيعات)
Opportunity-level status: مفتوحة (Open) → مكسوبة (Won) / خسارة (Lost).
Pipeline stage sequence (7 seeded stages, each with a default win-probability %, configured at `/crm/pipeline-stages`): عميل محتمل 10% → تواصل أولي 20% → عرض سعر 40% → تفاوض 60% → مراجعة نهائية 80% → تم الإغلاق 100% (مرحلة فوز / win stage); خسارة 0% held as a separate مرحلة خسارة (loss stage) bucket outside the main flow. Exactly one stage may be flagged مرحلة فوز per tenant.

### Notification rule firing model (قواعد الإشعارات — Notification Rules engine)
Rule = **الحدث** (event, one of 39 catalogued event codes spanning Workflow/Sales/Purchases/Treasury/Installments/Cheques/POS/Inventory/Manufacturing/Platform) + optional **condition** (حقل الشرط / العامل / قيمة الشرط — field/operator/value, e.g. "only if amount > X", disabled until an event is chosen) → **نوع المستلم** (recipient type, e.g. "حسب الصلاحية" = by permission) + **قيمة المستلم** (recipient value) → **الأولوية** (priority, e.g. "عادية" = normal) → **قنوات الإرسال** (send channels: داخل التطبيق in-app / بريد إلكتروني email / إشعار فوري push, each with optional custom title/body using `{{customerName}}`/`{{amount}}`/`{{documentNumber}}` template variables). This tenant has zero custom rules configured — the notifications actually observed (manufacturing work-order start/complete) fire from a default/hardcoded path rather than this rules engine.

---

## Part C — Cross-module business flows

### Order-to-cash (من الطلب إلى التحصيل)
1. **عروض الأسعار** (Quotations, `/sales/quotes/new`) — optional; quote drafted, sent, and مقبول (Accepted) by the customer.
2. **فواتير المبيعات** (Sales Invoices, `/sales/invoices/new`) — created either manually or via "إنشاء من عرض سعر" (create from an accepted quote); on تأكيد الفاتورة (Confirm), stock is deducted from the invoice's warehouse and the customer's receivable increases — no automatic collection happens at this step (explicitly called out in-UI via the "تأثيرات هذه الفاتورة" explainer).
3. **القيود المحاسبية** (Journal Entries) — invoice confirmation auto-posts a linked GL journal entry (visible on the invoice's القيود المحاسبية tab and in `/accounting/journals`).
4. **السندات النقدية** (Cash/Payment Vouchers, `/treasury/vouchers`, type تحصيل من عميل — "Customer collection") — created via the invoice/customer "تحصيل" (Collect) action; posts to a treasury account and auto-generates its own journal entry.
5. **تخصيص على الفواتير** (Invoice allocation) — the voucher's amount is applied ("مخصص") against one or more open invoices via the voucher's "تخصيص على الفواتير" tab; can be partially applied (بحاجة لتخصيص / needs-allocation state) or reversed ("عكس التخصيص").
6. Optional branch: **مرتجعات المبيعات** (Sales Returns, `/sales/returns/new`) against the confirmed invoice — restocks items and reduces the customer's balance, but does **not** auto-refund cash (cash refund needs its own voucher).
7. Optional branch: **خطط الأقساط** (Installment Plans, `/installments/create`) — an unpaid invoice balance can be split into a scheduled series instead of collected in full immediately.

### Procure-to-pay (من الطلب إلى الدفع)
1. **طلبات عروض الأسعار** (RFQs, `/purchases/rfqs/new`) — optional pre-PO step to solicit/compare supplier quotes.
2. **أوامر الشراء** (Purchase Orders, `/purchases/orders/new`) — formal order to a chosen supplier; حفظ مسودة (Save draft) or تأكيد وإرسال (Confirm & Send).
3. **استلام البضائع / إيصالات الاستلام** (Goods Receipts, `/purchases/receipts/new`) — created by picking a confirmed PO (the only entry point); on تأكيد (Confirm) it posts stock into the warehouse, **before** tax/payable are recorded ("الضريبة تسجل لاحقاً عند فاتورة المشتريات المطابقة").
4. **فواتير المشتريات** (Purchase Invoices, `/purchases/invoices/new`) — created manually or via "إنشاء من إيصال استلام" (from a confirmed receipt, auto-filling items); on تأكيد الفاتورة (Confirm) it posts inventory (for stock-tracked items) + increases the supplier payable — no automatic payment (explicit "تأثيرات هذه الفاتورة" explainer, mirroring the sales-invoice pattern).
5. **التكاليف الإضافية** (Landed Costs, `/purchases/landed-costs/new`) — optional; allocates freight/customs/insurance/clearance across one or more confirmed purchase invoices' items (by value or by quantity), adjusting their landed unit cost.
6. **السندات النقدية** (type دفع لمورد — "Pay supplier") — records payment, optionally allocated against specific open purchase invoices via the same allocation mechanism as customer collections.
7. Optional branch: **مرتجعات المشتريات** (Purchase Returns, `/purchases/returns/new`) against a confirmed invoice — decreases stock and the supplier payable, or moves to بانتظار استلام المبلغ (awaiting refund receipt).
8. The Purchases Hub's own mini-stepper states this chain explicitly in-app: **أوامر الشراء → استلام البضائع → فواتير الموردين** ("ابدأ بإنشاء أمر الشراء، ثم سجل الاستلام، ثم أدخل فاتورة المورد").
9. Strictness gates (off by default in the demo tenant, configurable at `/settings?tab=purchasing`): "يجب وجود أمر شراء قبل استلام البضاعة" (PO required before GRN) and "يجب وجود استلام بضاعة قبل فاتورة الشراء" (GRN required before invoice) can force strict linear sequencing of steps 2→3→4.

### Month-end / period close (إقفال نهاية الفترة)
1. **مطابقة الأرصدة** (Balance Reconciliation, `/accounting/reconciliation`) — verify sub-ledger balances (inventory valuation, treasury/cash) match their GL control-account balances; the "القيود غير المرتبطة" (Unlinked Entries) tab flags any journal line posted to a control account without a proper sub-ledger link.
2. **إعادة تقييم العملات الأجنبية** (FX Revaluation, `/accounting/revaluation`) — revalues open foreign-currency customer/supplier/treasury balances at the closing exchange rate (sourced from `/accounting/exchange-rates`) and posts the FX gain/loss difference; the **"العكس التلقائي"** (Auto-reverse) toggle is CHECKED by default, meaning the revaluation entry auto-generates its own reversing entry the next day (`revaluationReversalMode: NEXT_DAY`) so the impact is confined to the closing day only.
3. **الفترات المالية** (Fiscal Periods, `/accounting/fiscal-periods`) — once reconciled and revalued, the period is manually closed via the row-level "إغلاق" (Close) action, transitioning it مفتوحة → مغلقة (and eventually → مقفلة/Locked to hard-block any further posting).
4. **التقارير المالية** (Financial Reports, `/accounting/reports`) — ميزان المراجعة (Trial Balance), قائمة الدخل (Income Statement), الميزانية العمومية (Balance Sheet), التدفقات النقدية (Cash Flow) are typically pulled as-of / for the closed period, each with تصدير (Export) and an optional "مقارنة بالعام الماضي" (compare to last year) toggle.
5. **إقرار ضريبة القيمة المضافة** (VAT Return, same page, tab) — output vs. input VAT by rate for the period, used for the statutory filing.

### POS day cycle (دورة يوم نقطة البيع)
1. **الورديات** (open a shift — device/mobile/Electron app only, not the web admin) — session opens with a الرصيد الافتتاحي (opening cash float) on a specific جهاز (terminal/device).
2. **المبيعات** (`/pos/sales`, sold via the mobile/desktop selling app — the web `/pos/sell` route explicitly renders a "moved to mobile & desktop apps" notice) — items deducted from the linked warehouse; payment recorded per method.
3. **اعتمادات الخصم** (`/pos/discount-approvals`) — a cashier discount exceeding their limit (10%/50 EGP by default) queues a manager approval request with a 5-minute expiry; approved requests let the sale proceed with the higher discount.
4. **المرتجعات** (`/pos/refunds/new?saleId=`) — a refund is created against a specific original sale, capped per-line at the still-returnable quantity, tied to the active شفت (session) for cash-drawer accounting.
5. **إغلاق الوردية** (Close shift, `/pos/sessions`) — cashier/manager enters النقدية الفعلية (actual counted cash); the app computes النقدية المتوقعة (expected cash = opening + cash sales − refunds/withdrawals etc.) and surfaces الفرق (variance).
6. **الخزينة** — the shift's settled cash reconciles against the device's configured حساب الدرج النقدي (cash-drawer treasury account); per-payment-method collections route to their own configured account (e.g. card/wallet methods to a bank-type account).
7. **تقارير الورديات / ملخص المبيعات اليومي** (Shift Reports / Daily Sales Summary, `/reports/pos/*`) — cross-shift comparison of sales volume and cash variance ("متوازن" / balanced badge when the shift reconciles cleanly).

### Manufacturing (BOM → work order → material issue → finished goods → GL)
1. **قوائم المواد** (BOMs, `/manufacturing/boms/new`) — define the recipe: final product, standard batch qty, raw-material lines (qty + waste % + optional flag), estimated labor/overhead cost; versioned (a new version supersedes the prior version's active flag).
2. **أوامر التصنيع** (Work Orders, `/manufacturing/work-orders/new`) — pick a BOM, planned qty, priority, raw-material source warehouse + finished-goods destination warehouse, scheduled start/end dates.
3. **بدء العمل** (Start work) → **صرف المواد** (Issue materials — deducts raw-material stock at this point) → **استلام المنتج** (Receive product — finished goods NOT in stock until this step) → **إكمال أمر العمل** (Complete work order).
4. Additional mid-flow actions: **صرف إضافي** (extra material issue), **إرجاع مواد** (return materials), **تسجيل فاقد** (log waste) — all become enabled once production is under way.
5. **القيود المحاسبية** (Journal Entries) — work-order completion auto-posts a multi-line chain into Accounting without user intervention; the Accounting Hub's own recent-activity feed showed one work order (WO-0010) generating five linked entries in sequence: استلام منتج تام (finished-goods receipt), تكلفة تشغيل تصنيع (overhead cost), تكلفة عمالة تصنيع (labor cost), مرتجع مواد (material return), and an additional صرف مواد تصنيع (material issue).
6. **مركز التكلفة / أرباح مراكز التكلفة** caveat (from `/accounting/cost-center-pl`): labor/overhead capitalized into WIP on a work order is NOT recognized as an expense at production time — it appears as COGS only when the finished product is later sold.
7. Parallel track for one-off orders: **منتجات قابلة للتهيئة** (Configurable Products, formula master data) → **التصنيع المخصص** (Custom Manufacturing Orders / Config Instances) — customer picks parameters (e.g. width/height), formulas compute required materials + price, and the instance can auto-generate a linked Work Order (أمر التشغيل).

### Van sales cycle (دورة مبيعات الڤان)
1. **فتح رحلة** (Open trip, `/field/van-trips`, full-page form) — pick a الڤان (van/vehicle warehouse), مخزن التحميل (loading warehouse), خزينة الڤان (van cash/treasury account), accepted payment methods (each mapped to a treasury account; cash always to the van's own treasury), النقدية الافتتاحية (opening cash float — transferred from the source treasury to the van's treasury), الطاقم (crew: employee + role — سائق/driver, مندوب/rep, مساعد/assistant), and optional تحميل مخزون (stock loaded onto the van, recorded as a **تحويل مخزون** / Stock Transfer to the van warehouse).
2. In-field selling/collection happens via the mobile app (not on web) — invoices and collections accrue against the trip.
3. **تسوية وإغلاق الرحلة** (Settle & close trip) — reconciles: تسوية النقدية (cash: المتوقع/expected vs. المعدود/counted vs. الفرق/variance, using an explicit narrated formula: opening cash + cash sales + cash collections ± other drawer movements) and تسوية المخزون (stock: الصنف/المتوقع/المعدود/الفرق per item).
4. **ملخص المبيعات** (sales summary within settlement) — إجمالي الفواتير (invoice count/total), المرتجعات (returns), صافي المبيعات (net sales), مبيعات آجلة (on-account/credit sales).
5. Status: جارية (Ongoing) → مسواة (Settled); side ملغاة (Cancelled).
6. Reporting: **مبيعات الڤان** (Van Sales report, `/reports/sales/van`) computes gross profit and cash variance per trip/rep/van from the GL postings of linked documents.

### Hire-to-pay (من التوظيف إلى صرف الراتب)
1. **الموظفون** (Employees, `/hr/employees/new`) — personal info, معلومات التوظيف (department, job title, direct manager, branch, hire date, worker category, overtime/standard-hours inheritance, probation end date, prior-service years for Egyptian Labor Law Article 47 seniority calc), attendance biometric/selfie clock-in toggles.
2. **العقود** (Contracts, `/hr/contracts`, "عقد جديد") — contract type (غير محدد المدة/indefinite, محدد المدة/fixed-term, موسمي/seasonal, تجريبي/probationary), pay basis/frequency, monthly salary + currency, leave-entitlement overrides, allowances/deductions line items.
3. **الحضور والانصراف** (Attendance, `/hr/attendance`) — monthly calendar grid per employee, status codes P/A/H/L/HO/— (present/absent/half-day/on-leave/public-holiday/weekly-off), feeding payroll's day-count basis.
4. **طلبات الإجازات** (Leave Requests, `/hr/leave/requests/new`) → approval cycle (بانتظار الموافقة → موافق عليه/مرفوض), presumably routed through the 9 granular leave-type approval gates in `/settings/workflow`.
5. **استحقاقات الإجازات** (Leave Accrual Batches, `/hr/leave/batches`, "تشغيل استحقاق الآن") — manually or scheduler-triggered run that credits eligible employees' leave balances and explicitly posts a journal entry (قيد محاسبي) updating balances immediately.
6. **سلف الموظفين** (Employee Advances, `/hr/advances`, "طلب سلفة") — في انتظار الاعتماد (Pending approval) → معتمدة (Approved) → مصروفة (Disbursed) → مسددة (Repaid); explicitly booked as a debt/asset on the employee (not an expense unless written off), repaid via payroll installment deductions.
7. **الرواتب** (Payroll, `/hr/payroll`, "تشغيل رواتب جديد") — create a run scoped to سنة/شهر (year/month); progresses مسودة → محتسب → معتمد → مصروف (side: ملغى), pulling contracts, attendance, advances, allowances/deductions to compute pay and disbursing/posting to Accounting.

### Go-live data migration flow (نقل البيانات — onboarding import wizard)
Ordered, dependency-aware 12/13-step wizard at `/settings/data-migration` (the in-app numbering visually repeats "٩" for two steps — a likely display bug), each step offering a downloadable Excel/CSV template + an import action:
1. **الأقسام** (Departments) — employees need a department; department needs a system-required code.
2. **الموظفين** (Employees) — salaries are NOT in this file; registered later via the contract.
3. **حسابات الخزينة** (Treasury accounts) — cash drawers/bank accounts; an opening balance here posts a real journal entry.
4. **الموردون** (Suppliers) — before items, since items can reference a preferred supplier; outstanding balances are NOT set here.
5. **العملاء** (Customers) — independent step; balances are derived later from imported historical invoices (steps 10/11).
6. **الأصناف** (Items) — after suppliers; categories/brands auto-created if missing.
7. **وحدات الأصناف** (Item units) — after items; secondary units (carton/box/dozen) with a conversion factor each.
8. **تصنيفات الأصول** (Asset categories) — before fixed assets, since category determines default asset/depreciation GL accounts.
9. **الأصول الثابتة** (Fixed assets) — after treasury and suppliers (an asset purchase posts a journal entry needing one or the other); legacy assets can be registered as رصيد افتتاحي (opening balance) needing neither.
10. **فواتير المبيعات السابقة** (Historical sales invoices) — last-tier; a fully-collected invoice archives with no journal entry, a partially-collected one posts the remaining amount as customer debt; **inventory is not affected**.
11. **مرتجعات المبيعات السابقة** (Historical sales returns) — must follow invoices immediately (each return line inherits its invoice line's price/tax/accounts); inventory not affected.
12. **فواتير المشتريات السابقة** (Historical purchase invoices) — mirrors step 10 for the purchase side; inventory not affected.
13. **مرتجعات المشتريات السابقة** (Historical purchase returns) — mirrors step 11 for the purchase side; inventory not affected.
Explicit scope boundary: physical-count import and stock-transfer import are deliberately NOT part of this onboarding wizard — those live inside the day-to-day الجرد الفعلي (Physical Counts) sheet and تحويلات المخزون (Transfers) screen themselves.

---

## Part D — Business rules worth surfacing

- **Credit control (الرقابة الائتمانية)**: تفعيل الرقابة الائتمانية (enable, tenant-toggleable, `creditControlEnabled`) gates a وضع الرقابة (control mode) of **تحذير فقط (WARNING)** — shows an alert when a customer exceeds their credit limit but still lets the invoice through — versus a full-block mode ("منع تام: يمنع إنشاء الفاتورة" — hard-blocks invoice creation). Default demo tenant mode: warning-only.
- **Procurement strictness gates (التحكم في المشتريات)**: three independently-toggleable gates, all OFF by default in the demo tenant except the last: يجب وجود أمر شراء قبل استلام البضاعة (require a confirmed PO before a GRN can be created, `requirePoForGrn`); يجب وجود استلام بضاعة قبل فاتورة الشراء (require a confirmed GRN before a purchase invoice can be created, `requireGrnForInvoice`); تتبع البضاعة المستهلكة من فواتير الشراء (`trackSoldPurchaseItems`, **ON by default**) — blocks cancelling a purchase invoice if any of its goods have since been sold, transferred, or consumed (the **sold-item cancellation guard**).
- **Cash negative-balance hard block vs. bank overdraft**: منع الرصيد السالب للحسابات النقدية is **ON** and applies only to نقدي (cash-drawer) treasury accounts — any voucher/transfer that would push a cash account below zero is hard-blocked ("لأن درج النقدية لا يمكن أن يكون سالباً" — a cash drawer can't be negative). حسابات بنكية (bank accounts) are explicitly exempted and may carry a negative balance / overdraft (`allowNegativeTreasury: true` governs banks specifically) — an important account-type-aware distinction.
- **Inventory negative-stock policy**: السماح بالمخزون السالب (`allowNegativeStock`) is **OFF** by default — blocks confirming sales, POS sales, purchase returns, and POS-refund-cancellation if it would drop stock below zero. السماح بالطلبات المؤجلة (allow backorders, `allowBackorder`) is also **OFF** — a sales invoice cannot be confirmed with unavailable items recorded as a deferred/back-order.
- **Cross-warehouse sales visibility**: السماح بالبيع من مستودع آخر (`allowCrossWarehouseSales`) and عرض المخزون في المستودعات الأخرى (`showOtherWarehouseStock`) are both **ON** by default — when the invoice's own warehouse is short, the system allows fulfilling from another warehouse and surfaces a badge showing quantities available elsewhere while adding line items.
- **WAC drift tolerance**: `wacDriftTolerance` = **0.01 (1%)**, `wacDriftAlertThreshold` = 0 (alerting effectively off while the 1% tolerance still governs auto-adjustment behavior), `wacAutoRebuildOnDrift` = false — none of these three fields were found as an editable control on any settings tab; likely platform-managed rather than tenant-configurable (flagged as a gap in `09-settings-dashboard-ux.md`). The dedicated **انحراف تقييم المخزون** (Inventory Valuation Drift) report compares three independent costing sources (recomputed average, cache, cost layers) and flags per-item mismatches for review/rebuild.
- **FX-rate-missing policy**: سياسة غياب سعر الصرف is set to **صارم — رفض المستند إذا لم يوجد سعر صرف** (Strict — reject the document if no exchange rate exists, `fxRateMissingPolicy: STRICT`); paired with `fxResidualTolerance: 0.05` (5%) and `revaluationReversalMode: NEXT_DAY` — FX Revaluation entries auto-reverse the day after posting by default (see Part C, Month-end close).
- **Buyer-data ETA threshold — 25,000 EGP**: حد بيانات المشتري (ج.م) on `/accounting/eta`'s General tab, default **25,000 ج.م**, explicitly labeled "القيمة القانونية" (the legal value) — sales invoices at or above this amount legally require the individual buyer's الرقم القومي (national ID) for e-invoice compliance.
- **Aging-based inventory write-down (مخصص هبوط المخزون حسب التقادم)**: an optional (OFF by default) monthly automatic provisioning journal entry against slow-moving stock, posting to account 5060 (مخصص/provision) against account 1190 (مصروف/expense) as a contra-asset provision — explicitly does **not** touch the actual recorded inventory cost.
- **Depreciation proration — daily/IFRS**: إهلاك شهر الاقتناء (acquisition-month depreciation method) defaults to **يومي (نسبة الأيام) — IFRS** (`depreciationProrate: DAILY`) — the month an asset is acquired is depreciated proportionally by days owned rather than a full or zero month; total lifetime depreciation is unchanged, only its monthly distribution shifts.
- **Payroll day-divisor basis**: `payrollDayDivisorBasis: FIXED_30` — monthly salary is divided by a fixed 30-day basis (not the actual calendar days in the month) when deriving daily/hourly rates; paired with a default overtime multiplier of **1.5×** (معامل العمل الإضافي) and a standard **8-hour** workday (ساعات العمل اليومية القياسية).
- **POS discount-approval thresholds**: cashier auto-allowed up to **10% / 50 EGP** (whichever hit first), manager up to **30% / 500 EGP**, with a **5-minute** (`approvalExpiryMinutes: 5`) validity window on escalated requests before they auto-expire — see Part B for the full flow.
- **Tax-exempt customers skip tax entirely**: the إعفاء ضريبي (tax-exempt) toggle on the customer record (government bodies, non-profits, exports, free zones, diplomatic missions) suppresses tax on that customer's invoice lines and shows a tax-exempt banner on the invoice.
- **Sold-item cancellation guard** (repeated for emphasis, purchases side): with `trackSoldPurchaseItems` ON (the default), a purchase invoice cannot be cancelled once any of its received goods have been sold, transferred, or otherwise consumed downstream — prevents retroactively invalidating inventory that's already moved.
- **Platform-managed (not tenant-editable) feature toggles**: multi-currency (`accounting.multi_currency`), loyalty points program, and — per the settings-payload notes — likely WAC drift fields, are all shown in the UI as active/inactive read-only badges with the note **"تدار هذه الميزة من قبل مدير المنصة"** (managed by the platform admin), i.e. a platform-admin tier sits above tenant-admin for certain global capabilities.
- **Historical-data-import accounting rule**: fully-collected historical invoices/returns import with **no journal entry**; partially-collected ones post only the *remaining* balance as customer/supplier debt; in all cases **inventory is never affected** by historical-document imports (see Part C, go-live migration flow) — a deliberate accounting-only backfill design.
- **Approval-gate unconditionality**: workflow approval gates configured at `/settings/workflow` apply unconditionally to every instance of the gated action type (no amount/threshold condition field exists there) — contrast with the Notification Rules engine (which does support an optional condition field/operator/value) and the POS discount-approval mechanism (which has its own explicit amount/percent thresholds).
- **Employee advance accounting treatment**: an advance (سلفة) is booked as a debt/asset on the employee, not an expense, unless later written off ("السلفة دين على الموظف (أصل) — لا تحتسب مصروفاً إلا عند الشطب") — repaid via payroll installment deductions.
- **Batch/lot numbering default — manual, not auto**: توليد رقم الدفعة تلقائياً (auto-generate batch number) is **OFF** by default; manual entry is kept as the default specifically to preserve supplier batch-number traceability for pharma/food items.
- **Weekend days feed HR calculations**: أيام نهاية الأسبوع (weekend days, default Friday+Saturday, `weekendDays: [5,6]`) directly drives leave/attendance working-day math, not just a calendar display setting.
- **Numbering-sequence scale accommodation**: `POS_SALE` (مبيعة نقطة بيع) uses an 8-digit zero-padded sequence (`POS-00000001`) — the longest of all 25 document-type sequences — specifically to accommodate high POS transaction volume, versus 4–6 digits for every other document type.
