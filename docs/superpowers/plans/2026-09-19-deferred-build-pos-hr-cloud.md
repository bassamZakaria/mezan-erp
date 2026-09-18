# Deferred build — POS, HR depth, cloud extras (2026-09-19)

The owner un-deferred POS, HR depth and the cloud extras on 2026-09-19, overriding DEC-16 and
§4 of the roadmap. Statutory figures stay «غير مُتحقَّق منه» until a محاسب قانوني signs them row by row
(DEC-12 holds for the figures, not for building). Every lane follows `.claude/skills/mezan-erp` and
`docs/TESTING.md` §1 (unit tests are required again — the skill's "tests disabled" line is stale and is
corrected in lane 0A).

## 1. Gap analysis

### 1.1 HR — archive/plan.md §9.1 (27 tasks): 16 done · 10 partial · 1 missing

| # | Task | Status | Evidence / what is left |
|---|---|---|---|
| 1 | EMP numbering | done | `domain/numbering/sequences.ts:48` (EMP-, ECT-, ADV-, LR-, LAB-, PR-) |
| 2 | hr.* permissions | done | `domain/permissions/catalog.ts:251-283` (32 codes, `view_salary` sensitive) |
| 3 | Departments | done | `domain/hr/department.ts` (parent, manager, overtimeEligible, standardWorkHours) |
| 4 | Job titles | done | `domain/hr/job-title.ts:10` (department-scoped) |
| 5 | Shift settings | **missing** | no model, no `/settings/shifts`; shared with POS (lane 1A) |
| 6 | Employee model | done | `domain/hr/employee.ts:59-100` |
| 7 | Attachments/photo | partial | generic attachments allow `employee` (`domain/attachments/entity-type.ts:23`), bytes stored in SQLite (`persistence/attachment-store.ts:25`); no photo, no FileStore port |
| 8 | Employee full-page form | partial | every section exists but the form is a SidePanel (`EmployeesScreen.tsx:1007`) |
| 9 | Employee list/detail/status/terminate | partial | 7 tabs, transitions, terminate, rehire; detail not addressable by URL; no attachments tab |
| 10 | Contracts model | done | `domain/hr/contract.ts:16,76-93` (hourly/daily modelled, not paid — see 23) |
| 11 | Contracts list/detail/terminate | partial | SidePanel detail (`ContractsScreen.tsx:345`), no audit tab |
| 12 | Attendance model | done | `domain/hr/attendance.ts:16`; no device ingestion |
| 13 | Attendance calendar grid | partial | month navigator + table + monthly summary; no employee × day grid |
| 14 | Holidays | done | `domain/hr/holiday.ts` (recurring) |
| 15 | Leave policies + presets | done | `hr-time-leave-routes.ts:313,366` |
| 16 | Leave requests + half day | done | `LeaveRequestsScreen.tsx:35`, approve/reject routes |
| 17 | Leave request screens | done | list + form (short form, overlay acceptable) |
| 18 | My Leave | done | `MyLeaveScreen.tsx`, `hr-routes.ts:721` — but gated on `hr.leave.view` (no self tier) |
| 19 | Leave accrual batches + JE + scheduled | partial | manual run `hr-time-leave-routes.ts:432`; posting is the separate provision true-up (`hr-payroll-routes.ts:779`); no scheduler |
| 20 | Advances domain | done | `domain/hr/advance.ts:14` |
| 21 | Advances screens | partial | request/approve/disburse; no manual repay (repayment only through payroll) |
| 22 | Payroll design spike | done | DEC-12 addendum; `egypt-statutory.ts` tables with citations |
| 23 | Payroll kernel | partial | monthly basis only — hourly/daily and foreign-currency contracts are **excluded with a warning** (`calculate-payroll-run.ts:289,293`) |
| 24 | Payroll ↔ attendance | partial | overtime and unpaid leave wired (`:354`); D186–D188 open |
| 25 | Payroll ↔ advances | done | `:594`, 10% cap (D183) |
| 26 | Run lifecycle, GL, payslip print | done | `payroll-run.ts:22`, `post-payroll-run.ts`, `print/PayslipPrintPage.tsx` |
| 27 | Payroll screens + HR dashboard | partial | dashboard done; run detail is a SidePanel (`PayrollRunsScreen.tsx:367`) not a page |

Open defects (all only reachable with `hr.payroll.statutory` on): **D186** public-holiday overtime at 100% not «مثلي الأجر» (`egypt-statutory.ts:255,270`); **D187** eligibility, department hours and unapproved clock time (`attendance-overtime.ts:58`, `requireApproval` never set); **D188** overtime table picked once, not by period (`hr-routes.ts:800`); **D189** returns compare a period total with the all-time 2191/2192 balance, through `Number()` (`domain/reports/hr-payroll.ts:285,366`).

