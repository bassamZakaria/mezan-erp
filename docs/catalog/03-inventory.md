# Inventory Domain — Reference System Catalog

Capture pass 3 — Inventory. Read-only exploration; only the login form was submitted. All "create/new" dialogs and forms below were opened, documented, and closed/navigated away from without saving (except where explicitly noted as an already-existing record being viewed).

## Screen Inventory (everything found in scope)

- **الأصناف (Items)** — `/inventory/items` — list + detail (tabs: stock by warehouse, cost, basic info, attachments, log) + edit form + item categories dialog
- **منتجات قابلة للتهيئة (Configurable Products)** — `/manufacturing/configurable-products` — list + detail/edit (formula-based made-to-order products). Reachable from the Inventory nav group but lives under the Manufacturing route/module.
- **قوالب المنتجات (Product Templates)** — `/inventory/product-templates` — list + detail (attributes/variant generator)
- **أرصدة المخزون (Stock Balance)** — `/inventory/stock-balance` — cross-item stock levels list
- **تحويلات المخزون (Stock Transfers)** — `/inventory/transfers` — list + detail + new-transfer form
- **تسويات المخزون (Stock Adjustments)** — `/inventory/adjustments` — list + detail (incl. accounting/GL tab) + new-adjustment form (reason picker) — also used for **opening balances** (`?reason=INITIAL_STOCK`)
- **الجرد الفعلي (Physical Counts / Stocktaking)** — `/inventory/physical-counts` — list (empty in demo) + new-count dialog
- **طباعة الملصقات (Label / Barcode Printing)** — `/inventory/labels` — item/document label print builder
- **المستودعات (Warehouses)** — `/settings/warehouses` — list + detail + edit dialog (under Settings → Operational Structure, in scope per task)
- **الفروع (Branches)** — `/settings/branches` — list + add-branch dialog (under Settings → Operational Structure, in scope per task)
- **تقييم المخزون (Inventory Valuation report)** — `/reports/inventory/valuation` — weighted-average costing / GL reconciliation report (captured as the costing/valuation screen called out in scope)
- **إدارة المخزون (Inventory Hub, domain landing page)** — `/inventory/hub` — **not linked from the sidebar nav**; added by verification pass.

