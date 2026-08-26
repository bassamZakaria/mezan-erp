# Mezan — posting trails

**One thread of real actions per part of the product, pulled taut across every
module it touches.** A trail is not a list of screens to open: it is a chain of
clicks where each step changes something *somewhere else*, and the check is
whether that somewhere else agrees.

The module scenarios (`01..08`) prove each screen behaves, and `09-cross-module.md`
proves the seams between a handful of them. Neither answers the question a buyer
asks on day one: *if I do my actual day's work in this thing, do the numbers still
make sense at the end of it?*

## How to run a trail

| | |
|---|---|
| Web | `http://localhost:5174` (`pnpm --filter web dev`) |
| API | `http://127.0.0.1:3010` with `MEZAN_SEED_DEMO=1` (`pnpm server`) |
| Sign in | محمد الشهابي / PIN `1234` |

Take the steps **in order, in the UI**, and after each one open the screens
listed under it and check them against the stated effect. Reload the page before
you tick anything off — reloading is what catches "works until you look again".

Two rules make the checks worth doing:

- **Check a pair, never a single figure.** One plausible number hides
  everything; two that must agree cannot. Every trail names its pair.
- **A status is not a posting.** A document that says مدفوع, مؤكد or مُرحّل has
  only claimed something. The claim is true when the ledger moved with it.

## This file is the source

`pnpm trails` parses this file and rebuilds the tickable page from it
(`scripts/build-trail-pack.mjs` → published artifact). Edit here, never there.
The format is load-bearing:

```
## T01 · Sales — Quote to collection
Modules: Sales · Inventory · Accounting
Executable: cross-module.ts x40

1. [ok] The action to take, named as the screen names it.
   - Where: what must be true afterwards.
   - !Where: what is wrong today (renders as the failing branch).
Done: the pair that must agree once the trail is finished.
```

`[ok]` = walked through the running app or asserted by `pnpm scenarios`.
`[stop D39]` = a known defect blocks it; the code is the row in `docs/defects.md`
— note that you saw it, do not re-file it. `[open]` = written from the routes and
the domain, not yet driven end to end. Finding it wrong is the point.

---

## T01 · Sales — Quote to collection
Modules: Sales · Inventory · Accounting · Treasury · Dashboard · Reports
Executable: cross-module.ts x40 · sales.ts

1. [ok] المبيعات ← العملاء — add a customer, set a credit limit.
   - Sales: the customer appears in the quote and invoice pickers.
   - Reports: أعمار ديون العملاء does not list them — the report counts documents, not names. A zero row would be an invented one.
2. [ok] المبيعات ← عروض الأسعار — quote them for 2–3 items, save as a draft.
   - Everywhere: no stock and no ledger effect. A draft quote has no number either — the list shows «مسودة» until it is sent.
3. [ok] Quote detail ← إرسال للعميل, then قبول العميل.
   - Sales: sending mints the number (QT-…). Neither transition moves anything.
4. [ok] Quote detail ← إنشاء الفاتورة — pick the due date and the warehouse.
   - Sales: a draft sales invoice is created; still no stock, still no ledger.
   - Sales: the panel names the new invoice by its internal id and does not link to it.
5. [stop D39] المبيعات ← فواتير المبيعات — open the draft and confirm it.
   - !Blocked: there is no confirm control on the invoice page — only «رجوع». The draft cannot be posted from any screen; the route is reachable only over the API.
   - Inventory: stock falls per line at weighted-average cost.
   - Accounting: one balanced entry — Dr AR 1105 / Cr Revenue 4100 + Output VAT 2200, and Dr COGS 5100 / Cr Inventory 1200 at cost, not at price.
   - Reports: the invoice appears in المبيعات حسب الفترة / العميل / الصنف and in the customer aging at its full total.
6. [stop D40] Invoice detail ← المدفوعات ← تحصيل دفعة — collect the whole amount.
   - Sales: the invoice flips to مدفوع and المحصل shows the money.
   - !Accounting: nothing posts. AR still carries the full amount, no cash or bank account moves, no journal entry is written.
   - !Reports: the aging report drops the customer while GL 1105 keeps them — the pair disagrees by exactly this payment.
   - Treasury: the working path today is a سند قبض allocated to the invoice, which posts correctly — and then hits D1 from the other side.
7. [ok] المحاسبة ← التقارير المالية — ميزان المراجعة and قائمة الدخل.
   - Accounting: every debit above has its credit; the trial balance still balances.
Done: stock down by what was sold, revenue up by the net, VAT up by the tax — and once the collection is made the way that actually posts, the customer's balance back to zero in both the aging report and GL 1105.

## T02 · Sales — The goods come back
Modules: Sales · Inventory · Accounting · Treasury · Reports
Executable: sales.ts · cross-module.ts x6

1. [ok] المبيعات ← مرتجعات المبيعات — return part of a confirmed invoice.
   - Inventory: stock rises again at the cost it left at, not at the sale price.
   - Accounting: Dr Revenue + Dr Output VAT / Cr AR, and Dr Inventory / Cr COGS.
   - Sales: the source invoice's remaining balance nets the return.
2. [ok] Try to return the same goods twice.
   - Sales: refused. The available quantity is recomputed server-side from posted documents — an inflated one in the request body is ignored (regression guard for F7).
3. [ok] Refund the customer — الخزينة ← السندات النقدية ← سند صرف.
   - Treasury: the cash box falls by the refund.
   - Accounting: Dr AR / Cr Cash — a separate movement. Confirming a return credits the customer; it never hands money back on its own.
4. [ok] Check the reports.
   - Reports: المبيعات حسب الفترة nets the return; أعمار ديون العملاء shows the reduced balance.
Done: the customer's receivable and the item's on-hand both back where they were before the sale, with two documents explaining the round trip.

## T03 · Sales — Three mechanisms, one price
Modules: Sales · Accounting · Reports
Executable: seams.ts x63 · x28 · x34

1. [open] المبيعات ← قوائم الأسعار — create a list and assign it to the customer.
   - Sales: the list appears on the customer record and on the quote header.
2. [ok] المبيعات ← العروض — create a promotion that needs no coupon.
   - Sales: eligibility is by item, customer category and date window.
3. [stop D35] Raise an invoice for that customer and that item.
   - !Accounting: the price list is never consulted server-side — a line at 5.00 against a list quoting 80.00 is accepted without a word.
   - Sales: the promotion is applied at confirm and recorded on the invoice that granted it; deactivating it afterwards restates nothing.
4. [ok] Push the customer past their credit limit.
   - Sales: the confirm is refused in Arabic, and the check sees the promoted price.
   - !Treasury: collecting through a voucher does not free the limit up again — the exposure still counts an invoice the customer has paid.
5. [ok] Apply an invoice-level discount.
   - Accounting: deducted before VAT and allocated across the lines with no rounding leak; above 100% or below zero is refused at the wire.
Done: whatever price ends up on the line is the one the tax, the credit check and the reports all use — and nothing silently sells below the list.

## T04 · Purchases — Order to payment
Modules: Purchases · Inventory · Accounting · Treasury · Dashboard · Reports
Executable: cross-module.ts x41 · purchases.ts

1. [stop D41] المشتريات ← الموردون — add a supplier.
   - Purchases: the supplier appears in the PO and invoice pickers.
   - !Purchases: the list's «المستحق للمورد» column shows the opening balance, so every supplier reads 0.00 while the supplier aging shows six figures.
2. [ok] المشتريات ← أوامر الشراء — order 2–3 items, then تأكيد وإرسال.
   - Everywhere: document only — no stock, no ledger. The PO takes its number at draft.
3. [ok] المشتريات ← استلام البضائع — receive against the PO and confirm.
   - Inventory: stock rises and the item's cost re-averages.
   - Accounting: no entry yet. The inventory sub-ledger legitimately runs ahead of GL 1200 by the receipt's value until the invoice lands — there is no goods-received-not-invoiced account to hold it.
4. [stop D42] المشتريات ← فواتير المشتريات ← من إيصال استلام — create and confirm.
   - !Tax: every auto-filled line arrives at 0% VAT and no screen can change it. Input VAT 1400 never moves and the tax is unreclaimable.
   - Accounting: Dr Inventory 1200 (+ input VAT, when there is any) / Cr AP 2100 — GL 1200 catches up with the receipt exactly.
5. [stop D18] الخزينة ← السندات النقدية ← سند صرف — pay the supplier.
   - Treasury: the cash box falls, GL 2100 falls with it.
   - !Accounting: the AP sub-ledger does not hear the payment at all, so مطابقة الأرصدة reports it as a new mismatch.
6. [ok] المحاسبة ← التقارير المالية — ميزان المراجعة and الميزانية.
   - Accounting: both still balance after the whole chain.
Done: the received quantity on hand matches what was invoiced, GL 1200 and the stock valuation agree once the invoice is posted, and the supplier nets to zero in the ledger.

## T05 · Purchases — Shop around before you commit
Modules: Purchases · Reports
Executable: purchases.ts

1. [ok] المشتريات ← طلبات عروض الأسعار — raise an RFQ for two suppliers.
   - Purchases: the RFQ lists both suppliers and the requested lines.
2. [ok] Record each supplier's quoted prices.
   - Purchases: quotes are per supplier per line, not one price per RFQ.
3. [ok] Open the comparison.
   - Purchases: the basket totals decide, not the individual line prices.
4. [ok] Convert the winner into a purchase order.
   - Purchases: the RFQ closes and links the PO it produced; the PO drafts at the winning quote's prices.
5. [open] التقارير ← المشتريات حسب المورد.
   - Reports: counts what was actually bought, not what was quoted.
Done: a paper trail from "who did we ask" to "what did we pay", with the losing quotes still readable afterwards.

## T06 · Purchases — Returns and the true landed cost
Modules: Purchases · Inventory · Accounting · Treasury · Reports
Executable: cross-module.ts x7 · x9 · purchases.ts