New: **D286** — `requireSelfieAtClockIn`/`requireBiometricAtClockIn` are stored and read by nothing (no clock-in flow exists).

### 1.2 POS — archive/plan.md §9.2 (26 tasks) + four ENH items: 0 done · 0 partial · 26 missing

All 26 tasks and ENH-E2-05, E2-06, E2-07 and E3-05 are missing. DEC-14 deleted the `pos.*` codes; `platform/module-catalog.ts:5-9` excludes `pos`.
Scope per §4.1: 9 screens (terminals, sessions, sales, refunds, kitchen, tables, deliveries, discount-approvals,
reservations) + 2 reports (`/reports/pos/daily`, `/reports/pos/shifts`) + `/settings/shifts` + the selling screen + the hub.

Foundations that exist and must be reused, not rebuilt:

| Asset | Where |
|---|---|
| e-receipt producer (DEC-9), UUID port, QR, idempotent reprint | `backend/create-backend.ts:497-684`, `domain/eta/receipt.ts`, `domain/eta/service.ts:207-257` |
| Device serial + POS client id/secret (per BRANCH today) | `domain/eta/mappings.ts:19-32` |
| Sales invoice with tax-inclusive totals | `domain/sales-invoices/totals.ts:99,156` |
| Collect against an invoice → real receipt voucher | `api/sales-invoices-routes.ts:1173` (`deps.collect`) |
| Return from invoice (server-capped qty) + refund voucher | `domain/sales-returns/from-invoice.ts`, `refund.ts` |
| Till over/short accounts, variance posting pattern | `coa-template.ts:117,180`; `field-sales/settle-van-trip.ts` + `create-backend.ts:2961` |
| Embedded price/weight barcode parser | `domain/barcode-config/barcode-config.ts:156` (only behind `admin.settings.view`) |
| `POS_SALE` sequence, 5 POS events | `numbering/sequences.ts:62`, `events/catalog.ts:79-84` |
| `sales.discount.approve` (ex-`pos.discount.approve`) | `permissions/catalog.ts:119` |
| LAN seats, authenticated clients reach all routes, SSE | `lan/session-registry.ts`, `desktop/main/lan-host.ts:179`, `api/lan/routes.ts:252` |
| `allowNegativeStock` policy | `settings/settings.ts:134` |
| POS-receipt print config (UI exists, **nothing reads it — D285**) | `ui/print/types.ts:74`, `settings/PrintTemplatesPage.tsx:321` |

New defects found in the receipt path (file in lane 0A, fix in 0D):
- **D282** — a B2C sales return is queued as `credit_note` with receiver "P" instead of a refund receipt with `referenceOldUuid` (`create-backend.ts:700-776`).
- **D283** — the producer is fire-and-forget after confirm (the till has no UUID/QR to print), runs only when `autoSubmitOnConfirm` is on (`:511`), finds `previousUUID` by scanning every submission (`:658`, slow and racy under concurrent sales), and hard-codes `paymentMethod` from invoice status (`:676`).
- **D284** — every submission, receipts included, is POSTed to `/documentsubmissions` with the company's InvoicingAPI token (`domain/eta/transmit.ts:233`). The e-receipt regime uses its own receipt-submission endpoint and the per-device POS credentials already stored on the branch mapping. So no receipt can actually be reported, which undermines the §4.4 "claim e-receipt compliance" row. The tax-expert must confirm the exact endpoint and headers against the ETA e-receipt SDK before the fix lands.

### 1.3 Cloud — archive/plan.md §9.3 (20 tasks): 5 done · 5 partial · 4 missing · 6 superseded

