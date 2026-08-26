# Requirements captured from the reference product

Round 3 of the parity audit, run through the UI with the `site-feature-audit`
method. Each requirement below was **observed in a running screen**, not inferred
from prose. Screenshots are in `screenshots/`; the read API contract is in
`API-SURFACE.md`; what was *not* seen is in `COVERAGE.md`.

Requirements are written as behaviour to build, in our own terms. No markup, CSS,
asset or body copy was carried over — short control labels are used as identifiers
only, per the audit's operating rules.

Priority key: **P0** correctness/defect · **P1** blocks a workflow ·
**P2** materially better · **P3** nice to have

---

## 1. Platform-wide

| # | Requirement | Pri |
|---|---|---|
| R1.1 | **Every list resource needs three server endpoints**, not one: rows (`?limit&page&sort&filters`), `…/counts` for the status chips, `…/stats` for the money KPIs. Chip counts and KPI figures must be computed server-side across the whole filtered set. Today Mezan derives both from the loaded page, so they are wrong past page 1. | **P0** |
| R1.2 | **Picker endpoints** (`…/select` / `…/search` returning id + label only) for every entity a form binds to: accounts, cost centres, branches, warehouses, roles, employees, items, customers, suppliers, price lists, treasury accounts. This is the server half of the no-free-text rule. | **P1** |
| R1.3 | **Row overflow menu on every list row**, whose contents are derived from the row's lifecycle state. Observed: a converted quote offers عرض/طباعة; a draft one adds تعديل/حذف; an open invoice offers إنشاء مرتجع مبيعات and إنشاء خطة أقساط and إلغاء الفاتورة; a paid one drops the cancel; a draft transfer adds تأكيد. | **P1** |
| R1.4 | **Attachments as a first-class resource** with an upload control and a download route, exposed on invoices, quotes, orders, returns, items, customers, suppliers and employees. | **P1** |
| R1.5 | **Command palette** on Ctrl+K with two sections: quick actions (new sales invoice, collect payment, new cash voucher, receive goods, pay supplier) and go-to entries for every screen. | **P2** |
| R1.6 | **Notification centre** with الكل / غير مقروء tabs, mark-all-read, and a "see all" route. | **P2** |
| R1.7 | **System-status indicator** in the header, backed by a status endpoint. | **P3** |
| R1.8 | **Support entry point** in the header. | **P3** |
| R1.9 | **Attention banners at the top of a list** — "2 overdue invoices need follow-up" with a link that applies the filter; "693 items out of stock"; "1 draft transfer". Distinct from KPI tiles: these are actionable exceptions. | **P2** |
| R1.10 | **Empty states carry a call to action**, not just a message ("لا توجد فواتير بعد — ابدأ بإنشاء…" plus the create button). | **P2** |
| R1.11 | **Collapsible KPI strip** above the filter bar on every list. | **P3** |
| R1.12 | **Page-size selector** (10/25/50/100) on every list. | **P3** |
| R1.13 | **Active-filter count badge** on the filter toggle (`تصفية النتائج 1`). | **P2** |
| R1.14 | **Branch and warehouse are a global scope** in the header, not a per-list filter, and every list also carries its own branch/warehouse filter. | **P1** |
| R1.15 | **11 document currencies** selectable per document (EGP, SAR, AED, QAR, KWD, BHD, OMR, JOD, USD, EUR, GBP). | **P1** |
| R1.16 | **Customer and supplier balances are tracked per currency**, not collapsed to base. | **P1** |

## 2. Documents — shared behaviour