1. [ok] المشتريات ← مرتجعات المشتريات — return goods against a confirmed invoice.
   - Inventory: stock falls.
   - Accounting: Dr AP / Cr Inventory, with input VAT reversed.
   - Treasury: the supplier's refund is a separate receipt into the cash box.
2. [stop D36] المشتريات ← التكاليف الإضافية — add freight and clearance against the receipt, BY_VALUE.
   - Inventory: the allocation sums to exactly the total entered — no rounding leak — and each target's unit cost rises by its share.
   - Inventory: the next sale's COGS charges the raised cost, not the invoice price. That is the whole point of the document.
   - !Reports: the revaluation writes no stock movement, so انحراف تقييم المخزون reports drift on a healthy tenant and the position cannot be replayed.
3. [ok] Run one BY_QUANTITY against a single target.
   - Inventory: 100% of the cost lands on it.
Done: the item's unit cost tells the truth about what it cost to get it into the warehouse, and the freight money is in the stock value rather than in an expense account.

## T07 · Inventory — One item, cradle to count
Modules: Inventory · Accounting · Reports · Settings
Executable: inventory.ts · cross-module.ts x14

1. [ok] المخزون ← الأصناف — create a stock item with its GL accounts.
   - Accounting: revenue, COGS and inventory accounts belong to the item, not to the invoice; a sale reads them from here.
2. [ok] المخزون ← تسويات المخزون — open it with INITIAL_STOCK.
   - Accounting: balanced Dr 1200 / Cr 3100. Opening stock is capital, not profit.
3. [ok] المخزون ← تحويلات المخزون — move some to another warehouse.
   - Inventory: quantity and value move together; the company total does not change and no GL entry is needed.
4. [stop D2] المخزون ← الجرد الفعلي — count a position short.
   - Inventory: the sub-ledger moves.
   - !Accounting: no journal entry at all — a single-sided count leaves inventory off by exactly the shortfall.
5. [ok] المخزون ← هبوط قيمة المخزون — run a write-down.
   - Accounting: charged to the P&L through a provision account, leaving the inventory control account and its reconciliation intact.
6. [ok] Open the stock reports.
   - Reports: مستويات المخزون, حركة المخزون, سجل المخزون, تقييم المخزون and أعمار المخزون all answer, and the valuation total equals GL 1200.
7. [open] المخزون ← طباعة الملصقات — print a label.
   - Settings: three sizes; symbology comes from الإعدادات ← إعدادات الباركود.
Done: what the warehouse says it holds, what the valuation report prices it at, and what GL 1200 carries are three views of one number.

## T08 · Inventory — Batches, expiry and what the shelf is worth
Modules: Inventory · Purchases · Sales · Reports
Executable: cross-module.ts x39 · shell.ts

1. [ok] Receive one item as two batches with different expiry dates.
   - Inventory: both batches are on hand with their own costs and dates.
2. [ok] Confirm the matching purchase invoice.
   - Accounting: GL 1200 catches up with the receipt.
3. [ok] Sell part of the position.
   - Inventory: FEFO decides which batch leaves — the earliest-expiring one goes first and disappears from أصناف قاربت على الانتهاء.
   - Accounting: costing is weighted-average, so COGS charges the blended cost. "What did the October batch cost me" is a question these books cannot answer today.
4. [stop D36] Open أصناف بطيئة الحركة, أعمار المخزون and انحراف تقييم المخزون.
   - !Reports: drift is reported on a healthy tenant because landed costs write no movement.
Done: the expiring report is a shelf-accurate list a pharmacy could act on, and every cost that reaches COGS came from a real receipt.

## T09 · Manufacturing — Raw material becomes a product
Modules: Manufacturing · Inventory · Accounting · Reports
Executable: cross-module.ts x13

1. [ok] التصنيع ← قوائم المواد — build a BOM for a finished item.
   - Manufacturing: components, quantities and the expected output are on one document.
2. [ok] التصنيع ← أوامر التصنيع — raise a work order and issue the materials.
   - Inventory: component stock falls at weighted-average cost.
3. [stop D3] Complete the work order.
   - Inventory: the finished item arrives carrying the produced cost.
   - !Accounting: completeWorkOrder never touches GL 1200 — the raw material left the ledger and the finished goods never arrived in it. The seeded BOM at qty 10 ends 80.00 short.
4. [ok] Sell the finished item.
   - Accounting: COGS charges the produced cost, not a guess.
5. [open] لوحة الإنتاج and التقارير ← التصنيع أم الشراء.
   - Reports: compares the produced cost against the purchase price for the same item.
6. [open] التصنيع ← التصنيع المخصص — a one-off order with its own recipe.
   - Manufacturing: the instance carries its own component list without editing the template BOM.
Done: value in equals value out — material consumed plus labour absorbed equals what the finished goods are carried at, on both sides of the ledger.

## T10 · Accounting — The books themselves
Modules: Accounting · Reports · Settings
Executable: accounting.ts · seams.ts x26

1. [ok] المحاسبة ← دليل الحسابات — add an account under the right parent.
   - Accounting: type and nature come from the parent; a posting account cannot have children.
2. [ok] المحاسبة ← القيود المحاسبية — post a manual entry.
   - Accounting: an unbalanced entry cannot post. Ever.
3. [ok] Reverse it.
   - Accounting: the reversal never mutates the original, links both sides, and the books still balance. Correction is by reversal — posted entries are immutable.
4. [stop D26] المحاسبة ← مراكز التكلفة — tag an expense with a cost centre.
   - Reports: a tagged journal entry reaches أرباح مراكز التكلفة once and the income statement once.
   - !Treasury: a treasury voucher cannot be tagged at all — the field does not exist on the wire — so almost all real spending lands in «غير مخصص».
5. [stop D1] المحاسبة ← مطابقة الأرصدة — the sub-ledgers against their controls.
   - !Accounting: this screen is the product's own two-number check. Today it shows the ledger and the sub-ledgers disagreeing by the sum of D1, D18, D2 and D3.
Done: every figure on every financial report can be walked back to a posted, balanced, immutable entry with an actor and a date on it.

## T11 · Accounting — Periods, back-dating and the year end
Modules: Accounting · Sales · Purchases · Treasury · Reports
Executable: cross-module.ts x15 · x37 · seams.ts x64 · x47

1. [stop D20] المحاسبة ← الفترات المالية — close the current period.
   - Accounting: sales confirm, voucher confirm and journal post all refuse with a period error, in Arabic.
   - !Purchases: the purchase-invoice confirm answers 500 instead — and is not atomic (D21): the stock went in before the GL refused, and nothing rolled it back.
2. [stop D29] Re-open the period and post into it.
   - Reports: that period's reports restate; the current period is untouched.
   - !Tax: nothing records that a VAT period was ever filed, so a backdated document silently restates a return that has already gone to the authority.
3. [stop D34] Generate the next fiscal year.
   - !Accounting: there is no year-end close — no closing entry, retained earnings never posted, last year's revenue still in 4100. The balance sheet balances only because the report derives retained earnings itself.
4. [open] Lock a closed period.
   - Accounting: locked is terminal — no reopen, no posting, and the screen must say so rather than offering a button that fails.
Done: a closed period is closed for every module by the same gate, and a new year starts where the old one ended — in the ledger, not only in the report.

## T12 · Accounting — The report pack ties out
Modules: Reports · Accounting
Executable: accounting.ts · shell.ts SCN-RPT-*

1. [ok] ميزان المراجعة.
   - Reports: total debit equals total credit.
2. [ok] الميزانية.
   - Reports: assets = liabilities + equity, and AR classifies as a current asset, not as cash.
3. [ok] قائمة الدخل.
   - Reports: the comparative window matches a direct run of the prior period, and 29 Feb clamps to 28 Feb rather than rolling into March.
4. [ok] قائمة التدفقات النقدية.
   - Reports: opening + net change = closing.
5. [ok] دفتر الأستاذ العام and كشف حساب.
   - Reports: the running balance's last row equals the reported closing balance.
6. [stop D28] إقرار ضريبة القيمة المضافة.
   - Reports: output minus input is the net payable.
   - !Tax: the return re-derives one blended rate per entry instead of reporting the rates actually charged, because no posted line carries a rate.
Done: six reports, one ledger, no figure that only one of them believes.

## T13 · Accounting — The pair that catches everything
Modules: Accounting · Sales · Purchases · Inventory
Executable: accounting.ts · every cross-module scenario re-checks these three

1. [stop D1] AR sub-ledger against GL 1105.
   - !Accounting: adrift by every voucher collection (D1) and every invoice-level payment (D40).
2. [stop D18] AP sub-ledger against GL 2100.
   - !Accounting: adrift by every supplier payment — the sub-ledger sums invoices and never subtracts allocations.
3. [stop D2] Inventory sub-ledger against GL 1200.
   - !Accounting: adrift by every physical count (D2), every completed work order (D3) and every crashed purchase confirm (D21).
   - Inventory: legitimately apart between a goods receipt and its invoice — that gap must close when the invoice posts.
4. [ok] Re-run all three after every trail in this pack.
   - Accounting: a trail that leaves one of them further apart than it found it has found something, whether or not the screen it used looked right.
Done: the three differences are exactly the known defects, and nothing else.

## T14 · Treasury — Where the money actually sits
Modules: Treasury · Accounting · Sales · Purchases · HR
Executable: cross-module.ts x0 · x3 · x4 · x5 · x11 · x16

1. [ok] الخزينة ← حسابات الخزينة — a cash box and a bank account, each mapped to its GL account.
   - Accounting: the treasury account's balance is the GL account's balance, not a second copy of it.
2. [stop D1] سند قبض / سند صرف — receive and pay against a real document.
   - Accounting: allocate the receipt onto the invoice it pays — GL AR clears exactly.
   - !Sales: the invoice's own amountPaid stays 0 all the same.
3. [ok] Capital injection — partner money into the box.
   - Accounting: cash and equity rise together; money arrives from an owner, not from thin air.
