# CRM & HR Domains — Reference System Catalog

Captured: 2026-08-21 · Login: <redacted> / <redacted> (session pre-authenticated via storageState.json)
Tenant: "النور للتجارة والتوزيع" (demo company).

Data state at capture time: CRM (leads, opportunities, pipeline) is completely empty — zero leads, zero opportunities, zero pipeline stages populated with deals — only the 7 seeded pipeline stages exist. HR has exactly one seeded employee (أحمد محمود, EMP-0001, مسؤول مبيعات / مبيعات department), one contract (CTR-0001), and otherwise-empty holidays/leave-requests/payroll-runs/advances/leave-policies/leave-batches/shifts. This meant most "detail view" documentation below comes from create/edit dialogs and the one real employee record rather than a variety of populated rows.

## Screen inventory (in scope)

### CRM — إدارة علاقات العملاء
- العملاء المحتملون — Leads — `/crm/leads` (list, add dialog; list is empty — no detail view reachable)
- الفرص — Opportunities — `/crm/opportunities` (list, add dialog; list is empty — no detail view reachable)
- خط المبيعات — Sales Pipeline — `/crm/pipeline` (kanban board view + "stage list" view, add-opportunity entry point)
- مراحل خط المبيعات — Pipeline Stages — `/crm/pipeline-stages` (list/reorder, add dialog, edit dialog)
- إدارة علاقات العملاء — CRM Hub (domain landing page) — `/crm/hub` — **not linked from the sidebar nav**; added by verification pass.
- مهامي / الأنشطة — CRM Activities / My Tasks — `/crm/activities` — **not linked from the sidebar nav**, only from the CRM Hub's "تسجيل نشاط" quick action; added by verification pass; create-activity form itself still not captured (residual gap).

### HR — الموارد البشرية
- لوحة الموارد البشرية — HR Dashboard — `/hr/dashboard`
- الموظفون — Employees — `/hr/employees` (list, detail view, new-employee full-page form)
- الأقسام — Departments — `/hr/departments` (list, add dialog, edit dialog — no standalone detail page)
- المسميات الوظيفية — Job Titles — `/hr/job-titles` (list, add dialog, edit dialog — no standalone detail page)
- الحضور والانصراف — Attendance — `/hr/attendance` (monthly grid, per-employee monthly-summary dialog)
- الإجازات الرسمية — Public/Official Holidays — `/hr/holidays` (list by year, add dialog)
- العقود — Contracts — `/hr/contracts` (list, detail page, add dialog)
- طلبات الإجازات — Leave Requests — `/hr/leave/requests` (list, new full-page form)
- الرواتب — Payroll — `/hr/payroll` (list of payroll runs, new-run dialog)
- سلف الموظفين — Employee Advances — `/hr/advances` (list, new-advance dialog)
- سياسات الإجازات — Leave Policies — `/settings/leave-policies` (matrix table, "apply preset" dropdown)
- استحقاقات الإجازات — Leave Accrual Batches — `/hr/leave/batches` (list, "run now" dialog)
- إعدادات الوردية — Shift Settings — `/settings/shifts` (list, new-shift dialog) — reachable from Settings ▸ الهيكل التشغيلي nav group, not the HR nav group, but documented here per scope (shift definitions used by attendance/reporting)
- إجازاتي — My Leave (employee self-service) — `/hr/my-leave` — **not linked from the sidebar nav**; added by verification pass; gated behind "account linked to an employee record" for the demo admin account, so the request form itself couldn't be opened.

Not accessible / out of scope encountered while enumerating:
- No leads/opportunities detail page could be captured — both lists are empty (0 records) on this tenant, and no "view" affordance exists other than a row click on a data row.
- Departments and Job Titles have **no dedicated detail/profile page** — the only per-record views are the "تعديل" (Edit) dialog and a "تعطيل" (Deactivate) action from a row's `⋯` menu. This looks intentional (thin master-data entities), not a missing capture.
- رحلات المندوبين (Van/Rep Trips, `/field/van-trips`) appears in the CRM-adjacent dropdown position in the nav but belongs to a separate "المبيعات الميدانية" (Field Sales) module — out of scope, already noted in `01-sales.md`.
- التصنيع (Manufacturing) and نقاط البيع (POS) nav groups sit adjacent to CRM/HR in the sidebar but are separate modules, out of scope here.

---

## CRM — إدارة علاقات العملاء