| # | Requirement | Pri |
|---|---|---|
| R2.1 | **Creation method step** on the sales and purchase invoice: "new document, enter lines manually" vs "create from an accepted quote / from a confirmed goods receipt". | **P1** |
| R2.2 | **A return cannot exist without a source document.** Both sales and purchase return creation start with — and only with — a source-invoice picker. Returnable quantity must be recomputed server-side from posted documents. | **P0** |
| R2.3 | **Line grid shows live availability**: available quantity per line, and an out-of-stock badge, resolved for the document's warehouse. | **P1** |
| R2.4 | **Per-line unit of measure** picker (base unit plus alternates, e.g. piece / carton) with conversion. | **P1** |
| R2.5 | **Per-line discount type**: percentage or fixed amount. Same choice again at document level. | **P1** |
| R2.6 | **Coupon code** entry with an apply action on the sales invoice. | **P2** |
| R2.7 | **Totals block**: subtotal (after discounts), tax, grand total, total cost, total profit, profit margin %. Mezan additionally shows confirmed-return deduction and net-after-returns — keep those. | **P1** |
| R2.8 | **"Effects of this document" explainer** — three cards stating the stock movement, the AR/AP movement, and explicitly that no cash is collected automatically, each naming the action that does it. | **P2** |
| R2.9 | **Quick-preview side panel** over the list with a "open in full page" link. | **P3** |
| R2.10 | **Share a document**: share PDF, share via…, copy link. | **P3** |
| R2.11 | **Cross-document creation from the row menu and from the detail tabs** — create a return or an installment plan directly from the invoice; create an invoice, receipt voucher or quote directly from the customer. | **P1** |

## 3. Sales

| # | Requirement | Pri |
|---|---|---|
| R3.1 | Sales-invoice status chips: الكل / مفتوح / متأخر / مسودة / مؤكد / مدفوع جزئياً / مدفوع / ملغي. Overdue rows show "متأخر N يوم" inline. | **P1** |
| R3.2 | Sales-invoice KPI strip in money: total sales, collected, returned, **unallocated receipts**, remaining. | **P1** |
| R3.3 | **Channel filter** on the invoice list: all / direct (office or shop) / van sales (POS descoped). | **P2** |
| R3.4 | Invoice detail tabs: lines, payments, returns, **installments**, journal entries, e-invoice, **attachments**, audit log. Payments tab lists voucher no. / amount / date. | **P1** |
| R3.5 | Inline **تحصيل** (collect) action on each open invoice row, pre-filling customer and outstanding amount. | **P1** |
| R3.6 | **Customer 360**: header actions create invoice / collect payment / new quote / statement; tabs invoices, **statement of account** (date, reference, type, debit, credit, running balance), installments, returns, **loyalty points**, attachments, audit log. | **P1** |
| R3.7 | **Loyalty points** sub-ledger on the customer: balance, total earned, total redeemed, per-invoice source rows, manual adjustment. | **P3** |
| R3.8 | Customer form: name, logo, payment terms (days), currency, credit limit, code (auto if blank), price list, category (+ create inline); advanced: phone with country, email, tax registration number, commercial registration number, **tax-exempt flag**, **entity type** (auto / company / individual), contact person, address, notes. | **P1** |
| R3.9 | Sales return: source invoice, per-line return reason badge (e.g. defective), status **بانتظار دفع المبلغ** (awaiting refund) and an **استرداد للعميل** action; row menu includes "view source invoice". | **P1** |
| R3.10 | Quote detail: send-to-customer action, **view the invoice it converted to**, share menu, attachments, audit log. Quote lines carry available-stock and UoM like invoices. | **P2** |
| R3.11 | Price list: card selector of lists with a "default" badge, then an inline item grid — item, unit, **minimum quantity tier**, base price, custom price. | **P2** |
| R3.12 | Promotions: type (percentage discount / amount discount / special price), scope tab with per-item and bundle scoping, minimum quantity, **maximum discount cap**, priority, coupon requirement, window. Plus a usage report (used count, discount given, discount reversed by returns, net). | **P2** |
| R3.13 | Van trips: crew with roles (driver / rep / assistant), van selection that **cascades** to its warehouse and its treasury account (both disabled until a van is chosen), opening cash, and a stock-loading grid. | **P2** |

## 4. Purchases

| # | Requirement | Pri |
|---|---|---|
| R4.1 | Purchase-invoice status chips: الكل / متأخر / **مستحقة قريباً** / مسودة / مؤكد / مدفوع جزئياً / مدفوع / ملغي, and a money KPI strip (total purchases, paid to suppliers, returned, **unallocated payments**, unpaid balance). | **P1** |
| R4.2 | **Purchase-invoice line types**: stock / expense / freight. Expense lines post to an expense account and move no stock; freight lines are capitalisable into landed cost. | **P1** |
| R4.3 | Supplier's own invoice number as a field on the purchase invoice. | **P1** |
| R4.4 | Purchase-invoice detail tabs: lines (with **consumed / received** per line), payments, returns, **landed costs**, journal entries, attachments, audit log. Inline **صرف دفعة** on each row. | **P1** |
| R4.5 | **Supplier 360**: create purchase invoice / pay / create purchase order / statement; tabs purchase invoices, **supplier statement**, purchase returns, purchase orders, attachments, audit log. | **P1** |
| R4.6 | Goods receipt **must start from a confirmed purchase order**. | **P1** |
| R4.7 | Landed cost: allocation basis **by value / by quantity**; cost lines typed as freight / customs / insurance / clearance / other; linked-invoices section; status **بانتظار التسوية**. | **P1** |
| R4.8 | RFQ: required-by date, branch, warehouse, per-line note (max 500 chars), responses count and the PO it became; filters include line-count and value ranges. | **P2** |
| R4.9 | **Import past purchase returns** action. | **P3** |