4. [ok] Transfer between two treasury accounts.
   - Treasury: money moves without being created or destroyed; both halves are one entry.
5. [stop D19] Try to overdraw the cash box.
   - Treasury: it is refused.
   - !Settings: the tenant setting «منع الرصيد السالب» that is supposed to govern the refusal is not wired to the guard — both switches are dead.
6. [ok] Reverse a confirmed payment.
   - Accounting: the box, the counter-account and the trial balance all return to their exact prior values.
7. [ok] Disburse an employee advance.
   - Treasury: it leaves the same box a supplier payment leaves — one treasury, not one per module.
8. [open] The day's close — every voucher of the day against the box's movement.
   - Treasury: the closing figure equals opening plus receipts minus payments, with each voucher listed.
Done: total treasury movement for the day equals the net of the vouchers that caused it, and each voucher names the document it settles.

## T15 · Treasury — The bank says something else
Modules: Treasury · Accounting · Reports
Executable: cross-module.ts x22

1. [ok] الخزينة ← تسوية كشوف البنك — import or enter a statement.
   - Treasury: the statement lines land unmatched, with the closing balance stated.
2. [ok] Match its lines against the vouchers that produced them.
   - Treasury: a matched pair drops out of both outstanding lists.
3. [ok] Confirm the reconciliation.
   - Accounting: it posts nothing to the ledger — reconciling is an assertion about what already posted, not a new fact.
4. [open] Leave one statement line unmatched and one voucher outstanding.
   - Treasury: both are visible as the reconciling items, with the closing difference equal to their net.
Done: the bank's balance, the treasury account's balance and GL 1310 explain their differences line by line.

## T16 · Financial papers — A cheque through all seven states
Modules: Financial papers · Treasury · Accounting · Sales
Executable: accounting.ts · cross-module.ts x8

1. [ok] الأوراق المالية ← سجل الشيكات — receive a customer cheque against a real sale.
   - Treasury: the money is not in the bank yet — receipt is custody, not collection.
2. [ok] Deposit it, then collect it.
   - Accounting: only on collection does the bank account rise and AR clear.
3. [ok] Bounce one.
   - Accounting: the reversal returns the party's control account to its prior value exactly — a bounced cheque is an undo with a trace, not an adjustment.
4. [open] Send an outgoing cheque to a supplier and walk the mirror path.
   - Treasury: issued, presented, cleared — the bank falls only on clearing.
5. [open] Check the register against the treasury movements it caused.
   - Reports: cheques under custody plus the bank balance equal what the books say the company holds.
Done: at every moment, cheques under custody plus the bank balance equal what the books say the company holds.

## T17 · Accounting — Tax, both halves, and what the authority sees
Modules: Accounting · Sales · Purchases · Reports · Settings
Executable: cross-module.ts x10 · x33 · seams.ts x29 · x45 · x46 · x47

1. [stop D42] Sell at 14% and buy at 14%.
   - Accounting: output VAT 2200 rises on the sale, input VAT 1400 on the purchase.
   - !Purchases: unless the purchase invoice came from a goods receipt — then it is 0%.
2. [ok] One invoice at two rates, plus a tax-exempt customer.
   - Reports: the ledger and the return agree with both; an exempt customer pays none.
3. [stop D28] إقرار ضريبة القيمة المضافة, then pay the net.
   - Accounting: paying clears both sides.
   - !Reports: the return's rate buckets are derived, not recorded.
4. [stop D5] المحاسبة ← الفاتورة الإلكترونية — switch auto-submit on and confirm an invoice.
   - !Tax: the queue has an enqueue that nothing calls — confirming a real invoice enqueues nothing. The screen is a window onto an empty pipe.
5. [stop D27] Withhold tax on a local B2B payment.
   - !Tax: nowhere to put it — no account, no document field, no report. A payment cannot settle a supplier in full while paying the authority the difference.
Done: the VAT return can be filed straight from the screen, and every figure on it is a sum of posted lines rather than a derivation.

## T18 · Accounting — A debt in another money
Modules: Accounting · Purchases · Sales · Reports
Executable: seams.ts x23 · x24

1. [stop D25] المحاسبة ← أسعار الصرف — add a rate, approve it, lock it.
   - !Accounting: a locked rate can be silently rewritten, and its status reset, by re-POSTing its id.
2. [stop D24] Raise a supplier invoice in USD.
   - !Accounting: the currency is a label — no rate is applied, no GL line is tagged, and the payable is booked at the foreign figure as though it were pounds.
3. [ok] المحاسبة ← إعادة تقييم العملات الأجنبية — revalue at the closing rate.
   - Accounting: the restatement touches only the FX accounts and auto-reverses so it cannot be counted twice — correct machinery with nothing correct to work on until the rate is applied.
Done: a foreign debt is carried at today's rate, and the gain or loss from the move is in the P&L rather than hidden in the payable.

## T19 · CRM — A stranger becomes a customer
Modules: CRM · Sales · Reports
Executable: crm.ts

1. [ok] إدارة علاقات العملاء ← العملاء المحتملون — add a lead and walk its statuses.
   - CRM: the state machine is enforced server-side; terminal statuses accept nothing.
2. [ok] Qualify and convert it.
   - Sales: a real customer and a real opportunity are created — no dangling reference, no half-converted lead.
3. [ok] الفرص / خط المبيعات — drag the opportunity across stages.
   - CRM: status follows its destination stage's type; win and loss stay exclusive; stage reorder is guarded at the boundaries.
4. [ok] الأنشطة — log a call, complete it, cancel another.
   - CRM: both are terminal and cannot be repeated.
5. [ok] Quote the new customer — T01 continues from here.
   - Sales: the converted customer is a first-class customer, pickers included.
Done: the pipeline's total value and the quotes actually raised for those customers describe the same sales effort.

## T20 · HR — Hire, pay, and account for it
Modules: HR · Treasury · Accounting · Reports
Executable: hr.ts · cross-module.ts x11 — HR is descoped from v1: design review, not a release gate

1. [ok] الأقسام / المسميات الوظيفية / الموظفون — set up one employee.
   - HR: the employee carries a department, a job title and a branch.
2. [open] العقود — give them an active contract.
   - HR: known behaviour — a lapsed fixed-term contract keeps reporting «ساري».
3. [ok] الحضور والانصراف and طلبات الإجازات.
   - HR: a request exceeding the available balance is refused.
   - HR: an approved unpaid leave prorates the payroll deduction exactly.
4. [ok] سلف الموظفين — request, approve, disburse.
   - Treasury: the advance leaves the same cash box everything else leaves.
   - HR: the instalment schedule splits by largest remainder and always sums exactly.
5. [ok] الرواتب — run the payroll for the month.
   - HR: gross − deductions = net per payslip and for the run total.
   - HR: an employee with no active contract is excluded, not failed; approving the run recovers exactly one advance instalment.
6. [ok] Disburse the run.
   - Accounting: one balanced journal entry; the treasury falls by exactly the net.
   - HR: social insurance is two liabilities, not one deduction.
Done: what the payslips say the company owes, what the ledger carries as a liability, and what left the treasury are the same three numbers.

## T21 · Projects — Work that spans months
Modules: Projects · Accounting · Purchases · Reports
Executable: crm.ts (projects)

1. [ok] المشاريع والمقاولات — create a project.
   - Projects: code uniqueness is enforced.
2. [ok] Walk its status lifecycle.
   - Projects: guarded server-side; مكتمل and ملغي are terminal.
3. [open] Tag costs to it — purchases and journal entries.
   - Accounting: the project behaves like a cost dimension, not a note field.
4. [open] Open the project P&L.
   - Projects: thin by design in v1 — BOQ, progress certificates and retention are not built. A contractor's trail stops here, and that is the honest answer to give one.
Done: every pound spent on the project is attributable to it, and the project's own view agrees with the cost-centre P&L.

## T22 · Fixed assets — Buy, depreciate, dispose
Modules: Assets · Accounting · Treasury · Reports
Executable: crm.ts (fixed-assets) · cross-module.ts x12

1. [ok] الأصول الثابتة ← تصنيفات الأصول — a category with a method and a life.
   - Assets: code uniqueness and the numeric ranges are validated.
2. [ok] سجل الأصول — buy an asset with company money.
   - Treasury: cash falls; the asset is capitalised.
   - Inventory: it never touches stock — an asset is not inventory.
3. [ok] الإهلاك — run depreciation.
   - Accounting: each asset depreciates by its own category's method and life; the posting balances.
   - Assets: accumulated depreciation never exceeds cost − salvage, and a fully-depreciated asset flips status on posting.
4. [stop D13] Dispose of one.
   - !Assets: there is no disposal route and no button. The status value and the permission both exist; the action does not. The trail cannot be finished.
Done: the register's net book value equals cost less accumulated depreciation in the ledger, asset by asset — and an asset that leaves the company can actually leave the books.

## T23 · Field sales — A van goes out and comes back
Modules: Field sales · Inventory · Treasury · Accounting · Reports
Executable: crm.ts (field-sales) · cross-module.ts x21 · shell.ts SCN-RPT-20

1. [stop FLD-11] المبيعات الميدانية ← رحلات المندوبين — open a trip with a stock and cash float.
   - Inventory: custody transfer — stock moves to the van warehouse, cash to the van treasury.
   - !Field sales: the open route discards the caller's id and mints no tripNo.
2. [stop D22] Record roadside sales and cash taken.
   - !Treasury: the cash movement only mutates the trip document — nothing reaches the van treasury.
3. [stop D22] Settle the trip.
   - !Treasury: settling transfers the full counted cash out of the van treasury — float plus takings that were never posted into it — so every completed trip drives the van's cash account down by what its sales brought in.
   - Field sales: stock and cash variances are computed and priced correctly.
4. [ok] التقارير ← مبيعات المندوبين.
   - Reports: the cash variance report agrees with the settled trip.
