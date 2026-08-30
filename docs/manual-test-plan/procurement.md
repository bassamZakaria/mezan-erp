# Manual test plan — Procurement (المشتريات)

Scope: everything reachable from the **المشتريات** nav group — طلبات عروض
الأسعار (`#/purchases/rfqs`), أوامر الشراء (`#/purchases/purchase-orders`),
استلام البضائع (`#/purchases/goods-receipts`), فواتير المشتريات
(`#/purchases/purchase-invoices`), مرتجعات المشتريات
(`#/purchases/purchase-returns`), التكاليف الإضافية
(`#/purchases/landed-costs`), الموردون (`#/purchases/vendors`), and the four
reports under "تقارير" (المشتريات حسب الفترة / حسب المورد / حسب الصنف, أعمار
ديون الموردين). Every scenario below exercises a route that exists in
`packages/api/src/purchases-routes.ts`, `rfq-routes.ts`, `suppliers-routes.ts`,
`landed-costs-routes.ts` or `purchase-returns-routes.ts`, driven through the
matching screen in `apps/web/src/screens/`.

All scenarios assume the seeded demo tenant (`MEZAN_SEED_DEMO=1`), signed in
as a user holding the `purchases.*` permission codes noted per scenario.
Seeded purchasing fixtures (`packages/backend/src/demo-seed/purchasing.ts`):
two suppliers — **SUPP-DEMO-1** «مصنع الوادي الأخضر» (شروط الدفع 30 يوماً) and
**SUPP-DEMO-2** «شركة سياج للصناعات» (60 يوماً) — plus **SUPP-DEMO-USD**
«مورد المعدات الدولي» (USD, 45 يوماً); four items at 14% VAT (أرز أبيض 5 كجم،
زيت عباد الشمس 1 لتر، سكر أبيض 1 كجم، شاي أسود 500 جم); three RFQs
(RFQ-DEMO-1 closed/converted, RFQ-DEMO-2 sent with one quote, RFQ-DEMO-3
draft); four purchase orders (PO-DEMO-1 draft, PO-DEMO-2 fully received and
invoiced, PO-DEMO-3 partially received and partially invoiced, PO-DEMO-4
confirmed with a **draft, unconfirmed** receipt GRN-DEMO-3); two landed-cost
documents (LC-DEMO-1 confirmed, LC-DEMO-2 draft); two purchase returns
(PRT-DEMO-1 confirmed, PRT-DEMO-2 draft). GL control accounts:
**1200** المخزون، **2100** الموردون (AP)، **1400** ضريبة المدخلات، **2120**
بضاعة واردة لم تُفوتر (GRNI)، **5200** مصروفات الشحن والنقل، **5910** مصروفات
عمومية.

---

## A. Supplier master, terms and price history

### MTP-PUR-01 — Add a new supplier with payment terms
- **Persona / permission:** مسؤول مشتريات، `purchases.supplier.create`
- **Preconditions:** seeded tenant; on `#/purchases/vendors`
- **Steps:**
  1. Click **«إضافة مورد»**.
  2. Fill **«الاسم»** = "مطاحن الدلتا"، **«الكود»** = "S-0099".
  3. Set **«شروط الدفع (أيام)»** = 45.
  4. Fill **«الرقم الضريبي»**, **«جهة الاتصال»**, city/district/street.
  5. Save.
- **Expected:** the new row appears in the list with **شروط الدفع** = "45 يوماً" and **المستحق** (payable) = 0.00. `GET /suppliers` returns the row with `paymentTermsDays: "45"` (or `45`) and no opening AP.
- **False pass:** the row appears in the list (proves the create call worked) but the payment-terms figure is never checked against what a purchase invoice raised against this supplier later computes for `dueDate` (MTP-PUR-02) — the field existing is not the field being used.

### MTP-PUR-02 — Payment terms drive the invoice due date
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.create`
- **Preconditions:** supplier from MTP-PUR-01 (45-day terms), one purchasable item
- **Steps:**
  1. `#/purchases/purchase-invoices/new` → **«إنشاء فاتورة جديدة»** (manual).
  2. Pick the new supplier, add one مخزني line, qty 10, cost 100, ضريبة % 14.
  3. Set **«التاريخ»** = today, save as draft.
- **Expected:** on the detail page **«تاريخ الاستحقاق»** is today + 45 days. If the invoice's own due-date field was left blank/derived elsewhere, note whether it silently used a house default (e.g. 30) instead of the supplier's 45.
- **False pass:** confirming that *a* due date is shown, without computing today+45 and comparing digit for digit.

### MTP-PUR-03 — Supplier statement reconciles to the AP sub-ledger and the aging report
- **Persona / permission:** مسؤول مشتريات، `purchases.supplier.view`
- **Preconditions:** SUPP-DEMO-1, which carries PI-DEMO-6 (confirmed, 100×140 + 300×31 lines, 14% VAT) and no returns
- **Steps:**
  1. Open **الموردون** → SUPP-DEMO-1 → tab **«كشف حساب المورد»**.
  2. Read **«الرصيد الختامي (مستحق للمورد)»**.
  3. Read the reconciliation footnote against **«دفتر الفواتير المفتوحة»** and against **«تقرير أعمار الديون»**.
- **Expected:** the footnote reads **«مطابق لدفتر الفواتير المفتوحة»** and **«مطابق لتقرير أعمار الديون»** — both green, not just present. The closing balance in EGP must equal the sum shown on `GET /reports/aging/suppliers` for this supplier, to the cent.
- **False pass:** a closing balance is displayed (looks plausible) but the "differs from" note is showing and gets skimmed past — the screen already tells you the two numbers disagree; treating the page load as success without reading the note is the false pass.

### MTP-PUR-04 — Purchase invoices tab is scoped to the one supplier
- **Persona / permission:** مسؤول مشتريات، `purchases.supplier.view`
- **Preconditions:** at least two suppliers each with confirmed invoices (SUPP-DEMO-1: PI-DEMO-6; SUPP-DEMO-2: PI-DEMO-7)
- **Steps:**
  1. Open SUPP-DEMO-1 → tab **«فواتير المشتريات»**.
  2. Note **«إجمالي المؤكد»**.
  3. Repeat for SUPP-DEMO-2.
- **Expected:** SUPP-DEMO-1's list shows only PI-DEMO-6 (14,800 + 9,300 = 24,100 net of VAT before tax; total with 14% VAT = 27,474.00), SUPP-DEMO-2's shows only PI-DEMO-7. No invoice appears under both.
- **False pass:** the tab is non-empty and shows *a* total — without checking that the invoice numbers listed actually belong to that supplier and none of the other supplier's invoices leaked in.