## 5. Inventory

| # | Requirement | Pri |
|---|---|---|
| R5.1 | **Six item types**: product / service / raw material / finished good / consumable / recipe. A service creates no stock movement; a raw material is BOM-selectable; a recipe is not directly sellable. | **P1** |
| R5.2 | Items list: **stock column** with low/out-of-stock state, type badge per row, chips for each type plus low-stock and out-of-stock, item-categories manager, export, and toggles to hide variants and show auto-generated (made-to-order) items. | **P1** |
| R5.3 | **Inline "set opening balance"** action on a zero-stock item row. | **P2** |
| R5.4 | Item form sections: type · identity & classification (name, code auto-if-blank, barcode with scan, description, **default supplier**, **season**, **image**, category, **brand**) · pricing & cost · **channels & visibility** · stock (reorder point, reorder quantity) · accounts · **ETA classification** (EGS/GPC code) · units of measure (multiple, with conversion and per-unit barcode) · **per-price-list prices** · **specifications**. | **P1** |
| R5.5 | Item detail tabs: **stock by warehouse with available / reserved / total**, specifications, **cost layers** (remaining qty, unit cost, source, date), **price lists** (list, unit, min qty, base price, custom price, delta vs base), attachments, audit log. Header actions: adjust stock, transfer to another warehouse, raise a purchase request, view movement ledger. | **P1** |
| R5.6 | **Reserved stock** tracked per warehouse. | **P1** |
| R5.7 | Stock balance: warehouse filter, status filter, quantity range, **reorder-level column**, expandable per-warehouse breakdown. | **P1** |
| R5.8 | Transfers: **import lines from Excel**, available-stock shown per line, inline confirm on draft rows. | **P2** |
| R5.9 | **Stock adjustment is reason-first**: opening balance / count correction / damage / theft / expiry / shortage or loss / return to supplier / other — each with helper text, each mapped to its own GL contra account, the reason shown on the list and on the journal entry, and a reason filter on the list. | **P1** |
| R5.10 | **Brands, seasons and specification facets** as entities; items filterable by specification value. | **P2** |
| R5.11 | Labels: branch selector, **item labels and document labels**, all three label sizes. | **P2** |

## 6. Accounting

| # | Requirement | Pri |
|---|---|---|
| R6.1 | **Account routing screen** (a second tab on the chart of accounts) mapping every posting to a GL account, with sections: default tax accounts (output / input VAT) · **leave accounts** (liability 2340 / expense 5110, IAS-19 accrual) · **contracting accounts** (contracting revenue, retention receivable, advances from contracting customers, late-penalty treatment as *revenue deduction (recommended)* or *expense*, penalty account) · **sales-discount contra account** with a toggle for a separate contra account and a second toggle to apply it to line-level discounts · **inventory-adjustment accounts per reason** · **payroll earning components** · **payroll deduction components** · plus per-item-type revenue / COGS / inventory / services routing. | **P1** |
| R6.2 | Chart of accounts shows an inline **account-numbering guide** explaining what each numeric range means. | **P3** |
| R6.3 | Journal entries: date-range filter, **source-module column**, print. | **P2** |
| R6.4 | **Tax groups** alongside tax rates. | **P2** |
| R6.5 | Exchange rates: search and date filter; statuses pending approval / approved / locked. | **P2** |
| R6.6 | Financial reports: KPI totals (total debit / total credit) and per-statement charts. | **P2** |
| R6.7 | **Cost centres get their own columns** (code, name, type, linked to, parent, status) and a "create from departments" action. *(Mezan defect D44.)* | **P0** |