Done: float out + sales in − cash returned = zero, in the van's treasury account and not only on the trip document.

## T24 · Installments — Sell now, collect for a year
Modules: Installments · Sales · Treasury · Reports
Executable: crm.ts (installments) · cross-module.ts x20

1. [ok] الأقساط ← خطط الأقساط — build a plan on a real invoice.
   - Installments: the schedule's instalments sum to exactly the plan total — no rounding leak on any line.
2. [ok] Take the down payment.
   - Treasury: a treasury movement of its own, posted like any other receipt.
3. [stop INST-08] Collect an instalment.
   - !Installments: no route anywhere sets an instalment line to «مدفوع». Collection is a treasury voucher never linked back to the plan line, so a plan paid in full still shows every line outstanding.
4. [ok] متابعة التحصيل — create a follow-up, complete it with an outcome, cancel another.
   - Installments: outcomes are free text over a fixed set, and both terminal states stick.
5. [ok] التقارير ← الأقساط المتأخرة.
   - Reports: exactly the late line, no others.
Done: the plan's outstanding balance, the invoice's remaining balance and GL 1110 agree — today they cannot, and that is the finding.

## T25 · Platform — The machinery under all of the above
Modules: Settings · Workflow · System · Audit
Executable: platform.ts · seams.ts x56 · x57 · x58 · x61

1. [stop D7] الإعدادات ← الفروع / المستودعات — a second branch and a second warehouse.
   - Shell: warehouse scope narrows the stock lists and the reports correctly.
   - !Shell: branch scope narrows nothing — a caller scoped to one branch reads the other's documents.
2. [stop D31] الأدوار والصلاحيات / المستخدمون — a role without a permission.
   - Settings: the dependency graph is enforced server-side.
   - !Settings: the visibility tiers it grants (view_own, view_cost) are enforced by no route, so a plain viewer reads every colleague's invoice, its unit cost, and HR salaries.
3. [stop D8] إعدادات الموافقات — put a confirm behind an approval chain.
   - Workflow: approve, reject and request-modification all work.
   - !Workflow: an admin's approve still bypasses the chain.
4. [stop D33] تسلسلات الترقيم — change a prefix.
   - Settings: it affects the next document only, never a posted one. Eight simultaneous confirms take eight distinct, gap-free numbers, and a failed confirm burns none.
   - !Settings: numbering is tenant-global — two branches share one counter and nothing on the number says where it came from.
5. [ok] قواعد الإشعارات / الويب هوك / مفاتيح API.
   - Platform: a confirm fires its rule and attempts its webhook; neither can duplicate the document or roll it back, and retries are bounded. Only emitted events may be subscribed to.
6. [stop D23] نقل البيانات — import opening balances and history.
   - Settings: the commit is all-or-nothing.
   - !Accounting: a historical import records no opening AR or AP at all — a migrated business owes and is owed nothing in its ledger.
7. [open] قوالب الطباعة / إعدادات الباركود — print an invoice and a label.
   - Print: Arabic must render offline in the PDF, and the invoice must carry what an Egyptian invoice legally carries.
8. [stop D30] سجل المراجعة — every money-moving action names who, where and what.
   - !Audit: rows written by an all-branches caller carry branchId: null, so the branch filter can never find them again.
9. [stop x38] النظام ← حالة النظام — backup, restore, licensing and entitlements.
   - !System: module licensing is designed but not enforced — every module answers regardless of what the tenant is entitled to.
Done: a second user, in a second branch, with a narrower role, can do their job and cannot see or do anything outside it — and everything they did is in the audit log with their name on it.

## T26 · Shell — The app around the documents
Modules: Shell · Dashboard · Reports · Settings
Executable: shell.ts · cross-module.ts x17

1. [ok] Every screen has a URL.
   - Shell: #/sales/quotes/new, #/sales/sales-invoices/INV-000007 — reload it, share it, hit Back. A create form with no address cannot be linked or reloaded.
2. [open] Breadcrumbs walk back up.
   - Shell: on a document opened by id the last crumb is the raw id — worth fixing when the numbering lands.
3. [stop D32] The command palette and the global search.
   - !Shell: there is no server-side search, and the client filter cannot forgive Arabic — «احمد» finds nothing for «أحمد», «ليلي» nothing for «ليلى».
4. [stop D7] The branch and warehouse pickers.
   - !Shell: warehouse scope narrows أرصدة المخزون and the reports; branch scope does not.
5. [ok] Theme and language.
   - Shell: both themes and both languages on every screen; the tree re-labels itself without a reload, and RTL mirrors rather than merely translating.
6. [stop D37] The dashboard's tiles against the ledger.
   - Dashboard: cash and payables agree with the accounts they claim to summarise.
   - !Dashboard: receivables does not — the tile sums every 11xx asset account while the aging report covers trade AR only, a 5,486.12 disagreement that is a scope question, not arithmetic.
7. [ok] الموافقات inbox and the notification bell.
   - Workflow: the inbox count, the bell count and the pending requests are the same number.
Done: nothing on the dashboard is a number the rest of the app cannot reproduce, and every screen can be reached, linked and reloaded.

## T27 · Sales — The customer master record
Modules: Sales · Accounting · Reports · Settings
Executable: sales.ts · crm.ts

1. [ok] المبيعات ← العملاء — create with code, terms, currency, category and price list.
   - Sales: an empty code auto-numbers; a duplicate code is refused.
   - Settings: the generated code follows تسلسلات الترقيم, not a private format.
2. [open] Set an opening balance on a new customer.
   - Accounting: it must reach GL 1105 as an opening entry, not sit on the record as a decorative number.
3. [open] Mark one customer معفى من الضريبة and set the ETA buyer type.
   - Sales: their invoices carry no VAT at all — asserted by cross-module x33.
4. [ok] Open the customer detail and its statement.
   - Sales: opening balance, every confirmed invoice, every return, every allocated collection, running balance.
   - Reports: the statement's closing balance equals the customer's row in أعمار ديون العملاء.
5. [open] Deactivate a customer who has documents.
   - Sales: they leave the pickers and stay in the reports — history is not deleted by deactivation.
6. [stop D32] Search the list by an Arabic name typed without its hamza.
   - !Shell: no match. Search is client-side and does not normalise Arabic.
Done: the customer's statement, the aging report and GL 1105 tell the same story about the same person.

## T28 · Purchases — The supplier master record
Modules: Purchases · Accounting · Reports
Executable: purchases.ts

1. [ok] المشتريات ← الموردون — create with code, payment terms, currency and category.
   - Purchases: duplicate codes are refused; an empty code auto-numbers.
2. [stop D41] Read the balance column on the list.
   - !Purchases: it renders the opening balance under a header meaning "owed to supplier" — 0.00 for every supplier on a seeded tenant.
3. [ok] Open the supplier detail and its statement.
   - Purchases: opening balance, confirmed invoices, returns, landed costs, allocated payments, running balance.
   - Reports: the statement's closing balance equals the supplier's row in أعمار ديون الموردين.
4. [open] Set payment terms of 60 days and raise an invoice.
   - Purchases: the due date is derived from the terms, and the aging buckets follow the due date, not the document date.
Done: what the supplier statement says is owed, what the aging report says, and what GL 2100 carries are one number.

## T29 · Sales — The paths that must be refused
Modules: Sales · Accounting
Executable: sales.ts

1. [ok] Create an invoice line with quantity zero.
   - Sales: refused.
2. [ok] Post an invoice with an empty lines array.
   - Sales: refused at the wire boundary, before any domain check runs.
3. [ok] Enter a negative unit price.
   - Sales: refused server-side, not merely by the input's min attribute.
4. [ok] Apply a percent discount above 100, then an amount discount below zero.
   - Sales: both refused at the wire.
5. [ok] Discount an invoice to a zero total and try to confirm it.
   - Sales: the total floors at zero rather than going negative, and a zero-total invoice cannot be confirmed.
6. [ok] Confirm the same invoice twice, and convert an already-converted quote.
   - Sales: both refused with 409, not silently repeated.
7. [ok] Accept a quote that was never sent.
   - Sales: refused — the lifecycle is a state machine, not a set of buttons.
Done: every refusal is in Arabic, names what is wrong, and leaves the document exactly as it was.

## T30 · Purchases — Partial receipts and over-receipt
Modules: Purchases · Inventory
Executable: purchases.ts

1. [open] Raise a PO for 100 units and receive 40.
   - Purchases: the PO goes مستلم جزئياً and the line's receivedQty is 40.
   - Inventory: stock rises by 40 only.
2. [open] Receive the remaining 60.
   - Purchases: the PO goes مستلم بالكامل; a further receipt against it is refused.
3. [open] Try to receive more than was ordered.
   - Purchases: refused, or accepted only against an explicit tolerance — either way the answer must be deliberate and visible on the screen.
4. [ok] Confirm an already-confirmed PO, receipt or invoice.
   - Purchases: 409, all three.
Done: the sum of the receipts equals the ordered quantity, and no receipt can invent stock the order never covered.

## T31 · Inventory — Templates, specifications and configurable products
Modules: Inventory · Manufacturing · Sales
Executable: inventory.ts · docs/scenarios/03 §2–4, §13

1. [open] المخزون ← المواصفات — define a specification and its values.
   - Inventory: values are ordered and reusable across items.
2. [open] المخزون ← قوالب المنتجات — build a template from two specifications.
   - Inventory: the variant matrix is the product of the value sets, and the count is stated before generation.
3. [open] المخزون ← المنتجات القابلة للتهيئة — generate the variants.
   - Inventory: each variant is a real item with its own code, barcode and stock position — not a label on one shared item.
4. [open] Sell one variant.
   - Inventory: only that variant's stock falls.
5. [open] التصنيع ← التصنيع المخصص — configure an instance for a customer order.
   - Manufacturing: the instance carries its own component list and price without editing the template.
Done: a variant behaves exactly like an ordinary item everywhere downstream — stock, costing, reports and print.