### MTP-PUR-05 — No credit limit on the supplier record
- **Persona / permission:** مسؤول مشتريات، `purchases.supplier.create`/`.edit`
- **Preconditions:** the supplier create/edit panel
- **Steps:**
  1. Open **«إضافة مورد»** or edit an existing supplier.
  2. Look for a field that caps how much may be owed to/spent with this supplier (a supplier-side "credit limit", mirroring the customer's `creditLimit`).
- **Expected:** no such field exists — only **«شروط الدفع (أيام)»**, currency, category, opening balance, tax number, contact, address. There is no cap on outstanding purchase exposure per supplier, and no price-agreement/contract entity at all (no negotiated price per supplier distinct from the item's own `costPrice`).
- **False pass:** none — this is a documented absence. The false pass would be assuming "شروط الدفع" is a spend cap because it sounds like a control; it is a due-date input only, not a limit that blocks a new PO or invoice.

### MTP-PUR-06 — "Last purchase price" is really the item's own `costPrice`, not a per-supplier history
- **Persona / permission:** مسؤول مشتريات، `purchases.order.create`
- **Preconditions:** an item bought from both SUPP-DEMO-1 (e.g. أرز أبيض at 140–142) and SUPP-DEMO-2 in the seed
- **Steps:**
  1. `#/purchases/purchase-orders/new`, pick SUPP-DEMO-2, add line item «أرز أبيض 5 كجم».
  2. Note the unit price the picker auto-fills.
  3. Compare it against the actual last price PAID to SUPP-DEMO-2 specifically for this item (from PI-DEMO-6/7 or the supplier statement) vs. the last price paid to SUPP-DEMO-1.
- **Expected:** the auto-filled price is `item.costPrice` — one number per item, tenant-wide — not "what SUPP-DEMO-2 last charged for this item". There is no per-supplier price history to consult while choosing a supplier for a new order.
- **False pass:** a number does appear in the unit-price field (so it "looks like" last-price visibility), and it is mistaken for the supplier-specific figure a buyer needs to negotiate — it is the same number regardless of which supplier is picked.

---

## B. RFQ and supplier price comparison

### MTP-PUR-07 — Create a new RFQ with multiple lines
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.create`
- **Preconditions:** seeded items
- **Steps:**
  1. `#/purchases/rfqs` → **«طلب عرض سعر جديد»**.
  2. **«التاريخ»** = today, **«مطلوب بحلول»** = +14 days.
  3. Add two lines: زيت عباد الشمس qty 150; شاي أسود qty 40.
  4. **«حفظ»**.
- **Expected:** new RFQ appears with status **«مسودة»**, **«البنود»** = 2. `GET /rfqs/:id` lines match exactly what was entered; no GL/stock effect (RFQ has none by design).
- **False pass:** the row appears in the list — without opening it to confirm both lines actually saved with the right quantities (a lost second line is invisible from the list column, which only shows a count).

### MTP-PUR-08 — Send the RFQ to open it for quotes
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.create` (send action reuses create's gate)
- **Preconditions:** the draft RFQ from MTP-PUR-07
- **Steps:**
  1. Open it, click **«إرسال»**.
- **Expected:** status → **«مرسل»**; the quote-entry form and the «مقارنة العروض» tab become available. No document effect beyond the status flag (per the effects list: **«لا يؤثر طلب عرض السعر على المخزون أو الحسابات»**).
- **False pass:** treating the status flip alone as proof of nothing else changing — actually check the effects panel explicitly states no GL/stock impact, since an RFQ is the one purchasing document type that legitimately should have none.

### MTP-PUR-09 — Record two suppliers' quotes on the same RFQ
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.create`
- **Preconditions:** the sent RFQ from MTP-PUR-08
- **Steps:**
  1. Tab **«العروض»** → pick SUPP-DEMO-1, price زيت = 76, شاي = 205, **«حفظ العرض»**.
  2. Repeat for SUPP-DEMO-2: زيت = 74, شاي = 210.
- **Expected:** both quotes listed under **«العروض (2)»**, each supplier's per-line prices exactly as entered. A supplier already quoted disappears from the "record a new quote" picker (`availableQuoteSuppliers`).
- **False pass:** two quote cards appear, but their line prices are read from the wrong quote (visually similar cards) — cross-check the numbers against what was typed, not just the count.

### MTP-PUR-10 — Compare quotes; cheapest is highlighted per line and per basket
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.view`
- **Preconditions:** MTP-PUR-09's two quotes
- **Steps:**
  1. Tab **«مقارنة العروض»**.
  2. Read the per-line cheapest highlight and the **«الإجمالي (سلة كاملة)»** row.
- **Expected:** زيت's cheapest cell is SUPP-DEMO-2 (74 < 76); شاي's cheapest is SUPP-DEMO-1 (205 < 210). Basket totals: SUPP-DEMO-1 = 150×76 + 40×205 = 19,400; SUPP-DEMO-2 = 150×74 + 40×210 = 19,500 — SUPP-DEMO-1 is actually cheaper OVERALL despite losing on the زيت line, which is exactly the case the basket total exists to catch. Confirm the highlighted "cheapest" per-line does NOT get mistaken for cheapest overall.
- **False pass:** reading the per-line highlights and concluding "SUPP-DEMO-2 is cheaper" because it won more line-highlights, without checking the basket-total row that actually decides the award.

### MTP-PUR-11 — Convert the winning quote to a purchase order
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.convert`
- **Preconditions:** MTP-PUR-10's comparison
- **Steps:**
  1. In the comparison tab's footer row, click **«تحويل إلى أمر شراء»** under the cheaper-basket supplier's column.
- **Expected:** RFQ status → **«مغلق»**; **«أمر الشراء المرتبط»** shows the new PO's id/number. The created PO is a **draft** (per the seed's own pattern: convert then a separate `/confirm` call) — open `#/purchases/purchase-orders` and confirm a new draft PO exists for that supplier with the same two lines and prices as the winning quote.
- **False pass:** the RFQ shows "مغلق" and a linked order id (looks complete) — without opening the PO itself to verify it is `draft`, not already `sent`, and that its two line prices came from the QUOTE, not from the item's own `costPrice`.

### MTP-PUR-12 — Close an RFQ without converting
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.create`
- **Preconditions:** RFQ-DEMO-2 (sent, one quote from SUPP-DEMO-1, never converted)
- **Steps:**
  1. Open RFQ-DEMO-2, click **«إغلاق بدون تحويل»**.
- **Expected:** status → **«مغلق»**, **«أمر الشراء المرتبط»** stays "—". No PO is created; the recorded quote (RFQQ-DEMO-3) remains readable for future reference/negotiation but nothing else changes.
- **False pass:** none obvious — but verify a purchase order was NOT silently created (the convert and close actions share a status target, "مغلق", so a wiring mistake could make close behave like convert).

### MTP-PUR-13 — Cancel a draft RFQ
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.create`
- **Preconditions:** RFQ-DEMO-3 (draft, never sent)
- **Steps:**
  1. Row menu → **«إلغاء الطلب»**.
- **Expected:** status → **«ملغي»**; it drops out of the **«مسودة»**/**«مرسل»** chips and out of any "send" action offered elsewhere.
- **False pass:** the status pill changes, but the RFQ still appears selectable as a target to record a quote against from some other entry point (e.g. deep-linked URL) — confirm the quote form is genuinely unreachable once cancelled.

### MTP-PUR-14 — Incomplete comparison basket is marked, not silently priced at zero
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.view`
- **Preconditions:** an RFQ sent with 2 lines, only one supplier has quoted BOTH lines, a second supplier has quoted only one line
- **Steps:**
  1. Record a quote from a second supplier covering only one of the two lines.
  2. Open **«مقارنة العروض»**.
- **Expected:** the missing line/supplier cell shows "—", and that supplier's basket-total cell reads **«غير مكتمل»** rather than a number — an incomplete quote must never be treated as cheaper by omission.
- **False pass:** the incomplete supplier's basket cell is blank/zero and gets read as "0 EGP, cheapest", awarding the PO to a supplier that never priced every item.

### MTP-PUR-15 — No RFQ line quantity flows automatically into the PO
- **Persona / permission:** مسؤول مشتريات، `purchases.rfq.convert`, `purchases.order.create`
- **Preconditions:** a converted RFQ (MTP-PUR-11)
- **Steps:**
  1. Open the PO created by the convert action.
  2. Compare its line quantities against the original RFQ's requested quantities.
- **Expected:** quantities match the RFQ exactly (the convert route is meant to carry them over); confirm this holds, since a mismatch here (e.g. PO created with quote's own implied qty rather than the RFQ's requested qty) would silently change what was ordered from what was compared.
- **False pass:** assuming quantities "must" match without actually reading both documents side by side.

---

## C. Purchase order

### MTP-PUR-16 — Create a multi-line purchase order manually
- **Persona / permission:** مسؤول مشتريات، `purchases.order.create`
- **Preconditions:** seeded items, SUPP-DEMO-1
- **Steps:**
  1. `#/purchases/purchase-orders/new` → pick SUPP-DEMO-1.
  2. Line 1: سكر أبيض, qty 500, unit price 32. Line 2: أرز أبيض, qty 80, unit price 145.
  3. **«حفظ مسودة»**.
- **Expected:** new PO, status **«مسودة»**, **«إجمالي»** = 500×32 + 80×145 = 27,600.00. `purchaseOrderSubtotal` on the API equals the same figure to the cent.
- **False pass:** the draft saves and the list total looks right, but the per-line **«إجمالي البند»** in the detail tab (qty × unit price) is never cross-footed against the header total — a rounding or line-order bug would only show there.

### MTP-PUR-17 — Confirm and send the order
- **Persona / permission:** مسؤول مشتريات، `purchases.order.confirm`
- **Preconditions:** MTP-PUR-16's draft PO
- **Steps:**
  1. Open it, click **«تأكيد وإرسال»**.
- **Expected:** status → **«مرسل»**. The effects panel reads **«لا يؤثر أمر الشراء على المخزون أو الحسابات — يسجّل التزاماً بالشراء لدى المورد فقط»** — confirm no GL entry was posted (check the journal list for the period; there must be none referencing this PO) and inventory on-hand for both lines is unchanged.
- **False pass:** the status pill flips to "مرسل" (which is the ONLY visible change) and that alone is accepted as correct — the real check is the *absence* of a posting, which nothing on the PO screen proves; go to the journal.

### MTP-PUR-18 — A confirmed PO with an approval chain configured is not actually held
- **Persona / permission:** مسؤول مشتريات، `purchases.order.confirm`; plus an admin with `settings.workflow.edit`
- **Preconditions:** none beyond a draft PO
- **Steps:**
  1. As admin, open **«إعدادات الموافقات»** (`/settings/workflow`), add a chain for action type **«تأكيد أمر الشراء»** (`PURCHASE_ORDER_CONFIRM`) with one approval step and a minimum amount.
  2. Note the row's status pill next to this action type in the config list.
  3. As the purchasing officer, create a PO for an amount above the configured minimum and click **«تأكيد وإرسال»**.
- **Expected:** the config screen shows the pill **«غير مُفعَّل بعد»** (not-enforced) next to `PURCHASE_ORDER_CONFIRM` — the product discloses this. The PO confirms IMMEDIATELY, status → «مرسل», with **no** entry appearing in **صندوق الموافقات** (approvals inbox) for anyone to act on: `packages/api/src/purchases-routes.ts`'s `/orders/:id/confirm` calls `confirmPurchaseOrder` directly with no workflow gate — `GATEABLE_ACTION_TYPES` marks `PURCHASE_ORDER_CONFIRM`, `PURCHASE_INVOICE_CONFIRM` and `PURCHASE_RECEIPT_CONFIRM` as `enforced: false`.
- **False pass:** an admin configures the approval chain, sees it saved in the list, and believes purchase orders above the threshold are now held for approval — the chain exists and is completely inert for these three purchasing actions. Missing the small warning pill (easy to do — it does not block saving the chain) is the exact failure mode this scenario exists to catch.

### MTP-PUR-19 — Cancel a sent (not yet received) order
- **Persona / permission:** مسؤول مشتريات، `purchases.order.cancel`
- **Preconditions:** PO-DEMO-1 or a fresh sent order with no receipts against it
- **Steps:**
  1. Row menu → cancel (only reachable while status is not `fully_received`/`cancelled`).
- **Expected:** status → **«ملغي»**; the order drops out of `goodsReceiptsScreen`'s "receivable" picker (only `sent`/`partially_received` orders are offered there) — confirm by opening a new goods receipt and checking the cancelled PO is absent from the order picker.
- **False pass:** the PO list shows "ملغي" but the goods-receipt "from order" picker still lists it (would let a cancelled PO be received against — see MTP-PUR-24 for the negative check on this exact hole).

### MTP-PUR-20 — A fully-received order cannot be cancelled
- **Persona / permission:** مسؤول مشتريات، `purchases.order.cancel`
- **Preconditions:** PO-DEMO-2 (fully received via GRN-DEMO-1)
- **Steps:**
  1. Attempt to cancel PO-DEMO-2.
- **Expected:** refused (`order.status === "fully_received"` blocks cancel in `cancelPurchaseOrder`). PO status stays **«مستلم بالكامل»**.
- **False pass:** the row menu happens not to offer a cancel action for this row (client-side hiding) and the tester assumes "the server would also refuse it" without ever issuing the call — confirm the refusal is server-enforced, e.g. by hitting `POST /purchases/orders/PO-DEMO-2/cancel` directly.

### MTP-PUR-21 — Open-PO list, filters and KPI strip agree
- **Persona / permission:** مسؤول مشتريات، `purchases.order.view`
- **Preconditions:** the four seeded POs plus MTP-PUR-16/17's new one
- **Steps:**
  1. `#/purchases/purchase-orders`, filter **«الحالة»** = **«مرسل»**.
  2. Read the row count, the status-chip count next to «مرسل», and the KPI **«إجمالي القيمة»**.
  3. Add a **«المورد»** filter for SUPP-DEMO-1 on top.
- **Expected:** all three numbers (rows shown, chip count, KPI value) move together as filters are applied — the KPI is not a stale sum over the unfiltered set. Sum the visible rows' totals by hand and confirm it equals **«إجمالي القيمة»**.
- **False pass:** the row count and chip count agree (both client-narrowed) while the KPI strip silently keeps its unfiltered figure — the two counters can coincidentally still look "roughly right" without matching to the cent.

### MTP-PUR-22 — Receivable-only "receive" action appears exactly on the right rows
- **Persona / permission:** مسؤول مشتريات، `purchases.order.view`
- **Preconditions:** mix of draft, sent, partially/fully received, cancelled POs
- **Steps:**
  1. Open each PO's row menu.
- **Expected:** **«إذن استلام من هذا الأمر»** appears only on `sent` and `partially_received` rows; `draft`, `fully_received`, `cancelled` rows never offer it.
- **False pass:** spot-checking one or two rows and generalising — check every status, since the eligibility rule (`receivable = status === "sent" || status === "partially_received"`) has five branches and this is the one row-action gate protecting against receiving on a draft/cancelled order from the list screen.

### MTP-PUR-23 — A PO's «المتبقي» column tracks partial receipt correctly
- **Persona / permission:** مسؤول مشتريات، `purchases.order.view`
- **Preconditions:** PO-DEMO-3 (partially received: زيت 120 of 200 received, شاي 0 of 60)
- **Steps:**
  1. Open PO-DEMO-3, tab **«البنود»**.
- **Expected:** زيت row shows **مستلم** = 120, **المتبقي** = 80; شاي row shows **مستلم** = 0, **المتبقي** = 60. Header status = **«مستلم جزئياً»**.
- **False pass:** the header status pill alone ("partially_received") is trusted as proof the line-level figures are right — check both lines individually, since the bug class here (defect register: "the same goods could be returned repeatedly") shows quantity bookkeeping bugs hide behind a correct-looking status.

---

## D. Receiving against a purchase order

### MTP-PUR-24 — Receive the full outstanding quantity from a sent PO
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.create`, `.confirm`
- **Preconditions:** MTP-PUR-17's sent PO (سكر 500 @ 32, أرز 80 @ 145)
- **Steps:**
  1. `#/purchases/goods-receipts/new` → **«من أمر شراء»** → **«متابعة»**.
  2. Pick the PO; the auto-filled preview shows both lines at full outstanding qty.
  3. **«حفظ مسودة»**, then open it and click **«تأكيد الاستلام»**.
- **Expected:** receipt status → **«مؤكد»**; **«إجمالي التكلفة»** = 27,600.00. Stock on-hand for both items rises by exactly the received qty in the target warehouse. GL: Dr 1200 (المخزون) 27,600.00 / Cr 2120 (بضاعة واردة لم تُفوتر) 27,600.00 — no AP (2100) and no tax (1400) movement yet (per **«لم تُسجّل الضريبة أو المستحق للمورد بعد»**). The PO's status advances to **«مستلم بالكامل»**.
- **False pass:** stock on-hand increasing is treated as sufficient proof — confirm the GL posted to 2120, not 2100, since crediting AP directly at receiving time (skipping GRNI) would double-book the payable once the invoice later confirms.

### MTP-PUR-25 — Partial receipt cannot be entered through the "from order" screen (dealbreaker)
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.create`
- **Preconditions:** a sent PO with outstanding qty on a line, e.g. PO-DEMO-1 confirmed then sent with شاي qty 40, سكر qty 200
- **Steps:**
  1. `#/purchases/goods-receipts/new` → **«من أمر شراء»** → pick the PO.
  2. In the auto-filled preview table (**«البنود (معبأة تلقائياً من أمر الشراء)»**), try to change the شاي line's quantity to 25 (a real partial delivery — the truck only had 25 of the 40 ordered).
- **Expected:** there is no input control anywhere in this preview — every cell is static text. **«حفظ مسودة»** submits the create call with no `lines` at all (`{ id, purchaseOrderId, date }`), so the server (`buildReceiptLinesFromOrder`) always fills the FULL outstanding quantity for every line. A purchasing officer physically receiving less than what was ordered has no way to record that through this screen.
- **False pass:** believing the hint text "اختر أمر شراء مرسلاً أو مستلماً جزئياً لاستلام الكميات المتبقية" (receive what is still outstanding) describes an editable quantity — it describes the PO-selection filter, not a control on this form. The domain (`createGoodsReceipt`) and even the demo seed itself (`GRN-DEMO-2` posts an explicit partial `lines` array via a direct API call) fully support partial receipt — only the browser screen does not expose it. **This is the dealbreaker**: to receive a real partial delivery, the officer must fall back to a spreadsheet (or wait and receive everything at once, misstating stock and cost until the rest turns up) — the only in-app workaround is the ad-hoc (PO-less) path, which does not update the PO's outstanding quantities at all (see MTP-PUR-29).

### MTP-PUR-26 — Receiving against a fully-received (closed) PO is refused
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.create`
- **Preconditions:** PO-DEMO-2, already fully received via GRN-DEMO-1
- **Steps:**
  1. Attempt `POST /purchases/receipts` with `purchaseOrderId: "PO-DEMO-2"` (the order picker in the UI already excludes it — confirm the SERVER also refuses it, not just the client).
- **Expected:** 409 `PURCHASE_ORDER_NOT_RECEIVABLE`.
- **False pass:** confirming the UI simply omits PO-DEMO-2 from the picker and stopping there — that only proves client-side filtering. Hit the route directly (or via a stale deep link / double-submit race) to prove the server itself rejects it; `PurchaseOrderNotReceivableError`'s message is **plain English** ("...cannot be received..."), so if a screen ever surfaces it raw it will read as an untranslated string in an Arabic-first UI — note whether it does.

### MTP-PUR-27 — Over-receipt has no tolerance control at all (dealbreaker-adjacent)
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.create`; admin with `settings.edit` for the policy check
- **Preconditions:** a sent PO with سكر outstanding qty 200
- **Steps:**
  1. Search Settings (`SettingsGeneral.tsx`, «ضوابط الشراء» section) for any toggle limiting or blocking over-receipt (receiving more than a PO's outstanding quantity).
  2. Use an ad-hoc/API call to create a receipt against the PO's supplier/warehouse for 250 units of سكر against the 200 outstanding (simulating what an over-generous manual entry would do, since the "from order" screen cannot itself be pushed past outstanding qty — MTP-PUR-25).
- **Expected:** Settings exposes exactly three purchasing toggles — **«أمر شراء مطلوب قبل إذن الاستلام»**, **«إذن استلام مطلوب قبل الفاتورة»**, **«تتبع البضاعة المستهلكة من المشتريات»** — and NONE of them is an over-receipt tolerance. The domain's `blockOverReceipt` policy flag exists (`PurchasePolicy.blockOverReceipt`) but is never surfaced in Settings, and the backend never supplies a `policy` object to the purchasing routes at all (`purchases-routes.ts`'s `resolvePolicy()` falls back to `DEFAULT_PURCHASE_POLICY`, which has `blockOverReceipt: false`) — over-receipt is unconditionally always allowed, with no cap, no tenant configuration path, and no warning to the receiving clerk.
- **False pass:** searching Settings, not finding a toggle, and concluding "maybe it's a hidden default that's safely restrictive" — the opposite is true: it is a hidden default that is permissive with zero override, in a market where over-receipt (accepting more than was ordered, at whatever price the supplier's delivery note says) is a common way a buyer gets overcharged.

### MTP-PUR-28 — The three purchasing policy toggles in Settings have no server effect (severe, cross-cutting)
- **Persona / permission:** admin, `settings.edit`; مسؤول مشتريات for the follow-up
- **Preconditions:** Settings → «ضوابط الشراء»
- **Steps:**
  1. Turn ON **«أمر شراء مطلوب قبل إذن الاستلام»** (`requirePoForGrn`) and save.
  2. As the purchasing officer, call `POST /purchases/receipts` directly (not through the "استلام مباشر" UI button, which the client now correctly greys out) with no `purchaseOrderId`, an explicit `supplierId`, `warehouseId` and `lines`.
  3. Turn ON **«إذن استلام مطلوب قبل الفاتورة»** (`requireGrnForInvoice`) and save.
  4. Create a manual purchase invoice (`#/purchases/purchase-invoices/new` → **«إنشاء فاتورة جديدة»**) with no receipt reference.
- **Expected:** BOTH calls succeed anyway. Step 2 returns 201 (a real PO-less receipt is created) despite the tenant setting being ON, because `create-backend.ts` never passes a `policy` object into `createPurchasesRoutes`'s deps — the server always runs `DEFAULT_PURCHASE_POLICY` (`requirePoForGrn: false`, `requireReceiptForInvoice: false`). Step 4's manual-invoice creation form in `PurchaseInvoicesScreen.tsx` never even reads `requireGrnForInvoice` — the **«إنشاء فاتورة جديدة»** method tile is always offered regardless of the setting, and the server would accept it anyway.
- **False pass:** turning the toggles on in Settings, seeing the ad-hoc receipt BUTTON go grey in the goods-receipts screen, and concluding the control is enforced — that greyed button is the ONLY place either setting has any effect at all in this build; every other entry point (the manual invoice form, and any direct API caller) ignores both settings completely. This is the single highest-value finding in this plan: a purchasing officer or their admin who turns these controls on believes spend discipline is now enforced when it is not.

### MTP-PUR-29 — Ad-hoc (PO-less) receipt does not update any PO's outstanding quantity
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.create`
- **Preconditions:** «أمر شراء مطلوب قبل إذن الاستلام» OFF (default); PO-DEMO-1 (draft, never sent) with شاي qty 40 outstanding
- **Steps:**
  1. `#/purchases/goods-receipts/new` → **«استلام مباشر»** → **«متابعة»**.
  2. Pick SUPP-DEMO-2, a warehouse, add شاي qty 40 at cost 210.
  3. Save and confirm.
- **Expected:** stock rises by 40 units of شاي and a GL entry posts (Dr 1200 / Cr 2120), but PO-DEMO-1 is completely untouched — its status stays **«مسودة»**, its شاي line's **مستلم**/**المتبقي** are unchanged. There is no way, even after the fact, to link this ad-hoc receipt back to PO-DEMO-1 to close the gap it happens to fill.
- **False pass:** assuming the ad-hoc receipt "closes" the matching outstanding PO line because the item and quantity happen to coincide — the two documents are entirely unrelated; open PO-DEMO-1 afterward and confirm it still shows the full 40 outstanding.

### MTP-PUR-30 — Cancel a draft receipt (trivial, no stock/PO effect yet)
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.void`
- **Preconditions:** a draft receipt not yet confirmed
- **Steps:**
  1. Cancel it before confirming.
- **Expected:** status → **«ملغي»**; no stock movement occurred (it never had — confirmation is what posts stock), no PO quantities changed.
- **False pass:** none of substance — the check is simply that nothing WAS posted, since a draft receipt genuinely has no effect to reverse.

### MTP-PUR-31 — Cancel a confirmed, uninvoiced receipt whose stock is untouched
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.void`
- **Preconditions:** GRN-DEMO-3 (seeded as draft — first confirm it, or use a fresh confirmed receipt with none of its stock sold)
- **Steps:**
  1. Confirm a fresh receipt, do not invoice or sell any of it.
  2. Cancel it.
- **Expected:** the stock IN is reversed (on-hand drops back by the received qty), the GL entry is reversed (Dr 2120 / Cr 1200 for the same amount), and if it was linked to a PO, the PO's received quantity rolls back (`revertReceiptFromOrder`) — its status may return from `partially_received`/`fully_received` to `sent`.
- **False pass:** the receipt's own status flips to "ملغي" and that is accepted as complete — check the LINKED PO's line-level **مستلم**/**المتبقي** actually rolled back too; a one-sided reversal (receipt cancelled, PO left thinking the goods are still received) would silently misstate what is still outstanding to receive.

### MTP-PUR-32 — Cancelling a receipt whose stock has already been consumed is blocked
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.void`
- **Preconditions:** a confirmed receipt whose item has since been sold via a sales invoice (تتبع البضاعة المستهلكة من المشتريات default is ON but, per MTP-PUR-28, not tenant-configurable server-side)
- **Steps:**
  1. Receive and confirm goods, sell some of that exact stock via a sales invoice, confirm the sale.
  2. Attempt to cancel the original goods receipt.
- **Expected:** refused — `PurchaseItemsAlreadyConsumedError`. The receipt's status is unchanged.
- **False pass:** the cancel button is simply absent/disabled in the UI for this row and the tester assumes the server-side guard exists without ever issuing the call — hit `POST /purchases/receipts/:id/cancel` directly to prove the domain, not just the UI, refuses it. Also check the error text reaching the screen: `PurchaseItemsAlreadyConsumedError`'s message is plain English ("...cannot be cancelled: some of its goods have already been sold...") and is passed through `err.message` verbatim by `GoodsReceiptsScreen.tsx` — confirm whether the officer sees raw English inside the Arabic form.

### MTP-PUR-33 — Cancelling a receipt already invoiced is blocked
- **Persona / permission:** مسؤول مشتريات، `purchases.receipt.void`
- **Preconditions:** GRN-DEMO-1 (confirmed, `invoiced: true` via PI-DEMO-6)
- **Steps:**
  1. Attempt to cancel GRN-DEMO-1.
- **Expected:** refused — `GoodsReceiptAlreadyInvoicedError`, English message again ("...has already been invoiced and cannot be cancelled."). Status stays **«مؤكد»**, **«حالة الفوترة»** stays **«مفوتر»**.
- **False pass:** same as MTP-PUR-32 — do not accept "the button isn't there" as proof; call the route directly.

---

## E. Purchase invoice, tax rate resolution and payment

### MTP-PUR-34 — Manual invoice with no receipt still moves stock directly (three-way match bypass)
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.create`, `.confirm`
- **Preconditions:** any purchasable item, any supplier
- **Steps:**
  1. `#/purchases/purchase-invoices/new` → **«إنشاء فاتورة جديدة»** (manual, not "من إيصال استلام").
  2. Add a مخزني line for an item, qty 50, cost 60, tax 14%.
  3. Save draft, confirm.
- **Expected:** stock on-hand rises by 50 with NO goods receipt document ever created — the effects note reads **«تُضاف الأصناف المخزنية إلى المخزون في المستودع (فاتورة يدوية بدون إيصال)»**. The invoice itself is both the receiving and the billing document. `createPurchaseInvoiceSchema` has no `purchaseOrderId` field at all — there is no way, even in principle, to tie this manual invoice back to a specific PO for a three-way match. GL: Dr 1200 (3,000.00) + Dr 1400 (420.00) / Cr 2100 (3,420.00).
- **False pass:** confirming the invoice posted correctly (money is fine) and stopping there — the finding is procedural, not arithmetic: this path lets a buyer record and pay for goods with zero physical-receipt evidence and no PO reference, defeating the three-way match entirely for anyone who uses "manual" instead of "من إيصال استلام" out of habit or haste.

### MTP-PUR-35 — Invoice from a receipt resolves the correct tax rate, not 0%
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.create`
- **Preconditions:** a confirmed, uninvoiced goods receipt (e.g. re-confirm GRN-DEMO-3 first) for an item whose `taxRatePercent` = 14
- **Steps:**
  1. `#/purchases/purchase-invoices/new` → **«من إيصال استلام»** → pick the receipt.
  2. Note the preview lines (item/qty/cost only — no tax column is shown in this preview).
  3. Save, then open the confirmed invoice's **«البنود»** tab and read the **«ضريبة %»** column per line.
- **Expected:** every line reads **14**, not 0 — `POST /purchases/invoices` with a bare `receiptId` (no `lines`) makes the server call `resolveTaxRate(itemId)` per line, which `create-backend.ts` wires to `items.findById(itemId).taxRatePercent`. GL on confirm: Dr 1400 (input VAT) = 14% of the line subtotal, and Cr 2120 clears exactly the GRNI amount the receipt posted, with any cost difference between receipt and invoice unit cost hitting 1200.
- **False pass:** the invoice confirms without error and totals look plausible — an invoice silently taxed at 0% still produces a "correct-looking" total (subtotal = total, no separate tax line) and passes a glance; explicitly read the per-line tax % column, and separately verify **«ضريبة المدخلات»** (1400) actually moved on the trial balance for this posting, not just that `tax` in the invoice DTO is non-zero.

### MTP-PUR-36 — Confirm a from-receipt invoice: AP and GRNI move together, not double
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.confirm`
- **Preconditions:** a fresh confirmed, uninvoiced receipt (GRN-DEMO-1 is already invoiced by the seed)
- **Steps:**
  1. Create and confirm a fresh receipt: سكر qty 100 @ 32.
  2. Create an invoice from that receipt, confirm it.
- **Expected:** GL on invoice confirm — Dr 2120 (GRNI) 3,200.00 / Dr 1400 448.00 / Cr 2100 3,648.00. Inventory (1200) does NOT move again (it already moved when the receipt confirmed) — the effects note **«تمّت إضافة الأصناف للمخزون سابقاً عند إيصال الاستلام — لا تُضاف مرة أخرى (تجنّب الازدواج)»**. Two numbers that must agree: the receipt's **«إجمالي التكلفة»** (3,200.00) must equal the invoice's subtotal before tax (3,200.00) exactly — any difference between receipt unit cost and invoice unit cost should route to 1200/expense, not silently vanish.
- **False pass:** confirming AP increased and calling it done — check that 1200 (inventory) did NOT get a second debit for this same document chain; the invoice's own GL 1200 vs the sub-ledger inventory value (see the defect register's D53 note: "GL posts before the stock moves... there is no transaction around it") is exactly the kind of doubled-entry bug the two-account check catches and a single glance at AP does not.

### MTP-PUR-37 — Invoicing more than was received is not checked against the receipt
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.create`
- **Preconditions:** a confirmed, uninvoiced receipt for qty 100 of an item
- **Steps:**
  1. `#/purchases/purchase-invoices/new` → **«إنشاء فاتورة جديدة»** (manual, NOT from-receipt) — pick the same supplier and item, but enter qty 150 (more than the 100 actually received) with no reference to the receipt at all.
  2. Save and confirm.
- **Expected:** the invoice confirms successfully at qty 150 — `validate()` in `purchase-invoice.ts` checks line shape (positive qty/cost) only, never cross-references any receipt, because a manual line carries no receipt/PO reference to check against in the first place (MTP-PUR-34's finding, restated as an abuse path). Stock rises by 150, AP rises for 150 units' worth, though only 100 were ever physically received.
- **False pass:** believing that because "من إيصال استلام" invoices auto-fill exact received quantities (which are correctly capped), the manual path is equally protected — it is not; the manual path is an entirely separate, unguarded route to the same GL accounts.

### MTP-PUR-38 — Foreign-currency purchase invoice
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.create`
- **Preconditions:** SUPP-DEMO-USD; a same-day exchange rate configured (`/settings/exchange-rates`), or none at all
- **Steps:**
  1. Create a manual invoice for SUPP-DEMO-USD, one line, qty 10 @ 200 USD, tax 14%.
  2. Set **«العملة»** = USD.
  3. Confirm.
- **Expected:** if a rate for the invoice date exists, GL posts in EGP at that day's rate (Dr 1200/1400 / Cr 2100, all in EGP, the exact rate used visible on the journal entry). If NO rate exists for that date, confirm should either refuse with a clear reason or fall back in a way that is documented — check which actually happens.
- **False pass:** the invoice confirms and the AP figure "looks like" a plausible EGP number — without checking which rate was actually applied (today's, the invoice date's, or accidentally 1:1 EGP=USD, which was exactly historical defect D24's shape: "every purchase invoice was booked in the base currency whatever the supplier billed").

### MTP-PUR-39 — Fulfilment tab shows received/consumed/remaining correctly
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.view`
- **Preconditions:** PI-DEMO-7 (from GRN-DEMO-2, زيت qty 120), with PRT-DEMO-1 (a confirmed return of 20 units against it)
- **Steps:**
  1. Open PI-DEMO-7, tab **«البنود»**, read **«الكمية المستلمة»**, **«المستهلكة»**, **«المتبقي»** for the زيت line.
- **Expected:** **المستلمة** = 120 (from the receipt). **المتبقي** should reflect what remains in the specific cost layer this receipt created, net of the 20-unit return; **المستهلكة** = المستلمة − المتبقي.
- **False pass:** reading only the invoiced qty (120, which matches the header line qty) and assuming it also represents "what's left" — the whole point of this tab is that received/consumed/remaining are three DIFFERENT numbers once a return has touched the same stock; verify they actually differ here rather than all echoing 120.

### MTP-PUR-40 — Pay a supplier directly from the invoice
- **Persona / permission:** مسؤول مشتريات (or من يملك `purchases.invoice.edit`), plus a treasury account
- **Preconditions:** a confirmed invoice with a positive **«المتبقي»**, e.g. a fresh 3,648.00 invoice from MTP-PUR-36
- **Steps:**
  1. Tab **«المدفوعات»** → **«سداد دفعة للمورد»**.
  2. **«قيمة السداد»** = 1,000, pick a treasury account, method نقدي, **«تسجيل السداد»**.
- **Expected:** a real سند صرف is created, confirmed and allocated — `purchaseInvoices.pay.done` shows a voucher number. **«المدفوع»** → 1,000.00, **«المتبقي»** → 2,648.00. Two numbers that must agree: the invoice's own `amountPaid` and the sum of this supplier's allocations in the voucher sub-ledger for this invoice id; and the treasury account's balance must have dropped by exactly 1,000.00, with a balanced GL entry (Dr 2100 1,000 / Cr treasury 1,000).
- **False pass:** the invoice's **«المتبقي»** figure drops and is treated as sufficient — this is exactly the shape of historical defect D40 ("an invoice reads مدفوع with nothing posted behind it"); separately confirm the treasury account's own balance moved and a journal entry exists, not just the invoice's own cached figure.

### MTP-PUR-41 — Overpaying an invoice is refused
- **Persona / permission:** same as MTP-PUR-40
- **Preconditions:** MTP-PUR-40's invoice, **«المتبقي»** = 2,648.00
- **Steps:**
  1. Attempt a payment of 3,000.00 (more than remaining).
- **Expected:** refused — `PAYMENT_EXCEEDS_BALANCE`, 422, Arabic message **«قيمة السداد أكبر من المتبقي على الفاتورة»**. Nothing posts; treasury balance unchanged.
- **False pass:** the form shows an error and that is accepted at face value — additionally confirm no partial side-effect occurred (no voucher was created in a stuck/draft state consuming a document number it shouldn't).

### MTP-PUR-42 — Purchase invoice KPI strip agrees with the filtered rows
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.view`
- **Preconditions:** several confirmed invoices, some overdue, some paid
- **Steps:**
  1. `#/purchases/purchase-invoices`, apply a supplier filter.
  2. Read **«إجمالي المشتريات»**, **«المدفوع للموردين»**, **«رصيد الفواتير غير المدفوعة»**.
  3. Sum the visible rows' totals and their `amountPaid`/`remainingBalance` by hand.
- **Expected:** all three KPI figures match the hand sum for exactly the filtered supplier, to the cent. **إجمالي المشتريات − المدفوع للموردين = رصيد غير المدفوعة** must hold as an identity across the filtered set.
- **False pass:** the three figures look internally consistent with EACH OTHER (their own arithmetic checks out) without ever being compared against the actual filtered row set — a KPI strip that's self-consistent but stuck on the unfiltered totals would pass this weaker check.

### MTP-PUR-43 — Draft (unconfirmed) receipts stay off the invoice picker and the uninvoiced KPI
- **Persona / permission:** مسؤول مشتريات، `purchases.invoice.create`, `purchases.receipt.view`
- **Preconditions:** GRN-DEMO-3 (seeded as draft, never confirmed)
- **Steps:**
  1. `#/purchases/goods-receipts`, note **«غير مفوترة»** KPI value — GRN-DEMO-3 (draft) should NOT be counted, since only a `confirmed` receipt can be invoiced.
  2. `#/purchases/purchase-invoices/new` → **«من إيصال استلام»** → check the receipt picker does not offer GRN-DEMO-3.
- **Expected:** GRN-DEMO-3 absent from both; only `confirmed && !invoiced` receipts count toward **«غير مفوترة»** and appear in the picker.
- **False pass:** the KPI number "looks about right" without actually tracing which specific receipts it includes — confirm by name that the draft one is excluded, not just that the total is plausible.

### MTP-PUR-44 — Raw English domain-error text leaks into the Arabic purchasing UI
- **Persona / permission:** مسؤول مشتريات، any purchasing create permission
- **Preconditions:** trigger any of: over-receipt attempt, receipt against a non-receivable PO, cancelling an already-invoiced receipt, cancelling a receipt with consumed stock, an ad-hoc receipt while `requirePoForGrn` should block it
- **Steps:**
  1. Reproduce one of the above via the UI (where reachable) or via a direct API call surfaced through the same form's error banner.
  2. Read the exact text of the red error banner.
- **Expected:** per the app's own stated rule (`apps/web/src/lib/error-message.ts`: "the server writes its domain refusals in Arabic precisely so they can be shown verbatim"), every refusal should read in Arabic. In fact `OverReceiptError`, `PurchaseOrderNotReceivableError`, `ReceiptRequiredError`, `PurchaseItemsAlreadyConsumedError` and `GoodsReceiptAlreadyInvoicedError` all construct their `.message` in plain English, and `GoodsReceiptsScreen.tsx`/`PurchaseOrdersScreen.tsx` show `err.message` directly (not through the `errorMessage()`/`ApiError` Arabic-guarantee helper) — so these five refusals render as raw English sentences inside an otherwise fully-Arabic form.
- **False pass:** noticing *an* error banner appeared (proving the refusal itself works) and not reading its actual text — the refusal is functionally correct and cosmetically broken at the same time; both facts need recording separately.

---

## F. Three-way match

### MTP-PUR-45 — PO vs receipt vs invoice: the happy path actually matches on all three documents
- **Persona / permission:** مسؤول مشتريات، full purchase chain
- **Preconditions:** a fresh PO (item X qty 100 @ 50), sent
- **Steps:**
  1. Receive the full 100 from the PO, confirm.
  2. Invoice from that receipt, confirm.
  3. Open the PO, the receipt and the invoice side by side.
- **Expected:** all three carry the SAME quantity (100) and the SAME unit price (50) — PO subtotal = receipt totalCost = invoice subtotal before tax = 5,000.00. This is the only "three-way match" enforced anywhere in the product: it is enforced by construction (auto-fill from the prior document), not by an explicit comparison screen that flags a discrepancy.
- **False pass:** confirming the three totals agree here and generalising that "the system does three-way matching" — nothing prevents a manual invoice line (MTP-PUR-34/37) or an ad-hoc receipt from breaking this agreement; there is no dedicated screen that would surface the mismatch if one occurred, only the accident that the auto-fill path can't disagree with itself.

### MTP-PUR-46 — There is no screen that flags a PO/receipt/invoice quantity or price mismatch
- **Persona / permission:** مسؤول مشتريات
- **Preconditions:** MTP-PUR-37's over-invoiced scenario (invoiced 150 against a 100-unit receipt via the manual path)
- **Steps:**
  1. Search the purchasing screens (`GoodsReceiptsScreen`, `PurchaseInvoicesScreen`, `FinancialReportsScreen`, the purchases reports) for any indicator that this invoice's quantity exceeds what was received.
- **Expected:** none exists. The fulfilment tab (MTP-PUR-39) shows received/consumed/remaining only for invoices actually LINKED to a receipt (`receiptId` set); a manual invoice with no receipt link has nothing to compare against and the tab shows dashes for it.
- **False pass:** none — this is a confirmed gap. Recording it here (rather than skipping it) is the point: a three-way match that only works when nobody deviates from the auto-fill path is not a control, it is a convention.

---

## G. Landed cost

### MTP-PUR-47 — Allocate landed cost BY_VALUE across two lines; allocation sums exactly to the total
- **Persona / permission:** مسؤول مشتريات، `purchases.landed_cost.create`, `.confirm`
- **Preconditions:** a confirmed purchase invoice with two مخزني lines (e.g. a fresh invoice: item A 100 units @ 140, item B 300 units @ 31)
- **Steps:**
  1. `#/purchases/landed-costs/new`, pick the invoice, method **«حسب القيمة»**.
  2. Cost lines: شحن 1,800, تخليص 700 (total 2,500).
  3. Targets: both invoice lines at their invoice qty/cost.
  4. **«حفظ وتأكيد التوزيع»**.
- **Expected:** the preview's per-line **«+المبلغ»** figures sum EXACTLY to 2,500.00 (largest-remainder rounding, per the ledger invariants — no leftover cent). New unit cost per item = old unit cost + (allocated ÷ qty). GL: Dr 1200 2,500.00 / Cr accrued-landed-cost-payable 2,500.00.
- **False pass:** eyeballing that the two allocated amounts "look proportional to value" — actually add them and confirm the sum is 2,500.00 to the cent, not 2,499.99 or 2,500.01 (a largest-remainder bug is invisible unless you sum the parts).

### MTP-PUR-48 — Allocate BY_QUANTITY
- **Persona / permission:** same as MTP-PUR-47
- **Preconditions:** a confirmed invoice with two lines of different quantities
- **Steps:**
  1. Method **«حسب الكمية»**, cost lines totalling e.g. 750.
- **Expected:** allocation is proportional to QTY, not value — a cheap high-quantity line should absorb more of the landed cost than an expensive low-quantity line, the opposite of BY_VALUE. Confirm the two methods genuinely produce different splits on the same cost total (re-run the same 750 total under BY_VALUE on the same two lines and compare).
- **False pass:** running only one method and trusting the label — the hint text under the method selector exists precisely because the two methods look identical in the UI apart from one dropdown value; verify the actual numbers differ.

### MTP-PUR-49 — BY_WEIGHT with no weight entered is blocked, not silently zero-allocated
- **Persona / permission:** same as MTP-PUR-47
- **Preconditions:** any confirmed invoice
- **Steps:**
  1. Method **«حسب الوزن»**, leave every target's **«الوزن»** at 0.
- **Expected:** a warning banner appears (**«التوزيع حسب الوزن يحتاج وزناً أكبر من صفر لبند واحد على الأقل»**) and the preview/submit is unusable until at least one target has a positive weight.
- **False pass:** submitting anyway and getting an error is acceptable, but check whether the SAVE button is actually disabled/blocked before submit, or only fails after a round-trip — and confirm no zero-value landed-cost document was created in a stuck draft state.

### MTP-PUR-50 — Landed cost credits a clearing account with no supplier dimension (open defect)
- **Persona / permission:** مسؤول مشتريات، `purchases.landed_cost.view`
- **Preconditions:** LC-DEMO-1 (confirmed, 2,500.00) — freight/clearing was presumably billed by a shipping/customs agent, a real supplier
- **Steps:**
  1. Confirm a landed cost document.
  2. Look for any field on the landed-cost creation form naming WHICH supplier (the freight forwarder / customs agent) the 2,500.00 is owed to.
  3. Check the AP sub-ledger (supplier statement) for every supplier — none should show this 2,500.00, since it posted to `accruedLandedCostPayableId`, a single generic clearing account, not GL 2100 with a supplier dimension.
- **Expected:** confirmed — there is no supplier field anywhere on the landed-cost form, and the 2,500.00 sits in the ledger attached to no supplier. There is consequently no way to later PAY the freight/customs agent through the normal "سداد للمورد" flow used everywhere else in purchasing, since that flow keys off a supplier id this document never records.
- **False pass:** the landed cost confirms and raises the item's unit cost correctly (which it does) — the money side is the finding: 2,500.00 of real payable exists in the general ledger and on no supplier's account, so nobody chasing "what do we owe the customs agent" will ever find it by looking up that agent as a supplier.

### MTP-PUR-51 — Confirming a landed cost is reflected on the invoice's own «التكاليف الإضافية» tab
- **Persona / permission:** مسؤول مشتريات
- **Preconditions:** LC-DEMO-1 (confirmed, targets GRN-DEMO-1, whose invoice is PI-DEMO-6)
- **Steps:**
  1. Open PI-DEMO-6, tab **«التكاليف الإضافية»**.
- **Expected:** LC-DEMO-1's lines appear with **«إجمالي المخصص»** = 2,500.00, and per line, **old cost → new cost** exactly matching what LC-DEMO-1's own detail page showed.
- **False pass:** the tab is non-empty (proves the linkage exists) without cross-checking the actual old/new unit-cost figures against the landed-cost document's own numbers — a mismatch here would mean the invoice screen is reading a stale or wrongly-matched allocation.

### MTP-PUR-52 — Cancel (void) a confirmed landed cost
- **Persona / permission:** مسؤول مشتريات، `purchases.landed_cost.void`
- **Preconditions:** a confirmed landed cost whose target stock has not since been fully consumed
- **Steps:**
  1. Open it, click **«إلغاء المستند»**.
- **Expected:** the item's unit cost is reverted to what it was before the allocation (the "sanctioned exception to a cost layer's immutable unit cost" per the module's own doc-comment applying in reverse); GL Dr accrued-payable / Cr 1200 for the same 2,500.00.
- **False pass:** the document's status flips to "ملغي" and the unit-cost reversion is assumed rather than checked — re-open the item's stock position / cost layer and confirm the unit cost is back to its pre-landed-cost figure exactly.

---

## H. Supplier returns and debit notes

### MTP-PUR-53 — Create and confirm a purchase return against a confirmed invoice
- **Persona / permission:** مسؤول مشتريات، `purchases.return.create`, `.confirm`
- **Preconditions:** PI-DEMO-7 (زيت qty 120 @ 72, 14% VAT)
- **Steps:**
  1. `#/purchases/purchase-returns/new`, pick PI-DEMO-7 as **«الفاتورة الأصلية»**.
  2. Line: زيت, qty 15, reason **«عيب في الجودة»**.
  3. **«حفظ وتأكيد»**.
- **Expected:** stock drops by 15 in the warehouse; GL: Dr 2100 (AP) for 15×72 + tax / Cr 1200 for 15×72 at the position's live weighted-average cost. Two numbers that must agree: the return's own line `unitCost` (72) and the actual weighted-average the stock ledger used for the OUT movement — they must be the same figure, or the credit to 1200 will not match what the layer actually removes (a purchase return credits GL 1200 at the line's unitCost while stock OUT leaves at the position's live weighted average — the two only agree when they are the same number).
- **False pass:** AP dropping by the expected amount is treated as sufficient — separately confirm inventory value (GL 1200) dropped by exactly the same figure the stock ledger actually used, especially if any landed cost or other purchase has since moved that item's weighted average away from 72.

### MTP-PUR-54 — The server recomputes the returnable quantity; the client's `availableQty` is only a hint
- **Persona / permission:** مسؤول مشتريات، `purchases.return.create`
- **Preconditions:** PRT-DEMO-1 already returned 20 of 120 زيت units against PI-DEMO-7 (confirmed)
- **Steps:**
  1. Create a second return against PI-DEMO-7 for زيت, entering a qty of 105 (more than the true 100 remaining returnable: 120 − 20).
  2. Also try crafting a raw request with a client-supplied `availableQty` of "120" (ignoring the already-returned 20) alongside `qty: "105"`.
- **Expected:** the server recomputes availability itself via `resolveAvailableQty` (`invoice.lines.find(...).qty.subtract(alreadyReturnedQty)`) — it does NOT trust the client's `availableQty` field. Confirming a return for 105 when only 100 remains should fail, or if the domain doesn't hard-cap qty against availableQty at create time, it must at least be caught at confirm — trace which one.
- **False pass:** sending exactly `qty` ≤ real remaining and calling the scenario passed — the actual test is whether a client claiming a HIGHER `availableQty` than reality can push qty past the true remaining stock; this is the exact defect shape ("the same goods could be returned repeatedly... validated against an availableQty supplied in the request body") already fixed once — confirm it's still fixed here by trying to break it, not by reading the code.

### MTP-PUR-55 — No formal إشعار مدين (debit note) document or ETA submission exists for a purchase return
- **Persona / permission:** مسؤول مشتريات، `purchases.return.view`
- **Preconditions:** PRT-DEMO-1 (confirmed)
- **Steps:**
  1. Open PRT-DEMO-1's detail page — look for a print/PDF/export action producing a formal إشعار مدين the supplier would recognise or countersign.
  2. Check `#/eta` (الفاتورة الإلكترونية) for any submission tied to this purchase return.
- **Expected:** neither exists. `EtaDocumentType` (`packages/domain/src/eta/submission.ts`) defines `invoice | credit_note | debit_note`, but nothing in the purchasing module ever constructs an ETA submission for a purchase return — the «إشعار مدين» the buyer's vocabulary expects is only ever an internal GL effect, never a document that leaves the building.
- **False pass:** the return confirms, reduces AP and is visible in the list — treating that as "the debit note was issued" conflates the internal accounting entry with an actual supplier-facing document; there isn't one.

### MTP-PUR-56 — Confirm a draft return; cancel a confirmed return
- **Persona / permission:** مسؤول مشتريات، `purchases.return.confirm`, `.void`
- **Preconditions:** PRT-DEMO-2 (draft, 12 units, DEFECTIVE)
- **Steps:**
  1. Confirm PRT-DEMO-2 — check `availableQty` still correctly reflects the 20 already taken by PRT-DEMO-1 (100 remaining, 12 requested — should succeed).
  2. Then attempt to VOID the now-confirmed PRT-DEMO-2.
- **Expected:** confirm succeeds, stock drops by 12, AP drops accordingly. Void reverses both — stock returns to the warehouse, AP is restored — leaving PI-DEMO-7's remaining-returnable quantity back at what it was before PRT-DEMO-2 (i.e., only PRT-DEMO-1's 20 units remain deducted).
- **False pass:** the void flips the status pill without checking that the reversal actually restored BOTH the stock quantity and the returnable-quantity ceiling for a future return against the same invoice line — a one-sided void here would silently under- or over-state what can still be returned.

### MTP-PUR-57 — Returning stock already sold downstream is not guarded the way receipt cancellation is
- **Persona / permission:** مسؤول مشتريات، `purchases.return.create`
- **Preconditions:** a confirmed purchase invoice whose stock has since been sold via a confirmed sales invoice, reducing on-hand below the return's line qty
- **Steps:**
  1. Create a purchase return for a quantity that would take on-hand negative once confirmed.
- **Expected:** compare this against MTP-PUR-32's `PurchaseItemsAlreadyConsumedError` guard on receipt cancellation — check whether purchase-return confirm has an equivalent guard, or instead relies solely on the tenant's general **«السماح بمخزون سالب»** setting (same as any other stock-out document). If it relies on the general setting, a tenant that allows negative stock elsewhere would allow a return to walk inventory negative with no purchase-specific warning.
- **False pass:** the return is refused (because negative stock happens to be disallowed tenant-wide) and this is read as "purchase returns have a consumed-stock guard" — it doesn't; it inherited a generic guard that has nothing to do with purchase returns specifically. Toggle **«السماح بمخزون سالب»** on and repeat to see the real behaviour underneath.

---

## I. Purchase reports

### MTP-PUR-58 — المشتريات حسب الفترة reconciles to confirmed purchase invoices in range
- **Persona / permission:** مسؤول مشتريات، reports access
- **Preconditions:** several confirmed purchase invoices across at least two months
- **Steps:**
  1. Open **«المشتريات حسب الفترة»**, set a date range covering exactly the seeded August 2026 invoices.
  2. Sum the report's period total.
  3. Independently sum `subtotal` (or `total`, matching whichever the report claims) of every confirmed purchase invoice dated in that range from `#/purchases/purchase-invoices`.
- **Expected:** the two sums agree to the cent. Cancelled/draft invoices must be excluded from both.
- **False pass:** the report renders a non-empty table with plausible-looking numbers — without cross-footing against the invoice list for the SAME date range, a report double-counting landed-cost-adjusted lines or omitting one invoice would look equally plausible.

### MTP-PUR-59 — المشتريات حسب المورد matches the sum of each supplier's own statement
- **Persona / permission:** مسؤول مشتريات
- **Preconditions:** SUPP-DEMO-1 and SUPP-DEMO-2, each with confirmed invoices
- **Steps:**
  1. Open **«المشتريات حسب المورد»** for the same date range as MTP-PUR-58.
  2. For SUPP-DEMO-1, compare the report row's total against **«إجمالي المؤكد»** on that supplier's own **«فواتير المشتريات»** tab (MTP-PUR-04), for the SAME date range.
- **Expected:** the two figures agree exactly, per supplier.
- **False pass:** the report's grand total matches MTP-PUR-58's period total (an easy self-consistency check) while a single supplier's row is wrong — check at least two suppliers' rows individually, not only the report's own total.

### MTP-PUR-60 — المشتريات حسب الصنف matches the fulfilment/received quantity, not just invoiced qty
- **Persona / permission:** مسؤول مشتريات
- **Preconditions:** an item bought via more than one invoice, with at least one purchase return against it
- **Steps:**
  1. Open **«المشتريات حسب الصنف»** for زيت عباد الشمس.
  2. Compare the reported quantity/value against: (a) the sum of invoiced qty across PI-DEMO-7 and any other invoices for this item, and (b) the same figure NET of PRT-DEMO-1's confirmed 20-unit return.
- **Expected:** state explicitly which of (a) or (b) the report actually shows — gross purchased or net-of-returns — and confirm it is internally labelled correctly (a report titled "المشتريات" that silently excludes returns without saying so would overstate true net purchases).
- **False pass:** the report shows *a* number for the item and it is accepted without determining whether it is gross or net — the two figures differ by exactly the returned quantity's value and a buyer comparing this report against the supplier statement (which does account for returns) would otherwise "find" a phantom discrepancy.

### MTP-PUR-61 — أعمار ديون الموردين ties out to the supplier statement's own reconciliation note
- **Persona / permission:** مسؤول مشتريات
- **Preconditions:** SUPP-DEMO-1 with an overdue invoice (dueDate in the past)
- **Steps:**
  1. Open **«أعمار ديون الموردين»**, find SUPP-DEMO-1's row and its current/overdue bucket split.
  2. Cross-check against MTP-PUR-03's supplier-statement reconciliation footnote for the same supplier.
- **Expected:** the statement's own note already states whether it matches or differs from this report — confirm which, and if it differs, read the diff-explanation text (the report counts every confirmed invoice's full total without deducting what has been paid off it, and excludes the opening balance) and verify that explanation actually accounts for the full gap observed, not just part of it.
- **False pass:** both screens show *a* number for the supplier and they are "roughly similar" — the product itself already computes and displays the exact discrepancy amount and its stated cause; use that, don't eyeball it.

---

## Gaps — no screen to test

- **Purchase requisition (طلب شراء داخلي) with departmental consolidation.**
  There is no screen anywhere in `apps/web/src/screens/` and no route in
  `packages/api/src/` for a department to raise an internal request that a
  buyer later reviews and consolidates into one purchase order. «أمر الشراء»
  (`PurchaseOrdersScreen`) is the FIRST document in the chain — it commits to
  a supplier immediately on creation. There is no pre-commitment "someone in
  the warehouse/production floor needs X" step, and consequently nothing for
  the 26-action approval-workflow engine to gate BEFORE a supplier-facing
  commitment exists (the workflow engine's `PURCHASE_ORDER_CONFIRM` action
  type gates the PO itself, and — per MTP-PUR-18 — does not even do that in
  practice). A buyer wanting departmental requisition-and-consolidation has
  no in-app path and must run it as a side spreadsheet or a string of ad-hoc
  Slack/email requests before ever opening this product.

- **Supplier evaluation / scorecard.** No on-time-delivery tracking, no
  quality-rejection-rate tracking, no lead-time history, no supplier rating
  of any kind exists anywhere in `packages/domain/src/purchasing` or the
  suppliers screens — only the static master-data fields (payment terms,
  currency, category, contacts, opening balance) and the transactional
  statement/aging views already covered in section A. "Which supplier
  actually delivers on time" is not answerable from the product at all.

- **Per-supplier price agreements / negotiated price history.** Covered as a
  testable absence in MTP-PUR-06 rather than here, but worth restating as a
  gap in its own right: there is no entity anywhere modelling "supplier X
  quoted item Y at price Z, valid until date W" outside of a live RFQ's
  recorded quotes (which are never retained as a *history* once the RFQ is
  closed/converted — there is no "past quotes for this item" view scoped to
  a supplier). The only persistent per-item price the system offers at
  order-entry time is the single tenant-wide `item.costPrice`.

- **Supplier-side spend cap.** No `creditLimit` (or equivalent) field exists
  on the supplier record, unlike the customer record which has one. There is
  no way to stop a purchase order or invoice from being raised against a
  supplier past a discretionary exposure ceiling.
