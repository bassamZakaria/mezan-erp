# Manual test plan — صاحب المنشأة (the business owner)

Persona: the owner, the person who signs the cheque for the licence. Opens the
app for five minutes a day, mostly from muscle memory, and asks three
questions — كم بعنا اليوم؟ (how much did we sell), مين مديون لي؟ (who owes me),
هل حد بيسرق؟ (is anyone stealing). Everything else is المحاسب's problem.

Every scenario below is grounded in a screen or API route that exists in this
repository as of this pass; file references are given so a scenario can be
re-verified against the code, not just the running app. Screens/journeys with
no backing route are listed in **Gaps**, not written as scenarios.

**Standard login**: محمد الشهابي (company admin, `isCompanyAdmin`), PIN
`123456` (`packages/backend/src/seed.ts:38-41`). Staff accounts share PIN
`123456` (`packages/backend/src/demo-seed/access.ts:537`); relevant ones are
named per scenario. All scenarios assume `MEZAN_SEED_DEMO=1` on a **fresh**
database unless noted — a previous run's postings change every figure below.

---

## Part 1 — First hour

### MTP-OWN-01 — First screen, cold start
- **Persona / permission:** owner, no session yet
- **Preconditions:** seeded demo tenant, app freshly opened (no remembered device user), fresh browser/Electron profile
- **Steps:**
  1. Open the app.
  2. Read the login screen top to bottom.
- **Expected:** the login screen shows the brand mark, the RTL prompt «مَن يعمل الآن؟», an «آخر» option to type a different account, and a copyright line (`apps/web/src/login/LoginScreen.tsx`, `Copyright` from `@mezan/ui`). Arabic renders right-to-left with no mirrored digits or clipped glyphs.
- **False pass:** the screen "looks fine" in a screenshot but the RTL PIN boxes actually fill left-to-right — check digit order lands in the boxes in reading order, not just that six boxes exist.

### MTP-OWN-02 — Owner signs in
- **Persona / permission:** owner
- **Preconditions:** seeded demo tenant
- **Steps:**
  1. Choose «آخر» (or the remembered face if already listed) and enter email `admin@cyag.example`.
  2. Type PIN `123456` into the six boxes.
- **Expected:** the PIN auto-submits on the sixth digit (`LoginScreen.tsx` docblock) and lands on `/dashboard` (`apps/web/src/router/routes.tsx` — index redirects to `/dashboard`). The greeting reads «مرحباً، محمد · طاب يومك» (first name only, `dashboard.greeting`, `DashboardScreen.tsx:120,305`).
- **False pass:** login "succeeds" but the dashboard silently shows an error card instead of figures (see MTP-OWN-39) — a green login does not mean a working home screen.

### MTP-OWN-03 — Ten-second read: does the front page answer the four questions
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02 done, seeded data present
- **Steps:**
  1. On `/dashboard`, without clicking anything, look for: today's/period sales, cash position, receivables + overdue, stock value.
- **Expected:** revenue (إجمالي الإيرادات), cash (السيولة النقدية), receivables (مبالغ لدى العملاء) and inventory value (قيمة المخزون) are all on this one screen (`DashboardScreen.tsx:340-373,479-481`) — no click required for the number itself. Overdue count/amount is in the «يحتاج متابعة» panel (`dashboard.attention.overdue`).
- **False pass:** counting "an aging matrix is present" as answering "who is overdue" — the matrix (MTP-OWN-10) shows the *whole* ladder, not a single overdue figure; the actual overdue answer is the attention-queue row, a different panel.

### MTP-OWN-04 — First-run wizard, licence step honesty
- **Persona / permission:** first-run installer (owner or IT)
- **Preconditions:** a database with no admin yet (bootstrap not run)
- **Steps:**
  1. Start the first-run wizard.
  2. Read the «تفعيل الترخيص» step's helper text.
  3. Click through to completion.
- **Expected:** the step is honest that it does not call a real licence server in this build — catalog string `firstRun.reallyCallingTheLicenceServer`: "الاتصال الفعلي بخادم الترخيص (توقيع Ed25519 غير مباشر) غير مفعّل في هذا العرض — الزر أدناه يُنهي الخطوة فوراً لأغراض العرض فقط." (`apps/web/src/login/FirstRunWizard.tsx:27`).
- **False pass:** reading the step as "licence activated" because it advances — it advances regardless of any real key, which is the point of this scenario, not a defect to paper over. Note it as an open item, see **Gaps**.

---

## Part 2 — Every dashboard tile, and whether it does anything

### MTP-OWN-05 — الإيرادات (revenue) tile: value, click, reload
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:**
  1. Read the "إجمالي الإيرادات" tile value for range «هذا الشهر».
  2. Click directly on the tile/number.
  3. Reload the page (F5 / Ctrl+R).
