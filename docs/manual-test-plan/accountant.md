# Manual test plan — staff accountant (محاسب)

Persona: the person who books documents correctly and closes a clean month —
not the clerk keying invoices (`end-user`) and not the auditor certifying the
year (`chartered-accountant`). Every scenario below is grounded in a screen or
route that exists in this tree; nothing is invented. Screens live under
`apps/web/src/screens/`, routes under `packages/api/src/*-routes.ts`, domain
rules under `packages/domain/src/`.

**Standard preconditions for every scenario unless stated otherwise:**
- Fresh seeded backend: `MEZAN_SEED_DEMO=1` against an empty database file.
- Signed in as `محمد الشهابي`, password `Cyag@2026` (the seeded accountant-capable user).
- One browser tab, one backend, one database — a second tester sharing the
  session invalidates every observation in this plan.
- Arabic/RTL locale unless a scenario calls out English.

**Reading the money assertions.** Every "Expected" below names at least two
figures that must agree exactly (to the piastre, or exactly to `Money`'s
1e-6 scale where the UI shows six decimals). Where the two figures are
allowed to differ by design (e.g. a confirmed-but-uninvoiced receipt), the
scenario says so explicitly — that is not a defect to report.

Screen route keys are given in parentheses, e.g. `journals`, `fiscal-periods`
— they are the keys registered in `apps/web/src/router/screens.ts` and the
`itemKeys` in `apps/web/src/nav-config.tsx`, not literal URLs.

---

## Part 1 — Daily booking: journal entries

### MTP-ACC-01 — Post a balanced manual journal entry
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** seeded demo tenant; note account 2170 or 2190 (a
  non-control account — do not hand-post to 1105/1200/2100, the control
  accounts every reconciliation check in this plan depends on).
- **Steps:**
  1. Open شاشة القيود المحاسبية (`journals`).
  2. Click «قيد جديد».
  3. In التاريخ, keep today's date.
  4. Type "مصروف قرطاسية غير مسجل" into الوصف *.
  5. In line 1's الحساب select, choose account 2190 (or another detail
     expense/non-control account).
  6. Type `1500.75` into مدين for line 1.
  7. In line 2's الحساب select, choose the treasury/cash account 1110 or
     equivalent detail cash account.
  8. Type `1500.75` into دائن for line 2.
  9. Observe الفرق (difference) in the balance panel.
  10. Click «ترحيل القيد».
- **Expected:** الفرق reads 0.00 ج.م and the status pill flips from
  «غير متوازن» to «متوازن ✓» before posting is even allowed. After posting,
  the entry appears in the list with status «مرحل», إجمالي المدين =
  إجمالي الدائن = 1,500.75 exactly. The two numbers that must agree: the
  entry's own total debit and total credit, and the KPI strip's «إجمالي
  المدين» after the post equals the previous value plus 1,500.75 exactly.
- **False pass:** the entry shows «مرحل» in the list but the two account
  balances (`GET /gl/accounts/:id/ledger`) do not each move by exactly
  1,500.75 — the row exists without both ledger sides having posted.

### MTP-ACC-02 — Block an unbalanced entry from posting
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** on `journals` → «قيد جديد».
- **Steps:**
  1. Type a description.
  2. Line 1: choose an account, type `1000` into مدين.
  3. Line 2: choose a different account, type `900` into دائن.
  4. Observe «ترحيل القيد».
  5. Attempt to click «ترحيل القيد» anyway (it should render disabled).
  6. Send the same unbalanced body directly to `POST /gl/journal-entries`
     with `x-permissions: *`.
- **Expected:** in the UI, الفرق shows 100.00 in the danger colour, the pill
  reads «غير متوازن», and «ترحيل القيد» is disabled — it cannot be clicked.
  The direct API call returns HTTP 422 with an unbalanced-entry error code
  and the two mismatched totals in the body, and no row is created —
  `GET /gl/journal-entries` count is unchanged before and after.
- **False pass:** the button is merely styled as disabled (CSS opacity) but
  the click handler still fires — check the network tab, not just the
  cursor. This is the accountant's #1 dealbreaker: an unbalanced entry that
  posts.

### MTP-ACC-03 — Two-line minimum enforced on the create form
- **Persona / permission:** `accounting.journal.create`.
- **Preconditions:** on `journals` → «قيد جديد», which opens with exactly 2
  blank lines.
- **Steps:**
  1. Observe the row-delete (✕) buttons on both starting lines.
  2. Try clicking either ✕.
  3. Click «إضافة سطر» once to add a third line.
  4. Now try clicking ✕ on the third line.
- **Expected:** with exactly 2 lines, both ✕ buttons are disabled. After
  adding a third line, its ✕ becomes clickable and removing it returns the
  form to 2 lines with both ✕ disabled again.
- **False pass:** the row is visually removed but the line count under the
  hood drops below 2 without disabling the remaining ✕ — post one line for
  0/2 with an account picked and see whether posting is still blocked.

### MTP-ACC-04 — Save a draft entry, then post it later
- **Persona / permission:** `accounting.journal.create` to draft;
  `accounting.journal.post` to post.
- **Preconditions:** none beyond the seed. `POST /gl/journal-entries/draft`
  exists as a distinct route from `POST /gl/journal-entries`.
- **Steps:**
  1. Note that the built create screen only exposes «ترحيل القيد» (direct
     post) — there is no «حفظ كمسودة» button anywhere in it. Confirm by
     reading the create screen top-to-bottom: only «إلغاء» and «ترحيل
     القيد» appear.
  2. As a fallback, call `POST /gl/journal-entries/draft` directly with a
     balanced 2-line body.
  3. Reload `journals` and filter status chip «مسودة».
  4. Open the draft row, note it has no «عكس القيد» action.
  5. Call `POST /gl/journal-entries/:id/post`.
  6. Reload the list.
- **Expected:** the draft appears under «مسودة» with count 1 in both the
  status chip and the «مسودة» stat card. After posting via the API, the
  status chip count for «مسودة» drops by 1 and «مرحل» rises by 1.
- **False pass / gap:** the create-entry screen itself has no UI path to
  draft — see Gaps. Do not report "draft is broken"; report that
  draft-then-post is API-only, no button reaches it.

### MTP-ACC-05 — Reverse a posted entry (correction, never edit)
- **Persona / permission:** `accounting.journal.post` (reversal reuses this
  code; there is no separate reverse permission).
- **Preconditions:** MTP-ACC-01's entry, now posted.
- **Steps:**
  1. Open the posted entry from MTP-ACC-01.
  2. Confirm there is no edit control anywhere in the detail panel — only a
     «عكس القيد» danger-outline button, shown only for posted entries.
  3. Click «عكس القيد».
  4. Reload the journal list.
- **Expected:** two changed facts: the original entry's status flips to
  «معكوس»; a brand-new entry appears whose lines are the exact mirror image
  (same accounts, debit and credit swapped) — its own total debit equals
  its own total credit, and equals the original's total debit exactly
  (1,500.75). Account 2190 and the cash account both net back to their
  pre-MTP-ACC-01 balances.
