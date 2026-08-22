# التقارير — Reports

Full inventory and per-report documentation of the REPORTS area (سايدبار → "التقارير") plus the standalone Financial Reports page and Cost-Center P&L, which live under the Accounting module but are themselves reports. Sales module also has one report (تقرير العروض) reachable from its own submenu — cross-referenced here, fully documented in `01-sales.md`.

All routes require an authenticated session (JWT via localStorage). Currency is EGP (`ج.م`). Negative amounts are shown either with a leading `‎-` / en-dash or in parentheses `( 123.00 ج.م )` depending on the widget. Dates in filter inputs use `YYYY-MM-DD`; dates in tables use `DD/MM/YYYY`. All list-style reports share a pagination footer ("عرض 1 - N من N" + a "صفوف لكل صفحة" page-size selector, default 25) and most cell values that reference a customer/supplier/item/account/warehouse are clickable buttons that open a slide-over side panel ("يفتح في لوحة جانبية") with drill-down detail — this is noted once here rather than repeated per report.

## Report inventory (33 reports across 8 domains)

| Domain | Count | Reports |
|---|---|---|
| المبيعات (Sales) | 7 | المبيعات حسب الفترة، المبيعات حسب الصنف، المبيعات حسب العميل، أفضل المنتجات، المبيعات حسب البائع، مبيعات الڤان، تقرير العروض* |
| المشتريات (Purchases) | 3 | المشتريات حسب الفترة، المشتريات حسب المورد، المشتريات حسب الصنف |
| المخزون (Inventory) | 8 | مستويات المخزون، حركة المخزون، سجل المخزون، تقييم المخزون، أعمار المخزون، قرب انتهاء الصلاحية، أصناف بطيئة الحركة، انحراف تقييم المخزون |
| التصنيع (Manufacturing) | 1 | التصنيع مقابل الشراء |
| أعمار الديون (Aging/Debts) | 2 | أعمار ديون العملاء، أعمار ديون الموردين |
| نقاط البيع (POS) | 2 | ملخص المبيعات اليومي، تقارير الورديات |
| الأقساط (Installments) | 2 | نظرة عامة على الأقساط، الأقساط المتأخرة |
| المحاسبة / القوائم المالية (Accounting/Financial Statements) | 8 | ميزان المراجعة، قائمة الدخل، الميزانية العمومية، التدفقات النقدية، إقرار ضريبة القيمة المضافة، دفتر الأستاذ العام، دفتر حساب (all 7 tabs of one page: `/accounting/reports`), أرباح وخسائر مراكز التكلفة (`/accounting/cost-center-pl`) |

\* تقرير العروض (Promotions Report) is nested under Sales → العروض rather than the sidebar's "التقارير" group; full documentation lives in `01-sales.md` (search "تقرير العروض"), summarized again below for completeness.

No standalone reports were found for HR/Payroll, CRM, Assets, Treasury, or Projects — those modules currently have no entries in the "التقارير" sidebar group and none were discovered elsewhere.

---

## المبيعات — Sales reports

### المبيعات حسب الفترة — Sales by Period
- **Route**: `/reports/sales/by-period`
- **Purpose**: "كيف كانت حركة المبيعات يوماً بيوم في الفترة المحددة؟" — day-by-day (or week/month) sales trend for a period, net of discounts, with tax.
- **Parameters/filters**: quick period chips (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة), من تاريخ / إلى تاريخ (defaults: first of month → today), التجميع grouping (يومي / أسبوعي / شهري), القناة channel filter (الكل / فواتير / الڤان / نقطة البيع).
- **Output**: KPI strip (الصافي, الإجمالي, متوسط قيمة الفاتورة, نسبة الخصم, عدد المبيعات). Charts: "صافي المبيعات مقابل الفترة السابقة" (current vs previous period line chart), "من الإجمالي إلى الصافي" (waterfall: gross → discount → tax → net), "الإيراد مقابل عدد الفواتير" (dual-axis), "تكوين الإجمالي" (net goods vs tax stacked). Table columns: التاريخ, عدد المبيعات, الإجمالي, الخصم, الضريبة, الصافي.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/sales/by-period?dateFrom=&dateTo=&groupBy=day|week|month` (called twice per load — once for current period, once for the equivalent previous period for comparison).
- **Notes**: The previous-period comparison call uses the equivalent prior date range automatically (e.g. current 2026-08-01→08-21 also fetches 2026-07-11→07-31).

### المبيعات حسب الصنف — Sales by Item
- **Route**: `/reports/sales/by-item`
- **Purpose**: "ما هي الأصناف الأعلى إيراداً في الفترة المحددة؟" — top revenue-generating items.
- **Parameters/filters**: period chips + من/إلى تاريخ, التصنيف (item category dropdown), الفرع (branch dropdown), القناة (الكل/فواتير/الڤان/نقطة البيع), free-text item search box.
- **Output**: KPI strip (عدد الأصناف, إجمالي الإيرادات, مطابقة دفتر الأستاذ — reconciliation vs GL sales revenue account, أفضل المنتجات — top item name). Pareto/80-20 chart ("تركيز الإيراد") + "أعلى 10 أصناف" bar chart. Table: الصنف (name + SKU), إجمالي الكمية المباعة, الإيرادات, نسبة المساهمة (% contribution).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/sales/by-item?dateFrom=&dateTo=&page=&limit=` (both a chart-sized call with `sortBy=revenue&sortDir=DESC&limit=15` and a full-table call `limit=25`); `GET /api/inventory/categories` (category filter lookup).
- **Notes**: "مطابقة دفتر الأستاذ" explicitly cross-checks the report total against the GL sales-revenue account balance — a built-in reconciliation control.

