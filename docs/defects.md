# Mezan — defect register

**The single list of known defects.** Every test run reads this before starting
and updates it before finishing. Nothing else tracks defects — if it is not
here, it is not tracked.

Updated 2026-08-25 (the fix pass on the register's own OPEN table, then the cross-module
money-trail pass and the currency / tax / compliance / platform seam pass —
`docs/scenarios/09-cross-module.md` and `scripts/scenarios/seams.ts`; then the two
posting-trail walkthroughs driven through the real UI, which added D39–D42 and
scenarios x40/x41).

## How to use this file

**Before a test run**, read the OPEN table. Those defects will show up. Note
that you saw them and move on — re-filing a known defect as a new finding buries
whatever is actually new.

**After a test run**, update this file in the same commit as any fix:

- Found something new → add a row, with the **measured** evidence, not a
  description. "Off by exactly 122.00" is a defect report; "reconciliation looks
  wrong" is a feeling.
- Fixed something → move it to FIXED with the commit that fixed it. **Do not
  delete it** — a fixed defect is how you recognise its regression.
- Proved something was a false alarm → move it to NOT A DEFECT with what
  actually caused the reading. Silently dropping it means the next person
  rediscovers and re-reports it.

A stale register is worse than none: it is how a real regression gets waved
through as "oh, that's the known one".

---

## Open

The 24 defects D1–D37 carried are closed — they are in the Fixed table below,
and `pnpm scenarios` passes with all four invariants at exactly zero on the
seeded tenant: trial balance, inventory vs GL 1200, AP vs GL 2100, AR vs GL 1105.

Four remain open: two found on `main` while that sweep was running, and two more
from the posting-trail pass that drove the sales and purchase chains through the
screens' own routes (the other two findings of that pass — the suppliers list's
payable column and the invoice-level collection that posted nothing — were fixed
by that same sweep, F39–D39 and the D1 rework, before this branch merged):

| # | Area | Defect | Measured evidence | Severity |
|---|---|---|---|---|
| D38 | Sales / contracts | A quote or invoice line accepts **any** `itemId` string — no route checks it against the item catalogue | `createSalesQuoteLineSchema` and the sales-invoice line schema validate `itemId: z.string().min(1)` only; neither route holds an item repository. Until F34 the quotes screen exploited this by sending invented ids (`ITEM-1`, `ITEM-2`), and the convert step then hardcoded `isStock: false`, so a stock item converted into an invoice line that moves no stock and posts no COGS | Medium |
| D42 | Purchases / AP | A landed cost credits the AP control account with **no supplier dimension**, so the payable exists in the ledger and on no supplier's account | `JE-000024` ("تكاليف توريد إذن الاستلام GR-000001") credits 2100 by **2,500.00**; `landedCostSchema` carries cost type, description, amount and targets — no supplier. Measured: the supplier sub-ledger now ties to GL 2100 to within exactly that 2,500.00 (112,076.00 vs 114,576.00) | Medium |
| D43 | Sales / UI | A **draft sales invoice cannot be confirmed from any screen** — the only confirm path is the "save and confirm" checkbox on the create form | `SalesInvoicesScreen.tsx`'s `InvoiceDetailView` renders `actions={<Button>رجوع</Button>}` and the list has no row action, so an invoice produced by «تحويل عرض السعر إلى فاتورة» (or saved as a draft) is stranded: `POST /sales-invoices/:id/confirm` works, nothing calls it. Goods receipts and purchase invoices both carry a تأكيد button on their detail page | High |
| D44 | Purchases / Tax | A purchase invoice created **«من إيصال استلام» always carries 0% VAT**, and no screen can change it | `POST /purchases/invoices` with `receiptId` and no `lines` → every line comes back `taxRatePercent: 0`, total **1,400.00** on goods a 14% supplier billed at 1,596.00; GL 1400 (input VAT) moves **0.00**. `buildInvoiceLinesFromReceipt` takes a `resolveTaxRate` port, `purchases-routes.ts` defaults it to `() => 0`, and `create-backend.ts` never passes one. Every existing test of this route supplies its own `lines`, which is why it survived: the UI is the only caller that omits them | High |