- **False pass:** the reversal entry posts but the original's status stays
  «مرحل» instead of «معكوس» — the register would then show the same money
  twice as live.

### MTP-ACC-06 — A posted entry cannot be edited or deleted, only reversed
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** any posted entry.
- **Steps:**
  1. Open a posted entry's detail.
  2. Search the entire panel for any «تعديل» or «حذف» control.
  3. Attempt PATCH/PUT/DELETE directly against `/gl/journal-entries/:id`
     if such a route exists (the route file exposes no PATCH/DELETE on
     `/journal-entries/:id` at all — only GET, `/post`, `/reverse`).
- **Expected:** no edit or delete control exists anywhere in the UI, and no
  route accepts a mutation other than `/post` and `/reverse`. A raw request
  to an unmounted verb returns 404/405, not a silent success.
- **False pass:** none realistically — this confirms an absence. Do not
  accept "I didn't find a button" without also confirming the route is
  actually unmounted, not merely unlinked from the UI.

### MTP-ACC-07 — Attempt to reverse an already-reversed entry
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** MTP-ACC-05 completed; the original entry is now
  «معكوس».
- **Steps:**
  1. Open the original (now-reversed) entry.
  2. Confirm «عكس القيد» no longer renders on it.
  3. Call `POST /gl/journal-entries/:id/reverse` directly against that
     same id anyway.
- **Expected:** the UI shows no reverse control on a reversed entry. The
  direct API call returns 409 with an already-reversed error code, and no
  third entry is created — the journal-entries count after the failed call
  equals the count before it.
- **False pass:** the API silently accepts a second reversal and posts a
  third entry, doubling the correction.

### MTP-ACC-08 — Journal register's filters, chips and KPI strip must agree
- **Persona / permission:** `accounting.journal.view`.
- **Preconditions:** at least the entries from MTP-ACC-01 and MTP-ACC-05.
- **Steps:**
  1. Open `journals` with no filters.
  2. Note «إجمالي القيود» and «مرحل» stat-card values.
  3. Click the status chip «مرحل».
  4. Note the chip's own count badge next to «مرحل» and the still-visible
     stat-card value.
  5. Set تصفية النتائج → الوحدة المصدر to a specific module and re-check
     both.
- **Expected:** the «مرحل» stat card and the «مرحل» chip's count are always
  the same number, and both change together as filters change — both are
  derived from the same filtered server call. The stat card's totals tie
  exactly to the sum of the visible rows' own debit column.
- **False pass:** the chip counts freeze at the grand total no matter which
  chip is active — verify each chip's own number changes, not just the
  active one.

### MTP-ACC-09 — Manual entry has no cost centre, currency or attachment field (gap check)
- **Persona / permission:** `accounting.journal.create`.
- **Preconditions:** on `journals` → «قيد جديد».
- **Steps:**
  1. Look at the header fields: only تاريخ القيد and الوصف.
  2. Look at each line's columns: الحساب, البيان, مدين, دائن, and the
     delete button — five columns, no more.
  3. Open a posted entry's detail and look at its tabs: only «بنود القيد»
     (lines) renders — no «المرفقات» or «سجل المراجعة» tab exists.
- **Expected:** confirmed absence — no مركز تكلفة column, no currency
  field, no attachment control anywhere on this screen, even though the
  wire contract for a journal line accepts `costCenterId`, `currency` and
  `fxRate` per line, and the cost-centre P&L report groups by exactly this
  field. A manual entry can never carry a cost centre, a foreign currency
  or a supporting document — only system-generated postings (vouchers,
  invoices) can.
- **False pass:** none — this scenario exists to document the gap
  precisely, not to find a bug in what's built. See "Gaps" §1–3.

### MTP-ACC-10 — Search the journal register by entry number
- **Persona / permission:** `accounting.journal.view`.
- **Preconditions:** MTP-ACC-01's entry posted, its entry number noted.
- **Steps:**
  1. Type the entry number into «بحث برقم القيد...».
  2. Observe the filtered rows.
  3. Clear the search, type a substring of the entry's الوصف instead.
- **Expected:** exactly one row for the exact entry number; the memo
  substring search also returns the same row — the server matches entry
  number, memo, and source document number together.
- **False pass:** the search silently does client-side substring matching
  with different normalisation than the server, so a term that should
  match does not — confirm both the UI list and a direct `?search=` query
  agree on the same result count.

---

## Part 2 — Automatic postings: can you see the entry a document generated?

### MTP-ACC-11 — Confirm a sales invoice and inspect its journal entry from the invoice
- **Persona / permission:** `sales.invoice.confirm`, `accounting.journal.view`.
- **Preconditions:** a draft sales invoice for a seeded customer with at
  least one taxable stock line.
- **Steps:**
  1. Open `sales-invoices`, create or open a draft invoice.
  2. Note الإجمالي (grand total) and الضريبة (tax) on the create preview.
  3. Click «تأكيد الفاتورة».
  4. On the confirmed invoice's detail, find the section that renders the
     linked journal entry (shown when `invoice.journalEntryId` is set) —
     it lists «رقم القيد» and each line with account, debit, credit.
  5. Cross-check the entry's total debit against the invoice's own grand
     total.
- **Expected:** the invoice carries a non-null journal-entry id, and the
  linked entry is viewable from the invoice itself, no navigation to
  `journals` required. The entry's total debit (AR line) equals the
  invoice's grand total exactly, and its credit side splits revenue and
  output-VAT lines that sum to the same total.
- **False pass:** the invoice flips to a confirmed status and the tab
  renders, but the journal-entry section shows nothing because the id was
  never set on confirm — check the DOM, not just the status pill.

### MTP-ACC-12 — Confirm a purchase invoice: can you inspect its journal entry from the document? (gap)
- **Persona / permission:** `purchases.invoice.confirm`,
  `accounting.journal.view`.
- **Preconditions:** a draft purchase invoice for a seeded supplier.
- **Steps:**
  1. Open `purchase-invoices`, confirm a draft invoice via «تأكيد الفاتورة».
  2. On the confirmed invoice's detail, enumerate every tab: بنود
     (lines), تكاليف الشحن (landed costs), المرفقات (attachments),
     المدفوعات (payments). There is no journal-entry tab.
  3. Go to `journals` and search by the invoice's number.
- **Expected:** step 2 confirms the purchase invoice document has no
  direct link to its own posted entry — its wire contract carries no
  journal-entry id field at all, unlike sales invoices, purchase returns,
  vouchers, stock documents and landed costs, which all do. Step 3 finds
  the entry indirectly: the domain stamps the source document number with
  the invoice number, and the server's search matches on it, so searching
  the invoice number in Journals surfaces it. The entry's total debit
  still equals the invoice's base-currency grand total.
- **False pass:** treating this as "no entry was posted" — it was; the
  gap is that the invoice document offers no click-through to it. This is
  the accountant's own dealbreaker in exact form: a document whose
  accounting entry you cannot inspect from the document, only via a
  workaround.