- **Expected:** value ties to `GET /dashboard/summary?fromDate=<month-start>&toDate=<month-end>`, field `gl.revenue`, itself the sum of posted revenue-account credit lines in range (`packages/backend/src/dashboard-routes.ts:64-76,141`). After reload, the same figure reappears (it is server-computed, not client cache).
- **False pass:** the tile has hover/shadow styling that looks clickable — it is a plain `<div>` with no `onClick` (`apps/web/src/dashboard/KpiStrip.tsx:49-61`). Clicking it does **nothing**; that is confirmed current behaviour, not a rendering glitch to retest.

### MTP-OWN-06 — المصروفات التشغيلية (expenses) tile
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** as MTP-OWN-05, for the expenses tile.
- **Expected:** ties to `gl.expenses`, summed from posted expense-account debit lines in the selected range (`dashboard-routes.ts:65-76`).
- **False pass:** same non-clickable tile — do not report "no drill-down" as new; it is the same finding as MTP-OWN-05 across every KPI tile (see MTP-OWN-07/08 too).

### MTP-OWN-07 — صافي الربح (net profit) tile and the balance beam
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:**
  1. Read the net-profit tile and the beam's verdict line under «الإيرادات في كفّة، المصروفات في كفّة».
  2. Switch range to «هذا العام», re-read both.
- **Expected:** `netProfit = revenue − expenses` exactly (`dashboard-routes.ts:109`), tile turns danger-red if negative (`DashboardScreen.tsx:359`), and the beam tilt/verdict key (`dashboard.hero.verdict.profit/loss/level`) agrees in direction with the sign of net profit (`beamTiltDegrees`, `BalanceBeam.tsx`).
- **False pass:** the beam visual "looks tilted the right way" without checking the printed net figure beside it agrees in **sign**, not just that both moved.

### MTP-OWN-08 — السيولة النقدية (cash) tile
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** read the cash tile; note the sub-label «أرصدة الصناديق والبنوك».
- **Expected:** cumulative balance of every asset account coded `13xx` as of the range's `toDate` (`dashboard-routes.ts:110`) — a balance-sheet figure, NOT scoped to the period like revenue/expenses are. Switching range from «هذا الشهر» to «كل الفترات» should NOT change this tile if `toDate` stays "today" in both — confirm it only moves when `toDate` itself moves.
- **False pass:** assuming cash is period-scoped like revenue because it sits in the same row of tiles — it silently is not, by design; verify against `TrialBalanceReportScreen` or the ١٣xx accounts in `ChartOfAccountsScreen`, don't just trust the label.

### MTP-OWN-09 — Company-wide row: مبالغ لدى العملاء / مستحقات الموردين / قيمة المخزون
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:**
  1. Read all three `StatCard`s under «على مستوى الشركة».
  2. Click each value.
  3. Reload.
- **Expected:** receivables sums ONLY customer-facing accounts `1105`,`1110`,`1360` (trade AR, instalments, bounced cheques — explicitly NOT the whole `11xx` subtree, `dashboard-routes.ts:20-28,114`); payables sums every liability account except `2200` (output VAT — a tax liability, not a trade payable, `dashboard-routes.ts:116`); inventory value sums every `12xx` asset account (`dashboard-routes.ts:115`). Figures survive reload.
- **False pass:** none of the three `StatCard`s carry an `onClick` either — same non-interactive pattern as the KPI strip. Do not treat "receivables shows a number" as "receivables can be drilled into"; it cannot, from here.

### MTP-OWN-10 — أعمار الأرصدة (aging heat matrix) panel
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02, seeded tenant has overdue customer and supplier balances
- **Steps:**
  1. Read the two-row matrix (العملاء / الموردون) across the five buckets.
  2. Click a coloured cell.
- **Expected:** rows come from `GET /reports/aging/customers` and `/reports/aging/suppliers` `grandTotals` (`dashboard-hooks.ts:81-87`, `DashboardScreen.tsx:253-281`); older/larger balances tint hotter. Clicking a cell does nothing (`AgingMatrix.tsx` has no click handler at all).
- **False pass:** the colour gradient reads as an interactive heatmap because of the visual polish — confirm with a literal click, not an assumption from the styling.

### MTP-OWN-11 — توزيع المصروفات (expense donut)
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** read the donut and its centre caption «إجمالي المصروفات».
- **Expected:** slices are expense-section rows of `GET /financial-reports/income-statement` for the current range, largest first, English-vs-Arabic account name following the UI locale (`dashboard-hooks.ts:115-122`, guards defect D46). Centre total equals the sum of visible slices, and separately should equal the "المصروفات التشغيلية" KPI tile for the SAME range — that is the pair that must agree (see MTP-OWN-21).

### MTP-OWN-12 — الأصناف الأعلى مبيعاً (top items) panel
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02, seeded sales exist in the period
- **Steps:** read the ranked list, click a row.
- **Expected:** rows from `GET /reports/sales/top-products?limit=5` for the selected range (`dashboard-hooks.ts:93-99`); each bar's width is `sharePercent` clamped 2–100%. Clicking a row does nothing (`TopItems.tsx` — no click handler).
- **False pass:** the progress-bar-under-each-row styling reads as "tap to expand" — it is not; confirm with a click, and separately confirm the *real* top-products drill path is المبيعات ▸ التقارير ▸ أفضل المنتجات (`report-sales-top-products`), a different screen entirely.