And a closed register is not the same as a clean product: it means the ones
found and written down are closed. The next one gets found the way these were —
by driving a seeded app and comparing two numbers that must agree. Two things
are open by DECISION rather than by patch, and stay listed so nobody re-files
them:

- workflow `minAmount` is configurable but never enforced (`DocumentWorkflowInput`
  carries no amount to compare)
- email and WhatsApp notification channels are modelled but unimplemented

D1's last residue is closed too: the invoice screen's collect action creates and
confirms a REAL collection voucher and allocates it, which is what the reference
product does (its "Collect" requires a treasury account and applies against
invoices). There is no longer any path that records a payment the ledger never
hears about.

## Fixed

| # | Defect | Fixed by |
|---|---|---|
| F1 | AR and AP sub-ledgers ignored returns and landed costs, so the GL moved and the sub-ledger stood still — every tenant that posted a return saw a false mismatch | `0717a47` |
| F2 | `text-on-brand` named a token that does not exist, so the selected financial-statement tab rendered near-black on dark teal at **1.52:1** | `1aa6a51` |
| F3 | Server parameter-validation errors were swallowed — an invalid date left the report sitting on its placeholder with no message | `274f53e` |
| F4 | 11 form fields had no accessible name; three EntityPickers hand-rolled a caption div instead of using the component's own `<label for>` | `fff206f` |
| F5 | Label printing had no page `h1`; cost-centre P&L rendered a second, empty one | `9f17f28` |
| F6 | The approvals note field had no accessible name — found the first time the inbox had a row to test | `c0dd755` |
| F7 | **The same goods could be returned repeatedly.** Both return routes validated the requested quantity against an `availableQty` supplied *in the request body*. Measured: 40 invoiced, two returns of 40 each, both confirmed — stock and AR credited twice for goods sold once | `46e527c`, `4acf10f` |
| F8 | **The warehouse selector filtered nothing.** The shell sent `x-warehouse-scope`, the resolver parsed it, and no list route ever read it. Six surfaces now narrow (stock balance 8→3, on-hand 1,790→119) | `0be2432` |
| F9 | **A document held for approval was permanently stuck** — the gate built its request in memory and discarded it, so the inbox never saw it and nobody could approve or reject. Proven fixed: 8→9 requests | `342b5b9` |
| F17 | **The dashboard's VAT figure had the wrong sign and was out by 37,055.20.** It read the report engine's `grandTotals.tax`, a naive sum across BOTH VAT sides, where the correct figure is `vatNetPayable` = output − input. It showed **24,983 due** while the VAT return screen showed **12,072.20 refundable** — the same tenant, opposite directions | this commit |
| F16 | **The comparative income statement's prior column was always zero on the route the UI uses.** `/financial-reports/income-statement` bounded its GL query to `[periodFrom, periodTo]`, so the comparison window — always earlier — found no entries. The feature looked correct because it was verified on `/reports/accounting/…`, which is unbounded. Now proven against a control: the prior column equals the control run exactly (−64,905.24158) | this commit |
| F13 | **A goods receipt could be invoiced twice.** `createPurchaseInvoice` checked the receipt's status but never its `invoiced` flag, so a second from-receipt invoice was accepted and posted a duplicate Dr Inventory **with no matching stock movement**. The flag and the error both already existed — cancel used them, create did not | this commit |
| F14 | **A landed cost with more than one target line N-times-overcounted its own total in the AP sub-ledger.** `costItems` is denormalized onto every line, and the reconciliation summed per line instead of per document. This was a bug in F1's own fix | this commit |
| F15 | **The warehouse selector still did nothing on the adjustments and transfers screens.** F8 scoped the raw-engine routes; the document-layer routes those screens actually call were missed. A transfer stays visible from both its ends by design | this commit |
| F12 | **A negative invoice-level discount inflated the total.** Every line-level discount was validated 0–100; the invoice-level one was not validated at all, so a negative amount applied as a literal subtraction and turned 950.00 into 1,140.00. Found by the executable sales suite on its first run | this commit |
| F11 | **Webhook retries outlived shutdown**, waking against a closed store and throwing while recording — losing the final delivery record and printing stack traces that read like smoke failures. `stop()` is now called before the connection closes, and guards both the pause and the write. Verified: shutdown errors went from a flood to **0** | this commit |
| F18 | **An admin rejecting someone else's pending request approved it instead** (D8). The gate's admin branch never read `input.decision`; an admin now bypasses the step's ROLE only | this commit |
| F19 | **An approved request never posted its document.** Every confirm re-submitted a FRESH request over the standing one, discarding the approval that had just been granted, and deciding moved only the `ApprovalRequestRecord`. An approval now posts the held document; a rejection or a modification request hands it back as an editable draft; a rejected request refuses a re-confirm outright | this commit |
| F20 | **TREASURY_VOUCHER_CONFIRM's gate was wired to a resolver that always returned null**, and held voucher requests were never persisted — no configured chain had any effect and nothing reached the inbox. `SALES_INVOICE_CONFIRM`'s seeded chain was equally inert: `salesInvoices` was never given the workflow gate at all | this commit |
| F21 | **HR reported a disbursement as done while its treasury voucher sat unapproved** — the run went مصروف with no cash moved and no journal entry. It now refuses with `TREASURY_DISBURSEMENT_HELD`, and disbursing again after the approval finds the same voucher already posted | this commit |
| F22 | **The VAT return's grand total summed the tax column across BOTH sides** — a figure with no accounting meaning, which the dashboard read as "VAT due". A report column can now declare its own grand total; the VAT return's declares output − input (D of the F17 family, on the server side this time) | this commit |
| F23 | **The 22 operational reports still swallowed server parameter-validation errors** (D14) — F3 had covered only the 7 financial statements. Both hooks now share one extractor | this commit |
| F24 | **An invoice's `remainingBalance` never subtracted confirmed returns** (D9), so a fully-returned invoice read as owed in full while the GL had credited AR. It nets them off and reports `returnedCredit` | this commit |
| F25 | **RFQs, purchase orders and purchase invoices stamped the ids `"MAIN"` / `"MAIN-WH"`** (D10), which exist in no tenant this app seeds. They resolve branch and warehouse from the caller's own scope, and refuse to save when none is available | this commit |
| F26 | **Approving leave drove the balance negative** (D11) — nothing checked the entitlement. It now refuses with `LEAVE_BALANCE_EXCEEDED`, naming days requested vs available; unpaid leave is exempt. The seed had taken the same shortcut and now grants the entitlement it uses | this commit |
| F27 | **A project's status was never guarded** (D12) — any status reached any other, so a completed project could go back to "planned". `PROJECT_TRANSITIONS` is now enforced on the server and the picker only offers legal moves | this commit |
| F28 | **Every domain state-machine refusal reached the Arabic UI in English**, naming raw status codes (D15), and the payroll exclusion embedded the code `"hourly"` in Arabic prose. Nine error types now read in Arabic through their module's own labels | this commit |
| F29 | **Stock movements were dated by the wall clock on a confirm** but by the document date elsewhere (D4), so a replay consumed stock before the receipt that funded it. Every document-caused movement now derives its timestamp from its document's date | this commit |
| F30 | **The seeded tenant never funded its bank account** (D17): cash read **−100,524.88**. An opening capital deposit precedes the first purchase; cash reads **+149,475.12** | this commit |
| F31 | **`employees.xlsx` and `items.xlsx` shipped with a required column blank on every row** (D16), so each rejected all of its own rows. The generator's rows now carry hire date and base unit code | this commit |
| F32 | **The branch selector filtered nothing** (D7) — the same failure F8 fixed for warehouses. Twelve branch-owned list routes now narrow; proven against a second branch that owns nothing | this commit |
| F33 | **The ETA queue had no producer** (D5): `enqueue` existed and nothing called it, so `/eta/submissions` could not hold a row. A confirmed sales invoice now queues one, and `check:seed`'s exemption is gone — 102 surfaces populated, 0 empty | this commit |
| F34 | **The quotes screen let you type an item name instead of choosing one** — every line invented an id (`ITEM-1`) with no price, VAT rate or GL accounts behind it, and the convert-to-invoice step then sent `isStock: false` and hardcoded accounts for every line, so a converted stock sale moved no stock and posted no COGS. The line is now an `EntityPicker` over `/items`; price, VAT rate and the revenue/COGS/inventory accounts come from the chosen item, branch comes from the caller's working location instead of the literal `"BR1"`, and the convert panel picks a real warehouse instead of typing `WH1`. Measured after the fix: a new draft stores `ITEM-DEMO-1` at 180.00 + 14% VAT = 205.20, and converting QT-000003 writes an invoice line with `is_stock=1`, inventory account 1200 | this commit |
| F35 | **The quotes screen was a fraction of the reference screen** — no branch, currency, notes, internal notes, header discount, price list, per-line tax or discount, no search, no filters, no expiry bucket, count-based KPIs instead of value, and a side panel where the reference has a full create form and a document detail with lifecycle, effects and audit. Rebuilt from a LIVE enumeration of the reference product (2026-08-25, `docs/reference-parity/01-sales-quotes.md`) rather than from the label snapshot in `docs/catalog/`. Measured after: a draft for مؤسسة النور stores `price_list_id=PL-DEMO-2`, unit price 168.00 off that customer's wholesale list (not the item's 180.00 default), VAT 14% → 191.52, branch `BR-MAIN`; sending it stamps QT-000004 | this commit |
| F36 | **Every create form and document detail was a side drawer with no address** — the shell had no routing at all, so no screen, create form or document could be linked, bookmarked, reloaded into or reached with the browser's Back button. Added hash routing (`apps/web/src/routing.ts` + `useSubPage()`; the hash, not the path, because the desktop edition loads from `file://`): every screen is now `#/<module>/<screen>`, and document screens carry `…/new` and `…/<docNo>` sub-pages, matching the reference product, which uses pages for documents and a modal only for short master-data forms. Converted: sales quotes, sales invoices, sales returns, purchase orders, goods receipts, purchase invoices, purchase returns, RFQs. Measured: `#/sales/quotes/QT-000001` survives a full reload and Back returns to the list | this commit |
| F37 | **No page had a path back except the browser's Back button, and two screens had defects only a full sweep would find.** Added a shell breadcrumb (`apps/web/src/Breadcrumbs.tsx`): لوحة التحكم · module · screen · sub-page, every crumb but the last a real control — the module opens its hub (or its first screen, for groups without one) and the screen name drops the sub-page. The 75 duplicated `eyebrow` props and 32 `mz-eyebrow` divs that repeated the same trail as dead text are gone. Stock adjustments, transfers and physical counts moved from local `mode` state to addressed sub-pages (`#/inventory/stock-adjustments/new`), so تسوية جديدة is a place. Swept all 100 nav screens in the browser: 0 HTTP 4xx/5xx, and the two defects found are fixed — the audit log gave 9 duplicate-React-key errors (bulk writes share a millisecond, an actor and an action, so `rowKey` now takes the row index) and the print-templates screen had two `<h1>`s (the company name inside the print PREVIEW was a heading) | this commit |
| F38 | **The sales-invoice screens were a fraction of the reference's** — no branch, currency, notes, internal notes, price list or creation-method on the form; no Open/Overdue buckets, filters, follow-up banner, returns or collected figures, rows-per-page on the list; no branch, cost, profit, margin, returns deduction, returns/ETA/audit tabs on the document. Rebuilt from a LIVE enumeration of the reference (2026-08-25, `docs/reference-parity/02-sales-invoices.md`), which also captured its row expander, its quick-preview panel and all eight of its tabs. Measured after: INV-000001 reports cost 9,320.00, profit 2,920.00, margin 23.9%, returns −1,197.00, net 12,756.60 — all from figures already on the wire (`unitCost`, `returnedCredit`) that nothing rendered; a draft for شركة الأمل auto-dated its due date to 2026-09-24 from the customer's 30-day terms and persisted `branch_id=BR-MAIN`, `currency=EGP` and its notes | this commit |
| F39–D41 | every treasury balance is read from that account's own GL account. Measured: cash 2,379.12, bank 141,396.00, van 1,550.00 — each equal to GL 1300-1 / 1310 / 1300-2 to the piastre. Deriving it from vouchers instead was wrong by 248,900.00 on the bank, because cheques and settlements post there too | this commit |
| F39–D40 | remaining customer credit is now measured against what the customer owes today, not their opening balance | this commit |
| F39–D39 | the suppliers list now reports the live payable — opening balance plus confirmed invoices, less voucher payments, confirmed returns and issued cheques. Measured: 112,076.00 against GL 2100's 114,576.00, the 2,500.00 difference being D42's supplier-less landed cost | this commit |
| F10 | `GET /items/:id` served `onHand: "0"` with `stockStubbed: true`, on a comment saying real figures arrive "once Phase 2 lands the movements ledger" — which it had | `46e527c` |
| F34 | **A confirmed collection never moved the invoice's `amountPaid`, and the AP sub-ledger ignored payments entirely** (D1, D18). The reconciliation now follows the vouchers and cheques that actually move 1105/2100, and an allocation writes back to the invoice it settles. AP 35,554.00 → **0.00**, AR 13,529.12 → **0.00** | this commit |
| F35 | **A `PHYSICAL_COUNT` adjustment moved stock with no journal entry** (D2) — only `INITIAL_STOCK` had a GL mapping. Every reason now posts, against a new 5070 shrinkage leaf | this commit |
| F36 | **`completeWorkOrder` never touched GL 1200** (D3): it posted to 1210/1220, and `accountBalance` has no subtree rollup, so the sub-ledger rose by labour + overhead while the control account stayed flat. Both inventory legs now post to 1200 | this commit |
| F37 | **Fixed-asset disposal existed as a status value and a permission, with no route and no button** (D13). Disposal clears cost and accumulated depreciation, takes the proceeds, and books the gain (4500) or loss (5450); a second disposal is refused | this commit |
| F38 | **Both سياسة الخزينة switches were dead** (D19) — `create-backend.ts` never passed `settings` to the voucher options, so the guard read a hardcoded default. Bank accounts now honour their own switch too | this commit |
| F39 | **Confirming a purchase invoice into a closed period answered 500** (D20) and **left the stock IN applied** (D21). The route maps the GL port's errors, and the GL posts before the stock moves, so a refusal leaves nothing behind | this commit |
| F40 | **A van trip's roadside cash never reached the van treasury** while settlement transferred the full counted cash out of it (D22). Takings post in; the counted-versus-expected difference is written off to عجز/فائض الصندوق | this commit |
| F41 | **A historical import recorded no opening AR or AP at all** (D23) — the domain posted the entry only when given `gl`/`accounts`, and it was wired with `archives` only. Opening balances now post against a new 3200 opening-balance equity leaf | this commit |
| F42 | **A document's currency was a label, not a currency** (D24): no rate was applied and no GL line tagged. A foreign invoice now converts at the approved rate of its own date and keeps currency + rate on the payable line, so revaluation can find it; a currency with no rate is refused rather than posted 1:1 | this commit |
| F43 | **A locked exchange rate could be silently rewritten** by re-POSTing its id (D25) — `repo.create` upserts. Create refuses an existing id, and approve refuses a locked rate: locked is terminal | this commit |
| F44 | **A treasury voucher had no cost-centre dimension** (D26), so the wire schema dropped it and every voucher-paid expense landed in غير مخصص. The dimension travels contract → document → GL line, and the voucher form has a picker | this commit |
| F45 | **Withholding tax had nowhere to live** (D27): no account, no field, no report. A payment carries a withheld amount against a new 2210 leaf, the supplier is discharged in full, and `GET /reports/tax/withholding` files it | this commit |
| F46 | **Nothing recorded that a VAT period was filed** (D29), so a backdated document silently restated a submitted return. A filing locks its window; restating it means amending the filing, and an amendment requires a reason | this commit |
| F47 | **Audit rows took their branch from the caller's scope** (D30), and the default scope is all-branches, so rows came out with `branchId: null` the branch filter could never find. The document's own branch is stamped instead | this commit |
| F48 | **The visibility tiers the catalog defines were enforced by no route** (D31): a `.confirm` holder was 403 on the list, `view_own` narrowed nothing, and `view_cost` / `hr.employee.view_salary` were checked nowhere. Reads gate on the weakest tier and narrow; the sensitive fields are omitted without their permission | this commit |
| F49 | **There was no server-side search, and no Arabic normalisation anywhere** (D32) — احمد never found أحمد. One shared helper folds the spelling variance; customers, suppliers and items take `?q=`, and ten screens use the same helper | this commit |
| F50 | **Numbering was tenant-global with no branch dimension** (D33). A sequence can be marked branch-scoped from settings: each branch then keeps its own counter and carries its code in the number | this commit |
| F51 | **There was no year-end close** (D34): the P&L accounts never reset and GL 3900 was never posted to. `POST /gl/year-end-close` rolls the result into retained earnings, dated the last day of the year closed | this commit |
| F52 | **A customer's price list was consulted by no route** (D35) — an invoice line at 5.00 against an 80.00 list price was accepted silently. Confirm reports the lines charged under the list, warning rather than refusing | this commit |
| F53 | **A landed cost wrote no stock movement** (D36), so `replay()` could not reproduce a position it had touched and the drift report read `cacheDrift` nonzero on a healthy tenant. The ledger gained a value-only movement, and replay values an issue at the cost the ledger recorded | this commit |
| F54 | **The dashboard's receivables tile and the aging report meant different things** (D37). The tile means customer receivables; the ladder nets returns and unapplied credits. Both read the same figure as GL 1105 | this commit |
| F55 | **A purchase return credited inventory at the price on the return** while stock left at the moving average — found while fixing D36, and it left the sub-ledger 68.28 adrift from GL 1200. The stock hook reports what moved, and the difference books to a new 5080 cost-variance leaf | this commit |
| F56 | **D1's last store closed against the reference product.** Collecting on an invoice created no voucher and posted nothing; the reference's own invoice-level "Collect" requires a treasury account and applies against invoices, so Mezan's now creates and confirms a real collection voucher and allocates it. Verified in the browser: the button produced CV-000014, AR moved 37,839.28 -> 37,339.28, and all three sub-ledgers still reconciled exactly | this commit |
| F57 | **The cash-guard refusal reached the Arabic UI in English** — found by clicking, not by any gate. Now Arabic, and it names cash vs bank | this commit |
| F58 | **The disposal proceeds picker showed a header account as though it were selected** while its value was empty, so the user chose an account and got "الحساب مطلوب" — and every header account it listed could never be posted to anyway. Explicit placeholder, headers excluded | this commit |
| F59 | **Report grand totals summed money as IEEE-754 doubles**, so a trial balance equal to the piastre reported 681,214.3999999999 against 681,214.4 and "debit = credit" read FALSE on books that balance. Totals accumulate in scaled integers | this commit |

