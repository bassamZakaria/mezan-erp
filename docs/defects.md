# Mezan — defect register

**The single list of known defects.** Every test run reads this before starting
and updates it before finishing. Nothing else tracks defects — if it is not
here, it is not tracked.

Updated 2026-08-25 (the fix pass on the register's own OPEN table, then the cross-module
money-trail pass and the currency / tax / compliance / platform seam pass —
`docs/scenarios/09-cross-module.md` and `scripts/scenarios/seams.ts`).

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

| # | Area | Defect | Measured evidence | Severity |
|---|---|---|---|---|
| D1 | Treasury / AR | A confirmed collection voucher never moves the invoice's `amountPaid` | `VCH-DEMO-1` collects **6,279.12** and credits AR in the GL; every invoice still reports `amountPaid: 0`. AP is the same defect on the other side: the sub-ledger counts every confirmed purchase invoice in full and ignores supplier payments, so it stands **35,554.00** above GL 2100 | High |
| D2 | Inventory / GL | A `PHYSICAL_COUNT` adjustment moves stock with **no journal entry** | Single-sided count leaves inventory off by exactly **122.00** | High |
| D3 | Manufacturing / GL | `completeWorkOrder` never touches GL 1200 | BOM-DEMO-1 at qty 10 leaves inventory off by exactly **80.00** | High |
| D13 | Fixed assets | No disposal action exists — the status value and permission exist, the route and button do not | | Medium |
| D18 | Treasury / AP reconciliation | The AP sub-ledger ignores every payment: paying or refunding a supplier moves GL 2100 and leaves the sub-ledger figure where it was | `SCN-X-PAY-1` pays **2,280** → GL 2100 falls 2,280, AP sub-ledger unchanged; the reconciliation diff goes 35,554 → **37,834**. `resolveReconciliationControls()` sums confirmed invoice totals − returns + landed costs and never subtracts allocations | High |
| D19 | Settings / Treasury | `preventNegativeCashBalance` and `allowNegativeTreasury` are dead switches — the guard never reads them | With the setting persisted `false` (verified by re-read), the same voucher is still refused `CASH_BALANCE_NEGATIVE`. `create-backend.ts`'s `vouchers:` options never pass `settings`, so `VoucherService.cashPolicy()` returns a hardcoded `true` | Medium |
| D20 | Purchases / fiscal periods | Confirming a purchase invoice into a **closed** period answers `500 Internal Server Error` | Sales confirm, voucher confirm and journal post all return 422 `PERIOD_NOT_OPEN_FOR_POSTING`; `purchases-routes.ts`'s confirm handler does not map `PeriodNotOpenForPostingError` thrown by the GL port | Medium |
| D21 | Purchases / atomicity | That same crash is not atomic: the stock IN is applied before the GL refuses, and never rolled back | One blocked line at qty 1 × 50 leaves the inventory sub-ledger exactly **50.00** ahead of GL 1200, with no document that explains it | High |
| D22 | Field sales / Treasury | A trip's roadside cash never reaches the van treasury, but settling transfers the full counted cash out of it | Float 500 in, 700 of recorded sales, 1,150 counted: the van's GL 1300-2 ends **650** below where it started. `POST /field/van-trips/:id/cash-movements` only mutates the trip document | High |
| D23 | Go-live import / GL | A historical import records **no opening AR or AP at all** — a migrated business owes and is owed nothing in its ledger | Importing an outstanding supplier invoice (250 remaining) and customer invoice (300 remaining) moves GL 2100 and 1105 by **0.00**. The domain posts the opening entry only `if (!archive.settled && deps.gl && deps.accounts)`; `create-backend.ts` wires `historicalImport` / `salesHistoricalImport` with `archives` only | High |
| D24 | Multi-currency | A document's currency is a label, not a currency — no rate is ever applied and no GL line is tagged | `SCN-S-PI-USD` at `currency: "USD"`, 1,000 USD: GL 2100 credited **1,000.00 EGP**, both lines `currency: null, fxRate: null`. `buildInvoicePosting` (`purchase-invoice.ts`) never consults `ExchangeRateRepository`, so the payable is understated by the rate and the debt is invisible to revaluation | High |
| D25 | Exchange rates | A **locked** rate can be silently rewritten, and its status reset, by re-POSTing its id | `SCN-S-FX-EUR-31` locked at 60.00; `POST /exchange-rates` with the same id → 201, stored rate **99.00**, status back to `pending`. The route calls `repo.create`, and the SQLite repository upserts `ON CONFLICT(id) DO UPDATE` | High |
| D26 | Cost centres | A treasury voucher cannot be attributed to a cost centre, so the report is blind to almost all real spending | 400.00 paid by voucher with `costCenterId` supplied lands in غير مخصص; `createVoucherSchema` has no such field. Only hand-written journal entries can be tagged | Medium |
| D27 | Tax / withholding | No withholding-tax concept exists anywhere: no account, no document field, no report | CoA has no WHT-payable account (2190 is payroll withholdings); `withholdingAmount`/`grossAmount` are dropped at the wire; `GET /reports/tax/withholding` → 404. Egypt withholds on most local B2B payments | High |
| D28 | Tax reporting | The VAT return re-derives **one blended rate per journal entry** instead of reporting the rates charged | A 14% / 5% / zero-rated invoice (tax 190.00 on base 3,000) is reported as a single ~6.3% bucket. `createVatReturnReport` computes rate = tax ÷ base per entry; no rate metadata reaches the GL | High |
| D29 | Tax compliance | Nothing records that a VAT period was filed, so a backdated document silently restates a submitted return | July output tax moves by exactly **140.00** after a backdated entry, with no amendment, warning or trace. Fiscal-period close is the only lock, and reopening needs no reason and leaves no tax-side record | High |
| D30 | Audit | Rows written by an all-branches caller carry `branchId: null`, so the branch filter can never find them again | The voucher names `BR-MAIN`; every audit row it produced has `branchId: null`. `branchScopedAuditSink` takes the branch from the caller's `x-branch-scope`, never from the document | Medium |
| D31 | Permissions | The visibility tiers the catalog defines are enforced by no route | `sales.invoice.confirm` (which implies `view_own`) → **403** on `GET /sales-invoices`, because every read route gates `.view`; a plain `.view` holder reads every colleague's invoice **and** `unitCost` without the ⚠ `view_cost` permission; `hr.contract.view` alone returns `monthlySalary` | High |
| D32 | Search | There is no server-side search, and the client filter cannot forgive Arabic | `?q=` is not a parameter of any list route (full table returned unchanged); the screens' own `toLowerCase().includes(q)` gives **0 matches** for احمد against أحمد, فاطمه against فاطمة, ليلي against ليلى | Medium |
| D33 | Numbering | Numbering is tenant-global with no branch dimension | Two branches selling the same day take consecutive numbers off one counter (`INV-…`), and `sequenceDefinitionSchema` has code/prefix/padLength/annualReset only | Low |
| D34 | Year-end | There is no year-end close: no route, no closing entry, and retained earnings is never posted to | After generating FY2027, GL 4100 still carries 2026's revenue in full and GL 3900 movement is **0.00**. The balance sheet balances only because the report derives retained earnings from the P&L accounts itself | Medium |
| D35 | Pricing | A customer's price list is never consulted server-side | The customer is assigned a list quoting 80.00; an invoice line at **5.00** for the same item is accepted without warning. The ordering price list → promotion → credit limit holds only in the UI | Medium |
| D36 | Inventory reporting | A landed cost writes **no stock movement**, so it cannot be replayed | `applyLandedCostRevaluation` bumps the snapshot and rewrites cost layers directly. `GET /inventory/drift` therefore reports `cacheDrift` on a healthy tenant: ITEM-DEMO-1 cached **146.827936** vs recomputed **140.000000** — and the field's own docstring says a nonzero value "means the cache is CORRUPTED" | Medium |
| D37 | Dashboard / reports | `gl.receivables` and the customer-aging report disagree by **5,486.12** | The tile sums EVERY code-11xx asset account (trade AR 1105, installment AR 1110, retention 1150, employee advances 1160, and the credit-natural provision 1190 sign-flipped positive); aging covers sales-invoice trade AR only. 47,079.28 vs 52,565.40 — a scope question, not arithmetic | Medium |
| D38 | Sales / contracts | A quote or invoice line accepts **any** `itemId` string — no route checks it against the item catalogue | `createSalesQuoteLineSchema` and the sales-invoice line schema validate `itemId: z.string().min(1)` only; neither route holds an item repository. Until F34 the quotes screen exploited this by sending invented ids (`ITEM-1`, `ITEM-2`), and the convert step then hardcoded `isStock: false`, so a stock item converted into an invoice line that moves no stock and posts no COGS | Medium |
| D39 | Suppliers / AP | The suppliers list reports every supplier's payable as its **opening balance**, under a column and a KPI both labelled "المستحق للمورد(ين)" | `SuppliersScreen.tsx:633` renders `s.openingBalance` for the "amount due" column and line 772 sums the same field for the header figure. Measured on the seeded tenant: both read **0.00** while **7 confirmed purchase invoices worth 150,867.60** exist. The reference product shows a live 248,152.68 in the same place | High |
| D40 | Customers / credit control | A customer's remaining credit is computed against their **opening** balance, so the figure ignores every invoice they have since been billed | `CustomersScreen.tsx:477` — `remainingCredit = creditLimit − openingBalance`. A customer with a 50,000 limit, a 0 opening balance and 40,000 of live unpaid invoices still reads 50,000 available | High |
| D41 | Treasury | Every treasury account's **balance** — the column and all three header figures — is its **opening** balance, so confirmed vouchers never move it | `TreasuryAccountsScreen.tsx:169` renders `a.openingBalance` under "الرصيد", and lines 104–106 sum the same field for إجمالي الأرصدة / النقد المتاح / الرصيد البنكي. Measured on the seeded tenant: all three read **0.00** with **10 confirmed vouchers** (transfers, supplier payments, customer collections) on file. Third instance of the same shape as D39 (suppliers) and D40 (customer credit) | High |

