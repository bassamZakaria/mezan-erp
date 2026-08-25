# 09 — Cross-module money trails

Every other file in this directory tests one module. This one tests the seams:
what has to be true **between** modules when a single business event travels
through them. Buy something and the money must leave the خزنة. Sell something
and it must arrive in the bank. Nothing in a single-module test can catch a
company whose sales module says one thing and whose treasury says another.

**Executable half**: `scripts/scenarios/cross-module.ts`, run with
`pnpm scenarios cross-module` (or `pnpm scenarios` for every suite). It runs
**last** — it spends stock and cash — and every id it creates is prefixed
`SCN-X-`.

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

## Not yet executable — run these by hand

These cross seams `cross-module.ts` does not reach yet, written the same way so
they can be executed later without being redesigned. Ids follow the same
`SCN-X-` convention. Where a known defect makes a scenario unprovable, that is
said up front — the scenario still documents the seam.

### X23 — Foreign-currency purchase, then revaluation
Crosses: exchange rates ▸ purchases ▸ GL ▸ financial reports.

- **Pre**: an approved USD rate on the invoice date (`POST /exchange-rates` then `POST /exchange-rates/:id/approve`), a supplier, a stock item.
- **Steps**: create a purchase invoice with `currency: "USD"` at that rate → confirm → record a **later, higher** USD rate and approve it → `POST /revaluation/preview` for the period end → `POST /revaluation/post`.
- **Assert**: the invoice's own foreign-currency total never changes — a revaluation restates the base currency, not the debt. The preview's `delta` per account equals `foreignAmount × (closingRate − bookedRate)` recomputed by hand, and `totalGain − totalLoss` equals the posted entry's net. The posted entry debits/credits the AP control account against the FX gain/loss account only: **GL 1200 must not move** — revaluation is not a cost of inventory. Trial balance still balances. With `autoReverse` on, a mirror entry exists dated `reversalDate`, and running the same revaluation again after that reversal produces the same figure rather than a doubled one.
- **Watch**: AP's sub-ledger figure is built in base currency from invoice totals, so **D18**'s blind spot applies here too — record the reconciliation diff before and after rather than assuming it should hold.

### X24 — An unapproved exchange rate must not be spendable
Crosses: exchange rates ▸ approvals ▸ sales/purchases ▸ GL.

- **Pre**: the seed's unapproved ("pending") USD and EUR rates.
- **Steps**: try to confirm a foreign-currency document against a **pending** rate → approve the rate → confirm a second, identical document → then lock the rate (`POST /exchange-rates/:id/lock`) and try to change it.
- **Assert**: the first confirm is refused, and refused for that reason by name, not a generic failure. The second converts at exactly the approved rate. A locked rate cannot be edited or re-approved. Crucially, approving or later changing a rate does **not** restate a document that already posted — re-read the first document's totals and its journal entry and confirm both are byte-for-byte what they were.

### X25 — POS session → treasury
Crosses: POS ▸ inventory ▸ treasury ▸ GL. **Deferred by decision**: only `GET /pos/sales` exists — there is no route to open a session, sell through it, or close it. Write the scenario; expect it to be unrunnable until POS ships.

- **Steps (intended)**: open a session with an opening float from a treasury account → make a cash sale and a card sale → close the session declaring the counted cash.
- **Assert (intended)**: stock falls by what was sold; the session's declared cash equals the float plus its cash sales; closing moves exactly that into the branch خزنة, and the card takings into the bank/clearing account instead — never both into the same one; every POS sale reaches the same AR/revenue/VAT accounts a normal invoice does, so the VAT return and the income statement include them without a separate reconciliation.
- **Watch**: this is the same shape as **D22** (a document recording cash that the treasury never received). Check it explicitly rather than assuming POS is wired differently.

### X26 — Project → cost centre → P&L
Crosses: projects ▸ cost centres ▸ GL ▸ reports.

