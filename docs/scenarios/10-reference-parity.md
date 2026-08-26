# Reference parity — UI test scenarios

## Sources

- `docs/reference-parity/gap-inventory.md` — the live diff of 101 reference routes against 116 Mezan routes, plus the round-2 deep pass over forms, detail panels, tabs and row menus.
- `docs/reference-parity/parity-tasks.md` — the ordered work list these scenarios verify.
- `docs/defects.md` — D43 (four "(المرحلة الثانية)" placeholders), D44 (cost-centre columns), D45 (three empty list surfaces).

## Conventions

- Run every scenario in **both locales** (ar/RTL default, en/LTR) and **both themes**. A scenario passes only if it passes in all four combinations.
- **Reload the page after every save.** Several past defects only appeared on the second look.
- A scenario tagged **`[PARITY]`** describes behaviour the reference has and Mezan does not yet. It is expected to fail until its `parity-tasks.md` item is ticked — record the failure, do not re-file it.
- A scenario tagged **`[AHEAD]`** protects something Mezan does that the reference does not. It must keep passing; a regression here is a real defect.
- IDs are `PAR-001`, `PAR-002`, … grouped by the phase in `parity-tasks.md`.

---

## P0 — defects

**PAR-001 — no placeholder text survives on a wired surface (D43).**
Open `#/inventory/items`, open any item, go to the المخزون tab. Expect per-warehouse rows with متاح / محجوز / الإجمالي whose totals equal what `/reports/inventory/stock-levels` reports for the same item. Expect **no** occurrence of the string «المرحلة الثانية» anywhere in the app: search the rendered DOM of the item detail, the chart-of-accounts detail and the treasury-account detail. Currently fails on all three.

**PAR-002 — cost centres show cost-centre columns (D44).**
Open `#/accounting/cost-centers`. Expect headers الكود / الاسم / النوع / مرتبط بـ / المركز الرئيسي / الحالة. Currently shows the Chart-of-Accounts headers.

**PAR-003 — no list surface is empty (D45).**
Open `#/inventory/configurable-products`, `#/manufacturing/custom-manufacturing`, `#/installments/installment-follow-ups`. Each must render at least one seeded row. Then run `pnpm check:seed` and confirm all three appear in its surface list.

## P1 — shell

**PAR-010 — the sidebar nests three levels.**
Expand التقارير. Expect six sub-groups (المبيعات، المشتريات، المخزون، التصنيع، الأعمار، الأقساط), each collapsed, each expanding to its own reports — not 22 flat entries. Repeat for المخزون → المنتجات, التصنيع → الإنتاج, الإعدادات, المحاسبة, الموارد البشرية.

**PAR-011 — keyboard reaches every level.**
With the sidebar focused, Tab/Arrow through the tree in RTL. Focus order must follow visual order, and a collapsed sub-group's children must not be focusable.

## P2 — reports

**PAR-020 — every report opens with today's date.**
Open `#/reports/report-sales-by-period`. The من/إلى defaults must bracket the real current date, not 2026-08-22. Repeat on three other reports.

**PAR-021 — KPI strip and charts.**
On sales-by-period expect a KPI strip (الصافي، الإجمالي، متوسط قيمة الفاتورة، نسبة الخصم، عدد المبيعات) and at least the four reference charts: current-vs-previous trend, gross→net waterfall, revenue-vs-count dual axis, total composition. Values in the strip must equal the table's grand totals.

**PAR-022 — period chips re-run the report.**
Click هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة. Each must change the date inputs, fire one request, and change the KPI strip. Reload and confirm the chip state is in the URL.

**PAR-023 — % contribution sums to 100.**
On sales-by-item, sum نسبة المساهمة across all pages. Expect 100.0% ± 0.1.

**PAR-024 — GL reconciliation tile.**
On sales-by-item, the مطابقة دفتر الأستاذ tile must compare the report total against the GL revenue account and show the difference. Force a mismatch by posting a manual journal to the revenue account and confirm the tile reports it.

**PAR-025 — drill-down panel.**
Click a customer cell on sales-by-customer. Expect a side panel with that customer's detail, not a navigation.

**PAR-026 `[AHEAD]` — export survives.**
Every report keeps تصدير CSV and تصدير Excel. The reference has neither; do not drop them.

## P3 — document detail

**PAR-030 — sales-invoice tab set.**
Open a confirmed sales invoice. Expect eight tabs: البنود، المدفوعات، المرتجعات، الأقساط، القيود المحاسبية، الفاتورة الإلكترونية، المرفقات، سجل المراجعة.

**PAR-031 — actions reachable from the document.**
From the invoice: تحصيل creates a receipt voucher pre-filled with the customer and outstanding amount; مرتجع جديد from the المرتجعات tab opens a return bound to this invoice; إنشاء خطة أقساط from الأقساط opens a plan bound to this invoice; إرسال from the ETA tab enqueues a submission. Each must post and then be visible after a reload.

**PAR-032 — totals block is complete.**
Expect المجموع الفرعي، الضريبة، الإجمالي الكلي، إجمالي التكلفة، إجمالي الربح، هامش الربح. `المجموع الفرعي + الضريبة` must equal `الإجمالي الكلي` exactly.

**PAR-033 `[AHEAD]` — return-adjusted net.**
خصم المرتجعات المؤكدة and الصافي بعد المرتجعات must stay on the invoice. The reference has neither.

**PAR-034 — "تأثيرات هذا المستند" states all three effects.**
Stock decrement, AR increase, and explicitly that no collection happens automatically, each with the action that does it.