Every other row that stood here has moved to FIXED below. **D18 and D19 below are
origin's; the two findings from the local fix pass that had also been numbered D18/D19
are D36 and D37.**

### D24 / D28 / D29 — the three that will fail an audit

These are grouped because they share a shape: the product records something the
law cares about, in a form the law cannot use.

**D24** — a purchase invoice takes `currency: "USD"` and posts its numbers
straight into the ledger. No rate is fetched, no line is tagged, so USD 1,000
becomes EGP 1,000 and the FX revaluation engine (which is correct, and proven in
`x23`) has nothing to find. Multi-currency is presented and unimplemented.

**D28** — the VAT return derives a rate per journal entry by dividing tax by
base. An invoice mixing 14%, 5% and zero-rated lines therefore files under a rate
that exists nowhere in law. The rates ARE charged correctly per line (`x33`,
`x46`); it is only the return that loses them. The fix is rate metadata on the
posted line, not a change to the tax engine.

**D29** — nothing in the product knows a period has been filed. A backdated entry
moved an already-"filed" July return by 140.00 in `x47`, silently. Fiscal-period
close does block it — the mechanism exists and works — but nothing ties the tax
filing to that lock, and reopening a period needs no reason and leaves no trace.

### D31 — the permission catalog promises three tiers and the routes implement one