| # | Task | Status | Evidence / what is left |
|---|---|---|---|
| 1–5 | Postgres codegen, dialect, dual-engine CI, golden ledger ×2, pg_trgm | superseded | one SQLite database per tenant (`superpowers/specs/2026-09-14-saas-completion-design.md` §5 "Out of scope: Postgres"). Do not build |
| 6 | JWT + refresh in HttpOnly cookie, Argon2id | partial | opaque bearer sessions hashed server-side (`api/session-auth.ts:29`), scrypt PINs; the token is kept in `localStorage` (`web/src/data/session.ts`, `platform/session.ts:9`) → lane 6A |
| 7 | Postgres RLS | superseded | DB-per-tenant is stronger isolation |
| 8 | Platform admin tier | done | platform-owner/support, `requirePlatform` (`backend/platform-routes.ts`) |
| 9 | Tenant resolution, server hardening | done | `server/tenant-resolver.ts`, `tenant-router.ts`, `backend-cache.ts` |
| 10 | SSE + Redis realtime | partial | SSE only for `/lan/events`; one Fargate task, so Redis is not needed; no tenant event stream → lane 3C |
| 11 | FileStore S3 | missing | attachments are BLOBs in the tenant DB → lane 6C (optional) |
| 12 | KDS realtime | missing | → lane 5A |
| 13 | Plan → entitlements | done | `domain/platform/derive.ts`, `server/tenant-entitlements.ts` |
| 14 | Onboarding | done | `server/provision-tenant.ts`, `login/FirstRunWizard.tsx` (operator-created) |
| 15 | Billing | partial | manual payments, dunning (`server/dunning.ts`), `PaymentProvider` port with no implementation (`domain/platform/payment-provider.ts`) → 1C |
| 16–17 | API keys, webhooks | missing | deleted by DEC-17; rebuild cloud-only → 6B (same as ENH-E3-09) |
| 18 | Email + server PDF | partial | SMTP delivery exists (`api/smtp-client.ts`); no server PDF, PIN not emailed → 3D/6C |
| 19 | Cloud backup | partial | scheduled in-app backups (`server/backup-scheduler.ts`), S3 in Terraform; no PITR, no per-tenant export → 5D |
| 20 | Deploy shape | done | `Dockerfile`, `render.yaml`, `.github/workflows/deploy-aws.yml`, `server/cloud-app.ts`; apply **needs owner** |

### 1.4 §4.3 SaaS follow-ups and extras (13 items): 1 done · 3 partial · 8 missing · 1 by design

| Item | Status | Evidence |
|---|---|---|
| Subscription suspend/resume button | missing | routes `platform-routes.ts:362,375`; console only has tenant-level (`TenantDetailPage.tsx:159`) |
| `/platform/resolve` name leak | missing | `server/tenant-router.ts:127-133` returns `nameAr/nameEn` in code mode |
| Owner password printed once | by design | set `MEZAN_PLATFORM_OWNER_PASSWORD`; docs only |
| Per-operator remembered tenant | missing | `mezan.tenantCode` per browser (`web/src/data/session.ts:119`) |
| MODULE_NOT_LICENSED on own-loader screens | partial | HR fixed in f148b123 (`loaderError`, `hooks.ts:586`); 31 generic loaders remain in `data/contracting-*-hooks.ts`, plus `TreasuryAccountsScreen.tsx` and `ReportDrillDownPanel.tsx` |
| cloud-app → router → gate test | partial | covered at router level (`tenant-router.test.ts:254,429`), not through `createCloudApp` |
| Sign-out clears cached tenant data (test) | missing | `queryClient.clear()` at `AppLayout.tsx:412`, `ApiContext.tsx:125`, `LoginScreen.tsx:90` — untested |
| Plan editor decimal price + 422 (test) | missing | `PlanEditor.test.tsx` has neither |
| Tenants list loading/failed (test) | done | `TenantsPage.test.tsx:126,153` |
| PLT-SAAS-01..08 browser pass | partial | run 2026-09-14 (`TESTING.md` §11 run record): 01–07 pass, 08 at the API only; re-run after this build (6D) |
| Self-serve signup | missing | → 3D |
| Card checkout | missing | → 1C, **needs owner** |
| AWS apply | missing | Terraform in cyag-devops; **needs owner** |

## 2. Decisions to record in ROADMAP §6.4 (lane 0A — panel + industry check, no questions to the owner)

- **DEC-23** — POS, HR depth and the cloud extras are un-deferred (2026-09-19), overriding DEC-16. The `pos` module is licensable and stays out of the seeded plans until 6D. §4.1 and §4.4 are rewritten.
- **DEC-24** — the posting model for a POS sale:
  - **A (chosen):** a POS sale IS a sales invoice (walk-in customer, tax-inclusive prices), confirmed and then collected once per tender through the existing `collect` voucher. A side table `pos_sale(invoice_id, session_id, terminal_id, client_sale_id UNIQUE, receipt_no, tenders)` carries the POS data. One posting path; aging, returns, the VAT return and the four invariants all keep working.
  - **B (rejected):** a direct Dr drawer / Cr revenue entry. It would be a second posting path, and refunds and returns could not find their source.
  - **C (rejected):** one voucher per session at close. It breaks the link between a tender and its sale, and refunds need that link.
  - Reviewers: accountant, treasury-cashier, performance-engineer (about 3 documents per sale).
- **DEC-25** — the ETA device serial belongs to the **terminal** and falls back to the branch mapping, so a one-till branch keeps working (this is the retail dissent in DEC-9). The receipt chain is kept per serial in its own table.
- **DEC-26** — offline policy:
  - A synced offline sale is never refused for stock; it is posted and flagged in an exceptions list.
  - A sale dated into a period closed since is **held**, and a supervisor re-dates it with a memo.
  - A shift cannot close while its outbox is non-empty, unless the user holds `pos.session.force_close`.
  - Reviewers: warehouse-keeper, chartered-accountant, tax-expert.