### المبيعات حسب العميل — Sales by Customer
- **Route**: `/reports/sales/by-customer`
- **Purpose**: "من هم أهم العملاء من حيث الإيرادات والمديونية؟" — top customers by revenue and outstanding balance.
- **Parameters/filters**: period chips + من/إلى تاريخ, الفرع dropdown, القناة (الكل/فواتير/الڤان/نقطة البيع), عرض الإيرادات toggle (شامل الضريبة / غير شامل الضريبة — tax-inclusive vs exclusive), free-text customer search.
- **Output**: KPI strip (عدد العملاء, إجمالي الإيرادات, المستحق — total outstanding). Pareto chart + "أعلى العملاء" bar chart. Table: اسم العميل, عدد المبيعات, الإجمالي, المستحق (with % contribution inline in the same cell).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/sales/by-customer?dateFrom=&dateTo=&page=&limit=&sortBy=total&sortDir=DESC&taxMode=inc|exc`.
- **Notes**: Includes a synthetic "عميل نقدي (نقطة بيع)" (cash/walk-in POS customer) row for anonymous POS sales.

### أفضل المنتجات — Top Products
- **Route**: `/reports/sales/top-products`
- **Purpose**: "ما هي أكثر المنتجات مبيعاً وكيف تتوزع الإيرادات بينها؟" — ranked best-sellers by revenue or quantity.
- **Parameters/filters**: period chips + من/إلى تاريخ, الحد الأقصى (max rows shown, spinbutton, default 20), التصنيف dropdown, الفرع dropdown, القناة (الكل/فواتير/الڤان/نقطة البيع), عرض الإيرادات toggle (شامل/غير شامل الضريبة), ranking metric toggle (إيرادات / كمية — revenue vs quantity).
- **Output**: KPI strip (إجمالي الإيرادات, إجمالي الكمية المباعة, #1 top item). Pareto chart + "أعلى 10 أصناف" bar chart. Table: # (rank), اسم الصنف, إجمالي الكمية المباعة, الإيرادات, نسبة المساهمة.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/sales/top-products?dateFrom=&dateTo=&limit=&taxMode=inc|exc`.
- **Notes**: Essentially a ranked/re-sortable variant of "المبيعات حسب الصنف" with a max-rows control instead of pagination.

