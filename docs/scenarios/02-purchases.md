# Purchases — UI test scenarios

Sources: `docs/catalog/02-purchases.md` (captured from the running reference
product) cross-checked against the actual build — `apps/web/src/screens/{SuppliersScreen,RfqsScreen,PurchaseOrdersScreen,GoodsReceiptsScreen,PurchaseInvoicesScreen,PurchaseReturnsScreen,LandedCostsScreen}.tsx`,
`apps/web/src/screens/hubs/PurchasesHubScreen.tsx`, `apps/web/src/nav-config.ts`,
and the seed generator `packages/backend/src/demo-seed/purchasing.ts` (plus the
core `packages/backend/src/demo-seed.ts`). Every discrepancy between what the
catalog describes and what the code actually renders is marked
**`[NOT IMPLEMENTED]`** at the point it matters, with the file it was checked
against.

Login: `محمد الشهابي` / PIN `1234`. Reports (`/reports/purchases/*`,
`/reports/aging/suppliers`) and POS are out of scope — see `docs/testing-policy.md`
for how to run the app and cross-check the API directly.

## Seed data this file relies on

| Entity | Records |
|---|---|
| Suppliers | `SUPP-DEMO-1` مصنع الوادي الأخضر (S-0001, 30-day terms), `SUPP-DEMO-2` شركة سياج للصناعات (S-0002, 60-day terms) |
| Items | `ITEM-DEMO-1..8` — أرز أبيض٥كجم, زيت عباد الشمس١لتر, سكر أبيض١كجم, شاي أسود٥٠٠جم, خليط شاي بالسكر, خليط شاي بالنعناع, لبن كامل الدسم (batched/expiry), زبادي طبيعي (batched/expiry) |
| RFQs | `RFQ-DEMO-1` مغلق (2 quotes, converted → `PO-DEMO-3`), `RFQ-DEMO-2` مرسل (1 quote, not converted), `RFQ-DEMO-3` مسودة (no quotes) |
| Purchase Orders | `PO-DEMO-1` مسودة, `PO-DEMO-2` مستلم بالكامل (→ `GRN-DEMO-1` → `PI-DEMO-6`), `PO-DEMO-3` مستلم جزئياً (→ `GRN-DEMO-2` → `PI-DEMO-7`), `PO-DEMO-4` مرسل (receipt `GRN-DEMO-3` left as draft) |
| Goods Receipts | `GRN-DEMO-1` confirmed+invoiced, `GRN-DEMO-2` confirmed+invoiced (partial), `GRN-DEMO-3` **draft**, uninvoiced |
| Purchase Invoices | `PI-DEMO-1..5` confirmed, manual entry, no receipt link (`PI-DEMO-1` has a 60%-allocated supplier-payment voucher `VCH-DEMO-3` against it); `PI-DEMO-6`, `PI-DEMO-7` confirmed, created "from receipt" |
| Purchase Returns | `PRT-DEMO-1` confirmed (qty 20 of `ITEM-DEMO-2`, reason QUALITY_ISSUE, against `PI-DEMO-7`), `PRT-DEMO-2` **draft** (qty 12, same invoice/item, reason DEFECTIVE) |
| Landed Costs | `LC-DEMO-1` confirmed, BY_VALUE, SHIPPING 1800 + CLEARANCE 700 = 2500, over `ITEM-DEMO-1`/`ITEM-DEMO-3` from `GRN-DEMO-1`; `LC-DEMO-2` **draft**, BY_QUANTITY, INSURANCE 300 + CUSTOMS 450 = 750, single target `ITEM-DEMO-2` from `GRN-DEMO-2` |

## Cross-cutting findings (apply across every screen below — stated once)

- **No advanced filter panel anywhere in Purchases.** The catalog describes a
  collapsible "تصفية النتائج" panel (warehouse/supplier/date-range/amount-range)
  on every list. The shared `DocumentList` primitive
  (`packages/ui/src/primitives/DocumentList.tsx`) has no `filters`/`filterPanel`
  prop at all, and none of the seven Purchases screens builds one itself.
  **`[NOT IMPLEMENTED]`** on every list screen in this module.
- **No working column sorting anywhere in Purchases.** `DocumentList` supports
  a `sortable` column flag plus `sort`/`onSortChange`, but no Purchases screen
  passes them — every column header is inert. **`[NOT IMPLEMENTED]`**.
- **No real pagination anywhere in Purchases.** Every list passes
  `page={1} pageCount={1}` with no `onPageChange` handler — the entire result
  set always renders as one page, regardless of row count or a rows-per-page
  selector. **`[NOT IMPLEMENTED]`**.
- **Branch/warehouse are hardcoded to IDs that don't exist in this tenant.**
  `RfqsScreen.tsx`, `PurchaseOrdersScreen.tsx`, and `PurchaseInvoicesScreen.tsx`
  (both the manual and from-receipt save paths) all send
  `branchId: "MAIN", warehouseId: "MAIN-WH"` when creating a document — literal
  strings, with no picker in the UI to change them. The tenant's real IDs
  (`packages/backend/src/demo-seed/shared.ts`) are `BR-MAIN` / `WH-MAIN`. This
  is a code-level finding distinct from `docs/defects.md`'s D1–D6 — flagged
  where it matters below as **the branch/warehouse mismatch**.
- **Suppliers' "المستحق للمورد" is a static field, not a live balance.** The
  list column, its KPI total, and the detail-page summary card all render
  `supplier.openingBalance` directly — a number only ever set on the
  add/edit form — not a computed balance from confirmed invoices and voucher
  allocations. The detail page labels it honestly ("المستحق للمورد (الرصيد
  الافتتاحي)"); the list column and KPI tile do not carry that qualifier and
  read as a live payable. The *real* AP balance is only computed correctly on
  the supplier detail's كشف حساب المورد tab. Flagged where it matters below.

---

## الموردون (Suppliers)

### List — `apps/web/src/screens/SuppliersScreen.tsx`

**PUR-01 — Search by name**
- Pre: on `/purchases/suppliers` (nav: المشتريات → الموردون).
- Steps: type "الوادي" into "ابحث باسم المورد أو الكود أو الهاتف…".
- Assert: only `SUPP-DEMO-1` (مصنع الوادي الأخضر) remains; `pageSummary` reads "عرض 1 من 2 مورد".

**PUR-02 — Search by code**
- Steps: clear search, type "S-0002".
- Assert: only `SUPP-DEMO-2` (شركة سياج للصناعات) remains.

**PUR-03 — Search by phone**
- Steps: type "01098765432".
- Assert: only `SUPP-DEMO-1` remains (matches the seeded phone exactly).

**PUR-04 — Search, no match**
- Steps: type "xyz-no-such-supplier".
- Assert: table renders the empty state "لا يوجد موردون مطابقون"; KPI tiles above stay unchanged (they reflect the whole set, not the filtered one).

**PUR-05 — Status tab نشط / غير نشط / الكل**
- Pre: both seed suppliers are `active: true`.
- Steps: click "غير نشط".
- Assert: chip count is 0 and the table is empty; click "نشط" → both suppliers show with count 2; click "الكل" → same 2, count matches "إجمالي الموردين" KPI.

**PUR-06 — No filter panel**
- Steps: look for a "تصفية النتائج" toggle near the search box.
- Assert: `[NOT IMPLEMENTED]` — none exists; the catalog's phone/balance-range filter fields are unreachable.

**PUR-07 — No column sorting**
- Steps: click the "المستحق للمورد" or "شروط الدفع" column header.
- Assert: `[NOT IMPLEMENTED]` — no sort indicator, no re-order; row order stays insertion order.

**PUR-08 — No real pagination**
- Steps: note `page=1, pageCount=1` is hardcoded regardless of row count.
- Assert: `[NOT IMPLEMENTED]` — with only 2 seed suppliers this is invisible, but the control simply doesn't exist; there is no rows-per-page selector either.

