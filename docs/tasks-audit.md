# Tasks.md Audit — checklist vs. runtime reality

> Audits every ✅ / 🟡 line in `docs/tasks.md` (as of `main` @ `ee8c2d3`) against the actual code: domain module + persistence + a **mounted** API route + a **real** client query/mutation (`apps/web/src/data/hooks.ts`) — versus a screen still running on `*-sample-data.ts` or an in-memory `apps/web/src/store/*` repository, or a config field/toggle nothing consumes.
>
> Verdicts: **VERIFIED full** (checkbox is accurate), **PARTIAL** (some of the bundled deliverable is real, some isn't — or the doc's own severity is understated), **UNBUILT** (the checked capability does not actually exist despite the ✅).
>
> Produced by 8 parallel read-only audits, one per phase-group, each independently grepping/reading the code. Evidence is file:line, not paraphrase.

---

## Phase 0 — Foundations (desktop)

- `docs/tasks.md:9` → `pnpm-workspace.yaml` + `packages/*`, `apps/*` → **VERIFIED full**
- `docs/tasks.md:10` → `packages/persistence/src/unit-of-work.ts`, `sqlite-connection.ts`, 30+ Drizzle-backed repos → **VERIFIED full**
- `docs/tasks.md:11` → `packages/domain/src/money/{money,qty,rounding,amount-in-words}.ts` → **VERIFIED full**
- `docs/tasks.md:12` → `packages/domain/src/users/{user,save-user}.ts`; `apps/web/src/login/LoginScreen.tsx` uses AuthContext → **VERIFIED full**
- `docs/tasks.md:13` → `packages/domain/src/permissions/resolve.ts:21` (`view`/`view_own`/`view_all`), `catalog.ts` deps graph → **VERIFIED full**
- `docs/tasks.md:14` → `packages/domain/src/licensing/license.ts:14,163` (`@noble/ed25519 verifyAsync`) → **VERIFIED full**
- `docs/tasks.md:15` → `packages/domain/src/numbering/{next-number,sequences}.ts` → **VERIFIED full**
- `docs/tasks.md:16` → `packages/domain/src/audit/audit-event.ts:15,25` (append-only, severity taxonomy) → **VERIFIED full** (module itself is real — but see line 137, the module is never wired into the running backend)
- `docs/tasks.md:17` → `packages/domain/src/workflow/action-types.ts` — exactly 26 `code:` entries, `gate.ts` sequential role steps → **VERIFIED full** (module itself is real — but see line 134, it's never wired into the running backend)
- `docs/tasks.md:18` "Notification bus + rules engine core" → `packages/domain/src/events/event-bus.ts` (in-process pub/sub only) + `catalog.ts:3-9` (comment itself names a future "notification-rules engine" and `/notifications/rules`); no `NotificationRule`/persistence, no `notifications-routes.ts`, no config screen; `apps/web/src/App.tsx:345` has a hardcoded `notificationCount={3}` badge → **PARTIAL: only the event bus + a 39-event catalog exist; there is no rules engine (trigger→recipient matching, delivery) despite the checkbox naming one**
- `docs/tasks.md:19` "App shell: RTL, i18n (ar/en), primitives" → **PARTIAL (confirmed anchor case)**: RTL + `<DocumentList>`/`<DocumentDetail>` primitives are real (`packages/ui/src/primitives/`); i18n is not — no i18next in `apps/web/package.json`, `apps/web/src/main.tsx:10-11` and `index.html:2` hardcode `dir="rtl" lang="ar"`, `settings.language` (`SettingsGeneral.tsx:84`) is form-only and never consumed anywhere at runtime
- `docs/tasks.md:20` "Settings foundation: tenant settings, branches, warehouses" → real API/persistence exist for all three (`/settings`, `/branches`, `/warehouses` all mounted, `packages/api/src/app.ts:495-496` etc.) and real hooks exist (`useBranches`/`useWarehouses`, `hooks.ts:782,1052`) — but `apps/web/src/settings/BranchesPage.tsx:4,104` and `WarehousesPage.tsx:26` source from `sample-data.ts` via local `useState`, never call the hooks; no `useSettings` hook exists in `hooks.ts` at all → **PARTIAL: full backend exists, the actual settings/branches/warehouses admin screens don't call it** (this is the general form of the line-19 and line-145 gaps — see line 145 for full breakdown)
- `docs/tasks.md:21` → `apps/desktop/src/main/{window,ipc,updater}.ts`, `apps/desktop/src/backup/{backup-service,restore-service}.ts`, preload `window.mezan.fetch` → **VERIFIED full**
- `docs/tasks.md:22` → `packages/api/src/app.ts` (33 mounted route prefixes), `packages/backend/src/` → **VERIFIED full**
- `docs/tasks.md:23` → `apps/desktop/src/main/lan-host.ts`; `openSqliteConnection`/`withSqliteTransaction` used across 30+ persistence files → **VERIFIED full**

## Phase 1 — Master data & key pages

- `docs/tasks.md:27` → domain `packages/domain/src/items/`, persistence `item-store.ts`, mounted `app.ts:642`, real hooks `hooks.ts:270-283` wired into `ItemsScreen.tsx:22` → **VERIFIED full**
- `docs/tasks.md:28` "Item categories, brands, seasons" → `packages/domain/src/items/item.ts:42` has only a free-text `brand: string | null`; **no** category/brand/season domain module, persistence table, or API route exists at all; `ItemsScreen.tsx:21` imports `demoItemCategories`/`demoUnits` from `items-sample-data.ts` — a hardcoded 2-entry Arabic demo list → **UNBUILT: no dedicated master for any of the three; "brand" is an unmastered string; "season" doesn't exist in the schema; the category picker is 100% sample-data**
- `docs/tasks.md:29` → domain/persistence/mounted (`app.ts:505`)/real hooks (`hooks.ts:310`) wired into `CustomersScreen.tsx:16`, no sample-data import → **VERIFIED full**
- `docs/tasks.md:30` → same pattern, `app.ts:508`, `hooks.ts:350`, `SuppliersScreen.tsx:15` → **VERIFIED full**
- `docs/tasks.md:31` → `app.ts:515`, `hooks.ts:2335`, `TaxesScreen.tsx:5` → **VERIFIED full**
- `docs/tasks.md:32` → `app.ts:512`, `hooks.ts:390,403`, `ChartOfAccountsScreen.tsx:17-18` (a stale header comment in the file claims sample-data-driven; actual imports are real) → **VERIFIED full**
- `docs/tasks.md:33` → `app.ts:518`, `hooks.ts:2241`, `CostCentersScreen.tsx:6` → **VERIFIED full**
- `docs/tasks.md:34` → `app.ts:521`, `hooks.ts:430`, `TreasuryAccountsScreen.tsx:5` (its sample-data import is only for a branch-name label lookup) → **VERIFIED full**
- `docs/tasks.md:35` → `app.ts:524`, `hooks.ts:2281`, `FiscalPeriodsScreen.tsx:10` → **VERIFIED full**

## Phase 2 — Ledger & costing engine

- `docs/tasks.md:39` → `packages/domain/src/gl/post.ts:133,161-165` (UnbalancedEntryError, period gate), `ledger.ts:19` (append-only) → **VERIFIED full**
- `docs/tasks.md:40` → `hooks.ts:631-671`, `JournalsScreen.tsx:75-78,146,207` (balance badge) → **VERIFIED full** (note: a separate legacy `POST /journal-entries` via `postJournalEntrySpike` also exists at `app.ts:801` but is unused by the web app)
- `docs/tasks.md:41` → `packages/domain/src/inventory/wac.ts` + `wac.test.ts:46-113` (golden fixtures, drift/rebuild reconciliation) → **VERIFIED full**
- `docs/tasks.md:42` "Cost-layer immutability + Cost tab" → cost-layer immutability is real and tested (`packages/domain/src/inventory/cost-layer.ts:2-39`) — but **no "Cost tab" exists anywhere in apps/web**: zero hits for "layer" in `apps/web/src/screens`, no cost-layer query in `hooks.ts`, `StockBalanceScreen.tsx` only shows an average-cost column → **PARTIAL: half the bundled item (immutability) is real; the other half (Cost tab UI) was never built**
- `docs/tasks.md:43` "Stock movement ledger" → the persisted ledger is real and wired for sales/purchase flows (`create-backend.ts:206,247-346`, `inventory-routes.ts:123`), but the 4 screens meant to expose it (`StockAdjustmentsScreen.tsx`, `StockTransfersScreen.tsx`, `StockBalanceScreen.tsx`, `PhysicalCountsScreen.tsx`) run entirely against an in-memory `useInventoryOpsStore` seeded from sample-data, zero references to `/inventory/*`. Worse: `packages/backend/src/create-backend.ts` never even wires the `stockAdjustments`/`stockTransfers`/`physicalCounts` options, so those mounted routes (`app.ts:779-796`) are **unreachable in the real running app** → **PARTIAL: backend fully built but the actual "ledger" screens are disconnected demo state, and the corresponding API options aren't wired into production `create-backend.ts` at all**
- `docs/tasks.md:44` "Golden-ledger fixture test suite" → real, but distributed across module files rather than one consolidated suite: `sales-invoices/sales-invoice.test.ts:232-233`, `inventory/wac.test.ts:46`, `purchasing/purchase-chain.test.ts:442,483` — no payroll-module coverage exists (module itself doesn't exist, out of Phase-2 scope) → **PARTIAL: real coverage confirmed for sales/purchasing/WAC, but it's not literally "one suite," and the name overstates the packaging**
- `docs/tasks.md:45` "Multi-currency capture on documents" → currency IS captured (`sales-invoices/service.ts:108,361`, `purchasing/purchase-order.ts:40,165`) but is decorative: `sales-invoices/gl.ts` has zero references to `currency`/`fxRate`, posting amounts are face-value only; `SalesInvoicesScreen.tsx:215` copies currency into the create payload with no rate input or conversion → **PARTIAL: captured but never reaches GL posting/FX conversion**

## Phase 3 — Core Sales & Purchases documents

- `docs/tasks.md:49` → domain/persistence/mounted (`app.ts:574-577`)/real hooks (`hooks.ts:1378-1432`), detail tabs real (`SalesInvoicesScreen.tsx:518-557`). Effects explainer (`:494-499`) is real data-driven but a hardcoded conditional string, not powered by the generic `/documents/journal/effects` endpoint that exists but is never called → **VERIFIED full**
- `docs/tasks.md:51` "confirm/send" → `purchase-order.ts` confirm draft→"sent" IS the send action (one domain transition, matching the bundled wording); mounted `app.ts:705-724`; hooks `hooks.ts:1198-1230`; UI button literally "تأكيد وإرسال" → **VERIFIED full**
- `docs/tasks.md:52` → `purchasing-stores.ts:219,437`, mounted `app.ts:705`, `hooks.ts:1238-1275`, `GoodsReceiptsScreen.tsx:17,125-221` → **VERIFIED full**
- `docs/tasks.md:53` → manual + from-receipt confirmed (`PurchaseInvoicesScreen.tsx:186,251-268`), lifecycle `hooks.ts:1284-1318`, persistence `purchasing-stores.ts:355,444` → **VERIFIED full**
- `docs/tasks.md:55` → `purchase-chain.test.ts` genuine PO→GRN→PI happy-path suite incl. balance invariant (line 517), cancellation/reversal → **VERIFIED full**

## Phase 4 — Inventory operations

> **Self-contradiction found**: lines 59–62 carry a plain ✅, but line 70 (also in this file) is the doc's own admission that these exact four screens don't persist. Code confirms line 70, not the ✅ marks.

- `docs/tasks.md:59` (Stock Balance) → `StockBalanceScreen.tsx:5` imports `sharedInventoryOpsStore`, 0 imports of `../data/hooks` → **PARTIAL: runs entirely on the in-memory store; nothing persists (contradicts its own plain ✅, matches line 70)**
- `docs/tasks.md:60` (Stock Transfers incl. van-warehouse endpoint) → transfers screen uses the in-memory store (same as above); the van-warehouse endpoint itself IS real and mounted (`open-van-trip.ts:56`, `app.ts:549` `/field/van-trips`) → **PARTIAL: main screen not persisted; van-warehouse sub-feature is real**
- `docs/tasks.md:61` (Stock Adjustments, 8 reasons) → 8 reasons confirmed real (`packages/domain/src/inventory/reasons.ts:16-25`, `INITIAL_STOCK` first) but `StockAdjustmentsScreen.tsx:29` runs on the in-memory store → **PARTIAL: reasons are real in domain; screen not persisted**
- `docs/tasks.md:62` (Physical Counts) → `PhysicalCountsScreen.tsx:5` in-memory store, 0 API hooks → **PARTIAL: not persisted**
- `docs/tasks.md:63` (Inventory Valuation report + GL reconciliation card) → valuation report is real and API-backed (`InventoryReportsScreens.tsx:29` → `/inventory/valuation`); no GL-reconciliation card exists on it — the only reconciliation screen is a different, generic sub-ledger screen that itself runs in-memory (`ReconciliationScreen.tsx:17`) → **PARTIAL: report real; the "GL reconciliation card" half of the bundle is absent**
- `docs/tasks.md:64` (drift detection/rebuild tool) → drift-detection report is real and API-backed (`/inventory/drift`); the rebuild function exists in domain+API (`stock-ledger-service.ts:804`, `inventory-routes.ts:166` `POST /rebuild`) but **no web UI or hook ever calls it** — zero hits for "rebuild" in `apps/web` → **PARTIAL: detection real; "rebuild tool" is an API endpoint with no user-facing surface**
- `docs/tasks.md:68` (Configurable Products) → `configurable-product.ts:270` (sandboxed formula eval), waste% (`:37,151,296`), mounted `app.ts:755`, `ConfigurableProductsScreen.tsx:15-19` uses real hooks → **VERIFIED full**
- `docs/tasks.md:70` (the 🟡 self-admission itself) → confirmed accurate and still true today: all four screens (59-62) import `sharedInventoryOpsStore` and have zero `../data/hooks` usage → **VERIFIED accurate**, but flagged above for contradicting lines 59-62's plain ✅

## Phase 5 — Full Sales

- `docs/tasks.md:74` → domain `sales-quotes/sales-quote.ts:15`, API `sales-quotes-routes.ts:241-287` (send/accept/reject/cancel/convert), mounted `app.ts:599`, real hooks `SalesQuotesScreen.tsx:5-11` (incl. convert-to-invoice) → **VERIFIED full**
- `docs/tasks.md:75` "Sales Returns...refund-voucher linkage" → create/confirm/cancel real (mounted `app.ts:603`), but refund-voucher linkage is explicitly out of scope in the code itself: `sales-return-document.ts:5-7` — "never auto-refunds cash...a separate treasury disbursement voucher does that, out of this PR's scope" — only an `isAwaitingRefund` flag exists (`:78`) → **PARTIAL: no refund-voucher linkage exists, contrary to the checkbox text**
- `docs/tasks.md:76` "Price Lists CRUD + per-item override grid" → domain/API support overrides, but the web screen (`PriceListsScreen.tsx:5`) only creates a header and shows a read-only line **count** — no override-grid editor, no line-update hook → **PARTIAL: create+list only in the UI; the override grid was never built despite API support**
- `docs/tasks.md:77` (Promotions) → all 5 named types implemented (`engine.ts:280-298`) + coupon gate → **VERIFIED full**
- `docs/tasks.md:78` (Credit control) → `credit-check.ts:39` gates `sales-invoices/service.ts:210` at confirm time, BLOCK throws (`:288-289`), policy wired via API deps → **VERIFIED full — a real enforced runtime check**
- `docs/tasks.md:79` "Sales invoice profit/margin computation" → per-line `unitCost` is captured but the code comment (`service.ts:444`) says it is "used only for display capture," feeding COGS/GL only — **no profit/margin is ever computed against sell price** anywhere (not in domain, reports, API, or the screen); "profit"/"margin" fields elsewhere belong to unrelated modules (cost-center P&L, configurable products) → **UNBUILT: the named capability does not exist**

## Phase 6 — Full Purchases

- `docs/tasks.md:84` "RFQs...supplier invitation/quote comparison" — 🟡 → CRUD/workflow/comparison/PO-convert are real and fully mounted (`app.ts:769-772`, real backend wiring `create-backend.ts:445-450`, real hooks `RfqsScreen.tsx:19-27`) — but "supplier invitation" as a distinct feature doesn't exist: no invited-supplier list or invite/notify action anywhere in `rfq.ts` or `rfq-routes.ts` → **PARTIAL: most of the bundle is solidly built; the invitation half is missing**
- `docs/tasks.md:85` (RFQ→PO conversion) → `rfq.ts:329,365`, `RfqsScreen.tsx:19,386` → **VERIFIED full**
- `docs/tasks.md:86` "Purchase Returns...refund linkage" → create/confirm/cancel real (`purchase-returns-routes.ts:91,100`); refund linkage does not exist — `purchase-return-document.ts` has no refund field, `voucher-types.ts` has no purchase-return reference, `PURCHASE_RETURN_GL_ACCOUNTS` (`create-backend.ts:123-127`) has no cash/refund account, no "refund" text anywhere in the screen → **PARTIAL: refund linkage entirely unbuilt**
- `docs/tasks.md:87` "Landed Costs...linked-invoices tab" → CRUD + distribution by value/quantity fully real (`LandedCostsScreen.tsx:13,42,154`); "linked-invoices tab" does not exist anywhere (domain, API, or UI) — grep for `linkedInvoice`/`LinkedInvoice` returns nothing → **PARTIAL: the named tab was never built**
- `docs/tasks.md:88` (Procurement gates, 3 named) → all three independently implemented and derived live from settings: require-PO-for-GRN (`goods-receipt.ts:173`), require-GRN-for-invoice (`purchase-invoice.ts:273`), sold-item cancellation guard (`goods-receipt.ts:341-350`), policy mapped from live tenant settings (`app.ts:471-480`) → **VERIFIED full**
- `docs/tasks.md:89` "Historical...Excel import" — 🟡 → backend domain+API+GL posting real and mounted (`app.ts:653-660`); an Excel-parsing utility exists in the UI library (`packages/ui/src/lib/historical-import-file.ts`, exceljs) — but **no screen in apps/web imports/uses it**; the API route only accepts pre-parsed JSON rows → **UNBUILT from a user-facing standpoint: a user cannot actually import an Excel file through the app today**

## Phase 7 — Treasury completion + Installments

- `docs/tasks.md:93` (Unified voucher, 10 types) → `voucher-types.ts:35-45` defines 11 distinct types (all 10 named categories present; `customer_advance` is an extra beyond the list) → **VERIFIED full**
- `docs/tasks.md:94` → `TreasuryVouchersScreen.tsx:34-38,373-403` real allocation hooks → **VERIFIED full**
- `docs/tasks.md:95` "Account statements" → explicit UI stubs, not backed by any API/domain: `customers-routes.ts:42` and `suppliers-routes.ts:40` both comment "Statement/balance rollups are Phase-2 work — not exposed here"; `CustomersScreen.tsx:172`/`SuppliersScreen.tsx:155` render a literal `<StubTab label="كشف حساب" />`. The only real "ledger" feature is the unrelated GL chart-of-accounts ledger report → **UNBUILT: account statements do not exist despite the ✅**
- `docs/tasks.md:96` (Cheque Register, 7 states) → `cheque.ts:22,25` — 5 stored + 2 computed states = 7 → **VERIFIED full**
- `docs/tasks.md:97` (Bank statement CSV import) → real CSV parse + persisted column mapping (`BankReconciliationScreen.tsx:15,25,258-285`) → **VERIFIED full**
- `docs/tasks.md:98` (Bank reconciliation line matching) → `reconciliation-service.ts:122-140` real auto-match against live ledger, mounted `app.ts:536-537` → **VERIFIED full**
- `docs/tasks.md:99` (Cash-vs-bank negative-balance policy) → `cash-guard.ts:29-53` enforced at confirm time (`voucher-service.ts:202-205`), policy read live from settings (`:289`) → **VERIFIED full — a real enforced check, not a dead config field**
- `docs/tasks.md:101` (Installment Plans, 4 frequencies) → `schedule.ts:14` all 4 frequencies, down payment enforced (`:78-81`), real client-side preview → **VERIFIED full**
- `docs/tasks.md:102` (overdue batch + late penalties) → `installments-routes.ts:100-115` real → **VERIFIED full**
- `docs/tasks.md:103` (Collection Follow-ups) → `InstallmentFollowUpsScreen.tsx:5,18-22` real hooks, mounted → **VERIFIED full**

## Phase 8 — Accounting depth

- `docs/tasks.md:107` (Cost-center P&L) → real API exists (`app.ts:626`) but `CostCenterPnLScreen` runs on `accounting-depth-store.ts:346-350` (in-memory) → **PARTIAL: confirms the cross-cutting note (tasks.md:189) — real backend, in-memory web wiring**
- `docs/tasks.md:108` (Fiscal period close) → `fiscal-periods/transitions.ts:14,22,34`, real screen `FiscalPeriodsScreen.tsx:6,50` → **VERIFIED full**
- `docs/tasks.md:109` (Tax groups + CoA linking) → `tax-rate.ts:57-72` (output/input tax account linking), real screen → **VERIFIED full** (entity is literally called `TaxRate` not `TaxGroup`, but the linking behavior is real)
- `docs/tasks.md:110` (Exchange rates) → real domain/API/persistence exist, but `ExchangeRatesScreen.tsx` runs on `accounting-depth-store.ts:242-267` (in-memory) → **PARTIAL**
- `docs/tasks.md:111` (FX Revaluation) → real API (`fx-revaluation-routes.ts:100,112`), but `FxRevaluationScreen.tsx` runs on the in-memory store (`:372-401`) → **PARTIAL**
- `docs/tasks.md:112` (Balance Reconciliation) → real API (`reconciliation-routes.ts:35-40`), but `ReconciliationScreen.tsx` runs on the in-memory store (`:402-416`) → **PARTIAL**
- `docs/tasks.md:114` (ETA e-invoicing, 5-part bundle) → checked piece by piece:
  - Readiness tracker: real domain logic (`config.ts:53-77`), but the screen itself sources from the in-memory store, not the API
  - Config/credentials: client-secret storage uses a placeholder base64 `seal()` explicitly commented **"not real AES-256"** (`eta-store.ts:23-36,56-63`)
  - Code mapping: `etaCodeType` field is real and persisted, but the actual ETA line `itemCode` at submission time is a passthrough nobody populates — no invoice-confirm caller sets it
  - Submission queue: `.enqueue()` is never called from any real document-confirm flow (only test files call it); no `POST /submissions` creation endpoint exists; the `autoSubmitOnConfirm` config toggle is read/written by config CRUD only — nothing in the sales-invoice-confirm path reads it
  → **PARTIAL: readiness/config/code-mapping domain logic is real; encryption is a placeholder; the submission queue has no real producer, making `autoSubmitOnConfirm` a config field nothing consumes; web screen is in-memory, not API-backed**
- `docs/tasks.md:115` (Opening balances, non-treasury GL accounts) → `packages/api/src/accounts.ts:75-83` — `balance` is hardcoded to zero with an explicit comment "Movements/balance are stubbed until journal posting feeds the ledger"; `ChartOfAccountsScreen.tsx:187` hardcodes the same. (Treasury/customer/supplier opening balances ARE real, elsewhere.) → **UNBUILT: opening balances for non-treasury GL accounts are explicitly stubbed at the API layer**

## Phase 9 — Reports & printing

- `docs/tasks.md:119` (ReportDefinition abstraction) → `packages/domain/src/reports/{types,engine}.ts` → **VERIFIED full**
- `docs/tasks.md:120` (Export pipeline XLSX+CSV on every report) → `report-export.ts:34-49`, always-on Export button in `ReportRunner.tsx:192-219` → **VERIFIED full** (mechanically applies everywhere `ReportRunner` is used — though several of the report packs it's applied to are themselves fixture-driven, see lines 126/127)
- `docs/tasks.md:121` (GL-reconciliation banner component) → real, embedded inline in `ReportRunner.tsx:44-56,244-257` rather than a standalone file, consumed by `trial-balance.ts:86`, `general-ledger.ts:59` → **VERIFIED full**
- `docs/tasks.md:122` (On-demand execution: GL, Account Ledger) → real UI mechanism (`FinancialReportsScreen.tsx:175,180`) but exercised against static fixture data, not live data → **PARTIAL: mechanism real, data behind it is not** (see line 126/127)
- `docs/tasks.md:123` (Print rendering engine A4/A5) → `packages/ui/src/print/PrintView.tsx` is real, but its only consumer found is the settings template-preview page (`PrintTemplatesPage.tsx`) — **no sales-invoice/voucher/document screen actually invokes it for printing a real document** → **PARTIAL: engine real, not reachable from any actual document screen**
- `docs/tasks.md:124` (Arabic amount-in-words engine) → `money/amount-in-words.ts`, real masculine/feminine agreement logic, consumed by PrintView/PrintTemplatesPage → **VERIFIED full** (same reachability caveat as line 123)
- `docs/tasks.md:125` (Sales/Purchases/Inventory/Aging/Installments report packs) → all mounted (`reports-routes.ts:111-234`), real HTTP wiring (`reports-hooks.ts:1-13,33`), used by real screens → **VERIFIED full**
- `docs/tasks.md:126` (Trial Balance, Income Statement, Balance Sheet, Cash Flow, VAT Return) → `FinancialReportsScreen.tsx:36-58` builds its ledger context from `packages/domain/src/reports/financial-fixtures.ts` — a **hardcoded static fixture ledger**, computed client-side, never calling `useReport`/HTTP. `packages/api/src/reports-routes.ts` has **no** endpoint for any of these five statements. `TrialBalanceReportScreen.tsx:6-25` likewise runs on `sampleReportAccounts`/`sampleReportJournalEntries` → **UNBUILT (as real-data reports): none of these five statements has a backend API or live-ledger wiring; they render fixed demo numbers regardless of what's actually posted**
- `docs/tasks.md:127` (General Ledger + Account Ledger report tabs) → same file/lines as above; a real `GET /gl/accounts/:accountId/ledger` endpoint exists (`gl-routes.ts:290`) but is **never called** by any report screen or hook → **UNBUILT (as real-data reports): same static-fixture issue**

## Phase 10 — Platform & config

> This is the highest-priority section — the doc's own preamble (`docs/tasks.md:132`) already admits "most of the admin UIs did not [land]." The audit found the doc still **understates** severity on two engine items and one settings item.

- `docs/tasks.md:134` (Workflow/approvals gate engine) → the engine itself is real, unit-tested, and wired as an optional hook into document-confirm paths — but `packages/backend/src/create-backend.ts:256,263,270,276,282` always resolves `createDocumentWorkflowGate(() => null)`, and the sales-invoices/purchase-invoices dependency blocks (`:361-377`) **omit the `workflow` key entirely**; the domain only gates `if (this.deps.workflow)` (`sales-invoices/service.ts:187`) → **PARTIAL, understated by the doc: the gate engine is functionally inert end-to-end in the real running app — no document type is ever actually gated — not merely "missing a chain-builder UI" as the doc implies**
- `docs/tasks.md:135` (Notification Rules builder) → confirmed accurate as already-⬜, no correction needed
- `docs/tasks.md:136` (Numbering engine, "25 sequence types") → `numbering/sequences.ts:32-68` defines **32** `SEQUENCE_DEFINITIONS`, not 25 → **PARTIAL: count is wrong (32, not 25); the "no admin screen" half of the line is correctly stated**
- `docs/tasks.md:137` (Audit trail core) → a real, unit-tested SQLite audit sink exists (`packages/persistence/src/audit-sink.ts:98`), and the domain's `documents/service.ts:44,313-314` accepts an optional `audit` hook — but it is **never imported or referenced anywhere in `create-backend.ts`** → **PARTIAL, understated by the doc: the audit trail never actually records anything in the real running app — not merely "no UI to view it"**
- `docs/tasks.md:138` (Print Templates) → confirmed accurate as stated (live sample invoice via real PrintView + real amountInWords; 9-tab designer genuinely absent) → **VERIFIED full**
- `docs/tasks.md:141` (Roles & Permissions UI) → real hooks (`App.tsx:222,362`, `hooks.ts:729-773`), mounted (`app.ts:75,798`) → **VERIFIED full**
- `docs/tasks.md:142` (Users screen) → real hooks (`App.tsx:223,350`, `hooks.ts:676-720`), mounted (`app.ts:76,799`) → **VERIFIED full**
- `docs/tasks.md:143` (Dashboard home) → real `useDashboardSummary` (`DashboardScreen.tsx:4,48`, `hooks.ts:247-257`), mounted with real repos (`create-backend.ts:476-484`) → **VERIFIED full**
- `docs/tasks.md:144` (Command palette) → confirmed accurate as stated: `commandItems` literally imported from `sample-data.ts` (`App.tsx:92,342`) into `CommandPalette` → **VERIFIED accurate**
- `docs/tasks.md:145` (Settings, 🟡) → **PARTIAL — more severe than stated, the single most important finding in this audit, same failure mode as line 19's i18n gap but broader:**
  - **عام/الشركة/الضرائب/السياسات (`SettingsGeneral.tsx`)**: `useState<TenantSettings>(sampleSettings)` from local `./sample-data` (`:4,40`); `handleSave` (`:49-58`) only runs the pure domain validator and writes back to local state — **zero network calls anywhere in the file**. The file's own top-of-file comment admits it: *"Demo-data only... edits live in local state."* Meanwhile a fully real, permission-gated `GET/PUT /settings` API exists (`settings-routes.ts:1-48`), IS mounted in production (`create-backend.ts:334`), and IS read live for real business logic elsewhere (`app.ts:472-477` purchase-policy mapping, credit-control checks) — `grep` confirms **zero** occurrences of `"/settings"` anywhere in `apps/web/src`.
  - **Branches (`BranchesPage.tsx`)**: same pattern — `useState<Branch[]>(sampleBranches)` (`:4,104`), zero network calls, while a real `useBranches()`/`/branches` hook is already used correctly in 11 other screens.
  - **Warehouses (`WarehousesPage.tsx`)**: same pattern (`:11,26`).
  - **Print preview**: accurately described (see line 138).
  → Net: of the 7 items bundled under this one 🟡 line, only Print preview is honestly represented — the 4 "real tabs" plus Branches plus Warehouses are pure client-side demo state with a working, already-consumed backend sitting unused underneath every one of them.
- `docs/tasks.md:146` (WAC drift settings panel) → confirmed accurate as already-⬜ → **VERIFIED accurate**

## Phase 11 — Manufacturing

- `docs/tasks.md:152` (BOMs) → `bom.ts:37,97-110` (version field, HALF_UP waste gross-up) → **VERIFIED full**
- `docs/tasks.md:153` (Work Orders, 4-stage) → `work-order.ts:262,274,504,595-613` — all 4 distinct stage transitions confirmed → **VERIFIED full**
- `docs/tasks.md:154` (WIP cost accumulation + GL posting) → `work-order.ts:138,560-590,608-611` + real GL adapter wired at `app.ts:706-751` → **VERIFIED full**
- `docs/tasks.md:155` (Config Instances) → `manufacturing-routes.ts:569-655` full CRUD/preview/close/cancel → **VERIFIED full**
- `docs/tasks.md:157` (recently mounted / stabilization note) → manufacturing IS currently mounted (`app.ts:727-753`, `create-backend.ts:236,431-435,525`), an e2e spec exists → **VERIFIED full — accurate self-assessment, no gap**

## Phase 12 — CRM + Projects + Fixed Assets + Field/Van Sales

- `docs/tasks.md:161` (Leads, 6-state) → `lead.ts:10` exactly 6 states → **VERIFIED full**
- `docs/tasks.md:162` (Opportunities + Pipeline + Stages) → real domain + real kanban screen (no drag-and-drop, moves via button — an explicit code-comment scope decision, not a gap) → **VERIFIED full**
- `docs/tasks.md:163` (CRM Activities / My Tasks) → `ActivitiesScreen.tsx` is real (list/create/complete/cancel), but the `Activity` domain type (`activity.ts:12-21`) **has no assignee/owner field at all** — there is no per-user task filter or view → **PARTIAL: "My Tasks" is not a real distinct capability; the screen is a flat activities list, not scoped to a user**
- `docs/tasks.md:165` (Projects + auto cost-center creation) → `create-project.ts:2,39-46,62` literally calls `createCostCenter` inline in the same command → **VERIFIED full**
- `docs/tasks.md:166` (Asset Register + Categories) → real domain/screens/mount → **VERIFIED full**
- `docs/tasks.md:167` (Depreciation Runs, daily IFRS proration) → `depreciation.ts:71-104` — genuine day-count proration (`daysInService/daysInPeriod`), not a monthly stub; draft→posted confirmed (`create-depreciation-run.ts:71`, `post-depreciation-run.ts:120`) → **VERIFIED full**
- `docs/tasks.md:168` (Asset disposal flow) → searched `fixed-assets/*` and `fixed-assets-routes.ts` — routes are only `/categories`, `/`, `/:id`, `/depreciation/runs*`; **no dispose endpoint, no domain transition function, no UI action** exists. Only the `AssetStatus` enum happens to include a `"disposed"` value (`asset.ts:12`), and `AssetRegisterScreen.tsx:13,20` renders a badge for it if it's ever set some other way → **UNBUILT: no actual way to dispose an asset exists anywhere in the app**
- `docs/tasks.md:170` (Van Trip, 4 capabilities) → all 4 real and API-backed: open (`field-sales-routes.ts:93-165`), stock load (`loadedStock` param), in-field sales/collections (`/:id/cash-movements`), settlement (`/:id/settle`); `VanTripsScreen.tsx:16-26` uses all-real hooks → **VERIFIED full**

## Cross-cutting hardening

- `docs/tasks.md:188` (Real-data sweep: 7 sample-data files, ~20 importers) → recount confirms exactly 7 files and exactly 20 importers; `sample-data.ts:15,171,233` confirmed still owns `navGroups`, `commandItems`, `demoEntitlements` → **VERIFIED full**
- `docs/tasks.md:189` (9 domain-in-browser screens list) → all 9 named screens (StockBalance, StockTransfers, StockAdjustments, PhysicalCounts, ExchangeRates, FxRevaluation, CostCenterPnL, Reconciliation, Eta) confirmed still store-backed today, zero API-hook imports in any of them → **VERIFIED full** (note: a *separate* `BankReconciliationScreen.tsx` correctly uses real hooks — don't confuse it with `ReconciliationScreen.tsx`, which is the one correctly named in this list)
- `docs/tasks.md:190` (SQLite write concurrency) → `openSqliteConnection`/`withSqliteTransaction` real and used across ~20 persistence files → **VERIFIED full** for the fix itself. The claimed-missing regression test is **stale in one half**: `packages/backend/src/create-backend.test.ts:866-897` already exercises concurrent numbering-sequence allocation under `Promise.all` and asserts unique doc numbers — that part of the ⬜ follow-up is done. The other half, concurrent writers across **independent connections/processes** on one file (LAN multi-till), genuinely still has no test → **PARTIAL: doc's follow-up item should be narrowed to "LAN multi-till writers" only, numbering-concurrency is already covered**

Whole-file status-marker counts (sanity check): `✅` = 102, `🟡` = 8, `⬜` = 20 (`grep -c` over `docs/tasks.md`).

---

## Summary

| Verdict | Count |
|---|---|
| **VERIFIED full** (checkbox accurate) | 71 |
| **PARTIAL** (bundled item partly landed, or doc understates severity) | 32 |
| **UNBUILT** (checked capability doesn't actually exist) | 8 |
| **Total checklist bullets audited** | 111 |

So **71 of 111** audited ✅/🟡 items are fully verified; **32** are partial (a real backend/domain exists but the web screen is disconnected, sample-data-driven, or a piece of the bundle is missing); **8** are flatly unbuilt despite being checked off.

### The 8 flat UNBUILT items (highest-signal findings)
1. `docs/tasks.md:28` — Item categories/brands/seasons: no domain module at all; UI is a 2-entry hardcoded demo array.
2. `docs/tasks.md:79` — Sales invoice profit/margin computation: cost is captured but never turned into a profit/margin figure anywhere.
3. `docs/tasks.md:89` — Historical Excel import: backend + parser both exist, but nothing in the web app wires them together — a user cannot actually do this.
4. `docs/tasks.md:95` — Customer/supplier account statements: explicit `<StubTab>` placeholders; API comments literally say "not exposed here."
5. `docs/tasks.md:115` — Opening balances for non-treasury GL accounts: hardcoded to zero, explicitly stubbed in `packages/api/src/accounts.ts`.
6. `docs/tasks.md:126` — Trial Balance / Income Statement / Balance Sheet / Cash Flow / VAT Return: **no backend API exists for any of the five** — all render a hardcoded static fixture ledger regardless of real GL data.
7. `docs/tasks.md:127` — General Ledger / Account Ledger report tabs: same static-fixture issue; the real `/gl/accounts/:id/ledger` endpoint exists but nothing calls it.
8. `docs/tasks.md:168` — Asset disposal flow: no domain transition, no API route, no UI action exists — only an enum value that happens to include "disposed."

### The recurring PARTIAL pattern (accounts for most of the 32)
Two structural anti-patterns explain the bulk of the partial findings:
- **Domain-in-browser screens**: 9+ screens (StockBalance, StockTransfers, StockAdjustments, PhysicalCounts, ExchangeRates, FxRevaluation, CostCenterPnL, Reconciliation, Eta) run real business logic against an in-memory store in `apps/web/src/store/*`, with a fully mounted matching API route sitting unused. This is self-documented at `docs/tasks.md:189` but under-reflected in the plain ✅ on lines 59-62 specifically.
- **Settings/config screens never call their own backend**: `SettingsGeneral.tsx`, `BranchesPage.tsx`, `WarehousesPage.tsx` (Phase 10, line 145) and the i18n half of line 19 all share the exact same shape — a real, working, already-consumed-elsewhere API exists, and the admin screen for it still runs on `sample-data.ts` + local `useState`, making zero network calls. Two engine-level instances of the same "wired in domain, dead in the composition root" pattern were also found: the workflow gate engine (line 134) and the audit-trail sink (line 137) are both real and tested but never actually invoked by `create-backend.ts`, so neither one does anything in the running app today.

Full detail, evidence, and per-line citations are in `docs/tasks-audit.md` above this summary.