## 7. ETA e-invoicing

| # | Requirement | Pri |
|---|---|---|
| R7.1 | **Readiness meter** ("جاهزية 22%") with a chip per prerequisite: tax registration number, activity code, company address, **branch codes registered with the authority**, **item codes**, **unit mappings**, **tax sub-types** — each showing how many are still missing. | **P1** |
| R7.2 | **General tab**: environment (pre-production / production), activity code lookup, company address (governorate, city, street, building no., postcode — all required), **buyer-data threshold** (invoices at or above the legal 25,000 EGP require the buyer's national ID), document issuance version, **auto-send on confirm** toggle. | **P1** |
| R7.3 | **Credentials tab** with a **test-connection** action; secrets never re-rendered in plain text after save. | **P1** |
| R7.4 | **Item mapping tab**: item code, name, code type (EGS/GPC), authority item code, GPC code, with an "unmapped" filter. | **P1** |
| R7.5 | **Unit mapping tab** with an **apply-suggestions** action. | **P1** |
| R7.6 | **Submissions tab**: internal id, type, status, authority UUID, errors; chips ready / awaiting signature / errors / sent / accepted; actions submit-all-ready, and per row submit or **exclude from submission**. | **P1** |

## 8. Treasury

| # | Requirement | Pri |
|---|---|---|
| R8.1 | **11 voucher types**, chosen from a card grid where each card explains what the type does: collect from customer · pay supplier · refund to customer · **advance from a contracting customer** · refund from supplier · other income · other expense · **partner capital injection** · **partner drawings** · **payment to the tax authority** · transfer between treasuries. Partner types must post to equity, not income/expense; the tax payment must post to the tax payable account. | **P1** |
| R8.2 | Voucher list: type filter listing all types, branch filter, date range, chips including **needs allocation**, **pending approval** and voided; row menu view / print / cancel. | **P1** |
| R8.3 | **Needs-allocation queue** as a server concern, split by intent (receipt vs payment). | **P1** |
| R8.4 | Treasury account row menu: edit, **add opening balance**. Balance-range filter on the list. | **P2** |
| R8.5 | Cheque register: branch filter, date range, the seven-state lifecycle already modelled. | **P2** |

## 9. Manufacturing

| # | Requirement | Pri |
|---|---|---|
| R9.1 | Work-order shop-floor actions: **issue extra materials, return materials, record scrap, record a cost, receive the finished product**. | **P1** |
| R9.2 | Work-order tabs: materials (required / **available** / issued / returned / net / **shortage**), costs, material usage, material movements, receipts, journal entries, audit log. | **P1** |
| R9.3 | Production dashboard organised into workflow buckets: start production / awaiting material issue / awaiting product receipt / ready to close. | **P2** |
| R9.4 | BOM cost-estimate endpoint per BOM. | **P2** |

## 10. HR

| # | Requirement | Pri |
|---|---|---|
| R10.1 | HR dashboard: four charts, plus absence-rate and late-arrival KPIs, and a leave table with entitled / used / pending / %. | **P2** |
| R10.2 | Employee 360 tabs: personal info, contract, leave, **payslips**, advances, attendance, attachments, audit log; a **re-hire** action. | **P2** |
| R10.3 | Employees list: branch and contract columns. | **P2** |
| R10.4 | Contracts: expiring-soon KPI and chip. | **P2** |
| R10.5 | **Leave requests need a create action.** *(Missing in Mezan entirely.)* | **P1** |
| R10.6 | **Leave-policy presets** that can be applied in one action. | **P3** |
| R10.7 | Payroll earning and deduction components are GL-routed (see R6.1). | **P1** |

## 11. Settings — policy tabs that change behaviour

These are the highest-value settings finding: each toggle changes what a document
is allowed to do. Mezan collapses all of them into one "policies" tab.

| # | Tab | Rules observed | Pri |
|---|---|---|---|
| R11.1 | **الرقابة الائتمانية** | enable price lists; enable credit control; **control mode = warn only vs hard block** at the credit limit | **P1** |
| R11.2 | **سياسة المخزون** | sell from another warehouse when the document's warehouse is empty · show other-warehouse quantities while adding lines · **allow backorders** (confirm a sale with the shortfall recorded) · **allow negative stock** (applies to sales, purchase returns and refunds) · **aging write-down provision** (idle stock older than N months provisioned at a rate, posted monthly to provision 1190 against expense 5060, never touching item cost) · auto-generate batch numbers | **P1** |
| R11.3 | **التحكم في المشتريات** | **require a purchase order before a goods receipt** · **require a goods receipt before a purchase invoice** · goods traceability | **P1** |
| R11.4 | **سياسة الخزينة** | **block negative balances on cash accounts** (a drawer cannot go negative) while bank accounts may overdraw | **P1** |
| R11.5 | **الضريبة** | enable VAT · default rate · **tax-inclusive vs tax-exclusive pricing** · depreciation in the month of acquisition (**daily pro-rata, IFRS**, or alternatives) | **P1** |
| R11.6 | **البريد الإلكتروني** | SMTP configuration, **send a test email**, and an editable template | **P2** |
| R11.7 | **عام** | default currency · **enable multi-currency** · which additional currencies are usable · **missing-exchange-rate policy** (strict — reject the document if no rate exists) · language · timezone · direction · date format · **numeral system (Western vs Arabic-Indic)** · fiscal year start month | **P1** |
| R11.8 | **بيانات المنشأة** | company profile plus the week-start day | **P2** |

## 12. Workflow and approvals

| # | Requirement | Pri |
|---|---|---|
| R12.1 | Approvals has three scoped tabs — **inbox / my requests / my actions** — each backed by its own endpoint. | **P1** |
| R12.2 | Notification rules: event, priority, channels, permission- or role-targeted recipients, message templates with document placeholders. | **P2** |

---

## Reference defects found this round — do not reproduce

| # | Finding |
|---|---|
| X1 | The **purchase-invoice row menu says "إنشاء مرتجع مبيعات"** (create a *sales* return) — wrong document type on a purchase document. |
| X2 | Treasury account CASH-001 shows a **0.00 balance against 15 confirmed vouchers** — the same opening-vs-live balance bug Mezan already fixed as D41. |
| X3 | `/inventory/physical-counts/new` **errors out** to a retry button; the flow is unreachable. |
| X4 | **692 of 710 items read "out of stock"** on their own demo tenant, so the headline KPI is noise. |
| X5 | The **asset register has no detail page** — rows are not clickable, there is no asset card or per-asset depreciation schedule. |
| X6 | **Forms carry almost no HTML validation attributes** (no `required` on the invoice form at all). Rules live only in JavaScript, so they are invisible to anyone reading the markup — and unverifiable in a read-only audit. |
| X7 | **No export on any of the 22 operational reports.** |
| X8 | Eight `/{module}/hub` pages are **built and unreachable** from the nav. |

---

# Round 4 — additions

A second read-only pass over the routes not reached in round 3. **Verified before
and after: the only non-GET request in the entire session is Cloudflare's
`/cdn-cgi/rum` telemetry beacon (344×, HTTP 204). Zero writes to the application —
nothing created, edited or deleted.** The click filter was hardened first so that
حفظ / إضافة / إنشاء / تعديل / تأكيد / حذف and their English equivalents are never
clicked anywhere, and no `type="submit"` control is ever activated.

## 13. Patterns confirmed across more screens

| # | Requirement | Pri |
|---|---|---|
| R13.1 | **The row's primary inline action is the next step in its workflow.** Work orders show بدء الإنتاج on a planned order, صرف المواد on one in progress, استلام المنتج when materials are issued, إكمال أمر العمل when production is received. Sales invoices show تحصيل, purchase invoices صرف دفعة, draft transfers تأكيد, calculated payroll runs اعتماد. The list is where work gets done, not just where it is listed. | **P1** |
| R13.2 | **Duplicate as a row action** (تكرار أمر التصنيع). | **P3** |
| R13.3 | **Priority as a first-class document field** with its own filter (منخفضة / عادية / عالية / عاجلة) and a column. | **P2** |
| R13.4 | **Progress shown as a fraction plus a bar** in the row (`0/50` produced, partial-payment bars on invoices). | **P2** |
| R13.5 | **Overdue dates render in red in the cell**, with "متأخر N يوم" beneath. | **P2** |

## 14. Workflow — the approvable document set

| # | Requirement | Pri |
|---|---|---|
| R14.1 | Approvals tabs carry columns المستند / نوع المستند / **المبلغ** / الحالة / **التقدم** (or إجرائي) / تاريخ التقديم, a status filter, and a **document-type filter over the 16 approvable types**: sales invoice, sales return, quote, purchase invoice, purchase order, goods receipt, purchase return, landed-cost voucher, cash voucher, stock transfer, stock adjustment, journal entry, payroll run, leave request, work order. | **P1** |

## 15. Accounting — journal list

| # | Requirement | Pri |
|---|---|---|
| R15.1 | Every journal row carries a **source-module badge** (manufacturing material issue, stock adjustment, purchase invoice, sales invoice, manual entry, finished-goods receipt, manufacturing run cost, manufacturing labour cost), and the list has a **source filter**: sales / purchases / treasury / inventory / POS / installments / manual. | **P1** |
| R15.2 | **طباعة القيود** — print the journal listing. | **P2** |
| R15.3 | **عكس القيد** appears in the row menu only on posted entries, never on reversed ones. Correction is by reversal, never edit. | **P0** (already Mezan's rule — protect it) |

## 16. Inventory — corrections and additions

| # | Requirement | Pri |
|---|---|---|
| R16.1 | **Six label templates, not three**: thermal 40×30mm, shelf 50×25mm, product 100×50mm, A4 21-up (63.5×38.1), A4 65-up (38.1×21.2), A4 14-up (99.1×38.1). Plus **item vs document** label modes, a required branch selector (labels print that branch's price list), a print-price toggle and a **show-price-before-discount** toggle that strikes through the original. | **P2** |
| R16.2 | **Product template detail**: tabs الخصائص / المتغيرات / الوحدات البديلة / الحسابات / السجل, a **generate-variants** action driven by the attribute matrix, and a live "matrix = N combinations" counter with an attention banner when variants have not been generated. | **P2** |
| R16.3 | **Physical count detail is a count sheet** — one "actual count" input per item, entered against the system quantity. | **P1** |
| R16.4 | Adjustment list shows the **reason as a badge** under the warehouse and filters by it. | **P1** |

## 17. Treasury — cheques

| # | Requirement | Pri |
|---|---|---|
| R17.1 | Cheque states: قيد الانتظار / تحت التحصيل / **المستحقة اليوم** / مودع / محصل / مرتد / مستبدل, with a **direction filter** (واردة / صادرة), branch filter and date range. | **P1** |

## 18. HR — payroll

| # | Requirement | Pri |
|---|---|---|
| R18.1 | Payroll run states مسودة / محتسب / معتمد / مصروف / ملغى, an inline **اعتماد** on a calculated run, and **إعادة الاحتساب** in the row menu. | **P2** |

## 19. Report design — the pattern to build to

Read off the customer-aging report, which is the clearest example:

| # | Requirement | Pri |
|---|---|---|
| R19.1 | **A question as the subtitle**, not a description — "أين خطر التحصيل؟ العملاء المتأخرون 90 يوماً أو أكثر يحتاجون تدخلاً فورياً". Every report states the decision it supports. | **P2** |
| R19.2 | **KPI strip** — customer count, total receivable, customers with overdue, overdue 90+. | **P1** |
| R19.3 | **A distribution bar**: one stacked horizontal bar for the whole population, each segment labelled with its amount and percentage. | **P2** |
| R19.4 | **A per-entity stacked bar, top 10**, colour-graded by bucket (green = current → red = severely overdue) with a legend, and a caption explaining the colour scale. | **P2** |
| R19.5 | Then the table, with the same buckets as columns. Seven chart surfaces total on this one report. | **P1** |

## 20. Print designer

| # | Requirement | Pri |
|---|---|---|
| R20.1 | Nine configuration tabs (identity, header, document content, line columns, totals, footer, watermark, cash receipt, per-document override) **beside a live A4 preview** that re-renders as settings change, with a document-type selector driving the preview, and a **reset to defaults** action. | **P2** |

## Reference defects — additions

| # | Finding |
|---|---|
| X9 | The **purchase-invoice row menu offers "إنشاء مرتجع مبيعات"** — a *sales* return action on a purchase document. |
| X10 | On the reference's own tenant, **14 of 24 work orders are overdue** and 693 of 713 stock rows read "out of stock", so both attention banners are permanently red and carry no signal. |