**PUR-09 — KPI "المستحق للموردين" does not match reality**
- Pre: neither seed supplier has an `openingBalance` set (defaults to 0), yet both have real confirmed purchase invoices with outstanding balances (e.g. `PI-DEMO-1` is only 60%-paid via `VCH-DEMO-3`).
- Steps: read the "المستحق للموردين" KPI tile on the list.
- Assert: it reads **٠٫٠٠** (sum of `openingBalance` across suppliers). Open `SUPP-DEMO-1` → كشف حساب المورد tab and read "الرصيد الختامي (مستحق للمورد)" — it is **non-zero**. The list KPI and the real AP balance disagree; this is a genuine, freshly observed defect (not in `docs/defects.md`'s D1–D6) — the list surfaces a static field labeled like a live balance.

**PUR-10 — Header actions**
- Steps: read the two header buttons.
- Assert: "إضافة مورد" opens the create panel. "تصنيفات الموردين" **`[NOT IMPLEMENTED]`** — no such button exists; see the Supplier Categories section below.

**PUR-11 — Add supplier: name required**
- Steps: open "إضافة مورد" → leave "اسم المورد *" blank → click "إضافة مورد".
- Assert: inline error "الاسم بالعربية مطلوب" appears (`role="alert"`); panel stays open; no request is sent.

**PUR-12 — Add supplier: code auto-generates when blank**
- Steps: fill only the name → save.
- Assert: with 2 existing suppliers the code is generated as `S000003` (`S${(count+1).padStart(6,"0")}`); reload the list — the new supplier persists with that code.

**PUR-13 — Add supplier: negative "شروط الدفع (أيام)" is not blocked**
- Steps: fill name, set شروط الدفع to `-5` (the number input's `min={0}` is a display attribute, not an enforced guard — `NumberField` passes `valueAsNumber` straight through).
- Assert: `[NOT IMPLEMENTED validation]` — no client-side rejection; the value is sent as-is on save. Note whatever the server does (accept or 400) — either way there is no field-level message.

**PUR-14 — Add supplier: negative "الرصيد الافتتاحي" is not blocked**
- Steps: fill name, set الرصيد الافتتاحي to `-100`.
- Assert: same as PUR-13 — no client guard; value passes through unchanged.

**PUR-15 — Add supplier: full field set, save persists and survives reload**
- Steps: fill اسم المورد, الهاتف, شروط الدفع, العملة, التصنيف, الرصيد الافتتاحي, الاسم بالإنجليزي, البريد الإلكتروني, الرقم الضريبي, جهة الاتصال, المدينة/الحي/الشارع, ملاحظات → "إضافة مورد".
- Assert: panel closes, new row appears in the list with the entered name/phone/terms/category; reload the page — same supplier, same field values on its detail page's "نظرة عامة" tab.

**PUR-16 — Add supplier: no logo upload, no Arabic-name/advanced-options split**
- Steps: inspect the create panel's field list against the catalog.
- Assert: `[NOT IMPLEMENTED]` — no "شعار" (logo) upload field. `[NOT IMPLEMENTED]` — no "خيارات متقدمة" expandable section; every field (email, tax number, contact, address, notes) is always visible, flat. `[NOT IMPLEMENTED]` — no country-code combobox on الهاتف; it is a plain `tel` text input with no +20 default.

**PUR-17 — Add supplier: cancel discards**
- Steps: open create panel, type a name, click "إلغاء".
- Assert: panel closes, no row is added, no request fires.

**PUR-18 — Edit supplier: code field is disabled**
- Steps: open `SUPP-DEMO-1` → تعديل.
- Assert: "الكود" input is disabled/read-only, pre-filled `S-0001`.

**PUR-19 — Edit supplier: deactivate via the نشط toggle**
- Steps: on the edit panel (only visible when editing, not on create), turn off "نشط" → حفظ التعديلات.
- Assert: list status tab "غير نشط" now shows this supplier; its status badge changes to "غير نشط" (tone neutral) on the detail page. There is no dedicated one-click "تعطيل" action anywhere — `[NOT IMPLEMENTED]` vs. the catalog's "المزيد → تعطيل" menu item.
- Reload and confirm the inactive state persisted.

**PUR-20 — Edit supplier: category is free text, not a picker**
- Steps: on the edit panel, type an arbitrary string into "التصنيف", e.g. "فئة تجريبية غير موجودة".
- Assert: it saves without validation against any category list — because there is no category list. See Supplier Categories below.

### Supplier detail — `SuppliersScreen.tsx` (`SupplierDetail`)

**PUR-21 — Header actions**
- Pre: open `SUPP-DEMO-1`.
- Assert: only two actions exist — "تعديل" and "رجوع لقائمة الموردين". `[NOT IMPLEMENTED]` vs. catalog: no "إنشاء فاتورة مشتريات" header shortcut, no "المزيد" menu, no "نظرة 360°".

**PUR-22 — Quick-action row is entirely absent**
- Assert: `[NOT IMPLEMENTED]` — no إنشاء فاتورة مشتريات / صرف دفعة / إنشاء أمر شراء / عرض كشف الحساب quick-action row below the summary strip, as the catalog describes.

**PUR-23 — Tab: نظرة عامة**
- Assert: shows البريد الإلكتروني, جهة الاتصال, الرقم الضريبي, العنوان (joined "شارع، حي، مدينة"), and ملاحظات only if non-empty.

**PUR-24 — Tab: فواتير المشتريات matches real invoices**
- Pre: `SUPP-DEMO-1` has `PI-DEMO-1`, `PI-DEMO-3`, `PI-DEMO-4`, `PI-DEMO-6` (4 confirmed invoices, no drafts).
- Steps: open the tab.
- Assert: exactly those 4 rows appear, sorted by date desc (newest first — most recent `PI-DEMO-6` 2026-08-12 on top); "عدد الفواتير"=4, "فواتير مؤكدة"=4, "إجمالي المؤكد" equals the sum of their `total` fields, "آخر فاتورة" shows `PI-DEMO-6`'s date.

**PUR-25 — Tab: فواتير المشتريات empty state**
- Pre: pick a supplier with zero invoices (create one via PUR-15 without ever invoicing it).
- Assert: "لا توجد فواتير مشتريات مسجّلة لهذا المورد" with the hint text about the فواتير المشتريات screen.

**PUR-26 — Tab: كشف حساب المورد reconciles**
- Pre: `SUPP-DEMO-1`; `VCH-DEMO-3` (confirmed supplier_payment, 60% of `PI-DEMO-1`'s outstanding) is allocated.
- Steps: open كشف حساب المورد.
- Assert: rows include "رصيد افتتاحي", one "فاتورة مشتريات" credit row per confirmed invoice, and a "سند صرف للمورد" debit row for `VCH-DEMO-3` noting "مخصص على الفاتورة PI-DEMO-1" (or its display number); the reconciliation pill reads "مطابق لدفتر الفواتير المفتوحة" (compares against `GET /open-invoices?kind=purchase`) and, if the aging report responds, "مطابق لتقرير أعمار الديون" — if either pill instead reads "يختلف عن …", record the measured mismatch amount as a new finding, not a re-file of D1 (D1 is specifically about AR/customer collections not moving `amountPaid`; this tab uses the allocation sub-ledger directly and should not exhibit D1).
- Confirm no raw i18n key (`customers.openingBalance`) leaks anywhere on this tab — the catalog's reference-product bug does **not** reproduce here; the label reads "رصيد افتتاحي" correctly.

**PUR-27 — Tab: كشف حساب المورد aging table**
- Assert: the "أعمار فواتير هذا المورد" table renders جاري / 31-60 / 61-90 / 91-120 / أكثر من 120 / الإجمالي buckets, sourced from `/reports/aging/suppliers`, and its total is cross-checked against the closing balance via the "مطابق/يختلف عن تقرير أعمار الديون" pill.

**PUR-28 — Missing tabs**
- Assert: `[NOT IMPLEMENTED]` — no أوامر الشراء tab, no مرتجعات المشتريات tab, no المرفقات tab (the code explicitly notes "this build has no file-storage subsystem of any kind"), no سجل المراجعة (audit log) tab. Catalog lists all four.

### تصنيفات الموردين (Supplier Categories)

**PUR-29 — Entire feature is not implemented**
- Steps: look for any way to reach a categories list/modal from Suppliers.
- Assert: `[NOT IMPLEMENTED]` — confirmed by reading `SuppliersScreen.tsx` in full: there is no "تصنيفات الموردين" button, no modal, no dedicated categories API call. "التصنيف" on the supplier form is a plain free-text field with no typeahead, no backing list, and no validation against prior values (PUR-20). The catalog's entire "تصنيفات الموردين" screen — its empty state, its "إضافة تصنيف" inline panel, its `اسم التصنيف *`/`الاسم بالعربية` fields — has no equivalent anywhere in the build.

---

## طلبات عروض الأسعار (RFQs)

### List — `apps/web/src/screens/RfqsScreen.tsx`

**PUR-30 — Search by number**
- Pre: on `/purchases/rfqs`.
- Steps: type the number of `RFQ-DEMO-1` (read it off the list first, e.g. `RFQ-000001`) into "ابحث برقم الطلب…".
- Assert: only that row remains.

**PUR-31 — Status tabs with counts**
- Assert: chips الكل=3 / مسودة=1 (`RFQ-DEMO-3`) / مرسل=1 (`RFQ-DEMO-2`) / مغلق=1 (`RFQ-DEMO-1`) / ملغي=0. Click مغلق → only `RFQ-DEMO-1` shows.

**PUR-32 — No ملغي RFQ exists in seed data**
- Steps: click ملغي.
- Assert: empty result (count 0) — cancelling an RFQ can only be exercised live (see PUR-40); the seed never produces one.

**PUR-33 — No filter panel / no sorting / no real pagination**
- Assert: `[NOT IMPLEMENTED]` — same cross-cutting gaps; the catalog's من/إلى تاريخ, البنود range, العروض range, and أمر الشراء filter are all unreachable.

**PUR-34 — KPI strip**
- Assert: "إجمالي الطلبات"=3, "مرسلة"=1, "مغلقة (محوّلة)"=1, "مسودة"=1 — matches the status counts above exactly (no separate KPI query, computed client-side from the same list).

**PUR-35 — Empty state**
- Pre: filter to a status/search combination with zero matches, e.g. search "zzz".
- Assert: "لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء" (same copy is also the true empty-tenant state).

**PUR-36 — Create RFQ: required fields**
- Steps: open "طلب عرض سعر جديد" with all lines empty (default one blank line with no item picked) → try to save.
- Assert: "حفظ" is disabled (`canSave` requires at least one line with an item and qty>0) — no inline error is ever shown because submission is blocked at the button, not after an attempt.

**PUR-37 — Create RFQ: add/remove lines**
- Steps: add a second line via "إضافة بند"; remove the first via "حذف البند" (only enabled when >1 line exists — the sole remaining line has no delete button).
- Assert: line list updates correctly; the delete button is absent on a single-line form.

**PUR-38 — Create RFQ: negative quantity is silently dropped, not rejected**
- Steps: pick an item, set الكمية to `-3`.
- Assert: `[NOT IMPLEMENTED validation]` — no error message; on save, `usable = lines.filter(l => l.itemId !== "" && l.qty > 0)` silently excludes that line. If it was the only line, "حفظ" stays disabled with no explanation of why.

**PUR-39 — Create RFQ: no branch/warehouse picker — the hardcoded-ID bug**
- Steps: create an RFQ with one valid line (e.g. `ITEM-DEMO-2`, qty 50) → حفظ.
- Assert: no branch or warehouse field exists anywhere on this form. The request is sent with `branchId: "MAIN", warehouseId: "MAIN-WH"` (see cross-cutting note) — neither ID exists in this tenant (real ones are `BR-MAIN`/`WH-MAIN`). Confirm whether the save succeeds anyway or the panel shows a generic failure banner; either result is worth recording precisely, since it is the first place in the app a user can hit this mismatch through ordinary use.

**PUR-40 — Create RFQ: save persists and survives reload; cancel discards**
- Steps: save a valid RFQ → reload the page → find it in the list. Separately, open create, type into a field, click "إلغاء".
- Assert: saved RFQ appears with مسودة status and the entered lines after reload. Cancelled attempt adds nothing.

### RFQ detail — `RfqsScreen.tsx` (`RfqDetail`)

**PUR-41 — مسودة detail: RFQ-DEMO-3**
- Steps: open `RFQ-DEMO-3`.
- Assert: actions are "إرسال" and "إلغاء الطلب" (plus رجوع); effects panel reads the 3-line explainer ("لا يؤثر... مستند تحضيري فقط" / "بعد الإرسال يمكن تسجيل عروض..." / "تحويل عرض مختار..."); tabs البنود(1)/العروض(0)/مقارنة العروض; العروض tab shows "لا توجد عروض أسعار مسجلة بعد" and — since status isn't "sent" — **no** quote-entry form (it only appears once sent); مقارنة العروض shows "سجّل عرضاً واحداً على الأقل لعرض المقارنة".

**PUR-42 — Send RFQ-DEMO-3**
- Steps: click "إرسال".
- Assert: status pill flips to مرسل (tone info); actions now show "إغلاق بدون تحويل" and "إلغاء الطلب" instead of "إرسال"; العروض tab now shows the quote-entry form (المورد picker + one price field per line + ملاحظات + "حفظ العرض").
- Reload and confirm the status persisted.

**PUR-43 — مرسل detail: RFQ-DEMO-2, register a second quote**
- Pre: `RFQ-DEMO-2` already has one quote (`RFQQ-DEMO-3`, from `SUPP-DEMO-1`).
- Steps: open it → العروض tab → the supplier picker in "تسجيل عرض سعر جديد" — check its options.
- Assert: `SUPP-DEMO-1` is excluded from the picker (`alreadyQuotedSupplierIds`), leaving only `SUPP-DEMO-2` selectable — a supplier cannot quote twice on the same RFQ via this form. Fill a price for each line (leave one at 0) → "حفظ العرض" is enabled once at least one line has price>0 (`priced.length===0` blocks it, but the button's `disabled` only checks `!quoteSupplier`, not `priced.length` — try submitting with **all** prices at 0 and confirm nothing happens, since `submitQuote()` returns early with no error message: `[NOT IMPLEMENTED validation]`, a silent no-op rather than a disabled button or an inline error).

**PUR-44 — مقارنة العروض with two quotes**
- Pre: after PUR-43, `RFQ-DEMO-2` has quotes from both suppliers.
- Assert: comparison table has one row per line item and one column per supplier that quoted; the cheaper price per row is bold/success-colored (`cheapestSupplierId`); a footer row totals each supplier's "سلة كاملة" — if a supplier didn't price every line, their total cell reads "غير مكتمل" instead of a number; since status is "sent", a "تحويل إلى أمر شراء" button appears under whichever supplier(s) have a complete total.

**PUR-45 — Convert RFQ-DEMO-2's cheaper quote to a PO**
- Steps: click "تحويل إلى أمر شراء" under the cheaper supplier.
- Assert: a new PO is created (draft-confirmed automatically per the `/rfqs/:id/convert` contract used by the seed for `RFQ-DEMO-1`→`PO-DEMO-3`) linked to this RFQ; the RFQ's status becomes مغلق and its "أمر الشراء المرتبط" summary field now shows the new PO's id; back on the RFQs list, the أمر الشراء column for this row is populated; go to Purchase Orders and confirm the new PO exists with lines matching the winning quote's prices and the RFQ's requested quantities.
- Watch: while converting, `pendingConvertSupplierId` disables *all* convert buttons — click-spamming or double-clicking the button must not create two POs; confirm only one PO results.

**PUR-46 — مغلق detail: RFQ-DEMO-1, read-only history**
- Steps: open `RFQ-DEMO-1`.
- Assert: no send/close/cancel actions remain (status is terminal); "أمر الشراء المرتبط" reads `PO-DEMO-3`; العروض tab lists both `RFQQ-DEMO-1` (السعر شامل النقل... note) and `RFQQ-DEMO-2`; مقارنة العروض highlights `SUPP-DEMO-2` (سياج) as cheapest on the total row (26,880 vs 26,980, matching the seed comment) even though سياج's شاي price (208) is individually the pricier one on that line — confirm the *per-line* cheapest highlight for شاي correctly shows `SUPP-DEMO-1` (203) in success color while the *total* column still favors سياج.

**PUR-47 — إغلاق بدون تحويل**
- Pre: any مرسل RFQ with at least one quote that you do not intend to convert (use a freshly created test RFQ, not `RFQ-DEMO-2` which PUR-45 already converts).
- Steps: send it, add one quote, click "إغلاق بدون تحويل".
- Assert: status becomes مغلق with **no** "أمر الشراء المرتبط" (stays "—") — a closed-without-converting RFQ is distinguishable from a closed-by-conversion one only by that field, since both show مغلق. Confirm the RFQs list الحالة column can't tell them apart either — worth noting as a minor UX gap, not a hard defect.

**PUR-48 — إلغاء الطلب**
- Pre: a fresh مسودة or مرسل RFQ.
- Steps: click "إلغاء الطلب".
- Assert: status becomes ملغي (tone danger); no further actions are available; reload and confirm it persisted, and that it now appears under the ملغي status chip on the list (finally giving that chip a non-zero count).

---

## أوامر الشراء (Purchase Orders)

### List — `apps/web/src/screens/PurchaseOrdersScreen.tsx`

**PUR-49 — Search by number or supplier name**
- Steps: search the number of `PO-DEMO-2`; clear and search "سياج" instead.
- Assert: number search returns exactly `PO-DEMO-2`; supplier-name search returns `PO-DEMO-1` and `PO-DEMO-3` (both against `SUPP-DEMO-2`, Siyaj).

**PUR-50 — Status tabs, all 5 states populated**
- Assert: الكل=4, مسودة=1 (`PO-DEMO-1`), مرسل=1 (`PO-DEMO-4`), مستلم جزئياً=1 (`PO-DEMO-3`), مستلم بالكامل=1 (`PO-DEMO-2`), ملغي=0. This is the one Purchases list where every non-cancelled status has a seeded example — use it to visually confirm each `StatusPill` tone (neutral/info/warning/success).

**PUR-51 — KPI strip**
- Assert: "إجمالي الأوامر"=4, "طلبات مرسلة"=1 (only counts literal `status==="sent"`, i.e. `PO-DEMO-4` — **not** partially/fully received ones, even though those are also "sent" in spirit), "إجمالي القيمة"=sum of all 4 subtotals, "مستلم بالكامل"=1.

**PUR-52 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting; catalog's المستودع/تصفية حسب المورد/من-إلى تاريخ filters are unreachable, and the "1" active-filter badge the catalog shows never appears since there is no filter state to badge.

**PUR-53 — Empty state**
- Steps: search for a non-existent order number.
- Assert: "لا توجد أوامر شراء مطابقة".

**PUR-54 — Create PO: supplier required**
- Steps: open "أمر شراء جديد" without picking a supplier.
- Assert: "حفظ مسودة" stays disabled (`canSave` requires `supplier !== null`); no inline message is shown.

**PUR-55 — Create PO: item pick auto-fills unit price from item cost**
- Steps: pick `ITEM-DEMO-1` on a line.
- Assert: سعر الوحدة auto-fills to 140 (the item's `costPrice`); it remains editable afterward.

**PUR-56 — Create PO: negative quantity silently dropped; negative price passed through**
- Steps: line A: qty `-2`, valid item. Line B: qty 5, سعر الوحدة `-10`.
- Assert: on save, line A is excluded from the payload entirely (filter is `qty > 0`, same silent-drop behavior as PUR-38); line B **is** sent with a negative unit price since there's no client guard on price — watch for either a server 400 (generic error banner, no field-level message) or a silently-accepted negative-total PO. Either result is a finding worth recording precisely.

**PUR-57 — Create PO: no branch/warehouse/currency/expected-delivery fields — the hardcoded-ID bug again**
- Steps: inspect the full field list of the create panel against the catalog's described "بيانات أمر الشراء" section (المورد / التاريخ / تاريخ التسليم المتوقع / الفرع / المستودع / العملة).
- Assert: `[NOT IMPLEMENTED]` — only المورد, التاريخ, and ملاحظات exist. تاريخ التسليم المتوقع, الفرع, المستودع, and العملة have no UI field at all. The create call sends the same hardcoded `branchId: "MAIN", warehouseId: "MAIN-WH"` as PUR-39 (see cross-cutting note) with no `expectedDeliveryDate` in the payload whatsoever — a PO created through this screen can never have an expected-delivery date, even though the PO detail page has a summary row for it (shows "—" for every UI-created order).

**PUR-58 — Create PO: no variant picker, no inline item creation**
- Assert: `[NOT IMPLEMENTED]` — catalog describes "اختيار متغير" (pick variant) and an inline "إضافة صنف" (create new item without leaving the form) inside the item picker itself. The actual item `EntityPicker` only selects from existing items; "إضافة صنف" in this build is just the button that appends another blank order line.

**PUR-59 — Create PO: no attachments widget**
- Assert: `[NOT IMPLEMENTED]` — no "المرفقات" sidebar section on the create form.

**PUR-60 — Create PO: save is always a draft — no combined "confirm and send" at creation**
- Steps: fill supplier + one line → observe the single save button.
- Assert: it reads "حفظ مسودة" only — there is no second "تأكيد وإرسال" action available during creation (unlike the catalog's description of two duplicated header/sidebar buttons). Confirming only becomes possible afterward, from the detail page of the resulting draft (PUR-63).

**PUR-61 — Create PO: save persists and survives reload; cancel discards**
- Steps: save a valid PO with 2 lines → reload → open it from the list.
- Assert: lines, supplier, subtotal all match what was entered. Separately: open create, fill a field, click "إلغاء" — nothing is added.

### PO detail — `PurchaseOrdersScreen.tsx` (`OrderDetail`)

**PUR-62 — "المستودع" shows a raw ID, not a name**
- Steps: open any PO (e.g. `PO-DEMO-2`) → read the "المستودع" summary row.
- Assert: it renders `order.warehouseId` directly (e.g. the literal string stored for this record) rather than a resolved warehouse name — the screen never looks up `useWarehouses()` to translate the ID. This is a small but concrete, easily-observed presentation defect distinct from the branch/warehouse *creation* bug above.

**PUR-63 — مسودة detail: PO-DEMO-1**
- Steps: open `PO-DEMO-1`.
- Assert: action "تأكيد وإرسال" is present (plus رجوع); effects panel: 3-line explainer ("لا يؤثر أمر الشراء... يسجّل التزاماً... فقط" / "عند تأكيد إيصال الاستلام..." / "عند تأكيد فاتورة المشتريات..."); البنود tab shows both lines with مستلم=0 and المتبقي=qty for each (nothing received yet, correctly, since it's still a draft — it can't even be received against, see PUR-71).

**PUR-64 — Confirm PO-DEMO-1**
- Steps: click "تأكيد وإرسال".
- Assert: status flips مسودة→مرسل (tone info); the action disappears (no further status-changing actions exist on this screen for a sent order — see PUR-68); reload and confirm it persisted; on the list, "طلبات مرسلة" KPI increments by 1.

**PUR-65 — مستلم بالكامل detail: PO-DEMO-2**
- Steps: open `PO-DEMO-2`.
- Assert: no action buttons besides رجوع (already fully received, nothing left to confirm); البنود shows both lines with مستلم==الكمية and المتبقي=0 (rice 100/100, sugar 300/300).

**PUR-66 — مستلم جزئياً detail: PO-DEMO-3**
- Steps: open `PO-DEMO-3`.
- Assert: oil line reads مستلم=120, المتبقي=80 (of 200 ordered); tea line reads مستلم=0, المتبقي=60 (of 60 ordered, nothing received at all) — the partial-receipt state is visible per-line, not just at the header status.

**PUR-67 — مرسل detail: PO-DEMO-4 (receipt still draft)**
- Steps: open `PO-DEMO-4`.
- Assert: sugar line reads مستلم=0, المتبقي=250 — status stays مرسل (not مستلم جزئياً) because `GRN-DEMO-3` was deliberately never confirmed. This is the seed's intentional no-GL-entry setup case; see the end-to-end section below for the reconciliation check.

**PUR-68 — No cancel path for a Purchase Order, anywhere**
- Assert: `[NOT IMPLEMENTED]` — `ملغي` is a valid `PurchaseOrderStatusDTO` value (rendered correctly in the status label/tone maps if it ever occurred) but no button on the list or detail ever transitions a PO to it. A PO, once created, can only progress forward through مرسل→مستلم جزئياً/بالكامل — it can never be cancelled through the UI.

---

## استلام البضائع (Goods Receipts)

### List — `apps/web/src/screens/GoodsReceiptsScreen.tsx`

**PUR-69 — Search by number or supplier**
- Steps: search `GRN-DEMO-2`'s displayed number; clear and search "الوادي" (Green Valley's Arabic name substring).
- Assert: number search isolates that one receipt; supplier search returns the receipts against `SUPP-DEMO-1` (`GRN-DEMO-1`).

**PUR-70 — Status tabs — "غير مفوترة" is a KPI/column, not a filterable tab**
- Assert: chips are only الكل(3)/مسودة(1, `GRN-DEMO-3`)/مؤكد(2)/ملغي(0). `[NOT IMPLEMENTED]` vs. catalog's 4th tab "غير مفوترة" — the uninvoiced concept exists (see the حالة الفاتورة column and the "غير مفوترة" KPI tile) but there is no way to click-filter the list down to it.

**PUR-71 — KPI strip**
- Assert: "إجمالي الإيصالات"=3, "مؤكدة"=2, "إجمالي القيمة"=sum of all 3 `totalCost` (including the draft one — confirm this is deliberate: the KPI sums every receipt regardless of status, not just confirmed ones), "غير مفوترة"=1 (`GRN-DEMO-3`, the only confirmed-or-draft receipt with `invoiced:false` among... actually recompute: this counts **all** receipts with `!invoiced`, so it should be `GRN-DEMO-3` only, since `GRN-DEMO-1`/`GRN-DEMO-2` are both invoiced — confirm the tile reads 1, not 3).

**PUR-72 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting; catalog's المستودع/المورد/تاريخ/تكلفة filters unreachable.

**PUR-73 — Empty state**
- Steps: search a non-existent number.
- Assert: "لا توجد إيصالات استلام مطابقة".

### Create receipt

**PUR-74 — PO picker excludes non-receivable orders**
- Steps: open "إيصال استلام جديد" → check "أمر الشراء *" options.
- Assert: only `PO-DEMO-3` (مستلم جزئياً) and `PO-DEMO-4` (مرسل) appear — `PO-DEMO-1` (مسودة) and `PO-DEMO-2` (مستلم بالكامل) are excluded (`receivableOrders` filters to `status === "sent" || "partially_received"`). This is the gate enforced client-side: **you cannot even attempt to receive against a draft or already-fully-received PO** through this screen — you'd have to know the PO id and call the API directly.

**PUR-75 — No editable line quantities — full-outstanding-qty auto-fill only**
- Steps: pick `PO-DEMO-4` in the picker.
- Assert: a read-only preview table appears ("البنود (معبأة تلقائياً من أمر الشراء)") pre-filled with the item's full outstanding quantity (250 sugar) and unit cost — there is **no** input to reduce or increase that quantity. `[NOT IMPLEMENTED]` — the API demonstrably supports partial per-line quantities (the seed posts `GRN-DEMO-2` with an explicit `lines: [{itemId, qty:"120", unitCost:"72"}]` directly against the API, receiving only 120 of the 200 oil ordered and 0 of the 60 tea), but **no UI control exists to do a partial receipt, and none exists to over-receive** — both the "receive less than ordered" and "receive more than ordered" boundary tests from this file's brief can only be exercised via direct API call, not through any button in this build.

**PUR-76 — Draft-note banner text**
- Assert: the info banner reads exactly "إيصال مسودة — أكّده لاحقاً ليثبت البضاعة في المخزون. الضريبة تُسجّل عند فاتورة المشتريات المطابقة."

**PUR-77 — Save persists and survives reload; cancel discards**
- Steps: create a receipt against `PO-DEMO-4` (the only order with a full remaining line still worth testing, since `PO-DEMO-3`'s tea line is also outstanding) → "حفظ مسودة" → reload → find it in the list as a second draft receipt against `PO-DEMO-4`.
- Assert: persists with مسودة status, invoiced=false. Separately: open create, pick a PO, click "إلغاء" — nothing added.
- Note: this creates a **second** open receipt against `PO-DEMO-4` alongside the seeded `GRN-DEMO-3` — both draw from the same outstanding line; confirming one does not check whether the other's preview quantity updates live (it won't, since the preview reads from the PO's stale `receivedQty` in the already-fetched list) — worth a follow-up scenario if pursued further, not asserted here.

### Receipt detail — `GoodsReceiptsScreen.tsx` (`ReceiptDetail`)

**PUR-78 — مسودة detail: GRN-DEMO-3**
- Steps: open `GRN-DEMO-3`.
- Assert: action "تأكيد الاستلام" present; effects panel (draft variant): "إيصال مسودة — أكّده ليثبت البضاعة في المخزون." / "الضريبة والمستحق للمورد يُسجّلان لاحقاً عند فاتورة المشتريات المطابقة."; حالة الفوترة reads "غير مفوتر".

**PUR-79 — Confirm GRN-DEMO-3 — the documented no-GL-entry state**
- Pre: note GL 1200 (inventory) and the inventory sub-ledger balance before confirming (via `/reconciliation` or the accounting reports, per `docs/testing-policy.md`'s curl instructions).
- Steps: click "تأكيد الاستلام".
- Assert: status flips to مؤكد; effects panel switches to the confirmed variant ("تمت زيادة كمية المخزون..." / "لم تُسجّل الضريبة أو المستحق للمورد بعد..." / "تم تحديث حالة أمر الشراء..."); `PO-DEMO-4`'s status becomes مستلم بالكامل (sugar line was its only line, now fully received) — reload the PO to confirm.
- **This is the documented case**: stock rises by the received quantity with **no GL entry** — the inventory sub-ledger is now ahead of GL 1200 by exactly this receipt's `totalCost`, until an invoice against it is confirmed. This is by design, not a defect — do not re-file it. Measure the exact gap (it should equal `GRN-DEMO-3`'s totalCost) and leave the receipt confirmed-but-uninvoiced to prove the gap is real, or proceed to invoice it (PUR-97) to close it.

**PUR-80 — مؤكد + مفوتر detail: GRN-DEMO-1**
- Steps: open `GRN-DEMO-1`.
- Assert: no action buttons besides رجوع; حالة الفوترة reads "مفوتر" (tone success); البنود shows rice(100@140) and sugar(300@31) with computed line totals.

**PUR-81 — مؤكد + مفوتر, partial: GRN-DEMO-2**
- Steps: open `GRN-DEMO-2`.
- Assert: single line, oil 120@72=8,640; حالة الفوترة "مفوتر"; confirm this receipt's total does **not** include the 60 tea units that were never received (they were on the PO but never appear on this receipt at all — the receipt only ever recorded what was actually received).

**PUR-82 — No cancel path for a Goods Receipt**
- Assert: `[NOT IMPLEMENTED]` — same pattern as POs; ملغي exists as a status value with a defined tone but is unreachable from any button.

---

## فواتير المشتريات (Purchase Invoices)

### List — `apps/web/src/screens/PurchaseInvoicesScreen.tsx`

**PUR-83 — Search by number or supplier**
- Steps: search `PI-DEMO-6`'s displayed number; then search "سياج".
- Assert: number search isolates it; supplier search returns every invoice against `SUPP-DEMO-2` (`PI-DEMO-2`, `PI-DEMO-5`, `PI-DEMO-7`).

**PUR-84 — Status tabs — no payment-lifecycle states at all**
- Assert: chips are only الكل(7)/مسودة(0)/مؤكد(7)/ملغي(0). `[NOT IMPLEMENTED]` — the catalog's متأخر (overdue), مستحقة قريباً (due soon), مدفوع جزئياً, مدفوع states do not exist anywhere in this screen's status enum (`PurchaseInvoiceStatusDTO` is just draft/confirmed/cancelled). Every invoice, however partially or fully paid, always shows مؤكد.

**PUR-85 — Columns — no remaining-balance or "بواسطة" column**
- Assert: `[NOT IMPLEMENTED]` — columns are رقم الفاتورة / المورد / التاريخ / الإجمالي / الحالة. The catalog's تاريخ الاستحقاق and المبلغ المتبقي columns are missing entirely (replaced by plain التاريخ and الإجمالي), and there is no "بواسطة" (created-by) column.

**PUR-86 — KPI strip**
- Assert: "إجمالي الفواتير"=7, "مؤكدة"=7, "إجمالي المشتريات"=sum of all 7 totals, "مسودة"=0.

**PUR-87 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting.

**PUR-88 — Header actions — no historical import**
- Assert: only "فاتورة مشتريات جديدة" exists. `[NOT IMPLEMENTED]` — no "استيراد فواتير سابقة" button, no import modal, no template-download link, anywhere in the code. The entire historical-import feature the catalog describes (fully-paid-vs-remaining-balance handling, per-line Excel upload, "استيراد N فاتورة" counter) is absent.

**PUR-89 — Empty state**
- Steps: search a non-existent number.
- Assert: "لا توجد فواتير مطابقة".

### Create invoice

**PUR-90 — طريقة الإنشاء toggle**
- Steps: open "فاتورة مشتريات جديدة" → observe the two chips.
- Assert: "إنشاء فاتورة جديدة" (manual, default active) and "من إيصال استلام" (from-receipt); switching changes the whole form below.

**PUR-91 — Manual mode: supplier required**
- Steps: leave المورد unset with a valid line.
- Assert: "حفظ مسودة" stays disabled (`canSave` requires `supplier !== null`).

**PUR-92 — Manual mode: line kind toggle مخزني / مصروف شحن**
- Steps: on a line, switch to "مصروف شحن".
- Assert: the item `EntityPicker` is replaced by a "وصف المصروف" text field (placeholder "شحن / جمارك…"); ضريبة % resets to 0 automatically when switching to expense (`taxRatePercent: 0` on toggle) but remains editable afterward; switch back to "مخزني" and confirm the item picker returns.

**PUR-93 — Manual mode: item pick auto-fills cost and tax rate**
- Steps: pick `ITEM-DEMO-4` on an inventory-kind line.
- Assert: التكلفة auto-fills to 205 (item's costPrice); ضريبة % auto-fills to 14 (item's taxRatePercent) — both remain editable.

**PUR-94 — Manual mode: negative quantity dropped, negative cost passed through**
- Same pattern as PUR-38/PUR-56: a qty<0 line vanishes from the save payload silently (`l.qty > 0` filter); a qty>0 line with a negative التكلفة is sent as-is (no client guard) — record whatever the server does.

**PUR-95 — Manual mode: no branch/warehouse fields — hardcoded-ID bug (3rd occurrence)**
- Assert: same as PUR-39/PUR-57 — `branchId: "MAIN", warehouseId: "MAIN-WH"` hardcoded, no picker, mismatched against the tenant's real `BR-MAIN`/`WH-MAIN`.

**PUR-96 — From-receipt mode: only confirmed, uninvoiced receipts are selectable**
- Pre: at seed state, `GRN-DEMO-1` and `GRN-DEMO-2` are already invoiced; `GRN-DEMO-3` is still draft.
- Steps: switch to "من إيصال استلام" → check "إيصال الاستلام *" options **before** doing PUR-79.
- Assert: the picker is **empty** and shows "لا توجد إيصالات غير مفوترة" — this is a genuinely testable empty state that only appears in this exact seed configuration. Confirm no supplier field appears in this mode (it's inferred from the picked receipt).

**PUR-97 — From-receipt mode: invoice GRN-DEMO-3 after confirming it**
- Pre: complete PUR-79 (confirm `GRN-DEMO-3`) first.
- Steps: reopen create → من إيصال استلام → pick the now-eligible `GRN-DEMO-3` receipt.
- Assert: a read-only preview populates from the receipt's lines (sugar 250@31); رقم فاتورة المورد optional; "حفظ مسودة" enabled; save → status مسودة; confirm (PUR-101 pattern) → AP rises by this invoice's total and the sub-ledger/GL 1200 gap opened by PUR-79 closes. Verify with `/reconciliation` that the gap measured in PUR-79 is now zero.

**PUR-98 — Save persists and survives reload; cancel discards**
- Steps: create a manual invoice against `SUPP-DEMO-1` with one inventory line and one expense line → حفظ مسودة → reload → open it.
- Assert: both lines persist with correct kind/qty/cost/tax; subtotal/tax/total recompute correctly on reload, not just client-side. Separately: cancel discards.

### Invoice detail — `PurchaseInvoicesScreen.tsx` (`InvoiceDetail`)

**PUR-99 — Manual invoice detail: PI-DEMO-1**
- Steps: open `PI-DEMO-1`.
- Assert: "المصدر" reads "إدخال يدوي"; effects panel (no-receipt variant): "تُضاف الأصناف المخزنية إلى المخزون..." / "يزيد المستحق للمورد..." / "لا يوجد دفع تلقائي..."; البنود tab lists rice(200@140) and sugar(500@31), footer shows subtotal/tax/total stacked in the last cell.

**PUR-100 — From-receipt invoice detail: PI-DEMO-6**
- Steps: open `PI-DEMO-6`.
- Assert: "المصدر" reads "من إيصال استلام"; effects panel (receipt variant, dedup wording): "تمّت إضافة الأصناف للمخزون سابقاً عند إيصال الاستلام — لا تُضاف مرة أخرى (تجنّب الازدواج)."; رقم فاتورة المورد shows "GV-2026-0817"; تاريخ الاستحقاق shows 2026-09-11.

**PUR-101 — Confirm a draft invoice**
- Steps: on a freshly created draft (e.g. from PUR-98), click "تأكيد الفاتورة".
- Assert: status flips مسودة→مؤكد; AP (GL 2100 / the supplier's balance) rises by exactly the invoice total; for the inventory line, stock/valuation rises by qty×unitCost; trial balance still balances afterward.

**PUR-102 — No المزيد menu — no Share/Print/Create-return/Cancel-invoice**
- Assert: `[NOT IMPLEMENTED]` — only "تأكيد الفاتورة" (draft only) and "رجوع" ever appear in the header. Catalog's "مشاركة", "طباعة", "إنشاء مرتجع" shortcut, and "إلغاء الفاتورة" all have no equivalent — a return must be started from the Purchase Returns screen itself (PUR-108+), with no deep link from here.

**PUR-103 — Only one tab — البنود**
- Assert: `[NOT IMPLEMENTED]` — catalog lists 7 tabs (البنود/المدفوعات/المرتجعات/التكاليف الإضافية/القيود المحاسبية/المرفقات/سجل المراجعة); only البنود exists. There is no way to see this invoice's payments, its returns, its landed-cost allocations, its journal entries, or an audit trail from this screen at all.

**PUR-104 — No consumed/received tracking column**
- Assert: `[NOT IMPLEMENTED]` — catalog's المستهلك/المستلم columns (sold-tracking) on البنود do not exist; the actual columns are الصنف/النوع/الكمية/تكلفة الوحدة/ضريبة %/الإجمالي.

**PUR-105 — "تسجيل دفعة" does not exist anywhere on this screen**
- Assert: `[NOT IMPLEMENTED]` — neither the list row actions nor the detail header expose a record-payment control, contrary to the catalog. The **only** way to record a supplier payment in this build is Treasury → Vouchers, creating a `supplier_payment` voucher and allocating it to the invoice manually (exactly how the seed produces `VCH-DEMO-3`'s 60%-of-`PI-DEMO-1` allocation) — a materially more manual flow than the catalog's inline button. Confirm that after such a voucher is confirmed and allocated, `PI-DEMO-1`'s status **still reads مؤكد** on this screen (PUR-84 already established there is no partial-paid state to move to) — the true remaining balance is only visible via Suppliers → `SUPP-DEMO-1` → كشف حساب المورد (PUR-26).

**PUR-106 — No historical import modal reachable from anywhere**
- Cross-reference to PUR-88 — restated here since it's the single largest missing feature on this screen.

---

## مرتجعات المشتريات (Purchase Returns)

### List — `apps/web/src/screens/PurchaseReturnsScreen.tsx`

**PUR-107 — No search box at all**
- Steps: look for a search input near the header.
- Assert: `[NOT IMPLEMENTED]` — `DocumentList` is invoked here without `searchValue`/`onSearchChange`/`searchPlaceholder`; there is no way to search Purchase Returns by number or supplier, contrary to the catalog's "بحث برقم المرتجع أو اسم المورد…".

**PUR-108 — Status tabs — no بانتظار استلام المبلغ state**
- Assert: chips are الكل(2)/مسودة(1, `PRT-DEMO-2`)/مؤكد(1, `PRT-DEMO-1`)/ملغي(0). `[NOT IMPLEMENTED]` — the catalog's "بانتظار استلام المبلغ" (awaiting refund) status/tab does not exist; a confirmed return has no further sub-state to reach.

**PUR-109 — KPI strip is missing two of four catalog tiles**
- Assert: only "إجمالي المرتجعات"=2 and "مؤكدة"=1 render. `[NOT IMPLEMENTED]` — "إجمالي قيمة المرتجعات" and "مسودة" count tiles from the catalog are absent.

**PUR-110 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting.

**PUR-111 — No استيراد مرتجعات سابقة header action**
- Assert: `[NOT IMPLEMENTED]` — only "مرتجع جديد" exists.

**PUR-112 — Table columns and row detail**
- Assert: رقم المرتجع column shows "مسودة" as the number for `PRT-DEMO-2` (no doc number assigned until confirmed) with its source-invoice number as subtext; المورد resolves from the first line's `supplierId`; قيمة المرتجع sums `unitCost×qty + taxAmount` per line; row click opens a SidePanel (not a full page) — confirm this differs from the RFQ/PO/Receipt/Invoice pattern, which all navigate to a full `DocumentDetail` page.

**PUR-113 — Empty state**
- Pre: filter to a status with zero rows isn't directly possible without search — use the status chips (e.g. there's no combination producing zero here with only 2 seed rows and 3 chips covering both). Skip, or create+cancel a return first to leave a status with 0 rows, then confirm "لا توجد مرتجعات — أنشئ مرتجعاً جديداً" renders.

### Create return

**PUR-114 — Invoice picker defaults to the first confirmed invoice, not empty**
- Steps: open "مرتجع جديد".
- Assert: الفاتورة الأصلية is pre-populated (native `<select>`, no blank option — the two `useEffect`s auto-pick the first confirmed invoice and first warehouse the moment the queries resolve) — this differs from the catalog's typeahead-with-no-default behavior. Option labels read plainly "`{number} — {supplierName}`" — `[NOT IMPLEMENTED]` vs. catalog's richer "PI-000002 — جاري · 10.00 ج.م | 20/08/2026" format (no amount, no date shown in the dropdown).

**PUR-115 — No original-invoice info panel**
- Assert: `[NOT IMPLEMENTED]` — after picking an invoice, the catalog describes a read-only summary panel (رقم الفاتورة/المورد/تاريخ الفاتورة/إجمالي الفاتورة/الحالة). No such panel exists; the only visible trace of the selected invoice is its appearance in the dropdown label and in the line-item source.

**PUR-116 — Reason dropdown — all 5 catalog options present**
- Assert: بضاعة معيبة / صنف خاطئ / كمية زائدة / مشكلة جودة / أخرى — matches the catalog exactly (`REASON_LABEL` keys DEFECTIVE/WRONG_ITEM/EXCESS_QTY/QUALITY_ISSUE/OTHER).

**PUR-117 — No notes/memo field**
- Assert: `[NOT IMPLEMENTED]` — `memo: ""` is hardcoded on every created return; there is no ملاحظات field in the create panel at all, contrary to the catalog.

**PUR-118 — Line items: no available-qty display, no client-side cap — the over-return gate**
- Pre: pick `PI-DEMO-7` (السياج، oil originally invoiced qty 120). It already has `PRT-DEMO-1` confirmed for 20, leaving 100 truly available, and `PRT-DEMO-2` draft for 12 more.
- Steps: on the create form, pick `ITEM-DEMO-2` (the only inventory line on this invoice) and set الكمية to `150` — more than both the 100 actually remaining **and** more than the invoice's original 120.
- Assert: `[NOT IMPLEMENTED]` — no "الكمية المتاحة" is ever displayed to the user, and there is no `max` cap on the quantity field. The client sends `availableQty: source?.qty ?? String(l.qty)` — i.e. it reports the **original invoiced quantity (120)**, not the true remaining-after-prior-returns figure — as `availableQty` on every submitted line, regardless of how much has already been returned. Record whether the server: (a) rejects the over-return with a specific error, (b) rejects it with a generic one, or (c) accepts it, breaking the invoice's real returnable balance. Any of (b) or (c) is a new, previously unrecorded defect — cite the exact qty typed and the exact server response.

**PUR-119 — Two save actions: حفظ كمسودة / حفظ وتأكيد**
- Steps: fill a valid return, save via each button on two separate attempts.
- Assert: "حفظ كمسودة" creates status مسودة (no docNo yet); "حفظ وتأكيد" creates it and immediately confirms it in one round trip (status مؤكد, docNo assigned) — confirm stock and AP move only for the second one.

**PUR-120 — Required-field guard produces an inline message here (unlike most other Purchases forms)**
- Steps: attempt to submit with `warehouseId` cleared (if reachable) or with zero valid lines.
- Assert: unlike RFQ/PO/GRN/Invoice (which just disable the button), this screen shows an actual `error` string: "اختر الفاتورة الأصلية والمستودع." or "أضف بنداً واحداً على الأقل بكمية أكبر من صفر." — confirm the exact text and that the button stays enabled/clickable (the guard fires on click, not via `disabled`).

### Return detail (SidePanel)

**PUR-121 — مسودة detail: PRT-DEMO-2**
- Steps: click the row.
- Assert: SidePanel shows status pill مسودة, "الفاتورة الأصلية: {PI-DEMO-7's number}", one line (oil, 12 × 72), actions "تأكيد المرتجع" and "إلغاء".

**PUR-122 — مؤكد detail: PRT-DEMO-1, and confirmed returns can still be cancelled**
- Steps: open `PRT-DEMO-1`.
- Assert: status مؤكد; single action "إلغاء المرتجع" is present — **unlike every other Purchases document type in this build** (POs, receipts, invoices, and the create-time draft state of RFQs/returns/landed-costs all lose their cancel option once confirmed), a **confirmed** Purchase Return can still be cancelled from its detail panel. Note this asymmetry; it's worth deliberately exercising once to see whether cancelling a confirmed return correctly reverses the stock decrease and AP credit it posted, or leaves a dangling reversal gap (out of this file's scope to assert the ledger math precisely — record what you observe).

---

## التكاليف الإضافية (Landed Costs)

### List — `apps/web/src/screens/LandedCostsScreen.tsx`

**PUR-123 — No search box**
- Assert: `[NOT IMPLEMENTED]` — same as Returns; no `searchValue` prop passed.

**PUR-124 — Status chips omit ملغي despite it being reachable**
- Assert: chips are only الكل(2)/مسودة(1, `LC-DEMO-2`)/مؤكد(1, `LC-DEMO-1`). `[NOT IMPLEMENTED]` — even though a confirmed or draft landed cost **can** be cancelled from its detail panel (see PUR-133), there is no ملغي chip to filter down to one once it exists. The catalog's "بانتظار التسوية" status also has no equivalent anywhere.

**PUR-125 — KPI strip is missing 2 of the catalog's tiles**
- Assert: only "إجمالي المستندات"=2 and "مؤكدة"=1 render. `[NOT IMPLEMENTED]` — no cost-sum KPI ("التكلفة المؤكدة"), no cancelled-count expansion.

**PUR-126 — Table columns miss التاريخ / المستودع / الفواتير المرتبطة**
- Assert: `[NOT IMPLEMENTED]` — actual columns are رقم المستند / طريقة التوزيع / إجمالي التكلفة / الحالة only.

**PUR-127 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting.

**PUR-128 — Empty state**
- Assert: "أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات" (only reachable on a fresh tenant — not directly triggerable here without deleting seed data).

### Create landed cost

**PUR-129 — Warehouse picker does not gate the invoice picker**
- Steps: open "مستند تكلفة جديد" → change المستودع.
- Assert: `[NOT IMPLEMENTED]` vs. catalog's "اختر المستودع أولاً لعرض الفواتير" gating placeholder — the invoice `<select>` here lists **all** confirmed invoices regardless of which warehouse is selected; changing warehouse has no effect on which invoices are selectable.

**PUR-130 — Only one linked invoice, not a multi-select**
- Assert: `[NOT IMPLEMENTED]` — catalog describes "الفواتير المرتبطة" as multiple; the actual field is a single `<select>` (`invoiceId`), one invoice per document.

**PUR-131 — Distribution method options**
- Assert: حسب القيمة (default) / حسب الكمية — matches the catalog exactly.

**PUR-132 — No date, no description/memo fields**
- Assert: `[NOT IMPLEMENTED]` — `date` is hardcoded to today and `memo` to `""` on every created document; neither field appears anywhere in the create panel, contrary to the catalog's "التاريخ *" / "الوصف" / "ملاحظات".

**PUR-133 — Cost items: type/description/amount, add/remove**
- Steps: add a second cost line (default costType شحن) → change it to جمارك → set amount.
- Assert: COST_TYPE_LABEL options exactly شحن/جمارك/تأمين/تخليص/أخرى, matching the catalog; footer "إجمالي التكلفة" updates live as amounts change.

**PUR-134 — Target items: item/qty/unitCost all freely editable, no source cap**
- Steps: pick a target item from the invoice's stock lines, then manually change الكمية and التكلفة الحالية to values that don't match the invoice's actual line (e.g. type a qty larger than what was ever invoiced on that line).
- Assert: no validation blocks this — the target qty/unitCost are plain editable `NumberField`s seeded from the invoice line but not locked to it. Confirm what the live preview and, if you confirm the document, the actual persisted allocation do with a mismatched qty — this is the landed-cost analogue of PUR-118's over-qty gate and is worth recording precisely if it changes the allocation math unexpectedly.

**PUR-135 — Live allocation preview: BY_VALUE math on LC-DEMO-1's numbers**
- Steps: reproduce `LC-DEMO-1`'s exact setup in a **new** document (since it's already confirmed): warehouse = the seed warehouse, invoice = a confirmed invoice with `ITEM-DEMO-1` (qty 100 @ 140) and `ITEM-DEMO-3` (qty 300 @ 31) lines (e.g. `PI-DEMO-1`, which has the same two items at those exact quantities/costs), method حسب القيمة, cost items SHIPPING 1800 + CLEARANCE 700.
- Assert: "معاينة التوزيع" shows two rows; each allocated amount is proportional to line value (100×140=14,000 vs 300×31=9,300, total value 23,300) — rice gets ≈1,502.15 of the 2,500, sugar gets ≈997.85; **the two allocated amounts sum to exactly 2,500.00 with no rounding leak** (verify this arithmetically, to the smallest money unit — this is the assertion the task brief calls out explicitly); each row's "تكلفة جديدة" equals the original unit cost plus (allocated amount ÷ qty).

**PUR-136 — Live allocation preview: BY_QUANTITY math on LC-DEMO-2's numbers**
- Pre: `LC-DEMO-2` itself is still draft — open it directly instead of re-creating it.
- Steps: open `LC-DEMO-2`'s detail panel (read-only) or reconstruct it in create mode.
- Assert: single target (`ITEM-DEMO-2`, qty 120) with a single cost total (300+450=750) under BY_QUANTITY trivially allocates 100% of 750 to that one line — confirm the preview/allocated amount is exactly 750.00, and the new unit cost is 72 + 750/120 = 78.25.

**PUR-137 — Two save actions: حفظ / حفظ وتأكيد التوزيع**
- Assert: same pattern as Returns (PUR-119) — plain save leaves it مسودة with no allocation posted yet (unit costs unchanged); save-and-confirm posts the allocation and bumps unit costs immediately.

**PUR-138 — Confirm LC-DEMO-2, then verify unit-cost and inventory-valuation effects**
- Pre: `LC-DEMO-2` is draft.
- Steps: open it → "تأكيد التوزيع".
- Assert: `ITEM-DEMO-2`'s weighted-average unit cost in the affected warehouse rises by 750/120 = 6.25 per unit (from 72 to 78.25) for that cost layer; inventory valuation rises by exactly 750.00; AP is **not** affected by this action (landed costs don't touch a supplier balance the way an invoice does — confirm no AP movement occurs); trial balance still balances afterward.

### Landed cost detail (SidePanel)

**PUR-139 — مسودة detail: LC-DEMO-2**
- Assert: shows each target line as "+{allocatedAmount} → تكلفة جديدة {newUnitCost}"; actions "تأكيد التوزيع" and "إلغاء" (both present since it's draft).

**PUR-140 — مؤكد detail: LC-DEMO-1, and confirmed documents can still be cancelled**
- Steps: open `LC-DEMO-1`.
- Assert: status مؤكد; single action "إلغاء المستند" — same asymmetry noted in PUR-122: a **confirmed** landed cost can still be cancelled here, unlike POs/receipts/invoices. If you exercise it, record whether the unit-cost bump it posted is actually reversed or left in place (this file does not assert the answer — only that it's worth checking, since an un-reversed cost bump after "cancelling" a landed cost would silently misstate inventory valuation going forward).

---

## إدارة المشتريات (Purchases Hub)

**PUR-141 — Route is reachable from the sidebar in this build (unlike the reference product)**
- Pre: `nav-config.ts` lists `"purchases-hub"` as the first item inside the `purchases` nav group.
- Steps: click المشتريات in the sidebar to expand the group → click its first sub-item.
- Assert: lands on `/purchases/hub` (or equivalent) — **note this is a positive discrepancy vs. the catalog**, which documented the hub as a real-but-unlinked route in the reference product; here it is an ordinary, discoverable nav entry.

**PUR-142 — Quick actions: 5 buttons, only 3 auto-open their create panel**
- Steps: click each of the 5 quick-action buttons in turn, returning to the hub between clicks.
- Assert: "أمر شراء جديد", "استلام بضاعة", "فاتورة مشتريات جديدة" each navigate to their screen **and** immediately open its create SidePanel (via `useScreenIntent`). "طلب عرض سعر" and "مرتجعات المشتريات" navigate to their screens but land on the plain list — `[NOT IMPLEMENTED / inconsistency]` — `RfqsScreen` and `PurchaseReturnsScreen` never call `useScreenIntent`, so these two quick actions behave differently from the other three despite looking identical on the hub.

**PUR-143 — No "مورد جديد" quick action**
- Assert: `[NOT IMPLEMENTED]` vs. catalog's 4-item quick-create row (which includes "مورد جديد") — the actual build's quick-action row has 5 buttons and none of them creates a supplier.

**PUR-144 — StatCards replace the catalog's tile grid and stepper entirely**
- Assert: `[NOT IMPLEMENTED]` — the catalog describes a "مسار الشراء" mini-stepper (أوامر الشراء → استلام البضائع → فواتير الموردين with hint text) and a "مناطق العمل" tile grid with per-domain counts and "عرض" deep links (including a ديت-linked "تصنيفات الموردين" and separate tiles for مرتجعات المشتريات / التكاليف الإضافية). None of that exists. The actual build has exactly 4 `StatCard`s: "أوامر شراء مفتوحة" (sent+partially_received count = 2, i.e. `PO-DEMO-3`+`PO-DEMO-4`), "استلامات غير مفوترة" (confirmed & !invoiced = 1, `GRN-DEMO-3` once confirmed, else 0 before PUR-79), "فواتير المشتريات" (=7), "عدد الموردين" (=2). No per-tile "عرض" link, no returns/landed-cost counts, no supplier-categories shortcut (consistent with PUR-29).

**PUR-145 — Recent invoices list is not clickable**
- Assert: `[NOT IMPLEMENTED]` — "أحدث فواتير المشتريات" lists up to 5 invoices sorted by date desc (confirm `PI-DEMO-7`, dated 2026-08-20, appears among the top 5 alongside `PI-DEMO-6`), but each `<li>` has no `onClick`/link — clicking a row does nothing; there is no way to jump straight to an invoice's detail page from the hub.

**PUR-146 — Empty-tenant copy**
- Assert: "لا توجد فواتير مشتريات بعد — ستظهر هنا فور إنشاء أول فاتورة." — not directly triggerable against the seeded tenant (7 invoices always exist); note the copy for completeness.

---

## End-to-end procurement chain, and trying to skip a gate

The whole point of this module is the three-gate chain RFQ → PO → Goods Receipt →
Purchase Invoice, with Returns and Landed Costs hanging off a confirmed invoice
or receipt. These scenarios exercise it start to finish and then try to jump
each gate.

**PUR-147 — Full chain from a fresh RFQ to a confirmed invoice**
- Pre: none of the seed RFQs are left mid-chain and untouched except `RFQ-DEMO-2` (already partly exercised by PUR-43/44/45 if you ran those — otherwise use it fresh, or create a brand-new RFQ if you want a completely clean run).
- Steps: create RFQ → send → record two suppliers' quotes → compare → convert the cheaper one to a PO → confirm the PO → create a receipt against it (full amount, since partial isn't possible through the UI — PUR-75) → confirm the receipt → create an invoice "from receipt" against it → confirm the invoice.
- Assert at each step: RFQ reaches مغلق and links to the new PO; the PO's status moves مسودة→مرسل then straight to مستلم بالكامل on the one full receipt (partial isn't reachable via UI); stock rises by exactly the received quantity **at receipt-confirm time**, with **no GL movement yet** (measure GL 1200 immediately before and after this step — it must not move); AP and GL 1200 both rise together only at **invoice-confirm time**, by exactly the invoice total; trial balance balances before and after every step.

**PUR-148 — Manual invoice with no receipt at all is a supported path, not a skipped gate**
- Steps: create a purchase invoice manually (طريقة الإنشاء = إنشاء فاتورة جديدة) for a supplier with no PO or receipt involved at all.
- Assert: this succeeds — by design, the manual-entry path exists precisely for suppliers/purchases with no PO/receipt chain (e.g. small ad-hoc buys). This is **not** "invoicing without a receipt" in the sense of bypassing a lock — the real gate only applies to the **from-receipt** path, which restricts its picker to confirmed-and-uninvoiced receipts only (PUR-96). Don't mistake this for a defect; it's the documented alternate entry point the catalog itself describes ("طريقة الإنشاء" toggle).

**PUR-149 — Receiving against a draft PO is blocked at the picker**
- Steps: open Goods Receipts → create → check whether `PO-DEMO-1` (مسودة) appears in the أمر الشراء picker.
- Assert: it does not (PUR-74) — the gate is enforced by excluding it from the option list entirely, not by accepting the selection and then rejecting on save. There is no way through the UI to even attempt this.

**PUR-150 — Receiving against an already fully-received PO is blocked the same way**
- Steps: check whether `PO-DEMO-2` (مستلم بالكامل) appears in the same picker.
- Assert: excluded, same as PUR-149 (its status doesn't match `sent`/`partially_received`).

**PUR-151 — Invoicing from an ineligible receipt is blocked at the picker**
- Steps: in Purchase Invoices → create → من إيصال استلام, check whether a draft receipt (`GRN-DEMO-3`, before confirming it) or an already-invoiced one (`GRN-DEMO-1`, `GRN-DEMO-2`) appears.
- Assert: none do (PUR-96) — same client-side exclusion pattern as receipts.

**PUR-152 — Receiving more than ordered cannot be attempted through the UI**
- Assert: cross-reference PUR-75 — this is a genuine scope gap in the build, not just an edge case the UI happens to handle correctly. Since there is no editable received-quantity field anywhere in Goods Receipts, the "receive more than ordered" boundary test this file's brief asks for **cannot be exercised as a UI test** at all in the current build; it can only be attempted via a direct `POST /purchases/receipts` call with an inflated `qty`, which is outside this file's UI-only scope. Record this as a build limitation, not a pass/fail result.

**PUR-153 — Returning more than received/available is not blocked in the UI — the real gate test**
- Cross-reference PUR-118 — this is the one over-limit scenario in the whole module that **is** reachable purely through clicking: the return-quantity field has no cap and no visible "available" figure. Run PUR-118 to completion (submit the over-limit qty) and record the server's actual response as the finding for this scenario.

**PUR-154 — Leaving a receipt confirmed-but-uninvoiced is a documented, correct state — not a bug**
- Cross-reference PUR-79. Confirming `GRN-DEMO-3` (or any receipt) and then **not** invoicing it immediately is exactly the scenario `docs/defects.md`'s context note warns about: the inventory sub-ledger sits ahead of GL 1200 by that receipt's value, with zero GL entries posted, because there is no goods-received-not-invoiced accrual account in this chart of accounts. If you see this gap after confirming a receipt and before invoicing it, that is this — say so in your notes, don't file it as a new defect.

**PUR-155 — Landed cost allocation targets are not capped to the invoice's real line quantities**
- Cross-reference PUR-134 — the second "skip a gate" style test this brief calls for outside the RFQ→PO→GR→PI chain proper: a landed cost's target quantity can be set to something that doesn't match what the linked invoice actually recorded for that item, with no validation stopping it, potentially misallocating cost onto a quantity that was never really purchased through that document.
