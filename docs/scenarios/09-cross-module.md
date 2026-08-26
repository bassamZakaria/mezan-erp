# 09 — Cross-module money trails

Every other file in this directory tests one module. This one tests the seams:
what has to be true **between** modules when a single business event travels
through them. Buy something and the money must leave the خزنة. Sell something
and it must arrive in the bank. Nothing in a single-module test can catch a
company whose sales module says one thing and whose treasury says another.

**Executable half**: `scripts/scenarios/cross-module.ts`, run with
`pnpm scenarios cross-module` (or `pnpm scenarios` for every suite). It runs
late — it spends stock and cash — and every id it creates is prefixed `SCN-X-`.

**Second executable half**: `scripts/scenarios/seams.ts` (`pnpm scenarios seams`)
covers the seams the money trails cannot reach — currency, tax, compliance,
concurrency, permissions and year-end. It runs **last** of all, prefixes its ids
`SCN-S-`, and is written up under "Currency, tax, compliance and platform seams"
below.

**Sources**: the module scenarios `01`–`08` for each leg, `docs/catalog/04`
(الخزينة) for the treasury rules, and the wiring in
`packages/backend/src/create-backend.ts` where the modules are actually joined.

---

## The three questions every trail asks

1. **Did the money move, once, in the right direction?** The خزنة/bank is GL
   `1300-1` / `1310`; a treasury screen renders that same balance. If a document
   claims to have been paid, that number must move by exactly the amount.
2. **Did the sub-ledger and the ledger stay in step?** `/reconciliation` compares
   the inventory, AR and AP sub-ledgers against GL 1200 / 1105 / 2100. A trail
   that moves one and not the other is broken even when both look fine alone.
3. **Do the books still balance afterwards?** Trial balance debit = credit, and
   assets = liabilities + equity. Checked before and after every scenario by the
   harness itself.