### MTP-OWN-13 — النشاط الأخير (recent activity)
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** read the activity list; post one new journal entry (via any confirmed document) and reload the dashboard.
- **Expected:** shows the 8 most recently POSTED journal entries, newest first (`dashboard-routes.ts:125-128`), each a real `entryNo`/date/memo. After posting a new document, it appears at the top on reload.
- **False pass:** an empty tenant shows «لا يوجد نشاط بعد» — this is a real empty state, not a loading stall; don't mistake it for a bug on a truly fresh database.

### MTP-OWN-14 — بيانات النظام (system data counters)
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** read the six counters (حسابات دليل الحسابات، العملاء، الموردون، الأصناف، القيود المحاسبية، المستخدمون).
- **Expected:** each is a real `COUNT` — accounts/journalEntries from the ledger, customers/suppliers/items from their own counters, users from `uow.users.list()` (`dashboard-routes.ts:99-138`). Cross-check «المستخدمون» against the count of rows on `/settings/users` (RolesPage/UsersPage) — they must match exactly.
- **False pass:** treating this row as a vanity widget not worth checking — it is the cheapest possible trust probe: if the user count here disagrees with the actual users list, every other count on the tile is suspect too.

### MTP-OWN-15 — Period range control («هذا الشهر» / «هذا العام» / «كل الفترات»)
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02, seeded tenant spans 2.5 years of trading
- **Steps:**
  1. Note the revenue tile under «هذا الشهر».
  2. Click «هذا العام», reread.
  3. Click «كل الفترات», reread.
- **Expected:** each click actually refetches — the three values differ meaningfully given 2.5 years of seeded trade, with «كل الفترات» ≥ «هذا العام» ≥ «هذا الشهر» (revenue/expenses only re-scope; cash/receivables/payables/inventory do not, per MTP-OWN-08).
- **False pass:** the chip visually re-highlights but the number underneath is stale — confirm the digits actually changed, not just the chip's active state.

### MTP-OWN-16 — Quick-action buttons open the right create flow
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** click each of «فاتورة جديدة», «سند نقدي», «استلام بضاعة», «فاتورة مشتريات جديدة», «أمر شراء جديد», «عرض سعر», «إضافة صنف».
- **Expected:** each navigates to its screen with `intent: "create"` (`DashboardScreen.tsx:34-42`) and the destination screen actually opens a blank creation form/sub-page, not just the list.
- **False pass:** the screen opens but on the LIST tab instead of the create sub-page — confirm the create form is actually pre-opened, not merely that navigation occurred.

---

## Part 3 — يحتاج متابعة (needs-attention queue): does the button do the thing it says

### MTP-OWN-17 — «تحصيل» on overdue invoices
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02, at least one sales invoice past its due date with `remainingBalance > 0`
- **Steps:**
  1. Confirm the «فواتير مبيعات متأخرة» row shows a non-zero count/amount.
  2. Click «تحصيل».
- **Expected:** count/amount computed from the live `GET /sales-invoices` list — an invoice counts when `status` is not in `{draft, cancelled, reversed, paid}` and today is past `dueDate` (`dashboard-hooks.ts:163-197`).
- **False pass:** the button is labelled "Collect" but only navigates to the unfiltered `sales-invoices` list (`DashboardScreen.tsx:190`) — it does **not** open a collection/receipt dialog and does **not** pre-filter to overdue rows. Verifying "the screen opened" is not verifying "it collected" or even "it filtered."

### MTP-OWN-18 — «متابعة» on due-soon invoices
- **Persona / permission:** owner
- **Preconditions:** an invoice due within 30 days, unsettled
- **Steps:** click «متابعة» on the «تستحق خلال 30 يوماً» row.
- **Expected:** same navigation target as MTP-OWN-17 (`sales-invoices`, unfiltered) — the two different-looking buttons land on the exact same list.
- **False pass:** assuming a distinct label means a distinct destination; grep-confirmed both call `navigate("sales-invoices")` with no filter (`DashboardScreen.tsx:190,208`).

### MTP-OWN-19 — «عرض الإقرار» on VAT due
- **Persona / permission:** owner
- **Preconditions:** posted sales/purchases with VAT in the selected window
- **Steps:**
  1. Read the tax-due figure on the «ضريبة القيمة المضافة المستحقة» row (computed as `vatNetPayable`, output minus input tax — the same figure the VAT return itself shows, guards a fixed defect where the dashboard once said DUE when the return said REFUNDABLE).
  2. Click «عرض الإقرار».
- **Expected:** navigates to `financial-reports`.
- **False pass:** expecting to land ON the VAT tab — `FinancialReportsScreen` always opens on «ميزان المراجعة» regardless of entry point (`FinancialReportsScreen.tsx:143`); the owner must click «إقرار ضريبة القيمة المضافة» themselves. Confirm this extra click is really required before calling the flow complete.