### MTP-ACC-13 — Confirm a treasury voucher and inspect its journal entry
- **Persona / permission:** treasury voucher create/confirm (create posts
  immediately on save).
- **Preconditions:** an open receivable on a seeded customer.
- **Steps:**
  1. Open `treasury-vouchers`, click «سند جديد».
  2. Choose type «تحصيل من عميل» (customer collection), pick the customer,
     the treasury account, and an amount less than or equal to their open
     balance.
  3. Save/confirm the voucher.
  4. On the voucher detail, find the section rendered when its journal
     entry id is set.
- **Expected:** the voucher shows its own posted entry inline. Its debit
  side (cash/bank) equals its credit side (AR, account 1105) exactly, and
  both equal the voucher amount. If the voucher was allocated against an
  invoice, the invoice's «المتبقي» (remaining balance) drops by exactly
  the allocated amount.
- **False pass:** the voucher's status flips and the invoice's status
  label changes, but no journal entry section renders — a status flip
  with no posting behind it is this codebase's most common historical bug
  class.

### MTP-ACC-14 — Confirm a stock adjustment and inspect its GL tab
- **Persona / permission:** `inventory.adjustment.confirm`,
  `accounting.journal.view`.
- **Preconditions:** a seeded item with on-hand stock in a warehouse.
- **Steps:**
  1. Open `stock-adjustments`, click «تسوية جديدة».
  2. Pick reason «تلف» (Damage) — direction OUT, counterpart account 5070.
  3. Enter a quantity less than on-hand and a warehouse.
  4. Confirm the adjustment.
  5. Open the confirmed adjustment's GL tab.