- **Pre**: a project linked to a cost centre (`CC-DEMO-1`), which in the seed carries no transactions at all.
- **Steps**: post a manual journal entry whose expense line sets `costCenterId` (the treasury voucher form has **no** cost-centre field, so an expense paid by voucher cannot be tagged — that is itself the finding to record) → run `GET /cost-center-pl` for the period → run the income statement for the same period.
- **Assert**: the cost-centre P&L shows the expense once, under that centre, at the exact amount posted; the income statement's total expense includes it once; the sum of every cost centre's P&L plus untagged postings equals the income statement total — no expense is counted twice and none disappears because it was untagged.
- **Watch**: if a voucher-paid expense genuinely cannot be tagged, say so with the measured evidence (the create-voucher contract has no `costCenterId`), because it means the cost-centre report can never see the majority of real spending.

### X27 — Branch scope, end to end
Crosses: users/roles ▸ every document module ▸ treasury ▸ reports. **Currently unprovable** — **D7** (no list route reads `branchScope`) and the demo tenant has one branch. Seed a second branch first, or this scenario proves nothing either way.

- **Steps**: create a second branch with its own warehouse and treasury account → post a sale, a purchase and a voucher in each branch → call the document lists, the treasury account list, the dashboard and the trial balance with `x-branch-scope` set to one branch, then the other, then `*`.
- **Assert**: each scoped call returns strictly its own branch's documents; the two scoped results are disjoint and together equal the `*` result, row for row and figure for figure. The dashboard's cash tile under one branch equals that branch's treasury accounts alone. No route silently ignores the header — a route that returns the same rows for both branches is the finding.

### X28 — Promotion → revenue → VAT
Crosses: promotions ▸ sales ▸ tax ▸ reports.

- **Pre**: an active promotion whose rule matches a seeded item or category.
- **Steps**: confirm an invoice whose lines qualify → read the invoice, the promotions report (`GET /promotions/report`) and the VAT return → deactivate the promotion (`POST /promotions/:id/deactivate`) → re-read all three.
- **Assert**: the discount is applied **before** VAT, so output tax is 14% of the discounted net, not the list net; the invoice records which promotion applied and at what amount; the promotions report counts that invoice once; the VAT return's output side equals GL 2200's own movement for the same period. After deactivation the historical invoice, its journal entry, the report row and the VAT figure are all unchanged — deactivating a promotion must never restate what it already granted.

### X29 — Confirming a document should reach the ETA queue
Crosses: sales ▸ e-invoicing ▸ audit. **Known gap — D5**: `EtaService.enqueue` exists but no route or event bridge calls it, so the queue is empty however many documents are confirmed.

- **Steps**: read `GET /eta/submissions` → confirm a sales invoice → read it again.
- **Assert (what should happen)**: the confirmed invoice appears as a queued submission carrying its own document number and total; submitting it moves it to submitted and records the response; accepting it stamps the invoice; excluding one removes it from the queue without touching the invoice. **Assert (what happens today)**: the queue is identical before and after — record the count both times as the evidence, do not re-file D5.

### X30 — Events, notifications and webhooks across modules
Crosses: every document module ▸ notification rules ▸ webhooks ▸ audit.

- **Pre**: a notification rule and a webhook subscription on an event a document actually emits (`GET /webhooks/events` lists the emitted codes; only those may be subscribed).
- **Steps**: confirm a document that emits that event → read `GET /notifications` and `GET /webhooks/:id/deliveries` → then point a subscription at an endpoint that fails, and confirm another document.
- **Assert**: the notification exists once per rule match, addressed to the right recipients, and marking it read does not affect anyone else's copy. The webhook delivery is attempted, its retries are bounded, and — the cross-module point — **a failing or retrying webhook never rolls back, blocks or duplicates the document that triggered it**: re-read that document and its journal entry and confirm both posted exactly once. The audit trail records the confirming actor and branch for the document, separately from the delivery attempts.