**PAR-035 — attachments round-trip.**
Attach a file to an invoice, reload, confirm it is listed and downloadable. Repeat on an item, a customer and an employee.

**PAR-036 — purchase-invoice line grid.**
Expect المستهلك / المستلم alongside الكمية, and a التكاليف الإضافية tab listing any landed-cost document that allocated onto this invoice.

## P4 — entity 360

**PAR-040 — customer statement ties to the ledger.**
Open a customer, open كشف حساب. Columns التاريخ / المرجع / النوع / مدين / دائن / الرصيد الجاري. The closing الرصيد الجاري must equal that customer's balance on the customers list **and** their share of GL 1100.

**PAR-041 — supplier statement ties to the ledger.** Same, against GL 2100.

**PAR-042 — customer action bar.**
إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد each open the right form with the customer pre-selected.

**PAR-043 — item stock by warehouse includes reserved.**
متاح + محجوز must equal الإجمالي for every warehouse row, and the sum across warehouses must equal the stock-levels report.

**PAR-044 — cost layers are visible and ordered.**
The item's التكلفة tab lists layers with الكمية المتبقية / تكلفة الوحدة / المصدر / التاريخ, oldest first, and their weighted average equals the item's WAC to the cent.

**PAR-045 — row overflow menus.**
Every list row exposes عرض / تعديل / تعطيل / حذف, gated by permission. تعطيل on a referenced record must refuse in Arabic, not with a raw enum.

**PAR-046 — inline opening-balance actions.**
تحديد الرصيد الافتتاحي on a zero-stock item and إضافة رصيد افتتاحي on a treasury account each post a balanced entry dated the document's date, not `now()`.

## P5 — missing features

**PAR-050 — eleven voucher types.**
سند جديد opens a card grid of eleven types, each with its explanatory sentence. Create one of each; every one posts a balanced entry, and the type survives a reload. Check the GL accounts specifically for ضخ رأس مال من الشريك and سحب شخصي للشريك (equity, not income/expense) and for دفع لمصلحة الضرائب (the tax payable account, not a generic expense).

**PAR-051 — six item types.**
منتج / خدمة / مادة خام / منتج نهائي / مستهلك / وصفة. A خدمة must not create stock movements; a مادة خام must be selectable on a BOM; a وصفة must not be sellable directly.

**PAR-052 — purchase-invoice line types.**
A مصروف line must post to an expense account and create no stock movement; a شحن line must be capitalisable into landed cost; a مخزني line behaves as today.

**PAR-053 — adjustment reason wizard.**
New adjustment offers the eight reasons. Each must map to its own GL contra account, and the reason must appear on the resulting journal entry's description and on the adjustment list.

**PAR-054 — work-order shop-floor actions.**
صرف إضافي، إرجاع مواد، تسجيل فاقد، تسجيل تكلفة، استلام المنتج. After each, the materials grid's الصادرة / المرجعة / الصافي / النقص must recompute, and WIP must equal issued cost minus received cost.

**PAR-055 — returns start from a source document.**
Creating a sales return without picking a source invoice must be impossible. Same for purchase returns. The returnable quantity must be recomputed server-side from posted documents, never taken from the request body.

**PAR-056 — coupon on a sales invoice.**
Entering a valid coupon applies its discount; an expired or over-limit coupon refuses in Arabic; the applied coupon is recorded on the invoice and appears in the promotions report.

**PAR-057 — customer form advanced options.**
الشعار، رقم التسجيل التجاري، إعفاء ضريبي، نوع العميل، جهة الاتصال all save and survive a reload. إعفاء ضريبي must suppress tax on that customer's next invoice.

**PAR-058 — transfer import from Excel.**
Import a sheet of item/qty rows; unknown SKUs must be reported by row number, not silently dropped. The line grid shows المخزون المتاح per line and refuses a transfer above it.

## P6 — list surfaces

**PAR-060 — purchase-invoice payment dimension.**
Chips متأخرة / تستحق قريباً / مدفوع جزئياً / مدفوع filter correctly, and the KPI strip shows money (المدفوع للموردين، إجمالي المرتجعات، المدفوعات غير المخصصة، رصيد الفواتير غير المدفوعة) whose total ties to GL 2100.

**PAR-061 — items list shows stock.**
A المخزون column with a low/out-of-stock state, chips for each state, and تصنيفات الأصناف / تصدير actions.

**PAR-062 — every document list filters by branch, warehouse and date.**
Walk each list in `parity-tasks.md` P6 and confirm the filter bar, the active-filter count, and that filters survive a reload.

**PAR-063 — ETA has all five tabs.**
الإعدادات العامة، بيانات الاعتماد، ربط الأصناف، ربط الوحدات، الإرسالات. Credentials must never render in plain text after save.

**PAR-064 — settings has all policy tabs.**
البريد الإلكتروني، ضبط الائتمان، سياسة المخزون، ضبط المشتريات، سياسة الخزينة. Changing a credit-control setting must change what the sales invoice does at the credit limit.

**PAR-065 — approvals has three tabs.**
صندوق الوارد / طلباتي / إجراءاتي, each scoped to the signed-in user.

**PAR-066 — leave requests can be created.**
The طلب إجازة جديد action exists on `#/hr/leave-requests` and produces a request visible to the approver.

## Locale pass

**PAR-070 — English/LTR sweep.**
Switch to English and re-walk every screen touched above. No Arabic string may remain in the English UI, no English enum may leak into the Arabic UI, the layout must mirror, and digits must render Latin in en and Arabic-Indic in ar.