Not captured in depth (belong to Reports domain, out of this pass's primary scope, only glimpsed via nav): `/reports/inventory/stock-levels`, `/reports/inventory/movement`, `/reports/inventory/ledger`, `/reports/inventory/aging`, `/reports/inventory/expiring-soon`, `/reports/inventory/slow-moving`, `/reports/inventory/drift`.

---

### الأصناف (Items — Products Master)

- **Route**: `/inventory/items` (list), `/inventory/items/:id` (detail), `/inventory/items/:id/edit` (edit)
- **Purpose**: Master list of all sellable/stockable items — products, services, raw materials, finished products, consumables, recipes — with pricing, costing, tax, GL mapping and inventory policy.
- **List view**:
  - Header stats: إجمالي الأصناف (total), نشط (active), غير نشط (inactive); plus a "نفد المخزون" (out of stock) attention banner (e.g. "5 نفد المخزون").
  - Filter chips: الكل (all), نشط (active), منتج (product), خدمة (service), مادة خام (raw material), منتج نهائي (finished product), مخزون منخفض (low stock), نفد المخزون (out of stock).
  - Filters panel ("تصفية النتائج"): نوع الصنف (item type dropdown), التصنيف (category, autocomplete), وحدة (unit, autocomplete), سعر البيع من/إلى (sale price range), سعر التكلفة من/إلى (cost price range), checkbox "إخفاء المتغيرات" (hide variants).
  - Search box: "بحث بالاسم أو الكود..." (search by name or code).
  - Table columns: اسم الصنف (name + code + type badge, thumbnail image), وحدة (unit), المخزون (stock qty + unit), سعر البيع (sale price), سعر التكلفة (cost price), row action menu. Variant items show a "متغير" (variant) badge.
  - Rows with zero recorded stock show an inline "تحديد الرصيد الافتتاحي" (set opening balance) quick-action button instead of a plain row-menu.
  - Pagination: "عرض 1 - N من N" style, page-size selector (default 25), prev/next buttons.
  - Header actions: "تصنيفات الأصناف" (item categories dialog) and "إضافة صنف" (add item → same form as edit).
- **Detail/form view** (edit form fields, all sections):
  - **نوع الصنف*** (item type) — button group: منتج (Product), خدمة (Service), مادة خام (Raw material), منتج نهائي (Finished product), مستهلك (Consumable), الوصفة (Recipe/BOM). Selecting a type changes which fields render below and shows a helper description (e.g. "صنف ملموس يتتبع له المخزون ويباع للعملاء...").
  - **الهوية والتصنيف** (Identity & classification): اسم الصنف* (name, text), كود الصنف (code, auto-generated, disabled on edit), الباركود (barcode, scan-or-type, "+ إضافة باركود آخر" to add more barcodes), وحدة (base unit, dropdown), الوصف (description, textarea), المورد الأساسي (primary supplier, optional autocomplete), الموسم (season, disabled until supplier chosen, "إضافة موسم" add-season), صورة الصنف (item image upload), التصنيف (category, autocomplete + "إضافة تصنيف"), الماركة (brand, autocomplete + "إضافة ماركة").
  - **التسعير والتكلفة** (Pricing & cost): سعر البيع (sale price, number), سعر التكلفة (cost price, number — becomes read-only/derived once the item has stock movements, since cost method drives it), إعداد الضريبة (tax profile dropdown, default shows "الضريبة الافتراضية للنظام" / 14%).
  - **القنوات والظهور** (Channels & visibility): switch "متاح في نقطة البيع" (available in POS), switch "يعتبر هدراً عند التقديم" (counted as kitchen waste on void/refund — POS/restaurant-specific policy toggle, with long explanatory helper text about sealed/returnable items).
  - **المخزون** (Inventory policy): switch "تتبع المخزون" (track inventory — deducts on sale, updates on purchase), **طريقة التكلفة*** (costing method) dropdown — options observed: "متوسط التكلفة" (Weighted-Average Cost) and "FIFO" referenced in helper text ("متوسط التكلفة = متوسط كل المشتريات، FIFO = الأقدم أولاً"), switch "تتبع الدفعات وتواريخ الصلاحية" (batch/lot + expiry tracking, FEFO — first-expiry-first-out — for pharma/food items). Reorder policy: نقطة إعادة الطلب (reorder point, number), كمية إعادة الطلب (reorder quantity, number/text) with helper copy about triggering low-stock alerts and suggested PO quantity.
  - **الحسابات** (GL account mapping — per-item): حساب الإيراد (revenue account, optional override, default shown as "4100 — إيرادات المبيعات"), حساب التكلفة (COGS account, default "5011 — تكلفة البضاعة المباعة"), حساب المخزون (inventory/asset account, default "1200 — المخزون"). All three are free-text/autocomplete "leave blank to use default (by item type)" fields.
  - **تصنيف الفاتورة الإلكترونية (ETA)** (Egyptian e-invoice classification): نوع الكود (code type dropdown, e.g. EGS/GPC), كود الصنف لدى المصلحة (tax-authority item code, format hint "EG-XXXXXXXXX-SKU"), كود GPC (GPC code, e.g. "10000051"). Helper text: EGS codes must be registered/approved in the taxpayer portal before use.
  - **وحدات القياس** (Units of measure): shows base unit (e.g. "قطعة (PCS) × 1") and a "لا توجد وحدات قياس بديلة" empty state with "إضافة وحدة" (add alternate unit, e.g. carton/box with a conversion factor) — same alternate-UOM mechanism used in Product Templates.
  - Read-only **detail page** (view mode) shows a condensed card: نوع الصنف, التصنيف, وحدة, إعداد الضريبة, طريقة التكلفة, سعر البيع, سعر التكلفة, المخزون الحالي (current stock across all warehouses) plus quick-action buttons: "تعديل المخزون" (adjust stock), "نقل إلى مستودع آخر" (transfer to another warehouse), "طلب شراء" (create purchase order), "عرض سجل الحركات" (view movement log).
  - **Tabs on detail page**:
    - **المخزون حسب المستودع** (Stock by warehouse): table — المستودع (warehouse, opens a side panel), متاح (available), محجوز (reserved), الإجمالي (total).
    - **التكلفة** (Cost): shows طريقة التكلفة (costing method) + متوسط التكلفة الحالي (current weighted-average cost, big number). **طبقات التكلفة** (cost layers) table — المستودع, الكمية المتبقية (remaining qty), تكلفة الوحدة (unit cost), المصدر (source doc — links to the adjustment/purchase-invoice that created the layer, e.g. ADJ-000015, PI-000001), التاريخ (date). Below that, a reconciliation card: "متوسط التكلفة لا يطابق سعر الطبقات" (average cost doesn't match layer price) with an explicit note: "تم تحديث متوسط التكلفة مؤخرا. الطبقات تحتفظ بسعرها الأصلي وقت الاستلام — هذا تصميم مقصود" (layers keep their original receipt-time price by design) — showing المخزون الحالي, الكمية ذات تكلفة مسجلة, متوسط التكلفة المسجل, متوسط التكلفة الحالي, plus a collapsible "لماذا يختلف متوسط التكلفة عن سعر الطبقات؟" explainer. Also a **سجل التكاليف الإضافية** (landed-cost allocation log) section — empty state "لا توجد تكاليف إضافية موزعة" when no landed costs from `/purchases/landed-costs` have been allocated to the item.
    - **المعلومات الأساسية** (Basic info): اسم الصنف, كود الصنف, الباركود, نقطة إعادة الطلب, كمية إعادة الطلب, تتبع المخزون (yes/no).
    - **المرفقات** (Attachments): file-attachment tab (not deeply explored; standard attachment widget elsewhere in the app).
    - **السجل** (Log/Audit): timeline of item-level events, e.g. "إنشاء صنف" (item created) with user + timestamp.
  - **More menu** ("المزيد") on the detail page: طباعة الملصقات (print labels — jumps to Labels screen with item preloaded), تحديد الرصيد الافتتاحي (set opening balance — jumps to Adjustments/new with `reason=INITIAL_STOCK`), تعطيل (deactivate), حذف (delete).
  - **Item Categories dialog** ("تصنيفات الأصناف", opened from the list header): simple flat list of categories (name + تعديل/حذف per row) with an "إضافة تصنيف" (add category) button — no nesting observed in this tenant's data (3 categories: flat2cm, tshirt, شعر).
- **Actions**: Add item, edit item, deactivate, delete, print labels, set opening balance, adjust stock, transfer to warehouse, create purchase order, view movement log.
- **Workflows/statuses**: نشط/غير نشط (active/inactive) plus stock-derived badges متوفر (available) / نفد المخزون (out of stock) / مخزون منخفض (low stock). No document-approval workflow on items themselves.
- **API observed**:
  - `GET /inventory/items?page=1&limit=25`
  - `GET /inventory/items/counts`
  - `GET /inventory/items/base-uoms`
  - `GET /inventory/categories`
  - `GET /inventory/items/:id`
  - `GET /attachments/:id/download`
- **Notes**: Costing is per-item (اختيار لكل صنف), weighted-average is the default/most-used method; FIFO exists as an alternative option in the dropdown copy. Cost layers are immutable historical records tied to their originating document (adjustment or purchase invoice) and intentionally diverge from the live weighted-average once new receipts land — the UI explains this explicitly rather than treating it as a bug. GL account mapping is per-item with system-wide defaults by item type (4100/5011/1200). ETA (Egyptian e-invoice) classification fields are present at the item level. Batch/expiry (FEFO) and alternate-UOM support exist but were not populated on the sampled item.

---

### قوالب المنتجات (Product Templates — configurable/variant products)

- **Route**: `/inventory/product-templates` (list), `/inventory/product-templates/:id` (detail/edit, combined)
- **Purpose**: Define a product with characteristics (e.g. color, size, width) and mass-generate the resulting SKU combinations as independent, stockable items ("variants").
- **List view**: intro copy "أنشئ منتجاً بخصائص (مثل اللون والمقاس) وولد المتغيرات كأصناف مستقلة". Search box. Table columns: اسم المنتج (name), الخصائص (attribute names, e.g. "العرض"), المتغيرات (variant count), الحالة (status), row action menu. Header action: "قالب جديد" (new template). Pagination footer (same style as Items).
- **Detail/form view** (single combined view/edit page):
  - Core fields: اسم المنتج* (name), وحدة القياس (base UOM dropdown), الفئة (category autocomplete), طريقة التكلفة (costing method dropdown — "متوسط التكلفة" observed), العلامة التجارية (brand), السعر الافتراضي (default sale price), التكلفة الافتراضية (default cost), الضريبة (tax profile). "حفظ التعديلات" save button.
  - **الوحدات البديلة** (Alternate units): helper text "عرف وحدة أكبر مرة واحدة (مثل: لفة = 12 متر) وسيتم نسخها إلى كل متغير" — define once, propagates to every generated variant. Row fields: unit code, unit name, "أكبر من الأساسية"/"أصغر من الأساسية" (larger/smaller than base) toggle, conversion factor ("1 الوحدة = N base-unit"), "إضافة وحدة".
  - **الخصائص** (Attributes/characteristics): each attribute shows its name (e.g. "العرض" = Width), value count, edit-name button, and a delete button that's disabled with the tooltip "هذه الخاصية مستخدمة في N متغير — احذف المتغيرات أولاً" (can't delete an attribute in use by existing variants) — same guard on individual values. Add-attribute row: اسم الخاصية (attribute name), القيم مفصولة بفواصل (comma-separated values), "إضافة خاصية".
  - **توليد المتغيرات** (Variant generator): shows "N تركيبة ممكنة، M موجودة بالفعل" (N possible combinations, M already created). Table of possible combinations with checkboxes ("تحديد الكل" select-all), columns SKU / سعر البيع / التكلفة / الباركود per combination; already-existing combinations are marked "موجود" and locked. "توليد (N)" button generates the selected new combinations as real items.
  - **المتغيرات (N)** (Variants list): each variant renders as a card — variant value label, generated SKU/barcode, سعر البيع, التكلفة, status (نشط) — clicking presumably opens the underlying Item detail page.
- **Actions**: New template, edit template fields, add/rename/delete attribute or attribute value (guarded while in use by variants), add alternate unit, select & generate new variant combinations.
- **Workflows/statuses**: نشط/غير نشط at the template level; each generated variant is a normal Item with its own نشط status.
- **API observed**: `GET /inventory/product-templates?page=1&limit=25`, `GET /inventory/categories`, `GET /inventory/product-templates/:id`.
- **Notes**: This is the "configurable product" mechanism for catalog-style variants (size/color/width), distinct from the formula-driven "Configurable Products" (custom manufacture-to-order) described below. Template-level default cost/costing-method seeds every generated variant item.

---

### منتجات قابلة للتهيئة (Configurable Products — made-to-order / formula-based)

- **Route**: `/manufacturing/configurable-products` (list), `/manufacturing/configurable-products/:id/edit` (detail/edit)
- **Purpose**: Define a made-to-order product priced and consuming raw materials via mathematical formulas over customer-entered dimensions (e.g. a cut-to-size product priced by width × height). Surfaced in the Inventory nav group ("منتجات قابلة للتهيئة") but its route and data model belong to the Manufacturing module.
- **List view**: Header stats: الإجمالي (total), نشط (active), غير نشط (inactive). Filter chips الكل/نشط/غير نشط. Search "بحث بالكود أو الاسم". Table columns: الكود, الاسم, مدخلات التهيئة (config input variable labels, e.g. "العرض، الطول" = width, height), خامات التصنيع (# of raw-material lines), وحدة المنتج النهائي (finished-product unit), عدد الأوامر (# of manufacturing orders placed against it), الحالة, row actions ("أمر تصنيع مخصص جديد" — new custom manufacturing order — + more menu). Header action: "إضافة منتج قابل للتهيئة".
- **Detail/form view** (combined view/edit):
  - **المنتجات القابلة للتهيئة** section: نوع المنتج (product type combobox, e.g. "تصنيع وبيع (منتج مخصص)" = manufacture-and-sell/custom product), الكود* , الاسم* , التسمية بالعربية (Arabic label), وحدة المنتج النهائي (finished product unit combobox), الوصف.
  - **مدخلات التهيئة*** (Configuration inputs / formula variables): repeatable rows, each with المعرف (للمعادلات)* (identifier used in formulas, e.g. `width`, `height`), التسمية* (display label, e.g. "العرض"/"الطول"), التسمية بالعربية, النوع (type — "رقم"/number observed), الحد الأدنى / الحد الأقصى (min/max bounds), "إضافة مدخل" (add input).
  - **خامات التصنيع*** (Manufacturing raw materials): shows "المتغيرات المتاحة: width, height" reminder. Each line: الصنف* (item picker, e.g. "long fit (ITM-MSOL7WY4)"), معادلة الكمية* (quantity formula referencing the input variables, e.g. `width+height`, with insert-variable buttons per variable and a placeholder example `2*(width+height)/100`), نسبة الهالك % (waste/scrap percentage), "إضافة خامة" (add material).
  - **التسعير** (Pricing): طريقة التسعير (pricing method combobox — "معادلة" = formula), سياسة الأصناف (item policy combobox — "صنف لكل مواصفات" = one item per spec combination), معادلة السعر (للوحدة)* (unit price formula, e.g. `width*height*3.5`, placeholder `width*height*rate`).
  - **التكلفة التقديرية** (Estimated cost): معادلة تكلفة العمالة (للوحدة) (labor cost formula, e.g. `width+height`), معادلة التكاليف الإضافية (للوحدة) (overhead cost formula).
  - "حفظ التعديلات" save button.
- **Actions**: Add configurable product, edit formulas/inputs/materials/pricing, launch a new custom manufacturing order per product.
- **Workflows/statuses**: نشط/غير نشط. Each customer order against a configurable product becomes a "تصنيع مخصص" (custom manufacture) instance tracked under Manufacturing → التصنيع المخصص (`/manufacturing/config-instances`) — out of this pass's scope.
- **API observed**: `GET /manufacturing/configurable-products/counts`, `GET /manufacturing/configurable-products?page=1&limit=25`, `GET /manufacturing/configurable-products/:id`.
- **Notes**: This is a distinct mechanism from Product Templates — formulas (quantity, price, labor, overhead) evaluate against customer-supplied numeric inputs at order time rather than pre-generating fixed SKUs. Clearly overlaps with the Manufacturing domain (BOM-like material consumption, work-order linkage) and should be cross-referenced with that pass's capture.

---

### أرصدة المخزون (Stock Balance)

- **Route**: `/inventory/stock-balance`
- **Purpose**: Cross-warehouse (or filtered to one warehouse) at-a-glance stock level list for every tracked item, with reorder-point visibility.
- **List view**:
  - Attention banner: "يحتاج انتباه" — e.g. "5 أصناف نفذت من المخزون" (5 items out of stock).
  - Header stats: إجمالي الأصناف (total items), مخزون منخفض (low stock), نفد المخزون (out of stock).
  - Filter chips: الكل, مخزون منخفض, نفد المخزون.
  - Filters panel: المستودع (warehouse autocomplete), التصنيف (category autocomplete), وحدة (unit), الإجمالي من/إلى (total qty range), حد إعادة الطلب من/إلى (reorder point range).
  - Search: "بحث بالاسم أو الكود...".
  - Table columns: (thumbnail), الصنف (name+code+type), وحدة, إجمالي المخزون (total stock + unit), نقطة إعادة الطلب (reorder point, "—" when unset).
  - Pagination footer.
- **Detail/form view**: none — pure list/dashboard screen; clicking a row is presumed to route to the Item detail page (consistent with other item-linked rows elsewhere in the app).
- **Actions**: Filter/search/sort only (read list).
- **Workflows/statuses**: n/a (derived stock-level badges only).
- **API observed**: `GET /inventory/stock/overview?status=all&page=1&limit=50`, `GET /inventory/stock/counts`, `GET /inventory/categories`, `GET /inventory/items/base-uoms`.
- **Notes**: This is the single-warehouse-agnostic rollup; per-warehouse breakdown lives on the Item detail page's "المخزون حسب المستودع" tab and on each Warehouse detail page.

---

### تحويلات المخزون (Stock Transfers)

- **Route**: `/inventory/transfers` (list), `/inventory/transfers/:id` (detail), `/inventory/transfers/new` (create)
- **Purpose**: Move stock quantities between two warehouses (including the "سياره نقل" / van-type warehouse used for field-sales trips) without affecting total inventory value.
- **List view**:
  - Attention banner: "1 تحويلات مسودة" (draft transfers needing action).
  - Header stats: إجمالي التحويلات (total), مسودة (draft), مؤكد (confirmed).
  - Filter chips: الكل, مسودة, مؤكد.
  - Filters: المستودع المصدر (source warehouse), إلى المستودع (destination warehouse), من/إلى تاريخ (date range), عدد البنود من/إلى (line-count range).
  - Search: "بحث برقم التحويل...".
  - Table columns: رقم التحويل (number + source→destination warehouse chips, each opens a side panel + date), عدد البنود (line count), الحالة (مسودة/مؤكد), بواسطة (created-by user, opens side panel), row actions — draft rows show an inline "تأكيد" (confirm) button + menu; confirmed rows show only the menu.
  - Pagination footer.
- **Detail/form view** (existing transfer, e.g. TRF-000004):
  - Header: number + status badge (مؤكد), "المزيد" more menu.
  - Info cards: التاريخ (date), المسار (route: source warehouse chip → destination warehouse chip), ملاحظات (notes — observed real data: "Van load — trip VT-000005", linking to the field/van-trips module), item count badge.
  - Confirmed-transfer notice: "لا يمكن إلغاء تحويل مؤكد — بعد تأكيد التحويل لا يمكن إلغاؤه. لعكس الحركة، أنشئ تحويلاً جديداً بالاتجاه المعاكس." (cannot cancel once confirmed; reverse with a new opposite-direction transfer).
  - "تأثيرات هذا التحويل" (effects) explainer cards: quantities deducted from source warehouse, quantities added to destination warehouse, **"لا يتغير إجمالي قيمة المخزون"** (total inventory value is unchanged — transfers move quantity between locations only, no valuation impact).
  - Tabs: **البنود** (Items — table: الاسم item name+SKU+thumbnail, الكمية quantity+unit), **المرفقات** (Attachments), **سجل التدقيق** (Audit log).
  - **New transfer form** (`/inventory/transfers/new`): المستودع المصدر* / المستودع الوجهة* (source/destination warehouse dropdowns). **بنود التحويل** (transfer lines) table: الصنف (item picker), المخزون المتاح (available stock, read-only), كمية التحويل (transfer qty), remove-row button; header action "استيراد من إكسل" (import from Excel). "حفظ" save button.
- **Actions**: New transfer, confirm (تأكيد) a draft, view/print, attach files, audit log — no edit/cancel once confirmed.
- **Workflows/statuses**: مسودة (draft) → مؤكد (confirmed). Confirmation is one-way; reversal requires a brand-new transfer in the opposite direction.
- **API observed**: `GET /inventory/transfers/:id` (called twice on load).
- **Notes**: Warehouses list includes at least one non-physical "warehouse" type used to represent a delivery vehicle ("سياره نقل" / van), and transfers to it are how field-sales van-trip stock loading (`/field/van-trips`, Sales module) is recorded. Transfers never touch inventory valuation — only stock adjustments do.

---

### تسويات المخزون (Stock Adjustments) — includes opening balances

- **Route**: `/inventory/adjustments` (list), `/inventory/adjustments/:id` (detail), `/inventory/adjustments/new` (create), `/inventory/adjustments/new?itemId=...&reason=INITIAL_STOCK` (opening-balance shortcut from an item row)
- **Purpose**: Record any inventory quantity change that isn't a transfer or a purchase/sale — opening balances, physical-count corrections, damage, theft, expiry, shortage/loss, supplier returns, or other. Adjustments post a value-impacting GL journal entry.
- **List view**:
  - Header stats: إجمالي التسويات (total), مسودة (draft), مؤكد (confirmed), ملغي (cancelled). All 17 sampled adjustments were مؤكد (confirmed) — 0 draft/cancelled.
  - Filter chips mirroring the stats. Filters: المستودع (warehouse), السبب (reason, dropdown), من/إلى تاريخ (date range).
  - Search: "بحث برقم التسوية...".
  - Table columns: التسوية (number + status chip + date), المستودع / السبب (warehouse chip + reason label), عدد البنود (line count), القيمة الإجمالية (total value, signed — e.g. "+10.00 ج.م" / "‎-7.00 ج.م"), بواسطة (created-by, side panel), الحالة, row menu.
  - Pagination footer.
- **Detail/form view** (existing adjustment, e.g. ADJ-000015):
  - Header: number + status (مؤكد), "المزيد" more menu.
  - Info cards: المستودع (warehouse, side panel), السبب (reason — "رصيد افتتاحي" observed), التاريخ, عدد البنود; القيمة الإجمالية (total value, large, e.g. "500,000.00 ج.م").
  - Confirmed-adjustment notice: "لا يمكن إلغاء تسوية مؤكدة — ... لعكس الأثر، أنشئ تسوية جديدة بالاتجاه المعاكس" (same one-way pattern as transfers).
  - "تأثيرات هذه التسوية" (effects): quantities added/removed per lines, **"ارتفعت/انخفضت قيمة المخزون"** (inventory value increases or decreases — unlike transfers, adjustments DO move valuation), "لا تأثير على المورد أو العميل" (purely internal to inventory — no supplier/customer balance impact).
  - Tabs:
    - **بنود التسوية** (Adjustment lines): table — الصنف (item, side panel), قبل (before qty), التغيير (change, signed, e.g. "+100"), بعد (after qty), سعر التكلفة (unit cost used), القيمة الإجمالية (line total value).
    - **المحاسبة** (Accounting/GL) — **this is the weighted-average costing evidence**: table of journal-entry lines — رقم القيد (journal entry number, e.g. JE-000061, side panel), الحساب (account, e.g. "المخزون — 1200", "رأس مال الملاك — 3100"), مدين (debit), دائن (credit). Sampled opening-balance adjustment posted Dr. المخزون (Inventory, 1200) 500,000.00 / Cr. رأس مال الملاك (Owner's Capital, 3100) 500,000.00.
    - **المرفقات** (Attachments), **سجل التدقيق** (Audit log).
  - **New adjustment form** (`/inventory/adjustments/new`): step 1 is a **reason picker** ("اختر سبب التسوية — السبب يحدد طريقة إدخال البيانات") with 8 reason cards, each with a one-line description:
    - رصيد افتتاحي — تسجيل رصيد المخزون الأولي (opening balance)
    - تصحيح جرد — تعديل المخزون بناء على الجرد الفعلي (physical-count correction)
    - تلف — خصم الأصناف التالفة (damage — deduction)
    - سرقة — خصم الأصناف المسروقة (theft — deduction)
    - انتهاء صلاحية — خصم الأصناف منتهية الصلاحية (expiry — deduction)
    - نقص / فقدان — خصم العجز غير المبرر (shortage/loss — deduction)
    - مرتجع للمورد — خصم الأصناف المرتجعة للمورد (return to supplier — deduction)
    - أخرى — تسوية أخرى، حدد الاتجاه والكمية (other — pick direction manually)
    - After a reason is picked, form shows: المستودع* (warehouse dropdown), ملاحظات (notes), then an items/quantities section (not fully expanded without picking a warehouse) and a المرفقات (attachments) section. Header action: "اعتماد التسوية" (approve/post the adjustment — never clicked).
  - **Opening-balance shortcut**: from the Items list, rows with zero stock expose a "تحديد الرصيد الافتتاحي" button that opens this same form pre-scoped to that item with `reason=INITIAL_STOCK`, page title becomes "الرصيد الافتتاحي".
- **Actions**: New adjustment (pick reason → warehouse → lines → post), post ("اعتماد التسوية") — no cancel/edit once confirmed.
- **Workflows/statuses**: مسودة → مؤكد (one-way, like transfers) — ملغي (cancelled) status exists in the filter chips but no cancelled records were present in this tenant.
- **API observed**: adjustment detail and journal-entry linkage confirmed via the "المحاسبة" tab UI (JE-000061 cross-link); list/detail endpoints follow the same `/inventory/adjustments...` pattern as transfers.
- **Notes**: **This is the mechanism used for opening balances** (reason `INITIAL_STOCK` / "رصيد افتتاحي") — there is no separate "opening balance" screen; it's a specialized entry point into Adjustments. Adjustments are the only inventory-domain document observed that both changes stock quantity AND posts a balancing GL journal entry (visible in the "المحاسبة" tab), confirming that transfers are valuation-neutral while adjustments are valuation-affecting. The item cost-layers table (see Items → التكلفة tab) shows adjustments (e.g. ADJ-000015) as valid "source" documents for a cost layer, meaning an adjustment can inject stock at a specific unit cost that becomes a new weighted-average cost layer.

---

### الجرد الفعلي (Physical Counts / Stocktaking)

- **Route**: `/inventory/physical-counts`
- **Purpose**: Run a structured physical-count session for a warehouse (load system quantities, record counted quantities, then generate a reconciling stock adjustment).
- **List view**:
  - Header stats: إجمالي عمليات الجرد (total), قيد التنفيذ (in progress), مكتمل (completed), تم إنشاء التسوية (adjustment generated).
  - Filter chips: الكل, قيد التنفيذ, مكتمل, تم إنشاء التسوية, ملغي (cancelled).
  - Filters: المستودع (warehouse), من/إلى تاريخ.
  - Search: "بحث برقم الجرد...".
  - Table columns: الجرد (count number), عدد الأصناف (item count), بواسطة (created by), الحالة, row menu.
  - Empty state in this tenant: "لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام" (0 counts exist in the demo data).
  - Header action: "جرد جديد" (new count).
- **Detail/form view**: **New Physical Count dialog** — المستودع* (warehouse, autocomplete), التاريخ* (date, defaulted to today), ملاحظات (notes), helper text: "سيتم تحميل جميع الأصناف المتوفرة في المستودع المحدد مع أرصدتها الحالية" (all items in the chosen warehouse will be loaded with their current balances). Buttons: إلغاء (cancel), إضافة (add/start). No existing count record was available to inspect a filled-in count session (blank/qty-entry grid, variance column, "generate adjustment" action) since the tenant has zero counts.
- **Actions**: Start new count (only action exercisable read-only); presumed further actions once a count exists: enter counted quantities per line, complete count, generate the reconciling adjustment (status "تم إنشاء التسوية" implies a 1:1 link to an Adjustments record), cancel.
- **Workflows/statuses**: قيد التنفيذ (in progress) → مكتمل (completed) → تم إنشاء التسوية (adjustment generated) — plus ملغي (cancelled) as a side branch. This is a 4th distinct inventory-document status pattern (vs. the draft/confirmed pattern on Transfers/Adjustments).
- **API observed**: none captured — the list loaded with zero records and no adjustment-generation call was exercised (read-only rule; would have required starting a real count).
- **Notes**: Physical Counts is presented as the structured, guided front-end to the "تصحيح جرد" (physical-count correction) reason on Stock Adjustments — i.e., completing a count is expected to auto-generate a matching adjustment record rather than requiring the user to manually type variance lines. Not exercised further to respect the read-only constraint (starting a count begins a stateful session against live data).

---

### طباعة الملصقات (Item Labels / Barcode Printing)

- **Route**: `/inventory/labels`
- **Purpose**: Build a print-ready batch of item price/barcode labels (thermal or sheet), pulling live sale price so printed price always matches what POS will actually charge.
- **List view**: n/a — this is a single-page builder, not a list+detail screen.
- **Detail/form view**:
  - Disclaimer banner: "السعر المطبوع هو السعر الفعلي الذي تحسبه نقطة البيع للعميل العادي (بعد قوائم الأسعار والشرائح). الطباعة لا تغير أي سعر." (printed price = the real POS-computed price after price lists/tiers; printing never changes any price).
  - Mode toggle: **صنف** (by item) / **مستند** (by document — presumably pull all line items from a purchase receipt/invoice to label a whole shipment; not explored further).
  - "إضافة صنف" + search box "ابحث عن صنف..." with a live-filtered dropdown of matching items (name + code).
  - Once an item is added: a warning card can appear per item, e.g. "الباركود لا يناسب هذا القالب — هذه الأصناف باركودها أطول من أن يطبع بحجم قابل للقراءة على هذا المقاس. اختر قالباً أكبر." (barcode too long to print legibly on the selected label size — choose a bigger template).
  - **Selected-items table**: columns الصنف (item), الوحدة (unit), الباركود (barcode value), التشغيلة (batch/lot — "—" if not batch-tracked), السعر المطبوع (printed price, live-computed), عدد النسخ (copy count, spinbutton, default 1), remove ("إزالة") button.
  - **قالب الملصق** (label template) dropdown — 3 templates observed: "ملصق حراري — 40×30mm" (thermal, 40×30mm, default), "ملصق رف — 50×25mm" (shelf label, 50×25mm), "ملصق منتج — 100×50mm" (product label, 100×50mm). Live running total "الإجمالي: N ملصق" (total label count = sum of copy counts).
  - **معاينة الملصق** (label preview) panel — renders the actual label layout live (item name + barcode value), and reflects the same "too long for this label" warning inline on the preview.
  - Header action "معاينة وطباعة" (Preview & Print) — disabled until at least one item/label is queued; not clicked (would open a print dialog).
- **Actions**: Add item (or switch to document mode), remove item, change copies-per-item, change label template, preview & print.
- **Workflows/statuses**: n/a — stateless builder, nothing persisted until printed.
- **API observed**: item search suggestions fetched live as the user types (endpoint not separately isolated from the general items-search traffic).
- **Notes**: The template picker doing real-time barcode-fit validation (with a specific warning + suggested remediation) is a nice, evidently deliberate UX detail. Reorder-level and per-item GL fields are not shown here — this screen is purely presentation/print, consistent with the "printing never changes price" disclaimer.

---

### المستودعات (Warehouses)

- **Route**: `/settings/warehouses` (list), `/settings/warehouses/:id` (detail) — under Settings → الهيكل التشغيلي (Operational Structure)
- **Purpose**: Master list of physical/logical stock locations (main warehouse, intermediate/staging, returns, production, and delivery-vehicle "van" locations) tied to a branch.
- **List view**:
  - Header stats: إجمالي المستودعات (total, 2 in this tenant), نشط (active), إجمالي الفروع (total branches referenced, 1).
  - Filter chips: الكل, نشط, غير نشط.
  - Filters: النوع (warehouse type dropdown), اسم الفرع (branch name dropdown).
  - Search: "ابحث باسم المستودع أو الكود...".
  - Table columns: اسم المستودع (name), رمز المستودع (code, e.g. WH-MAIN), اسم الفرع (branch, opens a Branch side panel), نوع المستودع (type), افتراضي (default flag), الحالة, row menu.
  - Two rows in this tenant: "مستودع الفرع الرئيسي" (WH-MAIN, رئيسي/Main, افتراضي/default) and "سياره نقل" (VAN, ڤان — سيارة توزيع / Van-distribution-vehicle type, not default).
  - Header action: "إضافة مستودع" (add warehouse).
- **Detail/form view**:
  - **Detail page** (`/settings/warehouses/:id`): header stats card — رمز المستودع, اسم الفرع, نوع المستودع, أصناف في المخزون (item count, 13), مخزون منخفض (low-stock count), غير متوفر (out-of-stock count); plus a value card: إجمالي القيمة (total value, e.g. "586,758.90 ج.م") and "N إجمالي الوحدات" (total units, e.g. "2,026.56"). Quick-action buttons: تقارير المخزون (inventory reports), نقل مخزون (transfer stock), التسوية (create adjustment), الجرد الفعلي (physical count) — all deep-link into the other Inventory screens pre-scoped to this warehouse.
  - Tabs: **نظرة عامة** (Overview — "أكثر الأصناف كمية" top-items-by-quantity bar chart; "حالة المخزون" stock-status donut, e.g. "100% طبيعي" normal/low/out breakdown; "الأصناف في هذا المستودع" full items-in-warehouse table with اسم الصنف/الكمية/نقطة إعادة الطلب/الحالة columns, search + الكل/مخزون منخفض/غير متوفر chips, pagination), **تقادم المخزون** (Stock aging — not opened in detail), **سجل التدقيق** (Audit log).
  - **Edit dialog** ("تعديل"): اسم المستودع* (name), رمز المستودع (code, disabled/read-only after creation), اسم الفرع* (branch dropdown), نوع المستودع (type dropdown) — **5 warehouse types observed**: رئيسي (Main), مستودع وسيط (Intermediate/staging), مرتجعات (Returns), إنتاج (Production), ڤان — سيارة توزيع (Van/distribution vehicle).
- **Actions**: Add warehouse, edit warehouse (name/branch/type), jump to inventory reports/transfer/adjustment/physical-count scoped to this warehouse.
- **Workflows/statuses**: نشط/غير نشط only; one warehouse per branch can be marked افتراضي (default).
- **API observed**: `GET /warehouses`, `GET /warehouses/select?forTransferDestination=true` (seen from the global header's warehouse-scope picker).
- **Notes**: The "van" warehouse type is the same location used as a transfer destination/source for field-sales van trips (see Transfers notes) and appears repeatedly as the counterparty in opening-balance adjustments (ADJ-000009, 010, 012, 013) — i.e., vans get their own opening stock just like a physical warehouse. Warehouse detail's quick-action buttons make this the most convenient single hub for warehouse-scoped inventory operations in the whole domain.

---

### الفروع (Branches)

- **Route**: `/settings/branches` (list) — under Settings → الهيكل التشغيلي (Operational Structure). No standalone branch detail route was found; branch details render as a **side panel** ("لوحة جانبية") opened from a branch-name chip anywhere in the app (e.g. clicking a branch chip on the Warehouses list).
- **Purpose**: Company branch/location master, each owning one or more warehouses, POS terminals, treasury accounts and staff.
- **List view**:
  - Header stats: إجمالي الفروع (total, 1 in this tenant), الفرع الرئيسي (main-branch count, 1), نشط (active, 1).
  - Filter chips: الكل, نشط, غير نشط.
  - Search: "ابحث باسم الفرع أو الكود...".
  - Table columns: اسم الفرع (name), رمز الفرع (code, e.g. MAIN), الفرع الرئيسي (is-main-branch flag), الهاتف (phone), الحالة, row menu.
  - Header action: "إضافة فرع" (add branch).
- **Detail/form view**:
  - **Branch side panel** (quick view, "معاينة سريعة داخل اللوحة", with a "فتح في صفحة كاملة" open-in-full-page escape hatch not explored): كود الفرع, العنوان, الهاتف, البريد الإلكتروني, المستودعات (warehouse count), الموظفون (employee count), الحالة (active + "الفرع الرئيسي" main-branch badge), صافي ربح الشهر (this month's net profit). Tabs: **نظرة عامة** (Overview — إيرادات الشهر/مصروفات الشهر/صافي الربح/رصيد النقدية tiles, المستحقات/المدفوعات/قيمة المخزون tiles, and a **حسابات الخزينة** (treasury accounts) table — الحساب/الكود/النوع/الرصيد, e.g. "صندوق نقدي" CASH-001), **المخزون** (Inventory), **الموظفون** (Employees), **الأصول** (Assets), **نقاط البيع** (POS), **النشاط** (Activity) — only Overview was opened in detail.
  - **Add Branch dialog**: اسم الفرع* (name), رمز الفرع* (code), الهاتف, البريد الإلكتروني, العنوان (address); **الفاتورة الإلكترونية (ETA)** sub-section — كود الفرع لدى المصلحة (tax-authority branch code, "رقم الفرع كما هو مسجل في ملف الممول") and كود النشاط (activity code, "يتجاوز كود النشاط العام للشركة لهذا الفرع" — overrides the company-wide activity code for this branch).
- **Actions**: Add branch, view branch snapshot (financial + operational rollup across every module) via the side panel.
- **Workflows/statuses**: نشط/غير نشط; exactly one branch can be الفرع الرئيسي (main branch).
- **API observed**: `GET /branches`.
- **Notes**: Branches is the true multi-entity root of the app — the branch panel's "قيمة المخزون" (inventory value) tile ties directly back into the Inventory-value figure also shown on the dashboard and the Valuation report, and its treasury-accounts table cross-links into the Treasury module. Each Branch owns its Warehouses (1-to-many) and its own ETA (e-invoice) branch/activity codes, distinct from the per-item ETA codes on Items.

---

### تقييم المخزون (Inventory Valuation report — weighted-average costing / GL reconciliation)

- **Route**: `/reports/inventory/valuation` (reached from Reports → تقارير المخزون, not the Inventory nav group itself — included here because it is the domain's dedicated costing/valuation screen called out explicitly in scope).
- **Purpose**: Show current on-hand quantity × unit cost per item, and reconcile the computed total against the accounting (GL) inventory balance.
- **List view**:
  - Attention banner ("⚡ تحتاج متابعة"): shows the current mismatch amount, e.g. "‎-520.00 ج.م — مطابقة قيمة المخزون مع السجلات المحاسبية" (reconcile inventory value with accounting records).
  - Summary bar: "قيمة المخزون الحالية: 602,935.90 ج.م من السجلات · إجمالي الأصناف: 15" (current inventory value **from the accounting records**, and total item count), expandable into two tiles (قيمة المخزون الحالية / إجمالي الأصناف).
  - Filters: search "بحث بالاسم أو الكود...", المستودع (warehouse autocomplete). Header action: "تصدير" (export).
  - **Reconciliation card** ("مطابقة قيمة المخزون مع السجلات المحاسبية"): three figures side by side — قيمة المخزون من السجلات المحاسبية (value per GL, 602,935.90 ج.م), المحسوب من المخزون × التكلفة (value computed as on-hand qty × unit cost, 602,415.90 ج.م), الفرق (difference, ‎-520.00 ج.م) — with explanatory copy: "هذا الفرق يعني أن قيمة المخزون المحسوبة تختلف عن السجلات المحاسبية. السجلات المحاسبية هي المرجع — راجع قيود الجرد أو رصيد المخزون." (the GL is the source of truth; investigate adjustment entries or stock balance for the gap).
  - Table columns: الصنف (item, side panel + costing-method tag per row, e.g. "متوسط التكلفة"), المخزون الحالي (current qty), تكلفة الوحدة (unit cost), القيمة الإجمالية (line total value = qty × unit cost).
- **Detail/form view**: none — flat report table, row click opens the Item side panel.
- **Actions**: Search/filter by warehouse, sort columns, export.
- **Workflows/statuses**: n/a (report).
- **API observed**: `GET /inventory/valuation?sortDir=DESC&page=1&limit=25`.
- **Notes**: This is the clearest evidence in the whole domain of how weighted-average costing is reconciled against the books — the report openly surfaces a real ‎-520.00 EGP drift between GL-posted inventory value and qty×cost-computed value in this tenant's live demo data, framing the GL as authoritative and pointing the user at adjustment entries / stock balance as the place to investigate. Every sampled row's costing-method tag read "متوسط التكلفة" (weighted-average) — no FIFO-costed items were present in this tenant to compare against.

---

### إدارة المخزون (Inventory Hub / Domain Landing Page) — added by verification pass
- **Route**: `/inventory/hub` — a real, fully-rendered route not linked from the sidebar (the "المخزون" sidebar entry only toggles its submenu open, no `/url`). Found by extracting route-literal strings from the production JS bundle and test-navigating; every domain in the app has one of these at `/{module}/hub` (see `01-sales.md`'s Sales Hub entry for the full write-up of the pattern).
- **Purpose**: Domain dashboard/launcher — "تابع حالة المخزون ونفذ التحويلات والتسويات والجرد" (track inventory status and carry out transfers/adjustments/counts).
- **List view** (tile/dashboard layout):
  - "تحتاج متابعة" (needs attention) card: N أصناف نافدة (out-of-stock items) with a "عرض الرصيد المخزني" deep link, plus a secondary "N تحويلات مسودة" (draft transfers) chip.
  - "إجراءات سريعة" (quick actions) row: تحويل مخزون جديد, تسوية مخزون جديدة, جرد فعلي جديد.
  - "مناطق العمل" tile grid with live counts: الرصيد المخزني (N صنف · N نافدة), الأصناف (N صنف · N نشط), تحويلات المخزون (N تحويل · N مسودة), تسويات المخزون (N تسوية), الجرد الفعلي (N قيد التنفيذ · N مكتمل), حركة المخزون (report link, no count shown), تقييم المخزون (report link, no count shown).
  - "آخر الحركات" (recent movements) panel with two sub-lists: "أحدث التحويلات" (recent transfers — warehouse route, transfer #, status pill) and "أحدث التسويات" (recent adjustments — adjustment #, reason label e.g. "رصيد افتتاحي" opening balance, status pill).
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above; the two report tiles (حركة المخزون, تقييم المخزون) link to `/reports/inventory/movement` and `/reports/inventory/valuation` respectively, confirming the hub is the one place in the app that visually bridges the operational Inventory screens and the Reports-domain inventory reports under one roof.
- **Actions**: Quick-create shortcuts; tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls plus per-tile counts/recent-activity calls for stock levels, items, transfers, adjustments, physical counts (not individually isolated in this pass).
- **Notes**: See `01-sales.md`'s Sales Hub entry for the full discussion of why this whole class of screen was missed by the original recon.
