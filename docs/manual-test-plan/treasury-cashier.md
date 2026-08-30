# Manual test plan — Treasury / Cashier (أمين الخزنة)

Grounded against the running code: `apps/web/src/screens/TreasuryVouchersScreen.tsx`,
`ChequesScreen.tsx`, `TreasuryAccountsScreen.tsx`, `EmployeeAdvancesScreen.tsx`,
`BankReconciliationScreen.tsx`, `ReconciliationScreen.tsx`, `CustomersScreen.tsx`;
`packages/api/src/vouchers-routes.ts`, `cheques-routes.ts`, `treasury-accounts-routes.ts`,
`bank-reconciliation-routes.ts`, `hr-payroll-routes.ts`, `reports-routes.ts`; domain in
`packages/domain/src/vouchers/*`, `cheques/*`, `bank-reconciliation/*`; and the demo seed
`packages/backend/src/demo-seed/treasury.ts` + `hr.ts` + `access.ts`.

All scenarios assume the seeded demo tenant (`MEZAN_SEED_DEMO=1`, tenant "Cyag"), signed
in as **أمين الخزنة** (role code `TREASURY_CASHIER`) unless a scenario says otherwise. Seed
fixtures used throughout: treasury accounts `TR-DEMO-CASH` (الخزينة الرئيسية / 1300-1),
`TR-DEMO-BANK` (البنك الأهلي — جاري / 1310), `TR-DEMO-VAN` (عهدة نقدية - عربة التوزيع); customers
`CUST-DEMO-1` (شركة الأمل للتجارة), `CUST-DEMO-2`, `CUST-DEMO-3` (مجموعة الفجر التجارية);
suppliers `SUPP-DEMO-1` (مصنع الوادي الأخضر), `SUPP-DEMO-2` (شركة سياج للصناعات); invoices
`INV-DEMO-1`, `PI-DEMO-1`; vouchers `VCH-DEMO-1..6`, `VCH-DEMO-WHT`,
`VCH-DEMO-UNALLOC-IN/OUT`; cheques `CHQ-DEMO-1..5`; bank statement `BSTMT-DEMO-1`; advances
`ADV-DEMO-1..5`.

---

## Treasury vouchers — the 11 types (سند قبض / سند صرف)

### MTP-TRS-01 — Collect cash from a customer against an open invoice
- **Persona / permission:** أمين الخزنة (`treasury.cash_voucher.create`, `.confirm`)
- **Preconditions:** seeded demo tenant. `INV-DEMO-1` (customer `CUST-DEMO-1`) has an
  outstanding balance after `VCH-DEMO-1`'s existing allocation.
- **Steps:**
  1. Open **السندات النقدية**, click **"سند جديد"**.
  2. Pick type **"تحصيل من عميل"**.
  3. Set العميل = شركة الأمل للتجارة, حساب الخزينة = TR-DEMO-CASH, طريقة الدفع = نقدي, and an
     amount below `INV-DEMO-1`'s remaining outstanding (read it off `GET /open-invoices`
     or the invoice screen first).
  4. Click **"إنشاء وتأكيد"**.
  5. On the confirmed voucher's detail page, open the allocation tab and allocate the
     full voucher amount to `INV-DEMO-1`.
- **Expected:** voucher status **"مؤكد"**; GL posts Dr 1300-1 (cash) / Cr 1105 (AR) for
  the exact voucher amount; `INV-DEMO-1`'s outstanding on `GET /open-invoices` drops by
  exactly the allocated amount — the allocation total must equal the drop in the
  invoice's outstanding, not just be "some allocation exists".
- **False pass:** the voucher shows "مؤكد" and a green toast, but the officer never opens
  the allocation tab — the voucher then sits in the "محتاج تخصيص" queue and the invoice
  still reads fully outstanding on every AR report.

### MTP-TRS-02 — Pay a supplier by bank transfer against an open bill
- **Persona / permission:** أمين الخزنة
- **Preconditions:** `PI-DEMO-1` (supplier `SUPP-DEMO-1`) has outstanding after
  `VCH-DEMO-3`'s existing allocation.
- **Steps:**
  1. New voucher, type **"دفع لمورد"**.
  2. المورّد = مصنع الوادي الأخضر, حساب الخزينة = TR-DEMO-BANK, طريقة الدفع = بنكي, amount ≤
     remaining outstanding.
  3. **"إنشاء وتأكيد"**, then allocate to `PI-DEMO-1`.
- **Expected:** Dr 2100 (AP) / Cr 1310 (bank) for the voucher amount; `PI-DEMO-1`
  outstanding on `GET /open-invoices?kind=purchase&partyId=SUPP-DEMO-1` falls by exactly
  the allocated amount.
- **False pass:** confirming without allocating still reduces the bank balance
  correctly — the money side is fine, but the supplier's own bill still reads unpaid.

### MTP-TRS-03 — Refund a customer
- **Persona / permission:** أمين الخزنة (`treasury.cash_voucher.create` — the
  `treasury.customer_refund.*` permission codes exist in the catalogue but no route
  or screen reads them; the generic voucher gate is what actually controls this).
- **Steps:** New voucher, type **"رد مبلغ لعميل"**, customer `CUST-DEMO-2`, treasury
  TR-DEMO-CASH, any positive amount, **"إنشاء وتأكيد"**.
- **Expected:** posts even though `CUST-DEMO-2` has no credit balance — Dr 1105 (AR,
  increasing what they owe) / Cr 1300-1. The customer's AR balance goes UP by the
  refund amount, not down.
- **False pass:** the voucher confirms cleanly and reads as "refund processed" — nothing
  on screen states that a refund with no prior credit just created new customer debt.
  Cross-check `CUST-DEMO-2`'s كشف حساب closing balance before and after: it must move by
  exactly the refund amount, in the wrong direction for a "refund".

### MTP-TRS-04 — Receive a contracting customer's advance (دفعة مقدمة)
- **Steps:** New voucher, type **"دفعة مقدمة من عميل مقاولات"**, customer `CUST-DEMO-3`,
  treasury TR-DEMO-BANK, amount 5,000.00, **"إنشاء وتأكيد"**.
- **Expected:** posts to **2160** (customer advances liability), never to 4100 revenue —
  the counterpart account is fixed and not user-editable. Confirm on the voucher detail
  "ماذا يفعل هذا السند" panel that the counterpart line names 2160.