### MTP-OWN-20 — «مراجعة» on below-reorder stock
- **Persona / permission:** owner
- **Preconditions:** at least one item at/below its reorder point (stock-levels report `status === "low"`)
- **Steps:** click «مراجعة» on the «أصناف عند حد إعادة الطلب» row.
- **Expected:** navigates to «مستويات المخزون» (`report-inventory-stock-levels`).
- **False pass:** expecting the item flagged on the dashboard to be pre-selected/filtered on arrival — the navigation carries no filter parameter; the owner lands on the full stock-levels report and must search.

### MTP-OWN-21 — «عرض الأعمار» on aged payables
- **Persona / permission:** owner
- **Preconditions:** a supplier balance aged past 30 days
- **Steps:** click «عرض الأعمار» on the «مستحقات موردين تجاوزت 30 يوماً» row.
- **Expected:** navigates straight to «أعمار ديون الموردين» (`report-aging-suppliers`) — this IS a correct, filtered-enough landing (the report itself is the whole ladder). Cross-check: the dashboard's `agedPayables` figure = sum of the 31-60/61-90/91-120/over-120 buckets on that same report (`dashboard-hooks.ts:190-192`) — the two numbers must be identical to the piastre.
- **False pass:** eyeballing "a report opened" as success without actually summing the four aged buckets on the destination screen and comparing to the dashboard figure.

---

## Part 4 — Trust: does the same fact read the same way twice

### MTP-OWN-22 — Receivables tile vs كشف حساب عميل self-check
- **Persona / permission:** owner
- **Preconditions:** a customer with posted invoices, at least one collection
- **Steps:**
  1. Open العملاء ▸ a customer ▸ كشف الحساب.
  2. Read the closing balance and the pill beside it.
- **Expected:** the statement computes its own closing balance from opening balance + invoices − returns − collections, THEN separately compares that to the aging report's total for the same customer, within `MONEY_RECONCILIATION_TOLERANCE`, and shows «مطابق لتقرير أعمار الديون» (success, green) or «يختلف عن تقرير أعمار الديون» (warning, amber) — `apps/web/src/screens/CustomersScreen.tsx:480,495-500`. Confirm the pill is green on the seeded tenant.
- **False pass:** reading a green pill as "the whole app's AR is correct" — it only proves THIS customer's statement agrees with THIS customer's aging row; it says nothing about the dashboard tile (see MTP-OWN-23).

### MTP-OWN-23 — Dashboard receivables tile vs أعمار ديون العملاء report total
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:**
  1. Read «مبالغ لدى العملاء» on the dashboard for «كل الفترات», `toDate` = today.
  2. Open التقارير ▸ أعمار ديون العملاء and sum the grand total row.
- **Expected:** the two must match — the dashboard tile now sums ONLY accounts `1105/1110/1360` (customer trade AR, instalments, bounced cheques) specifically because summing the whole `11xx` subtree used to disagree with the aging report by pulling in retention (`1150`) and employee advances (`1160`) — a fixed defect, `dashboard-routes.ts:20-28`. This scenario is the regression guard for that fix; a mismatch here is a real, high-severity finding.
- **False pass:** a small difference explained away as "rounding" — the code comment states these must be the exact same population of accounts; any non-zero gap is a defect to report with the exact amount, not a shrug.

### MTP-OWN-24 — Supplier statement: two separate self-checks
- **Persona / permission:** owner
- **Preconditions:** a supplier with posted purchase invoices and at least one payment
- **Steps:** open الموردون ▸ a supplier ▸ كشف الحساب; read both pills.
- **Expected:** the screen shows TWO reconciliations, not one — closing balance vs the AP sub-ledger outstanding (`matchesSubLedger`) AND closing balance vs the supplier's row on أعمار ديون الموردين (`matchesAging`), `SuppliersScreen.tsx:343,359,372`. Both should read green on the seeded tenant.
- **False pass:** checking only the first pill and assuming the second agrees too — they test different things (sub-ledger vs aging bucket totals) and can disagree independently; read both.

### MTP-OWN-25 — Payables tile vs AP sub-ledger, after a landed cost
- **Persona / permission:** owner
- **Preconditions:** seeded tenant includes at least one landed-cost allocation (D42, open)
- **Steps:**
  1. Read «مستحقات الموردين» on the dashboard.
  2. Sum every supplier's outstanding balance across كل الموردين (or the aging report grand total).
  3. Note the difference, if any.
- **Expected:** on a tenant with a landed cost posted, the GL-wide payables tile and the supplier-by-supplier total can legitimately disagree by the landed-cost amount (seed exhibits 2,500.00), because a landed cost credits account `2100` with NO supplier dimension — the money exists in the GL and on no supplier's account (open defect D42, `docs/ROADMAP.md §5`). Confirm the gap, if present, is exactly the landed-cost total and not something larger/unexplained.
- **False pass:** reporting ANY gap here as a brand-new finding — this is a known, already-filed defect (D42); the useful observation is whether the gap is *exactly* the landed-cost amount (expected) or larger (a new, undocumented problem).

### MTP-OWN-26 — Inventory value tile vs تقييم المخزون report
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:**
  1. Read «قيمة المخزون» on the dashboard.
  2. Open المخزون ▸ التقارير ▸ تقييم المخزون and read its total.