## T32 · Inventory — Transfers, in-transit and the refusals
Modules: Inventory · Accounting · Settings
Executable: inventory.ts

1. [ok] Transfer stock between two warehouses.
   - Inventory: quantity and value leave one and arrive at the other; the company total is unchanged.
   - Accounting: no GL entry — nothing left the company.
2. [open] Transfer into مخزون بالطريق, then receive it at the destination.
   - Inventory: in-transit holds the value while it is neither here nor there, and the destination's cost re-averages on arrival.
3. [open] Transfer more than the source holds.
   - Inventory: refused, with the available quantity recomputed server-side.
4. [open] Transfer to the same warehouse.
   - Inventory: refused.
5. [ok] Narrow the warehouse scope in the shell and re-open أرصدة المخزون.
   - Shell: the list narrows to the scoped warehouses only.
Done: every unit is in exactly one place at every moment, and the sum across warehouses never changes on a transfer.

## T33 · Inventory — Every adjustment reason and what it posts
Modules: Inventory · Accounting
Executable: inventory.ts · cross-module.ts x14

1. [ok] INITIAL_STOCK — open a position.
   - Accounting: Dr 1200 / Cr 3100.
2. [open] DAMAGE / SHRINKAGE — write stock off.
   - Accounting: Dr an expense or provision / Cr 1200, at weighted-average cost.
3. [stop D2] PHYSICAL_COUNT — book a counted difference.
   - !Accounting: no entry at all; the sub-ledger moves alone.
4. [open] An adjustment IN with a unit cost.
   - Inventory: the position's weighted-average cost re-averages; it does not simply take the new cost.
5. [open] Reverse or void a confirmed adjustment.
   - Accounting: by reversal, never by edit — and the reversal is visible in سجل المخزون.
Done: every reason code has one, stated, balanced posting, and the reason is on the movement so a report can group by it.

## T34 · Inventory — Labels and barcodes
Modules: Inventory · Settings · Print
Executable: docs/scenarios/03 §9 · 07 §13

1. [open] الإعدادات ← إعدادات الباركود — pick the symbology and the code source.
   - Settings: the setting is tenant-wide and persists across a reload.
2. [open] المخزون ← طباعة الملصقات — print in all three sizes.
   - Print: each size renders the price, the name and a scannable barcode within its own bounds.
3. [open] Print a label for an item with a long Arabic name.
   - Print: the name wraps or truncates deliberately — it never overlaps the barcode.
4. [open] Scan a printed label at the invoice line.
   - Sales: the scan resolves to the same item the label was printed for.
Done: a label printed from this screen scans back to its own item on the till.

## T35 · Inventory — Write-downs and the aging bands
Modules: Inventory · Accounting · Reports
Executable: cross-module.ts x14

1. [ok] المخزون ← هبوط قيمة المخزون — run a write-down over the aging bands.
   - Accounting: the charge goes to the P&L through a provision account; GL 1200 keeps its gross value and the reconciliation stays exact.
2. [open] Re-run the same period.
   - Inventory: the second run charges only the incremental provision, not the whole amount again.
3. [ok] Open أعمار المخزون and انحراف تقييم المخزون.
   - Reports: the aging bands sum to the valuation total.
Done: the provision on the balance sheet equals the sum of the write-down runs, and gross stock value is never quietly rewritten.

## T36 · Manufacturing — The production floor's own screens
Modules: Manufacturing · Inventory · Reports
Executable: docs/scenarios/03 §11–14

1. [open] التصنيع ← لوحة الإنتاج — read the open work orders and their stages.
   - Manufacturing: the counts match the work-order list under the same filters.
2. [open] Raise a work order for a BOM whose components are short.
   - Inventory: the shortage is named before issue, not discovered at completion.
3. [open] Record scrap on a work order.
   - Inventory: scrapped material leaves stock at cost and is visible as scrap, not as output.
4. [open] Change a BOM that has open work orders against it.
   - Manufacturing: open orders keep the recipe they were raised with.
5. [open] التقارير ← التصنيع أم الشراء.
   - Reports: produced cost vs purchase price, per item, over a chosen window.
Done: the floor's view of what is in progress and the ledger's view of what has been consumed never contradict each other.

## T37 · Accounting — The chart of accounts as a structure
Modules: Accounting · Settings · Reports
Executable: accounting.ts · docs/scenarios/04 §دليل الحسابات

1. [ok] Add a posting account under a group account.
   - Accounting: type and nature are inherited; the code fits the parent's range.
2. [open] Try to post to a group account.
   - Accounting: refused — only leaf accounts take entries.
3. [open] Try to give a posting account with movements a child.
   - Accounting: refused, or the account is converted only when it has no entries.
4. [open] Deactivate an account that carries a balance.
   - Accounting: refused or warned — a balance cannot be hidden by deactivation.
5. [ok] Re-run the trial balance.
   - Reports: the new account appears with its movements, in code order, under the right section.
Done: the chart's shape and the financial statements' shape are the same shape.

## T38 · Accounting — Cost centres end to end
Modules: Accounting · Treasury · Reports
Executable: seams.ts x26

1. [ok] المحاسبة ← مراكز التكلفة — create two centres.
   - Accounting: codes are unique; a centre can be deactivated without deleting its history.
2. [ok] Tag a journal entry line to one of them.
   - Reports: أرباح مراكز التكلفة counts it once, and the income statement counts it once.
3. [stop D26] Pay an expense by treasury voucher and try to tag it.
   - !Treasury: there is no field — the expense lands in «غير مخصص», which is where most real spending ends up.
4. [open] Run the cost-centre P&L for a period with no tagged activity.
   - Reports: an honest empty state, not a zero-filled table.
Done: the sum of the cost centres plus «غير مخصص» equals the income statement, exactly.

## T39 · Accounting — The e-invoicing screen
Modules: Accounting · Sales · Settings
Executable: seams.ts x29 · platform.ts D5

1. [open] المحاسبة ← الفاتورة الإلكترونية — read the queue and its states.
   - Tax: submitted, accepted, rejected and pending are distinguishable, with the authority's reason on a rejection.
2. [stop D5] Turn auto-submit on and confirm a sales invoice.
   - !Tax: nothing is enqueued — the producer does not exist.
3. [open] Retry a failed submission.
   - Tax: retrying never creates a second submission for the same invoice.
4. [open] Print an invoice that has been accepted.
   - Print: the QR code and the authority's UUID are on the printed document.
Done: every confirmed invoice is either in the queue, accepted with its UUID, or explicitly excluded — with no fourth state.

## T40 · Treasury — Every voucher type, one at a time
Modules: Treasury · Accounting · Sales · Purchases · HR
Executable: cross-module.ts x0 · x2 · x3 · x11 · docs/scenarios/04 §السندات

1. [ok] Customer collection, supplier payment.
   - Accounting: each hits its own control account and the treasury account named on the voucher.
2. [ok] Capital injection, owner withdrawal.
   - Accounting: equity moves, not revenue or expense.
3. [ok] Expense payment, other income.
   - Accounting: the counter-account is chosen on the voucher and appears on the entry.
4. [ok] Employee advance, payroll disbursement.
   - HR: the advance's schedule and the payroll's net both settle through the treasury, not through a private account.
5. [ok] Treasury transfer.
   - Treasury: one entry, two treasury accounts, no net change.
6. [open] Under-collection and bounced-cheque vouchers.
   - Accounting: 1320 and 1360 carry them, and each has a documented way back out.
Done: the ten types cover every way money enters or leaves, and each one names both the treasury account and the counter-account on its face.

## T41 · Treasury — Approvals, reversal and the audit line
Modules: Treasury · Workflow · Audit
Executable: accounting.ts · platform.ts

1. [ok] Put voucher confirm behind an approval chain and confirm as a non-admin.
   - Workflow: the voucher holds as pending, and the ledger does not move.
2. [ok] Approve it.
   - Accounting: it posts once, on approval, with the approver named.
3. [ok] Reverse a confirmed voucher.
   - Accounting: the treasury, the counter-account and the trial balance return to their exact prior values.
4. [stop D30] Filter the audit log by branch for those actions.
   - !Audit: rows written by an all-branches caller carry branchId: null and never appear under their document's branch.
Done: no money moves without a named actor, and everything that moved can be walked back out the way it came in.

## T42 · HR — Employees, departments and job titles
Modules: HR · Settings · Reports
Executable: hr.ts · docs/scenarios/05 §2–4

1. [open] الأقسام — create a department, nest one under it.
   - HR: the tree is real; deleting a parent with children is refused.
2. [open] المسميات الوظيفية — create a job title and attach a salary band.
   - HR: the band is guidance on the contract form, not a second source of truth for pay.
3. [ok] الموظفون — create an employee with a code, branch, department and title.
   - HR: duplicate codes refused; the branch scopes them everywhere downstream.
4. [open] Walk the status transitions to termination.
   - HR: a terminated employee is excluded from the next payroll run and stays in history.
5. [open] لوحة الموارد البشرية — the headcount tiles.
   - Reports: the tiles equal the list counts under the same filters.
Done: one employee record drives the org tree, the payroll run and the reports without being retyped anywhere.

## T43 · HR — Contracts, holidays and attendance
Modules: HR · Reports
Executable: hr.ts · docs/scenarios/05 §5–7

1. [open] العقود — a fixed-term and an open-ended contract.
   - HR: pay, allowances and the period are on the contract, not on the employee.
2. [open] Let a fixed-term contract lapse.
   - !HR: known behaviour — it keeps reporting «ساري» past its end date.
3. [open] الإجازات الرسمية — add a public holiday inside the period.
   - HR: attendance and leave both treat it as non-working, and payroll does not deduct for it.
4. [open] الحضور والانصراف — record absence, lateness and overtime.
   - HR: each maps to a payroll consequence that the payslip names.
Done: the payslip's working days, the attendance record and the holiday calendar agree for every employee in the period.