- **Expected:** the tab shows a balanced entry crediting inventory
  (account 1200) and debiting 5070 (or the reason's mapped account) for
  exactly quantity × the item's moving-average cost at the time of the
  adjustment. That value equals the drop in the item's stock valuation
  shown on `report-inventory-valuation` for the same item/warehouse, run
  before and after.
- **False pass:** the adjustment's status changes and on-hand quantity
  drops, but the GL tab is empty — stock moved and nothing posted. Also
  check that every one of the 8 adjustment reasons maps to a real GL
  account, since a reason that posts nothing would silently break
  inventory-vs-GL-1200 agreement.

### MTP-ACC-15 — Confirm a sales return and check the reversal against the original invoice
- **Persona / permission:** `sales.return.confirm`.
- **Preconditions:** a confirmed sales invoice from MTP-ACC-11.
- **Steps:**
  1. Open `sales-returns`, create a return against that invoice for one
     line, partial quantity.
  2. Confirm the return.
  3. Open the return's journal entry (it carries its own journal-entry id).
  4. Reopen the original invoice and re-check its «المتبقي» / outstanding
     figure.
- **Expected:** the return's entry debits revenue and output VAT
  proportionally and credits AR (1105) for exactly the returned line's
  value including its share of tax. The original invoice's outstanding
  balance is grand total minus allocated minus confirmed returns — confirm
  the return amount is actually subtracted from it.
- **False pass:** the return posts and the return document itself looks
  correct, but the invoice's own outstanding figure does not drop — the
  return moved the GL and stood still in the invoice's own sub-ledger
  view.

### MTP-ACC-16 — Cancel/reverse a confirmed voucher — never a delete
- **Persona / permission:** voucher reverse permission.
- **Preconditions:** the voucher from MTP-ACC-13, confirmed and posted.
- **Steps:**
  1. Open the voucher.
  2. Look for a delete control — there should be none on a confirmed
     document.
  3. Click «عكس السند».
  4. Re-open the invoice it was allocated to.
- **Expected:** the voucher's status becomes «معكوس», a new reversing
  journal entry posts (mirror of the original), and the invoice's
  outstanding balance is restored by exactly the amount that was
  previously allocated. Verify both sides: the voucher's own remaining/
  allocated figure and the invoice's remaining balance move back together.
- **False pass:** the voucher shows «معكوس» but the invoice's outstanding
  balance stays at the post-collection figure — the allocation reversed on
  one side only.

### MTP-ACC-17 — Stock transfer confirms with no GL entry (valuation-neutral, by design)
- **Persona / permission:** `inventory.transfer.confirm`.
- **Preconditions:** an item with stock in warehouse A.
- **Steps:**
  1. Open `stock-transfers`, create a transfer of some quantity from
     warehouse A to warehouse B.
  2. Confirm it.
  3. Check for a journal-entry id on the confirmed document.
  4. Run `report-inventory-valuation` for the item, filtered first to
     warehouse A then to warehouse B, before and after the transfer.
- **Expected:** the journal-entry id is null — a transfer moves quantity,
  not value, between warehouses and is deliberately valuation-neutral.
  Warehouse A's value drops by exactly quantity × its moving-average cost
  and warehouse B's value rises by the identical figure; the tenant-wide
  inventory valuation total is unchanged to the piastre.
- **False pass:** treating a null journal-entry id here as a defect — it
  is correct for this document type. The actual check is whether the
  tenant-wide valuation total moved (it must not) and whether warehouse
  A's drop exactly equals warehouse B's rise.

### MTP-ACC-18 — Landed cost document posts with a supplier/AP dimension
- **Persona / permission:** `inventory.landed_cost.confirm`.
- **Preconditions:** a confirmed goods receipt/purchase invoice with stock
  already received.
- **Steps:**
  1. Open `landed-costs`, create a landed cost against that receipt,
     allocating freight across 3 lines by value.
  2. Confirm it.
  3. Open its journal entry.
  4. Open the supplier the freight/customs vendor was billed to and check
     their statement.
- **Expected:** the entry debits inventory (raising the cost basis of
  stock already received) and credits an accrued landed-cost payable with
  a real supplier dimension recorded against it, so the amount shows on
  that supplier's statement/balance and on `report-aging-suppliers`. The
  three allocated line amounts sum exactly to the entered freight total —
  no piastre lost or gained across the split.
- **False pass:** the entry balances and posts, but the payable has no
  supplier attached — it exists in GL 2100 and on no supplier's account, a
  genuine dealbreaker.

### MTP-ACC-19 — Depreciation run shows its journal entry
- **Persona / permission:** `assets.depreciation.run`.
- **Preconditions:** a seeded fixed asset with a depreciation schedule.
- **Steps:**
  1. Open the depreciation runs screen (assets module), run a period's
     depreciation.
  2. Open the run's detail and read the line that shows its journal-entry
     id under «journalEntry».
  3. Navigate to `journals` and open that same id.
- **Expected:** the id shown on the run matches a real, postable entry —
  debiting depreciation expense and crediting accumulated depreciation for
  exactly the period's computed charge. The figure equals the sum of
  per-asset depreciation shown in the run's own line list.
- **False pass:** the id string renders but the entry it names 404s — a
  displayed id is not proof the entry exists; open it.

### MTP-ACC-20 — A confirmed-but-uninvoiced goods receipt legitimately outruns GL 1200
- **Persona / permission:** `purchases.receipt.confirm`,
  `accounting.reports.view`.
- **Preconditions:** a confirmed purchase order.
- **Steps:**
  1. Open `goods-receipts`, confirm a receipt against the order (goods
     received, no purchase invoice yet).
  2. Run `report-inventory-valuation` for the received item.
  3. Open `reconciliation` and check the inventory row.
  4. Confirm the corresponding purchase invoice against the receipt.
  5. Re-check the reconciliation row.
- **Expected:** at step 3, the item's valuation rose, but the receipt
  itself posts no GL entry — a purchase invoice is what triggers the
  posting. The reconciliation screen's inventory row shows a genuine,
  expected difference until the invoice is confirmed. At step 5, the
  sub-ledger and GL figures converge — the difference from step 3
  disappears exactly.
- **False pass:** reporting step 3's difference as a defect on its own —
  it only becomes one if it fails to close after the invoice confirms.

---

## Part 3 — Sub-ledger vs control account

### MTP-ACC-21 — Balance Reconciliation: every row matched on a clean tenant
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** freshly seeded tenant, no manual postings yet.
- **Steps:**
  1. Open `reconciliation`.
  2. Read the banner: «جميع الأرصدة متطابقة» or «توجد فروقات تحتاج إلى
     مراجعة».
  3. Open the summary tab and read each row: inventory vs GL 1200, AR vs
     GL 1105, AP vs GL 2100.
- **Expected:** on a freshly seeded tenant every row's sub-ledger balance
  equals the ledger balance to the piastre — الفرق column reads 0.00 on
  all three.
- **False pass:** a row reads "matched" with a rounded display that hides
  a sub-piastre difference — check the raw difference string from the API,
  not just the pill.

### MTP-ACC-22 — A manual line posted directly to a control account surfaces as unlinked
- **Persona / permission:** `accounting.journal.post`,
  `accounting.reports.view`.
- **Preconditions:** none beyond the seed.
- **Steps:**
  1. On `journals`, post a manual balanced entry with one line against
     account 1105 (AR control) and the offsetting line against a detail
     account — a manual write-in unrelated to any actual invoice.
  2. Open `reconciliation` → «القيود غير المرتبطة» tab.
  3. Re-check the AR reconciliation row.
  4. Reverse the manual entry and confirm the reconciliation row and
     unlinked count both return to their pre-scenario values.
- **Expected:** the manual line appears in «القيود غير المرتبطة» (the
  count increments by exactly 1), because any manual-source line hitting a
  control account is flagged. The AR row's difference now equals exactly
  the amount just posted, and its status flips to «غير متطابق». After the
  reversal in step 4, both figures return to their prior values.
- **False pass:** the manual posting succeeds (it should — nothing stops
  it) but it does not appear in the unlinked tab — the detection mechanism
  itself would be broken, and this is the exact tool an accountant relies
  on to catch this class of mistake.

### MTP-ACC-23 — Customer statement's sub-ledger and aging badges
- **Persona / permission:** `sales.customer.view`.
- **Preconditions:** MTP-ACC-11 (confirmed invoice) and MTP-ACC-13
  (partial collection against it).
- **Steps:**
  1. Open `customers`, open the same customer, go to tab «كشف حساب».
  2. Read الرصيد الافتتاحي، إجمالي المدين، إجمالي الدائن، الرصيد الختامي.
  3. Read the two status pills: sub-ledger match and aging match.
  4. Cross-check الرصيد الختامي against the customer's balance shown in
     the `customers` list row for the same customer.
  5. Run `report-aging-customers`, find the same customer's total.
- **Expected:** the statement's closing balance, the list row's balance,
  and the aging report's total for this customer must all agree — three
  independent figures that are historically prone to disagreeing because
  one sums a subtree and another counts trade AR specifically. If they
  diverge, ask what each is counting before assuming an arithmetic bug.
- **False pass:** the "matches" pill reads green because its own internal
  comparison happens to match (it excludes opening balance on both sides),
  while the displayed closing balance (which includes opening balance)
  disagrees with the aging report or the list row — read the actual
  numbers, not just the pill colour.

### MTP-ACC-24 — Supplier statement equivalent
- **Persona / permission:** `purchases.supplier.view`.
- **Preconditions:** MTP-ACC-12 and a partial payment voucher against it.
- **Steps:** mirror MTP-ACC-23 on `vendors` → «كشف حساب المورد», cross-
  checked against `report-aging-suppliers` and the reconciliation screen's
  AP row.
- **Expected:** same three-way agreement as MTP-ACC-23, on the payable
  side; the statement's own two match pills both read matched.
- **False pass:** same trap as MTP-ACC-23 — a matched self-check pill does
  not guarantee the closing balance itself ties to the other two reports.

### MTP-ACC-25 — Inventory valuation reconciles to GL 1200 after a costed movement
- **Persona / permission:** `inventory.valuation.view`,
  `accounting.reports.view`.
- **Preconditions:** MTP-ACC-14 (a confirmed stock adjustment).
- **Steps:**
  1. Run `report-inventory-valuation`, note the tenant-wide total value.
  2. Open `reconciliation`, read the inventory row's ledger balance
     (GL 1200).
- **Expected:** the two figures are identical to the piastre — the
  valuation report's total and GL 1200's balance are the same fact stated
  two ways.
- **False pass:** they agree in aggregate while `report-inventory-drift`
  (which reconciles per document, not per line) shows a nonzero drift for
  one item that happens to cancel out against another — always also check
  the drift report per item, not only the tenant total.

### MTP-ACC-26 — A customer/supplier opening balance never reaches GL 1105/2100
- **Persona / permission:** `sales.customer.create`,
  `purchases.supplier.create`, `accounting.reports.view`.
- **Preconditions:** none.
- **Steps:**
  1. Open `customers`, create a new customer with الرصيد الافتتاحي
     (opening balance) = `5000.00`.
  2. Save. Open the customer's statement tab and confirm the opening line
     shows 5,000.00.
  3. Open `reconciliation` and note the AR row's both figures before and
     after step 1.
  4. Run `financial-reports` → ميزان المراجعة (trial balance), find
     account 1105's balance before and after step 1.
- **Expected:** the customer's own statement and balance reflect the
  5,000.00 opening balance immediately, but neither the AR reconciliation
  row nor GL account 1105's trial-balance figure moves by that amount —
  creating a customer with an opening balance posts no journal entry at
  all. The correct path for a balance that must land in the GL is the
  data-migration wizard's customer step plus its historical-sales-invoices
  step, which does route through an opening-balance equity account.
- **False pass:** treating the customer's own statement looking correct as
  proof the books are right — the customer is owed correctly on their own
  page while GL 1105 permanently understates total receivables by exactly
  5,000.00 until an accountant separately books it. This is a real finding
  to bring to the chartered-accountant persona, not a workflow to silently
  work around.

---

## Part 4 — Reconciliation: bank, cash, cheques

### MTP-ACC-27 — Import a bank statement CSV
- **Persona / permission:** `treasury.reconciliation.import`.
- **Preconditions:** a seeded bank-type treasury account; a small CSV file
  with date/amount/description columns.
- **Steps:**
  1. Open `bank-reconciliation`, click the import action.
  2. Pick the bank treasury account.
  3. Upload the CSV; map its columns (date format YYYY-MM-DD, DD/MM/YYYY
     or MM/DD/YYYY).
  4. Submit.
- **Expected:** a new statement row appears with status «مستورد»
  (imported), line count matching the CSV's row count exactly, and the
  column mapping persists per-account (re-opening import for the same
  account pre-fills the same mapping).
- **False pass:** the import "succeeds" but silently drops rows whose
  required column was blank — check the imported line count against the
  file's row count, not just the success toast.

### MTP-ACC-28 — Auto-match statement lines against posted vouchers/cheques
- **Persona / permission:** `treasury.reconciliation.match`.
- **Preconditions:** MTP-ACC-27's imported statement; at least one posted
  voucher whose amount/date matches a statement line.
- **Steps:**
  1. Open the imported statement.
  2. Click the auto-match action.
  3. Review the matched vs. still-unmatched line counts.
- **Expected:** every line whose amount and date correspond to a posted
  treasury movement is matched, and the statement's status advances to
  «قيد المطابقة» once at least one line is matched but not all. Matched
  count plus unmatched count always equals the total line count from
  MTP-ACC-27.
- **False pass:** a line is marked matched against the wrong voucher (same
  amount, different date/party) — open a few matched pairs by hand and
  confirm the counterpart is the correct document, not a same-amount
  coincidence.

### MTP-ACC-29 — Manually match a remaining line
- **Persona / permission:** `treasury.reconciliation.match`.
- **Preconditions:** MTP-ACC-28 left at least one line unmatched.
- **Steps:**
  1. Open the statement's candidates for the unmatched line.
  2. Pick the correct candidate and confirm the match.
- **Expected:** the line moves from unmatched to matched; the unmatched
  count drops by exactly 1.
- **False pass:** the match posts but does not affect the reconciliation's
  own running unreconciled-difference figure — the statement's summary
  total should track matched-vs-total exactly.

### MTP-ACC-30 — Unmatch a line
- **Persona / permission:** `treasury.reconciliation.match`.
- **Preconditions:** MTP-ACC-29's matched line.
- **Steps:** open the matched line's row menu, unmatch it.
- **Expected:** the line returns to unmatched, matched count drops by 1,
  and the underlying voucher/cheque it had been matched to is untouched —
  its own status and GL entry are unaffected by an unmatch.
- **False pass:** unmatching also reverses or alters the treasury
  document's own GL entry — it must not; matching is purely administrative
  bookkeeping over already-posted facts.

### MTP-ACC-31 — Finalize a bank reconciliation and confirm it locks
- **Persona / permission:** `treasury.reconciliation.finalize`.
- **Preconditions:** a statement with every line matched.
- **Steps:**
  1. Finalize the statement.
  2. Attempt to match/unmatch a line on the now-finalized statement.
- **Expected:** status becomes «مكتمل», and match/unmatch actions on its
  lines are refused — finalize is meant to be a real lock, not a label.
- **False pass:** the status pill reads «مكتمل» but the match/unmatch
  buttons remain clickable and change the finalized statement's lines
  anyway — a "closed" reconciliation that still accepts edits is the same
  class of defect as a closed period that accepts a posting.

### MTP-ACC-32 — Cheque lifecycle: pending → deposit → collect, with GL at each step
- **Persona / permission:** `cheques.create`, `cheques.deposit`,
  `cheques.collect`.
- **Preconditions:** an incoming cheque recorded against a customer
  collection (accounts: counterparty 1105, under-collection 1320, bounced
  1360).
- **Steps:**
  1. Open `cheques`, click «شيك جديد», record an incoming cheque.
  2. Note status «قيد الانتظار» and its one legal action «إيداع في
     البنك».
  3. Click it; pick a bank account.
  4. Note the new status and its legal action «تأكيد التحصيل».
  5. Click it.
- **Expected:** each transition posts its own balanced entry: deposit
  moves the receivable from 1105 into 1320 (شيكات تحت التحصيل); collect
  moves 1320 into the bank account. At every step the cheque's own amount
  equals the debit and credit of that step's entry exactly, and the
  legal-action set shown matches the cheque's current status exactly — no
  action appears that the domain's own state machine would reject.
- **False pass:** the status pill advances through all 7 derived UI states
  correctly while no journal entry backs one of the transitions — check
  the GL side at every step, not just the pill.

### MTP-ACC-33 — Cheque bounce then replace (incoming only)
- **Persona / permission:** `cheques.bounce`, `cheques.create`.
- **Preconditions:** MTP-ACC-32's cheque, deposited (status «مودع»).
- **Steps:**
  1. Click «تسجيل ارتداد».
  2. Confirm the only legal follow-up for an incoming bounced cheque is
     «استبدال الشيك» (an outgoing bounced cheque has none).
  3. Replace it with a new cheque.
- **Expected:** the bounce moves the amount from 1320 into 1360 (شيكات
  مرتدة) — AR itself is untouched by an incoming bounce; it only
  reclassifies within 1320/1360. The replacement cheque carries the same
  amount and reverses 1360 back out once deposited again.
- **False pass:** a bounce on an incoming cheque re-inflates AR (1105)
  instead of only reclassifying within 1320/1360 — that would
  double-count the receivable that was never actually lost, only delayed.

---

## Part 5 — Fiscal period close

### MTP-ACC-34 — Close an open period
- **Persona / permission:** period close permission (row menu «إغلاق» on
  an open period).
- **Preconditions:** `fiscal-periods`, current month's period status
  «مفتوحة».
- **Steps:**
  1. Open `fiscal-periods`, find the current period, its posting column
     reading «مسموح» (allowed).
  2. Row menu → «إغلاق».
- **Expected:** status flips to «مغلقة», the posting pill flips to «غير
  مسموح», and the closed-periods stat card increments by exactly 1 while
  the open-periods stat card drops by exactly 1.
- **False pass:** the pill changes but a document dated inside that period
  can still be confirmed — always pair this scenario with MTP-ACC-35/36.

### MTP-ACC-35 — Post a manual journal entry dated into a closed period (must be blocked)
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** MTP-ACC-34's now-closed period.
- **Steps:**
  1. On `journals` → «قيد جديد», set تاريخ القيد to a date inside the
     closed period.
  2. Fill balanced lines.
  3. Click «ترحيل القيد».
- **Expected:** the server rejects the post with a period-not-open error
  (HTTP 422), and the UI surfaces the server's own message in Arabic, not
  a raw status code. No row is added to the journal-entries list.
- **False pass:** the entry posts because the client never actually sent
  the backdated date (e.g. a date picker silently clamped it back to
  today) — verify the request body's date field in the network tab
  genuinely falls inside the closed period before treating a rejection as
  proven.

### MTP-ACC-36 — A late invoice dated into a closed period (document confirm, not manual JE)
- **Persona / permission:** `sales.invoice.confirm`.
- **Preconditions:** MTP-ACC-34's closed period; a draft sales invoice
  dated inside it.
- **Steps:**
  1. Create a sales invoice with تاريخ الفاتورة inside the closed period.
  2. Attempt «تأكيد الفاتورة».
- **Expected:** confirm is refused with the same period-gate error the
  manual journal entry hit — the fiscal-period gate applies uniformly to
  every posting path, not something each document type reimplements. The
  invoice stays «مسودة» and no journal entry is created for it.
- **False pass:** the invoice confirms and posts because sales-invoice
  confirm resolves the period from the current wall-clock date rather than
  the invoice's own date — re-date the invoice to a period that is open
  today but was closed as of the invoice's own date, to catch a
  wall-clock-vs-document-date substitution specifically.

### MTP-ACC-37 — Lock a closed period
- **Persona / permission:** period lock permission.
- **Preconditions:** MTP-ACC-34's closed period.
- **Steps:** row menu on the closed period → «قفل».
- **Expected:** status flips to «مقفلة»; the locked-periods stat card
  increments by 1. The row menu on a locked period offers no actions at
  all.
- **False pass:** the row menu still offers «إعادة فتح» on a locked
  period — reopen must only ever be legal from «مغلقة», never from
  «مقفلة».

### MTP-ACC-38 — Locked is terminal: no unlock exists
- **Persona / permission:** any.
- **Preconditions:** MTP-ACC-37's locked period.
- **Steps:**
  1. Confirm the row menu is empty for this row.
  2. Attempt `POST /fiscal-periods/:id/reopen` directly against the
     locked period's id.
- **Expected:** the direct API call is refused — the three-state machine
  treats locked as terminal, with no unlock action and no permission for
  one, by design. The period's status is unchanged by the attempt.
- **False pass:** the API call silently succeeds and flips a locked
  period back to closed — that would make "locked" purely decorative and
  let a filed, audited month be reopened.

### MTP-ACC-39 — Cannot lock an open period directly, skipping close
- **Persona / permission:** period lock permission.
- **Preconditions:** a period currently «مفتوحة».
- **Steps:**
  1. Confirm the row menu on an open period offers only «إغلاق», never
     «قفل».
  2. Call `POST /fiscal-periods/:id/lock` directly against an open
     period's id.
- **Expected:** the UI never exposes lock on an open row, and the direct
  API call is refused — locking an open period directly is rejected so the
  reversible close step is never skipped.
- **False pass:** the API accepts it, silently jumping مفتوحة → مقفلة and
  skipping the reversible مغلقة stage entirely.

### MTP-ACC-40 — Generate the next fiscal year
- **Persona / permission:** whatever gates generating a fiscal year.
- **Preconditions:** the seeded tenant's periods end at some known year.
- **Steps:**
  1. On `fiscal-periods`, click «إنشاء السنة التالية».
  2. Switch the year selector to the newly created year.
- **Expected:** 12 new periods appear, all «مفتوحة», sequential من/إلى
  date ranges with no gaps and no overlaps against the prior year's last
  period.
- **False pass:** the periods generate but with an off-by-one month
  boundary (e.g. a leap-year mismatch, or a one-day gap/overlap at a year
  boundary) — check the actual start/end date strings, not just the count
  of 12.

### MTP-ACC-41 — Year-end close: preview matches the posted entry, revenue/expense zero out
- **Persona / permission:** `accounting.period.close`.
- **Preconditions:** every period in a target year is «مغلقة» (or at
  least the tenant has posted revenue/expense in that year); the year-end
  close card embedded at the top of `fiscal-periods` for the selected
  year.
- **Steps:**
  1. Select the year in the year selector on `fiscal-periods`.
  2. Read the card's إيرادات مقفلة / مصروفات مقفلة / صافي الربح-أو-خسارة
     figures — the preview, computed before anything posts.
  3. Note whether any period in the year is still «مفتوحة» — the warning
     banner should appear.
  4. Pick a retained-earnings equity account (3900 «الأرباح المرحلة» is
     pre-selected if it exists) and click «إقفال السنة المالية», then
     «تأكيد الإقفال».
  5. Reload the card.
- **Expected:** once posted, the card shows the entry number instead of
  the button — closing is idempotent, a second attempt for the same year
  is refused. Its صافي الربح figure equals the income statement's net
  income for the same year exactly. After posting, run `financial-reports`
  → ميزان المراجعة for the first day of the next year: every revenue and
  expense account reads exactly 0.00, and account 3900's balance increased
  by exactly the net result figure from the preview.
- **False pass:** the entry posts but revenue/expense accounts are not
  actually zero on the next trial balance — the close computed the right
  number without actually resetting the accounts it named.

---

## Part 6 — The month-end report pack

### MTP-ACC-42 — Trial balance balances, and says so
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** any state; ideally after MTP-ACC-01 through
  MTP-ACC-20 have posted a mix of manual and automatic entries.
- **Steps:**
  1. Open `trial-balance-report` (also a tab inside `financial-reports`).
  2. Read the balance banner (balanced or unbalanced wording).
  3. Sum every row's مدين column and every row's دائن column by hand (or
     via the exported file).
- **Expected:** the banner's claim and your own hand-sum agree exactly —
  total debit column sum equals total credit column sum to the piastre.
  The banner must be derived from the same reconciliation the report
  computed, not a separately eyeballed claim.
- **False pass:** the banner reads balanced while the exported rows,
  summed independently, are off by a rounding difference the on-screen
  banner's tolerance silently swallowed — re-sum from the raw export, not
  the rendered totals.

### MTP-ACC-43 — Income statement: current period vs. comparative
- **Persona / permission:** `accounting.reports.view`.
- **Steps:**
  1. On `financial-reports` → قائمة الدخل, set من/إلى to the current
     month.
  2. Toggle the comparative column if present.
  3. Cross-check صافي الربح against the trial balance's own revenue-minus-
     expense balances for the same period.
- **Expected:** the comparative (prior-period) column shows real, nonzero
  figures for a tenant with prior-period activity.
- **False pass:** the comparative column shows a plausible-looking number
  that is actually the current period's figure repeated — compare it
  independently by re-running the report with من/إلى set to the prior
  period explicitly.

### MTP-ACC-44 — Balance sheet balances (assets = liabilities + equity)
- **Persona / permission:** `accounting.reports.view`.
- **Steps:** open `financial-reports` → الميزانية العمومية as of today;
  sum total assets, and separately sum total liabilities + total equity
  (including MTP-ACC-41's retained earnings movement, if run).
- **Expected:** total assets equals total liabilities plus total equity
  exactly — the fundamental identity the report's own arithmetic must
  hold, not just at a convenient reporting date.
- **False pass:** the report balances only because retained earnings is a
  plug figure derived from the identity itself rather than the actual
  posted 3900 balance — cross-check 3900's own GL balance against what the
  balance sheet displays for it; if the ledger never posted to 3900 (no
  year-end close run yet), the balance sheet's equity section is
  computing retained earnings rather than reporting a posted fact
  (documented, not a bug on its own — but verify which case you're in).

### MTP-ACC-45 — Cash flow statement reconciles opening to closing cash
- **Persona / permission:** `accounting.reports.view`.
- **Steps:** open `financial-reports` → التدفقات النقدية for the current
  month; note الرصيد الافتتاحي and الرصيد الختامي for cash, and
  independently sum every treasury account's own balance (cash and bank
  types) via `treasury-accounts` at both period boundaries.
- **Expected:** the report's opening and closing cash figures match the
  independently summed treasury-account balances at the same two dates
  exactly.
- **False pass:** the closing figure matches but only because operating,
  investing and financing activities were computed to force it (a plug) —
  spot-check one or two individual line items (e.g. a specific voucher's
  cash effect) against the category it landed in.

### MTP-ACC-46 — VAT return: output/input split, not a single blended figure
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** at least one sales invoice (14% or another rate) and
  one purchase invoice posted in the period.
- **Steps:** open `financial-reports` → إقرار ضريبة القيمة المضافة for the
  period; read صافي الضريبة المستحقة/القابلة للاسترداد.
- **Expected:** the net figure equals output VAT minus input VAT for
  confirmed documents in the period, and — critically — if the tenant has
  mixed-rate invoices (14%, 5%, zero-rated), understand that the report
  re-derives a single blended rate per entry rather than reading a stored
  per-line rate. A mixed-rate month's displayed rate is an average, not a
  real statutory rate — do not accept it as a per-line audit trail.
- **False pass:** treating the net payable figure itself as wrong because
  the rate shown looks unfamiliar (e.g. ~6.3% instead of 14%) — that is
  documented blended-rate behaviour, not necessarily an arithmetic error;
  verify the net EGP amount independently by summing invoice-level tax
  columns before concluding either way.

### MTP-ACC-47 — Withholding tax report
- **Persona / permission:** `accounting.reports.view`.
- **Steps:** open `financial-reports` → the tax/withholding tab for the
  period; cross-check against any purchase invoice or voucher on which
  withholding was recorded.
- **Expected:** figures on the report trace back to real posted documents.
- **False pass / known gap:** no voucher field, account or UI captures
  withholding at the point of payment — if the report shows anything for
  this tenant, verify it against an actual posted line rather than
  assuming the number is sourced; if the tenant has never recorded
  withholding, the report should read empty, not a placeholder figure.

### MTP-ACC-48 — General ledger, on-demand, full dump
- **Persona / permission:** `accounting.reports.view`.
- **Steps:** open `financial-reports` → دفتر الأستاذ العام; note it is
  explicitly on-demand (a «عرض التقرير» click, not auto-computed on tab
  switch); run it for the current month.
- **Expected:** every posted entry in the period appears exactly once,
  grouped by account, with running balances that agree with each
  account's own ledger balance at period end.
- **False pass:** the on-demand button appears to do nothing on a second
  click within the same session (a stale cached result silently reused
  instead of re-running) — change the date range and re-click to confirm
  the report actually re-queries.

### MTP-ACC-49 — Account ledger (statement) for one control account
- **Persona / permission:** `accounting.reports.view`.
- **Steps:** open `financial-reports` → دفتر حساب; pick account 1105 (AR)
  from the real chart-of-accounts-backed picker; run for the month.
- **Expected:** the account's opening balance, every movement line, and
  closing balance are shown, and the closing balance equals what
  `GET /gl/accounts/1105/ledger` reports for the same date — the same
  figure `reconciliation`'s AR row reads.
- **False pass:** none of the three surfaces (this report, the reconcile
  screen, the raw ledger endpoint) actually share a source and two of them
  quietly diverge by a few piastres — this scenario exists specifically to
  catch that.

### MTP-ACC-50 — Cost Center P&L totals reconcile to the income statement
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** at least one voucher or manual entry carrying a
  cost-centre id (see Part 7).
- **Steps:** open `cost-center-pl` for the current month; sum every row's
  الإيرادات and المصروفات columns, including the «غير مخصص» (unassigned)
  bucket row.
- **Expected:** the grand total of الإيرادات across all cost centres
  (assigned plus unassigned) equals total revenue on the income statement
  for the same period exactly, and likewise for expenses — the unassigned
  bucket exists precisely so this total always reconciles even when most
  postings carry no cost centre.
- **False pass:** the per-cost-centre rows sum to a total smaller than the
  income statement's revenue because postings carrying a cost centre that
  has since been deactivated or deleted are silently dropped rather than
  falling into «غير مخصص».

---

## Part 7 — Cost centres

### MTP-ACC-51 — Create a cost centre and assign it on a treasury voucher
- **Persona / permission:** cost-centre create permission,
  `treasury.voucher.create`.
- **Steps:**
  1. Open `cost-centers`, click «إضافة مركز تكلفة»; create one (e.g.
     «فرع المهندسين»), optionally parented under a header cost centre.
  2. Open `treasury-vouchers` → «سند جديد», type «other_expense», and set
     مركز التكلفة to the one just created.
  3. Confirm the voucher.
- **Expected:** the voucher's posted journal entry carries that cost-
  centre id on its expense line (visible in the entry's own line data).
- **False pass:** the voucher form accepts a cost-centre selection but the
  posted entry's line shows a null cost-centre id — the field was
  collected and dropped before reaching the ledger, the exact shape of a
  wire contract silently stripping a dimension the report needs later.

### MTP-ACC-52 — Cost Center P&L reflects the assigned posting
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** MTP-ACC-51.
- **Steps:** open `cost-center-pl`, scan for the new cost centre's row.
- **Expected:** its المصروفات column includes exactly the voucher's
  amount from MTP-ACC-51, and no other row's total changed as a result.
- **False pass:** the amount appears under «غير مخصص» instead of the named
  cost centre — the report grouped by a cost-centre id it did not
  actually receive.

### MTP-ACC-53 — Manual journal lines cannot carry a cost centre (posting-side consequence)
- **Persona / permission:** `accounting.journal.post`.
- **Steps:** post a manual entry (as in MTP-ACC-01) hitting an expense
  account that would normally carry a cost centre when the same account is
  hit by a voucher; check the entry's line for a cost-centre id.
- **Expected/known gap:** the field is null — confirmed already in
  MTP-ACC-09; this scenario shows the consequence: a manual correction to
  an expense account cannot be attributed to a cost centre, so
  `cost-center-pl` cannot fully account for hand-posted corrections —
  they always land in «غير مخصص», correct for the report but a real
  limitation for anyone trying to true up a cost centre's P&L by hand.

---

## Part 8 — Multi-currency

### MTP-ACC-54 — Add and approve a foreign exchange rate
- **Persona / permission:** `accounting.exchange_rate.manage` to add,
  `accounting.exchange_rate.approve` to approve.
- **Steps:**
  1. Open `exchange-rates`, click «إضافة سعر صرف».
  2. Pick USD, type a rate (e.g. `50.25`), set تاريخ السريان to today.
  3. Save — note status «بانتظار الاعتماد».
  4. Row menu → «اعتماد».
- **Expected:** status flips to «معتمد». A rate in «بانتظار الاعتماد»
  cannot be spent — the FX engine refuses a pending rate, so any document
  trying to use it before approval should be blocked or fall back rather
  than silently spending an unapproved number.
- **False pass:** a document posts using the pending rate's value anyway
  — check which rate's numeric value the resulting entry's currency-rate
  field actually carries.

### MTP-ACC-55 — Lock an approved rate; it becomes immutable
- **Persona / permission:** `accounting.exchange_rate.approve`.
- **Preconditions:** MTP-ACC-54's approved rate.
- **Steps:**
  1. Row menu → «قفل» (or the lock action if surfaced).
  2. Attempt to add a new rate for the same currency and effective date
     via the create route, using the same id as the locked rate.
- **Expected:** the locked rate's status and value are unchanged by the
  second call — a create route that upserts by id must not rewrite a
  locked rate and silently reset its status back to pending; confirm the
  rate's status and numeric value both before and after the second call.
- **False pass:** the UI shows no way to attempt this (no visible re-add
  path) — that only proves the screen doesn't expose the hole; test the
  route directly with elevated permissions.

### MTP-ACC-56 — FX revaluation preview posts nothing
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** at least one open foreign-currency customer or
  supplier balance (requires a document that actually recorded a non-EGP
  currency and rate — see Gaps §4 if none exists in this tenant).
- **Steps:**
  1. Open `revaluation`, set تاريخ القيد to month-end, pick currencies (or
     leave «الكل»).
  2. Click «معاينة».
  3. Check the journal-entries count before and after.
- **Expected:** the preview table lists every open foreign balance with
  its closing rate, carrying value and gain/loss, but posts nothing — the
  journal-entry count is identical before and after «معاينة».
- **False pass:** clicking «معاينة» silently also posts — worth a
  dedicated check because the preview and the post share almost the same
  request shape.

### MTP-ACC-57 — FX revaluation post creates an auto-reversing entry
- **Persona / permission:** `accounting.journal.post`.
- **Preconditions:** MTP-ACC-56's preview, with «العكس التلقائي» on.
- **Steps:** click «ترحيل التقييم»; note the confirmation banner's entry
  number and reversal number.
- **Expected:** a gain/loss entry posts against accounts 4900/5900 only,
  and a second entry auto-dated the next day fully reverses it — so the
  revaluation's effect never survives past the one date it was computed
  for. The reversal's total debit equals the original's total credit
  exactly.
- **False pass:** the reversal is promised in the UI copy but no second
  entry actually exists on `journals` for the next day — check by
  navigating there directly, not by trusting the success banner's
  wording.

### MTP-ACC-58 — Balances-by-currency panel: base vs. transaction amount
- **Persona / permission:** `accounting.reports.view`.
- **Steps:** on `revaluation`, scroll to «أرصدة العملاء» /
  «أرصدة الموردين» by currency; for one foreign-currency party, note
  المبلغ بعملة المعاملة and المبلغ بالعملة الأساسية.
- **Expected:** transaction amount divided by base amount equals the rate
  the originating document was booked at (not necessarily today's rate) —
  confirming the sub-ledger preserves the booking-date rate per document
  rather than silently restating everything at today's rate outside of an
  explicit revaluation run.
- **False pass:** every foreign balance shows the same implied rate
  regardless of when each underlying document was raised — a sign the
  screen is dividing by today's rate rather than reading the rate each
  document actually stamped.

---

## Gaps — no screen to test

Each of these is a real path a chartered-accountant or QuickBooks-trained
accountant would expect, with no operable control (or no supporting
contract) in this tree to test it against. Recorded here instead of forced
into a scenario above.

1. **No attachment on a manual journal entry.** The attachment entity-type
   contract (`packages/contracts/src/attachments.ts`) enumerates `item`,
   `customer`, `supplier`, `employee`, `sales-invoice`, `sales-quote`,
   `sales-return`, `purchase-invoice`, `purchase-order`, `goods-receipt`,
   `stock-adjustment`, `stock-transfer`, `work-order`, `voucher` — there is
   no `journal-entry` entity type at all, so a supporting document (a
   scanned receipt, an accrual working paper) can never be attached to a
   manual entry. The reference catalog
   (`docs/archive/catalog/04-accounting-treasury.md` §"قيد يومية")
   documents a المرفقات tab on the journal-entry detail panel that this
   build never implements.

2. **No recurring/template journal entries.** No screen, route, or domain
   concept for a recurring entry (e.g. monthly rent accrual, standard
   depreciation memo) exists anywhere in `apps/web/src/screens/` or
   `packages/api/src/gl-routes.ts` — every month's accrual has to be typed
   from scratch on `journals` → «قيد جديد».

3. **No cost centre, currency or tax-rate field on the manual journal
   entry form**, even though the line schema accepts all three and the
   automatic posting paths (vouchers for cost centre, FX revaluation for
   currency) exercise them. The create form only collects account, memo,
   debit, credit per line and date/memo at the header. An accountant
   correcting an auto-posted entry's cost centre by hand, or booking a
   foreign-currency accrual manually, has no field to do it with (covered
   as negative scenarios at MTP-ACC-09 and MTP-ACC-53; the underlying UI
   gap has no forward path to test — there is nothing to click).

4. **No document route stamps `currency`/`fxRate` on its own postings.**
   The FX revaluation engine itself is complete and correct, but no sales
   invoice, purchase invoice, or voucher route currently sets a non-EGP
   currency/rate on the lines it posts — a `currency: "USD"` document
   still posts its numbers as if they were EGP. MTP-ACC-56 through 58
   depend on at least one real foreign-currency open balance existing to
   preview against; if none can be created through any document screen in
   this tenant, those three scenarios cannot be driven past the "preview
   an empty list" state, and that emptiness is itself the finding, not a
   false negative in the revaluation engine.

5. **No "save as draft" control on the journal entry create screen.** The
   API supports a genuine draft-then-post two-step flow
   (`POST /gl/journal-entries/draft` then `POST /gl/journal-entries/:id/
   post`), and the journal list's own status chips (مسودة، بانتظار
   الموافقة) imply a multi-state lifecycle exists — but the create screen
   exposes only one primary action, «ترحيل القيد» (post immediately). An
   entry cannot be parked half-entered and returned to later from the UI;
   MTP-ACC-04 above reaches draft status only by calling the API directly.

6. **No approval step for a journal entry above a threshold.** The status
   vocabulary (مسودة → بانتظار الموافقة → مرحل) suggests a workflow gate
   was intended for journal entries specifically, matching the reference
   catalog's description, but no workflow input or workflow-config screen
   currently wires an amount threshold to journal posting — the journal
   post permission is the only gate, held or not held by a user's role,
   with no amount-based routing.

7. **No customer/supplier statement export or print button** distinct from
   the browser's own print — the reference implies a dedicated تصدير
   affordance on some financial statements (trial balance, income
   statement, balance sheet, cash flow) but not on `customers`/`vendors`
   statement tabs; an accountant emailing a customer their كشف حساب has no
   one-click export from that screen today.