- **False pass:** the amount lands in the customer's AR/collections total on a report
  that does not distinguish 1105 from 2160 — the two are different accounts and a
  contracting advance must never look like a paid invoice.

### MTP-TRS-05 — Receive cash back from a supplier (استرداد من مورد)
- **Steps:** New voucher, type **"استرداد من مورد"**, supplier `SUPP-DEMO-2`, treasury
  TR-DEMO-CASH, amount 500.00, **"إنشاء وتأكيد"**.
- **Expected:** Dr 1300-1 / Cr 2100 — increases cash and reduces (or reverses)
  `SUPP-DEMO-2`'s payable.

### MTP-TRS-06 — Record other income not tied to an invoice
- **Steps:** New voucher, type **"إيراد آخر"**, no customer/supplier, treasury
  TR-DEMO-BANK, memo "فوائد بنكية", amount 120.00, **"إنشاء وتأكيد"**.
- **Expected:** Dr 1310 / Cr 4910 (sundry income) by default.

### MTP-TRS-07 — Record another expense not tied to a supplier (already in seed)
- **Preconditions:** `VCH-DEMO-5` — "مصروف نقل ومناولة بضاعة", 350.00, cash, confirmed.
- **Steps:** Open `VCH-DEMO-5` from the list, confirm its status is **"مؤكد"** and its
  effects panel names Dr 5200 (freight) / Cr 1300-1.
- **Expected:** the two match exactly; TR-DEMO-CASH's live balance on حسابات الخزينة
  reflects the 350.00 outflow.

### MTP-TRS-08 — Partner injects capital
- **Steps:** New voucher, type **"ضخ رأس مال من الشريك"**, treasury TR-DEMO-BANK, amount
  10,000.00, **"إنشاء وتأكيد"**.
- **Expected:** Dr 1310 / Cr **3100** (capital), never 3200 (drawings) or 4xxx (revenue).

### MTP-TRS-09 — Partner draws money out
- **Steps:** New voucher, type **"سحب شخصي للشريك"**, treasury TR-DEMO-CASH, amount
  2,000.00, **"إنشاء وتأكيد"**.
- **Expected:** Dr **3200** (drawings, contra-equity) / Cr 1300-1 — never posted as an
  expense (5xxx). Distinguish from **3210**, the *opening-balance* equity account used
  when a treasury account is first funded (`OPENING_BALANCE_EQUITY_ACCOUNT` in
  `TreasuryAccountsScreen.tsx`) — the two must never be confused on the trial balance.