### المبيعات حسب البائع — Sales by Salesperson
- **Route**: `/reports/sales/by-salesperson`
- **Purpose**: "مبيعات نقاط البيع منسوبة لكل بائع خلال الفترة — لقياس أداء البائعين" — POS sales attributed to a salesperson, for performance measurement. Explicitly POS-only (invoices aren't attributed to a salesperson).
- **Parameters/filters**: period chips + من/إلى تاريخ, free-text salesperson search.
- **Output**: KPI strip (عدد البائعين, إجمالي عدد المبيعات, إجمالي المبيعات). Table: البائع, عدد المبيعات, الإجمالي, المرتجعات, الصافي, النسبة. Empty-state message observed: "حدد بائعاً عند إتمام البيع في نقطة البيع لتظهر هنا" (no salesperson was tagged in this tenant's POS sales in-period).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/sales/by-salesperson?dateFrom=&dateTo=&sortDir=DESC&page=&limit=`.
- **Notes**: Data-empty in this tenant because POS sales weren't tagged with a salesperson at checkout.

### مبيعات الڤان — Van Sales
- **Route**: `/reports/sales/van`
- **Purpose**: "مبيعات كل رحلة / مندوب / ڤان خلال الفترة — الفواتير والمرتجعات والتحصيلات ومجمل الربح، محسوبة من القيود المحاسبية للمستندات المرتبطة بالرحلة" — per van-trip/rep/van sales, returns, collections and gross profit, computed from the GL postings of linked documents.
- **Parameters/filters**: period chips + من/إلى تاريخ, التجميع grouping (حسب الرحلة / حسب المندوب / حسب الڤان), الڤان free-text filter, المندوب free-text filter, الحالة status dropdown.
- **Output**: KPI strip (عدد الرحلات, عدد الفواتير, صافي المبيعات, المحصل, مجمل الربح). Table: رقم الرحلة (+date), المندوب, الڤان, الحالة, عدد الفواتير, المبيعات (شامل الضريبة), المرتجعات, صافي المبيعات, المحصل, مجمل الربح, فرق النقدية (cash variance).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/sales/van?dateFrom=&dateTo=&groupBy=trip|rep|van&page=&limit=`; `GET /api/hr/employees/search?limit=20` (rep/salesperson picker).
- **Notes**: Row values (المندوب, الڤان) drill down via side panel. This report duplicates/extends the KPI data already visible on the رحلات المندوبين (Van Trips) list under Sales (see `01-sales.md`), but adds gross-profit and cash-variance columns computed from GL.

### تقرير العروض — Promotions Report (cross-reference)
- **Route**: `/sales/promotions/report`
- **Purpose**: Discount granted via promotions across sales invoices and POS sales for a period, net of returns/refunds.
- **Parameters/filters, output, API**: fully documented in `01-sales.md` under "تقرير العروض (Promotions Report)". Summary: period filter chips + من/إلى + الفرع filter; KPI cards (عروض مستخدمة, عدد مرات الاستخدام, إجمالي الخصم الممنوح, صافي الخصم); table columns الرمز, الاسم, النوع, مرات الاستخدام, الخصم الممنوح, خصم معكوس (مرتجعات), صافي الخصم; API `GET /api/sales/promotions/report?dateFrom=&dateTo=`.
- **Notes**: Reachable only from the Sales → العروض submenu header action, not from the sidebar's "التقارير" group — it's a sales-domain report, not grouped with the others.

---

## المشتريات — Purchases reports

### المشتريات حسب الفترة — Purchases by Period
- **Route**: `/reports/purchases/by-period`
- **Purpose**: "كيف تغيرت تكلفة الشراء يوماً بيوم في الفترة المحددة؟" — day-by-day purchase cost trend.
- **Parameters/filters**: period chips + من/إلى تاريخ, التجميع (يومي/أسبوعي/شهري). No branch/warehouse/channel filter (unlike its sales counterpart).
- **Output**: KPI strip (الصافي, الإجمالي, متوسط قيمة الفاتورة, معدل الضريبة, عدد الفواتير). Same chart set as Sales by Period (trend vs previous period, gross→net waterfall, spend vs invoice count, gross composition). Table: التاريخ, عدد الفواتير, الإجمالي, الضريبة, الصافي.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/purchases/by-period?dateFrom=&dateTo=&groupBy=day` (current + previous-period comparison call).
- **Notes**: Structurally a mirror of "المبيعات حسب الفترة" but for purchases (no discount column, since purchase discounts aren't tracked the same way).

### المشتريات حسب المورد — Purchases by Supplier
- **Route**: `/reports/purchases/by-supplier`
- **Purpose**: "على من نعتمد أكثر في مشترياتنا وما هي المستحقات المتبقية؟" — supplier concentration and outstanding payables.
- **Parameters/filters**: period chips + من/إلى تاريخ, الفرع (branch) dropdown.
- **Output**: KPI strip (عدد الموردين, الإجمالي, المستحق). Pareto ("تركيز الإيراد") chart + "أعلى الموردين" bar chart. Table: اسم المورد, عدد الفواتير, الإجمالي, المستحق (with % contribution inline).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/purchases/by-supplier?dateFrom=&dateTo=&page=&limit=&sortBy=total&sortDir=DESC`.
- **Notes**: None beyond the standard drill-down side panel on supplier name.

### المشتريات حسب الصنف — Purchases by Item
- **Route**: `/reports/purchases/by-item`
- **Purpose**: "ما هي الأصناف الأكثر تكلفة في الشراء خلال الفترة المحددة؟" — highest-cost purchased items.
- **Parameters/filters**: period chips + من/إلى تاريخ, التصنيف (category) dropdown, الفرع (branch) dropdown.
- **Output**: KPI strip (عدد الأصناف, إجمالي التكلفة, مطابقة دفتر الأستاذ — GL reconciliation, أكثر صنف شراءً — top item). Pareto chart + "أعلى 10 أصناف" bar chart. Table: الصنف (name + SKU), الكمية المشتراة, التكلفة, نسبة التكلفة.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/purchases/by-item?dateFrom=&dateTo=&page=&limit=&sortBy=cost&sortDir=DESC`; `GET /api/inventory/categories`.
- **Notes**: Same GL-reconciliation pattern as its sales counterpart.

---

## المخزون — Inventory reports

### مستويات المخزون — Stock Levels
- **Route**: `/reports/inventory/stock-levels`
- **Purpose**: "ما الأصناف التي تحتاج تدخلاً الآن؟ الأصناف باللون الأحمر أقل من حد إعادة الطلب" — point-in-time stock status flagging items needing reorder.
- **Parameters/filters**: status chips (الكل / نافد "out of stock" / منخفض "low" / طبيعي "normal", each with live counts), free-text الصنف search, المستودع (warehouse) filter.
- **Output**: KPI strip (إجمالي الأصناف, نافد, أقل من حد إعادة الطلب, إجمالي تقييم المخزون). "⚡ تحتاج متابعة" (needs follow-up) badge. Bar chart "المخزون حسب الصنف والمخزن" (stock by item/warehouse). Table: (icon), اسم الصنف (+SKU), توزيع المستودعات (warehouse count + status badge e.g. "مستوى مقبول"), إجمالي المخزون, إجمالي المتاح, متوسط التكلفة, قيمة المخزون.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/inventory/stock-levels?page=&limit=`; `GET /api/inventory/items/search?q=&limit=20` (item filter lookup); `GET /api/attachments/{id}/download` (a cached branding/logo asset, unrelated to report data).
- **Notes**: Point-in-time snapshot — no date range filter at all, unlike the movement/period-based reports.

### حركة المخزون — Stock Movement
- **Route**: `/reports/inventory/movement`
- **Purpose**: "ما الذي حرك المخزون دخولاً وخروجاً في هذه الفترة؟" — every stock-affecting transaction (in/out) in a period, by source document type.
- **Parameters/filters**: direction chips (الكل / وارد "in" / صادر "out", with counts), period chips + من/إلى تاريخ, الصنف free-text filter, المستودع filter.
- **Output**: KPI strip (عدد العمليات, وارد, صادر, الصافي). "الوارد مقابل الصادر (يوميا)" daily in/out chart. "الحركات حسب نوع المرجع" donut + legend breakdown (أمر إنتاج, تسوية مخزون, فاتورة مشتريات, مرتجع مبيعات, فاتورة مبيعات, تحويل مخزون — with count/qty/% per type). Table: التاريخ, اسم الصنف, المستودع, الاتجاه (وارد/صادر), الكمية, نوع المرجع (+ linked document reference text, e.g. "Finished goods receipt: WO-0009").
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/inventory/movement?dateFrom=&dateTo=&page=&limit=`; `GET /api/inventory/items/search?q=&limit=20`.
- **Notes**: نوع المرجع values are clickable and drill down to the source document (production order, adjustment, purchase/sales invoice, transfer, etc.).

### سجل المخزون — Stock Ledger
- **Route**: `/reports/inventory/ledger`
- **Purpose**: Full chronological stock ledger (event-by-event) with running balance per item/warehouse, analogous to a financial general ledger but for inventory quantity and cost.
- **Parameters/filters**: direction chips (الكل/وارد/صادر), نوع الحركة (movement-type combobox), الصنف filter, المستودع filter, من/إلى تاريخ (blank by default — full history), free-text search box.
- **Output**: KPI strip (إجمالي الحركات, إجمالي الوارد, إجمالي الصادر, صافي التغيير). "أكثر 5 أصناف نشاطا" and "أكثر المخازن نشاطا" charts. Table: الحدث (event/date + source doc e.g. "أمر تشغيل WO-0009"), الصنف, المستودع, الحركة (signed qty, e.g. "+1" / "-2.1"), التكلفة (unit cost at that event), الرصيد (running balance).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/inventory/stock/ledger?page=&limit=50` (main table) plus three summary calls `?limit=1`, `?limit=1&direction=IN`, `?limit=1&direction=OUT` (used to derive the KPI totals); `GET /api/inventory/items/search?q=&limit=20`.
- **Notes**: Explicit disclosure paragraph: "جميع التكاليف معروضة بالعملة الأساسية للشركة (EGP). تم تحويلها وقت التأكيد بسعر الصرف الخاص بالمستند" (all costs shown in base currency, converted at document confirmation FX rate — open the source document for the original currency amount). This endpoint is under `/api/inventory/stock/ledger`, not the `/api/reports/inventory/...` namespace used by most other inventory reports.

### تقييم المخزون — Inventory Valuation
- **Route**: `/reports/inventory/valuation`
- **Purpose**: Current stock valuation per item (qty × unit cost), reconciled against the accounting inventory account balance.
- **Parameters/filters**: free-text search (بحث بالاسم أو الكود), المستودع (warehouse) filter.
- **Output**: KPI strip (قيمة المخزون الحالية, إجمالي الأصناف). "⚡ تحتاج متابعة" badge showing the reconciliation gap (e.g. "-520.00 ج.م"). Reconciliation block "مطابقة قيمة المخزون مع السجلات المحاسبية": قيمة المخزون من السجلات المحاسبية vs المحسوب من المخزون × التكلفة vs الفرق (difference), with explanatory note that accounting records are the reference. Table: الصنف, المخزون الحالي, تكلفة الوحدة (labelled "متوسط التكلفة" = average cost method), القيمة الإجمالية.
- **Actions**: **تصدير (Export) button present** — the only inventory report with a visible export action.
- **API observed**: `GET /api/inventory/valuation?sortDir=DESC&page=&limit=`.
- **Notes**: Endpoint is under `/api/inventory/...`, not `/api/reports/inventory/...`.

### أعمار المخزون — Inventory Aging
- **Route**: `/reports/inventory/aging`
- **Purpose**: "ما الذي تجمد رأس مالك فيه؟ ترى عمر أقدم وحدة من كل صنف في كل مستودع — والبضاعة الأقدم من 180 يوم تستحق المراجعة" — oldest-unit age per item/warehouse (FIFO-style aging), flags stock older than 180 days.
- **Parameters/filters**: age-bucket chips (الكل / أقل من 30 يوم / 30-90 يوم / 90-180 يوم / 180-365 يوم / أكثر من 365 يوم — each with live counts and value), free-text search (اسم الصنف أو الكود), المستودع filter. Same accounting-reconciliation block as Valuation.
- **Output**: KPI strip (إجمالي القيمة, أكثر من 365 يوم, 180-365 يوم). "قيمة المخزون حسب العمر" bar-by-bucket chart with category toggle. Table: الصنف, المستودع, الكمية المتاحة, إجمالي القيمة, العمر (يوم), الشريحة العمرية (age bucket label), آخر استلام (last receipt date).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/inventory/aging?page=&limit=`; `GET /api/inventory/provision/preview` (likely feeds a "provision for slow stock" preview widget).
- **Notes**: All observed stock in this tenant fell under "أقل من 30 يوم" — older buckets were empty (0 items) at capture time.

### قرب انتهاء الصلاحية — Expiring Soon
- **Route**: `/reports/inventory/expiring-soon`
- **Purpose**: "الدفعات المنتهية أو القريبة من الانتهاء — رتبها بنظام الأقرب انتهاء أولاً (FEFO) لتقليل الهدر" — expired/near-expiry batches, FEFO-ordered.
- **Parameters/filters**: status chips (الكل/قرب الانتهاء/منتهية), free-text search (بالصنف أو رقم الدفعة), المستودع filter, المدة (window combobox, default "خلال 30 يوم" = within 30 days).
- **Output**: KPI strip (قيمة المخزون خلال المدة). Two summary badges: منتهية الصلاحية (expired) / قرب الانتهاء (near-expiry), each with value + count. Table: الصنف, الدفعة (batch/lot #), المستودع, تاريخ الانتهاء, المتبقي, الرصيد, القيمة. Empty state observed: "لا توجد دفعات قاربت على الانتهاء".
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/inventory/stock/expiring-soon?withinDays=30&page=&limit=`.
- **Notes**: Requires items to have batch/lot + expiry tracking enabled; this tenant had no expiring batches at capture time. Endpoint not under `/api/reports/...`.

### أصناف بطيئة الحركة — Slow-Moving Items
- **Route**: `/reports/inventory/slow-moving`
- **Purpose**: "ما الذي يجمد رأس المال؟ أصناف لم تباع منذ أكثر من 90 يوم" — items with no/low sales activity tying up capital.
- **Parameters/filters**: severity chips (الكل / خفيف (أقل من 180 يوم) / متوسط (180-364 يوم) / حرج (365+ يوم أو بلا مبيعات)), free-text item search, أيام منذ آخر بيع threshold (spinbutton, default 90), المستودع filter. Same accounting-reconciliation block as Valuation/Aging.
- **Output**: KPI strip (أصناف بطيئة الحركة, رأس المال المجمد "frozen capital", حد الأيام, أصناف حرجة). "رأس المال المجمد حسب الصنف" bar chart with category toggle. Table: اسم الصنف, المخزون الحالي, قيمة المخزون, أيام منذ آخر بيع (or "لا مبيعات" if never sold), تاريخ آخر بيع, مستوى الخطورة (severity badge).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/inventory/slow-moving?daysSinceLastSale=90&page=&limit=&sortBy=valuationAmount&sortDir=DESC`.
- **Notes**: All 4 flagged items in this tenant were "حرج (365+ يوم أو بلا مبيعات)" with status "لا مبيعات" (no sales history at all), not an age-based critical bucket.

### انحراف تقييم المخزون — Inventory Valuation Drift
- **Route**: `/reports/inventory/drift`
- **Purpose**: "هذا التقرير يرصد الأصناف التي اختلفت فيها مصادر تقييم التكلفة الثلاثة (المتوسط المحسوب من جديد، الكاش، طبقات التكلفة) — كل صف يمثل صنفا يحتاج إلى مراجعة أو إعادة بناء" — a data-integrity report comparing three independent costing sources (recomputed average, cache, cost layers) per item and flagging mismatches.
- **Parameters/filters**: type chips (الكل / فارق قيمة فقط "value diff only" / فارق كمية فقط "qty diff only"). "فحص الآن" (Check now / re-run scan) button.
- **Output**: KPI strip (أصناف بها انحراف, إجمالي قيمة الانحراف, أعلى نسبة انحراف, آخر فحص "last scan time"). Table: الصنف, المستودع, كمية المخزون / الطبقات, المتوسط المحسوب, متوسط الكاش, فارق القيمة, أعلى نسبة انحراف, النوع. Empty state observed: "لا توجد انحراف — جميع الأصناف متطابقة بين الكاش وطبقات التكلفة وسجل الحركات."
- **Actions**: "فحص الآن" (trigger a fresh drift scan) — the only inventory report with an explicit "run/refresh" action beyond filtering; not clicked (read-only rule).
- **API observed**: `GET /api/inventory/valuation/drift?page=&limit=&sortBy=maxPctDrift&sortDir=DESC`.
- **Notes**: This is effectively a data-QA/audit tool rather than a business report — useful for catching costing-engine bugs (average cost vs cached cost vs FIFO/cost-layer mismatches).

---

## التصنيع — Manufacturing reports

### التصنيع مقابل الشراء — Make vs. Buy
- **Route**: `/reports/manufacturing/make-vs-buy`
- **Purpose**: "قارن تكلفة تصنيع الصنف مقابل شرائه من مورد، والربح الناتج عند سعر البيع الحالي — لتقرر: تصنع أم تشتري؟" — compares in-house manufacturing cost vs. supplier purchase cost per item, and resulting margin at current sale price, to support make-or-buy decisions.
- **Parameters/filters**: period chips + من/إلى تاريخ, التصنيف (category) free-text filter.
- **Output**: KPI strip (إجمالي التوفير "total savings from making vs buying", أصناف قابلة للمقارنة "comparable items", أصناف مصنعة فقط "manufacture-only items"). Table: الصنف, التصنيع (manufactured qty + unit cost), الشراء (purchase unit cost, "لا توجد بيانات" if never purchased), سعر البيع, هامش التصنيع, هامش الشراء, التوفير بالتصنيع.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/manufacturing/make-vs-buy?dateFrom=&dateTo=&page=&limit=`; `GET /api/inventory/categories`.
- **Notes**: All 3 items in this tenant were "أصناف مصنعة فقط" (manufacture-only, no purchase-cost data to compare against), so التوفير/الهوامش showed "لا توجد بيانات".

---

## أعمار الديون — Aging / Debt reports

### أعمار ديون العملاء — Customer Debt Aging
- **Route**: `/reports/aging/customers`
- **Purpose**: "أين خطر التحصيل؟ العملاء المتأخرون 90 يوماً أو أكثر يحتاجون تدخلاً فورياً" — accounts-receivable aging, flags customers overdue 90+ days as urgent collection risk.
- **Parameters/filters**: حتى تاريخ (as-of date, default today) — a single-date snapshot filter, no range.
- **Output**: KPI strip (عدد العملاء, إجمالي المديونية, عملاء لديهم تأخر, متأخر 90+ يوم). "توزيع المديونيات" donut (share by age bucket) + "أعمار الديون حسب العميل (أعلى 10)" stacked bar (green=current, red=severely overdue). Table (per-customer, buckets as columns): اسم العميل, جاري (current), 31-60 يوم, 61-90 يوم, 91-120 يوم, أكثر من 120 يوم, الإجمالي.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/aging/customers?asOfDate=&page=&limit=`.
- **Notes**: Standard 5-bucket AR aging ladder (current / 31-60 / 61-90 / 91-120 / 120+).

### أعمار ديون الموردين — Supplier Debt Aging
- **Route**: `/reports/aging/suppliers`
- **Purpose**: "أين ضغط السداد؟ الموردون المتأخرون أكثر من 60 يوماً يستحقون أولوية التسديد" — accounts-payable aging, flags suppliers overdue 60+ days for payment prioritization.
- **Parameters/filters**: حتى تاريخ (as-of date snapshot, same pattern as Customer aging).
- **Output**: KPI strip (عدد الموردين, إجمالي المستحق للموردين, المدفوعات المتأخرة للموردين, موردون لديهم تأخر). Same donut + stacked-bar chart pair as Customer aging. Table (per-supplier, same 5 buckets as AR): اسم المورد, جاري, 31-60 يوم, 61-90 يوم, 91-120 يوم, أكثر من 120 يوم, الإجمالي.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/aging/suppliers?asOfDate=&page=&limit=`.
- **Notes**: Mirror-image AP counterpart of Customer Debt Aging, identical structure.

---

## تقارير نقاط البيع — POS reports

### ملخص المبيعات اليومي — Daily Sales Summary
- **Route**: `/reports/pos/daily`
- **Purpose**: "كيف كان أداء الفترة؟ ملخص المبيعات والمدفوعات والأصناف الأكثر طلبا" — POS performance summary: sales, payments breakdown, top items, hourly pattern.
- **Parameters/filters**: period chips + من/إلى تاريخ.
- **Output**: KPI strip (إجمالي المبيعات, إجمالي المرتجعات, صافي المبيعات, عدد العمليات). "نمط المبيعات الساعي" hourly heat/line chart (highlights ذروة النشاط = peak activity hour). "طرق الدفع" (payment methods) with a توزيع المدفوعات (distribution donut) / تفاصيل المدفوعات (details) toggle, showing e.g. CASH 100%. "أفضل الأصناف" (top items) with a مخطط (chart) / جدول (table) view toggle.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/pos/daily?dateFrom=&dateTo=`.
- **Notes**: Single combined API call (no pagination — this is a dashboard-style aggregate report, not a row-level list).

### تقارير الورديات — Shift Reports
- **Route**: `/reports/pos/shifts`
- **Purpose**: "أي وردية تبيع أكثر، وأيها يحدث فيها عجز نقدي؟ افتح الوردية لرؤية جلسات الكاشير التي فُتحت داخلها" — compares POS shifts by sales volume and cash-drawer variance; opening a shift drills into its cashier sessions.
- **Parameters/filters**: period chips + من/إلى تاريخ.
- **Output**: KPI strip (إجمالي الجلسات, إجمالي عدد المبيعات, كاش, آجل "on credit", الصافي, الفرق "variance"). Table: الورديات (shift name, e.g. "خارج الورديات" = outside defined shifts), عدد الجلسات, عدد المبيعات, الإجمالي, كاش, آجل, تحصيل (collections), المرتجعات, الصافي, الفرق (with a "متوازن" = balanced status badge).
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/pos/shifts?dateFrom=&dateTo=&sortDir=DESC`.
- **Notes**: In this tenant all activity fell under a synthetic "خارج الورديات" (outside shifts) row, meaning no named POS shift schedule was configured/used during the period.

---

## تقارير الأقساط — Installment reports

### نظرة عامة على الأقساط — Installments Overview
- **Route**: `/reports/installments/overview`
- **Purpose**: "ما وضع المحفظة الآن؟ المخطط النشط وما نسبة التحصيل في كل خطة" — installment-plan portfolio status and collection rate per plan.
- **Parameters/filters**: none visible beyond the shared header — no explicit filter panel was rendered (no data to filter, see Notes).
- **Output**: KPI strip (الخطط النشطة, إجمالي المستحق, عدد المتأخرات, مبلغ المتأخرات, المحصل هذا الشهر). Table: رقم الخطة, العميل, المبلغ الكلي, نسبة السداد, المبلغ المتبقي, الأقساط, تاريخ البدء, الحالة. Empty state observed: "لا توجد بيانات".
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/installments/overview`; `GET /api/installments/plans?page=1&limit=25&status=ACTIVE` (feeds the plans table).
- **Notes**: No active installment plans existed in this tenant at capture time, so filter controls may not have rendered — worth re-checking once seed data with active plans exists.

### الأقساط المتأخرة — Overdue Installments
- **Route**: `/reports/installments/overdue`
- **Purpose**: "قائمة الأقساط المتأخرة مرتبة حسب الأولوية — الأحمر يحتاج تدخلاً فورياً" — overdue installments ranked by urgency.
- **Parameters/filters**: overdue-bucket chips (الكل / 1-30 يوم / 31-60 يوم / 61-90 يوم / 91+ يوم).
- **Output**: KPI strip (أقساط متأخرة, إجمالي المتأخر, متأخر 90+ يوم). Table: # (rank), اسم العميل, رقم خطة التقسيط, المبلغ, المبلغ المتبقي, تاريخ الاستحقاق, أيام التأخير. Empty state observed: "لا توجد بيانات".
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/reports/installments/overdue?page=&limit=`.
- **Notes**: Same 4-bucket overdue ladder pattern as elsewhere in the app; empty in this tenant.

---

## المحاسبة / القوائم المالية — Accounting / Financial Statements

All seven of the following are **tabs on a single page**, `/accounting/reports` ("التقارير المالية"), switched via in-page buttons rather than separate URLs — the tab set (ميزان المراجعة / قائمة الدخل / الميزانية العمومية / التدفقات النقدية / إقرار ضريبة القيمة المضافة / دفتر الأستاذ العام / دفتر حساب) is always visible at the top of the page. Every account code/name cell across all tabs is clickable ("يفتح في لوحة جانبية") and opens a side-panel drill-down into that account's transactions. `تصدير` (Export) appears only on the ميزان المراجعة / قائمة الدخل / الميزانية العمومية / التدفقات النقدية tabs — not on إقرار ضريبة القيمة المضافة, دفتر الأستاذ العام, or دفتر حساب.

### ميزان المراجعة — Trial Balance
- **Route**: `/accounting/reports` (tab: ميزان المراجعة)
- **Purpose**: Full chart-of-accounts trial balance as of a date — debit/credit balance per account, confirming books are balanced.
- **Parameters/filters**: حتى تاريخ (as-of date, single-date snapshot).
- **Output**: Summary check (إجمالي المدين = إجمالي الدائن, shown with a literal "=" sign). Full hierarchical account table: رقم الحساب, اسم الحساب, مدين (debit), دائن (credit) — includes header/group rows (e.g. "1000 الأصول") and every leaf account down to zero-balance ones.
- **Actions**: تصدير (Export). Account rows drill into the side-panel ledger detail.
- **API observed**: `GET /api/accounting/reports/trial-balance?asOfDate=`.
- **Notes**: This was the default/first-loaded tab when navigating to `/accounting/reports` (or `/reports`, which redirects here) — 627,867.30 ج.م debit = credit balanced in this tenant.

### قائمة الدخل — Income Statement
- **Route**: `/accounting/reports` (tab: قائمة الدخل)
- **Purpose**: Period profit & loss statement — revenue, COGS, gross profit, operating expenses, operating income, other income/expense, net income.
- **Parameters/filters**: من / إلى (period range), الفرع (branch dropdown, default "جميع الفروع"), "مقارنة بالعام الماضي" (compare to last year) toggle button.
- **Output**: KPI strip (إجمالي الإيرادات, إجمالي المصروفات, صافي الدخل). Multi-section table with subtotal rows per group: الإيرادات → إجمالي الإيرادات; مردودات وخصومات المبيعات → إجمالي المرتجعات والخصومات; صافي الإيرادات; تكلفة البضاعة المباعة → الإجمالي; مجمل الربح (gross profit); المصاريف التشغيلية → الإجمالي; الدخل التشغيلي (operating income); إيرادات أخرى (continues below the captured fold). Each line item shows account code + name + amount, negative/expense amounts in parentheses.
- **Actions**: تصدير (Export). "مقارنة بالعام الماضي" adds a prior-year comparison column (not exercised — read-only). Line items drill into side panel.
- **API observed**: `GET /api/accounting/reports/income-statement?periodFrom=&periodTo=`.
- **Notes**: Structured as a proper multi-step income statement (gross profit and operating income are explicit subtotal lines, not just a flat revenue-minus-expense list).

### الميزانية العمومية — Balance Sheet
- **Route**: `/accounting/reports` (tab: الميزانية العمومية)
- **Purpose**: Point-in-time balance sheet — assets, liabilities, and equity, verifying Assets = Liabilities + Equity.
- **Parameters/filters**: حتى تاريخ (as-of date), الفرع dropdown, "مقارنة بالعام الماضي" toggle.
- **Output**: KPI strip (إجمالي الأصول, إجمالي الخصوم, إجمالي حقوق الملكية) plus an explicit balance check row (Assets = Liabilities + Equity). Three separate tables: الأصول (grouped e.g. "الأصول المتداولة" with subtotal), الالتزامات (grouped "الالتزامات المتداولة" with subtotal), حقوق الملكية (grouped e.g. "رأس مال الملاك" with subtotal). Each leaf row: account code + name + balance.
- **Actions**: تصدير (Export). "مقارنة بالعام الماضي" toggle. Account rows drill into side panel.
- **API observed**: `GET /api/accounting/reports/balance-sheet?asOfDate=`.
- **Notes**: Balanced at capture time: 606,056.20 = 418.70 + 605,637.50 ج.م.

### التدفقات النقدية — Cash Flow Statement
- **Route**: `/accounting/reports` (tab: التدفقات النقدية)
- **Purpose**: Period cash flow statement (indirect method) — operating, investing, and financing activities, reconciling opening to closing cash balance.
- **Parameters/filters**: من / إلى (period range), الفرع dropdown, "مقارنة بالعام الماضي" toggle.
- **Output**: KPI strip (الأنشطة التشغيلية, الأنشطة الاستثمارية, الأنشطة التمويلية, صافي التغيير). Reconciliation row: الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي. Table grouped by activity: الأنشطة التشغيلية (starts from صافي الدخل, then indirect-method adjustments: التغير في الذمم المدينة, التغير في المخزون, التغير في الذمم الدائنة, التغير في الضرائب المستحقة → صافي التدفق); الأنشطة الاستثمارية → صافي التدفق; الأنشطة التمويلية (e.g. التغير في حقوق الملكية) → صافي التدفق; then صافي التغيير / الرصيد الافتتاحي / الرصيد الختامي.
- **Actions**: تصدير (Export). "مقارنة بالعام الماضي" toggle. Line items drill into side panel.
- **API observed**: `GET /api/accounting/reports/cash-flow?periodFrom=&periodTo=`.
- **Notes**: Correctly uses the indirect method starting from net income, standard working-capital adjustment lines.

### إقرار ضريبة القيمة المضافة — VAT Return
- **Route**: `/accounting/reports` (tab: إقرار ضريبة القيمة المضافة)
- **Purpose**: VAT return summary for a period — output tax (sales) vs. input tax (purchases) by tax rate, net VAT payable.
- **Parameters/filters**: من / إلى (period range). No branch filter, no export button, no comparison toggle (only tab lacking all three among the financial statements).
- **Output**: KPI strip (ضريبة المخرجات (المبيعات), ضريبة المدخلات (المشتريات), صافي الضريبة) with an explicit formula row (output − input = net, "مستحق الدفع"). Two tables, each broken down by tax rate: "ضريبة المخرجات (المبيعات)" (نسبة الضريبة %, الوعاء الخاضع "taxable base", مبلغ الضريبة) with an الإجمالي total row; "ضريبة المدخلات (المشتريات)" — same columns/total structure.
- **Actions**: No export button. Line items are plain (rate-bucket rows, not individual documents), so no drill-down observed on this tab.
- **API observed**: `GET /api/accounting/vat-return?periodFrom=&periodTo=` (note: not under `/api/accounting/reports/...` like the other five tabs).
- **Notes**: Rate buckets observed: 0.00% and 14.00% (Egypt's standard VAT rate) on the output side; only 0.00% appeared on the input side in this tenant's data.

### دفتر الأستاذ العام — General Ledger
- **Route**: `/accounting/reports` (tab: دفتر الأستاذ العام)
- **Purpose**: Full general-ledger transaction listing across all accounts for a period (all journal-entry line items).
- **Parameters/filters**: من / إلى (period range, pre-filled with current-month defaults), بحث عن حساب (account search box). Requires clicking "عرض التقرير" (Run report) — it does **not** auto-load like the other tabs.
- **Output**: Placeholder state captured ("اختر الفترة لعرض التقرير" — "select the period to view the report") since the run button wasn't clicked (read-only exploration stopped short of triggering a potentially heavy report generation). Column/table structure not observed.
- **Actions**: "عرض التقرير" (Run report) button — must be clicked to generate. No export button visible in the placeholder state (may appear only after running).
- **API observed**: No `general-ledger`-specific endpoint fired (report not run); only the shared page-load calls (accounts list/select, and the other tabs' default endpoints prefetched by the page shell).
- **Notes**: Unlike the other financial-statement tabs, this one is explicitly on-demand rather than auto-computed on tab switch — likely because a full GL dump is expensive to generate. Re-visit with "عرض التقرير" clicked to fully document output columns in a future pass.

### دفتر حساب — Account Ledger (Statement)
- **Route**: `/accounting/reports` (tab: دفتر حساب)
- **Purpose**: Single-account ledger/statement — all transactions and running balance for one selected account over a period (like a bank statement, but for any GL account).
- **Parameters/filters**: من / إلى (period range), الحساب (account picker, required — "اختر حساب..."). "عرض التقرير" button is **disabled** until an account is selected.
- **Output**: Placeholder state captured ("اختر الحساب والفترة الزمنية لعرض التقرير") — account wasn't selected, so no report data/columns were generated.
- **Actions**: "عرض التقرير" (disabled until account chosen). No export button visible in placeholder state.
- **API observed**: `GET /api/accounting/accounts/select?q=&limit=50` (account picker lookup); no ledger-specific data endpoint fired.
- **Notes**: This is presumably the report a user reaches after clicking an account code's "يفتح في لوحة جانبية" drill-down elsewhere, but as a full-page report with its own date range rather than a side panel. Re-visit with an account selected to document full output.

### أرباح وخسائر مراكز التكلفة — Cost Center P&L
- **Route**: `/accounting/cost-center-pl` (separate route, not a tab of `/accounting/reports`, but functionally a financial report — reachable from the Accounting sidebar submenu right below "مراكز التكلفة")
- **Purpose**: Profit & loss broken out by cost center, to see which cost center drives revenue/expense.
- **Parameters/filters**: من تاريخ / إلى تاريخ (period, default Jan 1 → today), مركز التكلفة (cost-center free-text filter, default "كل مراكز التكلفة").
- **Output**: KPI strip (إجمالي الإيرادات, إجمالي المصروفات, صافي الربح). Table: مركز التكلفة, النوع, الإيرادات, المصروفات, الصافي. Includes a "غير مخصص لمركز تكلفة" (unassigned to any cost center) catch-all row.
- **Actions**: No export/print button observed.
- **API observed**: `GET /api/accounting/reports/cost-center-pl?periodFrom=&periodTo=`; `GET /api/accounting/cost-centers/select?q=&limit=20` (filter lookup).
- **Notes**: Explicit caveat paragraph: "القيم مشتقة من دفتر الأستاذ (القيود المرحلة فقط) بعملة المنشأة الأساسية. تكاليف العمالة والأعباء التي تُرسمل على الإنتاج تحت التشغيل لا تظهر هنا وقت تسجيلها على أمر التصنيع، بل تظهر كتكلفة مبيعات عند بيع المنتج" — labor/overhead capitalized into WIP on a manufacturing order isn't recognized here until the finished product is sold (it appears as COGS at sale time, not at production time). All activity in this tenant fell into the "غير مخصص لمركز تكلفة" catch-all — no cost centers were actually assigned to transactions.

---

## Cross-cutting notes

- **No global export/print** is a consistent pattern: of the 32 reports living under `/reports/*` and `/accounting/*`, only تقييم المخزون and the four "core" financial statements (ميزان المراجعة، قائمة الدخل، الميزانية العمومية، التدفقات النقدية) expose a تصدير button. Everything else is view-only in this build.
- **GL reconciliation is a recurring design pattern**: المبيعات حسب الصنف, المشتريات حسب الصنف, تقييم المخزون, أعمار المخزون, and أصناف بطيئة الحركة all show an explicit "does this report's total match the general ledger?" check, treating the GL as the source of truth over the operational computation.
- **Two on-demand (non-auto-run) reports**: دفتر الأستاذ العام and دفتر حساب require an explicit "عرض التقرير" click and weren't run in this pass (read-only, avoided triggering a potentially expensive query) — worth a follow-up capture with the run button clicked and (for دفتر حساب) an account selected first.
- **API namespace inconsistency**: most `/reports/*` pages call `GET /api/reports/<domain>/<name>`, but several inventory reports instead hit un-namespaced endpoints — `GET /api/inventory/valuation`, `GET /api/inventory/stock/ledger`, `GET /api/inventory/stock/expiring-soon`, `GET /api/inventory/valuation/drift` — and the VAT return hits `GET /api/accounting/vat-return` rather than `GET /api/accounting/reports/vat-return`. Worth flagging to engineering if a consistent `/api/reports/...` contract is expected.
- **Empty-state coverage**: several reports (المبيعات حسب البائع, أعمار المخزون's higher buckets, قرب انتهاء الصلاحية, انحراف تقييم المخزون, نظرة عامة على الأقساط, الأقساط المتأخرة) were empty in this demo tenant — their table/empty-state copy was captured, but full populated-row behavior (e.g. what a "critical" installment aging row or a real cost drift row looks like) couldn't be observed and should be revisited against a richer dataset.