## T44 · HR — The payroll run, state by state
Modules: HR · Accounting · Treasury
Executable: hr.ts

1. [ok] الرواتب — create a run for the month.
   - HR: مسودة, with the scope notice naming every rule this build does not compute.
2. [ok] Calculate it.
   - HR: gross − deductions = net, per payslip and for the run.
3. [ok] Approve it.
   - HR: exactly one advance instalment is recovered per employee with an open advance.
4. [ok] Disburse it.
   - Accounting: one balanced entry; the treasury falls by exactly the net.
5. [ok] Try each transition from the wrong state.
   - HR: refused in Arabic, every time.
6. [open] Re-run a month that already has an approved run.
   - HR: refused or explicitly a correction run — never a silent duplicate.
Done: the run's net, the payslips' sum, the journal entry and the treasury movement are one number in four places.

## T45 · HR — Advances and the whole leave stack
Modules: HR · Treasury · Reports
Executable: hr.ts · docs/scenarios/05 §9–14

1. [ok] سلف الموظفين — request, approve, disburse, recover.
   - Treasury: disbursement leaves the cash box; recovery comes back through payroll.
   - HR: the instalment split sums exactly, by largest remainder.
2. [open] سياسات الإجازات — define an accrual policy.
   - HR: the policy drives the balance; the balance is not typed in by hand.
3. [open] استحقاقات الإجازات — run an accrual batch.
   - HR: each employee's balance rises by the policy's rate, once, for that period.
4. [ok] طلبات الإجازات — request more days than the balance holds.
   - HR: refused with the available balance named.
5. [open] Approve an unpaid leave and run payroll.
   - HR: the deduction is prorated exactly for the days taken.
6. [open] إجازاتي — the same request from the employee's own screen.
   - HR: self-service sees only their own balances and requests.
Done: balance = accruals − approved leave, on the balances screen and inside the payroll calculation, with no third answer.

## T46 · Reports — The sales five
Modules: Reports · Sales
Executable: shell.ts SCN-RPT-*

1. [ok] المبيعات حسب الفترة.
   - Reports: the period total equals the sum of confirmed invoices minus returns for the same window.
2. [ok] المبيعات حسب العميل, حسب الصنف, حسب المندوب.
   - Reports: each grouping sums to the same grand total as the period report.
3. [ok] أفضل المنتجات — with a limit.
   - Reports: the limit narrows the rows and the ranking stays by value, not by insertion order.
4. [open] Drill from a report row to the documents behind it.
   - Reports: the drill-down lists exactly the documents the figure was built from.
Done: four ways of slicing one month all produce the same grand total, and that total equals revenue in the income statement.

## T47 · Reports — Purchases, aging and collections
Modules: Reports · Purchases · Sales · Installments
Executable: shell.ts · accounting.ts

1. [ok] المشتريات حسب الفترة / المورد / الصنف.
   - Reports: the three groupings agree on the grand total.
2. [stop D37] أعمار ديون العملاء against the dashboard's receivables tile.
   - !Dashboard: they disagree by 5,486.12 — the tile's scope is every 11xx account, the report's is trade AR.
3. [ok] أعمار ديون الموردين against GL 2100.
   - Reports: the aging total equals the payables control account, less what D18 has left adrift.
4. [ok] الأقساط المتأخرة and نظرة عامة على الأقساط.
   - Reports: the overdue list is exactly the late lines; the overview's outstanding equals the plans' remaining.
Done: every aging bucket is a slice of a control account, and the sum of the buckets is that account.

## T48 · Reports — The eight inventory reports
Modules: Reports · Inventory
Executable: shell.ts SCN-RPT-16 · inventory.ts

1. [ok] مستويات المخزون and أرصدة المخزون.
   - Reports: the same on-hand quantity per item and warehouse, under the same scope.
2. [ok] حركة المخزون and سجل المخزون.
   - Reports: every movement has a document behind it, and the running balance ends at today's on-hand.
3. [ok] تقييم المخزون against GL 1200.
   - Reports: equal, to the piastre, on a tenant with no open receipts.
4. [ok] أعمار المخزون, أصناف قاربت على الانتهاء, أصناف بطيئة الحركة.
   - Reports: the three answer over the same population and never disagree about what is on hand.
5. [stop D36] انحراف تقييم المخزون with the type filter.
   - !Reports: cacheDrift is nonzero on a healthy tenant because landed costs write no movement.
Done: eight reports over one sub-ledger, and the valuation total equals the control account.

## T49 · Reports — How a report behaves, not what it says
Modules: Reports · Shell · Print
Executable: shell.ts

1. [open] Run every report with no filters, then with a narrow date window.
   - Reports: the narrow run is a subset; the totals row recomputes rather than staying stale.
2. [open] Pick a preset (this month, last month, this year) on each report.
   - Reports: the dates the preset sets are visible and editable, not hidden.
3. [open] Run a report over a window with no data.
   - Reports: an honest empty state, not a zero-filled table pretending to be a result.
4. [open] Export to Excel and print.
   - Print: the export carries the same rows and totals as the screen, with Arabic intact.
5. [open] Reload a report screen by URL.
   - Shell: the filters and the result come back, because they are in the address.
Done: what you see, what you export and what you print are the same report.

## T50 · Settings — Company, branches and warehouses
Modules: Settings · Shell · Accounting
Executable: platform.ts · docs/scenarios/07 §4–6

1. [open] الإعدادات ← عام — company identity, tax number, base currency, fiscal year start.
   - Print: the identity reaches the printed invoice; the tax number appears where the law requires it.
2. [open] Change the base currency after documents exist.
   - Accounting: refused, or an explicit, warned migration — never a silent relabel.
3. [ok] الفروع — add a branch, deactivate one.
   - Shell: the picker updates; a deactivated branch keeps its history.
4. [ok] المستودعات — add one under a branch, of each type (main, transit, van).
   - Inventory: the type decides where transfers may land; a van warehouse pairs with a van treasury.
5. [stop D7] Scope a user to one branch and read the other's documents.
   - !Shell: nothing narrows — branch scope is not enforced on the read routes.
Done: the branch a document was raised in is on the document, in the audit row, and in every scoped list — or the scope is honestly labelled as not yet enforced.

## T51 · Settings — Users, roles and the permission matrix
Modules: Settings · Audit · Every module
Executable: platform.ts · seams.ts x58

1. [ok] الأدوار والصلاحيات — build a role from the ~268-permission matrix.
   - Settings: the dependency graph is enforced — granting confirm implies view.
2. [ok] المستخدمون — create a user, assign the role, set branch and warehouse scope.
   - Settings: the PIN is set by the user, and the role can be changed without recreating them.
3. [ok] Sign in as that user and hit a guarded route.
   - Every module: 403 without the permission, and the action is hidden rather than dead on the screen.
4. [stop D31] Give a user only the view tier and read a colleague's invoice and its unit cost.
   - !Every module: the visibility tiers are enforced by no route — view_own and view_cost are decorative.
5. [open] Remove a permission from a role while its holder is signed in.
   - Settings: the next request is refused; a stale session does not keep the old rights.
Done: every screen a user can reach is one their role grants, and every refusal is a 403 from the server, not a hidden button.

## T52 · Settings — Numbering, print templates and barcode
Modules: Settings · Print · Every document
Executable: platform.ts · seams.ts x56 · x57

1. [ok] تسلسلات الترقيم — change a prefix and a padding length.
   - Every document: the next document takes the new format; posted documents keep theirs.
2. [ok] Confirm eight documents at once.
   - Every document: eight distinct, gap-free numbers, and a failed confirm burns none.
3. [stop D33] Sell from two branches on the same day.
   - !Settings: one tenant-wide counter, and nothing on the number says which branch raised it.
4. [open] قوالب الطباعة — the nine template tabs and a per-document override.
   - Print: the override wins for that document only; the tab's setting is the default for the rest.
5. [open] Print A4 and thermal for the same invoice.
   - Print: both carry the legal content, both render Arabic offline, and the thermal receipt fits its width.
Done: a document's number and its printed face are both decided by settings a tenant can see and change, not by code.

## T53 · Settings — Integrations, notifications and keys
Modules: Settings · Platform · Audit
Executable: platform.ts · seams.ts x30

1. [ok] مفاتيح API — issue a key, use it, revoke it.
   - Platform: the key is shown once; a revoked key is refused immediately.
2. [ok] الويب هوك — subscribe to an emitted event, then to one that is not emitted.
   - Platform: only emitted events may be subscribed to.
3. [ok] Confirm a document and watch the delivery.
   - Platform: retries are bounded, and a failing webhook never rolls back or duplicates the document.
4. [ok] قواعد الإشعارات — a rule on document confirm.
   - Shell: the bell count and the panel agree, and mark-all-read sticks across a reload.
5. [open] Delete a rule that has fired.
   - Platform: past notifications survive the rule's deletion.
Done: an integration can fail loudly without ever changing what the ledger says.

## T54 · Settings — Migration, backup and the licence
Modules: Settings · System · Accounting
Executable: platform.ts D16 · cross-module.ts x31 · x32 · x38

1. [ok] نقل البيانات — import a file with one bad row.
   - Settings: all-or-nothing — nothing is committed, and the bad row is named.
2. [stop D23] Import outstanding customer and supplier invoices.
   - !Accounting: AR and AP move by 0.00 — the opening entry's branch never runs because the import is wired without gl/accounts.
3. [open] النظام ← حالة النظام — take a backup, restore it into a fresh install.
   - System: the restored tenant produces the same trial balance, to the piastre.
4. [stop x38] Remove a module from the licence and use it.
   - !System: it answers anyway — entitlement is designed but not enforced.
5. [open] Run the app with the licence expired.
   - System: a clear, Arabic, non-destructive block — never data loss and never a silent read-only mode.
Done: a tenant can leave with their data and come back with it, and the books survive the round trip unchanged.