## 3. POS design

### 3.1 Code layout (so POS lanes never share files)
Lane 1A creates every shared registration once, plus a file per area; later lanes edit only their area's files.

- `packages/domain/src/pos/` — `terminal.ts`, `payment-method.ts`, `settings.ts`, `shift-template.ts` (1A); `session.ts`, `cash-count.ts` (2A); `sale.ts`, `receipt-input.ts` (2B); `cart.ts` (3A); `refund.ts` (3B); `discount-approval.ts` (3C); `offline.ts` (4A); `tables.ts`, `reservations.ts` (4C); `kitchen.ts` (5A); `deliveries.ts`, `loyalty.ts` (5B); `ports.ts` + `index.ts` (1A).
- Permissions: `domain/pos/permissions.<area>.ts`, concatenated in `domain/pos/permissions.ts`, which `permissions/catalog.ts` imports once (1A). Every code is registered by the lane that gates it, so DEC-14's "no ungated code" rule holds at every merge.
- `packages/api/src/pos/index.ts` mounts `terminals|payment-methods|settings|shift-templates|sessions|sales|refunds|approvals|lookup|sync|reports|tables|reservations|kitchen|deliveries|loyalty-routes.ts` under `/pos`. 1A mounts the index in `app.ts` once; files not yet built export an empty router (not user-visible).
- `packages/backend/src/pos/<area>-wiring.ts`, composed by `pos/index.ts`, which `create-backend.ts` calls once.
- Persistence, one store per area: `pos-store.ts` (terminals, methods, settings, templates), `pos-session-store.ts` (1A creates the schema plus `open` / `findOpenForTerminal`; 2A extends it), `pos-sale-store.ts`, and so on.
- Web: `apps/web/src/screens/pos/<area>/*`, with nav fragments in `screens/pos/nav/<area>.ts` spread into `nav-config.tsx` and `router/screens.ts` by 1A, and strings in `screens/pos/<area>/strings.ts` (the `screens/eta/strings.ts` precedent), folded into `i18n/catalog.ts` in 6D.
- Seed in `backend/demo-seed/pos-<area>.ts`; scenarios in `scripts/scenarios/pos-<area>.ts` (composed by `scenarios/pos.ts`).

### 3.2 Master data (1A)
- **Terminal:** code, name, branch, warehouse, drawer treasury account (must be cash type), enabled methods each with an account, default method, printer (`system` or `escpos-tcp`, address, paper 58/80 mm), ETA device serial, POS client id and sealed secret, active, `lastReceiptSeq`.
- **Payment methods:** built-in CASH and CARD, which cannot be deleted; `kind` is cash, card, wallet, transfer or on_account and maps to the ETA `paymentMethod` code.
- **POS settings:** receipt screen seconds, allow AR collection at the till, cashier/manager % and amount limits, approval expiry (default 5 min), walk-in customer id (a seeded customer with no tax number that cannot be deleted), tax-inclusive flag, meal sections.
- **Shift templates (`/settings/shifts`):** name, from/to, optional branch, active. Used for report bucketing and, in 5C, for HR shift assignment.

### 3.3 Sessions and shifts (2A, E3-05)
- Lifecycle `open → closing → closed`. One open session per terminal and one per cashier. Opening float is declared and moved from the safe with a transfer voucher.
- Cash movements go through existing vouchers: float top-up and withdrawal are transfer vouchers between safe and drawer; a payout is a payment voucher from the drawer to an expense account. Movements are never a free-form number.
- Close:
  - The count is **blind**: the counted amount per method is entered before the expected figure is shown.
  - The expected figure is computed server-side from posted documents only: opening + cash tenders − change − refunds ± movements.
  - The variance goes to 4900/5900 through the van-trip variance path, and a per-shift Z-report prints.
  - `force_close` records how many offline sales were still pending.
- Screen: the session report with its six tabs (settlement, payment breakdown, AR collections, cash movements, sales summary, by salesperson) and the close dialog, per `catalog/05`.