### MTP-TRS-10 — Pay the tax authority
- **Steps:** New voucher, type **"دفع لمصلحة الضرائب"**, treasury TR-DEMO-BANK, amount
  4,180.00 (matches `VATF-DEMO-2026-05`'s filed net), **"إنشاء وتأكيد"**.
- **Expected:** Dr **2200** (output VAT payable) / Cr 1310 — settles the payable, never
  posts as an expense. The voucher does NOT validate the amount against the VAT filing
  `VATF-DEMO-2026-05`; a mismatched amount posts anyway (see MTP-TRS-19 for the abuse
  path).

### MTP-TRS-11 — Transfer between two treasury accounts (already in seed)
- **Preconditions:** `VCH-DEMO-6` — 2,000.00, TR-DEMO-CASH → TR-DEMO-BANK, confirmed.
- **Steps:** Open `VCH-DEMO-6`; separately open حسابات الخزينة and note both accounts'
  live balances; open the السندات النقدية KPI strip and note "إجمالي المقبوضات"/"إجمالي
  المدفوعات".
- **Expected:** TR-DEMO-CASH's live balance is 2,000.00 lower than it would be without
  this voucher, TR-DEMO-BANK's is 2,000.00 higher, and the voucher list's receipts/
  payments totals do **not** include this 2,000.00 on either side (a transfer moves
  money between the business's own accounts — it is neither income nor expense).
- **False pass:** the KPI strip's "صافي" (net) figure moves by 2,000.00 because of this
  voucher — it should not, since a transfer is excluded from both totals.

### MTP-TRS-12 — Supplier payment with Egyptian withholding tax (already in seed)
- **Preconditions:** `VCH-DEMO-WHT` — 2,000.00 gross, 3% (60.00) withheld, confirmed.
- **Steps:** Open `VCH-DEMO-WHT`. Check the withholding tax report
  (**Financial Reports → ضريبة الخصم**) for a row against `SUPP-DEMO-2`.
- **Expected:** `SUPP-DEMO-2`'s AP is credited the FULL 2,000.00 (fully settled for that
  bill), but only **1,940.00** leaves TR-DEMO-BANK; 60.00 posts to 2210 (withholding
  payable). Two numbers must agree: (2,000 owed to supplier as settled) = (1,940 cash
  out) + (60 withheld). The cash-negative guard on this voucher checks the balance
  against the 1,940.00 that actually leaves, not the 2,000.00 gross.
- **False pass:** the withholding report shows the 60.00 but the bank's live balance
  dropped by the full 2,000.00 — the two figures (bank movement vs. gross voucher
  amount) must differ by exactly the withheld amount, never match.

### MTP-TRS-13 — Voucher confirms with no cost centre
- **Steps:** New voucher, type **"مصروف آخر"**, treasury TR-DEMO-CASH, amount 80.00,
  leave **مركز التكلفة** unset, **"إنشاء وتأكيد"**.
- **Expected:** confirms without error — cost centre is optional at both the wire
  contract (`createVoucherSchema`) and the domain `validate()`.
- **False pass:** none — this is a genuine gap, not a false pass. Open
  **تقارير مراكز التكلفة** (Cost Center P&L) afterward: this voucher's 80.00 either
  vanishes from every cost-centre bucket or lands in an "unassigned" bucket with no
  clear label — either way, whoever reviews cost-centre spend cannot see it.

---

## Voucher lifecycle mechanics

### MTP-TRS-14 — Cannot allocate more than the invoice's outstanding
- **Preconditions:** a confirmed, unallocated receipt voucher for `CUST-DEMO-3` —
  `VCH-DEMO-UNALLOC-IN` (2,500.00).
- **Steps:**
  1. Read `INV-DEMO-3`'s current outstanding from `GET /open-invoices?kind=sales&partyId=CUST-DEMO-3`.
  2. On `VCH-DEMO-UNALLOC-IN`'s allocation tab, enter an amount 1.00 EGP **above** that
     outstanding and submit **"تخصيص"**.
- **Expected:** rejected with an Arabic message naming BOTH figures — "مبلغ التخصيص
  (X) يتجاوز المتبقي على الفاتورة (Y)" — X being the entered amount, Y the invoice's real
  outstanding. No allocation row is created; the invoice's outstanding is unchanged.
- **False pass:** the request 400s with a generic validation error that never states the
  invoice's actual outstanding — the officer cannot tell from the message alone how much
  room is left.

### MTP-TRS-15 — Allocate twice, exhaust, then try a third time
- **Steps:**
  1. Allocate part of `VCH-DEMO-UNALLOC-IN`'s 2,500.00 to one open `CUST-DEMO-3`
     invoice, leaving a remainder on the voucher.
  2. Allocate the remainder to a second open `CUST-DEMO-3` invoice (or the same one, if
     it still has outstanding) until the voucher's own unallocated balance is 0.00.
  3. Attempt a third allocation of 0.01 EGP.
- **Expected:** step 3 is refused — the voucher's own unallocated remainder is the OTHER
  bound the allocation guard checks, not only the invoice's outstanding. Sum of the two
  successful allocations must equal exactly 2,500.00 (Money's exact largest-remainder
  arithmetic, no rounding residue).
- **False pass:** the third allocation posts anyway, taking the voucher into a negative
  unallocated balance that only shows up as a bug once someone sums the allocation
  sub-ledger against the voucher total.

### MTP-TRS-16 — Unallocate restores the invoice's outstanding
- **Preconditions:** `VCH-DEMO-1`'s existing allocation against `INV-DEMO-1`.
- **Steps:**
  1. Note `INV-DEMO-1`'s current outstanding.
  2. Open `VCH-DEMO-1`'s allocation tab, click **"عكس التخصيص"** on the active
     allocation row.
- **Expected:** the allocation's status flips to reversed; `INV-DEMO-1`'s outstanding on
  `GET /open-invoices` goes back UP by exactly the amount that was allocated — the two
  numbers (allocation amount reversed, invoice outstanding delta) must match to the
  cent. `VCH-DEMO-1` itself now shows in the "محتاج تخصيص" queue again.
- **False pass:** the allocation row disappears from the list but the invoice's
  outstanding does not move — money the ledger thinks is still applied while the
  sub-ledger says otherwise.

### MTP-TRS-17 — Reverse a confirmed, allocated voucher
- **Steps:**
  1. Note `PI-DEMO-1`'s outstanding and `VCH-DEMO-3`'s existing allocation to it.
  2. Open `VCH-DEMO-3`, click **"عكس السند"**.
- **Expected:** the service reverses the active allocation FIRST (restoring
  `PI-DEMO-1`'s outstanding by the allocated amount), then posts a mirror-image GL entry
  (Dr/Cr swapped from the original) dated today, and marks `VCH-DEMO-3` **"معكوس"**. The
  original document is never edited — a fresh reversal document is created alongside it.
  There is no PUT/PATCH route on `/vouchers/:id` at all; the only way to undo a posted
  voucher is this reversal.
- **False pass:** the voucher shows "معكوس" but `PI-DEMO-1`'s outstanding was never
  restored, because the allocation-reversal step silently failed and only the
  document-level reversal succeeded.

### MTP-TRS-18 — Cancel is only offered on a draft, never on a confirmed voucher
- **Steps:** Open the row menu for any **"مؤكد"** voucher (e.g. `VCH-DEMO-1`).
- **Expected:** the menu offers **"عرض"**, **"طباعة"** — no **"إلغاء السند"** entry at
  all for a confirmed row; the detail page instead shows **"عكس السند"**. Cancel only
  ever appears for a row still in **"مسودة"**.
- **False pass:** none expected — this is the correct, checked behaviour; record it as a
  pass, but verify it explicitly rather than assuming from the code comment.

### MTP-TRS-19 — Voucher dated into a closed fiscal period
- **Preconditions:** as المدير المالي, close the fiscal period covering an earlier date
  (Settings → **الفترات المالية**, **"إغلاق"** on a past period) — or use a period already
  closed on the seed.
- **Steps:** As أمين الخزنة, attempt to create+confirm a voucher dated inside that closed
  period.
- **Expected:** refused with an Arabic message naming the period status (not a raw
  English string like `"PERIOD_NOT_OPEN_FOR_POSTING"` or a bare error code); no GL entry
  posts; the treasury account's balance is unchanged.
- **False pass:** the wizard shows a generic "حدث خطأ" toast with no explanation, and the
  officer cannot tell whether the failure was the closed period, a missing field, or the
  cash-negative guard — three different problems needing three different fixes.

### MTP-TRS-20 — Print a confirmed voucher
- **Steps:** Open any confirmed voucher's row menu, click **"طباعة"**.
- **Expected:** the browser print dialog opens over the voucher detail page, showing
  voucher number, type, party, amount, and treasury account.
- **False pass:** the print dialog opens over the *list* view instead of the detail
  (`window.print()` prints whatever is currently rendered) — check this by printing
  straight from the row menu without opening the detail page first.

---

## Cash-negative guard and the "cheque" payment-method trap

### MTP-TRS-21 — Cash safe cannot go negative
- **Preconditions:** tenant policy `preventNegativeCashBalance` is on (default).
- **Steps:** New voucher, type **"مصروف آخر"**, treasury **TR-DEMO-CASH**, amount larger
  than TR-DEMO-CASH's current live balance (read it off حسابات الخزينة first), **"إنشاء
  وتأكيد"**.
- **Expected:** refused before any GL entry posts (`CashBalanceWouldGoNegativeError`);
  TR-DEMO-CASH's balance is unchanged.
- **False pass:** the voucher confirms and حسابات الخزينة then shows TR-DEMO-CASH with a
  negative balance — the guard reads the LIVE ledger balance, so if this happens it
  means the guard was bypassed, not that the policy is off.

### MTP-TRS-22 — Bank account CAN overdraft by default
- **Steps:** New voucher, type **"مصروف آخر"**, treasury **TR-DEMO-BANK**, amount larger
  than TR-DEMO-BANK's current live balance, **"إنشاء وتأكيد"**.
- **Expected:** with the seed's default `allowNegativeTreasury = true`, this posts and
  TR-DEMO-BANK's live balance goes negative on حسابات الخزينة.
- **False pass:** a negative bank balance is treated as a bug by whoever is watching —
  it is the DOCUMENTED default policy, not a defect; the actual defect would be a cash
  (نقدي) account allowed to do the same (see MTP-TRS-21).

### MTP-TRS-23 — "شيك" as a voucher payment method never creates a cheque
- **Steps:**
  1. New voucher, type **"تحصيل من عميل"**, customer `CUST-DEMO-2`, treasury
     **TR-DEMO-CASH**, طريقة الدفع = **شيك**, amount 1,000.00, **"إنشاء وتأكيد"**.
  2. Open **سجل الشيكات** (Cheques) and search for `CUST-DEMO-2`.
- **Expected of step 1:** the voucher confirms and posts Dr 1300-1 (cash on hand) / Cr
  1105 immediately — exactly as if physical cash was already in hand.
- **Expected of step 2:** no new row appears in the cheque register — the "طريقة الدفع"
  field is a label only; picking **treasuryAccountId = TR-DEMO-CASH** with
  paymentMethod = **شيك** is not blocked or redirected in any way.
- **False pass — this is the finding, not a false pass to avoid:** an officer who
  believes selecting "شيك" as the payment method is how the system records a customer's
  cheque will (a) book money as collected in cash today that has not actually cleared,
  and (b) never see the cheque's due date on the cheque register's due-date calendar
  because no Cheque row was ever created. The *only* correct path for a customer's
  cheque is the dedicated **"شيك جديد"** form on the Cheques screen (MTP-TRS-26).

---

## Cheque lifecycle (سجل الشيكات) — 7 states on 5 stored statuses

### MTP-TRS-24 — Cheque register lists both directions and shows the derived states
- **Steps:** Open **سجل الشيكات**; note the status chips.
- **Expected:** `CHQ-DEMO-1` (incoming, due in 2 days) shows status **"يقترب موعد
  الاستحقاق"** (derived — stored status is still `pending`); `CHQ-DEMO-2` shows
  **"محصل"**; `CHQ-DEMO-3` shows **"مرتد"**; `CHQ-DEMO-4` shows **"محصل"** (outgoing);
  `CHQ-DEMO-5` (outgoing, due tomorrow) shows **"يقترب موعد الاستحقاق"**. The KPI strip's
  "إجمالي القيمة" sums all 5 in `Money` (not JS `Number`).
- **False pass:** `CHQ-DEMO-1` shows the actionable label "تحت التحصيل" — that label was
  a fixed defect (D55): it now reads "يقترب موعد الاستحقاق" precisely because the row
  still only offers **"إيداع في البنك"**, and the old label contradicted that button.

### MTP-TRS-25 — A pending cheque cannot be bounced before it is deposited
- **Steps:** On `CHQ-DEMO-5` (still `pending`, not deposited), open its row actions.
- **Expected:** **"تسجيل ارتداد"** is not offered / attempting `POST
  /cheques/CHQ-DEMO-5/bounce` returns 409 (`InvalidChequeTransitionError`) — the only
  legal predecessor of `bounced` is `deposited`. `cheques.noActionsAreAvailableOn` /
  "لا توجد إجراءات متاحة على هذا الشيك" style messaging, not a silent no-op.
- **False pass:** the API call succeeds and the cheque jumps straight from قيد الانتظار
  to مرتد with no bank ever having seen it.

### MTP-TRS-26 — Record a new incoming cheque from a customer
- **Steps:**
  1. On سجل الشيكات, click **"شيك جديد"**.
  2. نوع الشيك = **"شيك مستلم من عميل"**, العميل = `CUST-DEMO-3`, رقم الشيك = a fresh
     number, اسم البنك, تاريخ الإصدار = today, تاريخ الاستحقاق = +21 days, الفرع, amount
     3,000.00, **"حفظ الشيك"**.
- **Expected:** new row, status **"قيد الانتظار"**; GL posts immediately on creation —
  Dr 1320 (شيكات تحت التحصيل) / Cr 1105 (`CUST-DEMO-3`'s AR) — the customer's
  receivable is credited the moment the paper is received, before the bank has done
  anything.
- **False pass:** nothing posts until the cheque is later deposited — check the GL
  right after saving, not after deposit.

### MTP-TRS-27 — Deposit a cheque for collection
- **Steps:** On the cheque created in MTP-TRS-26, click **"إيداع في البنك"**, choose
  TR-DEMO-BANK.
- **Expected:** status → **"تحت التحصيل بالبنك"**; NO new GL entry posts (deposit is
  status-only — same instrument, same accounts) — confirm the account ledger for 1320
  and 1310 both show no new line from this action.
- **False pass:** a GL entry posts on deposit and again on collect, double-counting the
  cheque's value in the bank account.

### MTP-TRS-28 — Collect a deposited cheque
- **Steps:** On the deposited cheque from MTP-TRS-27, click **"تأكيد التحصيل"**, bank GL
  account = 1310.
- **Expected:** status → **"محصل"**; GL posts Dr 1310 (bank) / Cr 1320 (شيكات تحت
  التحصيل) for the exact cheque amount; TR-DEMO-BANK's live balance on حسابات الخزينة
  rises by exactly that amount.

### MTP-TRS-29 — A deposited cheque bounces and reopens the customer's debt
- **Preconditions:** deposit a fresh incoming cheque for `CUST-DEMO-1` (or reuse
  `CHQ-DEMO-3`, already bounced, to inspect its history).
- **Steps:**
  1. Deposit the cheque.
  2. Note `CUST-DEMO-1`'s balance on the AR aging report (**تقارير أعمار الديون**).
  3. Click **"تسجيل ارتداد"**.
  4. Re-check `CUST-DEMO-1`'s balance on the same aging report.
- **Expected:** GL posts Dr 1360 (شيكات مرتجعة) / Cr 1320 — status → **"مرتد"**. The
  aging report's balance for `CUST-DEMO-1` in step 4 is exactly the amount HIGHER than
  in step 2 (`unappliedCustomerCredits` in `reports-routes.ts` explicitly excludes
  `bounced`/`replaced` cheques from the credit it nets against AR) — the customer's debt
  is genuinely reopened, not silently absorbed.
- **False pass — the actual gap to record, not to miss:** open `CUST-DEMO-1`'s **كشف
  حساب** (Customer Statement tab) instead of the aging report. It shows **NO row at all**
  for the cheque, before or after the bounce — `CustomerStatementTab` in
  `CustomersScreen.tsx` only reads invoices, sales returns and voucher allocations; a
  cheque posted directly through `/cheques` never appears there. The statement's own
  "مطابق لتقرير أعمار الديون" / "يختلف عن تقرير أعمار الديون" pill will read **"يختلف عن
  تقرير أعمار الديون"** for this customer as soon as the cheque is received — correctly
  flagging a discrepancy, but with no explanation in its note that a cheque is the
  cause. Anyone reconciling from the statement alone, rather than the aging report,
  will not see the debt at all in either direction.

### MTP-TRS-30 — Replace a bounced cheque with a new one of the same amount
- **Preconditions:** `CHQ-DEMO-3` — bounced, `CUST-DEMO-1`, 1,750.00.
- **Steps:** On `CHQ-DEMO-3`, click **"استبدال الشيك"**; enter a new cheque number, bank,
  issue/due dates; amount defaults to 1,750.00; **submit**.
- **Expected:** `CHQ-DEMO-3` → status **"مستبدل"**, `replacedByChequeId` set; a new
  cheque row appears, status **"قيد الانتظار"**, `replacesChequeId` pointing back to
  `CHQ-DEMO-3`; GL posts Dr 1320 / Cr 1360 for 1,750.00 — reclassifying the bounced
  amount back into the collectible bucket without touching AR again (AR was already
  reopened at bounce time, MTP-TRS-29).

### MTP-TRS-31 — Replacement amount must match the bounced cheque exactly
- **Steps:** Repeat MTP-TRS-30 but enter a replacement amount different from 1,750.00
  (the form allows a custom amount).
- **Expected:** rejected (`ReplacementAmountMismatchError`); neither cheque's status
  changes.
- **False pass:** the replacement posts for the wrong amount, leaving 1360 either over-
  or under-cleared by the difference with no trace of where it went.

### MTP-TRS-32 — An outgoing cheque bounces and reopens the payable
- **Steps:**
  1. Deposit `CHQ-DEMO-5` (outgoing, `SUPP-DEMO-2`, 1,600.00) — bank TR-DEMO-BANK.
  2. Note `SUPP-DEMO-2`'s balance on **تقارير أعمار الدائنين** (AP aging).
  3. Click **"تسجيل ارتداد"**.
  4. Re-check `SUPP-DEMO-2`'s AP balance.
- **Expected:** GL posts Dr 2150 (شيكات مدفوعة تحت التحصيل / cheques payable) / Cr 2100
  (AP) — the exact reverse direction from an incoming bounce. `SUPP-DEMO-2`'s payable in
  step 4 is 1,600.00 HIGHER than step 2 — we never actually paid them.

### MTP-TRS-33 — Replace is refused on an outgoing (bounced) cheque
- **Steps:** On the now-bounced `CHQ-DEMO-5` from MTP-TRS-32, attempt **"استبدال
  الشيك"**.
- **Expected:** rejected (`InvalidChequeCommandError` — outgoing cheques replace via a
  fresh `POST /cheques`, never the `/replace` endpoint, per `ChequeService.replace`'s own
  guard). If the UI offers the same "استبدال الشيك" control regardless of direction,
  that is itself a finding: the control should either be hidden for outgoing cheques or
  should silently do the right thing (create a new cheque) instead of surfacing a raw
  domain error.

### MTP-TRS-34 — Duplicate cheque number is rejected
- **Steps:** Create a new incoming cheque reusing `CHQ-DEMO-1`'s exact number
  (`0451236`), any customer.
- **Expected:** rejected 409 (`DuplicateChequeNumberError`) — duplicate check is scoped
  to `(direction, chequeNumber)`, so the SAME number for the OUTGOING direction (e.g.
  reusing `9002014`) is allowed and must be tested separately to confirm it is *not*
  blocked (a legitimate case — different cheque books).

### MTP-TRS-35 — No audit trail names who changed a cheque's state
- **Steps:**
  1. As أمين الخزنة, deposit then collect a cheque (any of MTP-TRS-27/28).
  2. As المدير المالي (or an internal auditor role with `audit.logs.view`), open **سجل
     التدقيق** and filter module = `treasury`.
- **Expected of the product:** every action that moved money should show who did it.
- **Actual — the dealbreaker:** `ChequeService` never calls into the audit log at all —
  `ChequeServiceDeps` carries no `audit` port, and `cheques-routes.ts` builds a single
  `ChequeService` from server-startup deps rather than binding the authenticated actor
  per request the way `vouchers-routes.ts` does. The audit log's `treasury` module shows
  rows for voucher confirms/reversals but **zero rows for any cheque action** — create,
  deposit, collect, bounce or replace. Every cheque-triggered journal entry's `actor`
  falls back to the literal string `"system"` regardless of who clicked the button.
- **False pass:** the officer assumes "no rows for cheques" means "nobody has touched
  cheques today" — it means the module cannot record who touched them, full stop, even
  on a day with five bounces.

### MTP-TRS-36 — Post-dated cheques as a due-date calendar
- **Steps:** On سجل الشيكات, set من تاريخ = today, إلى تاريخ = +7 days, direction = **كل
  الاتجاهات**.
- **Expected:** both `CHQ-DEMO-1` (incoming, due in 2 days, 2,400.00) and `CHQ-DEMO-5`
  (outgoing, due tomorrow, 1,600.00) appear together in one list, distinguishable by the
  "الاتجاه" column (واردة/صادرة); the filtered KPI strip's "إجمالي القيمة" sums both.
- **False pass:** the date filter only narrows `dueDate` for `pending`-derived rows —
  an already `collected`/`bounced` cheque whose `dueDate` happens to fall in the window
  also shows up (its due date is history, not upcoming); do not read "N cheques in this
  window" as "N cheques still to act on" without also checking status.

### MTP-TRS-37 — Cheque register is invisible without `cheques.view`
- **Steps:** Sign in as a role without `cheques.*` (e.g. مندوب مبيعات).
- **Expected:** سجل الشيكات is not reachable — nav entry hidden and/or `GET /cheques`
  returns 403.
- **False pass:** the screen renders an empty list instead of being blocked — that reads
  as "no cheques exist" rather than "you may not see them", and is indistinguishable
  from MTP-TRS-24's genuinely empty states.

---

## Multiple safes and bank accounts

### MTP-TRS-38 — Live treasury balances tie to the trial balance
- **Steps:** Open حسابات الخزينة; note "إجمالي الأرصدة", "النقد المتاح" (cash), "الرصيد
  البنكي" (bank). Separately open **Financial Reports → ميزان المراجعة** as of today and
  find accounts 1300-1 and 1310.
- **Expected:** "النقد المتاح" = the 1300-1 (and any other `type: cash`) trial-balance
  rows summed; "الرصيد البنكي" = the 1310 (and any other `type: bank`) rows summed;
  "إجمالي الأرصدة" = both together. This is a fixed defect (D41) — the screen used to
  show the *opening* balance while the ledger held ten confirmed vouchers; the two
  totals now come from the same GL query the trial balance uses.
- **False pass:** the two screens agree only because nothing was confirmed since the
  page loaded — re-check after confirming a fresh voucher without reloading the
  treasury-accounts page, to catch a stale cache rather than a live query.

### MTP-TRS-39 — Add a second cash safe with an opening balance
- **Steps:**
  1. On حسابات الخزينة, click **"إضافة حساب"**.
  2. الكود = `CASH-002`, الاسم = "خزينة الفرع الثاني", نوع الحساب = نقدي, الفرع = a
     second branch, الرصيد الافتتاحي = 5,000.00, تاريخ الرصيد الافتتاحي = today, save.
- **Expected:** new treasury account created with `openingBalance = 5000.00`; its GL
  leaf account shows the same 5,000.00 as an opening balance, funded against **3210**
  (رصيد افتتاحي), never 3200 (drawings — a different account with the opposite natural
  balance, per the code comment in `TreasuryAccountsScreen.tsx`).
- **False pass:** the safe is created with a 5,000.00 "opening balance" field on the
  form, but no GL entry actually posts it — check the GL for account 3210 directly, not
  just the number shown on the treasury-accounts row.

### MTP-TRS-40 — Opening-balance posting is only offered for a zero-balance safe
- **Preconditions:** the safe from MTP-TRS-39, already funded at creation.
- **Steps:** Open that safe's detail, look for **"تعيين رصيد افتتاحي"**.
- **Expected:** per the screen's own hint ("متاح فقط لخزنة رصيدها صفر"), the action is
  unavailable once the safe already carries a non-zero balance — it exists for a safe
  created empty and funded later, not as a way to add a second opening entry.

### MTP-TRS-41 — Transfer from the new safe to the bank
- **Steps:** New voucher, type **"تحويل بين الخزائن"**, من TR-DEMO-CASH's sibling
  `CASH-002` (MTP-TRS-39), إلى TR-DEMO-BANK, amount 1,000.00, **"إنشاء وتأكيد"**.
- **Expected:** Dr 1310 / Cr `CASH-002`'s GL leaf for 1,000.00; both treasury accounts'
  live balances move by exactly 1,000.00 in opposite directions.

### MTP-TRS-42 — Cannot transfer a safe into itself
- **Steps:** New voucher, type **"تحويل بين الخزائن"**, set BOTH the source and
  destination treasury account to TR-DEMO-CASH.
- **Expected:** rejected — "لا يمكن التحويل إلى نفس الخزينة" (`voucher-document.ts`'s
  `validate()`); no GL entry, no balance change.

### MTP-TRS-43 — Newly created, still-empty safe cannot pay out
- **Steps:** Create a third, unfunded treasury account (no opening balance). Attempt a
  cash payment voucher (any payment type) sourced from it, amount 1.00.
- **Expected:** refused by the cash-negative guard (MTP-TRS-21's guard, same code path)
  — an empty safe cannot go negative on its first transaction any more than a funded
  one can on its hundredth.

---

## Custody (عهدة) — employee advances

### MTP-TRS-44 — No seeded human role can approve or disburse an advance
- **Preconditions:** `ADV-DEMO-4` — pending, `EMP-DEMO-4`, 3,000.00.
- **Steps:** Sign in as **مسؤول شؤون العاملين** (`HR_OFFICER` — holds `hr.advance.view`
  and `hr.advance.create`) and open **سلف الموظفين**; attempt **"اعتماد"** on
  `ADV-DEMO-4`.
- **Expected of a working product:** HR can approve an advance it is allowed to see and
  create.
- **Actual — the finding:** `/hr/advances/:id/approve|reject|disburse` are all gated on
  `hr.advance.approve`, and NO seeded role in `access.ts` — not `HR_OFFICER`, not
  `PAYROLL_OFFICER`, not `FINANCE_MANAGER` — holds that permission. Only the `"*"`
  wildcard admin account can approve, reject or disburse an advance in this tenant.
  Confirm the button is either hidden or 403s for `HR_OFFICER`.
- **False pass:** testing this only as the admin account (who holds `"*"` and bypasses
  every gate) hides the gap completely — the scenario must be run as `HR_OFFICER`.

### MTP-TRS-45 — Approve then disburse an advance (as admin, given MTP-TRS-44)
- **Preconditions:** `ADV-DEMO-3` — already **approved**, `EMP-DEMO-2`, 2,400.00.
- **Steps:**
  1. Open `ADV-DEMO-3`'s detail panel; note **"يصدر سند صرف نقدي: مدين سلف الموظفين
     (1160) / دائن الخزينة."**
  2. الخزينة = TR-DEMO-CASH, الفرع = its branch, click **"صرف"**.
- **Expected:** status → **"مصروفة"**; GL posts Dr 1160 (سلف الموظفين — an ASSET, never
  an expense) / Cr 1300-1 for 2,400.00; TR-DEMO-CASH's live balance drops by exactly
  2,400.00; the advance detail's "سند الصرف" field now shows the created voucher's id.
- **False pass:** the row flips to "مصروفة" but TR-DEMO-CASH's balance does not move —
  the HR advance disbursement rides on the SAME treasury-voucher engine as everything
  else in this plan (`other_expense` type under the hood, per the domain comment on
  `counterpartAccountFixed`), so it must be provably wired, not merely status-flipped.

### MTP-TRS-46 — Reject a pending advance
- **Preconditions:** `ADV-DEMO-5` — already **rejected**, `EMP-DEMO-6`, 10,000.00 (or
  create a fresh pending one).
- **Steps:** Confirm `ADV-DEMO-5`'s status is **"مرفوضة"**; confirm no voucher id appears
  on its detail panel and TR-DEMO-CASH/TR-DEMO-BANK show no movement traceable to it.
- **Expected:** a rejected advance never touches treasury at all.

### MTP-TRS-47 — Advances recover only through payroll, never a manual settlement
- **Preconditions:** `ADV-DEMO-1` (disbursed, `EMP-DEMO-1`, 6,000.00 over 6 instalments,
  first deduction 2026-06-01) and payroll run `PR-DEMO-1` (June, already disbursed).
- **Steps:** Open `ADV-DEMO-1`'s instalment schedule; look for any action on the advances
  screen itself to mark an instalment "مسدد" directly (a manual تسوية عهدة / write-off).
- **Expected:** the June instalment shows **"مسدد"** because payroll run `PR-DEMO-1`
  recovered it — not because of any control on this screen. There is no button here to
  settle, write off, or manually recover an instalment; recovery is entirely a
  side-effect of running payroll.
- **False pass:** none to avoid — this is a genuine gap (see Gaps section) rather than a
  behaviour to misjudge as broken; the plan exists to confirm the absence is real, not
  a screen the tester simply missed.

### MTP-TRS-48 — Outstanding advances total agrees with the sum of its own rows
- **Steps:** On سلف الموظفين, note **"إجمالي المتبقي"** in the stats strip. Sum the
  **"المتبقي"** column across every row on the current page (and every page, if paged).
- **Expected:** the two totals match to the cent — the stats strip is computed from the
  same `balances` array the column renders (`sumMajor(balances.map(b => b.outstanding))`
  in `EmployeeAdvancesScreen.tsx`), not a separately-fetched server aggregate that could
  drift from the rows on screen.

---

## Bank reconciliation (already seeded: `BSTMT-DEMO-1`, August 2026, BANK-001)

### MTP-TRS-49 — Open an imported statement, still mid-reconciliation
- **Steps:** Open **مطابقة كشف حساب البنك**; select `BSTMT-DEMO-1`.
- **Expected:** status **"قيد التسوية"**; opening/closing balances shown; the auto-match
  already run at seed time left the two bank-fee lines (`FEE000041` 85.00,
  `FEE000042` 40.00) **unmatched** — by design, since no GL entry for them exists yet.

### MTP-TRS-50 — Auto-match re-run is idempotent
- **Steps:** With `BSTMT-DEMO-1` open, click **"مطابقة تلقائية"** again.
- **Expected:** previously matched lines stay matched (same `matchedEntryId`); the two
  fee lines remain unmatched (no candidate GL entry exists for either); the match
  summary (matched/total) is unchanged from before the re-run.

### MTP-TRS-51 — Post the missing bank-fee vouchers, then match manually
- **Steps:**
  1. New voucher, type **"مصروف آخر"**, treasury TR-DEMO-BANK, amount 85.00, date
     2026-08-28, memo "مصاريف خدمات بنكية", **"إنشاء وتأكيد"**. Repeat for the 40.00
     transfer fee, date 2026-08-30.
  2. Back on `BSTMT-DEMO-1`, click **"مطابقة تلقائية"** again, or manually **"مطابقة"**
     each fee line against the new journal entry.
- **Expected:** both fee lines move to **"مطابَق"**; the statement's unmatched count
  drops to 0.

### MTP-TRS-52 — Unmatch a matched line
- **Steps:** Pick any matched line on `BSTMT-DEMO-1`, click **"إلغاء المطابقة"**.
- **Expected:** reverts to **"غير مطابَق"**, `matchedEntryId` cleared. A second
  **"إلغاء المطابقة"** on the same, now-unmatched line is refused (`LineNotMatchedError`)
  — cannot unmatch what is not matched.

### MTP-TRS-53 — Finalize with unmatched lines still open
- **Steps:** Before completing MTP-TRS-51, on the still-mid-reconciliation statement
  with the two fee lines unmatched, click **"إنهاء التسوية"**.
- **Expected of a safe reconciliation workflow:** the officer should be blocked or at
  least warned before locking a statement with open differences.
- **Actual — the finding:** `ReconciliationService.finalize()` only checks the statement
  is not already finalized (`assertNotFinalized`) — it never reads the unmatched count.
  The button in `BankReconciliationScreen.tsx` is disabled only while `locked` or
  `finalize.isPending`; nothing disables it for a non-zero unmatched count, and there is
  no confirmation dialog. The statement locks to **"منتهية"** with two genuine,
  unexplained differences still open.
- **False pass:** "منتهية" reads as "reconciled" — it only means "locked"; a finalized
  statement with unmatched lines is not actually reconciled, and nothing on screen
  distinguishes the two states.

### MTP-TRS-54 — Cannot finalize twice
- **Steps:** On the now-finalized statement from MTP-TRS-53, attempt **"إنهاء
  التسوية"** again (re-enable the button via devtools if the UI has disabled it, or call
  the route directly).
- **Expected:** rejected (`StatementAlreadyFinalizedError`); statement stays
  **"منتهية"** with its original `finalizedAt`.

---

## Reports

### MTP-TRS-55 — Sub-ledger vs. control-account reconciliation
- **Steps:** After running MTP-TRS-01 through MTP-TRS-30, open **مطابقة الأرصدة**
  (`ReconciliationScreen.tsx`).
- **Expected:** every row shows **"متطابق"** — AR sub-ledger vs. 1105, AP sub-ledger vs.
  2100, and any others listed. "رصيد المصدر" and "رصيد دفتر الأستاذ" must be equal to
  the cent on every row; "الفارق" reads 0.00.
- **False pass:** a row reads "متطابق" only because both figures are independently
  wrong in the same way — spot-check one row's "رصيد المصدر" against the actual
  sub-ledger screen (e.g. an individual customer's aging balance) rather than trusting
  the pill alone.

### MTP-TRS-56 — Unlinked control-account postings surface on their own tab
- **Steps:** Post a journal entry directly against 1105 or 2100 through **قيود
  اليومية** (bypassing sales/purchase invoices and vouchers entirely), then reopen
  مطابقة الأرصدة and switch to the **"القيود غير المرتبطة"** tab.
- **Expected:** the manually-posted line appears there, named by entry number and
  account — a control-account posting with no sub-ledger document behind it is
  something this screen is built to catch, not to silently absorb into "متطابق".

### MTP-TRS-57 — Cash flow statement reflects the day's vouchers
- **Steps:** Open **Financial Reports → قائمة التدفقات النقدية** for a period including
  today.
- **Expected:** the day's confirmed receipt/payment vouchers move the appropriate
  operating/financing line; the seeded inter-treasury transfer (`VCH-DEMO-6`) does not
  inflate either operating receipts or payments (consistent with MTP-TRS-11).

---

## Authorisation — approval above a limit

### MTP-TRS-58 — No approval chain configured: every voucher posts immediately
- **Preconditions:** fresh seed, no workflow config added yet.
- **Steps:** As أمين الخزنة, create+confirm a voucher for a deliberately large amount —
  e.g. 500,000.00 EGP other_expense from TR-DEMO-BANK (bank allows overdraft, so this
  will not trip the cash guard).
- **Expected:** posts immediately, status **"مؤكد"**, no hold — because no
  `TREASURY_VOUCHER_CONFIRM` chain is configured in the seed (unlike
  `SALES_INVOICE_CONFIRM`/`PURCHASE_INVOICE_CONFIRM`, which are). Confirm via **الموافقات**
  inbox: it stays empty.
- **False pass:** an officer might assume large payments are inherently gated because
  *other* document types are — treasury vouchers are not, out of the box.

### MTP-TRS-59 — Configure an approval chain, then confirm a voucher is held
- **Steps:**
  1. As المدير المالي, open **إعدادات الموافقات**, **"إضافة سير عمل جديد"**, نوع
     الإجراء = **"تأكيد سند صرف/قبض"**, add one step with role `FINANCE_MANAGER`,
     **"حفظ سير العمل"**.
  2. As أمين الخزنة, create+confirm any voucher, e.g. a 100.00 other_expense from
     TR-DEMO-CASH.
- **Expected:** the workflow-config row for "تأكيد سند صرف/قبض" shows status
  **"نشط"** (not "غير مُفعَّل بعد" — `TREASURY_VOUCHER_CONFIRM` has no `enforced: false`
  flag in `action-types.ts`, unlike purchase-side action types). The voucher's status
  becomes **"بانتظار الموافقة"**, not "مؤكد"; NO GL entry posts and TR-DEMO-CASH's
  balance is unchanged; the voucher appears in المدير المالي's approvals inbox.
- **False pass — the real finding:** the create-flow wizard's **"إنشاء وتأكيد"** button
  closes exactly the same way whether the voucher posted immediately or was just put on
  hold — `TreasuryVouchersScreen.tsx`'s `submitVoucher()` calls `confirmVoucher.mutateAsync`
  and then unconditionally calls `onDone()`, never reading the `held` flag the API
  response carries. The officer sees no different feedback for "posted" vs. "sent for
  approval" and may believe the payment left the safe when it did not.

### MTP-TRS-60 — There is no amount threshold — the gate is all-or-nothing
- **Preconditions:** the chain from MTP-TRS-59, still active.
- **Steps:** On إعدادات الموافقات, open the "تأكيد سند صرف/قبض" chain for editing; look
  for any field to set a minimum amount before the gate applies.
- **Expected of the stated requirement** ("a payment above a limit should require
  approval"): a threshold field.
- **Actual — the finding:** neither `GateStepDTO` nor `WorkflowConfigDTO`
  (`packages/contracts/src/workflow.ts`) carries any amount field, and no code anywhere
  in `packages/domain/src/workflow` or `packages/api/src` compares an amount against
  one. A configured chain gates **every** voucher confirm of that type, a 10.00 EGP
  petty-cash slip exactly as much as a 500,000.00 EGP payment — there is no way to gate
  only the large ones. As a direct consequence of MTP-TRS-58/59, a tenant that wants
  "approval above X" cannot configure it at all today; they can only choose between
  "no approval, ever" and "approval on literally everything, including petty cash".
- **False pass:** seeing the chain "work" for a large voucher (MTP-TRS-59) can read as
  "the approval-above-a-limit requirement is met" — it is not; run a SECOND, tiny
  voucher (1.00 EGP) through the same chain and confirm it is held too, exactly like the
  large one, to see the gap directly.

---

## Gaps — no screen to test

- **Daily cash close (تقفيل الخزنة) as a distinct workflow.** No screen or route exists
  for "open the day, record movements, close with a counted-cash figure, surface the
  difference between counted and system cash for investigation." `grep` across
  `apps/web/src/screens` and `packages/api/src` for `تقفيل`, `إقفال الخزينة`, `dailyClose`,
  `CashClose` returns nothing treasury-specific. The closest substitute is a treasury
  account's own **"حركة الحساب"** tab (`TreasuryAccountsScreen.tsx`) — a live, read-only
  list of every GL movement plus a running closing balance — but it has no physical-count
  input field, no signed-off "close" event, and therefore no difference to investigate:
  the system balance is simply asserted as correct. Van-trip settlement
  (`/field/van-trips/:id/settle`, seeded via `TR-DEMO-VAN`) is the one place in this
  codebase that DOES compare a counted figure against the system figure and record the
  variance — a pattern that exists nowhere for the main cash drawer or bank accounts.
- **Manual custody settlement / write-off (تسوية عهدة).** Employee advances recover
  ONLY as a side-effect of running payroll (`hr/payroll/runs/:id/calculate`); there is no
  screen or route to record a partial cash repayment outside payroll, or to write off an
  advance the employee will never repay.
- **A per-voucher-type cash/bank split matching the catalog's literal "10 types".**
  The catalog describes 10 voucher types as receipt/payment × cash/bank; the actual
  code models 11 voucher types with an orthogonal 5-way `paymentMethod` (cash / bank /
  cheque / card / wallet) that is a label only (see MTP-TRS-23) — there is no screen
  where "cash receipt" and "bank receipt" are separate documents with separate numbering
  or separate approval rules, which the catalog's literal reading implies some tenants
  may expect.
- **An amount-threshold field on the approval-workflow config screen.** Covered as a
  finding in MTP-TRS-60 rather than a bare gap, because the surrounding mechanism (gate
  wiring, hold state, inbox) is fully built — only the threshold itself is missing.