## T55 · Workflow — The approvals inbox
Modules: Workflow · Sales · Treasury · Audit
Executable: platform.ts

1. [ok] إعدادات الموافقات — a chain on sales-invoice confirm and on voucher confirm.
   - Workflow: the chain names the step, the approver role and the order.
2. [ok] Submit as a non-admin and approve.
   - Sales: the document posts once, on approval, with the approver on the audit row.
3. [ok] Reject, and request a modification.
   - Workflow: rejection is terminal for that submission; a modification request returns it to the author with the note.
4. [stop D8] Approve as an admin.
   - !Workflow: the chain is bypassed entirely.
5. [ok] الموافقات — the inbox, its counts and its filters.
   - Shell: the inbox count equals the pending requests the user may act on.
Done: nothing behind a chain posts without an approval, and every approval names a person.

## T56 · Shell — Navigation, URLs and state that survives a reload
Modules: Shell
Executable: shell.ts SHL-01..06

1. [ok] Open every nav entry and check the heading matches.
   - Shell: 17 groups, every item reaches a real screen — none dead-ends.
2. [ok] Collapse a group, collapse the rail, reload.
   - Shell: both persist; the active item stays indicated.
3. [ok] Deep-link to a document, a create form and a report.
   - Shell: all three reload into the same state, and Back returns to the list.
4. [ok] Change the branch and warehouse scope and reload.
   - Shell: the scope persists, and the warehouse list cascades from the branch.
Done: the address bar describes the screen well enough to send it to a colleague.

## T57 · Shell — Keyboard, command bar and search
Modules: Shell
Executable: shell.ts SHL-07..16

1. [ok] ⌘K from anywhere.
   - Shell: the command bar focuses, filters as you type and routes with the keyboard alone.
2. [ok] `?` for the shortcut list, `g` + letter to jump, ⌘N to create, ⌘S to save.
   - Shell: ⌘S never surfaces the browser's own Save dialog.
3. [open] `j`/`k` on a table.
   - Shell: currently dead — either wire it or drop it from the shortcut list.
4. [ok] Type into a text field and press `g`.
   - Shell: the literal character wins; shortcuts do not fire while typing.
5. [stop D32] Search a customer by an Arabic name without its hamza.
   - !Shell: no result — no server-side search, and no Arabic normalisation on either side.
Done: a data-entry clerk can raise a document without touching the mouse, and the search finds what they typed.

## T58 · Shell — Theme, language and RTL
Modules: Shell · Settings
Executable: shell.ts SHL-17..18 · docs/scenarios/07 §1–2

1. [ok] Toggle the theme on every module's list and detail.
   - Shell: both themes are legible; no token resolves to a colour that only exists in one of them.
2. [ok] Switch to English and back.
   - Shell: direction flips live, the nav re-labels without a reload, and the choice persists.
3. [open] Check numerals, dates and currency in both languages.
   - Shell: Arabic-Indic vs Latin numerals are a deliberate choice, applied consistently, and dates never silently switch order.
4. [open] Check a mixed Arabic/Latin string — a code inside an Arabic sentence.
   - Shell: bidi is correct; the code does not jump to the wrong end of the sentence.
Done: nothing in either theme or either language is unreadable, mirrored the wrong way, or left in the other language.

## T59 · Dashboard — Every tile against its source
Modules: Dashboard · Accounting · Sales · Purchases · Reports
Executable: shell.ts DSH-01..12 · cross-module.ts x17

1. [ok] The KPI strip against /dashboard/summary and the ledger.
   - Accounting: cash and payables agree with the accounts they claim to summarise.
2. [stop D37] Receivables against أعمار ديون العملاء.
   - !Dashboard: 47,079.28 vs 52,565.40 — the tile's scope is every 11xx account.
3. [ok] The period toggle.
   - Dashboard: every figure that depends on the period changes, and none that should not.
4. [ok] The aging matrix, the expense donut and the top-items list.
   - Reports: each equals its own report under the same window.
5. [ok] The needs-attention queue.
   - Dashboard: each row links to a screen whose filtered count is the number on the tile.
6. [open] The error and retry state.
   - Dashboard: with the API down, an honest failure and a retry that works — never a zeroed dashboard.
Done: every number on the dashboard can be reproduced on another screen in two clicks.

## T60 · Hubs — The nine overview screens
Modules: Shell · Every module
Executable: shell.ts HUB-01..10

1. [open] Open each hub: sales, purchases, inventory, manufacturing, accounting, treasury, CRM, assets, production, system.
   - Shell: each hub's tiles equal its module's list counts under the same scope.
2. [open] Click through every hub tile.
   - Shell: each lands on the screen it names, pre-filtered to what the tile counted.
3. [open] Read each hub with an empty tenant.
   - Shell: honest zeros and a way to create the first record.
Done: a hub is a filtered view of its module, never a second set of numbers.

## T61 · Every document — Draft, confirm, cancel, void
Modules: Sales · Purchases · Inventory · Treasury · Accounting
Executable: sales.ts · purchases.ts · accounting.ts

1. [open] For each of the twelve document types, save a draft and reload.
   - Every module: the draft persists with every field, and nothing has posted.
2. [ok] Confirm each one.
   - Accounting: exactly one balanced entry, one number issued, one set of movements.
3. [ok] Confirm each one a second time.
   - Every module: 409, and no second entry.
4. [open] Cancel a draft, and try to cancel a confirmed document.
   - Every module: a draft cancels cleanly; a confirmed one is corrected by return, reversal or void — never by edit and never by delete.
5. [open] Void a confirmed document where voiding exists.
   - Accounting: the reversal is a new entry that references the original, and both remain readable.
6. [open] Delete anything at all.
   - Accounting: there is no delete for a posted document, anywhere, for anyone.
Done: the twelve lifecycles behave identically at their common states, and the ledger only ever grows.

## T62 · Concurrency — Two people, one second
Modules: Every module · Accounting · Settings
Executable: seams.ts x56 · cross-module.ts x35

1. [ok] Fire eight confirms simultaneously on eight documents.
   - Settings: eight distinct, gap-free numbers.
2. [ok] Retry the same confirm with the same request id.
   - Accounting: one journal entry, one stock movement — the retry is idempotent, not a second posting.
3. [open] Two users edit the same draft.
   - Every module: the second save is refused or merged deliberately — never a silent overwrite.
4. [open] Two tills sell the last unit of one item at the same moment.
   - Inventory: one succeeds, one is refused; stock never goes negative behind the guard.
Done: no sequence of simultaneous actions can produce a duplicate number, a duplicate posting or negative stock.

## T63 · Money — Rounding as a property, not an example
Modules: Accounting · Sales · Purchases
Executable: seams.ts x52 · cross-module.ts x34

1. [ok] Post forty awkward documents — odd quantities, odd rates, line and header discounts.
   - Accounting: every one balances to the piastre; the allocations sum exactly to their totals.
2. [ok] Allocate a header discount across three lines that do not divide evenly.
   - Accounting: largest-remainder — the parts sum to the whole, and the same input always allocates the same way.
3. [open] Check any money value rendered anywhere for float artefacts.
   - Shell: no 478.79999, no 0.1+0.2 — money crosses the wire as a decimal string and is parsed as Money.
4. [open] Set the tenant's rounding to the nearest 5 piastres, if the setting exists.
   - Accounting: rounding happens only at the named boundaries, and the difference lands in a rounding account rather than vanishing.
Done: the sum of the lines equals the header, the sum of the allocations equals the payment, and no report has to be told which figure to believe.

## T64 · Volume — Five years of data on a shop laptop
Modules: Every module · Reports · System
Executable: seams.ts x54 (design) — measure, do not guess

1. [open] Seed five years: ~60k invoices, ~200k journal lines, ~15k items.
   - System: the database file size and the backup time are recorded, not assumed.
2. [open] Open every list screen.
   - Shell: first paint under two seconds, with paging or virtualisation — never the whole table.
3. [open] Run the trial balance, the general ledger and the inventory valuation.
   - Reports: each answers in seconds, and the query plan uses an index rather than a scan.
4. [open] Confirm a document.
   - Accounting: posting latency does not grow with history — numbering and posting are indexed, not scanned.
5. [open] Restart the app.
   - System: startup time is unchanged from an empty tenant, within reason.
Done: the fifth year feels like the first, on the machine the desktop edition actually ships to.

## T65 · Desktop — Genuinely offline
Modules: System · Every module · Print
Executable: manual, on the packaged build

1. [open] Pull the network and do a full day: sell, buy, pay, report, print.
   - Every module: nothing hangs, nothing silently fails, no spinner waits on a server that is not there.
2. [open] Confirm an invoice with auto-submit to the authority switched on.
   - Tax: it queues and says so — the only thing that may not complete offline, stated plainly.
3. [open] Reload the packaged app from file://.
   - Shell: hash routing survives; no route 404s because a dev server is not there to rewrite it.
4. [open] Kill the app mid-confirm.
   - Accounting: on restart, either the document posted completely or not at all.
Done: the shop keeps trading with the internet down, and the books are intact when it comes back.

## T66 · System — Backup, restore and the one machine that holds the books
Modules: System · Settings · Accounting
Executable: manual

1. [open] Take a backup while the app is in use.
   - System: consistent, timestamped, and the size is stated before it is written.
2. [open] Restore it into a clean install.
   - Accounting: same trial balance, same document numbers, same audit rows.
3. [open] Restore a backup taken on an older version.
   - System: migrations run on restore, or the restore is refused with the version named — never a half-migrated tenant.
4. [open] Two tills on a LAN against one machine.
   - System: both post to the same books; the second till's numbers are gap-free and its documents carry its own user.
Done: the business can lose the machine and not the year.

## T67 · Accessibility — A keyboard-only day
Modules: Shell · Every module
Executable: manual, plus the a11y agent

1. [open] Raise an invoice using the keyboard alone.
   - Shell: every field is reachable in a sane order, every control has a visible focus ring, and no trap holds the tab.