`resolvePermissions` expands the dependency graph correctly server-side: granting
`sales.invoice.confirm` really does grant `sales.invoice.view_own`. But no read
route gates on `view_own`, and none filters by owner, so:

- a user who may confirm invoices gets **403** trying to list them;
- a plain `.view` holder sees every colleague's document;
- `sales.invoice.view_cost` and `hr.employee.view_salary` — both flagged ⚠
  sensitive — are checked nowhere, and cost and salary come back to anyone with
  the plain view permission.

The requirement is that costs are *hidden*, not that the page errors. Today they
are neither.

### D23 — go-live import archives history and posts none of it

The documented go-live rule is right and the domain implements it: archive
settled documents with no journal entry, post **only** the outstanding balance
against the opening-balance account. The wiring drops the second half.
`packages/backend/src/create-backend.ts` passes `historicalImport: { archives }`
and `salesHistoricalImport: { archives }` — no `gl`, no `accounts` — so
`if (!archive.settled && deps.gl && deps.accounts)` is never true and the opening
entry is never posted.

The visible effect at a customer's go-live: every migrated invoice appears in the
archive, the AR and AP aging reports have rows, and the trial balance says the
business is owed nothing and owes nothing. Third instance of the same failure
shape as D19 — an options object assembled without the dependencies the service
needs to do its real job.