**Before you start**: read `docs/defects.md`. D1 (a collection voucher never
updates the invoice's `amountPaid`) reaches into most of the trails below, and
several assertions here exist to record its blast radius, not to re-file it.

---

## Setup the file performs first

Earlier suites leave approval gates configured — `platform.ts` on
`SALES_RETURN_CONFIRM`, `accounting.ts` on `TREASURY_VOUCHER_CONFIRM`. A gated
document is held `pending` mid-trail and **no route in the product ever posts an
approved-but-held document** (platform.ts's own finding), so a money trail run
behind those gates measures a journey that stopped halfway. This file deletes
those two gates before it starts, and says so in its output.

---

## Cash and bank — the core question

### X0 — Capital injection funds the خزنة
- **Steps**: confirm a `capital_injection` voucher for 250,000 into the cash treasury.
- **Assert**: GL 1300-1 rises by exactly 250,000; equity 3100 rises by exactly the same; nothing else moves.

### X1 — Sell something → the money lands in the bank
- **Steps**: open stock on a new item → confirm a sales invoice (10 × 100 + 14% VAT) → confirm a `customer_collection` voucher **into the bank** → allocate it to that invoice.
- **Assert**: stock falls by the sold quantity; AR rises by the grand total; revenue takes the net and 2200 the tax; COGS takes quantity × unit cost. Confirming the invoice moves **no** money at all. Only the collection moves the bank, by exactly 1,140, and the خزنة stays untouched. AR nets back to zero over the pair.
- **Known**: the invoice's own `amountPaid` stays 0 — **D1**.

### X2 — Buy something → the money leaves the خزنة
- **Steps**: PO → confirm → goods receipt → confirm → supplier invoice → confirm → `supplier_payment` voucher **from cash** → allocate it.
- **Assert**: receiving goods moves stock with no GL and no money; the invoice puts the net into 1200, the tax into 1400 and the gross into AP; only the payment moves the خزنة, by exactly 2,280; AR/AP net out.
- **Finds**: **D18** — the AP sub-ledger never subtracts the payment.

### X3 — A cash sale
- **Assert**: the خزنة rises by the grand total, the bank does not move at all, AR nets to zero across invoice and collection.

### X4 — خزنة → bank transfer
- **Assert**: source falls, destination rises, by the identical amount; cash + bank together is unchanged — a transfer is a move, not income.

### X5 — The overdraft guard, and the switch that is supposed to govern it
- **Steps**: try to pay out more cash than the خزنة holds → switch `منع الرصيد السالب للحسابات النقدية` **off** in Settings → re-read it → retry the very same voucher.
- **Assert**: the first attempt is refused and the balance is untouched; with the setting off, the same voucher should post.
- **Finds**: **D19** — it is still refused. The setting is a dead switch.

### X16 — Reversal puts the money back everywhere
- **Assert**: reversing a confirmed expense returns the خزنة **and** the expense account to their exact prior balances, the trial balance to its prior state, and marks the voucher `reversed` rather than deleting it.

### X18 — Company-wide money conservation
- **Assert**: over the whole file, `cash + bank` moved by exactly the net of every receipt and payment the file posted — named and totalled in the failure message if it does not.

---

## Returns and refunds

### X6 — Sales return → refund out of the خزنة
- **Assert**: the return restocks the goods and drops AR, and refunds **nothing** — it sits `awaiting refund`. Only the separate `customer_refund` voucher moves the خزنة, by exactly the return's grand total.

### X7 — Purchase return → refund from the supplier
- **Assert**: stock leaves, AP falls by the return's grand total, no money moves; the `supplier_refund` receipt then raises the خزنة by exactly that amount.
- **Finds**: **D18** again, from the other side.

### X8 — Paid by cheque
- **Steps**: sale → record an incoming cheque → deposit → collect.
- **Assert**: receiving the cheque already clears AR and parks the value in 1320 شيكات تحت التحصيل; **depositing does not credit the bank**; only collection does, and 1320 empties back to where it started.

---

## Cost that travels

### X9 — Landed cost changes what the next sale costs
- **Steps**: buy 100 units at 10 → confirm → add a 500 landed cost BY_VALUE → sell 20.
- **Assert**: unit cost rises by exactly 5, inventory value by exactly 500 (no rounding leak), and COGS on the later sale charges 20 × 15 — the landed cost, not the invoice price.

### X13 — Manufacturing moves value, it does not create it
- **Steps**: BOM → work order → issue 20 raw at 25 → receive 10 finished → complete → sell 3.
- **Assert**: raw material genuinely leaves the warehouse; each finished unit carries the 50 of material it consumed; COGS on the sale charges the manufactured cost.

### X14 — Write-down hits the P&L through a provision
- **Assert**: expense 5060 and provision 1190 both take the run's total; **GL 1200 is deliberately untouched**, so the stock sub-ledger and its control account stay reconciled; the entry balances.

---

## Tax, payroll, assets

### X10 — Both halves of VAT
- **Assert**: a sale's tax reaches 2200 and a purchase's reaches 1400, the VAT return's two sides move by exactly what the ledger recorded, and a `tax_payment` voucher lowers the bank and the VAT payable by the same amount — paying tax settles a liability, it is not an expense.

### X11 — HR spends the same خزنة everyone else does
- **Steps**: request → approve → disburse an employee advance from the cash treasury.
- **Assert**: the خزنة falls by exactly the advance; the disbursement is a real treasury voucher, visible in the treasury module like any other — one treasury, not one per module.

### X12 — A fixed asset bought with company money
- **Assert**: paying for it moves the bank; registering it touches neither stock nor cash; the depreciation run includes it, posts a balanced entry for the run's own total, and costs the business value without costing it cash.

---

## Gates and agreement

### X15 — Closing a period stops every module
- **Steps**: draft a sales invoice, a purchase invoice, a treasury voucher and a journal entry → close August → try to post all four → reopen → retry.
- **Assert**: all four are refused with a period error, nothing slips through, and the same voucher posts once the period reopens.
- **Finds**: **D20** (the purchase invoice answers 500, not 422) and **D21** (that crash still moved the stock).

### X17 — The dashboard reports the money the ledger holds
- **Assert**: the dashboard's cash, receivables and payables tiles equal an independent recomputation over every postable account of the right kind, on its natural side, as of the same date.

### X19 — A credit limit is a cross-module fact
- **Assert**: with credit control in BLOCK mode, an invoice past the customer's limit is refused and one inside it confirms.
- **Finds**: paying in full through the treasury does **not** free the limit up again — credit control reads `amountPaid`, which D1 never updates. A customer who always pays by voucher silently freezes at their limit.

### X20 — Instalments on a real invoice
- **Assert**: the schedule's lines sum to exactly invoice total − down payment; the down payment is an ordinary treasury voucher that raises the خزنة and lowers AR.
- **Known**: collecting money never marks an instalment line paid — no route does (docs/scenarios/06 INST-08).

### X21 — A van trip is a custody transfer
- **Assert**: opening the trip really moves the stock into the van warehouse and the float into the van treasury; settling prices both variances and hands the counted cash back to the branch.
- **Finds**: **D22** — roadside sales recorded on the trip post nothing to the van treasury, yet settling transfers the full counted cash out of it, so every completed trip drives the van's cash account down by its own takings.

### X22 — The bank statement must agree with the vouchers
- **Assert**: an imported CSV parses its lines, auto-match links the ones a voucher explains, the unexplained bank fee stays unmatched, and reconciling moves no money and posts nothing.

---

## Go-live, compliance and platform seams (executable)

### X31 — Importing history must not re-post it
Crosses: data migration ▸ purchases ▸ inventory ▸ GL.

- **Steps**: dry-run then commit a purchase-history batch — one fully-paid document, one half-paid.
- **Assert**: the dry run classifies settled vs outstanding and computes remaining = total − paid. The commit archives both, moves **no** stock, adds **no** inventory value, posts at most one journal entry for the whole batch, and leaves the archives readable. AP rises by the outstanding balance only.
- **Finds**: **D23** — AP rises by nothing at all.

### X32 — The same rule on the sales side
- **Assert**: no stock leaves for goods delivered before go-live; AR rises by what customers still owe and by nothing else.
- **Finds**: **D23** again — every migrated customer starts owing zero.

### X33 — VAT is not one rate
Crosses: items ▸ sales ▸ tax ▸ GL.

- **Steps**: one invoice with a 14% line and a 5% line; then an invoice for a **tax-exempt** customer.
- **Assert**: tax is 14% of one base plus 5% of the other — never a blended rate over the total — and GL 2200 takes exactly that. The exempt flag overrides the line's own rate: tax total is zero, no output VAT posts, and the goods are still billed in full.
- **Why it matters**: Egypt's standard rate is 14% with a 5% reduced band, and exempt bodies are common. A per-document tax rate would quietly overcharge one of them.

### X34 — A document-level discount, to the piastre
- **Steps**: three lines of 33.33 / 33.33 / 33.34 with a 10% invoice discount.
- **Assert**: VAT is charged on the **discounted** base (14% of 90), the grand total is 102.60, the posted entry balances, AR is debited with the discounted total, and COGS is unchanged — a discount never alters what the goods cost.

### X35 — The same confirm, twice
- **Assert**: retrying a confirm with the same `requestId` never posts twice — stock falls once, AR rises once, and the invoice carries one document number and one journal entry.

### X36 — Branch scope, with a real second branch
- **Steps**: create a second branch, warehouse and stock; sell from it; read the invoice list under each `x-branch-scope`.
- **Assert**: **D7 measured rather than inferred** — every scope returns the identical rows, and a caller scoped to the first branch can read the second branch's invoice. Warehouse scope, by contrast, genuinely narrows — proving the two are independent mechanisms and only one is wired.

### X37 — A backdated document changes the past, not the present
- **Assert**: a July-dated entry posted while July is open restates July's income statement, leaves August's untouched, reaches the cumulative ledger, and does not break the aging report's date handling.

### X38 — Module licensing is designed but not enforced
- **Assert**: manufacturing, fixed assets, installments, field sales and HR all answer 200 for a caller with no entitlement. `createModuleGate` (403 `MODULE_NOT_LICENSED`) exists and `hasModule` exists; there is no call site in `create-backend.ts`, so the licensing model in `plan.md` §2.5 is unenforced at runtime. Nothing in the API can express "this tenant did not buy Manufacturing".

### X39 — Batch, expiry and what FEFO actually decides
- **Steps**: receive two batches of one item — cheap stock expiring next year, dearer stock expiring in two months — invoice them, then sell exactly one batch's worth.
- **Assert**: the earliest-expiring batch is consumed first (the expiring report shows it gone and the later one untouched), **and** COGS charges the blended weighted-average cost, not that batch's own. FEFO decides which goods leave; it does not price them. A pharmacy asking "what did the October batch cost me" cannot get that answer today — `plan.md` §6.3.6 leaves FIFO/batch costing open.

---

## Currency, tax, compliance and platform seams (executable)

`scripts/scenarios/seams.ts`, run with `pnpm scenarios seams`. It runs **after**
`cross-module.ts` — it closes periods, opens a fiscal year and sweeps forty
documents through the ledger — and prefixes every id it creates `SCN-S-`.

These are the seams the money trails could not reach: what happens when the
currency is not EGP, when the tax is not 14%, when two people confirm at the same
second, when the permission is not `*`, and when the year ends. Several assert a
gap on purpose: the assertion states the business requirement, and where the
product cannot meet it the check is inverted and labelled with the measured
evidence, so a fix flips it back rather than deleting it.

### X23 — A foreign-currency balance, revalued at the closing rate
Crosses: exchange rates ▸ GL ▸ financial reports ▸ purchases.

- **Pre**: an approved USD rate on the transaction date (48.00) and a higher approved rate at month end (52.00).
- **Steps**: book a USD 1,000 liability with `currency`/`fxRate` on the GL line → `POST /revaluation/preview` → `POST /revaluation/post` with `autoReverse` → preview again.
- **Assert**: the foreign amount is recomputed from the booked base (48,000 ÷ 48 = 1,000 USD); the restatement is exactly 1,000 × (52 − 48); a liability that grew is a **loss**, never a gain; the entry debits the FX loss account and credits the liability by the same 4,000; **GL 1200 does not move**; the auto-reversal mirrors it on the first of the next month, so the live balance returns to what was actually booked; re-running the same revaluation reports the same figure, not a doubled one.
- **Measured**: the revaluation engine is correct end to end. What is not: a *document* cannot carry a foreign balance at all — a `currency: "USD"` purchase invoice posts EGP 1,000 for USD 1,000 with both GL lines untagged (**D24**). The engine has nothing to revalue because nothing upstream speaks currency.

### X24 — An unapproved rate must not be spendable
Crosses: exchange rates ▸ approvals ▸ GL.

- **Steps**: record a pending EUR rate → revalue against it → approve it → revalue again → lock it → re-POST the same id with a different rate.
- **Assert**: revaluing against a **pending** rate is refused by name (`FX_RATE_MISSING`), not generically; once approved the same revaluation converts at exactly the approved rate; a locked rate cannot be changed.
- **Measured**: the first two hold — `findRate` filters to `approved`/`locked`, so an unapproved rate is genuinely unspendable. The third does not: re-POSTing a locked rate's id rewrites the rate **and resets its status to pending** (**D25**), because the create route upserts by id.

### X26 — Project ▸ cost centre ▸ P&L
Crosses: cost centres ▸ GL ▸ reports.

- **Steps**: post a journal entry whose expense line sets `costCenterId` → read `/cost-center-pl` and the income statement → then pay an expense through a **treasury voucher** carrying the same `costCenterId`.
- **Assert**: the tagged expense appears once under its centre and once in the income statement; every posted expense sits in exactly one bucket, tagged or untagged, so the report reconciles.
- **Measured**: tagging works for journal entries. The voucher's `costCenterId` is dropped at the wire — `createVoucherSchema` has no such field — and the 400 lands in غير مخصص (**D26**). Since almost nothing a business spends is entered as a manual journal entry, the cost-centre report is blind to most real spending.

### X28 — Promotion ▸ revenue ▸ VAT ▸ history
Crosses: promotions ▸ sales ▸ tax ▸ reports.

- **Steps**: create an item-scoped 10% promotion → confirm a qualifying invoice → read the invoice, the promotions report and GL 2200 → deactivate the promotion → re-read all three.
- **Assert**: the discount comes off the gross before VAT (VAT is 14% of 900, not of 1,000); revenue is recognised net; the invoice records **which** promotion applied; the report counts it exactly once at the discount actually granted; after deactivation the invoice, its posted VAT and the report row are unchanged.
- **Measured**: all of it holds. Deactivating a promotion does not restate what it already granted — the applied promotion is snapshotted on the invoice at confirm.

### X29 — Confirming a document should reach the ETA queue
Crosses: sales ▸ e-invoicing.

- **Steps**: configure ETA fully with `autoSubmitOnConfirm: true` → confirm a real invoice → re-read `/eta/submissions`.
- **Measured**: the setting is stored and read by nothing; the queue is byte-identical before and after (**D5**, do not re-file). A tenant can complete e-invoicing setup, confirm invoices all day, and submit none of them.

### X30 — One confirm, many listeners
Crosses: sales ▸ notifications ▸ webhooks ▸ GL.

- **Steps**: create a notification rule on `SALES_INVOICE_CONFIRMED` and a webhook pointed at an endpoint that cannot answer → confirm an invoice → read the inbox, the deliveries and the journal entry → confirm again.
- **Assert**: one notification per matching rule (no storm, no rule firing twice); a user no rule addresses gets nothing; the failed delivery is recorded as failed rather than swallowed or optimistically marked successful; the document stays confirmed, its entry posts once in full, and a second confirm is refused rather than posting again.
- **Measured**: holds. A dead webhook cannot roll back, duplicate or halve the document that triggered it.

### X45 — Withholding tax on local payments
- **Steps**: look for a WHT-payable account, pay a supplier net with `withholdingAmount`/`grossAmount` supplied, ask for a withholding report, then model it by hand.
- **Measured**: no account, no field, no report (**D27**). The voucher stores the **net**, so the supplier's ledger shows them still owed the withheld amount the tenant is legally holding for the authority. The only workaround is a hand-written journal entry per payment.

### X46 — VAT rules that are not "14% of everything"
- **Steps**: confirm one invoice with 14%, 5% and zero-rated lines → run the VAT return → try to express a partial taxable base on a tax rate.
- **Measured**: the ledger charges 140 + 50 + 0 correctly per line, and the **return** collapses them into one derived ~6.3% bucket (**D28**), because it recomputes rate = tax ÷ base per journal entry. A partial taxable base (the construction-contract 14%-on-36% treatment) cannot be expressed at all.

### X47 — A filed VAT period should not move under the filing
- **Steps**: run July's return → look for any way to record it as filed → post a backdated July entry → re-run the return → close the period and try again → reopen.
- **Measured**: no filing state exists anywhere (**D29**); the already-"filed" figure moves by exactly 140.00 with no amendment or warning. Period close *does* refuse the same posting — the mechanism works, nothing ties it to the tax filing, and reopening needs no reason and leaves no tax-side trace.

### X52 — Rounding, swept rather than sampled
- **Steps**: generate forty service invoices across awkward prices (33.33, 0.005, 10.005, 1.115, 99.995, 123.456), quantities (1/3/7/11), rates (14/5/0) and percent discounts (10 / 33.33 / 90 / 7.5), then four three-way instalment splits.
- **Assert**: every one confirms; each line extends to the piastre and those rounded lines sum to the gross; subtotal − invoice discount = the taxable base; grand total = taxable + tax; every posted entry balances; a three-way instalment split of an indivisible total sums back to the total.
- **Measured**: holds for all forty, and for the splits. X34 and X9 each prove one case; this proves the rule.

### X56 — Two people, one second
- **Steps**: draft eight invoices, confirm all eight concurrently, then close the period and attempt a ninth confirm.
- **Assert**: eight distinct numbers, the counter advanced by exactly eight, and the refused confirm burned no number.
- **Measured**: holds. Numbering is allocated inside the confirm transaction, so a refused confirm leaves no gap for an auditor to ask about.

### X57 — Branch-prefixed numbering
- **Steps**: create a second branch and warehouse, confirm a sale in each.
- **Measured**: the two branches share one tenant-global counter and no prefix says where a document came from (**D33**); the sequence definition has no branch dimension to configure. Open product decision (`plan.md` §6.3.8), now measured rather than assumed.

### X58 — Permissions are a graph, and some are sensitive
- **Steps**: call the API as a `sales.invoice.confirm` holder, a plain `sales.invoice.view` holder, and an `hr.contract.view` holder.
- **Assert**: the dependency graph is enforced server-side; `view_own` narrows to the caller's own documents; a caller without `view_cost` sees the document with its costs **hidden**, not an error; salary obeys the same rule.
- **Measured**: only the first holds. The `.confirm` holder is **403** on the list route (every read route gates `.view`), `view_own` narrows nothing, and both ⚠ sensitive permissions — `sales.invoice.view_cost` and `hr.employee.view_salary` — are checked by no route (**D31**).

### X59 — Arabic search must forgive Arabic
- **Steps**: create أحمد / فاطمة / ليلى, query the list route with `?q=احمد`, then run the screens' own filter expression over the same names.
- **Measured**: `?q=` is a parameter of no list route, so the full table comes back unchanged; the client-side `toLowerCase().includes(q)` every screen uses returns **zero** matches for احمد, فاطمه or ليلي (**D32**). The fix is one shared normalisation helper (أإآ→ا, ة→ه, ى→ي, strip tashkeel) used by both ends; it exists nowhere in the repo today.

### X61 — Every movement of money leaves a trace
- **Steps**: confirm a payment, reverse it, confirm a sale, then query `/audit`.
- **Assert**: each action writes a row naming the actor, the branch and the document.
- **Measured**: the actions ARE recorded — both halves of the payment, with a real actor. What is missing is *where*: the voucher names `BR-MAIN` and every row it wrote carries `branchId: null` (**D30**), because the audit sink reads the caller's scope rather than the document's branch. On a desktop install this trail is the only forensic record there is.

### X63 — Price list, promotion and credit limit in one document
- **Steps**: assign a customer a price list quoting 80 (item default 100), add a 20% promotion, set the credit limit **between** the un-promoted and promoted payable, then confirm — and separately send a line priced off-list.
- **Assert**: the promotion discounts the price-list price; the credit check sees the final payable, not an intermediate one.
- **Measured**: the ordering holds where the server can see it — 800 − 20% = 640, +14% = 729.60, and the credit check passed on 729.60 against an 800 limit rather than refusing on the pre-promotion 912. But the price list itself is never consulted: a line at 5.00 for an item listed at 80.00 is accepted without a warning (**D35**). The ordering is real only for as long as the UI remembers to apply it.

### X64 — Year-end
- **Steps**: generate FY2027 → look for a year-end close → compare the 2027 income statement, the revenue account, retained earnings and the balance sheet.
- **Assert**: the new year opens where the old one ended, revenue and expense accounts start at zero, and the prior year's comparatives still resolve.
- **Measured**: the twelve periods generate and open, and the reports window by date so 2027 correctly reads empty. But there is no year-end close anywhere in the product (**D34**): GL 4100 still carries 2026's revenue, GL 3900 never receives the profit, and the balance sheet balances only because the *report* derives retained earnings from the P&L accounts itself. The ledger alone can never tell you last year's result.

---

## Not yet executable — run these by hand

These cross seams `cross-module.ts` does not reach yet, written the same way so
they can be executed later without being redesigned. Ids follow the same
`SCN-X-` convention. Where a known defect makes a scenario unprovable, that is
said up front — the scenario still documents the seam.



### X25 — POS session → treasury
Crosses: POS ▸ inventory ▸ treasury ▸ GL. **Deferred by decision**: only `GET /pos/sales` exists — there is no route to open a session, sell through it, or close it. Write the scenario; expect it to be unrunnable until POS ships.

- **Steps (intended)**: open a session with an opening float from a treasury account → make a cash sale and a card sale → close the session declaring the counted cash.
- **Assert (intended)**: stock falls by what was sold; the session's declared cash equals the float plus its cash sales; closing moves exactly that into the branch خزنة, and the card takings into the bank/clearing account instead — never both into the same one; every POS sale reaches the same AR/revenue/VAT accounts a normal invoice does, so the VAT return and the income statement include them without a separate reconciliation.
- **Watch**: this is the same shape as **D22** (a document recording cash that the treasury never received). Check it explicitly rather than assuming POS is wired differently.


### X27 — Branch scope, end to end
**Superseded by X36**, which now creates a real second branch and measures it. What remains manual is the UI half: a user whose session grant is one branch must not be able to *widen* scope with the switcher, and the switcher must not offer branches the grant excludes.




---

## Egypt compliance — what the market actually requires

Written against the rules an Egyptian business is audited on, not against what
the product currently implements. Several of these will fail; that is the point
of writing them down before a customer does.

### X40 — ETA B2B: an invoice is not final until the ETA clears it
Crosses: sales ▸ e-invoicing ▸ printing.

- **Pre**: ETA configured, a confirmed sales invoice.
- **Steps**: confirm → submit → simulate each of the three outcomes: accepted, rejected, and still-pending.
- **Assert**: the invoice carries a visible submission state at all times, and the ETA UUID once accepted. A **rejected** submission must be loud — the invoice must not sit there looking compliant while the ETA has refused it. A pending one must be distinguishable from an accepted one on the document, in the list, and on anything printed. Nothing about clearance may silently alter the posted journal entry.
- **Today**: **D5** — no user action enqueues anything, so this whole flow is unreachable.

### X41 — ETA B2C: e-receipt within the window, and the QR on the paper
- **Assert**: a retail sale produces an e-receipt submitted within 72 hours (post-clearance, unlike B2B), and the printed receipt carries a QR code that resolves to the validated receipt. Reprinting must reproduce the same QR, never mint a new one.
- **Today**: POS does not exist (deferred), so this is specification, not test.

### X42 — The offline queue has a legal clock on it
Crosses: e-invoicing ▸ desktop edition ▸ shell.

- **Steps**: with no connectivity, confirm several invoices, then let time pass.
- **Assert**: the unsent queue shows a count **and the age of the oldest unsent document**; the warning escalates as that age approaches the statutory deadline; reconnecting drains the queue in document order and never submits the same document twice. `plan.md` §5.5 records this as an open product decision — the scenario exists so the decision cannot be forgotten.

### X43 — Registration threshold and late-submission penalties
- **Assert**: the tenant can record its ETA registration status and threshold basis, and the product warns when the tenant's own annual revenue crosses the registration threshold (EGP 250,000 since Resolution 281/2025). Late submissions must be countable — the ETA's penalties escalate on how many late submissions fall inside a rolling 12-month window, so a tenant needs that number visible, not buried.

### X44 — A credit note is an ETA document too
- **Assert**: a confirmed sales return produces its own submission, linked to the original invoice's UUID, and the VAT return nets it. A return that never reaches the ETA leaves the customer's input tax and the tenant's output tax permanently disagreeing.

### X45 — Withholding tax on local payments
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X46 — VAT rules that are not "14% of everything"
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X47 — A filed VAT period should not move under the filing
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

---

## Payroll — the statutory half that is deliberately absent

`docs/STATUS.md` records that payroll computes no Egyptian income tax, no social
insurance, no Article 47 seniority bonus, no end-of-service gratuity. These
scenarios test the **honesty** of that gap first, and the computation later.

### X48 — A payslip must say what it did not compute
- **Assert**: every payslip and payroll run states plainly, in Arabic, that statutory deductions are not included and that the net shown is therefore not the amount an employee should receive. STATUS calls this the highest-priority open item in HR: a number that is silently wrong is worse than a number that is missing.

### X49 — Social insurance is two liabilities, not one deduction
- **Assert (when built)**: the employee share reduces net pay and the employer share is a company cost; both credit separate liability accounts; the payroll journal entry balances with both present; paying the authority clears exactly those liabilities and the treasury by their sum.

### X50 — End of service reaches the ledger before it is paid
- **Assert (when built)**: gratuity accrues as a liability over service, terminating an employee settles it from that liability rather than as a fresh expense, and the P&L is not distorted in the month someone leaves.

### X51 — Legal constants are versioned data, not code
- **Assert**: leave presets and any statutory rate carry the law and article they came from and the date they took effect; adopting a new preset changes future calculations only and never restates a balance already earned under the old one. `plan.md` §6.2 lists Egyptian regulatory change as permanent recurring work — this scenario is what keeps it cheap.

---

## Integrity at scale — the risks `plan.md` §6.2 names

### X52 — Rounding, swept rather than sampled
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X53 — The same books on both engines
- **Assert**: a golden set of documents posted through SQLite and through Postgres produces identical ledgers to the minor unit — same balances, same rounding, same ordering. `plan.md` calls dual-dialect drift the worst class of bug this product can have; nothing else in this file would catch it.

### X54 — Five years of data, on a laptop
- **Assert**: with a five-year seeded tenant, each report returns inside its budget and none times out; the heavy ledger reports stay usable on-demand. Measure and record the numbers — a report that takes 40 seconds is a defect even when its figures are right.

### X55 — Restore is part of the product
- **Assert**: back up, destroy, restore — then compare the ledger, the sub-ledgers and every document count against the pre-backup state. `plan.md` §6.2 lists an untested restore path as total-data-loss risk for a desktop customer.

### X56 — Two people, one second
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X57 — Branch-prefixed numbering
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

---

## Platform seams

### X58 — Permissions are a graph, and some are sensitive
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X59 — Arabic search must forgive Arabic
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X60 — The desktop edition, genuinely offline
- **Assert**: with no network, the full document lifecycle works end to end — sell, buy, pay, report, print — and nothing fails silently or hangs. The only thing that may not complete is ETA transmission (X42), and it must say so.

### X61 — Every movement of money leaves a trace
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X62 — Delivery notes, if they arrive
- **Assert (design guard)**: stock currently leaves on invoice confirm. If delivery notes are introduced, the same goods must never be able to leave twice, and an invoice raised from a delivery note must not move stock again. `plan.md` §6.3.7 leaves this open — the scenario exists so the answer is chosen, not stumbled into.

### X63 — Price list, promotion and credit limit in one document
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X64 — Year-end
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

### X65 — The sales trail as a user clicks it: quote → accept → invoice → collect
**Now executable** — `scripts/scenarios/cross-module.ts` x40. One new customer with a credit limit, a quote for two items, accept, convert, confirm, collect. What it pins: a quote moves nothing; conversion lands a **draft** with no number; confirming charges AR, output VAT and COGS and drops stock; and the invoice's own «تحصيل دفعة» marks the invoice paid while posting **no journal entry at all** (D40), so the aging report and GL 1105 part company. D39 rides along: no screen can confirm that draft.

### X66 — The purchase trail as a user clicks it: order → receive → invoice from receipt → pay
**Now executable** — `scripts/scenarios/cross-module.ts` x41. The from-receipt invoice is created the way the screen creates it — `receiptId` with **no lines** — which is what exposes D42: the route's `resolveTaxRate` port is never wired, so every line is 0% VAT and input VAT never moves. Receiving raises stock without a GL entry (the sub-ledger legitimately runs ahead until the invoice), the invoice closes that gap, and paying the supplier through a voucher clears GL 2100 while the AP sub-ledger ignores it (D18).

---

## Sources for the compliance scenarios

- [Egypt E-Invoicing 2026: ETA Compliance Guide](https://datavalue.solutions/egypt-e-invoicing-eta-2026-sme-guide/) — registration threshold cut to EGP 250,000 (Resolution 281/2025), enforcement stage from 1 Jan 2026, graduated late-submission penalties.
- [Egypt E-Receipt Requirements: ETA Guide for 2026](https://invoicedataextraction.com/blog/egypt-e-receipt-requirements) — B2B pre-clearance vs B2C post-clearance within 72 hours, QR code on printed receipts.
- [PwC — Egypt, Corporate: Other taxes](https://taxsummaries.pwc.com/egypt/corporate/other-taxes) and [Withholding Tax in Egypt](https://www.flick.network/en-eg/withholding-tax-in-egypt) — withholding regime on local and cross-border payments.
- [VATupdate — Egypt VAT decrees effective October 2025](https://www.vatupdate.com/2025/11/19/vat-law-amendments-new-rules-for-construction-contracts-and-tax-obligations-in-egypt/) — 14% on 36% of value for pre-18-July-2025 construction contracts, no input deduction.
- [ERP Systems in Egypt: a 2026 guide](https://buildn.tech/en/blog/erp-system-egypt) and the competitive review already recorded in `docs/plan.md` §"Market & competitive notes" — what an Egyptian SMB buyer compares Mezan against.