- **Expected:** the dashboard figure sums GL asset accounts coded `12xx` (`dashboard-routes.ts:115`); the valuation report sums each item's WAC snapshot quantity × cost (`createInventoryValuationReport`, `packages/api/src/reports-routes.ts:427-431`). `pnpm scenarios` asserts these reconcile to zero on the seeded tenant ("inventory vs GL 1200" invariant) — confirm they still agree on-screen; a gap here is the same class of defect as D37 (mismatched populations) even though the underlying invariant currently holds.
- **False pass:** treating a match as proof the WAC engine is correct — it only proves the two READS of the same ledger agree; it says nothing about whether the WAC cost itself is right (a separate concern, out of scope for the owner persona).

### MTP-OWN-27 — Two trial balances, one truth
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:**
  1. Open ميزان المراجعة from `trial-balance-report` (standalone screen, nav key `trial-balance-report`).
  2. Separately open التقارير المالية ▸ ميزان المراجعة (the first tab of `FinancialReportsScreen`).
  3. Compare total debit and total credit on both.
- **Expected:** both are driven by the same `createTrialBalanceReport`/`GET /financial-reports/trial-balance`; totals must be identical and must balance to zero (debit = credit) on both screens.
- **False pass:** two different-looking pages "both showing numbers" without actually diffing the totals line by line — they must be pixel-for-digit identical, not just similar.

---

## Part 5 — Drill-down: from a headline number to the documents behind it

### MTP-OWN-28 — Aging report row → drill-down panel → real invoices
- **Persona / permission:** owner
- **Preconditions:** a customer with 2+ open invoices in the aging report
- **Steps:**
  1. Open أعمار ديون العملاء.
  2. Click a customer's row (opens the entity-linked drill-down, `apps/web/src/screens/reports/ReportDrillDownPanel.tsx`, hitting `GET /reports/drill-down/customer/:id`).
  3. Read the listed documents.
- **Expected:** the panel lists the actual sales invoices (and other source documents) behind that customer's balance, each linking into `sales-invoices` (`SCREEN_BY_DOC_TYPE`, `ReportDrillDownPanel.tsx:22-26`); the sum of the listed open documents should equal the row total that was clicked.
- **False pass:** the panel opens and "shows some rows" — actually add up the listed amounts and compare to the aging cell that was clicked; a drill-down that opens but disagrees with its own summary is worse than none.

### MTP-OWN-29 — Item drill-down from a stock report
- **Persona / permission:** owner
- **Preconditions:** an item with recent stock movement
- **Steps:** open أعمار المخزون or مستويات المخزون, click an item row.
- **Expected:** `GET /reports/drill-down/item/:id` returns the movements behind that item's on-hand figure (`reports-routes.ts:647`).
- **False pass:** `STOCK_MOVEMENT` documents have no dedicated screen to jump to (`SCREEN_BY_DOC_TYPE.STOCK_MOVEMENT = null`, `ReportDrillDownPanel.tsx:26`) — confirm the panel still shows the movement's facts (date/qty/direction) inline rather than a dead link, since there is nowhere to navigate onward.

### MTP-OWN-30 — Account drill-down from دفتر حساب
- **Persona / permission:** owner
- **Preconditions:** an account with several posted lines
- **Steps:** open التقارير المالية ▸ دفتر حساب, pick an account, click a balance cell if the report exposes one.
- **Expected:** `GET /reports/drill-down/account/:id` resolves to the journal entries that built the balance (`reports-routes.ts:690`), each linking to `journals`.
- **False pass:** confusing "دفتر حساب already lists journal lines" with drill-down — دفتر حساب is itself the ledger detail; the drill-down scenario is specifically about a SUMMARY screen (e.g. a report total) opening to that same underlying detail, not two views of the same list.

---

## Part 6 — Printing something to hand to a customer or a bank

### MTP-OWN-31 — Print a sales invoice
- **Persona / permission:** owner or staff with `sales.invoice.print`
- **Preconditions:** a confirmed sales invoice
- **Steps:**
  1. Open the invoice, click «طباعة».
  2. On the print page, check the ETA block.
  3. Print/export to PDF.
- **Expected:** opens a dedicated ROUTED sub-page (`SalesInvoicePrintPage.tsx`), not a raw `window.print()` over the on-screen table — the ETA (Egyptian Tax Authority e-invoice) number block appears only when a submission was actually `accepted`, and is left out entirely otherwise (`SalesInvoicePrintPage.tsx:27-28`). The toolbar is excluded from the printed page via `@media print`.
- **False pass:** an ETA number appearing on the printed invoice for a document that was never actually accepted by the tax authority — that would be fabricated compliance data; confirm the block is genuinely conditional by printing an invoice with no accepted submission and checking the block is absent, not blank.