### 3.4 Sale (2B)
- `POST /pos/sales`, idempotent on `clientSaleId`, runs in one unit of work:
  1. Require an open session for the terminal and the caller.
  2. Re-price server-side from price lists and promotions. A client price is never trusted; a price override needs `pos.price.override`.
  3. Create the invoice (walk-in or named customer, the terminal's warehouse, tax-inclusive), insert the `pos_sale` row, confirm (GL plus stock through the existing service), collect each tender into its account (the drawer for cash, the net of change).
  4. Enqueue the receipt **synchronously** with the terminal serial and the real payment-method code, and return `{saleNo, receiptNo, uuid, qrValue}`.
- `on_account` is only allowed for a named customer, and runs the credit-control check.
- Buyer ID is prompted when the total reaches `buyerDataThreshold`.
- The ETA hand-off after confirm skips POS invoices (by checking `pos_sale`), so no receipt is filed twice or with the wrong serial.
- Screens: `/pos/sales` list with KPIs and the status tabs (مكتمل / مرتجع جزئياً / مرتجع بالكامل), and the detail page (items, payments, entries, attachments, audit) with «إنشاء مرتجع».

### 3.5 Selling screen (3A, E2-05, E2-07)
- Full-screen `#/pos/sell`, outside the rail, opened from an open session.
- The scan buffer always has focus. A keyboard-wedge scanner is detected by keys arriving under 30 ms apart and ending in Enter. Embedded price and weight barcodes go through `parseEmbeddedBarcode`, via `GET /pos/lookup?code=` (gated `pos.sale.create`, not admin).
- Key map: F2 search, F3 customer, `*` or F4 quantity multiplier, F5 hold, F6 recall, F7 discount, F8 pay, F9 exact cash, F10 card, F12 finish and print, Esc remove line, +/− quantity. Touch fallback buttons are at least 44 px.
- Cart totals use the pure `salesInvoiceTotals`, so the screen and the server agree to the micro-unit.
- The cart autosaves to IndexedDB on every change and is recovered on relaunch; held carts are kept per terminal.
- Split tender with a running "remaining" and change due; AR collection at the till when the setting allows it.
- Arabic RTL. Numbers stay LTR inside `mz-num`.

### 3.6 Refunds (3B)
- A refund comes from a sale, or from a blank form. It reuses `sales-returns/from-invoice` (the returnable quantity is capped server-side from posted documents) plus the existing refund voucher paid out of the session drawer.
- The reason comes from a closed list; the refund method defaults to the original.
- A B2C refund files a **refund receipt** with `referenceOldUuid` = the original receipt's UUID (D282), on the refunding terminal's chain.

### 3.7 Discount approval at the till (3C, E2-06, POS #10/#22)
- Limits come from POS settings. Over the cashier's limit the till creates a request (cart hash, %/amount, expiry).
- A manager approves either **at the same till** by entering their own email and PIN (the server checks `pos.discount.approve` and scope and records the decider), or remotely from `/pos/discount-approvals`, pushed over a new tenant SSE stream `GET /events` (generalised from `/lan/events`, per session and tenant).
- Every decision is written to the audit log (the E1-05 audit ledger once it exists). Expired and cancelled states are kept.

### 3.8 Printing (2C)
- `packages/ui/src/print/ReceiptView.tsx`, 58/80 mm. It consumes `posReceipt` (fixing D285), the QR via `QrCode.tsx` from the server's `qrValue`, and the amount in Arabic words.
- Desktop: IPC `pos:print-receipt` → `webContents.print({silent, deviceName})`. The drawer kick (`ESC p 0 25 250`) and a test page go over raw TCP 9100 from `apps/desktop/src/main/pos-printer.ts`; the address is validated against the terminal record, never taken from the renderer.
- Browser/cloud: `@page { size: 80mm auto }` and `window.print()`. The drawer opens through the printer driver's "open drawer" option, and that limitation is stated on screen.
- A reprint uses the same UUID (idempotent).

### 3.9 Offline and LAN multi-till (4A)
- A single-PC install is already offline; only the ETA queue waits for the internet (24 h window).
- A LAN till whose host is unreachable, or a cloud till with no internet, switches to offline selling if it holds a fresh **terminal snapshot**. The snapshot is fetched at shift open and refreshed every 10 minutes: items, prices, promotions, tax rates, the public ETA issuer fields, the chain head and a receipt-number block.
- Offline sales go to an IndexedDB outbox. The receipt is built with the same pure `buildPosReceiptInput` (packages/domain), and the UUID is computed with WebCrypto SHA-256, so it prints with its QR.
- On replay the host posts each sale with the sale's own timestamp, **recomputes** the canonical hash (a mismatch is refused and flagged), applies DEC-26, and advances the terminal's chain and counter.
- Banner: «بيع دون اتصال — N إيصال في الانتظار».
- Proven only by two packaged instances (memory: two-machine testing).

### 3.10 Permissions (registered per area)
`pos.terminal.view/manage`, `pos.settings.edit`, `pos.session.open/close/view/view_all/force_close`,
`pos.cash_movement.create`, `pos.sale.create/view/view_all`, `pos.price.override`, `pos.credit.collect`,
`pos.refund.create`, `pos.discount.approve`, `pos.reports.view`, plus `pos.restaurant.*` behind the feature
`pos.restaurant_mode`. A new seeded role `CASHIER` («كاشير»); `SUPERVISOR` gains `pos.discount.approve`.

### 3.11 Reports and hub (4B)
- `/reports/pos/daily` (per branch/terminal/method, with a GL tie of cash tenders to the drawer accounts).
- `/reports/pos/shifts` (variance per cashier, bucketed by shift template).
- `/pos/hub` with quick start and open shifts.

### 3.12 Restaurant (4C, 5A, 5B)
- Floor designer and live occupancy; one reservation model with two entry points.
- KDS with course routing and bump over `/events`, polling as the fallback.
- Deliveries in six states.
- Loyalty: points are a liability (IFRS 15, part of the price deferred). The accountant and tax-expert rule on VAT at redemption.

## 4. HR depth — what remains
D186–D189 (0B); hourly/daily pay from attendance and foreign-currency contract conversion at the run date's rate, with both figures on the payslip (1B); attendance employee × day grid and device CSV import (1D); a self-service tier `hr.self.*` covering my payslips, my advances, my attendance, and web clock-in that honours D286 (2D); manual advance repayment (2D); employee, contract and payroll run as addressable pages (4D); scheduled leave accrual with catch-up in `backend/scheduled-jobs.ts` (4D); payroll bank file, generic CSV plus two bank layouts, from a disbursed run (4D); shift templates assigned to employees (5C, reusing 1A). Statutory rows stay `verified: false`.

## 5. Cloud extras — what remains
0C: the resolve leak (answer only `{mode, exists}` in code mode, or require a signed-in session to see the name); subscription suspend/resume buttons; tenant memory keyed per signed-in operator; contracting loaders moved to `loaderError`; the three test gaps.
1C: card checkout — a Paymob adapter behind `PaymentProvider`, a payment link from the console and from an in-app «تجديد الاشتراك», HMAC-verified webhook, idempotent on `providerRef`.
3D: self-serve signup — a public-plan trial, email verification over SMTP, rate limits.
5D: per-tenant export/download from the console (doubles as cloud → desktop migration) and a restore drill.
6A: HttpOnly cookie sessions plus CSRF for the cloud edition (desktop/LAN keep bearer tokens).
6B: integration API and webhooks, cloud only, never on the LAN socket.
6C: S3 FileStore and server PDF — build only against a real consumer; otherwise record the deferral.
6D: PLT-SAAS-01..08 re-run on staging, including 08 on a real subdomain.

## 6. Waves (at most 4 lanes; no shared file within a wave; 1–3 agent-days each)

**Done definition for every lane:**
- `pnpm typecheck && pnpm lint` (RTL, tokens, controls, permission labels).
- Tests beside every changed file (`pnpm test:changed`).
- `pnpm smoke` with the new read paths, `pnpm check:seed` with new list surfaces seeded, and `pnpm scenarios` with the four invariants at exactly zero and the lane's `pos-<area>` / `hr` scenarios.
- `pnpm test:every-screen` and `pnpm test:responsive` (390/360; the sell screen also at 1024×768).
- Driven in the browser in ar/en and light/dark, with a reload.
- A read-only review by the named personas, with functional findings fixed and test-only findings logged.
- ROADMAP and TESTING rows are written by the orchestrator after the wave merges, never by two lanes at once.

| Wave | Lane | Scope | Main files | Reviewers |
|---|---|---|---|---|
| 0 | 0A | DEC-23..26, D282–D286 filed, POS design artifact (storyboards + options with diagrams), persona/context/skill updates | `docs/ROADMAP.md`, `docs/artifacts/mezan-pos-designs.html`, `.claude/stakeholders/context.md`, `.claude/agents/{client-retail,product,hr-payroll}.md`, `.claude/skills/mezan-erp/SKILL.md` | client-retail, client-restaurant, treasury-cashier, tax-expert, designer, owner |
| 0 | 0B | D186–D189 | `domain/hr/{egypt-statutory,attendance-overtime,department}.ts`, `api/hr-routes.ts`, `domain/reports/hr-payroll.ts`, `api/reports-routes.ts` (HR part) | hr-payroll, tax-expert, chartered-accountant |
| 0 | 0C | Console and security follow-ups + test gaps | `server/tenant-router.ts`, `server/cloud-app.test.ts`, `web/src/platform/{TenantDetailPage,hooks,PlanEditor.test}.tsx`, `web/src/data/{session,contracting-*-hooks}.ts`, `login/LoginScreen.tsx`, `TreasuryAccountsScreen.tsx`, `reports/ReportDrillDownPanel.tsx` | security-officer, it-admin, designer |
| 0 | 0D | D282–D284: device chain table, shared receipt builder, refund receipt, receipt endpoint + POS credentials, synchronous `issueReceipt` API | `domain/eta/{receipt,service,transmit,mappings}.ts`, new `domain/eta/receipt-from-invoice.ts`, `persistence/eta-store.ts`, `backend/create-backend.ts` (ETA hand-offs only) | tax-expert, security-officer, performance-engineer |
| 1 | 1A | POS scaffold, terminals, payment methods, POS settings, `/settings/shifts` | `permissions/catalog.ts`, `platform/module-catalog.ts`, `numbering/sequences.ts`, `contracts/pos.ts`, `persistence/pos-store.ts`, `pos-session-store.ts`, `api/app.ts`, `api/pos/*`, `backend/pos/*`, `create-backend.ts`, `demo-seed.ts`, `nav-config.tsx`, `router/screens.ts`, `screens/pos/{nav,terminals,settings}/*`, `settings/ShiftTemplatesPage.tsx`, `scripts/{smoke,run-scenarios}.ts` | client-retail, treasury-cashier, it-admin, security-officer, designer |
| 1 | 1B | Hourly/daily pay, FX contracts | `domain/hr/{calculate-payroll-run,statutory-payroll}.ts`, `api/hr-payroll-routes.ts`, `contracts/hr-payroll.ts`, `PayrollRunsScreen.tsx`, `print/payslip-print.ts` | hr-payroll, chartered-accountant, accountant, client-restaurant |
| 1 | 1C | Card checkout (Paymob) | `domain/platform/{payment-provider,paymob}.ts`, `backend/platform-routes.ts`, `persistence/platform-store.ts`, `server/{env,cloud-app}.ts`, `web/src/platform/*`, new `web/src/billing/*` | security-officer, owner, accountant, it-admin |
| 1 | 1D | Attendance grid + device import | `AttendanceScreen.tsx`, new `AttendanceGrid.tsx`, `api/hr-time-leave-routes.ts`, new `domain/hr/attendance-import.ts`, `contracts/hr.ts` | hr-payroll, client-restaurant, end-user, designer |
| 2 | 2A | Sessions/shifts, blind close, variance, Z-report (E3-05) | `domain/pos/{session,cash-count}.ts`, `pos-session-store.ts`, `api/pos/sessions-routes.ts`, `backend/pos/sessions-wiring.ts`, `screens/pos/sessions/*`, `demo-seed/pos-sessions.ts`, `scenarios/pos-sessions.ts` | treasury-cashier, client-retail, accountant, internal-auditor, security-officer |
| 2 | 2B | Sale posting, sales list/detail, receipt per terminal | `domain/pos/{sale,receipt-input}.ts`, `persistence/pos-sale-store.ts`, `api/pos/sales-routes.ts`, `backend/pos/sales-wiring.ts`, `screens/pos/sales/*`, seed/scenario `pos-sales` | tax-expert, accountant, treasury-cashier, warehouse-keeper, client-retail |
| 2 | 2C | Thermal receipt, silent print, drawer kick | `ui/src/print/ReceiptView.tsx`, `screens/pos/print/*`, `desktop/src/main/pos-printer.ts`, `desktop/src/main/ipc.ts`, `desktop/src/shared/ipc-contract.ts` | print-forms-specialist, tax-expert, client-retail, designer, it-admin |
| 2 | 2D | HR self-service + clock-in (D286) + advance repayment | `permissions/catalog.ts` (hr rows), `api/hr-payroll-routes.ts`, `api/hr-time-leave-routes.ts`, `nav-config.tsx`, `router/screens.ts`, new `My{Payslips,Advances,Attendance}Screen.tsx`, `EmployeeAdvancesScreen.tsx` | hr-payroll, security-officer, end-user, a11y |
| 3 | 3A | Selling screen, fast lane, crash-safe cart, split tender, AR at till (E2-05/E2-07) | `screens/pos/sell/*`, `domain/pos/cart.ts`, `api/pos/lookup-routes.ts`, `backend/pos/lookup-wiring.ts` | client-retail, treasury-cashier, designer, a11y, warehouse-keeper |
| 3 | 3B | Refunds + refund receipt | `domain/pos/refund.ts`, `api/pos/refunds-routes.ts`, `backend/pos/refunds-wiring.ts`, `screens/pos/refunds/*`, seed/scenario `pos-refunds` | tax-expert, treasury-cashier, warehouse-keeper, client-retail |
| 3 | 3C | Discount approval at the till + `/events` stream (E2-06) | `domain/pos/discount-approval.ts`, `api/pos/approvals-routes.ts`, new `api/events-stream.ts`, `api/app.ts`, `screens/pos/approvals/*`, `screens/pos/sell/approval/*` (new subfolder only) | security-officer, owner, internal-auditor, client-retail |
| 3 | 3D | Self-serve signup + verification email | new `backend/signup-routes.ts`, `server/cloud-app.ts`, new `web/src/signup/*` | security-officer, it-admin, owner, arabic-linguist |
| 4 | 4A | Offline LAN/cloud till, snapshot, outbox, replay, force close | `domain/pos/offline.ts`, `api/pos/sync-routes.ts`, `backend/pos/sync-wiring.ts`, `screens/pos/sell/offline/*`, `screens/pos/sell/*` | it-admin, security-officer, tax-expert, warehouse-keeper, chartered-accountant |
| 4 | 4B | POS reports + hub | `domain/reports/pos-*.ts`, `api/pos/reports-routes.ts`, `screens/pos/{reports,hub}/*` | client-retail, owner, reports-analyst, treasury-cashier |
| 4 | 4C | Tables + reservations (restaurant mode) | `domain/pos/{tables,reservations}.ts`, `api/pos/{tables,reservations}-routes.ts`, `screens/pos/{tables,reservations}/*` | client-restaurant, designer |
| 4 | 4D | HR pages, scheduled accrual, payroll bank file | `EmployeesScreen.tsx`, `ContractsScreen.tsx`, `PayrollRunsScreen.tsx`, new `backend/scheduled-jobs.ts`, `create-backend.ts`, new `domain/hr/bank-file.ts`, `api/hr-payroll-routes.ts` | hr-payroll, treasury-cashier, designer |
| 5 | 5A | KDS + table/course at the till | `domain/pos/kitchen.ts`, `api/pos/kitchen-routes.ts`, `screens/pos/kitchen/*`, `screens/pos/sell/*` | client-restaurant, performance-engineer, designer |
| 5 | 5B | Deliveries + loyalty | `domain/pos/{deliveries,loyalty}.ts`, `api/pos/{deliveries,loyalty}-routes.ts`, `screens/pos/{deliveries,loyalty}/*` | client-restaurant, accountant, tax-expert |
| 5 | 5C | Hardware and journey E2E, two-machine offline proof, shift templates → HR | `e2e/pos-*.spec.ts`, `e2e/journeys/pos-*`, `domain/hr/employee.ts` (shift assignment) | client-retail, end-user, hr-payroll |
| 5 | 5D | Backup export/download + restore drill in console | `server/backup-scheduler.ts`, `backend/platform-routes.ts`, `web/src/platform/TenantDetailPage.tsx` | it-admin, security-officer |
| 6 | 6A | HttpOnly cookie sessions (cloud) | `api/session-auth.ts`, `backend/auth-routes.ts`, `server/cloud.ts`, `web/src/data/{session.ts,ApiContext.tsx}`, `web/src/platform/session.ts` | security-officer, it-admin |
| 6 | 6B | Integration API + webhooks, cloud only (= ENH-E3-09) | new `domain/integrations/*`, `api/integrations-routes.ts`, `api/app.ts`, settings page | security-officer, client-accounting-office, it-admin |
| 6 | 6C | S3 FileStore + server PDF — only with a consumer | new `persistence/file-store-*.ts`, `server/*` | it-admin, performance-engineer |
| 6 | 6D | Close-out: POS in plans (pricing), strings folded into the catalog, PLT-SAAS-01..08 + POS/HR live pass on staging, ledger | `i18n/catalog.ts`, `screens/pos/**/strings.ts`, `demo-seed/platform.ts`, `docs/{ROADMAP,TESTING}.md` | whole panel + owner |

Order rationale: wave 0 unblocks e-receipts (without D284 no POS receipt is ever reported) and fixes the open HR defects. Wave 1's scaffold is the only POS lane that touches shared files. POS then moves along the path master data → shift → sale → till → offline, and HR and cloud lanes fill the parallel slots.

## 7. Needs owner
- A Paymob (or other EGP card processor) merchant account, API keys and HMAC secret (1C live test; sandbox and test double until then).
- AWS apply: the domain and registrar nameserver change, AWS account/billing, `TF_VAR_platform_owner_password`, `AWS_APP_CI_ROLE_ARN`, `DEVOPS_DISPATCH_TOKEN`, repository variables.
- Render dashboard environment variables for the staging re-run.
- SMTP / sending-domain credentials with SPF and DKIM (3D).
- ETA pre-production registration of a POS device: serial, POS client id and secret (0D/2B live verification).
- Hardware: an 80 mm ESC/POS printer, an RJ11 cash drawer, a USB barcode scanner, optionally a scale and a touch screen (5C).
- A chartered accountant's row-by-row sign-off on the statutory figures (DEC-12) before anyone claims the numbers.