### العملاء المحتملون (Leads)
- **Route**: `/crm/leads`
- **Purpose**: Capture and qualify inbound/outbound prospects before they become sales opportunities.
- **List view**:
  - Header: "عميل محتمل جديد" (New lead) button.
  - Status summary pill row: الكل / جديد / مؤهل / محول (counts, all 0 on this tenant).
  - Search box (بحث).
  - "تصفية النتائج" (Filters) panel, expandable, with:
    - Status chips: الكل / جديد / تم التواصل / مؤهل / محول / خسارة / غير مؤهل (each with a count).
    - من تاريخ / إلى تاريخ (date range).
    - الحالة (status dropdown, default "الكل").
  - Columns: الرقم (#), الاسم (sortable), الشركة, المصدر, الحالة (sortable), القيمة المتوقعة (sortable), بواسطة/created-by (sortable), تاريخ الإنشاء (sortable), row-action column.
  - Empty state: "لا توجد بيانات" + "عميل محتمل جديد" button.
- **Detail/form view** — "عميل محتمل جديد" dialog (no detail page could be captured; list has 0 leads):
  - الاسم * (text, required)
  - الشركة (text)
  - البريد الإلكتروني (email)
  - الهاتف (phone with country-code selector; full ISO country list; default Egypt +20; placeholder `01xxxxxxxx`)
  - المصدر (dropdown, default "أخرى" — Source)
  - القيمة المتوقعة (number — expected value)
  - الاهتمام (text, placeholder "ما هو المنتج أو الخدمة محل الاهتمام؟" — product/service of interest)
  - ملاحظات (notes, textarea)
  - Actions: إلغاء / إضافة (not submitted — read-only pass)
- **Actions**: "عميل محتمل جديد" (create). No bulk actions, export, or print controls observed on the empty list.
- **Workflows/statuses**: جديد → تم التواصل → مؤهل → محول (converted to opportunity/customer), with خسارة (lost) and غير مؤهل (unqualified) as terminal/alternate states — inferred from the filter-chip set, since no lead exists to trace an actual transition.
- **API observed**:
  - `GET /api/crm/leads` (list)
  - `GET /api/crm/leads/counts`
- **Notes**: "محول" (converted) status implies a lead→opportunity or lead→customer conversion action exists somewhere in the UI, but with an empty list no lead detail/conversion screen could be reached to confirm the mechanism.

---

### الفرص (Opportunities)
- **Route**: `/crm/opportunities`
- **Purpose**: Track sales deals in progress against a customer, with an expected close date/value and pipeline stage.
- **List view**:
  - Header: "فرصة جديدة" (New opportunity) button.
  - Summary pill row: الإجمالي / مفتوحة / مكسوبة (counts, all 0).
  - Search box (بحث...).
  - Filters panel: الكل / مفتوحة / مكسوبة / خسارة chips; من تاريخ / إلى تاريخ; الحالة dropdown (default الكل).
  - Columns: # , العنوان (sortable), العميل, المرحلة (stage), الاحتمالية (probability), القيمة المتوقعة (sortable), تاريخ الإغلاق المتوقع (sortable), الحالة (sortable), row-action column.
  - Empty state: "لا توجد بيانات" + "فرصة جديدة" button.
- **Detail/form view** — "فرصة جديدة" dialog (no detail page reachable; list has 0 opportunities):
  - العنوان * (text, required — title)
  - العميل * (search/select, required — customer, backed by `sales/customers/search`)
  - المرحلة * (search/select, required — pipeline stage, "اختر المرحلة...")
  - القيمة المتوقعة (number — expected value)
  - الاحتمالية % (number, default 50 — probability)
  - تاريخ الإغلاق المتوقع (date — expected close date)
  - ملاحظات (notes)
  - Actions: إلغاء / إضافة
- **Actions**: "فرصة جديدة" (create). No bulk/export/print controls observed.
- **Workflows/statuses**: مفتوحة (open) → مكسوبة (won) or خسارة (lost), status chips مطابقة for the stage's "type" (win/loss/open) set on مراحل خط المبيعات.
- **API observed**:
  - `GET /api/crm/opportunities` (list)
  - `GET /api/crm/opportunities/counts`
  - `GET /api/crm/opportunities/pipeline` (pipeline board data)
  - `GET /api/crm/pipeline-stages` (stage options for the dialog's المرحلة select)
  - `GET /api/sales/customers/search` (customer search-select)
- **Notes**: The "فرصة جديدة" button on the Pipeline board (`/crm/pipeline`) actually navigates to `/crm/opportunities` (full-page loading transition observed) rather than opening an in-place dialog — likely routes to the same create flow as this screen's dialog, just via a full navigation instead of a modal.

---

### خط المبيعات (Sales Pipeline)
- **Route**: `/crm/pipeline`
- **Purpose**: Kanban-style visual view of open opportunities grouped by pipeline stage, for pipeline management and stale-deal tracking.
- **List view** (kanban board, default view):
  - Header: "إضافة فرصة" (Add opportunity) button.
  - KPI strip (as one combined summary + expandable breakdown): إجمالي الفرص (total opportunities), القيمة المتوقعة (expected value), فرص راكدة (stale opportunities), فرص مكسوبة (won opportunities), قيمة المكسوب (won value).
  - "تصفية النتائج" (Filters) panel: العميل (customer search "كل العملاء"), القيمة من/إلى (value range), checkbox "الراكدة فقط" (stale only).
  - View toggle: "عرض مراحل" (stage-list view) vs. "عرض كلوحة" (kanban/board view — default).
  - Kanban columns = the 7 seeded pipeline stages, each showing a count badge and "لا توجد فرص" (no opportunities) empty state per column: عميل محتمل (0), تواصل أولي (0), عرض سعر (0), تفاوض (0), مراجعة نهائية (0), تم الإغلاق (0), plus a separate خسارة (Lost) column/bucket shown apart from the main flow.
  - Stage-list view (عرض مراحل): same filters, but stages render as vertical sections instead of side-by-side columns; empty-state per stage reads "لا توجد فرص في هذه المرحلة — انقل فرصة إلى هذه المرحلة أو أضف فرصة جديدة لتبدأ المتابعة" (move an opportunity here, or add a new one).
- **Detail/form view**: no dedicated form; "إضافة فرصة" navigates to the same opportunity-create flow as `/crm/opportunities` (see above) rather than opening its own dialog.
- **Actions**: إضافة فرصة (add opportunity — navigates away), stage-view/board-view toggle, filter panel.
- **Workflows/statuses**: Implicitly drag-and-drop between stage columns (standard kanban pattern); not exercised (read-only pass) so drag behavior wasn't confirmed.
- **API observed**:
  - `GET /api/crm/opportunities/pipeline`
  - `GET /api/crm/pipeline-stages`
  - `GET /api/branches`, `GET /api/warehouses` (global chrome, not pipeline-specific)
- **Notes**: This is a read/visualization surface over the same opportunity data as `/crm/opportunities`; it doesn't appear to have its own persistence beyond stage placement.

---

### مراحل خط المبيعات (Pipeline Stages)
- **Route**: `/crm/pipeline-stages`
- **Purpose**: Configure the ordered list of pipeline stages, each stage's default win-probability %, color, and whether it's a "win" or "loss" terminal stage.
- **List view**:
  - Header: "إضافة مرحلة" (Add stage) button; subtitle explains purpose ("حدد مراحل رحلة المبيعات وترتيبها واحتمالية الإغلاق في كل مرحلة").
  - Summary strip: إجمالي المراحل (7), مراحل نشطة (7), مرحلة الفوز (تم الإغلاق), مرحلة الخسارة (خسارة).
  - Table columns: الترتيب (order #), الاسم, الاحتمالية الافتراضية (default probability %), النوع (type — "مفتوحة" / "مرحلة فوز" / "مرحلة خسارة"), الحالة (نشطة/غير نشطة), إجراءات (row actions: إلى أعلى / إلى أسفل reorder arrows, تعديل edit, حذف delete).
  - Seeded stages (order, name, probability, type):
    1. عميل محتمل — 10% — مفتوحة
    2. تواصل أولي — 20% — مفتوحة
    3. عرض سعر — 40% — مفتوحة
    4. تفاوض — 60% — مفتوحة
    5. مراجعة نهائية — 80% — مفتوحة
    6. تم الإغلاق — 100% — مرحلة فوز (win)
    7. خسارة — 0% — مرحلة خسارة (loss)
- **Detail/form view** — "إضافة مرحلة" / "تعديل مرحلة" dialog:
  - الاسم * (text, required)
  - الاحتمالية الافتراضية (%) (number, default 50 on create)
  - اللون (color — hex text input + swatch, default `#3b82f6`)
  - نوع المرحلة (helper text: "اترك الخيارين فارغين للمراحل المفتوحة. مرحلة الفوز واحدة فقط لكل عميل." — leave both unchecked for an open stage; only one win-stage allowed):
    - مرحلة فوز (checkbox — win stage)
    - مرحلة خسارة (checkbox — loss stage)
  - نشطة (checkbox, edit-mode only, checked by default — active toggle)
  - Actions: إلغاء / إضافة (create) or حفظ التعديلات (save changes, edit)
- **Actions**: إضافة مرحلة, تعديل (edit), حذف (delete), إلى أعلى/إلى أسفل (manual reorder, up/down arrows — first stage's "up" and last stage's "down" are disabled).
- **Workflows/statuses**: نشطة / غير نشطة (active/inactive) per stage; exactly one stage may be flagged مرحلة فوز.
- **API observed**:
  - `GET /api/crm/pipeline-stages`
- **Notes**: This screen is the single source of truth for the stage set used by both `/crm/opportunities` (المرحلة select) and `/crm/pipeline` (kanban columns).

---

### إدارة علاقات العملاء (CRM Hub / Domain Landing Page) — added by verification pass
- **Route**: `/crm/hub` — a real, fully-rendered route not linked from the sidebar (the "إدارة علاقات العملاء" sidebar entry only toggles its submenu open, no `/url`). Found by extracting route-literal strings from the production JS bundle and test-navigating; every domain in the app has one of these at `/{module}/hub` (see `01-sales.md`'s Sales Hub entry for the full write-up of the pattern).
- **Purpose**: Domain dashboard/launcher — "إدارة العملاء المحتملين والفرص والأنشطة".
- **List view** (tile/dashboard layout):
  - "إجراءات سريعة" quick-create row: عميل محتمل جديد (New lead), فرصة جديدة (New opportunity), تسجيل نشاط (Log an activity — this is the entry point into `/crm/activities`, documented as its own screen immediately below, which was itself missed by the original CRM pass).
  - "مناطق العمل" tile grid: خط المبيعات (Pipeline — link only, no count), الفرص (N فرص مفتوحة), العملاء المحتملون (N إجمالي العملاء المحتملين), مهامي (N مهام معلقة — links to `/crm/activities`, labelled "مهامي" here vs. "الأنشطة" on the screen's own header, an inconsistent label worth flagging), مراحل خط المبيعات (link only), نظرة 360 على العميل (Customer 360 view — cross-links into the Sales Customers "المزيد → نظرة 360°" action documented in `01-sales.md`), نظرة 360 على المورد (Supplier 360 view — same pattern for `/purchases/suppliers/:id/360`, cross-domain into Purchases).
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above, plus the two 360°-view tiles which are generic customer/supplier detail aggregations (not independently captured in this pass; already noted as an action under Sales Customers).
- **Actions**: Three quick-create shortcuts; tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls plus per-tile counts for opportunities, leads, activities (not individually isolated in this pass).
- **Notes**: This hub is how "تسجيل نشاط" (log an activity) and the standalone Activities/My-Tasks screen were discovered — neither is reachable from the CRM sidebar submenu, only from this hub. See `01-sales.md`'s Sales Hub entry for the full discussion of why this whole class of screen was missed by the original recon.

---

### مهامي / الأنشطة (CRM Activities / My Tasks) — added by verification pass
- **Route**: `/crm/activities` — reachable only via the CRM Hub's "تسجيل نشاط" quick action or "مهامي" tile (see above); no sidebar entry.
- **Purpose**: A personal task/activity log for CRM follow-ups (calls, meetings, to-dos) tied to leads/opportunities — the "activity" side of CRM that the Leads/Opportunities screens reference (e.g. "activity subject" columns) but that lives on its own dedicated list here.
- **List view**:
  - Breadcrumb reads "مهامي" (My Tasks) even though the page header reads "الأنشطة" (Activities) — same inconsistent labelling noted from the hub tile above.
  - KPI strip: الإجمالي (Total), معلق (Pending), متأخر (Overdue), مكتمل (Completed) — all 0 in this tenant.
  - Filter chips (with counts): الكل (All), معلق (Pending), مكتمل (Completed), ملغى (Cancelled) — all 0.
  - Additional filters: النوع (Type, dropdown "الكل"), من تاريخ / إلى تاريخ (date range).
  - Columns: crm.activitySubject (subject — rendered as a raw, untranslated i18n key rather than an Arabic column header, an i18n bug worth flagging alongside the `customers.openingBalance` key-leak already noted in `02-purchases.md`), النوع (Type), الحالة (Status), التاريخ (Date), الاستحقاق (Due).
  - Empty state: "لا توجد أنشطة" (No activities).
- **Detail/form view**: Not reachable — zero records exist in this tenant (consistent with CRM's empty-tenant state noted throughout this file) and no explicit "new activity" button was found on this list itself (the create entry point is the CRM Hub's "تسجيل نشاط" quick action, which was not opened in this pass — flagged as a residual gap in `10-verification.md`).
- **Actions**: (inferred from the hub's quick-action, not opened in this pass) create a new activity/task from `/crm/hub`.
- **Workflows/statuses**: معلق (Pending) → مكتمل (Completed); ملغى (Cancelled) side state — from the filter-chip vocabulary, not observed live (0 records).
- **API observed**: `GET /api/crm/activities/my-tasks?status=PENDING&page=1&limit=25`, `GET /api/crm/activities/my-tasks/counts`.
- **Notes**: This screen — along with its create dialog — is a genuine residual gap even after this verification pass: the list/empty-state and column layout are captured, but the create-activity form itself was not opened (it lives behind the Hub's quick-action button, one click further than this pass reached). Flagged in `10-verification.md` for a follow-up capture.

---

## HR — الموارد البشرية

### لوحة الموارد البشرية (HR Dashboard)
- **Route**: `/hr/dashboard`
- **Purpose**: At-a-glance HR KPIs — headcount, attendance, overtime, leave consumption, and upcoming-expiry alerts.
- **List view**: N/A (dashboard, no table of records other than the small "leave consumption" summary table).
- **Detail/form view**:
  - KPI tiles: الموظفون النشطون (active employees = 1), في إجازة (on leave = 0), التعيينات هذا الشهر (hires this month = 0), إنهاء الخدمة هذا الشهر (terminations this month = 1 — note: shows 1 despite only 1 active employee existing, likely stale seed data), معدل الغياب (absence rate = 66.7%, labeled "الشهر الحالي"), حالات التأخر (lateness incidents = 0), ساعات الإضافي (overtime hours = 0).
  - Chart: "الموظفون حسب القسم" (employees by department, bar/donut — مبيعات only).
  - Chart: "الموظفون حسب الفرع" (employees by branch — الفرع الرئيسي only).
  - Chart: "تطور الرواتب (آخر 6 أشهر)" (payroll trend, last 6 months) — empty ("لا توجد بيانات رواتب مدفوعة بعد").
  - Table: "استهلاك الإجازات" (leave consumption) — columns نوع الإجازة, المستحق (entitled), المستخدم (used), قيد الانتظار (pending), % — rows for إجازة سنوية and إجازة مرضية, all zero/dash on this tenant.
  - "التنبيهات" (Alerts) section: عقود تنتهي خلال 30 يوما (contracts expiring within 30 days = 0), انتهاء الفترة التجريبية قريباً (probation ending soon = 0), موظفون بدون حضور هذا الأسبوع (employees with no attendance this week = 0) — each a clickable filter chip.
- **Actions**: none beyond the alert chips (presumably deep-link to filtered employee/contract views).
- **Workflows/statuses**: N/A.
- **API observed**:
  - `GET /api/hr/dashboard`
- **Notes**: Entry point/breadcrumb root for all other HR screens (breadcrumb "لوحة الموارد البشرية" appears on every HR sub-page).

---

### الموظفون (Employees)
- **Route**: `/hr/employees` (list), `/hr/employees/{id}` (detail), `/hr/employees/new` (create — full page, not a dialog)
- **Purpose**: Central employee master record — personal info, job/department assignment, contract linkage, and hub for attendance/leave/payroll/advances per employee.
- **List view**:
  - Header: "إضافة موظف" (Add employee) button.
  - Summary strip: إجمالي الموظفين (1), الموظفون النشطون (1), في إجازة (0), موقوفون (0, suspended), المنتهية خدمتهم (0, terminated).
  - Search box (بحث), "تصفية النتائج" filter panel, status chips الكل/نشط, القسم (department) dropdown filter (default الكل).
  - Columns: اسم الموظف (name, avatar-initial + code + job title, sortable), القسم, الفرع (branch — opens in side panel), العقد (contract type badge, e.g. "غير محدد المدة" = indefinite), تاريخ التعيين (hire date, sortable), row-action column.
  - Pagination: "عرض 1 - 1 من 1", page-size selector (25 default).
  - Row click → navigates to the employee's full detail page (`/hr/employees/{id}`).
- **Detail/form view** (employee detail page, e.g. EMP-0001 أحمد محمود):
  - Header: avatar-initial, name, status pill (نشط), رقم الموظف (EMP-0001), تعديل (Edit) button, المزيد (More) menu.
  - Summary card row: المسمى الوظيفي, القسم, الفرع (opens branch in side panel), تاريخ التعيين, الراتب الأساسي, contract-type note (e.g. "غير محدد المدة").
  - Tabs: المعلومات الشخصية (Personal info — selected by default), العقد (Contract), الإجازات (Leaves), كشوف الرواتب (Payslips), سلف الموظفين (Advances), الحضور (Attendance), المرفقات (Attachments), السجل (Audit log).
  - المعلومات الشخصية tab fields: تاريخ الميلاد (birth date), الجنس (gender), نوع التوظيف (employment type — دوام كامل/full-time), تاريخ التعيين (hire date) — all shown as term/definition pairs.
  - "المزيد" menu: single action — إنهاء الخدمة (Terminate employment).
  - Quick-view side panel variant: clicking an employee name elsewhere (e.g. from a Contracts row) opens the same tabbed profile in a "لوحة جانبية" (side panel) with "فتح في صفحة كاملة" (open full page) and إغلاق (close) controls, instead of full navigation.
- **Create form** ("موظف جديد", full page, not modal):
  - Header actions: إلغاء / حفظ.
  - Section "المعلومات الشخصية":
    - الاسم الأول * / اسم العائلة * (first/last name, required)
    - الاسم الأول (عربي) / اسم العائلة (عربي) (Arabic first/last name)
    - البريد الإلكتروني, الهاتف, تاريخ الميلاد, رقم الهوية (national ID)
    - الجنس (dropdown, "اختر...")
    - الحالة الاجتماعية (marital status dropdown, "اختر...")
  - Section "معلومات التوظيف":
    - القسم * (search/select, "جميع الأقسام"; inline "+" quick-add "إضافة قسم")
    - المسمى الوظيفي * (search/select, disabled until القسم is chosen — "اختر القسم أولاً")
    - المدير المباشر (direct manager, search/select)
    - الفرع * (branch, search/select)
    - تاريخ التعيين * (hire date)
    - فئة العامل * (worker category dropdown, default "موظف")
    - نوع التوظيف (employment type dropdown, default "دوام كامل")
    - احتساب العمل الإضافي (overtime eligibility dropdown, default "حسب القسم" — inherits from department setting; helper text explains inheritance)
    - ساعات العمل القياسية (standard work hours, number, placeholder "حسب القسم / المنشأة" — inherits dept → company default of 8)
    - نهاية فترة التجربة (probation end date)
    - سنوات الخدمة السابقة (prior service years, number, default 0 — helper text ties this to Egyptian Labor Law Article 47 seniority bonus calc)
    - طلب صورة شخصية عند تسجيل الحضور (switch — require selfie at clock-in; helper text mentions cashiers/drivers/field workers)
    - طلب التحقق بالبصمة عند تسجيل الحضور (switch — require biometric/Face ID at clock-in, layered with selfie + geofencing)
  - Section "العنوان": الشارع, المدينة, المحافظة, الرمز البريدي (street/city/governorate/postal code)
  - Section "جهة الاتصال في حالات الطوارئ": الاسم, صلة القرابة (relationship), رقم الهاتف, رقم هاتف آخر (emergency contact name/relationship/phone/alt-phone)
- **Actions**: إضافة موظف (create, full page), تعديل (edit), إنهاء الخدمة (terminate, via المزيد menu).
- **Workflows/statuses**: نشط / في إجازة / موقوف / منتهية خدمته (active / on leave / suspended / terminated) per the list's summary-strip categories.
- **API observed**:
  - `GET /api/hr/employees` (list)
  - `GET /api/hr/employees/search`
  - `GET /api/hr/employees/stats`
  - `GET /api/hr/employees/{id}` (detail)
  - `GET /api/hr/employees/{id}/contracts`
  - `GET /api/hr/departments`, `GET /api/hr/job-titles` (dropdown sources on create form)
  - `GET /api/branches`, `GET /api/branches/select`
- **Notes**: Employee is the hub record — its detail-page tabs surface العقد/الإجازات/كشوف الرواتب/سلف الموظفين/الحضور, meaning most other HR screens (Contracts, Leave Requests, Payroll, Advances, Attendance) are really employee-scoped sub-resources presented as their own top-level list screens too.

---

### الأقسام (Departments)
- **Route**: `/hr/departments`
- **Purpose**: Department master data — code, manager, overtime policy default, and standard work-hours default, used by Employees and reporting.
- **List view**:
  - Header: "إضافة قسم" (Add department) button.
  - Summary strip: إجمالي الأقسام (1), نشط (1), غير نشط (0), إجمالي الموظفين (1).
  - Search box, status chips الكل/نشط/غير نشط.
  - Columns: كود القسم (code, sortable), اسم القسم (name, sortable), المدير (manager, sortable), الموظفون (headcount, sortable), الحالة (sortable), row-action column (`⋯` menu).
  - Seeded row: SALES / مبيعات / لا توجد (no manager) / 1 employee / نشط.
- **Detail/form view**: **no standalone detail page** — only a row `⋯` menu with تعديل (Edit) and تعطيل (Deactivate). "تعديل القسم" dialog fields:
  - اسم القسم * (text, required)
  - اسم القسم (عربي) (Arabic name)
  - القسم الأب (parent department, search/select, default "بدون قسم أب" — no parent)
  - المدير (manager, search/select, default "بدون مدير" — no manager)
  - احتساب العمل الإضافي (switch, checked by default — overtime eligibility for dept's employees, overridable per-employee)
  - ساعات العمل القياسية (standard work hours, number, placeholder "حسب المنشأة" — inherits company default of 8, overridable per-employee)
  - نشط (switch, edit-mode only — active toggle)
  - Create dialog additionally has كود القسم * (department code, required, create-only — not editable after creation, consistent with it being absent from the edit dialog).
  - Actions: إلغاء / إضافة (create) or حفظ التعديلات (edit)
- **Actions**: إضافة قسم, تعديل, تعطيل (deactivate) via row menu.
- **Workflows/statuses**: نشط / غير نشط (active/inactive) only.
- **API observed**:
  - `GET /api/hr/departments`
  - `GET /api/hr/departments/counts`
- **Notes**: Supports a self-referencing parent-department hierarchy (القسم الأب) though only one flat department exists on this tenant to confirm nesting behavior.

---

### المسميات الوظيفية (Job Titles)
- **Route**: `/hr/job-titles`
- **Purpose**: Job-title master data scoped to a department, used on the Employee create/edit form.
- **List view**:
  - Header: "إضافة مسمى وظيفي" (Add job title) button.
  - Summary strip: إجمالي المسميات (1), نشط (1), غير نشط (0).
  - Search box, status chips الكل/نشط/غير نشط.
  - Columns: اسم المسمى الوظيفي (sortable), القسم, الموظفون (headcount), الحالة, row-action column.
  - Seeded row: مسؤول مبيعات (Sales Officer) / مبيعات / 1 employee / نشط.
- **Detail/form view**: **no standalone detail page** — same pattern as Departments, only row `⋯` menu → تعديل / تعطيل. "تعديل المسمى الوظيفي" dialog fields:
  - القسم * (department select — disabled/locked in edit mode, shows current department)
  - اسم المسمى الوظيفي * (text, required)
  - الاسم (عربي) (Arabic name)
  - نشط (switch, edit-mode only)
  - Create dialog: القسم * is an editable search/select (placeholder "اختر القسم") rather than locked.
  - Actions: إلغاء / إضافة (create) or حفظ التعديلات (edit)
- **Actions**: إضافة مسمى وظيفي, تعديل, تعطيل via row menu.
- **Workflows/statuses**: نشط / غير نشط only.
- **API observed**:
  - `GET /api/hr/job-titles`
  - `GET /api/hr/job-titles/counts`
- **Notes**: Job titles are strictly department-scoped (one department per title), matching the Employee form's dependent-dropdown behavior (المسمى الوظيفي disabled until القسم is picked).

---

### الحضور والانصراف (Attendance)
- **Route**: `/hr/attendance`
- **Purpose**: Monthly attendance grid across all employees — one row per employee, one column per day of the selected month — plus a per-employee monthly summary.
- **List view** (calendar-grid, not a conventional table):
  - Month navigator (◀ أغسطس ٢٠٢٦ ▶).
  - Search box (ابحث باسم الموظف أو الرقم...), "تصفية النتائج" (filters), القسم (department) dropdown (default "جميع الأقسام").
  - Legend: P=حاضر (present), A=غائب (absent), H=نصف يوم (half day), L=في إجازة (on leave), HO=إجازة رسمية (public holiday), —=إجازة أسبوعية (weekly off), تأخير (late, highlighted), عمل إضافي (overtime, highlighted), A(dashed)=غياب محتمل بدون تسجيل (probable unrecorded absence).
  - Grid: row = employee name + "عرض الملخص الشهري" (view monthly summary) button; columns = day-of-month 1–31, each cell a status code, some clickable (e.g. "+" cells for adding an entry, "A" cells clickable to drill in).
  - Seeded data: أحمد محمود shows a repeating pattern of A (absent) weekdays and — (weekly off) on what are presumably Fridays/Saturdays, with "+" placeholders on some upcoming days.
- **Detail/form view** — "الملخص الشهري للحضور" (Monthly Attendance Summary) dialog, opened via the "عرض الملخص الشهري" row button:
  - KPI tiles: أيام العمل (working days = 22), أيام الحضور (days present = 0), أيام الغياب (days absent = 10), أنصاف الأيام (half days = 0), ساعات إضافية (overtime hours = 0س), نسبة الحضور (attendance rate = 0%).
  - "تفاصيل الأيام" (day details) list — one line per flagged day, e.g. "20/08/2026 غائب" (absent), listing the 10 absent days for the seeded employee.
- **Actions**: month navigation, per-cell entry (+ cells, likely opens a clock-in/status-edit control — not opened, to stay read-only), عرض الملخص الشهري (view monthly summary).
- **Workflows/statuses**: P/A/H/L/HO/— status codes per day as listed in the legend above.
- **API observed**:
  - `GET /api/hr/attendance`
  - `GET /api/hr/attendance/summary`
- **Notes**: This is the only HR screen using a calendar/grid layout rather than the standard list+filters+table pattern seen everywhere else in the app.

---

### الإجازات الرسمية (Official/Public Holidays)
- **Route**: `/hr/holidays`
- **Purpose**: Company-wide public holiday calendar, used to exclude holidays from attendance/leave-day calculations.
- **List view**:
  - Header: "إضافة إجازة" (Add holiday) button.
  - Summary strip: إجمالي الإجازات (0), سنوية (0, recurring/annual), لمرة واحدة (0, one-time).
  - Year tabs: 2025 / 2026 (0) / 2027.
  - النوع (type) filter dropdown (default الكل).
  - Columns: التاريخ (date, sortable), الاسم (name, sortable), النوع (type, sortable), row-action column.
  - Empty state (2026): "لا توجد إجازات رسمية لهذا العام" + "إضافة إجازة" button.
- **Detail/form view** — "إضافة إجازة" dialog:
  - التاريخ * (date, required)
  - الاسم بالإنجليزية * (English name, required, placeholder "National Day")
  - الاسم بالعربية (Arabic name, placeholder "اليوم الوطني")
  - إجازة سنوية متكررة (switch — recurring annual holiday, i.e. repeats every year on the same date)
  - Actions: إلغاء / إضافة
- **Actions**: إضافة إجازة (create). No edit/delete affordance was visible on the empty list (would appear per-row once data exists, per the row-action column header).
- **Workflows/statuses**: سنوية (recurring) vs. لمرة واحدة (one-time), set via the "إجازة سنوية متكررة" switch.
- **API observed**:
  - `GET /api/hr/holidays`
  - `GET /api/hr/holidays/month`
- **Notes**: Year-scoped (separate 2025/2026/2027 tabs) rather than a flat all-years list.

---

### العقود (Contracts)
- **Route**: `/hr/contracts` (list), `/hr/contracts/{id}` (detail)
- **Purpose**: Formal employment contract per employee — pay basis/frequency, salary, currency, leave entitlement overrides, allowances and deductions.
- **List view**:
  - Header: "إضافة عقد" (Add contract) button.
  - Summary strip: إجمالي العقود (1), عقود سارية (1, active), قريبة الانتهاء (0, expiring soon), مفسوخ (0, terminated).
  - Search box, status chips الكل/ساري, نوع العقد (contract type) dropdown filter (default الكل).
  - Columns: رقم العقد (contract #), اسم الموظف (opens employee side panel), نوع العقد, تاريخ البداية (start date), تاريخ الانتهاء (end date), الراتب الأساسي (base salary), row-action column.
  - Seeded row: CTR-0001 / أحمد محمود (EMP-0001) / غير محدد المدة (indefinite) / 2026-08-11 start / no end date / 14,000.00 ج.م.
  - Row click on the contract number navigates to the full contract detail page; clicking the employee name instead opens the employee quick-view side panel.
- **Detail/form view** (contract detail page, CTR-0001):
  - Header: رقم العقد (CTR-0001), إنهاء العقد (Terminate contract) button, المزيد (More) menu.
  - Summary fields: اسم الموظف (opens side panel), نوع العقد, الحالة (ساري/active), تاريخ البداية, تاريخ الانتهاء (— if indefinite), تكرار الدفع (شهري/monthly), الراتب الأساسي.
  - Tabs: بنود الأجر (Pay terms — selected by default), السجل (Audit log).
  - بنود الأجر tab: البدلات (allowances — "لا توجد بدلات" empty), الاستقطاعات (deductions — "لا توجد خصومات" empty), استحقاق الإجازات (leave entitlement) breakdown: الإجازة السنوية (annual = 0), إجازة مرضية (sick = 0), الإجازة الشخصية (personal = 0) — all zero, meaning this contract inherits from leave policy rather than overriding.
- **Create form** — "عقد جديد" dialog:
  - اسم الموظف * (employee search/select, required)
  - نوع العقد * (contract type dropdown, required): غير محدد المدة (indefinite, default) / محدد المدة (fixed-term) / موسمي (seasonal) / تجريبي (probationary)
  - أساس الدفع * (pay basis dropdown, required): راتب شهري (monthly, default) / بالساعة (hourly) / باليوم (daily)
  - تكرار الدفع * (pay frequency dropdown, required): شهري (monthly, default) / كل أسبوعين (biweekly) / أسبوعي (weekly)
  - تاريخ البداية * (start date, required)
  - تاريخ الانتهاء (end date — disabled with helper text "العقد غير محدد المدة لا يحتوي على تاريخ انتهاء" when type=indefinite)
  - الراتب الشهري * (monthly salary, required, helper text "إجمالي الراتب الشهري")
  - العملة * (currency dropdown, required, default EGP — same 11-currency list as Sales Customers: EGP/SAR/AED/QAR/KWD/BHD/OMR/JOD/USD/EUR/GBP)
  - استحقاق الإجازات (leave entitlement overrides, all optional number fields, helper text "اتركه فارغاً لاستخدام قيمة سياسة الإجازة"): الإجازة السنوية, إجازة مرضية, الإجازة الشخصية
  - البدلات (allowances) — "إضافة بدل" (add allowance) button, repeatable line items, empty by default
  - الاستقطاعات (deductions) — "إضافة استقطاع" (add deduction) button, repeatable line items, empty by default
  - Actions: إلغاء / حفظ
- **Actions**: إضافة عقد (create), إنهاء العقد (terminate, on detail page), المزيد menu (not expanded — read-only pass).
- **Workflows/statuses**: ساري (active) / قريب الانتهاء (expiring soon) / مفسوخ (terminated), per the list summary-strip categories.
- **API observed**:
  - `GET /api/hr/contracts` (list)
  - `GET /api/hr/contracts/counts`
  - `GET /api/hr/contracts/{id}` (detail)
  - `GET /api/hr/employees/{id}/contracts`
- **Notes**: Allowances/deductions and leave-entitlement overrides on the contract are the mechanism for per-employee pay/leave exceptions on top of department/company defaults and the leave-policy matrix.

---

### طلبات الإجازات (Leave Requests)
- **Route**: `/hr/leave/requests` (list), `/hr/leave/requests/new` (create — full page, not modal)
- **Purpose**: Employee leave request submission and approval tracking.
- **List view**:
  - Header: "طلب إجازة جديد" (New leave request) button.
  - Summary strip: الإجمالي (0), بانتظار الموافقة (0, pending approval), موافق عليه (0, approved), مرفوض (0, rejected), ملغى (0, cancelled).
  - Search box, filters panel: status chips الكل/بانتظار الموافقة/موافق عليه/مرفوض/ملغى, من تاريخ/إلى تاريخ, الحالة dropdown.
  - Columns: رقم الطلب (request #), اسم الموظف, نوع الإجازة (leave type), الفترة (period), عدد الأيام (day count), الحالة, row-action column.
  - Empty state: "لا توجد نتائج مطابقة للفلتر الحالي" (no results match current filter — implies the default filter may exclude some records, though the summary strip shows all-zero too).
- **Detail/form view** — "طلب إجازة جديد" (full page, not modal):
  - اسم الموظف * (employee search/select, required)
  - نوع الإجازة * (leave type dropdown, required — was stuck on "جار التحميل..." / loading in this capture, likely populated only after an employee is selected)
  - نصف يوم (switch — half day; helper text "حدد يوماً واحداً وسيتم احتساب نصف يوم (0.5)")
  - تاريخ البداية * / تاريخ النهاية * (start/end date, required)
  - السبب (reason, text)
  - Actions: إلغاء / إرسال الطلب (Submit request)
- **Actions**: طلب إجازة جديد (create/submit).
- **Workflows/statuses**: بانتظار الموافقة (pending) → موافق عليه (approved) / مرفوض (rejected), or ملغى (cancelled) — standard approval workflow, presumably tied into the global "الموافقات" (Approvals) module seen in the main nav.
- **API observed**:
  - `GET /api/hr/leave/requests` (list)
  - `GET /api/hr/leave/requests/counts`
- **Notes**: Leave type options are dynamically loaded per employee (likely constrained to that employee's leave policy / contract overrides) — could not be enumerated without a valid employee selection in this read-only pass.

---

### الرواتب (Payroll)
- **Route**: `/hr/payroll`
- **Purpose**: Monthly payroll run management — create a run for a period, then presumably calculate/approve/disburse (not explorable further without seed data).
- **List view**:
  - Header: "تشغيل رواتب جديد" (New payroll run) button.
  - Summary strip: إجمالي عمليات التشغيل (0, total runs), إجمالي رواتب السنة (0.00 ج.م, total payroll this year), صافي رواتب السنة (0.00 ج.م, net payroll this year), الصافي المصروف هذا العام (0.00 ج.م, net disbursed this year).
  - Search box, filters panel: status chips الكل/مسودة/محتسب/معتمد/مصروف/ملغى, الفترة (period) text filter.
  - Columns: رقم التشغيل (run #), الفترة (period), موظفين (employee count), إجمالي الراتب (gross), صافي الراتب (net), row-action column.
  - Empty state: "لا توجد بيانات" + "تشغيل رواتب جديد" button.
- **Detail/form view** — "تشغيل رواتب جديد" dialog:
  - السنة * (year dropdown, default 2026)
  - الشهر * (month dropdown, default أغسطس/August)
  - Actions: إلغاء / إنشاء (Create)
- **Actions**: تشغيل رواتب جديد (create run).
- **Workflows/statuses**: مسودة (draft) → محتسب (calculated) → معتمد (approved) → مصروف (disbursed), or ملغى (cancelled) — 5-state run lifecycle per the filter chips.
- **API observed**:
  - `GET /api/hr/payroll/runs`
  - `GET /api/hr/payroll/runs/counts`
- **Notes**: The create dialog is minimal (just year/month) — the actual calculation (pulling contracts, attendance, advances, allowances/deductions) presumably happens after run creation, not explorable further since creating a run is a mutating action excluded by the read-only rule.

---

### سلف الموظفين (Employee Advances)
- **Route**: `/hr/advances`
- **Purpose**: Track cash advances given to employees against future salary, repaid via installments deducted from payroll.
- **List view**:
  - Header: "طلب سلفة" (Request advance) button.
  - Summary strip: الإجمالي (0), في انتظار الاعتماد (0, pending approval), مصروفة (0, disbursed), مسددة (0, repaid).
  - Search box (ابحث برقم السلفة أو اسم الموظف), status chips الكل/في انتظار الاعتماد/معتمدة/مصروفة/مسددة.
  - Columns: رقم السلفة (advance #), الموظف, المبلغ (amount), المتبقي (remaining), الأقساط (installments), الحالة, row-action column.
  - Empty state: "لا توجد سلف — ابدأ بتسجيل طلب سلفة لموظف" + "طلب سلفة" button.
- **Detail/form view** — "طلب سلفة" dialog:
  - Helper note: "السلفة دين على الموظف (أصل) — لا تحتسب مصروفاً إلا عند الشطب" (an advance is a debt/asset on the employee, not an expense unless written off).
  - الموظف * (employee search/select, required)
  - المبلغ * (amount, required)
  - عدد الأقساط * (installment count, required, default 3)
  - أول خصم * (first-deduction date, required, defaulted to today 2026-08-21)
  - السبب (reason, text)
  - Actions: إلغاء / إضافة
- **Actions**: طلب سلفة (request/create).
- **Workflows/statuses**: في انتظار الاعتماد (pending approval) → معتمدة (approved) → مصروفة (disbursed) → مسددة (repaid) — 4-state lifecycle per filter chips.
- **API observed**:
  - `GET /api/hr/advances`
  - `GET /api/hr/advances/counts`
- **Notes**: Explicitly accounted as a balance-sheet asset/debt rather than an expense — ties into Payroll (installment deductions) and Accounting (write-off handling) per the helper text.

---

### سياسات الإجازات (Leave Policies)
- **Route**: `/settings/leave-policies`
- **Purpose**: Company-wide leave-type policy matrix (entitlement, accrual, carryover, termination payout, legal-mandate flag) — defaults used by contracts/leave requests unless overridden.
- **List view**:
  - "اختر إعداداً..." (Choose a preset) dropdown + "تطبيق إعداد جاهز" (Apply preset) button, disabled until a preset is chosen.
  - Preset dropdown options: "مصر — قانون 12 لسنة 2003" (Egypt Labor Law 12/2003), "مصر — قانون 14 لسنة 2025" (Egypt Labor Law 14/2025), "تخصيص يدوي" (Manual customization).
  - Table columns: نوع الإجازة (leave type), الرصيد الأساسي (base balance), وتيرة الاستحقاق (accrual frequency), الترحيل (carryover), صرف عند الإنهاء (payout on termination), إجباري قانوناً (legally mandatory), row-action column.
  - Empty state: "لا توجد سياسات إجازات معدة حالياً. استخدم \"تطبيق إعداد جاهز\" للبدء بسرعة، أو قم بتخصيص السياسات من خلال تعديل كل صف بشكل مستقل." (no policies configured yet — use a preset to start quickly, or customize each row independently).
- **Detail/form view**: not reachable in this pass — no policy rows exist to open an edit form for, and applying a preset (mutating) was out of scope for read-only capture.
- **Actions**: تطبيق إعداد جاهز (apply preset — disabled until a preset is selected).
- **Workflows/statuses**: N/A (configuration screen, not a document workflow).
- **API observed**:
  - `GET /api/hr/leave-policies`
  - `GET /api/hr/leave-policies/presets`
- **Notes**: Offering two dated Egyptian Labor Law presets (12/2003 vs. 14/2025) suggests the newer law is a recent/anticipated legal change the product is tracking. Lives under `/settings/` rather than `/hr/` in the URL despite being HR nav-grouped.

---

### استحقاقات الإجازات (Leave Accrual Batches)
- **Route**: `/hr/leave/batches`
- **Purpose**: History and manual trigger of leave-accrual runs (periodic jobs that credit employees' leave balances per the leave policy).
- **List view**:
  - Header: "تشغيل استحقاق الآن" (Run accrual now) button, plus a "المزيد" (More) button.
  - Filter tabs: الكل / مجدول (scheduled) / يدوي (manual).
  - Columns: تاريخ التشغيل (run date), نوع التشغيل (run type), ملاحظات (notes), عدد الموظفين (employee count), إجمالي الأيام (total days), القيمة الإجمالية (total value), المنفذ (executed by), row-action column.
  - Empty state: "لا توجد دورات استحقاق بعد — ستظهر هنا كل دورات الاستحقاق المجدولة واليدوية" (no accrual batches yet; scheduled and manual batches will appear here) + "تشغيل استحقاق الآن" button.
- **Detail/form view** — "تشغيل استحقاق الآن" dialog:
  - Helper text: "تشغيل دورة استحقاق الإجازات يدوياً لكل الموظفين المؤهلين. يحرر قيد محاسبي وتحدث الأرصدة فوراً" (manually runs the leave-accrual cycle for all eligible employees; posts a journal entry and updates balances immediately).
  - تاريخ التشغيل * (run date, required, defaulted to today 2026-08-21)
  - Actions: إلغاء / إضافة
- **Actions**: تشغيل استحقاق الآن (run now), المزيد (unexplored — likely scheduling config).
- **Workflows/statuses**: مجدول (scheduled) vs. يدوي (manual) run types.
- **API observed**:
  - `GET /api/hr/leave/batches`
- **Notes**: Explicitly posts a journal entry (قيد محاسبي) on run — direct Accounting-module linkage, consistent with how سلف الموظفين and الرواتب are described as accounting-relevant elsewhere.

---

### إعدادات الوردية (Shift Settings)
- **Route**: `/settings/shifts`
- **Purpose**: Define named shift time-windows (optionally per branch), used to bucket sales/attendance reporting by shift.
- **List view**:
  - Header: "وردية جديدة" (New shift) button; subtitle: "عرف فترات الورديات؛ تستخدمها التقارير لتوزيع المبيعات والحركات حسب الوردية" (define shift periods; used by reports to distribute sales and transactions by shift).
  - Columns: اسم الوردية (shift name), الفترة (time period), الفرع (branch), الحالة (status), row-action column.
  - Empty state: "لا توجد ورديات — أضف وردية لتوزيع التقارير حسب الفترات" + "وردية جديدة" button.
- **Detail/form view** — "وردية جديدة" dialog:
  - اسم الوردية * (text, required, placeholder "مثال: الوردية الصباحية" — e.g. Morning Shift)
  - الاسم بالعربية (Arabic name)
  - من * / إلى * (start/end time, required, defaulted 08:00–16:00)
  - الفرع (branch search/select, default "كل الفروع" — all branches; helper text: leave blank to apply to all branches)
  - نشط (checkbox, checked by default)
  - Actions: إلغاء / إضافة
- **Actions**: وردية جديدة (create).
- **Workflows/statuses**: نشط / غير نشط only.
- **API observed**:
  - `GET /api/shifts`
- **Notes**: Lives entirely under Settings ▸ الهيكل التشغيلي (Operational Structure) in the nav, not under الموارد البشرية — included here because it directly feeds attendance/HR reporting, per the task's stated HR scope ("shifts").

---

### إجازاتي (My Leave — Employee Self-Service) — added by verification pass
- **Route**: `/hr/my-leave` — reachable via breadcrumb from `/hr/dashboard` but **not present as its own sidebar link**; found by bundle route extraction and confirmed live. Distinct from the admin-facing `/hr/leave/requests` (Leave Requests) list documented above — this is the logged-in user's *own* self-service leave view.
- **Purpose**: Lets any logged-in user (not just HR admins) request leave and see their own leave-request history, without going through the HR admin list.
- **List view**: Header "إجازاتي". Table columns: نوع الإجازة (Leave type), الفترة (Period), عدد الأيام (Days), الحالة (Status). "طلب إجازة" (Request Leave) button. Empty state observed: "لا توجد طلبات إجازة" / "لم تقدم أي طلب إجازة بعد" (no leave requests / you haven't submitted a leave request yet).
- **Detail/form view**: **Not reachable in this pass** — the logged-in demo admin account (يوسف محمد) is itself not linked to an HR employee record. Navigating this screen surfaced a dedicated gate state instead of the list: "غير مرتبط بموظف — حسابك غير مرتبط بسجل موظف. تواصل مع المسؤول" (Not linked to an employee — your account isn't linked to an employee record; contact the admin). This is a genuine, tenant-data-shaped blind spot (distinct from the "0 records" empty-tenant pattern seen elsewhere in this file): the "طلب إجازة" request form cannot be opened at all under this account, only inferred to exist from the button's presence in the unauthenticated-state DOM before the gate resolved.
- **Actions**: طلب إجازة (Request leave) — present but effectively disabled/gated for this account.
- **Workflows/statuses**: Presumably mirrors `/hr/leave/requests`' معلق/موافق عليه/مرفوض (Pending/Approved/Rejected) cycle — not confirmed live.
- **API observed**: `GET /api/hr/leave/requests/me?page=1&limit=25` (one console error was also observed on this route, consistent with the employee-link gate failing a secondary data fetch — not investigated further).
- **Notes**: This is a **user-linked-to-employee-record precondition**, not a missing-seed-data problem — even a from-scratch demo tenant with an employee-linked test account would surface this screen fully. Flagged in `10-verification.md` as a fixable-with-different-test-account gap, not a hard blind spot.

---

## Cross-cutting observations

- **Empty-tenant caveat**: Because CRM has zero records and most HR sub-screens have zero-to-one record, almost every "detail view" in this capture is either the one real employee/contract or a create/edit dialog's field layout, not a variety of real documents in different states. Status-machine transitions (lead qualification, opportunity win/loss, leave approval, payroll run progression, advance repayment) are inferred from filter-chip label sets, not observed in action.
- **Department/Job-Title pattern**: both are "thin" master-data lists with edit-dialog-only record management (no detail page) — worth confirming with the product team whether this is deliberate simplicity or a gap versus e.g. Sales' Customers/Suppliers which do have full detail pages.
- **Accounting linkage**: three HR actions explicitly call out journal-entry/accounting effects in their own UI copy — سلف الموظفين (advance is a debt asset, expensed only on write-off), استحقاقات الإجازات (accrual run posts a journal entry), and by implication الرواتب (payroll run, though its own dialog didn't state it directly).
- **Egyptian Labor Law awareness**: multiple fields cite specific law articles/versions directly in help text — سنوات الخدمة السابقة (Article 47 seniority bonus) on the Employee form, and the leave-policy presets naming "قانون 12 لسنة 2003" vs. "قانون 14 لسنة 2025" — indicating the product is purpose-built for Egyptian labor compliance, not a generic i18n'd HR module.
- **Consistent CRM ↔ Sales integration point**: the Opportunity create dialog's العميل field is backed by the same `sales/customers/search` endpoint used in `/sales/*`, and the Contract create dialog's currency list is byte-identical to the one documented for Sales Customers in `01-sales.md` — confirming a shared customer/currency master across Sales and CRM.