### MTP-OWN-32 — Attempt to print a customer statement of account
- **Persona / permission:** owner
- **Preconditions:** open a customer's كشف الحساب
- **Steps:** look for a طباعة/تصدير control on the statement screen.
- **Expected/False pass:** there is none — `CustomersScreen.tsx` has no print or export affordance on the statement view (confirmed by grep: zero matches for print/export strings in the file). An owner who wants to hand a bank a كشف حساب to support a financing request cannot produce one from this screen today. Record this as a real gap, not a missed click.

### MTP-OWN-33 — Print item barcode labels
- **Persona / permission:** owner or staff with label-printing access
- **Preconditions:** at least one item with a barcode configured
- **Steps:** open طباعة الملصقات (`LabelPrintingScreen`), select an item, print.
- **Expected:** produces a real label sheet via the same compliant print-page pattern as invoices, not `window.print()` over the working screen.

---

## Part 7 — Control: who did what, and can staff be stopped

### MTP-OWN-34 — Cost price hidden on an invoice, but NOT on the item screen
- **Persona / permission:** سيد جمال (أمين مخزن / WAREHOUSE_KEEPER — permissions `inventory.item.view`, `inventory.stock.view`, no `sales.*` at all), PIN `123456`
- **Preconditions:** seeded tenant, at least one item with a non-zero cost price
- **Steps:**
  1. Sign in as سيد جمال.
  2. Open الأصناف and read the «تكلفة الشراء» column/detail for any item.
- **Expected/False pass:** it is fully visible. `sales.invoice.view_cost` only gates the unit-cost FIELD on a sales invoice line (field omitted, not nulled, when absent — `packages/api/src/sales-invoices-routes.ts:264,349,639`); `GET /items` returns `costPrice` unconditionally to anyone who can open the list at all (`packages/api/src/items-routes.ts:43`), and `ItemsScreen.tsx` renders it with no permission check anywhere in the file. An owner who believes "staff can't see cost" because invoices hide it is wrong the moment that same staff member has any items-viewing role — this is a real, exploitable control gap, not a missing test.

### MTP-OWN-35 — Cost price DOES hide on a sales invoice for a rep without `view_cost`
- **Persona / permission:** كريم فؤاد (مندوب مبيعات / SALES_REP — has `sales.invoice.view_own`, `sales.invoice.create`, no `view_cost`), PIN `123456`
- **Preconditions:** an invoice كريم created or can view
- **Steps:** open one of his own invoices, look for a cost/margin column.
- **Expected:** the cost field is absent from the line data entirely (not shown as blank/zero) — contrast with MTP-OWN-34 where the same fact leaks through a different screen.

### MTP-OWN-36 — Deleting vs voiding a confirmed invoice
- **Persona / permission:** owner (full permissions) and a role with only `sales.invoice.delete_draft`
- **Preconditions:** one DRAFT invoice and one CONFIRMED invoice
- **Steps:**
  1. As owner, try to delete the confirmed invoice.
  2. Try to delete the draft invoice.
  3. As a role holding only `sales.invoice.delete_draft` (no `sales.invoice.void`), attempt to void a confirmed invoice.
- **Expected:** a confirmed invoice can never be hard-deleted by anyone — only VOIDED (`sales.invoice.void`, `packages/domain/src/permissions/catalog.ts:94`), which reverses rather than erases. Draft deletion is its own separate permission (`sales.invoice.delete_draft`, catalog line 96) — a role can hold one without the other. In the role editor these show as «إبطال — فاتورة» and «حذف المسودة — فاتورة» respectively.
- **False pass:** granting "حذف المسودة" and assuming it also lets someone erase a confirmed invoice — it explicitly does not; confirm the confirmed invoice's delete control is absent/disabled for that role, not merely unused.

### MTP-OWN-37 — Role editor shows only licensed modules
- **Persona / permission:** owner, on المستخدمون ▸ الأدوار ▸ new/edit role
- **Preconditions:** MTP-OWN-02
- **Steps:** open the role editor, scan the module/permission list.
- **Expected:** the picker is built from `licensedModules(entitlements)` / `licensedPermissions(entitlements)` (`apps/web/src/pages/RoleEditorPage.tsx:52-53,137`) — on the seeded tenant, entitlements are hard-coded ENTERPRISE with every module active (`packages/api/src/app.ts:204-232`), so the picker currently shows everything. This is the ONLY screen in the product that reads entitlements at all.
- **False pass:** concluding "licensing correctly restricts the UI" from this screen alone — it is the single wired consumer of entitlements; every other screen ignores them entirely (see **Gaps**).

### MTP-OWN-38 — سجل المراجعة (audit log) shows who confirmed/voided
- **Persona / permission:** owner, or a role with `audit.logs.view`
- **Preconditions:** confirm one invoice and void another during this session
- **Steps:**
  1. Confirm a draft invoice, then void a different confirmed one.
  2. Open سجل المراجعة, filter by module/action if available.
- **Expected:** both actions appear as rows with the acting user, timestamp, entity and action (`GET /audit`, `packages/api/src/audit-routes.ts`) — the audit trail is read-only (no PATCH/DELETE mounted), so it cannot itself be tampered with from the UI.
- **False pass:** seeing SOME rows and assuming today's actions are among them without actually locating the two specific events just performed — a log that is populated but stale looks identical to a working one at a glance.

