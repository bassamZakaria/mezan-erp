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
**Superseded by X36**, which now creates a real second branch and measures it. What remains manual is the UI half: a user whose session grant is one branch must not be able to *widen* scope with the switcher, and the switcher must not offer branches the grant excludes.

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
Crosses: purchases ▸ treasury ▸ tax ▸ reports.

- **Steps**: pay a supplier invoice where WHT applies — the payment is net, the withheld amount is owed to the tax authority.
- **Assert**: the payment voucher reduces AP by the **gross**, the treasury by the **net**, and credits a WHT-payable liability with the difference; the supplier's statement shows the invoice settled in full; a later payment to the authority clears the WHT liability; a WHT report lists what was withheld, from whom, for the filing.
- **Today**: no withholding concept exists anywhere in the domain — measure it and say so rather than assuming a customer will handle it manually.

### X46 — VAT rules that are not "14% of everything"
- **Assert**: the tax engine can express a rule that taxes a **portion** of the invoice value (the legacy construction-contract treatment taxes 14% on 36% of value with no input deduction), a 5% reduced-rate item, a zero-rated export, and an exempt supply — and the VAT return groups each correctly rather than collapsing them into one rate.
- **Today**: X33 proves per-line rates work. The rest are unmodelled.

### X47 — A filed VAT period should not move under the filing
- **Assert**: once a VAT return has been filed for a period, a backdated document into that period is either blocked or raised as an amendment — never silently absorbed. X37 proves backdating restates the past; this is the control that makes that safe. Fiscal-period close (X15) is the mechanism that exists today; the scenario is whether the VAT filing state is tied to it.

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
- **Steps**: generate hundreds of documents with awkward figures — three-way splits, 33.33s, 0.005 boundaries — across invoice discounts, per-line tax, landed-cost distribution, WAC recalculation, instalment schedules and FX conversion.
- **Assert**: for every one, the parts sum to the whole exactly. This is a property, not an example: X34 and X9 each prove one case; the sweep proves the rule.

### X53 — The same books on both engines
- **Assert**: a golden set of documents posted through SQLite and through Postgres produces identical ledgers to the minor unit — same balances, same rounding, same ordering. `plan.md` calls dual-dialect drift the worst class of bug this product can have; nothing else in this file would catch it.

### X54 — Five years of data, on a laptop
- **Assert**: with a five-year seeded tenant, each report returns inside its budget and none times out; the heavy ledger reports stay usable on-demand. Measure and record the numbers — a report that takes 40 seconds is a defect even when its figures are right.

### X55 — Restore is part of the product
- **Assert**: back up, destroy, restore — then compare the ledger, the sub-ledgers and every document count against the pre-backup state. `plan.md` §6.2 lists an untested restore path as total-data-loss risk for a desktop customer.

### X56 — Two people, one second
- **Assert**: concurrent confirms of different documents produce distinct, gap-free numbers with no collision; a confirm that fails must not burn a number (or, if it does, that behaviour is recorded deliberately rather than discovered by a customer whose audit shows a missing invoice number).

### X57 — Branch-prefixed numbering
- **Assert**: with two branches, each branch's documents number independently and predictably. Open decision (`plan.md` §6.3.8): the reference product's sequences are tenant-global, and multi-branch customers usually expect a branch prefix. X36 now provides the second branch this needs.

---

## Platform seams

### X58 — Permissions are a graph, and some are sensitive
- **Assert**: granting `.confirm` implies `.view_own` (the dependency graph is enforced server-side, not just in the role editor); a `view_own` holder sees their own documents and not a colleague's; a user without the cost-visibility permission sees a document with its costs **hidden**, not an error page; salary figures obey the same rule.

### X59 — Arabic search must forgive Arabic
- **Assert**: searching `احمد` finds `أحمد`, `آحمد` and `إحمد`; `فاطمه` finds `فاطمة`; `ليلي` finds `ليلى`; a mixed Arabic/English record is findable by either. Today the list routes take no query parameter at all — filtering happens in the browser — so this is a client-side test, and a normalization helper shared with the server is the fix if it fails.

### X60 — The desktop edition, genuinely offline
- **Assert**: with no network, the full document lifecycle works end to end — sell, buy, pay, report, print — and nothing fails silently or hangs. The only thing that may not complete is ETA transmission (X42), and it must say so.

### X61 — Every movement of money leaves a trace
- **Assert**: each money-moving action in this file — confirm, collect, pay, refund, reverse, disburse, settle — writes an audit row naming the actor, the branch, the document and the time. On the desktop edition the audit log is the only forensic record there is.

### X62 — Delivery notes, if they arrive
- **Assert (design guard)**: stock currently leaves on invoice confirm. If delivery notes are introduced, the same goods must never be able to leave twice, and an invoice raised from a delivery note must not move stock again. `plan.md` §6.3.7 leaves this open — the scenario exists so the answer is chosen, not stumbled into.

### X63 — Price list, promotion and credit limit in one document
- **Assert**: the customer's assigned price list beats the item's default price; an applicable promotion discounts the price-list price, not the list price; and the credit check sees the final payable figure, not any intermediate one. Three mechanisms, one number — each is tested alone elsewhere; only together do they prove the order of operations.

### X64 — Year-end
- **Assert**: closing a year rolls the P&L into retained earnings, opens the new year with a balance sheet that continues exactly where the old one ended, leaves revenue and expense accounts at zero on day one, and makes the prior year's comparatives on every report still resolve afterwards.

---

## Sources for the compliance scenarios

- [Egypt E-Invoicing 2026: ETA Compliance Guide](https://datavalue.solutions/egypt-e-invoicing-eta-2026-sme-guide/) — registration threshold cut to EGP 250,000 (Resolution 281/2025), enforcement stage from 1 Jan 2026, graduated late-submission penalties.
- [Egypt E-Receipt Requirements: ETA Guide for 2026](https://invoicedataextraction.com/blog/egypt-e-receipt-requirements) — B2B pre-clearance vs B2C post-clearance within 72 hours, QR code on printed receipts.
- [PwC — Egypt, Corporate: Other taxes](https://taxsummaries.pwc.com/egypt/corporate/other-taxes) and [Withholding Tax in Egypt](https://www.flick.network/en-eg/withholding-tax-in-egypt) — withholding regime on local and cross-border payments.
- [VATupdate — Egypt VAT decrees effective October 2025](https://www.vatupdate.com/2025/11/19/vat-law-amendments-new-rules-for-construction-contracts-and-tax-obligations-in-egypt/) — 14% on 36% of value for pre-18-July-2025 construction contracts, no input deduction.
- [ERP Systems in Egypt: a 2026 guide](https://buildn.tech/en/blog/erp-system-egypt) and the competitive review already recorded in `docs/plan.md` §"Market & competitive notes" — what an Egyptian SMB buyer compares Mezan against.
