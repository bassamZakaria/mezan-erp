# Manufacturing, Projects, Fixed Assets & Field Sales — Reference System Catalog

> **Archived 2026-08-29 — a record, not current state.** Read `../../ROADMAP.md` for what is
> built and open, and `../../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `../README.md` in the archive root maps them.


Captured: 2026-08-21 · Login: <redacted> / <redacted> (session pre-authenticated via shared `storageState.json`)
Tenant: "النور للتجارة والتوزيع" (demo company).

## Screen inventory (in scope)

**التصنيع — Manufacturing**
- لوحة الإنتاج — Production Dashboard — `/manufacturing/dashboard`
- أوامر التصنيع (أوامر العمل) — Work Orders — `/manufacturing/work-orders` (list, new, detail)
- قوائم المواد — Bills of Materials (BOMs) — `/manufacturing/boms` (list, new, detail)
- التصنيع المخصص (أوامر التصنيع المخصص) — Custom Manufacturing Orders / Config Instances — `/manufacturing/config-instances` (list, new, detail)
- المنتجات القابلة للتهيئة — Configurable Products — `/manufacturing/configurable-products` (list, new, edit) — nav item lives under the **Inventory** sidebar group, not Manufacturing (see Notes)
- التصنيع مقابل الشراء — Make vs Buy report — `/reports/manufacturing/make-vs-buy`

**المشاريع — Projects**
- المشاريع والمقاولات — Projects & Contracting — `/projects` (list, new dialog; tenant has 0 projects, so no detail view was reachable)

**الأصول — Fixed Assets**
- سجل الأصول — Asset Register — `/assets/list` (list, new)
- الإهلاك (عمليات الإهلاك) — Depreciation Runs — `/assets/depreciation`
- تصنيفات الأصول — Asset Categories — `/assets/categories` (list, new)
- الأصول الثابتة — Assets Hub (domain landing page) — `/assets/hub` — **not linked from the sidebar nav**; inferred to exist from a breadcrumb in the original pass, confirmed and fully captured by verification pass.

**المبيعات الميدانية — Field Sales (documented briefly per scope note)**
- رحلات المندوبين — Van/Rep Trips — `/field/van-trips` (list, detail, "open trip" form) — reachable from the Sales nav dropdown, own module "المبيعات الميدانية"

Out of scope but adjacent, noted only: مبيعات الڤان (Van Sales report, `/reports/sales/van`) is a Sales report referencing van-trip data — belongs to the Sales/Reports domain, not documented here.

---

### لوحة الإنتاج (Production Dashboard — Manufacturing overview)
- **Route**: `/manufacturing/dashboard`
- **Purpose**: Operational cockpit for the shop floor — surfaces work orders that are overdue or need an action right now (issue materials, receive product, complete) without hunting through the full work-order list.
- **List view**: Not a list — a dashboard with:
  - "يحتاج انتباه" (needs attention) banner: count of overdue work orders.
  - KPI strip: أوامر العمل النشطة (active work orders), إجمالي قيمة الإنتاج تحت التشغيل (WIP value), الوحدات المنتجة هذا الشهر (units produced this month), متوسط التكلفة للوحدة (avg cost/unit).
  - "ما يحتاج تنفيذاً الآن" (needs action now) — three buckets of actionable order chips, each grouped by required next step: بانتظار صرف المواد (awaiting material issue), بانتظار استلام المنتج (awaiting product receipt), جاهز للإكمال (ready to complete) — each chip shows WO#, product, progress fraction/%.
  - "أوامر العمل النشطة" table: رقم أمر العمل, المنتج النهائي, التقدم (progress fraction + %), الأولوية, نهاية مجدولة (+ "متأخر" badge), action button matching the order's current required step.
- **Detail/form view**: N/A (dashboard only; clicking a WO row/chip routes into the work order detail).
- **Actions**: Per-row action buttons (صرف المواد / استلام المنتج / إكمال أمر العمل) that deep-link into the relevant work-order step.
- **Workflows/statuses**: Reflects work-order stage machine (see أوامر التصنيع below).
- **API observed**: `GET /api/manufacturing/dashboard`, plus common chrome calls (`/api/auth/me`, `/api/status/summary`, `/api/branches`, `/api/warehouses`, `/api/warehouses/select`, `/api/notifications`, `/api/notifications/unread-count`, `/api/workflow/pending`, `/api/workflow/my-rejected`, `/api/banners/active`).
- **Notes**: Single-purpose exception/action dashboard, not a general reporting page (no filters/date range).

---

### أوامر التصنيع (Work Orders)
- **Route**: `/manufacturing/work-orders` (list), `/manufacturing/work-orders/new` (create), `/manufacturing/work-orders/{id}` (detail)
- **Purpose**: Plan and execute discrete production runs against a BOM — issue raw materials, track WIP cost, receive the finished product into stock.
- **List view**:
  - Header: "أمر عمل جديد" (New work order) button.
  - "تحتاج متابعة" banner: N overdue work orders, deep-links to a pre-filtered "متأخر" view.
  - KPI strip (button-styled, click to filter): الإجمالي, مخطط (planned), جار التنفيذ (in progress), مكتمل هذا الشهر (completed this month).
  - Status filter chips with counts: الكل / مخطط / جار التنفيذ / مكتمل / ملغي / متأخر (derived overdue flag, not a real status).
  - Search: بحث في أوامر العمل. Filters panel ("تصفية النتائج"): المستودع (warehouse), الأولوية (priority combobox, default الكل), المنتج النهائي (final product search), الكمية المخططة (من/إلى), الكمية المنتجة (من/إلى), تاريخ الانتهاء المجدول (من/إلى).
  - Columns: أوامر العمل (product name + WO#, opens quick-view for the **product**, not the WO — see Notes), الكمية المخططة, الإنتاج (produced/planned fraction), تاريخ الانتهاء المجدول (+ "متأخر" badge), الأولوية, الحالة, بواسطة (created-by, opens side panel), row kebab menu.
  - Pagination: "عرض 1 - N من N", 25/page default.
- **Detail/form view** (New Work Order — `/manufacturing/work-orders/new`), numbered wizard sections on one page:
  1. اختيار قالب التصنيع: قائمة المواد * (BOM picker, search).
  2. خطة الإنتاج: الكمية المخططة * (qty spinner), الأولوية (combobox, default عادية).
  3. المستودعات: مستودع المواد الخام * (raw-material source warehouse), مستودع المنتجات * (finished-goods destination warehouse).
  4. الجدولة: تاريخ البدء المجدول *, تاريخ الانتهاء المجدول *, ملاحظات.
  - Action: "إنشاء أمر العمل" (Create work order).
- **Detail view** (existing WO, e.g. WO-0001):
  - Header: "WO-0001 قيد التنفيذ" + status; buttons "صفحة التنفيذ" (execution page) and "صرف المواد" (issue materials, contextual to current stage) + kebab menu.
  - Summary fields: الكمية المخططة, الكمية المنتجة, مستودع المواد الخام, مستودع المنتجات, تاريخ الانتهاء المجدول (+ متأخر flag), قائمة المواد (BOM version used), الأولوية, المنتج النهائي (+ progress), المرحلة الحالية (current stage, e.g. "تم البدء — بانتظار صرف المواد"), الخطوة التالية (next step hint).
  - Stage tracker (4 steps): بدء العمل → صرف المواد → استلام المنتج → إكمال أمر العمل.
  - "إجراءات إضافية" (additional actions) card: تسجيل تكلفة (log cost, enabled), صرف إضافي / إرجاع مواد / تسجيل فاقد (extra issue / return materials / log waste — all disabled until later stage).
  - "تأثيرات أمر التصنيع" (effects) explainer: material stock decreases on issue; cost accumulates during production; finished product is not in stock until receipt.
  - Tabs: المواد (materials, table cols: الصنف, الكمية المطلوبة, الكمية المتاحة, الكمية الصادرة, الكمية المرجعة, الصافي, النقص), التكاليف, استخدام المواد, حركة المواد, الاستلامات, القيود المحاسبية, السجل.
- **Actions**: List row kebab menu → عرض (View), تكرار أمر التصنيع (Duplicate), إلغاء أمر التصنيع (Cancel). Detail page → صفحة التنفيذ, صرف المواد, تسجيل تكلفة, صرف إضافي, إرجاع مواد, تسجيل فاقد.
- **Workflows/statuses**: مخطط (Planned, 0 seen) → قيد التنفيذ (In progress) → مكتمل (Completed); ملغي (Cancelled, 0 seen); متأخر (Overdue) is a derived date flag layered on any active status. Within "قيد التنفيذ" there's a finer sub-stage machine: بدء العمل → صرف المواد → استلام المنتج → إكمال أمر العمل — matching the dashboard's action buckets.
- **API observed**:
  - `GET /api/manufacturing/work-orders` (list; also used for counts client-side)
  - `GET /api/manufacturing/work-orders/{id}`
  - `GET /api/manufacturing/work-orders/{id}/costs`
  - `GET /api/inventory/items/search`, `GET /api/inventory/recipes` (BOM picker in new-WO form)
  - `GET /api/inventory/items/{id}/uoms`, `GET /api/inventory/items/{id}`, `GET /api/inventory/items/{id}/cost-layers`, `GET /api/inventory/stock/by-warehouse`
  - `GET /api/warehouses`, `GET /api/warehouses/select`, `GET /api/branches`, `GET /api/branches/select`
- **Notes**: On the list, clicking the product-name cell opens the **item's** quick-view side panel (`صنف` dialog with only a "فتح في صفحة كاملة" link to the item page), not a work-order side panel — to reach the WO detail page you must use the row's kebab menu → عرض. This is a UX inconsistency worth flagging (every other module's row click opens that row's own record).

---

### قوائم المواد (Bills of Materials — BOMs)
- **Route**: `/manufacturing/boms` (list), `/manufacturing/boms/new` (create), `/manufacturing/boms/{id}` (detail)
- **Purpose**: Define the recipe (raw materials + quantities + waste %) and standard cost for a finished product, versioned; the source template a Work Order is built from.
- **List view**:
  - Header: "قائمة مواد جديدة" (New BOM) button.
  - KPI strip: الإجمالي, نشط, غير نشط.
  - Status filter chips: الكل / نشط / غير نشط. Search: بحث بالرقم أو اسم المنتج.
  - Columns: رقم القائمة, المنتج النهائي, الإصدار (version, e.g. vV1/vV2), عدد البنود (line count), التكلفة التقديرية (estimated cost), الحالة, بواسطة, kebab menu.
  - Same product can have multiple BOM rows across versions (e.g. ice tea has vV1 غير نشط and vV2 نشط) — versioning replaces rather than mutates.
- **Detail/form view** (New BOM — "إنشاء قائمة مواد"):
  - "ما الذي نصنعه؟": المنتج النهائي * (search), الكمية القياسية * (standard batch qty, default 1, unit shown e.g. PCS), ملاحظات الإصدار (release/version notes).
  - "تكلفة التقدير": تكلفة العمالة التقديرية, تكلفة المصاريف التقديرية (both spinners, default 0).
  - "بنود المواد الخام" (raw material lines) table: المادة الخام * (search), الكمية *, الوحدة (auto from item), نسبة الهالك (waste %, default 0), اختياري (checkbox — optional material), ملاحظات; "إضافة بند" (add line) button top and bottom.
  - Action: حفظ (Save).
- **Detail view** (existing BOM, e.g. BOM-0003 "منتج مخصص — 1 × 1"):
  - Header: product name + status pill (نشط), BOM number, "أمر عمل جديد" (New work order, deep-links to WO creation with this BOM) button.
  - Summary fields: الاسم, الرقم, الإصدار, الكمية القياسية, عدد البنود, تاريخ الإنشاء, إجمالي التكلفة (+ per-unit cost), hoverable cost breakdown badge (تكلفة المواد + تكلفة العمالة + تكاليف أخرى = إجمالي التكلفة).
  - Tabs: بنود المواد الخام (line table: الصنف, الكمية المطلوبة, الوحدة, نسبة الهالك, الكمية الفعلية بعد الهالك, تكلفة الوحدة التقديرية, إجمالي البند; footer row إجمالي تكلفة المواد), سجل الإصدارات (version history), سجل التدقيق (audit log).
- **Actions**: Row kebab → عرض, أمر عمل جديد, إصدار جديد (new version), تعطيل (deactivate).
- **Workflows/statuses**: نشط / غير نشط only (activation state, not a document workflow); creating a new version appears to supersede the prior version's active flag (observed ice tea vV1=غير نشط, vV2=نشط).
- **API observed**:
  - `GET /api/manufacturing/boms`, `GET /api/manufacturing/boms/counts`
  - `GET /api/manufacturing/boms/{id}`, `GET /api/manufacturing/boms/{id}/cost-estimate` (called per-row on the list to show التكلفة التقديرية column)
- **Notes**: Waste % (نسبة الهالك) is modeled per BOM line and flows into "الكمية الفعلية (بعد الهالك)" — required quantity is automatically grossed up for expected material loss.

---

### التصنيع المخصص (Custom Manufacturing Orders / Config Instances)
- **Route**: `/manufacturing/config-instances` (list), `/manufacturing/config-instances/new` (create), `/manufacturing/config-instances/{id}` (detail)
- **Purpose**: One-off make-to-order production for a configurable product — customer picks parameters (e.g. width/height), the system computes required materials and price from formulas, and the order can spin off a linked Work Order.
- **List view**:
  - Header: "أمر تصنيع مخصص جديد" (New custom manufacturing order) button.
  - KPI strip: الإجمالي, مهيأة (configured, 0), في التنفيذ (in progress), مغلقة (closed, 0), ملغاة (cancelled, 0).
  - Status filter chips + search: بحث برقم الأمر أو المنتج أو العميل.
  - Columns: رقم الأمر (CM-xxxxxx), المنتج, المواصفات (spec string, e.g. "height=1|width=1"), العميل (or "بدون عميل"), الكمية, سعر البيع (للوحدة), الحالة, kebab menu.
  - All 3 seen rows show status "تم الإنتاج" (produced) despite the KPI بucket showing them under "في التنفيذ" — i.e. تم الإنتاج is a sub-state of the "في التنفيذ" bucket, not a separate top-level status.
- **Detail/form view** (New order — "أمر تصنيع مخصص جديد"):
  - "المواصفات": المنتج * (configurable-product picker), الكمية * (default 1), سعر البيع (للوحدة) (optional, else computed from pricing formula), العميل (default بدون عميل), ملاحظات.
  - "معاينة الاحتياجات والتكلفة" (materials/cost preview) — populates live once a product + spec values are chosen (placeholder text seen: "أنشئ أمرًا جديدًا باختيار منتج قابل للتهيئة وإدخال المواصفات").
  - Action: حفظ.
- **Detail view** (existing order, e.g. CM-000001):
  - Header: CM number + status "تم الإنتاج"; "إغلاق الأمر" (Close order) button.
  - Fields: المنتج (e.g. "منتج جديد (FATMA-TEST)"), العميل, التاريخ, الكمية, المواصفات (e.g. "width= 12"), أمر التشغيل (linked WO — button, e.g. "WO-0007"), إجمالي البيع, التكلفة الفعلية, هامش الربح (profit margin — negative in the captured sample, "‎-713.00 ج.م").
  - Tabs: الخامات المطلوبة (required materials — line table: الصنف, الكمية (للوحدة), نسبة الهالك %, الإجمالي), التكلفة الفعلية (actual cost), السجل (log).
- **Actions**: Row kebab → عرض, أمر التشغيل (jump to the linked work order). Detail → إغلاق الأمر.
- **Workflows/statuses**: مهيأة (Configured) → في التنفيذ (In progress, includes تم الإنتاج sub-state) → مغلقة (Closed); ملغاة (Cancelled) as a side branch.
- **API observed**:
  - `GET /api/manufacturing/config-instances`, `GET /api/manufacturing/config-instances/counts`
  - `GET /api/manufacturing/config-instances/{id}`
  - `GET /api/manufacturing/work-orders/{id}/costs` (linked WO cost pulled into the detail view)
- **Notes**: This is the make-to-order/configurable-product execution layer that pairs with المنتجات القابلة للتهيئة below — the configurable product defines the formulas, a config instance is one customer order against those formulas, and it can auto-generate a linked Work Order (أمر التشغيل).

---

### المنتجات القابلة للتهيئة (Configurable Products)
- **Route**: `/manufacturing/configurable-products` (list), `/manufacturing/configurable-products/new` (create), `/manufacturing/configurable-products/{id}/edit` (edit)
- **Purpose**: Define a "template" product whose materials, quantities, and price are computed from customer-entered parameters (e.g. width × height) via formulas — the master data consumed by التصنيع المخصص orders.
- **List view**:
  - Header: "إضافة منتج قابل للتهيئة" (Add configurable product) button.
  - KPI strip: الإجمالي, نشط, غير نشط. Status chips + search: بحث بالكود أو الاسم.
  - Columns: الكود, الاسم, مدخلات التهيئة (config input names, e.g. "العرض، الطول"), خامات التصنيع (material-formula count), وحدة المنتج النهائي, عدد الأوامر (order count), الحالة, action ("أمر تصنيع مخصص جديد" quick-create button + kebab).
- **Detail/form view** (Add/Edit form):
  - Header block: نوع المنتج (product type, combobox — only value seen: "تصنيع وبيع (منتج مخصص)" = manufacture-and-sell/custom product), الكود *, الاسم *, التسمية بالعربية, وحدة المنتج النهائي (combobox, default قطعة PCS), الوصف.
  - "مدخلات التهيئة *" (configuration inputs, repeatable rows) — "إضافة مدخل" (add input): المعرف (للمعادلات) * (formula variable id, e.g. `width`), التسمية * (display label, e.g. "العرض"), التسمية بالعربية, النوع (type, combobox — رقم/number seen), الحد الأدنى / الحد الأقصى (min/max).
  - "خامات التصنيع *" (manufacturing materials, repeatable rows) — "إضافة خامة" (add material): الصنف * (item picker), معادلة الكمية * (quantity formula referencing the config-input variables, e.g. `2*width` or `2*(width+height)/100`, with an "أدرج متغير" (insert variable) helper chip), نسبة الهالك % (waste %).
  - "التسعير" (pricing): طريقة التسعير (pricing method combobox: "بدون — سعر يدوي" manual price / "معادلة" formula), سياسة الأصناف (item policy: "صنف لكل أمر" one item per order / "صنف لكل مواصفات" one item per spec-combination); when طريقة التسعير = معادلة, an additional معادلة السعر (للوحدة) * field appears (e.g. `width*height*rate`).
  - "التكلفة التقديرية" (estimated cost): معادلة تكلفة العمالة (للوحدة) (labor cost formula), معادلة التكاليف الإضافية (للوحدة) (overhead cost formula) — both free-text formula fields, seen populated as `2*width` in the edited example.
  - Action: حفظ (create) / حفظ التعديلات (edit).
- **Actions**: List quick action "أمر تصنيع مخصص جديد" (jump straight to creating a custom order for this product). Row kebab → تعديل (Edit), أوامر التصنيع المخصص (view its custom orders), تعطيل (Deactivate).
- **Workflows/statuses**: نشط / غير نشط (activation flag only).
- **API observed**:
  - `GET /api/manufacturing/configurable-products`, `GET /api/manufacturing/configurable-products/counts`
  - `GET /api/inventory/items/search` (material picker)
- **Notes**: **Information-architecture oddity** — this screen's nav link (`منتجات قابلة للتهيئة`) sits under the **المخزون (Inventory)** sidebar group, not under **التصنيع (Manufacturing)**, even though it is purely manufacturing/formula master data and is the direct upstream definition for التصنيع المخصص orders. A separate `inventory-configurable-product-detail.png` screenshot already exists in `catalog/img/` from Inventory-scope capture — likely the same screen captured independently under that module's scope; worth de-duplicating docs later. Formulas are plain math expressions referencing the defined variable ids — no visible validation/sandboxing shown in the read-only pass.

---

### التصنيع مقابل الشراء (Make vs Buy report)
- **Route**: `/reports/manufacturing/make-vs-buy`
- **Purpose**: Compares an item's cost to manufacture (from its BOM) against its cost to purchase from a supplier, and the resulting margin at the current sell price — decision-support for "make or buy."
- **List view** (report table, no create/detail):
  - Intro copy: "قارن تكلفة تصنيع الصنف مقابل شرائه من مورد، والربح الناتج عند سعر البيع الحالي — لتقرر: تصنع أم تشتري؟"
  - KPI strip: إجمالي التوفير (total savings from making vs. buying, in period), أصناف قابلة للمقارنة (items with both a make and buy cost — 0 in this tenant), أصناف مصنعة فقط (make-only items, 3 seen).
  - Filters: "تصفية النتائج", quick range buttons هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة, explicit من تاريخ / إلى تاريخ, التصنيف (category, "كل التصنيفات" default).
  - Columns: الصنف, التصنيع (make cost, qty × unit cost), الشراء (buy cost — shows "لا توجد بيانات" when no purchase price on record), سعر البيع (sell price), هامش التصنيع (make margin), هامش الشراء (buy margin — "لا توجد بيانات" if no buy cost), التوفير بالتصنيع (savings by making).
- **Detail/form view**: N/A — read-only report; clicking an item name opens the item's quick-view side panel.
- **Actions**: None beyond filtering.
- **Workflows/statuses**: N/A.
- **API observed**: `GET /api/reports/manufacturing/make-vs-buy`, `GET /api/inventory/categories`.
- **Notes**: In the demo tenant every item lacks a purchase price ("لا توجد بيانات" for الشراء/هامش الشراء/التوفير on all 3 rows), so the make-vs-buy comparison is effectively unexercised — the report structure is fully visible but its comparison math is untested by this data.

---

### المشاريع والمقاولات (Projects & Contracting)
- **Route**: `/projects` (list). No project existed in the tenant, so no `/projects/{id}` detail view was reachable in this read-only pass.
- **Purpose**: Track a project/contract's cost and billing — appears designed to link to a dedicated cost center (project code drives `PRJ-{code}` cost-center creation) for project costing and, per the module's tagline, invoicing per project.
- **List view**:
  - Header: "مشروع جديد" (New project) button.
  - KPI strip: إجمالي المشاريع (total), نشط (active), مخطط (planned), مكتمل (completed) — all 0.
  - Status filter chips: الكل / نشط / مخطط / متوقف مؤقتاً (on hold) / مكتمل / ملغي — all counts 0.
  - Search: "ابحث بالكود أو الاسم…".
  - Columns: كود المشروع, اسم المشروع, العميل, مدير المشروع, الميزانية, الحالة.
  - Empty state: "لا توجد مشاريع" / "أنشئ أول مشروع لبدء تتبع التكاليف والفوترة لكل مشروع" + "مشروع جديد" button.
- **Detail/form view** (New project dialog — "مشروع جديد"):
  - كود المشروع * (text, placeholder "TOWER-A"; helper text: "يستخدم لإنشاء مركز تكلفة المشروع (PRJ-الكود)" — auto-creates a linked cost center).
  - الحالة (status combobox, default مخطط).
  - اسم المشروع * , الاسم بالعربية.
  - العميل (search, default "بدون عميل"), مدير المشروع (search, default "بدون مدير").
  - تاريخ البدء, تاريخ الانتهاء (date fields).
  - الميزانية (EGP) (budget spinner, default 0).
  - عنوان الموقع (site address, text).
  - ملاحظات (notes, text).
  - Actions: إلغاء (Cancel) / حفظ (Save).
- **Actions**: List: مشروع جديد only (no rows exist to act on). Modal: إلغاء / حفظ.
- **Workflows/statuses**: مخطط (Planned, default) → نشط (Active) → مكتمل (Completed); متوقف مؤقتاً (On hold) and ملغي (Cancelled) as side branches — inferred from the filter-chip vocabulary since no records exist to observe transitions live.
- **API observed**: `GET /api/projects`, `GET /api/projects/counts`.
- **Notes**: This is the entire "المشاريع" (Projects) sidebar group — a single screen. No tasks list, no project detail/costing/billing tabs were observable since the tenant has zero project records; the create dialog is the only surface documenting the data model. The project-code → cost-center linkage (`PRJ-{code}`) is the clearest sign of how project costing is meant to integrate with مراكز التكلفة (Cost Centers) in Accounting.

---

### سجل الأصول (Asset Register)
- **Route**: `/assets/list` (list), `/assets/new` (create)
- **Purpose**: Central fixed-asset register — acquisition, categorization, and depreciation-method setup per asset; source of truth feeding عمليات الإهلاك (depreciation runs).
- **List view**:
  - Header actions: "تصنيفات الأصول" (Asset categories) + "تسجيل أصل" (Register asset).
  - KPI strip: إجمالي الأصول, نشط, تحت الصيانة (under maintenance), مهلك بالكامل (fully depreciated), تم التخلص (disposed) — all 0.
  - Status filter chips (all 0) + search: بحث في الأصول. Filters panel: الفرع (branch dropdown), التصنيف (category dropdown), من/إلى تاريخ (acquisition date range).
  - Columns: الأصل (asset), التصنيف, تاريخ الاقتناء (acquisition date), تكلفة الاقتناء (acquisition cost), القيمة الدفترية (book value), الحالة.
  - Empty state: "لا توجد أصول" / "لم يتم تسجيل أي أصول بعد" + "تسجيل أصل" button.
- **Detail/form view** (New asset — "تسجيل أصل"), sectioned single-page form:
  - "الهوية والتصنيف": logo/photo upload (disabled pre-save, "احفظ السجل أولاً لتحميل صورة" — save first to upload a photo), الاسم بالعربية * (placeholder "مثال: سيارة النقل الرئيسية"), اسم الأصل * (English name), التصنيف (category search), نطاق الأصل * (asset scope toggle: عام (general) / فرع (branch) / مستودع (warehouse) — selecting فرع reveals الفرع * with helper "أصل مرتبط بفرع محدد (مكتب، نقطة بيع، تجهيزات فرع)").
  - "الاقتناء": تاريخ الاقتناء *, تكلفة الاقتناء *, تاريخ بدء الإهلاك (defaults to acquisition date if left blank), طريقة الاقتناء * (acquisition method combobox).
  - "الإهلاك والقيمة": طريقة الإهلاك * (depreciation method, default "القسط الثابت (إهلاك ثابت)" = straight-line), العمر الإنتاجي (شهور) * (useful life in months, placeholder "e.g. 60"), القيمة المتبقية (salvage value).
  - Collapsible "الحسابات" (accounts — auto-populated from the asset's category, expandable to override) and "بيانات إضافية" (additional data) sections.
  - Action: حفظ (Save).
- **Actions**: List: تصنيفات الأصول, تسجيل أصل. No detail/edit view reachable (0 assets registered).
- **Workflows/statuses**: نشط (Active) → تحت الصيانة (Under maintenance) and/or مهلك بالكامل (Fully depreciated) → تم التخلص (Disposed) — inferred from filter-chip vocabulary; no live records to confirm transitions.
- **API observed**: `GET /api/assets`, `GET /api/assets/counts`, `GET /api/assets/categories`, `GET /api/branches/select`.
- **Notes**: Acquisition cost/date and depreciation method/useful-life are captured at registration time, meaning depreciation schedules are presumably derived, not separately configured — ties directly into عمليات الإهلاك below and into تصنيفات الأصول's "افتراضيات الإهلاك" (depreciation defaults), which pre-fill this form when a category is chosen.

---

### الإهلاك (Depreciation Runs)
- **Route**: `/assets/depreciation`
- **Purpose**: Period-based depreciation posting runs — batches that calculate and post depreciation expense across all eligible assets for a given month/branch.
- **List view**:
  - Empty-state banner (no depreciable assets registered): "لا توجد أصول مسجلة قابلة للإهلاك" / "سجل أصولاً أولاً لتتمكن من تشغيل الإهلاك" + "تسجيل أصل جديد" link → `/assets/new`.
  - KPI strip: إجمالي العمليات (total runs), مسودة (draft), مرحل (posted), ملغي (cancelled) — all 0.
  - Filters: بحث, "تصفية النتائج", السنة (year spinbutton, default 2026), الشهر (month spinbutton, 1–12).
  - Status chips: الكل / مسودة / مرحل / ملغي.
  - Columns: الفترة (period), الفرع, عدد الأصول (asset count), المبلغ الإجمالي (total amount), الحالة.
  - Empty state: "لا توجد عمليات إهلاك" / "لم يتم تشغيل أي إهلاك بعد".
- **Detail/form view**: No "run depreciation" trigger was visible/reachable in this read-only pass — the screen gates entirely on having at least one registered asset first (none exist in this tenant), so the run-creation form could not be captured. Likely reachable only once assets exist.
- **Actions**: "تسجيل أصل جديد" link (redirects to asset registration, out of this screen's own scope).
- **Workflows/statuses**: مسودة (Draft) → مرحل (Posted); ملغي (Cancelled) side branch — inferred from filter chips only.
- **API observed**: `GET /api/assets/depreciation/runs`, `GET /api/assets/depreciation/runs/counts`, `GET /api/assets`.
- **Notes**: Nav breadcrumb here reads "الأصول" → `/assets/hub` rather than "سجل الأصول" → `/assets/list` as seen on the other two asset screens — suggesting an `/assets/hub` landing page exists in the route tree that isn't directly linked from the sidebar (sidebar links go straight to list/depreciation/categories). **Update (verification pass)**: confirmed and fully captured — see "الأصول الثابتة (Assets Hub / Domain Landing Page)" section below.

---

### تصنيفات الأصول (Asset Categories)
- **Route**: `/assets/categories` (list), reached also via "تصنيفات الأصول" button on the asset register.
- **Purpose**: Defines default depreciation method/useful-life/salvage-% and default GL account mappings per asset category, so new assets in سجل الأصول can inherit sane defaults instead of being configured line-by-line.
- **List view**:
  - Header: "إضافة تصنيف" (Add category) button.
  - Filter chips: الكل / نشط / غير نشط (all 0). Search: "بحث بالتصنيف (الكود أو الاسم)...".
  - Columns: كود التصنيف, الاسم, طريقة الإهلاك الافتراضية (default depreciation method), العمر الإنتاجي الافتراضي (شهور) (default useful life in months), الحالة.
  - Empty state: "لا توجد بيانات" + "إضافة تصنيف" button.
- **Detail/form view** (New category — "إضافة تصنيف"):
  - "التعريف": كود التصنيف * (placeholder "FA-01"), الاسم بالعربية, اسم التصنيف *, الوصف, نشط (checkbox, checked by default).
  - "افتراضيات الإهلاك" (depreciation defaults, helper text: "تستخدم هذه القيم تلقائيا عند إنشاء أي أصل ينتمي لهذا التصنيف. يمكن تجاوزها لكل أصل على حدة."): طريقة الإهلاك الافتراضية (combobox), العمر الإنتاجي الافتراضي (شهور), نسبة القيمة المتبقية الافتراضية (%) (default salvage-value %).
  - "ربط الحسابات المحاسبية" (GL account mapping, helper text: "اختيار حسابات دفتر الأستاذ التي تسجل بها قيود الأصل خلال دورة حياته. القوائم مرشحة تلقائيا لإظهار الحسابات الصالحة فقط لكل دور."):
    - الاقتناء والإهلاك: كود حساب الأصل الافتراضي (placeholder "1500", helper "اتركه فارغاً لاستخدام الحساب الافتراضي: 1500 — الأصول الثابتة"), كود حساب مصروف الإهلاك الافتراضي (helper: default 5400 — إهلاك الأصول), كود حساب مجمع الإهلاك الافتراضي (helper: default 1590 — مجمع إهلاك الأصول).
    - بيع الأصل أو التخلص منه: كود حساب أرباح بيع الأصول الافتراضي (placeholder "4500"), كود حساب خسائر بيع الأصول الافتراضي (placeholder "5450").
  - Action: حفظ.
- **Actions**: إضافة تصنيف only (no rows exist to act on further).
- **Workflows/statuses**: نشط / غير نشط.
- **API observed**: `GET /api/assets/categories`, `GET /api/assets/categories/counts`, `GET /api/accounting/accounts/select` (account pickers in the new-category form).
- **Notes**: Every GL account field ships with a system default (visible as helper text) so the tenant can operate without configuring any category-level accounts — strong evidence of a pre-seeded chart-of-accounts convention (1500/5400/1590/4500/5450) baked into the fixed-assets module.

---

### الأصول الثابتة (Assets Hub / Domain Landing Page) — added by verification pass, confirms earlier inference
- **Route**: `/assets/hub` — this file's own Depreciation Runs section (above) already inferred this route existed from a breadcrumb reading "الأصول" → `/assets/hub`, but flagged it "not independently captured." This verification pass navigated it directly and confirms it's a real, fully-rendered route, not linked from the sidebar (the "الأصول" sidebar entry only toggles its submenu open, no `/url`). The same `/{module}/hub` pattern exists once per domain across the whole app (see `01-sales.md`'s Sales Hub entry for the full write-up).
- **Purpose**: Domain dashboard/launcher — "متابعة دورة حياة الأصول وعمليات الإهلاك".
- **List view** (tile/dashboard layout):
  - "بدء سريع" quick-create row: تسجيل أصل جديد (Register new asset), تشغيل دورة إهلاك (Run a depreciation cycle), إدارة التصنيفات (Manage categories).
  - "مناطق العمل" tile grid: سجل الأصول (N إجمالي, "عرض الأصول" — 0 in this tenant), الإهلاك ("عرض دورات الإهلاك"), تصنيفات الأصول ("عرض التصنيفات").
  - No recent-activity feed rendered — consistent with this tenant having 0 registered assets, 0 categories, and 0 depreciation runs (see the empty-tenant caveats on each of those screens above).
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above.
- **Actions**: Three quick-create shortcuts (not opened in this pass beyond what's already documented under سجل الأصول/الإهلاك/تصنيفات الأصول above); tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls plus per-tile counts for assets, categories, depreciation runs (not individually isolated in this pass).
- **Notes**: Unlike the other seven domain hubs (Sales, Purchases, Inventory, Treasury, Accounting, CRM, POS — see `01-sales.md`'s Sales Hub entry), this one's existence was already suspected by the original recon pass from a breadcrumb observation alone; this verification pass is what actually opened and documented it.

---

### رحلات المندوبين (Van/Rep Trips — Field Sales)
- **Route**: `/field/van-trips` (list), `/field/van-trips/{id}` (detail); "فتح رحلة" opens a full-page "open trip" form (not a modal).
- **Purpose**: Manage a delivery/sales van's trip lifecycle — load stock and cash with a crew, let them sell/collect in the field, then settle expected-vs-counted cash and stock when the van returns. This is its own module ("المبيعات الميدانية" / Field Sales), reachable from the Sales nav dropdown but functionally independent of core Sales.
- **List view**:
  - Header: "فتح رحلة" (Open trip) button.
  - KPI strip: الإجمالي, جارية (ongoing), مسواة (settled), ملغاة (cancelled).
  - Status filter chips + search: "ابحث برقم الرحلة".
  - Columns: رقم الرحلة (trip # + date), الڤان (van), الفرع (branch), الطاقم (crew, e.g. driver name), المبيعات (sales count), الحالة, النقدية المحصلة (cash collected), row action.
- **Detail/form view** (Open trip — "فتح رحلة", full page):
  - التاريخ * (default today).
  - الڤان * (van picker, search).
  - مخزن التحميل * (loading warehouse — disabled until a van is selected).
  - خزينة الڤان (van cash/treasury account — disabled until a van is selected).
  - طرق الدفع المتاحة (available payment methods): checkbox list per method (e.g. بطاقة/card) each paired with a treasury-account combobox to post that method's collections to; helper text: "حدد وسائل الدفع التي يقبلها المندوب وحساب الخزينة الذي يرحَّل إليه كل منها. النقدي يذهب دائماً إلى خزينة الڤان أعلاه."
  - النقدية الافتتاحية (opening cash float, default 0) — helper: "العُهدة النقدية اللي المندوب بياخدها معاه — هتتحول فعلياً من الخزنة المصدر لخزينة الڤان."
  - "الطاقم *" (crew, required): اختر موظفاً (employee search) + role combobox (سائق driver / مندوب rep / مساعد assistant) + "إضافة" (add) button, disabled until an employee is picked.
  - "تحميل مخزون" (اختياري) (load stock, optional): اختر صنفاً (item search) + الكمية (qty, default 1) + "إضافة" button, disabled until an item is picked.
  - ملاحظات (notes).
  - Action: "فتح رحلة" (Open trip — submit; **not clicked**, per read-only rule).
- **Detail view** (existing trip, e.g. VT-000001, status مسواة/settled):
  - Header: trip # + status (مسواة) + trip-state text ("انتهت الرحلة" — trip ended).
  - Summary fields: الڤان, الفرع, تاريخ الفتح (opened date), تاريخ التسوية (settled date), النقدية الافتتاحية (+ note "بدون تحويل (رحلة قديمة)" seen on a legacy-flow trip), خزينة الڤان, طرق الدفع المتاحة (e.g. "نقدي فقط" cash-only), المبيعات (count), التحصيلات (collections count), الطاقم (crew name + role), النقدية المسلمة (cash handed in at settlement).
  - Tabs: مخزون الڤان (van stock), المستندات (documents), المسار (route), التسوية (settlement, default-selected), سجل المراجعة (audit log).
  - "التسوية" (settlement) tab detail: تسوية النقدية (cash reconciliation) — المتوقع (expected) vs. المعدود (counted) vs. الفرق (variance, flagged e.g. "+31.60 ج.م"); "تفصيل النقدية" (cash breakdown) with a full narrative reconciliation formula (opening cash + cash sales + cash collections ± other drawer movements = expected-in-drawer), including a caveat for legacy trips settled against the whole account balance rather than a computed breakdown; "ملخص المبيعات" (sales summary): إجمالي الفواتير (invoice count/total), المرتجعات (returns), صافي المبيعات (net sales), مبيعات آجلة (on-account/credit sales); "تسوية المخزون" (stock reconciliation) table: الصنف, المتوقع, المعدود, الفرق.
- **Actions**: List: "فتح رحلة". Row kebab → عرض (View, confirmed). Detail: no destructive actions surfaced/clicked (read-only pass).
- **Workflows/statuses**: جارية (Ongoing) → مسواة (Settled); ملغاة (Cancelled) side branch. Within a trip there's also a finer state shown as "حالة الرحلة" (e.g. "انتهت الرحلة" = trip ended) separate from the top status pill.
- **API observed**:
  - `GET /api/field/van-trips`, `GET /api/field/van-trips/counts`
  - `GET /api/field/van-trips/{id}`, `GET /api/field/van-trips/{id}/stock`, `GET /api/field/van-trips/{id}/settlement`
- **Notes**: The cash-settlement math is unusually transparent in the UI — it explicitly narrates the expected-cash formula and calls out a "legacy flow" caveat when a trip's recorded settlement doesn't match the newer computed-breakdown method, implying the settlement/reconciliation logic changed at some point and old records retain their original (less granular) settlement data. Strong linkage to Treasury (كل طريقة دفع لها حساب خزينة) and to Inventory (مخزن التحميل, تسوية المخزون) and HR (طاقم من الموظفين).

---

## Screens not fully accessible / limitations

- **المشاريع (Projects)**: tenant has 0 project records — only the list (empty state) and the "new project" dialog fields could be captured; no detail/costing/billing tabs exist to observe.
- **سجل الأصول (Asset Register)**: tenant has 0 registered assets — only the list (empty state) and the "register asset" form could be captured; no detail/edit view, no depreciation-schedule tab.
- **الإهلاك (Depreciation Runs)**: gated behind having at least one registered asset; the "run depreciation" creation flow could not be reached/captured at all (not just its fields — no trigger control was visible in the empty state).
- **تصنيفات الأصول (Asset Categories)**: tenant has 0 categories — list is empty state only; "add category" form fully captured.
- Everything else in scope (Manufacturing's 5 screens + Van Trips) had live demo data and was captured list + detail + create/new form.

## Notes — cross-module links & oddities

- منتجات قابلة للتهيئة (Configurable Products) is filed under the **Inventory** nav group in the sidebar, not Manufacturing, despite being manufacturing formula/master data consumed by التصنيع المخصص. A same-named screenshot may already exist under Inventory-scope capture (`catalog/img/inventory-configurable-product-detail.png`) — check for duplication when reconciling catalogs.
- On the أوامر التصنيع (Work Orders) list, clicking the product-name cell opens the **product's** item quick-view, not the work order's — the WO's own detail is only reachable via the row kebab → عرض. Every other module surveyed opens the row's own record on click; this is an outlier worth a UX note.
- المشاريع (Projects) creation auto-derives a project cost center as `PRJ-{كود المشروع}` — direct integration point with المحاسبة → مراكز التكلفة (Accounting → Cost Centers), not yet exercised live in the demo tenant.
- تصنيفات الأصول (Asset Categories) ships with system-default GL account codes (1500 الأصول الثابتة / 5400 إهلاك الأصول / 1590 مجمع إهلاك الأصول / 4500 أرباح بيع الأصول / 5450 خسارة بيع الأصول) surfaced as placeholder helper text, so assets can post correctly with zero per-category account configuration.
- رحلات المندوبين (Van Trips) is its own "المبيعات الميدانية" (Field Sales) module, not a Manufacturing/Projects/Assets screen — included here only because the task scope explicitly named it. It links Treasury (per-payment-method account routing), Inventory (van stock load/reconcile), and HR (crew = employees with a role).
- التصنيع مقابل الشراء (Make vs Buy report) is filed under "تقارير التصنيع" in the Reports mega-menu, separate from the Manufacturing operational screens, and currently has no usable purchase-cost data in the demo tenant to compare against.