### MTP-OWN-39 — A role without dashboard access lands where, exactly
- **Persona / permission:** كريم فؤاد (SALES_REP — permission list: `dashboard.view`, `sales.quote.view_own`, `sales.quote.create`, `sales.invoice.view_own`, `sales.invoice.create`, `sales.customer.view`, `inventory.stock.view`; note NO `accounting.journal.view`), PIN `123456`
- **Preconditions:** seeded tenant
- **Steps:** sign in as كريم فؤاد; observe what happens on the forced `/dashboard` landing.
- **Expected/False pass:** `GET /dashboard/summary` is gated on `accounting.journal.view` (`packages/backend/src/dashboard-routes.ts:95`), which SALES_REP does not hold — `dashboard.view` is a DIFFERENT permission string that this route never checks. Since every login is redirected to `/dashboard` (`routes.tsx` index route), a sales rep should hit the dashboard's own error card («تعذّر تحميل...» + «إعادة المحاولة», `DashboardScreen.tsx:330-337`) as their first screen after login, not a working home page. Confirm this is really what happens — a "successful login into a screen showing only an error card" is easy to mistake for a working app if the reviewer doesn't read the panel text.

### MTP-OWN-40 — Branch/warehouse scope actually narrows what staff see
- **Persona / permission:** مجدي رشاد (WAREHOUSE_KEEPER, `warehouseScope` restricted to the Giza warehouse only)
- **Preconditions:** stock/documents exist in at least two warehouses
- **Steps:** sign in as مجدي رشاد; open أرصدة المخزون or a stock report.
- **Expected:** rows are narrowed to the Giza warehouse only (`warehouseScopeOf`/`withinScope`, seen wired through `reports-routes.ts:409-433`) — items/quantities from other warehouses are absent, not merely greyed out.
- **False pass:** the screen "loads without error" — confirm the ROW COUNT is actually smaller than the owner's unscoped view of the same report, not just that no crash occurred.

---

## Part 8 — The offline promise

### MTP-OWN-41 — حالة النظام (system status) tells the offline story honestly
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02
- **Steps:** open حالة النظام (`/status`).
- **Expected:** explicitly states this is a local-first, fully-offline desktop app with no cloud services board — checks only the two things that CAN fail locally (the API responding, SQLite reachable), shows the real shipped app version and a real changelog pulled from actual commits, and an honest empty incident log rather than fabricated uptime (`apps/web/src/screens/hubs/SystemStatusScreen.tsx:1-17`).
- **False pass:** reading "no incidents" as "nothing has ever gone wrong" — it means there is no incident-TRACKING system at all, which the copy says outright; don't let the reassuring green pill substitute for reading the caveat text beside it.

### MTP-OWN-42 — Disconnect the network, keep working
- **Persona / permission:** owner
- **Preconditions:** MTP-OWN-02, app already loaded
- **Steps:**
  1. Disconnect the machine's network (Wi-Fi off / cable pulled).
  2. Create and confirm a sales invoice end to end.
  3. Reopen the dashboard.
- **Expected:** the entire flow works unaffected — invoice creation, GL posting, dashboard figures are all local SQLite reads/writes with no network dependency, matching the offline-first architecture.
- **False pass:** something DOES fail offline and gets misattributed to "the network being flaky" rather than identified precisely — see MTP-OWN-43 for the one flow that is SUPPOSED to behave differently offline.

### MTP-OWN-43 — ETA e-invoice submission queues instead of failing offline
- **Persona / permission:** owner or staff with ETA access
- **Preconditions:** a confirmed sales invoice eligible for ETA submission, network disconnected
- **Steps:**
  1. On شاشة ETA, submit the invoice.
  2. Read the resulting notice.
- **Expected:** because real e-invoicing transmission needs a live connection to the Egyptian Tax Authority and that transmission is stubbed in this build, the app queues the payload rather than losing or silently dropping it — notice text distinguishes an outright `offline` state from a `queued` count (`apps/web/src/screens/EtaScreen.tsx:779,805,847`; catalog `eta.actualSubmissionNeedsALive`, `eta.queuedNotice`). This is the one place the offline story SHOULD read differently from the rest of the app, and does.
- **False pass:** treating the queued notice as a bug because "it didn't submit" — the correct read is that the payload is real and waiting, which is the honest offline behaviour by design; the actual defect to watch for is a queued item that never appears again once connectivity returns (not exercised by this scenario alone — track separately if observed).

---

## Part 9 — Weekly routine

### MTP-OWN-44 — Top customers this month
- **Persona / permission:** owner
- **Preconditions:** several customers with sales this month
- **Steps:** open المبيعات ▸ التقارير ▸ المبيعات حسب العميل.
- **Expected:** ranks customers by revenue for the chosen period, off `GET /reports/sales/by-customer` (`reports-routes.ts:356`); total across all rows should reconcile to the period's «إجمالي الإيرادات» dashboard tile for the same window.
- **False pass:** comparing this report's total against the dashboard tile for a DIFFERENT range (e.g. report defaults to this month, dashboard chip left on «كل الفترات») and calling the mismatch a defect — match the ranges first.