### D18 — the AP sub-ledger never hears about a payment

`resolveReconciliationControls()` (`create-backend.ts`) builds the AP figure from
confirmed purchase invoices, minus confirmed purchase returns, plus landed costs.
Treasury allocations are not in that sum, so **every supplier payment de-reconciles
AP by its own amount** — the exact twin of D1 on the other side of the books.

It stayed invisible because no scenario had ever paid a supplier: the module
suites confirm invoices, and the treasury suite posts vouchers that are not
allocated to purchase invoices. It takes the cross-module trail (buy → pay) to
see it.

### D19 — the cash guard ignores its own setting

`VoucherService.cashPolicy()` returns `true` whenever `deps.settings` is absent,
and `create-backend.ts` never passes `settings` into the `vouchers:` options
object. The Settings screen's منع الرصيد السالب للحسابات النقدية toggle therefore
changes nothing, in either direction. Same shape as the missing
`resolveGateConfig` on the same options object (see the treasury approval-gate
finding in `scripts/scenarios/accounting.ts`) — one under-wired dependency,
two dead features.

### D20 / D21 — a closed period crashes the purchase confirm, and the crash leaks stock

Two defects from one call. The route does not map the domain's period error, so
the caller sees a 500 instead of the 422 every sibling route returns (D20). Worse,
`confirmPurchaseInvoice` moves stock **before** posting the journal entry, and
nothing unwinds the stock movement when the post throws (D21) — the sub-ledger is
left ahead of GL 1200 by the invoice's own value with no document behind it. D21
is the one that corrupts data; D20 is only how it is reported.

### D22 — van trip cash: recorded in one place, transferred from another

`POST /field/van-trips/:id/cash-movements` records a roadside sale on the trip
document and posts nothing to the van's treasury account. `settleVanTrip` then
transfers the whole counted cash — float plus those unposted sales — out of that
treasury. The van's cash account ends every trip short by exactly what the trip
sold, and the shortfall compounds trip after trip.

### D1 — collection voucher does not move `amountPaid`

The AR sub-ledger derives from `grandTotal − amountPaid`, so it overstates by the
full amount of every collection ever recorded. This is the
`recordPayment`-vs-allocations split — **two stores of the same fact** — and it
is the reason `مطابقة الأرصدة` shows an AR mismatch on seeded data.

Converging `recordPayment` onto the allocation sub-ledger removes the second
store entirely. That is a decision about a shared contract, not a patch.

### D2 — `PHYSICAL_COUNT` posts no journal entry

`adjustmentGlAccountsForReason` (`create-backend.ts`) maps only `INITIAL_STOCK`.
Every other reason moves stock and posts nothing, so the sub-ledger changes and
the control account does not.

**The demo seed steers around this**: its two physical counts are the same item
and quantity in opposite directions so they net to zero. That means **the demo
data is not evidence this path is sound** — it is evidence it was avoided.

### D3 — `completeWorkOrder` never touches GL 1200

It posts to 1220 and to 1210 / 5110 / 5210. `accountBalance` is per-account with
no subtree rollup, so the inventory control account never sees the movement.

**No work order in the seed is completed**, for this reason. Same caveat as D2:
the path is unproven, not proven.

### D36 — a landed cost is invisible to the movement ledger

`applyLandedCostRevaluation` raises the position's value by mutating the WAC
snapshot and deleting + re-adding cost layers at a higher unit cost. It appends
nothing to the movement ledger, and `StockMovement` has no value-only shape to
append, so `replay()` — which sums IN/OUT movements — can never reproduce the
snapshot on any position a landed cost has touched.

The snapshots themselves are correct, and reconciliation against GL 1200 is
exact. What is wrong is the **diagnostic**: `cacheDrift` is documented as
"nonzero means the cache is CORRUPTED and needs a rebuild", and it is nonzero on
a perfectly healthy tenant. Fixing it needs a value-carrying movement kind —
a change to the ledger's shape, not a patch.

This was found while fixing D4, and is the residue of what D4's original
evidence (`valueDiff 2400`) was reading.

---

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
| F10 | `GET /items/:id` served `onHand: "0"` with `stockStubbed: true`, on a comment saying real figures arrive "once Phase 2 lands the movements ledger" — which it had | `46e527c` |

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