`pnpm lint` now fails on F2's whole class: `scripts/check-color-tokens.mjs`
checks every colour utility against the compiled stylesheet.

`pnpm scenarios` now fails on the approvals, scope, lifecycle and report-total
classes: the executable suite asserts the FIXED behaviour, so a regression in
any of F18–F33 turns it red. The four assertions still failing in that suite are
D1, D2, D3 and D13 — deliberately, so the register and the suite agree. The
cross-module and seam suites (`scripts/scenarios/cross-module.ts`,
`scripts/scenarios/seams.ts`) carry the failures behind D18–D35; they were
written against the tree before the F18–F33 fix pass, so their findings have not
been re-measured against it.

---

## Not a defect

Kept so nobody rediscovers and re-reports them.

| Reading | What actually caused it |
|---|---|
| 86 screens reporting contrast **1.00** | The measuring script returned alpha `1` for any `color(...)` value, ignoring the `/ 0.22` in `color(srgb … / 0.22)`. It compared the sidebar's brass badge text against brass. One parsing bug, one badge in the shell, 86 identical false findings |
| Avatar monograms at **1.04:1** | Brass gradient background; a gradient has no single colour to measure against. Skip, do not guess |
| Every zebra row failing contrast | `color-mix()` resolves to `color(srgb 0.96 …)` — 0–1, not 0–255 |
| `/profile` returning 404 | It returns the **caller's** record; the probe sent a user id that does not exist |
| `/inventory/drift` returning 400 | It requires `itemId` and `warehouseId`; a bare GET is correctly rejected |
| Dashboard screenshot blank | A screenshot of a hidden tab can come back unpainted while the DOM is fully populated. Assert on the DOM |
| "Van sales report is missing" | It was built, routed, screened and in the nav the whole time. `docs/STATUS.md` was wrong |
| "Make-vs-buy needs a schema change" | Both cost sides were already derivable. `docs/STATUS.md` was wrong |