### MTP-OWN-45 — Slow-moving stock
- **Persona / permission:** owner
- **Preconditions:** items with little/no recent sales movement exist
- **Steps:** open المخزون ▸ التقارير ▸ أصناف بطيئة الحركة.
- **Expected:** derived from item snapshots vs sales-invoice history (`createInventorySlowMovingReport`, `reports-routes.ts:445-448`) — a genuinely stale item shows up with its days-since-last-sale, not a fabricated "always empty" placeholder.
- **False pass:** an empty result on a mid-life seeded tenant read as "nothing is slow" — check that at least one seeded item is old enough and quiet enough to legitimately qualify before trusting a zero-row result; per the project's own rule, an empty list surface is itself a finding worth double-checking, not an automatic pass.

### MTP-OWN-46 — VAT return before filing
- **Persona / permission:** owner or المدير المالي (FINANCE_MANAGER)
- **Preconditions:** posted VAT-bearing sales and purchases this period
- **Steps:**
  1. Open التقارير المالية ▸ إقرار ضريبة القيمة المضافة.
  2. Compare the net figure to the dashboard's «ضريبة القيمة المضافة المستحقة» attention row for the same window.
- **Expected:** identical — the dashboard deliberately reads `vatNetPayable` off the SAME `/financial-reports/vat-return` rows the return screen itself uses (`dashboard-hooks.ts:203`, guards a fixed defect where the two used to disagree on due-vs-refundable).
- **False pass:** the two figures agreeing in MAGNITUDE but not sign (one says "DUE 500", the other "RECOVERABLE 500") — that mismatch is exactly the historical defect this pairing exists to catch; check the label, not just the number.

### MTP-OWN-47 — Weekly close: does the trial balance still balance
- **Persona / permission:** owner or FINANCE_MANAGER
- **Preconditions:** a week of new postings since last check
- **Steps:** open ميزان المراجعة, check total debit = total credit.
- **Expected:** balances to zero exactly — `pnpm scenarios` asserts this invariant on the seeded tenant; any live drift after real postings is a first-order defect, not a rounding artifact (money is fixed-point at 1e-6 scale throughout, never float).
- **False pass:** a near-zero but non-zero difference dismissed as "float rounding" — this codebase has no floats in the money path; a non-zero trial balance is real and must be reported with the exact amount.

---

## Gaps — no screen to test

- **No owner-facing licence/plan screen.** `EntitlementsDTO` carries `plan`, `seats`, `expiresAt` (`packages/contracts/src/entitlements.ts:13-19`) but the ONLY consumer in the web app is the role editor's module picker (`apps/web/src/pages/RoleEditorPage.tsx`). There is nowhere in the product for the owner to see which plan they're on, how many of their seats are used, or when the licence expires — even though the data model already supports all three.
- **Licence expiry is not surfaced anywhere.** No banner, badge, or nav warning reads `entitlements.expiresAt`; grepping the whole web app for it returns nothing. An owner cannot know a lapse is coming from inside the product.
- **Entitlements are hard-coded, not testable.** The demo/seeded tenant's entitlements are a constant — `plan: "ENTERPRISE"`, all modules active, `seats: 10`, `expiresAt: null` (`packages/api/src/app.ts:204-232`) — not read from any real per-tenant record. There is no way, against the seeded tenant, to exercise what a module-not-licensed 403 (`packages/api/src/module-gate.ts`) actually looks like on screen, what seat exhaustion does, or what a lapsed licence's grace period behaves like. This is a real hole in what CAN be manually verified today, not just a missing feature.
- **Connected-devices / LAN seat panel is built but not mounted.** `apps/web/src/lan/ConnectedDevicesPanel.tsx` (admin view of who is holding a multi-till seat over the LAN, with per-device disconnect) is a complete component with its own test file, but is imported nowhere in `SCREEN_MODULES`, any settings page, or `AppLayout` — there is no route that reaches it. An owner cannot see "who is connected right now" even though the panel that would show it already exists.
- **No print or export for a customer/supplier statement of account.** Confirmed in MTP-OWN-32: `CustomersScreen.tsx`/`SuppliersScreen.tsx` render كشف الحساب on-screen only. An owner who needs to hand a bank or a customer a signed statement has no path to produce one from this screen.
- **No print page for a purchase invoice, receipt/payment voucher, or any treasury document.** Only sales invoices (`SalesInvoicePrintPage.tsx`) and barcode labels (`LabelPrintingScreen.tsx`) have a dedicated compliant print route; `TreasuryVouchersScreen`, `PurchaseInvoicesScreen`, `ChequesScreen` do not.
- **Real ETA (e-invoice) transmission and real licence-server calls are both stubbed by design in this build** (`apps/web/src/screens/EtaScreen.tsx`, `apps/web/src/login/FirstRunWizard.tsx`) — honestly labelled in the UI copy, but neither can be exercised end-to-end today; only the queuing/staging behaviour around them is testable.