2. [open] Check every form field has a real label.
   - Shell: an accessible name on each input — not a floating caption div.
3. [open] Read a document screen with a screen reader in Arabic.
   - Shell: headings are a real outline, status pills announce their state, and the table has headers.
4. [open] Check contrast in both themes on the busiest screens.
   - Shell: every text/background pair passes; anything failing on every screen is the measurement, not the product.
5. [open] Check target sizes and motion.
   - Shell: touch targets are large enough for a counter, and prefers-reduced-motion is honoured.
Done: the fastest way to use Mezan is the keyboard, and nothing on any screen is unreachable without a mouse.

## T68 · Localisation — Arabic first, English second
Modules: Shell · Every module · Print
Executable: scripts/i18n · docs/scenarios/07 §1

1. [open] Walk every screen in Arabic looking for a raw catalogue key or an English fragment.
   - Shell: none — a raw key on screen is a defect, not a cosmetic issue.
2. [open] Walk the same screens in English.
   - Shell: no untranslated Arabic left behind, and the layout survives longer English strings.
3. [open] Check the accounting register in Arabic.
   - Shell: مدين/دائن, قيد, ترحيل, مرتجع — the words an Egyptian accountant uses, consistently, screen to screen.
4. [open] Check a domain refusal in both languages.
   - Every module: the error is a sentence a user can act on, never a raw enum like PERIOD_NOT_OPEN_FOR_POSTING.
5. [open] Print an invoice in both languages.
   - Print: Arabic shapes and joins correctly in the PDF, offline, with no boxes.
Done: an Arabic-first product that never leaks its plumbing in either language.

## T69 · Security — What a dishonest employee can do
Modules: Security · Settings · Audit · Every module
Executable: manual, plus the security and internal-audit agents

1. [open] Read the SQLite file directly.
   - Security: what is readable at rest is a deliberate decision, and the licence and session material are not sitting in plain text next to it.
2. [open] Fail the PIN repeatedly.
   - Security: lockout or backoff — a four-digit PIN with unlimited attempts is not a credential.
3. [open] Call the API with another user's key and a wider scope header.
   - Security: the server decides the scope from the session, never from a header the client can set.
4. [open] Backdate a document into an open period as a clerk.
   - Audit: allowed only with the permission, and the audit row shows both the document date and the entry time.
5. [open] Delete or edit a posted entry by any route you can find.
   - Accounting: impossible — and the attempt is in the audit log.
6. [open] Give a discount above the allowed ceiling, then look for the exception report.
   - Audit: overrides are reportable; if no report exists, that is the finding.
Done: everything a person can do to the money is either impossible, permissioned, or on a report someone reads.

## T70 · Seed and empty states — Nothing untestable, nothing invented
Modules: Every module
Executable: pnpm check:seed

1. [ok] Run pnpm check:seed.
   - Every module: every list endpoint returns rows — an empty list surface is a finding, not a starting point.
2. [open] Create a fresh tenant with no seed and open every screen.
   - Shell: every empty state says what is missing and offers the action that fixes it.
3. [open] Look for any figure on any screen that is not traceable to a record.
   - Every module: no placeholder, no illustrative number, no "coming soon" figure dressed as data.
Done: every screen is either populated from the API or honestly empty, and no number on any screen was invented by the front end.

## T71 · Failure — When the API is not there
Modules: Shell · Every module
Executable: manual

1. [open] Stop the server and open every list screen.
   - Shell: a stated error and a retry that works, never an empty table that looks like no data.
2. [open] Fail a confirm mid-flight.
   - Every module: the button returns to its normal state, the document is unchanged, and the message says what to do.
3. [open] Submit a form that the server rejects with a validation error.
   - Shell: the field-level message appears next to the field, in Arabic.
4. [open] Lose the connection while a report is running.
   - Reports: the report says it failed; it does not show yesterday's numbers under today's filters.
Done: no failure is silent, and no failure leaves a screen showing something that is not true.

## T72 · Compliance — What an Egyptian invoice must carry
Modules: Tax · Print · Sales
Executable: docs/catalog · the tax and print agents

1. [open] Print a confirmed sales invoice.
   - Print: seller and buyer names, both tax numbers, the invoice number and date, the line detail, the VAT rate and amount, and the total in words where required.
2. [stop D5] Check the e-invoice UUID and QR on an accepted document.
   - !Tax: nothing is submitted, so nothing comes back to print.
3. [open] Print a B2C receipt on the thermal printer.
   - Print: within 72 hours the e-receipt rules apply — the receipt carries what they require or the product says it does not.
4. [stop D27] Pay a local B2B supplier subject to withholding.
   - !Tax: no withholding concept exists — the payment cannot be split between supplier and authority.
5. [stop D29] File a VAT period, then post into it.
   - !Tax: nothing records the filing, so the restatement is silent.
Done: every document a tax inspector could ask for prints from this product, complete, in Arabic, offline.

## T73 · Onboarding — First run to first invoice
Modules: Settings · Accounting · Inventory · Sales
Executable: the implementation-consultant path

1. [open] Start the setup wizard on an empty database.
   - Settings: company, branch, warehouse, fiscal year, currency, chart of accounts — in that order, each one explained.
2. [open] Import the customer, supplier and item lists.
   - Settings: a template to fill, an all-or-nothing commit, and a report of what was created.
3. [stop D23] Enter opening balances — cash, bank, stock, AR, AP.
   - !Accounting: the AR/AP half of the import posts nothing; only a manual opening journal entry gets them onto the books today.
4. [open] Check the opening trial balance.
   - Accounting: it balances, and it equals the balances the client gave you.
5. [open] Raise the first real invoice.
   - Sales: numbering starts where the client's old system stopped, because تسلسلات الترقيم was set during setup.
Done: a client can be live in a day, with an opening trial balance that ties to the books they arrived with.

## T74 · Month end — What the accountant actually does
Modules: Accounting · Treasury · Inventory · Reports
Executable: the accountant path

1. [open] Reconcile the bank for the month.
   - Treasury: every statement line matched or explained.
2. [ok] Run مطابقة الأرصدة for AR, AP and inventory.
   - !Accounting: the three known gaps (D1/D40, D18, D2/D3) are the only differences — anything else is new.
3. [open] Post accruals and prepayments.
   - Accounting: manual entries with a reversal date, and the reversal actually posts next period.
4. [ok] Run the VAT return and pay it.
   - Tax: output − input = the payment, and paying clears both sides.
5. [open] Close the period.
   - Accounting: every module refuses to post into it afterwards — and the purchase-invoice route must stop answering 500 (D20).
6. [ok] Produce the pack: trial balance, income statement, balance sheet, cash flow.
   - Reports: all four tie to each other and to the ledger.
Done: the month closes in an afternoon, and every figure in the pack can be walked back to a document.

## T75 · Year end — Can this be signed?
Modules: Accounting · Audit · Reports
Executable: the chartered-accountant path

1. [stop D34] Run the year-end close.
   - !Accounting: there is no close — no closing entry and no posting to retained earnings.
2. [open] Produce the statutory statements for the year.
   - Reports: they balance, but retained earnings is derived by the report rather than carried by the ledger.
3. [open] Trace ten sampled figures back to their documents.
   - Audit: each has an entry, an actor, a timestamp and an unbroken chain to the source document.
4. [open] Look for anything that changed after it was posted.
   - Accounting: nothing — corrections are reversals, and the audit log shows both.
5. [open] Ask what a auditor would qualify.
   - Audit: the year-end close, the sub-ledger gaps and the missing withholding are the honest list.
Done: the statements can be signed, or the exact reasons they cannot are written down and tracked.

## T76 · Owner — The five-minute review
Modules: Dashboard · Reports
Executable: the owner path

1. [ok] Open the dashboard and read the day.
   - Dashboard: cash, receivables, payables, profit — four numbers, no jargon.
2. [stop D37] Ask why receivables differs from the aging report.
   - !Dashboard: it does, by 5,486.12, and nothing on the screen explains the scope difference.
3. [open] Ask which customer owes the most and which item makes the most margin.
   - Reports: two clicks each, from the dashboard.
4. [open] Ask what changed since last month.
   - Dashboard: the period toggle answers it without exporting anything.
Done: an owner who opens Mezan once a day learns something true in under five minutes.

## Coverage map

| Nav group / concern | Trails |
|---|---|
| سير العمل (approvals) | T25, T55 |
| المبيعات | T01, T02, T03, T27, T29, T46 |
| المشتريات | T04, T05, T06, T28, T30, T47 |
| المخزون | T07, T08, T31, T32, T33, T34, T35, T48 |
| التصنيع | T09, T36 |
| المحاسبة | T10, T11, T12, T13, T17, T18, T37, T38, T39 |
| الخزينة | T14, T15, T40, T41 |
| الأوراق المالية | T16 |
| إدارة علاقات العملاء | T19 |
| الموارد البشرية | T20, T42, T43, T44, T45 |
| المشاريع | T21 |
| الأصول الثابتة | T22 |
| المبيعات الميدانية | T23 |
| الأقساط | T24, T47 |
| التقارير | T12, T46, T47, T48, T49 |
| الإعدادات | T25, T50, T51, T52, T53, T54 |
| النظام | T54, T64, T65, T66 |
| Shell / لوحة التحكم / hubs | T26, T56, T57, T58, T59, T60 |
| Cross-cutting: lifecycles, concurrency, money, failure | T61, T62, T63, T71 |
| Non-functional: volume, offline, a11y, i18n, security | T64, T65, T67, T68, T69 |
| Data honesty and compliance | T70, T72 |
| Role journeys: consultant, accountant, auditor, owner | T73, T74, T75, T76 |

## What a trail is worth

A module scenario asks "does this screen do what it says". A trail asks "does the
rest of the product agree with what this screen just did" — and that is the
question that found D39, D40, D41 and D42 in one afternoon, none of which any
screen-level test could have seen, because every screen involved answered 200 and
looked right.
