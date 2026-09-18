# Mezan — roadmap: what is built, what is next, and everything still on the list

**The single roadmap document.** It holds what used to sit in four files — the status
record, the work list, the defect register and the decision register — because they only
ever made sense read together: a task is open *because* a defect is open, or *because* a
decision has not been taken.

Companion: `TESTING.md` — the testing policy, the regression plan, and all 1,686 scenarios.
`archive/plan.md` is the durable reference underneath both: architecture (§1–§3), the market and
competitor study (§8), and the deferred HR/POS/Cloud build plans (§9).

**Updated 2026-09-14.** v1 = Electron desktop, SQLite, real data, Arabic-first.

## How to use this file

- **§2 is what exists.** It is measured against the running app, not against a checklist.
  If this file and the app disagree, the app wins and this file is corrected in the same pass.
- **An item is ticked only when it has been driven in the running app on seeded data, in
  both locales (ar/RTL and en/LTR) and both themes.** A green test is not a tick.
- **§5 is read before every test run** and updated in the same commit as any fix. A defect
  is never deleted; it moves to fixed, because that is how its regression is recognised.
- **§6 is what is waiting on a human.** A defect has a right answer; a decision has two or
  more defensible ones, and each changes a shared contract, so it is not a one-line patch.
  Taking one means recording the option chosen and why — not deleting the row.

## Contents

| § | Section |
|---|---|
| 1 | Where the work stands |
| 2 | Done — the product as it stands, and the parity list item by item |
| 3 | Open now |
| 4 | Deferred by decision — including §4.4, what we may and may not claim |
| 5 | Defects |
| 6 | Decisions — §6.1 and §6.2 are empty; the record is §6.4 |
| 7 | Beyond parity — the enhancement backlog (E1–E3) |
| 9 | Small screens |
| 8 | Shell follow-ups |

---

# 1. Where the work stands

| Track | State |
|---|---|
| **Parity (§2.2, P0–P6)** | Complete but for one cluster — row menus on 17 read-only surfaces, which is a question rather than a backlog item |
| **Open now (§3)** | **Nothing.** Row menus answered (no), contracting complete, outbound notification delivery landed 2026-09-14 |
| **Deferred by decision (§4)** | POS, statutory payroll, HR depth, cloud — not scheduled, not defects |
| **Defects (§5)** | **9 open** of the 139 filed (D66–D204) — D186–D189, the remaining HR payroll follow-ups filed 2026-09-18 (§5.0), all four reachable only with `hr.payroll.statutory` on; and D200–D204, the foreign-currency, reversal and opening-balance follow-ups filed 2026-09-18 while D194–D199 were fixed. The three filed on 2026-09-14 are closed with the decisions that found them: D146 (an item marked FIFO was valued WAC), D147 (a rep holding `view_own` saw an empty list because an employee id was compared to a user id), D148 (consumer e-receipts parked awaiting a seal the regime does not require). Every open half that used to be a decision is now taken — D90 → DEC-19, D111 → DEC-20, D116 → DEC-14 |
| **Desktop audit (2026-09-07)** | The thirty-two findings of the full desktop audit (`artifacts/audit-2026-09-07.md`, filed as D145–D176 on that branch; its first four are renumbered D177–D180 because main had already used D145–D148 — see §6.4 D-D) came in with PR #55: licence, update, LAN, books, performance and security. All fixed on that branch, including Q-1, which moved the desktop backend off the Electron main process into a `utilityProcess` |
| **Compliance (§5.4)** | The B2C e-receipt, the e-seal seam and نموذج 41 landed 2026-09-07 — but nothing *called* the receipt path until DEC-9 wired the producer on 2026-09-14. Law 6/2025's simplified regime is built and deliberately unclaimed (DEC-13) |
| **Decisions (§6)** | **None open.** All fourteen taken 2026-09-14 against the persona panel and recorded in §6.4 with the option chosen, what other platforms do, who dissented, and the cost of reversal. Three scope questions remain in §6.3 — they are pricing calls, not code |
| **Beyond parity (§7)** | 27 candidates across E1–E3, none started; `enhancements` branch only |
| **Shell follow-ups (§8)** | **All 8 done** (2026-09-14) |

## 1.1 Signals

| Signal | Value | Measured |
|---|---|---|
| Nav destinations | **123** | 2026-09-07, `itemKeys` in `nav-config.tsx`; 124 keys carry a permission/module gate in `NAV_ITEM_ACCESS` |
| Routable screens | **123 lazy route modules + 3 inline** | 2026-09-07, `router/screens.ts`'s `SCREEN_MODULES` plus the three addresses `router/routes.tsx` reserves for المستخدمون / الأدوار / محرر الدور, which `AppLayout` mounts itself. `App.tsx` is the router and nothing else now; there is no `ROUTABLE_SCREENS` |
| Read surfaces enumerated in `pnpm smoke` | **203** | 2026-09-07, `READ_PATHS` in `scripts/smoke.ts` (run result: see commit message) |
| «قريباً» placeholders outside HR | **0** | 2026-09-07 — the three remaining `قريباً` strings in `catalog.ts` are "due soon" labels, not placeholders |
| Reference screens still absent | ~14, all POS or POS-adjacent | 2026-08-26 audit |
| `pnpm scenarios` | **6,697 passing, 0 failing** | 2026-09-14 |
| `pnpm test:responsive` | **17 passing, 0 failing** at 390px and 360px | 2026-09-14 |
| `pnpm test` | **10,110 passing, 0 failing** over 867 files | 2026-09-14 |
| The four ledger invariants | all at exactly zero — trial balance, inventory vs GL 1200, AP vs GL 2100, AR vs GL 1105 | 2026-08-27 |
| Typecheck · lint · RTL · native controls · permission labels · theme colour-only | all passing | 2026-09-11 |
| `pnpm smoke` | 240 read surfaces, all responded | 2026-09-14 |
| Backend off the UI loop | the desktop backend runs in a `utilityProcess`; a `VACUUM INTO` that froze the main process for 1,591 ms with zero ticks no longer blocks the window, the LAN socket or the backup schedule | PR #55, 2026-09-07 |
| Contrast sweep, 13 screens × 2 themes | 0 failures, 0 horizontal overflow | 2026-08-27 |
| Business-logic unit tests | **required** — the 2026-08-23 decision was reversed on 2026-08-30 (`TESTING.md` §1): a test goes beside every file changed that has a sibling `.test.ts(x)`. Counts: see the commit message | 2026-09-07 |

## 1.2 How anything is verified

Unit tests are back on (`TESTING.md` §1) and are the floor, not the proof. Above them:

1. **`pnpm smoke`** — boots the real backend, runs the demo seed, hits every read surface.
   Catches an unmounted route, which is the failure mode that has bitten this codebase
   repeatedly.
2. **`pnpm typecheck` and `pnpm lint`** — including the RTL logical-CSS rule, and a
   colour-token rule that fails when a Tailwind colour class names a token that does not
   exist. Such a class emits no CSS at all and the element silently inherits, so it passes
   every other gate; it once shipped an unreadable active tab at 1.52:1.
3. **`pnpm scenarios`** — boots a seeded backend in-process and drives the same HTTP routes
   the UI calls, bracketing every scenario with the books.
4. **Driving the real UI against a seeded backend.** A live click-through found five
   user-facing defects that 2,080 passing unit tests did not.

**A full run used to fail a different handful of screen tests every time while every
one of them passed in isolation.** Two clocks, neither of them the product:
testing-library's `waitFor` deadline is 1s, and vitest's per-test budget is 5s, so under
824 parallel files a screen that refetches ran out of one or the other. The deadline is
now 5s inside a 30s budget (`packages/ui/src/test/setup.ts`, `vitest.config.ts`). Worth
knowing, because a red run that goes green on a re-run trains people to re-run rather
than to read — and this repo's real defects hide in exactly that noise.

```bash
MEZAN_SEED_DEMO=1 MEZAN_DB=./dev.db PORT=3187 pnpm exec tsx apps/server/src/index.ts
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3187 pnpm exec vite --port 5183
```

Sign in as `admin@cyag.example` / PIN `123456` — the login field is the **email and only the
email**. **Reload the page to confirm a save actually persisted**; that check alone has
caught several "works until you look again" bugs.

---

# 2. Done — the product as it stands

## 2.1 By domain

- **No mocked data anywhere in `apps/web`.** No `*-sample-data.ts`, no in-browser store.
  Every screen reads and writes the API. The demo tenant lives in
  `packages/backend/src/demo-seed.ts` and runs only on `MEZAN_SEED_DEMO=1`.
- **Sales** — customers, quotes, invoices, returns, price lists with volume tiers,
  promotions and coupons, credit control, the customer 360 with a dated statement.
- **Purchases** — suppliers, RFQs, orders, goods receipts, invoices, returns, landed costs
  with three allocation bases, the three procurement strictness gates, supplier 360.
- **Inventory** — items across six types, specifications, product templates, configurable
  products, stock balance, transfers (including Excel/CSV import), adjustments with a
  reason wizard, physical counts with cost snapshot and blind counting, label printing
  (Code 128 inline SVG, verified scannable), write-down runs, reserved stock derived from
  open documents.
- **Manufacturing** — BOMs, work orders with the full shop floor (issue, extra issue,
  return, scrap, cost), seven detail tabs, work stations and operators, production dashboard.
- **Accounting** — double-entry ledger, chart of accounts with account routing, cost centres
  and their P&L, journal entries, fiscal periods, tax rates and groups, exchange rates, FX
  revaluation, balance reconciliation, ETA e-invoicing, and the 7 financial statements over
  the live posted ledger. The inventory sub-ledger reconciles to its GL control account
  exactly.
- **Treasury** — 11 voucher types, the allocation queue split by intent, treasury accounts
  with live GL-derived balances, bank reconciliation, the 7-state cheque register.
- **Installments** — plans, schedules, overdue batches, collection follow-ups.
- **CRM, projects, assets, field sales** — leads and the opportunity pipeline board,
  projects, the asset register with depreciation runs, van trips bound to a vehicle registry.
- **HR** — employees, departments, job titles, contracts, holidays, attendance, leave
  requests/balances/accruals/policies, payroll runs, payslips and advances. Statutory payroll
  computation is deliberately absent — see §4.
- **Reports** — 23 operational reports plus the 8 financial statements, each with a
  server-computed KPI strip, charts drawn from the same rows the table shows, quick period
  chips, % contribution bars, GL-reconciliation tiles, drill-down panels and CSV/Excel export.
- **Platform administration** — approvals inbox and workflow config, notification rules,
  numbering sequences, audit viewer, data migration, barcode config, profile, users, roles
  and the ~286-permission matrix (20 modules), print templates, eight settings policy tabs whose toggles
  actually change document behaviour.
- **Shell** — domain workspaces, production dashboard, command palette, notification centre,
  system-status pill, working branch/warehouse selectors that narrow scope without ever
  widening it beyond the session grant.
- **Desktop packaging** — the renderer is served from a real `app://` origin rather than
  `file://`, with the path resolution unit-tested as the security boundary it is.
- **Licensing, end to end (2026-09-07).** The vendor public key, the fingerprint salt and the
  check-in address are substituted into the main bundle by esbuild `define`
  (`apps/desktop/scripts/build.mjs`) and a packaged build refuses every environment override of
  them, so a shipped installer can finally verify a paid `license.mezan` — before this, every
  packaged build resolved `NO_PUBLIC_KEY` and blamed the shop. The check-in clock starts at the
  licence's signed `notBefore`, the payload carries the real `licenseId` and the salted machine
  fingerprint, the reply is Ed25519-signed and replay-checked, and **no licence verdict ever
  exits the app**: past 7 days without a confirmation the install is read-only, past 30 it adds
  a blocking Arabic notice, and the books stay readable, printable and exportable throughout.
  The verdict is re-read per request, so «تحقّق الآن» lifts read-only without a restart. The
  guard record is HMAC'd to the database key, so deleting it resolves to TAMPERED rather than
  to a fresh week. Module entitlements now gate 46 route prefixes; first-run activation is a
  real file import that reports the verifier's own verdict; `--print-machine-fingerprint`, a
  copyable fingerprint on the banner and a three-step transfer procedure give a replacement PC
  a way back.
- **The vendor half of licensing (2026-09-07).** It did not exist at all. `pnpm licence:keygen`
  mints the Ed25519 pair, `pnpm licence:issue` signs a licence (plan, modules, features, seats,
  validity, grace, repeatable `--bind`), and `apps/licence-server` answers `POST /checkin` with
  a **signed** verdict off a JSON revocation list, recording every (licence, fingerprint) pair
  it sees as the evidence for a revocation decision. `INSTALL.md` §9 is the runbook.
- **LAN pairing without a consultant (2026-09-07).** The host advertises `_mezan._tcp` with its
  certificate fingerprint; a till pairs from its own login screen through a discovery, compare
  and confirm flow that puts the two fingerprints side by side — the character-by-character
  comparison INSTALL described as a procedure now exists as a screen, and a mismatch gets its
  own refusal rather than a silent pin. A moved host is found again by its pinned certificate
  and reconnected in one press. Every `LanClientError` code has its own Arabic sentence, login
  has a 5-second connection budget, a dedicated "cannot reach the host" screen replaces a
  freezing login form, the NSIS installer adds the inbound firewall rule (private and domain
  profiles only), and «اختبر الوصول» separates a blocked port from a dead service.
- **Updates a shop can actually receive (2026-09-07).** Releases are signed by
  `apps/desktop/scripts/sign-release.mjs` over `version || channel || arch || sha512` — the
  tuple, not the hash, so a genuinely-signed old installer cannot be republished as a newer one
  — and the downloaded bytes are re-hashed and re-verified before the installer is handed to the
  OS. The install dialog names the tills that are about to lose their host and defaults to
  "after the app closes". A schema-changing launch takes a `pre-update-<version>` archive and
  «الرجوع إلى ما قبل التحديث» restores exactly it; a newer schema than the build understands is
  refused in Arabic instead of migrated. `/health` carries the version and a client on a
  different build says so. A build with no feed answers «لا تتوفر تحديثات تلقائية في هذه النسخة»
  once, dismissably, instead of reporting a failure.

## 2.2 Parity, item by item

The ordered work list. Every item traces to a requirement id in
`archive/reference-parity/REQUIREMENTS.md` (R…) or a gap id in
`archive/gap-inventory.md` (A…/H…), or to a defect in `archive/defect-register.md`.
Scenarios that verify them are in `TESTING.md` §15.

Tick an item only when it has been driven in the running app on seeded data, in
**both locales** (ar/RTL and en/LTR) and **both themes**.


---

### P0 — correctness (blocks everything else)

- [x] **D43** Remove the four "(المرحلة الثانية)" placeholders and wire the real data
  - [x] item detail → stock by warehouse (`GET /inventory/items/:id/stock`, warehouse-scoped)
  - [x] item detail → cost, from the WAC layers
  - [x] chart-of-accounts detail → account movements from the GL
  - [x] treasury account detail → movements from the voucher postings
  - [x] the stale comment claiming the movements table was a stub
- [x] **D44 / R6.7** Cost centres get their own columns + "create from departments"
      - [x] Own six columns — الكود · الاسم · النوع · مرتبط بـ · المركز الرئيسي · الحالة, rendered by the screen itself rather than by the chart-of-accounts tree, with type labels and names resolved per locale
      - [x] "Create from departments" — `GET /cost-centers/importable-departments` + `POST /cost-centers/from-departments`; each new centre is linked to its department, so a second import adds nothing
- [x] **D45** Seed configurable-products, custom-manufacturing, installment-follow-ups; add all three to `pnpm check:seed`
- [x] **R1.1** Add `…/counts` and `…/stats` endpoints to every list resource; move chip counts and KPI money off the loaded page and onto the server
      - [x] Sales invoices — `/sales-invoices/counts` + `/stats`, derived `open`/`overdue` chips resolved server-side, `branchId`/`warehouseId`/`search` added to the list query
      - [x] Purchase invoices — `/purchases/invoices/counts` + `/stats`, payment states (`overdue`/`due_soon`/`partially_paid`/`paid`) resolved server-side
      - [x] The float defect underneath it: 22 money sums across 14 screens moved to bigint (`apps/web/src/lib/money.ts`)
      - [x] The remaining 20 list resources — sales quotes, sales returns, purchase returns, purchase orders,
            goods receipts, RFQs, treasury vouchers (`/stats`), cheques, instalment plans, collection follow-ups,
            treasury accounts, items, stock adjustments, stock transfers, physical counts, journal entries,
            customers, suppliers, work orders and the asset register all carry `/counts` + `/stats` behind ONE
            filter chokepoint. `/counts` drops its own axis on every one of them; `/stats` honours it. Every
            surface is enumerated in `scripts/smoke.ts` (198 read surfaces) and asserted by scenario **x20**
            in `scripts/scenarios/cross-module.ts`: per resource, each chip count equals the rows that chip
            shows, the counts survive a chip being clicked, and the KPI strip follows the filter the rows follow
      - [x] `/customers/stats` and `/suppliers/stats` derive receivables and payables server-side in `Money`,
            from the same figures `/sales-invoices/stats` reports — wired at the composition root in
            `packages/api/src/app.ts` rather than left null
      - [x] All 20 screens pointed at them, so the strip follows the chip instead of reporting the whole book.
            Verified live on a seeded tenant in ar/RTL and en/LTR, light and dark: on quotes, clicking محول moved
            the rows to 1 AND the total from 33,219.60 to 9,849.60 while every other chip kept its own count; on
            cheques, محصل moved 5 rows / 13,050.00 to 2 rows / 7,300.00; on items, «out of stock» moved 19 to 9 in
            the rows AND in all four tiles; on purchase orders, «fully received» moved 72,730.00 to 23,300.00.
            The customers strip's «إجمالي المستحق» now ties to the cent to `/sales-invoices/stats` remaining
            (43,880.88), and `?q=مؤسسه` finds «مؤسسة النور» — the server search forgives ة/ه, the old browser
            `includes` did not (D32)
      - [x] The treasury-accounts money tiles: `/treasury-accounts/stats` gained a ledger source and now answers
            `liveTotal`/`liveCash`/`liveBank` ALONGSIDE the opening figures, summed in `Money` per account from the
            GL — a treasury balance IS its control account's balance. The live keys are ABSENT, never zero, when no
            ledger is wired, so "not measured" cannot be read as "the tills are empty". Verified on the seeded
            tenant: liveTotal 144,335.12 = 4,879.12 + 137,956.00 + 1,500.00, against an openingTotal of 0.000000 —
            which is exactly why publishing the opening figure under «إجمالي الأرصدة» would have reported a tenant
            holding 144k as having nothing. Guarded by scenario **x67**
- [x] **R2.2** Returns must start from a source document, and returnable quantity must be recomputed server-side

### P1 — shell and navigation

- [x] **A1** Third nav level: extend `NavGroup` in `packages/ui/src/shell/types.ts`, render sub-groups, regroup `nav-config.tsx`
  - [x] التقارير → المبيعات / المشتريات / المخزون / التصنيع / الأعمار / الأقساط
  - [x] المخزون → المنتجات / الحركات · التصنيع → الإنتاج / التعريفات
  - [x] الإعدادات → عام / المستخدمون / الفروع والمستودعات / سير العمل / الطباعة / التكاملات
  - [x] المحاسبة → التعريفات / الدورة / التقارير · الموارد البشرية → الموظفون / الحضور والإجازات / الرواتب
- [x] **R1.5** Ctrl+K command palette: quick actions + go-to — go-to entries generated from the nav specs, so the palette cannot drift out of step with the sidebar
- [x] **R1.6** Notification centre — a real feed off `/notifications`; the bell's "عرض جميع الإشعارات" now opens `#/notifications` (all/unread tabs, mark-all-read, verified it survives reload) instead of being a dead link. Demo seed enriched so the seeded tenant opens onto a genuine mixed read/unread inbox rather than an empty one
- [x] **R1.14** Branch and warehouse as a global header scope — six document lists now narrow by warehouse, and changing the scope refetches
- [x] **R1.9** Attention banners on lists (overdue, out of stock, drafts) that apply the filter when clicked
- [x] **R1.10 / R1.11 / R1.12 / R1.13** Empty states with a CTA, collapsible KPI strip, page-size selector, active-filter badge
  - [x] The shared primitives — `EmptyState` (with CTA), `DocumentList`'s `statsCollapsible`/`listKey` (collapse persists across reload) and `filterBarCollapsible`/`activeFilterCount` (a "تصفية النتائج N" badge) — built and driven live end-to-end on the new notifications screen, ar+en, both themes
  - [x] Rollout complete on every screen that renders `DocumentList`: all 65 now pass an `EmptyState` (with the
        list's own toolbar action as its CTA, or no action where nothing is created — an audit log, an approvals
        inbox, a derived report) and a page-size selector; every screen with a `filterBarExtra` also carries
        `filterBarCollapsible` + a real `activeFilterCount`. Screens with no filter bar deliberately do NOT
        collapse — passing `filterBarCollapsible` without a badge would hide filters and say nothing
- [x] **R1.7 / R1.8** System-status indicator and support entry point — a header pill off the real health check (never a fabricated "all systems operational"), and a headset menu (keyboard shortcuts, system status) — both live, real features, not invented contact info

### P2 — reports engine

- [x] **A2 / R21.2** `ReportDefinition` gains `kpis`; the server returns the aggregates; `ReportRunner` renders a collapsible KPI strip
  - [x] the mechanism, and a default that gives EVERY report a strip from its own total columns
  - [x] chart captions (R21.3), methodology footnote (R21.9) and the balance banner (R21.10) as runner capabilities
  - [x] charts — rendered from the SAME rows (or the same group subtotals) the table shows
  - [x] **R21.4** chart view toggles (bars / pie / table / hide) on the chart card
  - [x] per-report `kpis` on all 30 reports — figures the column totals could not say (share overdue, capital tied up, net income, cash variance), each computed server-side over the whole filtered set through the same `sumRows` the grand total uses
  - [x] the float defect underneath it: twelve headline reducers (both ledger reconciliations, net income, total assets, net cash change, VAT net payable, five contribution denominators) were adding piastre-exact money as doubles; VAT net payable reported −12,072.199999999999
- [x] **A3** Quick period chips (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة) — on every report that has a date range
- [x] **A4** Replace the hardcoded `TODAY = "2026-08-22"` with the real current date — and fix the UTC day-shift in every `toISOString()` "today" across 21 screens
- [x] **A6 / R21.6** % contribution on by-item / by-customer / top-products / by-supplier / by-salesperson — rendered as an inline bar, not a bare number
- [x] **A7** GL-reconciliation tile on sales-by-item and purchases-by-item — both tie to the cent
- [x] **R21.1** Every report subtitle is the question that report answers, in both languages (29 rewritten)
- [x] **R21.10** The trial balance states that it balances, as a banner above the table
- [x] **R7.1–R7.6** ETA e-invoicing: readiness meter, general + credentials tabs, item and unit mapping, submissions queue — and the payload now carries the registered codes instead of a hardcoded VAT sub-type
- [x] **R23.1** Pipeline board: stage colour dots, board/list toggle, customer, value-range AND branch filters — an opportunity now carries a branch, the list route enforces branch SCOPE before the filter narrows within it, and converting a lead carries the branch through
- [x] **R9.1** Work-order shop-floor actions — extra issue, return, scrap, record a cost; all five routes existed with no hook and no UI
- [x] **R9.2** Work-order detail: materials with available/shortage, shop floor, costs, movements, receipts, journal entries and audit — all seven tabs
- [x] **R9.3** Production dashboard: the start-production bucket the board was missing
- [x] **A5** Drill-down side panel from entity cells — a customer/supplier/item/account cell opens a panel with that entity and the posted documents behind the figure (`GET /reports/drill-down/<kind>/<id>`, gated by the entity's own permission, capped server-side at 25 with the true total stated). Wired on the 16 columns whose rows carry a real entity id; a document with its own page links to it
- [x] Rolled across all 22 reports and the 8 financial statements (**R6.6** KPI totals + charts) — every report answers with a strip, and every chart carries a caption
- [x] Keep CSV/Excel export everywhere — the reference has none (**X7**); verified live on the balance sheet, both formats

### P3 — document surfaces

- [x] **R2.1** Creation-method step on sales and purchase invoices — the purchase invoice now asks how the document is being built (يدوي / من إيصال استلام) as a STEP, the same two-card shape the sales invoice uses, and collapses to a «تغيير طريقة الإنشاء» summary once answered
- [x] **R2.3** Live available-stock and out-of-stock badge per line — three states, measured against the line's BASE quantity
- [x] **R2.4** Per-line unit of measure with conversion — the line stores the entered unit, its factor and the base quantity; the stock ledger moves the base quantity
- [x] **R2.5** Per-line and per-document discount type (percentage / fixed) — fixed line discounts quantised at the discount boundary and capped at the line gross
- [x] **R2.7** Totals block: subtotal and tax lines added, return-adjusted net kept
- [x] **R2.8** Three-card "effects of this document" explainer including "no automatic collection" — on the create form and the invoice detail
- [x] **R1.4** Attachments across documents and entities — resource built (domain, SQLite store, `/attachments` routes gated by the host entity's own permissions, reusable `AttachmentsTab`) and now on every document and entity that should carry one: items, customers, suppliers, employees, sales invoices, sales quotes, sales returns, purchase invoices, purchase orders, goods receipts, stock adjustments, stock transfers, work orders and treasury vouchers. The six new entity types each map to their host entity's own view and write permissions, so an attachment still carries none of its own. Every type is seeded with a file, so an empty tab is a finding rather than the default. Verified live on all fourteen: upload, reload, still listed, downloadable
- [x] **R1.3** State-dependent row overflow menus — on 42 list screens, each derived from that row's own state helper rather than a second parallel notion of what is allowed. Every action needing input the row cannot supply opens the form that collects it; per-row pending state throughout, cleared in `finally`
  - [ ] The 17 remaining `DocumentList` screens are read-only report surfaces (audit log, stock balance, cost-centre P&L, reconciliation, FX revaluation, leave balances and accruals, attendance) or flat master data whose only per-row action is an inline edit (departments, job titles, holidays, asset categories, leave policies, payroll components, pipeline stages, item specifications, product templates). None carries a lifecycle, so a state-dependent menu there would hold a single entry. Settle against the running reference before adding one
- [x] **R2.11** Cross-document creation — invoice → return / plan / collection; customer → invoice / collection / quote; quote → its invoice (convert on an accepted quote, open the invoice on a converted one); plan → the invoice it schedules; supplier → purchase invoice / payment / purchase order
- [x] **R3.4** Sales-invoice detail: installments tab, the cross-document actions and the attachments tab
- [x] **R4.4** Purchase-invoice detail: landed-costs tab, consumed/received/still-in-stock per line (read from the cost layers the funding document created), an inline «تسجيل السداد» that posts a real سند صرف, and the attachments tab
- [x] **R2.6** Coupon codes — already complete and mis-recorded here. `requiresCoupon` on the promotion, `matchesCoupon` in the engine, the code stored on both the invoice and the quote, an input on the invoice form and a «بكوبون فقط» filter on the promotions list. Verified: a 20-unit cart returns `applicable: false` with no code and unlocks PROMO-DEMO-2 with `BULK15`
- [x] **R2.9** Quick-preview panel — a row opens the document's customer, date, status, lines and totals in a side panel without leaving the list, with a way through to the full document
- [x] **R2.10** Share document — print, and copy a plain-text summary to the clipboard. NOT a share link: the app runs offline on the shop's own machine, so there is no address anyone else could open; copying the figures is what actually gets sent to a customer. A refused clipboard says so rather than looking like it worked

### P4 — entity 360

- [x] **R3.6** Customer 360: overview, invoices, statement, installments, returns, attachments and audit — and customer create/update now emit the audit events the trail tab needs
- [x] **R4.5** Supplier 360: the dated supplier statement, reconciled against both the open-invoice sub-ledger and the aging report, and the action bar (فاتورة مشتريات جديدة · سداد للمورد · أمر شراء جديد)
- [x] **R5.5** Item detail: stock by warehouse (with reserved), cost layers, price lists, specifications, attachments, audit log; adjust-stock / transfer / purchase-request / movement-ledger actions
  - [x] stock by warehouse with available / reserved / total
  - [x] cost layers (remaining qty, unit cost, source, date)
  - [x] price lists (list, base price, custom price, delta)
  - [x] specifications (named from the catalogue, following the reading language), attachments, movement ledger and audit log tabs
  - [x] header actions: adjust stock and transfer, both routing with the item already answered
  - [x] "raise purchase request" — the purchase ORDER is the request document here (owner's call; no requisition type exists). The action opens a new order with the item already on the first line and the supplier left open, since on an item the buyer is exactly what has not been decided
- [x] **R5.6** Reserved stock per warehouse — derived from open documents, never stored
- [x] **R10.1** HR dashboard: department/branch/attendance-mix charts, headcount-movement trend, absence and late-arrival KPIs, leave entitlement columns
- [x] **R10.2** Employee 360 tabs, the attachments tab and the re-hire action (the audit tab still waits on an `entityId` on the audit event)
- [x] **R10.3 / R10.4** Branch and active-contract columns; server-derived contract expiry with a KPI tile, banner and filter chip
- [x] **R10.5** Leave-request create, including filing on behalf of another employee behind `hr.leave.approve`
- [x] **R10.6** Leave-policy presets, listed and applied in one action
- [x] **R10.7** Payroll earning and deduction components, bound to a component registry and routed to their own GL accounts
- [x] **R5.3 / R8.4** Inline opening-balance actions on zero-stock items and treasury accounts
  - [x] **R5.3** items list: row-menu action on zero-stock rows, routed to the adjustment form with the reason and item already answered
  - [x] **R8.4** the same on treasury accounts: a row-menu action on accounts whose balance is zero AND that are bound to a GL account, posting Dr the treasury account / Cr 3210 أرصدة افتتاحية
- [x] **R3.7** Loyalty points — **decided OUT for v1** (owner's call). Points earned are a real liability to the customer, so doing it honestly means a points sub-ledger, an expiry policy, a GL liability account and a redemption path that posts — a module, not a field. A counter on the customer record would be a promise no account backs and nothing could reconcile. No other parity item depends on it

### P5 — missing features

- [x] **R8.1** Voucher types 4 → 11, card grid with explanations, correct GL routing for partner capital, drawings and tax payments
- [x] **R8.2** Voucher list: type filter listing every type (used or not), branch filter, date range, chips for needs-allocation / pending / voided, row menu view / print / cancel
- [x] **R8.3** Needs-allocation queue as a server concern, split by intent (receipt vs payment), with server-side chip counts
- [x] **R6.1** Account-routing screen — a second tab on the chart of accounts mapping every posting to a GL account, wired to the ledger rather than decorative
- [x] **R6.3** Journal entries: date-range filter, source-module column (with the source document number), print
- [x] **R6.4** Tax groups alongside tax rates — compounding members, per-member breakdown
- [x] **R6.5** Exchange rates: search and date filter (the three statuses already existed)
- [x] **R5.1** Item types 2 → 6, with the behavioural rules per type — capability table in the domain; pickers and reports ask the capability, never `type === "stock"`
- [x] **R4.2** Purchase-invoice line types (stock / expense / freight) — three kinds, each routing its debit to its own account: 1200 / 5910 / 5200
- [x] **R5.9** Stock-adjustment reason wizard, per-reason GL accounts, reason on the list and the journal entry, reason filter
- [x] **R9.1 / R9.2** Work-order shop-floor actions and the seven detail tabs with shortage tracking
  - [x] محطة العمل + المشغّل on every issue, extra issue, return, scrap and product receipt — a `work_station` registry (`/manufacturing/work-stations`, managed from the production hub, seeded with three stations) and an employee id, BOTH resolved against their own register before anything is written
  - [x] shown per row on the movements and receipts tabs, joined on the movement's own reference — joining on the timestamp reported one station on every row whenever two actions landed in the same millisecond
- [x] **R7.1–R7.6** ETA: readiness meter, general settings, credentials with test-connection, item mapping, unit mapping with suggestions, submissions queue with exclude
- [x] **R11.1–R11.8** Split settings into the policy tabs and make each toggle actually change document behaviour:
  - [x] credit control mode (warn vs block) — `creditControlEnabled` / `creditControlMode`
  - [x] sell-from-another-warehouse, show other-warehouse stock, backorders, negative stock, aging write-down provision, auto batch numbers — `allowCrossWarehouseSales`, `showOtherWarehouseStock`, `allowBackorder`, `allowNegativeStock`, `agingWritedownEnabled` + months + rate, `autoGenerateBatchNumbers`
  - [x] require PO before GRN, require GRN before purchase invoice — `requirePoForGrn`, `requireGrnForInvoice`
  - [x] block negative cash balances (drawers only, not banks) — `preventNegativeCashBalance` + `allowNegativeTreasury`, both reaching `VoucherService.cashPolicy()` through the `vouchers:` options (D19)
  - [x] VAT enable / default rate / inclusive vs exclusive / depreciation in month of acquisition — `taxEnabled`, `defaultTaxRate`, `taxCalculation`, `depreciationProrate`
  - [x] email SMTP + test send + template — `smtpEnabled` and the rest, with a real `sendTestEmail` in `packages/api/src/smtp-client.ts`
  - [x] multi-currency enable, allowed currencies, missing-rate policy, numeral system, fiscal-year start — `multiCurrencyEnabled`, `secondaryCurrencies`, `fxRateMissingPolicy`, `dateNumerals`, `fiscalYearStartMonth`
  - Ticked 2026-08-27 after checking all three levels rather than the checkbox: each flag is read by the document logic (not merely stored), `pnpm scenarios` flips every one of them and asserts the document behaviour changes with it, and all eight policy tabs were driven live on the seeded tenant
- [x] **R12.1** Approvals: inbox / my requests / my actions, with the document-type filter (R14.1)
- [x] **R3.8** Customer form advanced options — the form splits into everyday fields and «خيارات متقدمة» (tax + commercial registration, tax-exempt, entity type, contact person, address, logo). The logo is chosen from the customer's own attachments, so the bytes live in the attachments resource and the record holds only the id. `priceListId` was a free TEXT field storing whatever was typed; it is now a picker over `/price-lists`, and the routes refuse an id that names no list
- [x] **R3.9** Sales return: a reason PER LINE, a derived awaiting-refund state, and «استرداد للعميل» that creates and confirms a real رد مبلغ لعميل voucher (Dr AR 1105 / Cr the till, one balanced entry). What may still be refunded is recomputed server-side from the posted return and the vouchers already posted against it; `awaitingRefund` is derived from those vouchers rather than stored, so reversing one restores the ledger AND the awaiting state in a single act. `POST /sales-returns/from-invoice` existed in the domain and was mounted nowhere — it is now the shape the screen sends
- [x] **R3.11 / R3.12** Price-list minimum-quantity tiers (an item quoted once per volume threshold, resolved server-side by `resolvePriceTier` and threaded into the sales-invoice pricing check as the line's base quantity); promotion minimum quantity and maximum discount cap, the cap re-allocated by largest remainder so the parts still sum exactly. Both screens now edit every field the reference has, including bundle components over the real item endpoint
- [x] **R3.13** المركبات — a van registry owning each vehicle's warehouse, till and branch. `POST /field/van-trips` takes `vanId` alone and derives the rest, refusing a body that names a van and a different warehouse or till; the crew binds to real employees. The three cascaded fields are read-only and stay empty until a van is chosen
- [x] **R4.6** GRN from PO only — the create form is a creation-method STEP whose «استلام مباشر» card is offered only when the tenant's «إلزام أمر الشراء قبل الاستلام» setting is off. The screen READS that setting; the server gate was already live and now refuses in Arabic
- [x] **R4.7** Landed-cost allocation basis and typed cost lines — a third basis (حسب الوزن) beside value and quantity, the shipped weight carried on the persisted line so a confirmed document still states its basis, and the entered cost broken down by نوع التكلفة on both the form and the document
- [x] **R5.4** Item form: image, description, default supplier, season, channels, per-price-list prices, specifications
  - [x] description, default supplier (bound to a real supplier), season, brand, specifications
  - [x] image — chosen from the item's own attachments, so the file lives in the attachments resource and the item holds only the id
  - [x] channels & visibility — **dropped for v1** (owner's call). The reference carries channels because it sells online; this is a desktop ERP for a shop, where the branch and the warehouse already carry that dimension and are already scoped
  - [x] editing a per-price-list price from the item form — one row per volume TIER, each editable in place, saving the list's whole lines array so no other line is dropped
- [x] **R5.8** Transfer import — paste a range straight from Excel (the clipboard gives TSV), or choose a CSV or a real `.xlsx`. The delimiter is detected per file, quoted fields and Arabic-Indic numerals are handled, and every row is resolved against the REAL item catalogue by code or barcode; a row that matches nothing, or names a service item, is rejected WITH its reason rather than carried through as a plausible id. `.xlsx` is read with no dependency — it is a ZIP of XML and the browser already provides DEFLATE
- [x] **R5.10** Brands, seasons and specification facets — brands and seasons are entities, items carry registry-checked specification values, and the list filters by all three
- [x] **R10.5** Leave-request create action, including filing on behalf of another employee behind `hr.leave.approve`
- [x] **R1.15 / R1.16** 11 document currencies; per-currency AR/AP balances
      - [x] The eleven-currency registry (`packages/domain/src/currency/`), the demo tenant's allowed list, the exchange-rate and revaluation screens
      - [x] A foreign SALES invoice converts at the approved rate of its own date, tags its receivable line, stamps the rate, and stores the BASE total in the sub-ledger (D24's remaining half)
      - [x] `GET /gl/balances-by-currency` — per-currency, per-party AR/AP in both the transaction and the base currency, shown on the revaluation screen
      - [x] Both document forms now offer every currency the TENANT allows, read from `/settings/currencies` rather than hardcoded, and the purchase-invoice form has a currency field at all for the first time. Amounts print in the document's own currency (D52 fixed), and the purchase-invoice form has no currency field at all — its route accepts one, no screen sends one

### P6 — list-surface parity

One task per row of the per-screen tables in `archive/gap-inventory.md` §B–D2. Start with
the money-bearing ones: purchase-invoice payment dimension (**R4.1**), items stock
sales-returns filter bar,
journal date filter and source-module column (**R6.3**), tax groups (**R6.4**),
exchange-rate filters (**R6.5**), branch price-list column, CRM KPIs and board view,
HR dashboard charts (**R10.1**), asset status chips.

---


---

# 3. Open now


> **Two review artifacts sit alongside this section and are not folded into it.**
> `artifacts/simplification-review.html` — 134 findings from 32 reviewers over the code and
> the docs, each with file evidence and a status re-read against the tree; filter it to
> *open* to see what is left. `artifacts/best-erp-in-egypt.html` — every module Mezan ships
> judged against the best product in the world at that job, plus the fourteen Egyptian
> statutory obligations that decide whether any of it is sellable: **five modules ahead of
> the field, nine at par, seven behind, two absent.** Both are point-in-time and were
> compiled on branches other than `main`; their open items are candidates for this section,
> not entries in it, until each is re-checked against the running app.
>
> **The two that cost the most in a deal, from the module audit:** Egypt's B2C e-receipt
> regime (الإيصال الإلكتروني) is a separate mandate from e-invoicing, already in force, and
> this build has nothing for it — with POS descoped, retail, restaurants and pharmacies
> cannot legally transact. And there is no report centre and no drill-down across the
> reports, which the audit names as the accountant's stated breaking point.

**Re-verified 2026-09-07 against the tree; §3.2 added 2026-09-13.** The two items below are still open, and
§5 now carries the larger list. What landed on 2026-09-07 is in §5.4. §3.4 records what moved and why, so nothing is silently dropped.

## 3.1 Row menus on the remaining 17 list screens — R1.3, closed 2026-09-14

- [x] **Answered: no, and the item is closed.** The roadmap called this "a question, not a
      backlog item", and the question has an answer. All 17 are read-only report surfaces
      (audit log, stock balance, cost-centre P&L, reconciliation, FX revaluation, leave
      balances and accruals, attendance) or flat master data whose only per-row action is an
      inline edit (departments, job titles, holidays, asset categories, leave policies,
      payroll components, pipeline stages, item specifications, product templates). None
      carries a lifecycle, so a state-dependent menu on them would hold exactly one entry —
      a control that exists to tell the user it has nothing to offer. The inline edit these
      screens already have IS the row action.

## 3.2 المقاولات — the contracting module, by slice

The design is `artifacts/mezan-contracting-designs.html` (twelve decisions taken, six
build slices). Every slice below was built, seeded, driven on a seeded backend, and then
read by a six-reviewer panel (technical office, external auditor, internal auditor,
revenue-recognition specialist, subcontracts manager, everyday accountant) whose findings
were closed in the same pass — 2026-09-13/14.

- [x] **Slice 0 — the dimension.** `projectId` + `costCategory` on `journal_line`, on every
      GL posting port and on all ten posting paths plus their twins; a category without a
      project is refused; contracting-slot accounts refuse a line with no project; the
      nine `contracting.*` permissions plus three for guarantees; the `contracting`
      entitlement module; cost-centre P&L rollup; project P&L by the two dimensions;
      project pickers on nine forms.
- [x] **Slice 1 — contract & BOQ.** Contract on the `CTR-` sequence with every commercial
      term as a per-contract parameter (نسبة الممارسة, retention + cap, advance + recovery,
      التشوينات, social-insurance pair, WHT, VAT basis derived from the signing date under
      Law 157/2025, payment term, DLP, recognition policy, ETC with a reasoned revision log),
      BOQ with a stored unit enum and Excel import that reviews before it commits, variation
      orders whose approval date is bounded to [document date, today] and decides which
      certificates they reach. One live contract per project.
- [x] **Slice 2 — المستخلص.** Cumulative lines with the period as a subtraction, التشوينات
      (editable, incorporated as a negative), deductions computed on the cumulative and
      differenced, rounded to piastres, VAT added on the contract's basis, dates bounded
      periodTo ≤ measured ≤ certified ≤ approved ≤ today, three people enforced with a
      tenant `singleOperatorMode` switch, generated invoice crediting billings (cost-to-cost)
      or revenue (certified value), balanced deductions entry, advance guarantee reduced,
      AR sub-ledger == GL, void with mirror + invoice reversal, monotonic serial, cancel with
      reason, internal certificate, paginated landscape print (ما قبله / يُرحل).
- [x] **Slice 3 — the mirror.** Subcontracts back-to-back on the client BOQ, the ceiling
      against the client's certified line net of sibling subcontracts, sub certificates through
      the same arithmetic, deductions bounded, retention payable 2195 released through a real
      purchase invoice (AP == GL), WHT to 2210 and onto Form 41, social insurance withheld to a
      liability, transitional VAT into cost, tax-number + bank-account gate, labour-only flag.
- [x] **Slice 4 — cost & recognition.** Site stores with a custodian, two-step issue/receipt
      (different users, dates bounded, shortfall standing in transit), consumption as the only
      stock-to-cost conversion (Dr WIP), custody register, plant hours at the asset's own rate,
      the monthly EAS 48 run with an explicit contract-cost account set, WIP relieved by
      category to zero, contract asset/liability per contract, onerous provision independent
      of the policy switch, recomputed-vs-posted divergence shown.
- [x] **Slice 5 — controls & guarantees.** Guarantee register with memorandum accounts outside
      every statement, restricted cash margins, facility limits, own permissions and dated,
      attributed actions; seven exception reports (the design's six plus cost overrun vs
      estimate) each printing its rule; retention release as a due receivable dated from the
      release event, creator ≠ releaser, early releases needing a second approver; the
      retention calendar on both sides; dashboard tile.
- [x] **Ledger and platform.** `/audit?module=contracting` carries every transition with the
      real actor; `/reconciliation` proves ten control rows; memorandum lines balance within
      their own partition; posting dates must be `YYYY-MM-DD`; historic periods are closed by
      the seed; a closed-period refusal answers 409 and the server has a global error handler
      and an unhandled-rejection guard; sales invoices on a cost-to-cost project bill through
      2165; sales reports and their GL reference read one fact; contracting entries name
      their module; certificate invoices reach the ETA queue.

Verified 2026-09-14: `pnpm typecheck`, `lint`, `build`, 9,911 vitest tests, `pnpm smoke`
(240 surfaces), `pnpm check:seed`, `pnpm scenarios` green, and the module walked in Chrome
(certificate approval from the screen produced the invoice with remaining balance equal to
the net payable).

**Nothing open.** The four items this section listed are closed: BOQ unit codes render
through `lib/boq-unit-label.ts` (م٣ / مقطوعية) on both the grid and the print, percentages
go through `lib/percent.ts`, and `53b83b56` added the Law 182 «تأمين نهائي» posting for
public contracts plus an effective-dated internal plant rate. The two empty exception
reports (`boq-overrun`, `late-variation-approvals`) are allowed-empty BY DESIGN and say so
on screen — an empty report whose rule is printed is not a defect.

## 3.3 Outbound notification channels — closed 2026-09-14

- [x] `NotificationDispatcher` drains the queue, and the decision the roadmap asked for is
      the part that matters. **Being offline is not a delivery failure**: this product is
      offline by default, so an unreachable server leaves the message queued, unchanged,
      and the next drain retries it. Two things end an attempt — a server REJECTION (a bad
      address, a refused auth, neither fixable by retrying, and hammering a refused login
      gets the tenant's account locked), and going STALE: a «فاتورة جديدة» notice three
      weeks late is noise, and a month of backlog arriving the moment a shop reconnects is
      worse than sending nothing. Draining is an OPERATOR ACTION, never a timer — a
      background sender that fires while nobody is watching is how a shop discovers it has
      been emailing its customers for a week. The transport is the same SMTP session the
      settings test-send uses, so it inherits D133's refusal to put a password on a plain
      wire; a channel with no transport is skipped rather than failed, because push is a
      channel this build does not have and failing it would tell the tenant their message
      was rejected. `POST /notifications/drain`, gated on `admin.settings.edit`.

## 3.4 Recently settled — no longer open

### Desktop packaging — closed 2026-08-27

The renderer used to load over `file://` (`loadFile`). Chromium gives every
`file://` document an opaque origin, so a `<script type="module">` was refused
as cross-origin, `import()` of a route chunk was refused with it, and Vite's
absolute `/assets/*` paths resolved against the filesystem root. Three
different symptoms, one cause; none had ever been hit because packaging is
deferred and nobody had run the packaged build.

Closed by serving the renderer from a real origin: `main/renderer-protocol.ts`
registers `app://` as a standard, secure scheme before `whenReady` and streams
the bundle out of `resources/web`. `main/renderer-paths.ts` holds the path
resolution — kept free of any Electron import so it is unit-testable headlessly,
which matters because it is the security boundary: it runs with the user's full
filesystem rights and must refuse anything that escapes the renderer root.
Eight cases cover it (`renderer-paths.test.ts`), including the percent-encoded
traversal and the sibling directory that shares the root's prefix.

The hash stays for now, but `app://` supports `history.pushState`, so dropping
it is a decision rather than a constraint from here.

### Settled since this list was written

| Was listed open | Actually |
|---|---|
| R11.1–R11.8, the seven settings-policy toggles | Done and verified at three levels — see §2.2 P5 |
| workflow `minAmount` configurable but never enforced (DEC-1) | The field does not exist anywhere in the repo. The decision is moot; DEC-1 is closed in §6 |
| WhatsApp channel modelled but unimplemented | Never modelled. Only the email/push halves of §3.2 are real |


---

# 4. Deferred by decision


## 4.1 Out of scope for v1

POS (9 screens + 2 reports), `/settings/shifts`, a standalone label-templates
screen, statutory payroll computation. Payroll must stay visibly flagged rather
than silently computing a wrong net.

**The HR module itself is NOT out of scope** — DEC-12. It is built and licensable:
`packages/domain/src/hr`, 31 gated routes, the `people` workspace, and `hr` in
`MODULE_CATALOG`. It is simply excluded from the seeded plans and from the v1 pitch.
Only the statutory computation is deferred. `.claude/agents/hr-payroll.md` and
`.claude/agents/product.md` still carry the older "HR is descoped" wording.

## 4.2 Do not copy

X1–X8 in `archive/reference-parity/REQUIREMENTS.md` and C1–C13 in
`archive/gap-inventory.md`. In particular: keep report export, keep the hubs
linked, keep the daily attendance list, do not reproduce the 0.00 treasury balance bug,
and label a purchase return correctly.

## 4.3 The deferred build plan

The build plan for the deferred areas — HR/Payroll (27 tasks), POS (26 tasks) and the
Cloud/SaaS edition (20 tasks) — is `archive/plan.md` §9. It is not repeated here.

SaaS follow-ups after the 2026-09-14 browser run (none blocks a sale): subscription-level
suspend/resume has API routes but no console button; `GET /platform/resolve` answers a tenant's
name to anyone who knows its code; a generated platform-owner password is printed to the server
log once by design (set `MEZAN_PLATFORM_OWNER_PASSWORD` to avoid it); the console's remembered
tenant is per browser, not per operator; screens with their own loader (the HR dashboard,
reached only by URL now that the rail hides the module) still show a generic load error on a
403 `MODULE_NOT_LICENSED` instead of the server's Arabic refusal. Test-only gaps recorded by the reviewers: no end-to-end
cloud-app → router → gate test, no test that a sign-out clears cached tenant data, plan-editor
decimal-price body and 422 rendering, tenants-list loading/failed states.

Cloud-1 #6–8 (models only) and Cloud-3 #13 landed 2026-09-13 as `packages/domain/src/platform`,
`packages/persistence/src/platform-store.ts` and `createPlatform` in `packages/backend`: tenant,
plan and subscription records, one SQLite database per tenant, and the two derivations that
feed the existing entitlements and licence-state gates. Per-request tenant routing, onboarding
and the platform console landed 2026-09-14 on `SASS` — see
`superpowers/specs/2026-09-14-saas-completion-design.md`. Seeded plan prices are zero until
Cloud-3's remaining task (the demo tenant and price seed) lands.

Slice C (deploy, seed and proof) is landing alongside it: `apps/server/src/cloud-app.ts`
composes the platform database, the platform API, the tenant router, provisioning, dunning and
in-app backups from `MEZAN_*` env vars — the contract is in
`superpowers/plans/2026-09-14-saas-slice-c-deploy.md`. Local (`pnpm env:testing`/`:staging`),
Render and the AWS container image now all run this one entrypoint, each seeding its own
platform owner and demo tenant (code `demo`) from `MEZAN_SEED_DEMO` — see `ENVIRONMENTS.md` and
`DEPLOY-DEMO.md`. The eight scenarios `PLT-SAAS-01..08` are written down in `TESTING.md` §11;
they still need a live-browser pass before this slice is called proven.

---

## 4.4 What we may claim, and what we must not

Five of the decisions taken on 2026-09-14 constrain what a salesperson or a rollout consultant
is allowed to say. They are collected here because none of them is discoverable from the code,
and each of them is a promise the buyer will hold us to.

| Claim | Ruling |
|---|---|
| **E-invoicing compliance** | **Do not claim it.** B2B invoices are prepared but never filed to production until the customer's own e-seal is connected through a signing agent that is not shipped. Say the sentence recorded in §6.4 DEC-10 — in writing, on the rollout sheet, before contract. Every such invoice shows «في انتظار الختم الإلكتروني» and is not filed. |
| **E-receipt compliance** | **Claim it** — the B2C receipt regime requires no seal, and this is precisely what unblocks retail, pharmacy and restaurants. |
| **Contracting as a Daftra gap** | **Do not.** Daftra ships مستخلصات المقاولات and خصم ضمان الأعمال. Contracting is a genuine strength of this build (§3.2) but it is not a hole in the incumbent, and a buyer who checks will find that out. |
| **POS** | **State the absence in the first sales conversation**, not the fifth. "Mezan runs the books, stock and branches behind your existing till; every consumer sale it records is an e-receipt." An unstated "no POS" becomes the most common refund request. |
| **An API / webhooks** | **Say "integrations arrive with the cloud edition."** The back end is being removed (DEC-17): on desktop the only network surface is the LAN socket, which allow-lists five routes, and nothing authenticates by API key. The comparison-grid row will read "API: no", and that is the accepted price. |
| **Statutory payroll** | Employees, contracts, attendance, leave and advances are real and licensable. **Net pay is not computed.** Say both halves. |
| **Law 6/2025 simplified regime** | **Built, not claimed** (DEC-13). Do not market it until a محاسب قانوني has signed off on the turnover base. A regime computation with the wrong base is the buyer's tax exposure. |
| **The QuickBooks baseline** | Internal only. QuickBooks has no Arabic and is not sold in Egypt; no Egyptian buyer compares to it. It is an engineering yardstick — Online Plus for interaction, Desktop **Enterprise** for depth — and every claim in this repo about it comes from documentation, never a live tenant. |

---

# 5. Defects

## 5.0 Open

**Seventy-eight filed 2026-08-30 by the test-coverage pass** (D66–D143). D128 and D129 are holes in PR #54's own security fixes, found by writing the tests it did not have. D109 — an unauthenticated device on the shop wifi posting to the books — was the most serious, and PR #54 closed it (S8/S9): the desktop shell now builds `createBackend`, so the header resolver is gone from the edition that binds a LAN socket, and every `/lan/*` route needs a session. D99's gate is closed in this pass (the legacy poster now requires `accounting.journal.post`); what remains of D99 is that the route still skips the fiscal-period and account checks its `/gl` replacement performs, and should be deleted. They were found by
writing tests and manual scenarios against the real code, so each carries a file reference
rather than a feeling. The ones marked **guarded** already have a passing test that pins the
current behaviour and will go red the day it changes; the ones marked **reported** still
need a measured reading in the running app before anyone fixes them.

| # | Defect | Evidence | State |
|---|---|---|---|
| D66 | Every physical-count mutation invalidates `["inventory","physical-counts"]` while the screen reads `["physical-counts", filter]`, so الجرد الفعلي never refreshes: starting a count posts and the list bounces back empty, completing one leaves the row on قيد التنفيذ | `apps/web/src/data/inventory-ops-hooks.ts` vs `apps/web/src/data/hooks.ts` | fixed 2026-09-07 — the mutations and the screen now agree on the `["physical-counts", filter]` key, so starting a count no longer bounces back empty and completing one leaves the row on مسدد |
| D67 | `TextField`/`NumberField`/`TextAreaField` render a `<label>` with no `htmlFor` and no matching `id`, so no plain text field in the app is programmatically labelled — clicking the label does not focus, and a screen reader announces nothing | `apps/web/src/settings/form-controls.tsx` → `packages/ui/src/primitives/form.tsx` | fixed in this pass — `TextField`/`NumberField`/`TextAreaField` generate an id with `useId` and pass `htmlFor`/`id`, so `getByLabel` reaches every field built on the wrapper (guaranteed in `form-controls.test.tsx`, and live in `journals.spec.ts`) |
| D68 | The VAT return's «صافي الضريبة المستحقة الدفع» line never renders: the report screen prefers a report-declared `chart` over `renderSummary`, and the VAT return declares both | `apps/web/src/screens/reports/ReportScreen.tsx`, `packages/domain/src/reports/vat-return.ts` | fixed 2026-09-07 — `ReportScreen` renders a report-declared `chart` AND its `renderSummary`, so «صافي الضريبة المستحقة الدفع» is on screen |
| D69 | The tenant-admin bypass on `POST /workflow/requests` is dead — the route is ungated, so no gate stashes an AuthContext and `callerRoleCodes` returns `[]`; an admin's own submission is held بانتظار الموافقة | `packages/api/src/workflow-routes.ts` | fixed 2026-09-11 — the route reads the roles off the AuthContext it resolves itself, instead of the one a gate stashes. It is ungated by design, so `callerRoleCodes` answered `[]` for everyone and the tenant-admin bypass could never fire |
| D70 | Quotes, van trips and sales returns gate on the plain `.view` tier while `SALES_REP`/`VAN_SALES` hold only `.view_own`, so a rep gets 403 on their own work; sales invoices get this right with `gateAny` | `sales-quotes-routes.ts`, `field-sales-routes.ts`, `sales-returns-routes.ts` | fixed 2026-09-07 — quotes, van trips and field sales all take `gateAny(view, view_own)`. A quote records no author, so `view_own` is evaluated against the caller's branch scope and a `view_own` caller holding the all-branch sentinel is shown nothing rather than the tenant. The quote DETAIL route was unscoped entirely and now 404s outside scope |
| D71 | Customer routes carry no branch or rep scoping at all, and the catalog defines a single `sales.customer.view` tier — every rep sees the whole company's customer book | `packages/api/src/customers-routes.ts` | fixed 2026-09-11 — customers and suppliers carry a nullable `branchId`, stamped from the creating caller's own scope. The list, the chips and the detail route all narrow by it, and an id outside scope answers 404 rather than confirming the record exists. Null stays visible to everyone on purpose: every record written before the column existed has none, and hiding them would empty the screen for a branch-scoped user rather than protect anything |
| D72 | The three purchasing policy toggles in settings (`requirePoForGrn`, `requireGrnForInvoice`, `trackSoldPurchaseItems`) reach no route: the server always runs `DEFAULT_PURCHASE_POLICY` | `packages/backend/src/create-backend.ts` → `packages/api/src/purchases-routes.ts` | fixed — and it already WAS. `createApp` derives the policy from the live tenant settings whenever a settings store is mounted, and `createBackend` mounts one. Nothing measured it end to end, which is how this row sat open against working code; three tests now drive the toggles through the real API, including that flipping one takes effect with no restart |
| D73 | The "from order" goods-receipt screen has no editable quantity field, so every receipt taken through the browser is 100% of the outstanding quantity — a real partial delivery cannot be recorded, though the domain supports it | `apps/web/src/screens/GoodsReceiptsScreen.tsx` | fixed 2026-09-07 — the from-PO receipt takes a quantity per line, so a partial delivery can be recorded |
| D74 | Several domain refusals build English-only messages that reach the Arabic UI verbatim (`OverReceiptError`, `PurchaseOrderNotReceivableError`, the permission gate's `Missing permission '…'`, the fiscal-period errors) | `packages/domain/src/purchasing/errors.ts`, `packages/api/src/permission-gate.ts`, `packages/domain/src/fiscal-periods/errors.ts` | fixed 2026-09-11 — twenty-two refusals across purchasing, the fiscal periods and the permission gate are Arabic. `arabic-refusals.test.ts` walks the exported error classes rather than listing them, so one added in English fails on the day it is written — it caught one this pass the sweep had missed |
| D75 | Landed cost posts its payable to a generic clearing account with no supplier dimension, so the freight/customs liability exists in the GL and on no supplier's account | `packages/domain/src/landed-costs/` | fixed 2026-09-11 — and it was worse than filed. The accrual credited GL 2100, the AP CONTROL account, and the supplier sub-ledger ADDED every landed cost to its own figure to compensate — so the reconciliation tied only because both sides were wrong in the same direction, and nothing measured it. The accrual now posts to 2130 تكاليف إضافية مستحقة, the sub-ledger no longer inflates itself, and each cost item records the vendor it is owed to |
| D76 | A confirmed sales or purchase RETURN aggregates every line's tax into one untagged journal line, so the per-line `taxRatePercent` that D28 added does not extend to returns and the VAT return cannot split a mixed-rate return by rate | `packages/domain/src/sales-returns/`, `packages/domain/src/purchase-returns/` | fixed 2026-09-07 — the domain half landed earlier; the WIRING is now done too. Both `findConfirmedInvoice` adapters in `create-backend.ts` carry the invoice line's real tax amount and rate onto the return, so a return of a VAT-charged invoice credits VAT |
| D77 | Confirmed returns are never enqueued to ETA, though the domain models `credit_note` and `debit_note` | `packages/domain/src/eta/` | fixed 2026-09-11 — a confirmed SALES return is queued as an إشعار دائن referencing its source invoice. Purchase returns deliberately are NOT: that credit note is the supplier's to file, and filing it here would declare a document this company never raised |
| D78 | The ETA payload hardcodes `currencySold: "EGP"` on every line regardless of the document's currency | `packages/domain/src/eta/` | fixed 2026-09-11 — the payload carries the document's real currency. A foreign line states the sold amount, the rate it was booked at and the EGP equivalent; a foreign document with NO rate is refused rather than filed at par; an EGP line is unchanged and carries no rate, which is what the authority expects. Wired from `invoice.currency` / `invoice.fxRate` in `create-backend.ts` |
| D79 | The ETA sub-type resolver matches by tax-rate value alone, so exempt (V003) and zero-rated export (V001) items — both 0% — can be filed as each other | `packages/domain/src/eta/` | PARTLY fixed 2026-09-11 — `findLineTaxRate` returns null when the rate value maps to more than one classification, and the caller falls back to the neutral V004 rather than making a specific claim the books never made, so an exempt sale can no longer be filed as an export because the rates happened to be created in that order. STILL OPEN: the complete fix is a `taxRateId` ON THE INVOICE LINE so the identity is never re-derived from a number — the same shape of change D97 made for the cost centre |
| D80 | Cheque transitions record no actor: the seven-state lifecycle has no audit attribution, so nobody can be asked who deposited or bounced one | `packages/domain/src/cheques/cheque-service.ts` | fixed 2026-09-07 — every cheque transition carries its actor, so the seven-state lifecycle can be asked who deposited or bounced one |
| D81 | A voucher whose payment method is «شيك» never creates a cheque record, so the cheque register misses every cheque raised through the voucher screen | `packages/api/src/vouchers-routes.ts` | fixed 2026-09-07 — a «شيك» voucher raises a cheque record. Three fields the voucher wire contract does not carry (drawee bank, due date) are named in `vouchers-routes.ts` and still have to come from the form |
| D82 | Finalising a bank statement never checks for unmatched lines, so a reconciliation can be closed with differences still open | `packages/api/src/bank-reconciliation-routes.ts` | fixed in this pass — `finalize()` REFUSES (`STATEMENT_HAS_UNMATCHED_LINES`, 422) while any line is unmatched. An explicit `{ force: true, reason }` closes it anyway and the statement records `unmatchedAtFinalize`, `finalizeOverrideReason` and `finalizedBy`, so a reconciliation locked over open differences says so on its own row |
| D83 | When an approval gate holds a voucher, the create wizard never surfaces the `held` flag — the user sees a success and no explanation | `apps/web/src/screens/TreasuryVouchersScreen.tsx` | fixed 2026-09-07 — the create wizard surfaces the `held` flag instead of reporting a silent success |
| D84 | A landed cost naming a receipt whose layers are gone (fully consumed, or a mis-named `sourceDocId`) adds its value to the position but bumps no layer, so layer-level unit costs understate the basis with no signal | `packages/domain/src/inventory/wac.ts` | fixed 2026-09-07 — BOTH halves. The valuation half landed earlier; the GL half posts the unabsorbed share to COGS 5100 rather than debiting the whole landed cost to inventory, so GL 1200 equals the valuation report to the piastre. DECISION TAKEN: COGS over a dedicated variance leaf, because it needs no chart-of-accounts template change and no migration — recorded in §6.4 |
| D85 | `saveRole` exempts the `"*"` wildcard from the licence check and never consults `isPlatformAdminOnly`, so a tenant licensed for no modules can still mint a role holding full admin — and the use-case never sees who is asking, so "you may not grant more than you hold" is enforced nowhere | `packages/domain/src/roles/save-role.ts` | fixed 2026-09-07 — `saveRole` takes the actor: `"*"` is no longer exempt from the licence check, and a platform-admin-only code cannot be granted by a caller who does not hold it. The wildcard is measured against whether the tenant is licensed for ANY licensable module, not all of them — the catalogue always carries `pos`, which has no domain in this repo, so the all-modules reading would have made an admin role un-mintable on every install |
| D86 | `saveUser` accepts `isCompanyAdmin: true` without checking the caller's own privilege; the only gate is `admin.users.edit`, so anyone holding it can promote a user — including themselves, by editing their own record — to full company admin in one PUT. The domain function never sees the actor, so the ceiling can only live in the route, and no route enforces one | `packages/domain/src/users/save-user.ts`, `packages/api/src/users-routes.ts` | fixed 2026-09-07 — `saveUser` refuses `isCompanyAdmin: true` from a caller who is not one, and refuses any write against an account that already outranks the caller |
| D87 | The discount ceiling checks only `discountType: "percent"`, so an `amount`-type discount bypasses `sales.price.override` / `pos.discount.approve` entirely | sales invoice discount validation | fixed 2026-09-07 — the ceiling measures an `amount`-type discount against the line gross, so a 90%-of-line amount discount needs the same approval a percentage does |
| D88 | A purchase invoice takes `unitCost` verbatim from the request with no cross-check against the PO or the receipt it names | `packages/api/src/purchases-routes.ts` | fixed 2026-09-11 — an invoice that names a receipt and restates its cost needs `purchases.receipt.edit_cost`, the same grant that lets someone change the cost on the receipt itself. A gate rather than a refusal, because a real price difference is legitimate — that is what the price-variance account is for |
| D89 | A sales return's `customerId` is never validated against its source invoice's customer, so a confirmed return's refund can be directed at any customer id the requester names | `packages/api/src/sales-returns-routes.ts` | fixed 2026-09-11 — `POST /sales-returns` refuses a customer that is not the source invoice's own, and an item that is not on it. A confirmed return's credit could previously be aimed at any customer while the goods came back against somebody else's invoice — a credit note to a stranger, needing no permission beyond the one that raises an ordinary return |
| D90 | A stock transfer posts both legs in one step with no receiving-side confirmation, so goods can never be recorded as in transit or short on arrival | `packages/domain/src/inventory/stock-transfer-document.ts` | OPEN — moved to §6 as a DECISION (DEC-19), not a defect. In-transit transfers change a behaviour the reference app shares (the catalog documents one-way confirm: «لا يمكن إلغاء تحويل مؤكد … لعكس الحركة أنشئ تحويلاً جديداً بالاتجاه المعاكس»), and they give a deliberately valuation-neutral document a GL consequence, because a shortfall on arrival is a loss that has to post somewhere. That needs a product answer before any code |
| D91 | There is no exception reporting anywhere — no report lists backdated documents, deleted drafts, discounts above a threshold, adjustments by reason, or after-hours postings | `packages/api/src/reports-routes.ts` | fixed 2026-09-07 — RE-SCOPED ON MEASUREMENT: exception reporting was never missing, it was unreachable. `security-reports-routes.ts` has carried `/exceptions`, `/post-posting-changes`, `/after-hours` and `/new-accounts` all along, mounted at `app.ts:1290`, with columns, KPIs and Arabic copy — and zero references anywhere in `apps/web`. The four screens, their nav entries and their routes now exist. No server work was needed |
| D92 | The RFQ detail screen passes the document NUMBER where the quotes and comparison routes resolve only by database id, so the quotes list comes back empty and the comparison 404s | `apps/web/src/screens/RfqsScreen.tsx` | fixed 2026-09-07 — the screen resolves the URL segment (which may be the document NUMBER) to a database id before `useRfqQuotes`/`useRfqComparison` ever see it, so supplier price comparison is reachable from a number-shaped URL |
| D93 | «تحصيل دفعة» on a sales invoice starts with no treasury account selected and no default, so the collection is refused on submit with no cue beforehand — the refund flow on returns does default it | `apps/web/src/screens/SalesInvoicesScreen.tsx` | fixed 2026-09-07 — «تحصيل دفعة» seeds its treasury account from the tenant's own list once the query lands, the way the refund flow already did |
| D94 | Item cost price is served to any holder of the item-list permission regardless of `sales.invoice.view_cost` | `packages/api/src/items-routes.ts` | fixed 2026-09-07 — cost price is gated on `sales.invoice.view_cost` and OMITTED from the payload rather than nulled, since a null reads as "this item has no cost" |
| D95 | `projectSchema` requires `costCenterId`, and neither `createProjectSchema` nor `updateProjectSchema` carries the field — so a project's cost centre can never be set or corrected through the API; the key is stripped on both paths | `packages/contracts/src/project.ts` | fixed 2026-09-11 — `createProjectSchema` takes an optional `costCenterId` and an id that already exists is LINKED rather than recreated, so a project can be booked against a cost centre the books already use. Deliberately NOT on the update contract: re-booking a live project moves every cost already posted under the old centre, which is an accounting decision and not a patch field |
| D96 | `journalLineSchema` — the line shape `createJournalEntrySchema` uses, and the one `app.ts` posts manual entries through — carries only `accountId`, `debit` and `credit`. The cost centre, the currency and its rate, and the tax rate are all stripped, though `gl.ts`'s newer `glJournalLineSchema` carries every one of them. A manual journal entry therefore loses every dimension a later report needs | `packages/contracts/src/journal.ts` vs `packages/contracts/src/gl.ts` | fixed 2026-09-11 — by DELETION. `journalLineSchema` was the weaker duplicate of `glJournalLineSchema`, carried only for the legacy poster D99 removed, so it is gone rather than brought up to parity: two contracts for one posting is how they drift |
| D97 | `createSalesInvoiceLineSchema` has no `costCenterId`, so a revenue line cannot be attributed to a cost centre at creation and the Cost Centre P&L cannot see it | `packages/contracts/src/sales-invoice.ts` | fixed 2026-09-11 — `costCenterId` runs end to end on a sales-invoice line: contract, domain line, SQLite column and migration, route, and `buildSalesInvoiceGlPosting`, which groups the revenue credit by centre as well as account and rate so two centres on one invoice do not blend into whichever came first |
| D98 | Report date parameters are validated by SHAPE only, so `2026-13-45` — no thirteenth month, no forty-fifth day — is accepted by both the aging and the period reports and silently matches nothing, which reads on screen as "no sales in that range" rather than "that is not a date" | `packages/api/src/reports-routes.ts` | fixed 2026-09-11 — one `isoDateParamSchema` validates a real calendar day across all 20 report definitions and both routers, so `2026-13-45` and the 30th of February are refused with 400 instead of rendering as "no sales in that range". It checks the digits rather than going through `Date`, because `new Date("2026-02-30")` rolls forward to 2 March and would accept exactly the input this exists to refuse |
| D99 | **`POST /journal-entries` is a live, UNGATED posting route.** It is the spike's original poster, still mounted in the app the desktop shell serves, and it has no permission gate, no fiscal-period check, no account validation, no document numbering, no audit event and no GL event — and its line contract carries no cost centre, currency, rate or tax rate. Anyone who can reach the API can post a journal entry into any period, including one that was never opened. The correct route, `POST /gl/journal-entries`, sits beside it fully gated | `packages/api/src/app.ts:1449` and `:1492`, `packages/domain/src/post-journal-entry.ts` | fixed 2026-09-11 — the route is DELETED, not gated further. Its two callers (`dual-mount.test.ts`, `apps/desktop/src/headless-demo.ts`) post through `/gl`, and `legacy-journal-entries.abuse.test.ts` now proves it is unmounted rather than pinning its holes: "there is exactly ONE way into the books" is the property worth guarding, because a second poster added later would pass every other test in this repo |
| D100 | `useUpdateSequence` throws a fixed generic Arabic message and never reads the response body, so the server's actual refusal — a duplicate prefix, say — never reaches the user; sibling hooks parse `body.message` correctly | `apps/web/src/data/platform-hooks.ts` | fixed 2026-09-07 — the hook reads the server's own refusal off the response body instead of throwing a fixed generic message |
| D101 | An issue from a position that was never received costs **zero**: with `allowNegativeStock` on, `unitCostOf` returns zero for a zero quantity, so the first deficit movement is written at 0.00 and COGS is understated by the whole of it, silently. A position that HAS been received costs the deficit at its last average, which is defensible; this one is not | `packages/domain/src/inventory/stock-ledger-service.ts`, `packages/domain/src/inventory/wac.ts` | fixed 2026-09-07 — a deficit issue costs the last known unit price instead of zero, and the shortfall is reported rather than swallowed, so COGS is no longer understated by the whole of the deficit on any tenant running `allowNegativeStock` |
| D102 | `POST /sales-returns` lets the caller state `unitCost` directly, gated by the same permission as the `/from-invoice` path that derives it from the real invoice — so a return can be restocked at any cost the requester names, over-crediting inventory | `packages/api/src/sales-returns-routes.ts` | fixed 2026-09-11 — unit cost comes off the invoice wherever the invoice is resolvable, which is what `/from-invoice` always did, so the two routes can no longer disagree. Stating your own cost is stating your own margin. With no invoices module wired the caller's figures are still trusted: there is no invoice to check against, and refusing there would break that composition rather than protect it |
| D103 | **Warehouse scope is enforced on reads and on nothing else.** The list routes call `warehouseScopeOf`; `POST /draft` and `/confirm` for stock adjustments and transfers never do. A user scoped to one warehouse can post an adjustment into another, and can transfer goods out of a warehouse they may not even list — the goods move, and the screen they would check does not show it | `packages/api/src/stock-documents-routes.ts`, and the same asymmetry in `packages/api/src/inventory-routes.ts` — `POST /adjustments` and `POST /transfers` never call `warehouseScopeOf` while every list route in the same file does | fixed 2026-09-07 — `warehouseScopeOf` is applied on the write side too: stock-document draft/confirm and the adjustment and transfer routes all narrow to the actor's scope, so goods can no longer move out of a warehouse the actor cannot list |
| D104 | `assertVatPeriodOpen` in the tax module is dead code — nothing calls it — while the live control is a separate reimplementation, `assertVatNotFiled` in `gl/post.ts`. Two copies of a legally load-bearing rule, one of them unreachable | `packages/domain/src/tax/vat-filing.ts` vs `packages/domain/src/gl/post.ts` | fixed 2026-09-07 — the dead `assertVatPeriodOpen` is deleted and its tests point at the live `assertVatNotFiled`, so نموذج 41 could not clone the wrong copy |
| D105 | The quotes list never checks `query.isError`: a failed `GET /sales-quotes` renders the same «لا توجد عروض» empty state as a genuinely empty list, with no banner and no retry — every sibling list screen in the app distinguishes the two | `apps/web/src/screens/sales-quotes/index.tsx` | fixed in this pass — the quotes list now shows the Arabic error banner with a working retry, and suppresses the empty state while the load has failed |
| D106 | Row-action controls in the quotes list are not wrapped in a click-stopper, so clicking an inline action also fires the row's own handler and navigates away to the detail view mid-action | `apps/web/src/screens/sales-quotes/index.tsx` | fixed 2026-09-07 — row actions are wrapped in a click-stopper, so an inline action no longer navigates away mid-action |
| D107 | The convert-to-invoice warehouse is captured from `workingLocation` at first mount, before the branches and warehouses queries resolve, so it locks to the empty string permanently: every accepted quote blocks on «اختر المستودع.» even when a real default warehouse exists | `apps/web/src/screens/sales-quotes/QuoteDetailView.tsx` | fixed 2026-09-07 — the convert-to-invoice warehouse is seeded once when the branches and warehouses queries land, and never overwrites a warehouse the user picked |
| D108 | Converting a quote falls back to hardcoded GL account ids (1105 / 2200 / 4100 / 5100 / 1200) for any item with no account mapping of its own, never checked against the tenant's actual chart of accounts — on a tenant whose COA differs, the invoice posts to whatever those codes happen to be | `apps/web/src/screens/sales-quotes/quote-model.ts` | fixed 2026-09-11 — on the SERVER, so it holds wherever the ids came from: the invoice route validates every GL account it is handed against the tenant's own chart and refuses an unknown, inactive or HEADER account. The browser constants remain as a default for an unmapped item; they can no longer reach the ledger unchecked |
| D109 | **The desktop app is built with no session resolver at all.** `main/index.ts` calls `createApp(uow, { lan })` and never passes `resolveAuthContext`, so the default header resolver governs — the one `session-auth.ts` documents as the thing that must never front a socket bound for other machines. Combined with D99, an unauthenticated device on the shop wifi can POST a journal entry into the books across the LAN socket and read it back. Proven end to end over a real socket | `apps/desktop/src/main/index.ts`, `apps/api/src/app.ts:1449` | fixed by PR #54 (S8/S9); `lan-host.test.ts` still guards the socket |
| D110 | `finalize()` on a bank statement is tested as a happy path with three lines still unmatched, in both the domain and the route suite — the test documents D82 without naming it, which is how a real regression gets waved through | `packages/domain/src/bank-reconciliation/reconciliation-service.test.ts`, `packages/api/src/bank-reconciliation-routes.test.ts` | fixed in this pass |
| D111 | **No report is branch-scoped, and none can even be filtered by branch.** `branchScopeOf` is called in the CRM, cheque, cost-centre, fixed-asset, HR, purchase, quote, treasury, voucher, RFQ and warehouse routes — and in neither report router. No report definition carries a `branchId` parameter either. A branch-scoped user sees every branch's sales, purchases, aging and financial statements, and cannot narrow to their own | `packages/api/src/reports-routes.ts`, `packages/api/src/financial-reports-routes.ts` | PARTLY fixed — OPEN HALF IS A DECISION (DEC-20). `reports-routes.ts` takes a branch parameter and enforces the caller's scope. The seven financial statements cannot: a JOURNAL ENTRY CARRIES NO BRANCH AT ALL, so branch-scoping them means adding a branch dimension to the GL across every posting path. `reports/branch-filter.ts` says so in its own doc-comment and deliberately declares nothing for them rather than offering a filter that would silently do nothing |
| D112 | The aging reports declare no `reconciliation` block and no test ties their total to the AR or AP control account — the first report an accountant opens agrees only with itself. `inventory-valuation` is the same: `sales-by-item` and `purchases-by-item` DO declare one, and no test asserts it either, so the tie mechanism is dark on every report that has it | `packages/domain/src/reports/aging-customers.ts`, `aging-suppliers.ts`, `inventory-valuation.ts` | fixed 2026-09-07 — the reconciliation blocks landed earlier and the CONTEXTS are now fed in `reports-routes.ts`, so the sub-ledger-vs-control banner actually renders in the running app rather than being suppressed by an unwired reference |
| D113 | The topbar's bell, theme and user menus portal their dropdown to `document.body` with no focus management at all — no focus on open, none restored on close. `SidePanel` does both correctly, so the pattern exists and these three do not use it. A keyboard user who opens one cannot reliably Tab into it and is left stranded when it closes. Rendered on every screen | `packages/ui/src/shell/ChromeActions.tsx`, `NotificationsPanel.tsx`, `TopbarMenu.tsx` | fixed in this pass — `TopbarMenu` focuses the panel's first item on open and returns focus to its trigger on close (unless a pointer click elsewhere dismissed it); `NotificationsPanel` takes focus, traps Tab through `useFocusTrap`, and restores focus to whatever opened it. `ChromeActions` no longer has a dropdown at all — its portal/popup imports were dead and are now removed |
| D114 | `EntityPicker` filters with a plain lower-cased substring match instead of the app's own `normalizeForSearch`, so «الامل» finds nothing where «الأمل» is stored — while the customer LIST, which does normalise, finds it. The entity is reachable only by someone who reproduces the stored spelling character for character, across roughly 35 picker call sites | `packages/ui/src/primitives/EntityPicker.tsx` | fixed in this pass — the picker filters through `matchesSearch` from `packages/ui/src/lib/search.ts`, a verbatim copy of the domain normaliser (@mezan/ui carries no dependency on @mezan/domain), guarded by `search.test.ts` |
| D115 | **The Ed25519 licence model is not wired to the app that ships.** `resolveDesktopEntitlements` reads `MEZAN_ENTITLEMENTS_JSON` — an unsigned environment variable — straight into `createEntitlements`: no signature check, no expiry, no machine fingerprint, no grace period. `verifyLicense`, which does all four and is thoroughly tested, is called by nothing the desktop binary runs. Anyone with shell access grants themselves any plan | `apps/desktop/src/main/entitlements.ts` vs `packages/domain/src/licensing/**` | fixed. Desktop startup now reads `license.mezan` and drives `verifyLicense` (signature + monotonic-clock rollback guard + machine fingerprint + expiry/grace) via `main/license.ts` + `main/license-runtime.ts`; a packaged build with no authentic licence fails CLOSED to read-only, never open. Both entitlements AND write permission come from the verified licence: past grace it resolves to READ_ONLY, enforced server-side by a global write-gate (`packages/api/src/license-gate.ts`) that refuses every mutating method with 403 `LICENSE_READ_ONLY` while leaving reads/print/export and sign-in/activation open, so data is never withheld. A polled `GET /license/state` drives an Arabic-first banner (`apps/web/src/LicenseBanner.tsx`). Guarded: `license-gate.test.ts`, `license.test.ts` |
| D116 | Roughly a third of the permission catalogue gates nothing. The entire POS module (33 codes) has no route at all; eleven treasury codes, `sales.invoice.void`, `sales.customer.merge`, `crm.lead.assign`, `hr.payroll.run`, `installments.collect` and others gate nothing either. An admin can tick any of them in the role editor and the product does not change — and a confirmed sales invoice cannot be voided through any route, only a draft cancelled | `packages/domain/src/permissions/catalog.ts` vs `packages/api/src/*-routes.ts` | PARTLY fixed — OPEN HALF IS A DECISION, not routes to write. 83 of 286 codes gate nothing, and 37 of those are the whole POS module, which is descoped from v1 and has no domain, routes or persistence. `dashboard.*` and `transactions.*` name screens that do not exist either. These are the catalogue OVERSTATING the product, not surfaces left unguarded — the fix is DEC-14 (hide or delete the cut screens), and inventing 83 routes to match a catalogue would be the wrong way round. What WAS a real hole is closed: `sales.invoice.void` and `installments.collect` now gate real routes |
| D117 | Nothing stops the last company admin being deactivated or demoted. `saveUser` and `setUserStatus` have no last-admin check, so a departing employee holding `admin.users.deactivate` — or one fat-fingered click — can lock the shop out of its own books with no way back through the product | `packages/domain/src/users/save-user.ts` | fixed in this pass — `saveUser` and `setUserStatus` refuse when the target is the last ACTIVE company admin (`LAST_COMPANY_ADMIN`, 409); an inactive admin is not a way back in |
| D118 | `PUT /users/:id` lets a caller holding only `admin.users.edit` set their own `branchScope` and `warehouseScope` to `*`, defeating every read-narrowing the app applies. The same shape as D86, for scope rather than the admin flag | `packages/api/src/users-routes.ts` | fixed in this pass — `ungrantableScopes` refuses any grant of a branch/warehouse scope wider than the caller's own, on create and on edit |
| D119 | **An instalment can never be collected.** The catalogue defines `installments.collect` and `installments.collection.create`; the router mounts a route for neither, and nothing in the codebase ever writes `InstallmentLine.paidAmount` after the schedule is generated. The whole follow-up queue tracks money that the product has no way to receive | `packages/api/src/installments-routes.ts` | fixed 2026-09-07 — `collectInstallment()` settles a named instalment or runs a round sum down the schedule oldest-first; `POST /installments/plans/:id/collect` raises the real customer-collection voucher FIRST and rewrites the plan only after it returns, so a failed posting cannot leave a paid instalment behind money that never arrived. With no treasury port wired it answers 503 rather than moving `paidAmount` on its own — the two-stores-of-one-fact shape D1 already cost this codebase |
| D120 | Cancelling an instalment plan flips the document's status and never its lines — nothing anywhere produces the `cancelled` line status the enum declares — so `/plans/stats` keeps reporting a cancelled plan's full scheduled and remaining amounts as live money | `packages/api/src/installments-routes.ts` | fixed in this pass |
| D121 | The ETA payload that will actually be filed is built and stored on the submission, and no route ever returns it: `serializeSubmission` omits it and there is no `GET /submissions/:id`. Nobody — screen or auditor — can inspect what is about to go to the authority | `packages/api/src/eta-routes.ts` | fixed in this pass |
| D122 | D77's root cause, located: the enqueue bridge reacts only to a `DOCUMENT_CONFIRMED` event whose `docType` is `SALES_INVOICE`, so confirmed sales and purchase RETURNS never reach the queue at all — the queue itself handles credit and debit notes correctly when fed directly | `packages/backend/src/create-backend.ts` | fixed 2026-09-11 — `createReturnEtaEnqueueBridge` fans in alongside the invoice bridge, so a confirmed sales return reaches the queue on its own event instead of matching a `docType` it never had |
| D123 | On a failed list load, four list screens render the error banner AND the ordinary «لا توجد بيانات» empty state underneath it, because the list component sees `query.data` as undefined either way. A user cannot tell "the load failed" from "there is nothing here" — the same shape D105 has on quotes, now confirmed on items, price lists, promotions and the chart of accounts | `ItemsScreen.tsx`, `PriceListsScreen.tsx`, `PromotionsScreen.tsx`, `ChartOfAccountsScreen.tsx` | fixed in this pass — `DocumentList` and `AccountTree` take a `loadFailed` prop and suppress the empty state while it is set; items, price lists, promotions, suppliers, quotes and the chart of accounts all pass `query.isError` |
| D124 | `PriceListsScreen`'s submit awaits `create.mutateAsync` with no try/catch, unlike every sibling screen, so a failed create leaves an unhandled promise rejection in production. React-query still shows the server's message, so it is invisible until something else is listening for rejections | `apps/web/src/screens/PriceListsScreen.tsx` | fixed in this pass — `submit()` catches and returns, leaving the panel open on the draft with `create.isError` reporting the server's message; the test listens on `process.on("unhandledRejection")` and asserts none escapes |
| D125 | The branches screen cannot edit a branch, deactivate one, or set a sub-branch's parent: `useUpdateBranch` is not even imported, and every branch is created with `parentBranchId: null` regardless of the main-branch flag — while the screen displays a "parent" column that nothing can populate | `apps/web/src/settings/BranchesPage.tsx` | fixed in this pass |
| D126 | **Money crosses the wire as an unvalidated string.** Around seventy money fields in `@mezan/contracts` — including `journalLineSchema.debit` and `.credit`, every invoice and quote `unitPrice`, `discountAmount`, cheque and voucher `amount`, and every `openingBalance` — are declared as a bare `z.string()`. Zod passes `"1e3"`, `"NaN"`, `"١٢٣٤"`, `"1,50"` and `""` straight through to `Money.fromMajor`, which throws a `RangeError` no route catches: **`POST /journal-entries` answers 500 for all ten malformed literals tested**, so a bad request is indistinguishable from a broken server and writes a stack trace to the log on every attempt. Nothing is persisted, so the books are not corrupted. The two files that do define a `decimalString` guard (`data-migration.ts`, `field-sales.ts`) check the shape and not the range, so even they accept a seventh decimal place — silently more precision than the 1e-6 scale holds — and a figure of any magnitude at all. The fix is one shared decimal-string schema with a scale and a bound, applied to all of them | `packages/contracts/src/*.ts` (esp. `journal.ts`), `packages/contracts/src/field-sales.ts` | fixed 2026-09-11 — `packages/contracts/src/money-string.ts` states `Money.fromMajor`'s rules once (sign, six decimals, no exponent, no padding, an upper bound) and every money field uses it, including the twelve files that each carried a local `decimalString` checking shape but not range. `POST /gl/journal-entries` answers 400 and names the field. Nothing was ever persisted through the hole, which is why it survived: the books stayed right while the support queue filled with "it says server error" |
| D127 | **The S7 fix crashed every packaged build.** `resolveSeedAdminSecrets` drew the generated admin password with `randomInt(0, Number.MAX_SAFE_INTEGER)`, but Node's `crypto.randomInt` refuses a range wider than 2^48-1, so the call threw `ERR_OUT_OF_RANGE` — on the packaged branch, which is the only branch the whole S7 change exists for. Nothing caught it because the PR's own regression script runs in development, where `packaged` is false and the branch is never entered; a seeded packaged install would have failed at first run. Fixed here by drawing 128 bits with `randomBytes(16)` instead | `packages/backend/src/seed.ts` | fixed in this pass (`auth-security.test.ts`) |
| D128 | **The S11 navigation guard was bypassable in packaged builds, and only in packaged builds.** `isRendererOrigin` compared `url.origin`, but `app:` is not a scheme Node's `URL` recognises, so `new URL("app://mezan/index.html").origin` serialises to the *string* `"null"` — and so does every `file:`, `javascript:` and `data:` URL. They compared equal, `will-navigate` allowed them, and the preload bridge (`window.mezan.fetch`, i.e. the entire Hono app) was exposed to whatever document landed there. `app://<any host>` passed the same way. Development was unaffected because the Vite entry has a real origin, which is why a dev run could never see it. Now compares scheme and host explicitly and refuses any opaque origin | `apps/desktop/src/main/window.ts` | fixed in this pass (`window.test.ts`) |
| D129 | **The S10 SSRF guard missed the IPv4-mapped IPv6 form.** `assertDeliverableDestination` matched only the dotted spelling `::ffff:127.0.0.1`, but WHATWG `new URL()` rewrites that into hex — `::ffff:7f00:1` — so `http://[::ffff:127.0.0.1]/` and `http://[::ffff:192.168.1.1]/` resolved to loopback and to the router and were handed to `fetch`. The same address, a different spelling. Now decodes the hex form back to a dotted quad before deciding | `packages/backend/src/webhook-transport.ts` | fixed in this pass (`webhook-ssrf.test.ts`) |
| D130 | `GET /vouchers/:id` and `GET /vouchers/:id/allocations` ignore branch scope, while `GET /vouchers` narrows correctly. A clerk scoped to branch b1 gets `["v-b1"]` from the list and `[]` from `?branchId=b2`, but reads another branch's voucher in full — `branchId: "b2"`, `amount: "7500.000000"` — by naming its id directly | `packages/api/src/vouchers-routes.ts` | fixed in this pass — both detail handlers apply `branchScopeOf` and answer 404 |
| D131 | `GET /cost-centers/tree` and `GET /cost-centers/:id` are unscoped, while `GET /cost-centers` narrows by `branchScopeOf`. The tree is the shape the screen actually renders, so the narrowing on the list is cosmetic | `packages/api/src/cost-centers-routes.ts` | fixed in this pass — the tree narrows BEFORE it is built, so an in-scope child re-roots instead of vanishing with its parent; `/:id` answers 404 |
| D132 | `POST /notifications/:id/read` and `/read-all` never check `ctx.authenticated`; they use `ctx.userId` as the whole authorization, so an unidentified caller gets 200 as `"anonymous"` instead of the 401 every other gated route returns. No cross-user leak, but the client cannot tell an expired session from an empty inbox — the exact failure the 401/403 split exists to prevent | `packages/api/src/notifications-routes.ts` | fixed in this pass — `createAuthenticatedGate` now fronts all four notification routes |
| D133 | With `smtpSecurity: "NONE"` the SMTP password is sent base64-encoded over a plaintext connection: AUTH LOGIN is attempted whenever `smtpUsername` is set, regardless of transport, and the settings screen offers NONE with no warning. TLS does not silently downgrade and a refused STARTTLS aborts before AUTH, both verified | `packages/api/src/smtp-client.ts` | fixed 2026-09-11 — refused before the socket is opened, not downgraded. A loopback relay is carved out deliberately (a local postfix has no wire between the ends), and a passwordless plain relay still works; it just cannot be handed a password to leak |
| D134 | The notification-rules panel calls `resetForm()` only after a SUCCESSFUL create — not on «إلغاء», and not on the panel's own close control — so cancelling a new rule and reopening the panel puts the person back inside the draft they just abandoned, with «حفظ» live. Neither exit creates the rule, which is the half that matters, but the next thing saved is the one they meant to throw away | `apps/web/src/settings/NotificationRulesPage.tsx` | fixed in this pass — one `closePanel()` behind «إلغاء», the panel's close control and the scrim, and it discards the draft |
| D135 | **A landed cost booked after the stock is sold out is orphaned onto an empty position.** `replay` applies a `LANDED_COST` revaluation to the position regardless of whether any quantity remains, so a freight invoice that arrives after the goods have shipped — the normal case, not an edge one — adds its whole value to a position holding zero units. Measured: receive 100 @ 10.00, issue all 100, then book 250.00 of freight against the receipt; the position reports `onHand 0.000000` and `totalValue 250.000000`. The average reads `0.000000` because `unitCostOf(value, 0)` is zero, so the item card, the stock list and the costing screen all look normal and only the valuation total is wrong. It never washes out either: the next receipt of 10 @ 10.00 gives `totalValue 350.000000` and an average of `35.000000`, a 250% overstatement of cost of sales on goods that never bore the freight. It belongs in COGS or a purchase-price variance account once the stock is gone. Found by the WAC fuzz property, which shrank it to 7 micro-units | `packages/domain/src/inventory/wac.ts` | fixed in this pass |
| D136 | `trimMoneyString` returned `".00"` for an empty value instead of `"0.00"`: `"".split(".")` is `[""]`, not `[undefined]`, so the destructuring default for the integer part never fired. It is exported from the `@mezan/ui` index and `PhysicalCountsScreen` calls it on a variance figure, where an empty value is exactly what a count with no variance sends. Also pinned, and NOT fixed: the helper truncates rather than rounds, so a price of `10.995000` prints `10.99` on the shelf label while the till charges `11.00` — one piastre, argued from the label | `packages/ui/src/print/LabelSheetView.tsx` | fixed in this pass (`LabelSheetView.test.tsx`) |
| D137 | **`Select`'s type-ahead cannot reach the second of two options that share a first word**, which in an Arabic catalogue is the common case rather than a corner one. Two causes, both in `jumpByPrefix`: the search always starts at `active + 1` and wraps, so while the accumulated query still matches more than one option each further keystroke steps to the NEXT match instead of keeping the first — typing «بنك» walks back and forth between «بنك مصر» and «بنك القاهرة» rather than narrowing; and SPACE is handled by the listbox select branch before the type-ahead branch, so the space that would separate the words instead commits whatever is active. Between them, «الخزنة الرئيسية» and «بنك القاهرة» are unreachable from the keyboard in a list where a neighbour shares their first word. The control is on practically every screen | `packages/ui/src/primitives/Select.tsx` | fixed 2026-09-07 — a growing query searches from the active option INCLUSIVE, so it narrows instead of walking across the matches; only a repeated single character cycles. A space now extends a query still in flight rather than committing, so «بنك القاهرة» can be typed past its first word |
| D138 | **The escalation guard constrains what a caller may GRANT, but nothing constrains WHICH users a branch-scoped admin may edit at all.** A caller holding `admin.users.edit` confined to `BR-CAIRO` can `PUT` any user in the tenant — including one scoped to `BR-ALEX` — and narrow that user to `BR-CAIRO`, moving another branch's clerk under their own branch. `refuseIfTargetOutranks` compares permissions only; there is no equivalent for scope. Reproduce with a caller at `branchScope: ["BR-CAIRO"]`, a seeded user at `["BR-ALEX"]`, and a `PUT` setting `branchScope: ["BR-CAIRO"]` — it answers 200. Not fixed: whether a branch admin may reassign staff across branches is a product decision, not a bug | `packages/api/src/users-routes.ts` | PARTLY fixed 2026-09-07 — a caller can no longer edit a user who outranks them at all (`refuseIfTargetOutranks`). STILL OPEN, and a DECISION not a defect: whether a branch-scoped admin may reassign staff ACROSS branches |
| D139 | `trimRecents`'s sort comparator `(a, b) => a.openedAt < b.openedAt ? 1 : -1` never returns 0, so two records opened at the SAME instant violate antisymmetry and the dedupe can keep the stale record instead of the newest. Reachable, because `openedAt` is client-supplied: calling `recordRecentlyOpened` twice with an identical timestamp kept the first. Fixed by returning 0 on a tie so the stable sort preserves prepend order | `packages/domain/src/user-preferences/user-preferences.ts` | fixed in this pass (`user-preferences.test.ts`) |
| D140 | A stored user-preference row that is malformed, or missing a field added in a later release, threw out of `load()` instead of degrading — a 500 on the self-service screen for anyone whose row predates the current shape. Now sanitised: a missing or invalid section is backfilled to its default, and the store read is wrapped so a JSON-parse failure cannot take the screen down | `packages/backend/src/preferences-routes.ts`, `packages/domain/src/user-preferences/user-preferences.ts` | fixed in this pass (`preferences-routes.test.ts`) |
| D141 | D124's shape at three more sites: `NotificationRulesPage.submit` and both `EtaScreen.save` handlers awaited `mutateAsync` with no try/catch inside an async function nothing awaits, so a rejected save escaped as an unhandled promise rejection — and on EtaScreen `setSaved(true)` then ran on a save that never happened, so the screen claimed «حُفظت الإعدادات.» for a config the server had refused. Fixed; the tests assert BOTH halves (no rejection, and no false success) using a real `process.on("unhandledRejection")` listener rather than trusting the reporter | `apps/web/src/settings/NotificationRulesPage.tsx`, `apps/web/src/screens/EtaScreen.tsx` | fixed in this pass (`EtaScreen.test.tsx`) |
| D142 | **A customer's opening balance never reaches the AR control account.** `openingBalance` is stored on the customer record and added to that customer's outstanding figure, but nothing posts it to GL 1105. Measured in `scripts/scenarios/accounting.ts`: creating a customer with an opening balance of 4,250.00 left 1105 exactly where it was. Every migration begins by typing in the shop's existing debtors, so the AR sub-ledger exceeds its control account from day one by the sum of the opening balances, and nothing in the product ever closes the gap | `packages/api/src/customers-routes.ts`, `packages/domain/src/customers/customer.ts` | fixed 2026-09-07 — a customer's opening balance posts through the same path every other document uses: it debits AR control 1105 and credits the opening-balance equity account, so the sub-ledger and its control account agree from the first day of a migration |
| D143 | A refused BOM deactivation was completely silent: `deactivate()` caught the error and did nothing, behind a comment claiming the re-render would communicate it — it did not. The BOM stayed active and the person had no way to know the server had refused. Now renders a `role="alert"` banner carrying the server's own reason | `apps/web/src/screens/BomsScreen.tsx` | fixed in this pass (`BomsScreen.test.tsx`) |
| D144 | **The sales-returns create page spun the CPU forever on an invoice with nothing returnable.** The line-seeding effect ended in `setLines(firstLine ? [...] : [])`, and its own guard was `lines.length > 0` — a guard an empty array can never satisfy. A fresh `[]` is never `Object.is`-equal to the current state, so React re-rendered; `invoices` was rebuilt by `.filter()` on every render, so the effect's deps changed too and it re-ran, wrote `[]` again, and never settled. Choosing a service-only invoice in «فاتورة المصدر» — or arriving at `#/…/sales-returns/new/<id>` for one — froze the screen with no error. Found by a coverage test that hung a vitest worker at 100% CPU rather than failing (a 5s testTimeout cannot interrupt a synchronous render loop). Fixed by bailing out when there is no returnable line, and memoising `invoices` | `apps/web/src/screens/SalesReturnsScreen.tsx` | fixed in this pass (`SalesReturnsScreen.coverage.test.tsx`) |

**Thirty-two filed 2026-09-07 by the full audit** (`docs/artifacts/audit-2026-09-07.md`, now D149–D180 — the first four were filed as D145–D148 on the audit branch and renumbered D177–D180 on merge, because main had already used those numbers). Every one was verified in code at `ab699559`; the ids in brackets are the audit's own (L = licence, U = updates, N = LAN, B = books, Q = performance, S = security).

| # | Defect | Evidence | State |
|---|---|---|---|
| D177 | **No packaged build could be licensed** [L-1]. The vendor public key was an empty constant read from `process.env` at runtime — no esbuild `define`, no CI variable — so a Dock launch resolved `NO_PUBLIC_KEY` → `UNLICENSED`, read-only, seats 0, LAN off, with a banner blaming the shop | `apps/desktop/src/main/license-runtime.ts`, `apps/desktop/scripts/build.mjs` | fixed 2026-09-07 — keys, salt and check-in URL are `define`d at build time; env overrides are refused when `app.isPackaged`; `NO_PUBLIC_KEY` has its own Arabic sentence (`license-runtime.test.ts`) |
| D178 | **The vendor side did not exist** [L-2]: no keypair generation, no licence signer, no revocation list, no check-in service — nothing could produce a `license.mezan` | `packages/domain/src/licensing/`, `scripts/` | fixed 2026-09-07 — `signLicense`, `pnpm licence:keygen` / `licence:issue`, and `apps/licence-server` (`POST /checkin` with a signed answer and a JSON revocation list) |
| D179 | **The check-in clock started at the licence's expiry date** [L-3]: a valid licence never degraded; an expired one made the app `app.exit(1)` before any window, with no dialog and no log | `apps/desktop/src/main/index.ts` | fixed 2026-09-07 — clock starts at `notBefore` (or first launch); no licence verdict ever exits; past 30 days the app opens READ_ONLY with a blocking Arabic notice (`license-checkin.test.ts`, `LicenseBanner.test.tsx`) |
| D180 | The check-in payload identified nothing [L-4]: `licenseId` was the state enum, `fingerprint` the `userData` path, the reply unsigned, and `{revoked:true}` only logged | `apps/desktop/src/main/index.ts`, `license-checkin.ts` | fixed 2026-09-07 — real `licenseId` and salted fingerprint, Ed25519-signed reply verified with replay rejection, `REVOKED` latches to read-only |
| D149 | First-run «تفعيل الترخيص» was a stub that showed a green «مُفعّل» pill on a no-op [L-5] | `apps/web/src/login/FirstRunWizard.tsx` | fixed 2026-09-07 — a real file import (`mezan:licence:import`) that re-verifies and shows the actual verdict (`FirstRunWizard.test.tsx`) |
| D150 | The licence panel reported `MEZAN_ENTITLEMENTS_JSON`, not the verified licence, so a licensed install read `LIC-MISSING` while the write gate said ACTIVE [L-6] | `apps/desktop/src/main/licence-ipc.ts` | fixed 2026-09-07 (`licence-ipc.test.ts`) |
| D151 | A successful manual check-in could not lift read-only until restart, and a licence expiring mid-session was never noticed [L-7]: the write gate closed over the startup verdict | `apps/desktop/src/main/index.ts` | fixed 2026-09-07 — `resolveLicenseState` re-evaluates per request |
| D152 | `CHECKIN_OVERDUE` rendered «حتى تجديد الترخيص» — telling the shop to renew a valid licence instead of connecting to the internet [L-8]; `FINGERPRINT_MISMATCH` had no recovery path and the fingerprint was surfaced nowhere [L-9] | `apps/web/src/LicenseBanner.tsx` | fixed 2026-09-07 — banner branches on `reason`, «تحقّق الآن» button, copyable fingerprint, `--print-machine-fingerprint`, machine-transfer steps |
| D153 | The clock-rollback and check-in guards were plain JSON files the owner could delete; a missing file resolved to permissive, and a comment claimed a cross-check that did not exist [L-10] | `apps/desktop/src/main/license.ts`, `license-checkin.ts` | fixed 2026-09-07 — one HMAC'd `license-guard.json` keyed off the sealed database key; missing or edited → TAMPERED |
| D154 | Module entitlements gated no surface: `createModuleGate` had zero call sites and the API served all 19 modules regardless of the licence [L-12] | `packages/api/src/module-gate.ts`, `app.ts` | fixed 2026-09-07 — `applyModuleGates` over 45 route prefixes; `createBackend` takes the verified entitlements (`module-gate.test.ts`) |
| D155 | **No update could ever be installed** [U-1/U-2]: the update key was empty, the release workflow never signed the SHA-512 nor published `.sig`, and the banner's error was undismissable | `apps/desktop/src/main/updater.ts`, `.github/workflows/release.yml` | fixed 2026-09-07 — `sign-release.mjs`, per-artifact `.sig`, preflight requires the keys, `unavailable` info state with a dismiss (`update-verify.test.ts`, `updater.test.ts`) |
| D156 | The update signature bound only the hash, so an old signed installer republished under a higher version passed [U-6]; one `.sig` covered two Mac architectures [U-7] | `apps/desktop/src/main/update-verify.ts` | fixed 2026-09-07 — signs `version‖channel‖arch‖sha512`, requires strictly newer, re-verifies after download |
| D157 | Manual install quit the host mid-day with no confirmation and no regard for connected tills [U-8]; no schema version stamp, no rollback, host/client version skew unchecked [U-9/U-10] | `apps/desktop/src/main/updater.ts`, `packages/persistence/src/schema-sync.ts` | fixed 2026-09-07 — install dialog names devices and defaults to after-close; `PRAGMA user_version` + `schema_meta`, `SchemaTooNewError`, `pre-update-<version>` archive with one-click revert; `/health` carries version and the client blocks on mismatch |
| D158 | **A full backup ran on every launch before the window existed** [Q-3], and the on-close backup raced quit and never completed [Q-4] | `apps/desktop/src/main/backup-hooks.ts`, `index.ts` | fixed 2026-09-07 — launch backup only when a migration is pending, window first with a busy state; on-close awaited on `before-quit` (`backup-hooks.test.ts`) |
| D159 | **Every scheduled backup was written decrypted** [N-11]: the desktop passed `portable:{key}` unconditionally | `apps/desktop/src/main/index.ts`, `apps/desktop/src/backup/` | fixed 2026-09-07 — archives encrypted by default; portable export is an explicit passphrase-encrypted action; backups directory 0700 |
| D160 | Pairing a till was a CLI flag with no GUI and no discovery; a DHCP change killed every till; certificate mismatch had no path forward [N-1/N-2/N-4] | `apps/desktop/src/main/client-config.ts`, `lan-client.ts` | fixed 2026-09-07 — mDNS `_mezan._tcp`, `PairHostScreen`, relocate-by-pinned-fingerprint, dedicated PIN_MISMATCH screen (`pairing-ipc.test.ts`, `PairHostScreen.test.tsx`) |
| D161 | Every LAN failure was one bilingual sentence with a URL and `30000ms` after a 30 s freeze; «الشبكة المحلية غير مشغّلة» covered three unrelated faults [N-3/N-5] | `apps/desktop/src/main/ipc.ts`, `lan-host.ts` | fixed 2026-09-07 — `{code, host}` mapped to Arabic per code, 5 s login budget, `LanHostGate` screen, `lan.closedReason` |
| D162 | On a LAN client two maintenance buttons were dead (IPC never registered, no `catch`); disconnect fired with no confirmation mid-document [N-7/N-8] | `apps/web/src/settings/MaintenancePanel.tsx`, `ConnectedDevicesPanel.tsx` | fixed 2026-09-07 (`client-refusals.test.ts`, `ConnectedDevicesPanel.test.tsx`) |
| D163 | A new TLS handshake per LAN request; one account could hold every seat of a 2-seat licence; brute force keyed by attacker-chosen source address; unbounded SSE streams [N-10/N-12] | `apps/desktop/src/main/lan-client.ts`, `packages/domain/src/lan/session-registry.ts`, `packages/api/src/login-throttle.ts` | fixed 2026-09-07 — keep-alive pinned agent, seats per account 1, per-account 60/h ceiling, 3 streams per session, 600 req/10 s per source |
| D164 | **The manual journal screen crashed on ordinary decimals** [B-1]: float sum then `Money.fromMajor(String(300.29999999999995))` threw in render | `apps/web/src/screens/JournalsScreen.tsx` | fixed 2026-09-07 — decimal strings summed with `Money`; cost-centre picker added (`JournalsScreen.test.tsx`) |
| D165 | **A return of a VAT invoice credited no VAT** [B-3]: both wiring adapters passed `taxAmount: Money.zero()` | `packages/backend/src/create-backend.ts` | fixed 2026-09-07 — per-line tax and rate pass through (`create-backend.test.ts`) |
| D166 | **A foreign-currency voucher posted its foreign digits as EGP** [B-4], and FX revaluation kept restating the settled invoice [B-5] | `packages/domain/src/vouchers/voucher-service.ts`, `fx-revaluation/revaluation.ts` | fixed 2026-09-07 — approved rate resolved at confirm, base amounts on GL and allocation, tagged counterparty line (`voucher-service.test.ts`) |
| D167 | The legacy `POST /journal-entries` was mounted in the shipped app and posted into a table no report reads, bypassing every gate [B-6, D99 residual] | `packages/api/src/app.ts` | fixed 2026-09-07 — deleted; four callers migrated to `/gl` |
| D168 | Purchase-invoice confirm was not a transaction: a failure after the GL post left a live entry and a draft that could never confirm again [B-7] | `packages/domain/src/purchasing/purchase-invoice.ts` | fixed 2026-09-07 — confirm runs in `gl.transaction()` (`purchase-invoice.test.ts`) |
| D169 | The reconciliation hardcoded 1105/2100/1200 with no routing slot [B-8]; a depreciation run could not be reversed and its two halves were not atomic [B-9]; `DocumentService.reverse` reversed GL and never stock [B-10]; reversal bypassed the filed-VAT lock [B-11] | `packages/backend/src/create-backend.ts`, `packages/domain/src/fixed-assets/`, `documents/service.ts`, `gl/reverse.ts` | fixed 2026-09-07 — `control.*` slots, `reverseDepreciationRun`, `DocumentStockHook.reverse`, `assertVatNotFiled` on reverse |
| D170 | The VAT return and the five financial statements accumulated in floats [C-10] | `packages/domain/src/reports/` | fixed 2026-09-07 — `Money` to the row boundary |
| D171 | Every SQLite call ran on the Electron main-process event loop, so one report or the daily backup froze the host and every till [Q-1/Q-2] | `apps/desktop/src/main/index.ts`, `apps/desktop/src/backup/backup-service.ts` | see the perf pass in this commit for what landed |
| D172 | `/sales-invoices/counts` hydrated the whole filtered table on every keystroke; every report loaded whole tables into JS; 58 of 66 route files had no `LIMIT`; five screens paged in the browser [Q-5..Q-9] | `packages/api/src/sales-invoices-routes.ts`, `reports-routes.ts`, `packages/persistence/src/ledger-store.ts` | see the perf pass in this commit for what landed |
| D173 | 198 GET error paths threw a fixed sentence and discarded the server's Arabic reason; email notification rules saved as if they delivered [support #13/#10] | `apps/web/src/data/*.ts`, `NotificationRulesPage.tsx` | see the support-hardening pass in this commit |
| D174 | The public demo shipped a published admin PIN with optional auth on `0.0.0.0` [S-1]; `apps/server` bound every interface while printing `127.0.0.1` [S-2]; the audit trail could be edited past its trigger and a restore wrote no audit event [S-3] | `render.yaml`, `apps/server/src/`, `packages/persistence/src/audit-sink.ts` | see the support-hardening pass in this commit |
| D175 | ETA e-invoicing could not transmit (stub port throws unconditionally); four exception reports were mounted with no screen; no open AR/AP, chart or opening-TB import; no report was branch-scoped; concurrent edits were last-write-wins [P-1/P-4/P-5/P-7/N-9] | `packages/domain/src/eta/service.ts`, `packages/api/src/security-reports-routes.ts`, `data-migration-routes.ts` | see the product-compliance pass in this commit |
| D176 | Partner opening balances were one fact with three figures, none the GL [B-2, D142 wider]; the customer/supplier statements were browser-built, the supplier one omitting returns, landed costs and cheques [C-2]; closing a month checked nothing [C-3]; all fiscal-period refusals were English [C-4, D74] | `packages/api/src/customers-routes.ts`, `apps/web/src/screens/SuppliersScreen.tsx`, `packages/domain/src/fiscal-periods/` | B-2 fixed 2026-09-07 (`PartyOpeningBalancePoster`, idempotent `OB-CUST-JE:<id>`); the rest: see the month-end pass in this commit |

D1–D65 are closed; the register is `archive/defect-register.md`.

D65 — 20 scenario assertions failing because `2c0e7fa` made a user's Arabic name mandatory
and no scenario that creates a user passed `nameAr` — was closed by `d3294fc`, which taught
the harness to sign in with the seed PIN and the current user contract. The fix was in the
harness, not the product: the product is right to demand the name. The one reading filed as
a possible second defect behind it — an HR leave balance of 21 against 11 — was the same
bug, and holds once the caller exists.

Measured on this tree, 2026-08-30 after the security sweep: `pnpm scenarios` **6289 passed,
0 failed**, across all fifteen suites. Every other gate green with it — typecheck, lint,
RTL logical-CSS, colour tokens, native controls, permission labels, theme colour-only, and
`pnpm smoke` over all 199 read surfaces. `pnpm audit` is down from 41 advisories (1
critical, 10 high) to 1, which has no published fix.

**Security sweep, 2026-08-30 — thirteen findings, all fixed (S1–S13 in
`archive/defect-register.md`).** Four were critical and every one of them ended at
tenant-admin (`"*"`): an anonymous `POST /bootstrap/admin` handed out a live admin session
on a fully provisioned tenant; `admin.users.create`, `admin.roles.manage` and
`admin.users.edit` each reached `"*"` from a delegated permission. All four were proved
against a running seeded backend before and after, not read off the source. The rest:
no login lockout on a six-digit PIN, one published admin PIN shipped in every install,
`/lan/*` answering the shop wifi with no credential, the desktop shell building its app
with `createApp` so it ran the header resolver on a LAN socket, webhook SSRF, no CSP or
navigation guard in the Electron shell, `dev.db` committed, and 41 dependency advisories.
`scripts/scenarios/security.ts` guards all of it.

---

Everything filed is closed — D1 through D65. The closed register — every defect with
the commit that fixed it, plus the readings that looked like defects and were not — is
`archive/defect-register.md`. It is kept, not deleted, because a fixed defect is how its
regression is recognised.

A closed register is not the same as a clean product: it means the ones found and written
down are closed. The next one gets found the way these were — by driving a seeded app and
comparing two numbers that must agree.

### Filed 2026-09-11 by the defect sweep

| # | Defect | Evidence | State |
|---|---|---|---|
| D145 | **«مرتجع من فاتورة» restocked every return at the SELLING price.** The `findConfirmedInvoice` adapter set the return line's `unitCost` to `unitCostOf(extendQtyByPrice(l.qty, l.unitPrice), l.baseQty)` — the same expression as the `unitPrice` line directly above it — and `/from-invoice`, the route the screen uses, reads cost from that port. So inventory rose by what the goods SOLD for on every return raised through the UI: on the covering test's figures 1050 where the goods cost 850, inventory overstated by the whole margin and the COGS reversal wrong by it, silently, on the most ordinary operation in the product. Found while closing D102, which is why it had never shown up: the `POST /` path took the caller's cost, so only the UI path was wrong | `packages/backend/src/create-backend.ts` `findConfirmedInvoice` | fixed 2026-09-11 — uses the line's captured moving-average cost, converted per base unit the same way the price is. Guarded by `create-backend.test.ts` «مرتجع من فاتورة» restocks at cost |

---

### Filed 2026-09-14 by the decision panels

| # | Defect | Evidence | State |
|---|---|---|---|
| D147 | **A sales rep holding only `view_own` sees no invoices at all.** The `view_own` tier compares `invoice.salespersonId` against `actorOf(c)`, which is a **user id**, while the employee picker that sets the field stores an **`Employee.id`**. The two id spaces never collide, so the filter matches nothing and a real rep gets an empty list rather than their own book. The link needed to fix it already exists — `User.employeeId`, resolved this way by `hr-routes.ts:268-273`. The scenario that should have caught it passes **vacuously**: `[].every(...)` is `true` on the zero rows the confirmer is shown. Found by the ledger panel while settling DEC-7. This is DEC-2's shape a second time — one kind of id compared against another, with the mismatch invisible because the wrong answer is an empty list rather than an error | `packages/api/src/sales-invoices-routes.ts:386,733,876`; the picker at `apps/web/src/screens/SalesInvoicesScreen.tsx:506-514`; the vacuous assertion at `scripts/scenarios/seams.ts:939-959` | fixed 2026-09-14 — the routes resolve the caller's `Employee.id` through a `users` port before narrowing, on the list, the counts, the KPI strip and the detail route, and fail closed on the existing sentinel when the link cannot be resolved. The scenario now raises an invoice against a user the seed really links to an employee and asserts at least one row comes back, so an empty list fails it |
| D148 | **Consumer e-receipts are parked waiting for a seal the regime does not require, and the reporting window is the disputed figure.** Two findings in one row because they share a fix. (a) `EtaService.submit` checks `config.signingMethod === "eseal"` for **every** `documentType`, so a tenant who has configured an e-seal has their consumer receipts held on `pending_signature` — but the ETA requires no e-signature on a receipt, so the hold can never clear and the receipt is never filed. (b) `ETA_RECEIPT_REPORTING_WINDOW_HOURS = 72` is a defaulted parameter rather than configuration, and the ETA's own POS FAQ says the window is **24 hours**; 72 comes from secondary compliance vendors. A receipt submitted past the authority's real window is rejected outright. Found by the compliance panel while settling DEC-9 | `packages/domain/src/eta/service.ts:235`, `packages/domain/src/eta/receipt.ts:308` | fixed 2026-09-14 — `submit` no longer takes the `eseal` branch for a `receipt`, and the window is an `EtaConfig` field defaulting to **24**. Fixed alongside DEC-9's producer, which is what made either of them reachable: until a consumer sale actually enqueued a receipt, neither the seal hold nor the window could fire on anything |

---

### Filed 2026-09-14 while settling §6.3

| # | Defect | Evidence | State |
|---|---|---|---|
| D146 | **An item marked FIFO is valued WAC.** `costingMethod` is a real field — `z.enum(["WAC", "FIFO"])` on the wire, a column on `item`, round-tripped by the store, settable on an item, a product template and a data-migration import — and **no valuation path reads it**. Grepping the domain, backend and persistence for `costingMethod` outside its own definition and storage returns only writes. The stock ledger values every position weighted-average regardless, so a tenant who deliberately sets FIFO on an item gets WAC costing, a WAC unit cost on every issue, and a WAC figure in the valuation report — with a screen telling them otherwise. Found while checking whether §6.3's "FIFO-in-v1 scope" was still an open decision: it is not a decision, it is this. The failure shape is the one this repo keeps shipping — a configurable field no code path reads, indistinguishable on screen from an enforced one (DEC-1's `minAmount`, D72's purchasing toggles, D116's permissions) | `packages/contracts/src/items.ts:18`, `packages/persistence/src/item-store.ts:106,223`, and the absence of any reader in `packages/domain/src/inventory/` | fixed 2026-09-14 — the contract is split in two. `costingMethodSchema` still accepts FIFO so rows already carrying it stay readable; `settableCostingMethodSchema` accepts only WAC and now guards every write path — create, update, product templates and the migration importer. The item screen drops the FIFO option and keeps the label, so a legacy item still renders its real stored value |

---

### Filed 2026-09-18 by the HR review panel (PRs #67, #68)

`hr-payroll`, `tax-expert` and `chartered-accountant` reviewed the two branches that re-land PR #50 (DEC-12 addendum). Both
merged with these as follow-ups; D181, D182 and D184 were fixed first because they are reachable with no flag on. The
figures cited as law are the panel's reading, not yet a محاسب قانوني's — the same bar as DEC-12.

| # | Defect | Evidence | State |
|---|---|---|---|
| D181 | **A court order could take a worker's whole net pay.** Garnishments had no cap: Labour Law 12/2003 Art. 44 limits attachment of a wage to 25%, or 50% where a نفقة (maintenance) order is among them, with نفقة satisfied first. The employer typed a monthly amount and nothing checked it | `packages/domain/src/hr/garnishment.ts:151-155`, `calculate-payroll-run.ts:418` | fixed 2026-09-18 in PR #67 before merge — capped at 25% / 50%, نفقة first, the shortfall carried forward on the order's balance, the payslip says the cap applied |
| D182 | Contract deductions were taken before court-ordered garnishments; a court order ranks first | `calculate-payroll-run.ts` | fixed 2026-09-18 in PR #67 before merge |
| D183 | Employee-advance instalments are not capped at 10% of the wage (Law 12/2003 Art. 43, employer loans) | `calculate-payroll-run.ts:442` | fixed 2026-09-18 — capped at 10% of the same gross-earnings base the garnishment cap uses, the unrecovered balance carried forward via the advance's own instalment schedule, the payslip says the cap applied |
| D184 | A fully unpaid month under the ÷30 divisor still pays (30 − days)/30: 28 unpaid days in February leave 2/30 of the wage. Deduct at most the period's contract earnings | `calculate-payroll-run.ts:284,313`, `settings.ts:209` (`FIXED_30`) | fixed 2026-09-18 in PR #67 before merge — the deduction is clamped to the period's contract earnings |
| D185 | A mid-month joiner is prorated by calendar days while unpaid leave uses the ÷30 setting — two bases in one payslip | `calculate-payroll-run.ts` | fixed 2026-09-18 — the wage proration now reads the tenant's own day-divisor setting, same as unpaid leave; FIXED_30 pays amount × days employed / 30, clamped so a full month never exceeds the monthly wage and days employed never exceed 30; CALENDAR_DAYS is unchanged |
| D186 | Public-holiday overtime is priced at the rest-day 100%, not «مثلي الأجر» (Art. 52); the rest-day row cites «بالمثل», which reads as 35/70%; the replacement rest day is not tracked | `egypt-statutory.ts:255,270`, `attendance-overtime.ts:84` | open — flag-on only, row unverified; must be fixed before any overtime row is marked verified |
| D187 | Overtime ignores department and employee eligibility and department working hours, and pays unapproved clock time by default (`requireApproval` never set) | `attendance-overtime.ts:58`, `department.ts:20`, `hr-routes.ts:168` | open — flag-on only |
| D188 | The overtime table is selected once, not by the period's date | `hr-routes.ts:800` | open — flag-on only |
| D189 | The insurance and tax returns compare a period total with the all-time balance of 2191/2192, so they disagree from the second month; the comparison also goes through `Number()` | `reports-routes.ts:939-946`, `hr-payroll.ts:285,366` | open — flag-on only; a warning banner, posts nothing |
| D190 | The leave-provision posting can post with `hr.payroll.statutory` off while the leave presets are still unverified (DEC-6) — decide whether it belongs behind the flag | `hr-payroll-routes.ts:778` | decided 2026-09-18 — stays outside the flag: accruing unused leave is an ordinary accounting provision under IAS 19 / EAS 38, not a statutory computation; the leave presets it prices remain DEC-6's to verify |
| D191 | Runs calculated before the statutory PR load a total employer cost of 0 in the reports | HR payroll register | fixed 2026-09-18 — `totalEmployerCost` is nullable on the run and the payslip; a legacy row with no computed value loads NULL (never a fabricated 0), and the payroll register and its print/export render it as «غير محسوب» / "Not computed" |

### Filed 2026-09-18 by the e2e rewrite

The rewritten `e2e/reports.spec.ts` asserted the aging report's own reconciliation banner against the seeded demo and
found it red. Measured through `GET /reports/aging/customers` and the GL, then re-measured after the fix.

| # | Defect | Evidence | State |
|---|---|---|---|
| D192 | **A bounced customer cheque never put the debt back on the customer.** The bounce posted Dr 1360 / Cr 1320, so 1105 stayed credited while the ladder (correctly) dropped the bounced cheque's credit: on the seeded demo the ladder read 3,993,770.61 against 1105's 3,992,020.61 — exactly `CHQ-DEMO-3`'s 1,750.00, which sat on 1360, an account with no customer on it. A cheque could also not be applied to an invoice at all, so nothing a bounce did could reopen one | `packages/domain/src/cheques/cheque-service.ts:310` (bounce), `packages/api/src/reports-routes.ts` (`unappliedCustomerCredits`), `e2e/reports.spec.ts:145` | fixed 2026-09-18 on `fix/bounced-cheque-aging` — a bounce reverses the creation posting in both directions (incoming Dr 1105 / Cr 1320) and undoes the cheque's invoice allocations, so the invoices it paid reopen; a replacement credits AR again instead of 1360. A cheque can be applied to its party's open invoices (`POST /cheques/:id/allocations`, same allocation sub-ledger as vouchers); the ladder, `customerOwedById`, the server's `outstandingByCustomer` and the customer statement subtract only a live cheque's unapplied part and show a bounce as received-then-returned. Demo: ladder = 1105 = 3,993,770.61, 1360 = 0, `INV-DEMO-4` reopened. Guarded by `cheque-allocation.test.ts`, the D192 case in `create-backend.test.ts`, the `seeded-tenant` scenario and the flipped e2e test. A ledger written before the fix keeps its 1360 balances; the dashboard tile still counts 1360 for them |
| D193 | The supplier ladder had none of the customer ladder's netting terms: purchase returns, live outgoing cheques and unallocated supplier payments all debit 2100, and the ladder ignored them — 12,537.60 above 2100 on the seeded demo (5,800.00 cheques + 3,500.00 unallocated payments + 3,237.60 returns) | `packages/domain/src/reports/aging-suppliers.ts`, `packages/api/src/reports-routes.ts` (`/aging/suppliers`) | fixed 2026-09-18 on `fix/bounced-cheque-aging` — `returnsByInvoiceId` and `unappliedDebitsBySupplierId`, the twins of the customer ladder's terms; demo ladder = 2100 = 2,987,964.5684. The outgoing-bounce half of D192 was already right (it reversed onto 2100) |
| D194 | Both aging ladders age a foreign-currency invoice at its face value, while the control account holds the base amount: a 100 SAR purchase invoice posted at 13.20 leaves the supplier ladder 1,220.00 below 2100 | `aging-suppliers.ts:162` (`purchaseInvoiceTotal`), `aging-customers.ts:179` (`grandTotal`); reproduced by `scripts/scenarios/platform.ts` «سياسة عدم وجود سعر صرف» | fixed 2026-09-18 on `fix/aging-fx-owed-cheque-voucher` — both ladders age every invoice at `salesInvoiceBaseGrandTotal` / `purchaseInvoiceBaseTotal`, the amount its posting booked at the document's own rate, and the unapplied-credit/debit terms read a foreign voucher's `voucherBaseAmount`. Unrealised differences stay with FX revaluation: it restates 1105/2100 without touching an invoice, so the banner's reference is the control balance net of the unreversed restatement (`fxRevaluationNet`, found by the memo every revaluation and reversal line carries) and the banner names that restatement as its one reconciling item; `/reconciliation` carries the same term on the sub-ledger side. A credit larger than a party's debt stays on the ladder as a negative «جاري» instead of vanishing, and `sales/by-item` (and أفضل المنتجات) convert a foreign line to base too, which the new FX scenario invoice exposed. Measured: CHF 100 at 60.00 ages at 6,000.00, CHF 50 at 3,000.00; a month-end revaluation to 62.50 is named as 250.00 on 1105 and 125.00 on 2100 and leaves both ties exactly where they were. Guarded by the D194 case in `create-backend.test.ts`, the aging and `fxRevaluationNet` unit tests and the `seeded-tenant` scenario |
| D195 | What the customers screen says a customer owes ignores collections nobody allocated: `outstandingByCustomer` and `customerOwedById` net invoices and cheques, the GL and the ladder also net an on-account receipt. After the scenario suite's 100.00 on-account receipt, `CUST-DEMO-1` reads 18,515.88 owed against a ladder row of 18,415.88 | `packages/api/src/app.ts` (`outstandingByCustomer`), `apps/web/src/lib/partner-balances.ts` | fixed 2026-09-18 on `fix/aging-fx-owed-cheque-voucher` — `outstandingByCustomer` is now `customerAgingOwed`: the ladder's own `customerAgingBalances` over the ladder's own terms (`agingCustomersTerms`), so the aging route and the customers routes build one context. `GET /customers` and `/customers/:id` carry `owed` (opening balance + that row); the screen's column, its «متبقي من الحد» and the over-limit filter read it, and `customerOwedById` is gone from the browser. Measured: 1,000.00 invoice less a 100.00 on-account receipt reads 900.00 on the ladder, on `owed` and on `toCollect`. Guarded by the D195 case in `create-backend.test.ts`, the CustomersScreen test and two scenarios (`seeded-tenant`, and every customer after the reports module). The ladder still ages no opening balance (D204) |
| D196 | The D81 port is not wired: `createBackend` passes no `cheques` registration port to the voucher routes, so a «شيك» voucher still raises no cheque in the real app — only the route test's stub does | `packages/api/src/vouchers-routes.ts:629`, `packages/backend/src/create-backend.ts` (`vouchers:` deps) | fixed 2026-09-18 on `fix/aging-fx-owed-cheque-voucher` — the registration moved into `VoucherService.confirmVoucher`, so it runs when the voucher POSTS (route, approvals inbox, invoice collect and supplier pay alike) and inside the same transaction, and `createBackend` wires it. AR is credited once: the voucher credits the party, and the cheque (same id as its voucher, so they share one allocation pool) only reclassifies the voucher's treasury leg into 1320 (incoming) or out of 2150 (outgoing); its counterparty is that treasury account, so no sub-ledger nets it twice. A bounce reverses that reclassification and then the voucher itself, which reopens its invoices and puts the debt back on 1105 (D192); a replacement credits the party's control account; the voucher cannot be reversed by hand while its cheque is live. Measured: a 400.00 «شيك» collection moves 1105 by −400 once, 1320 by +400 and the bank by 0; the bounce restores all three and reverses the voucher. The drawee bank and the due date are still not on the voucher form (D81) — the cheque reads «غير مسجّل» and is due on the voucher date. Guarded by two D196 cases in `create-backend.test.ts`, the cheque-service tests, the flipped route tests and the `seeded-tenant` scenario |


### Filed 2026-09-18 while fixing D194–D196

The FX and cheque scenarios added for D194–D196 run on the seeded tenant before every other
module, so they reached checks that had only ever seen a single-currency ledger with no
reversal in it.

| # | Defect | Evidence | State |
|---|---|---|---|
| D197 | Reversing a voucher saves a mirror DOCUMENT in the confirmed status with the same line, and every server sub-ledger that sums confirmed vouchers counted it as a second receipt: after reversing a 400.00 on-account collection `/reconciliation` read AR 400.00 below 1105, and the ladder's unapplied credits carried the reversed receipt | `packages/domain/src/documents/service.ts` (`reverse`), `packages/backend/src/create-backend.ts` (`voucherEffect`), `packages/api/src/reports-routes.ts` (`unappliedCustomerCredits`) | fixed 2026-09-18 on `fix/aging-fx-owed-cheque-voucher` — `isStandingVoucher` skips the mirror in `/reconciliation` (AR, AP, customer advances), both ladders' unapplied terms and `outstandingBySupplier`. Guarded by the D197 case in `create-backend.test.ts` |
| D198 | The dashboard P&L kept a reversal's mirror and dropped its original (it read `status === "posted"`, and a reversed original is «معكوس»), so every reversed revenue or expense counted twice: a 250.00 expense voucher, reversed, left the tile at −250.00 against an income statement of 0.00 | `packages/backend/src/dashboard-routes.ts` | fixed 2026-09-18 on `fix/aging-fx-owed-cheque-voucher` — the P&L reads posted and reversed entries, as `accountBalance` and the income statement do. Guarded by the D197-twin case in `create-backend.test.ts` and SCN-DSH-03 |
| D199 | Every reversal entry, and every FX revaluation entry, named no module: `reverseJournalEntry` dropped the original's document and `postFxRevaluation` never set one, so R6.3 filed them «unknown» — unseen only because the accounting module ran before any scenario reversed a voucher or revalued | `packages/domain/src/gl/reverse.ts`, `packages/domain/src/fx-revaluation/revaluation.ts` | fixed 2026-09-18 on `fix/aging-fx-owed-cheque-voucher` — the mirror carries the original's `sourceDocType/Id/Number`; a revaluation is `FX_REVALUATION` (treasury). Guarded by R6.3 in `scripts/scenarios/accounting.ts` |
| D200 | The browser and the withholding report still count a reversed voucher's mirror: `supplierPayableById`, the customer statement tab and `/reports/tax/withholding` sum confirmed vouchers, and `VoucherDTO` carries no `reversesDocId` to skip it by | `apps/web/src/lib/partner-balances.ts`, `apps/web/src/screens/CustomersScreen.tsx`, `packages/api/src/reports-routes.ts` (`/tax/withholding`) | open — by code reading, the twin of D197 |
| D201 | Figures still summed at a foreign document's face value: sales by customer, by period and by salesperson; and the suppliers screen's payable, which `supplierPayableById` adds from `total` and `amount` in the browser (the D195 shape, on the supplier side) | `packages/domain/src/reports/sales-by-*.ts`, `apps/web/src/lib/partner-balances.ts` | open — by code reading; `sales/by-item` and أفضل المنتجات are fixed under D194 |
| D202 | A foreign sales invoice's settlement status compares a base-currency settlement with its foreign grand total: `applyAllocatedSettlement` marks a USD 100 invoice «مدفوع» once 100.00 EGP is allocated, and `remainingBalance` subtracts the EGP settlement from the USD total | `packages/domain/src/sales-invoices/service.ts` (`applyAllocatedSettlement`), `packages/api/src/sales-invoices-routes.ts` (`remainingOf`) | open — by code reading; the ladder is unaffected because it nets the allocation sub-ledger, which is in base |
| D203 | A return raised against a foreign invoice posts the invoice's own digits as EGP: sales and purchase returns carry no currency or rate, and their lines copy the source line's price | `packages/domain/src/sales-returns/`, `packages/domain/src/purchase-returns/`, `create-backend.ts` (`findConfirmedInvoice`) | open — by code reading |
| D204 | Neither ladder ages a party's opening balance, though B-2 posts it to 1105/2100: a tenant that types in its debtors at go-live sees the banner red by their sum. The customers screen shows opening balance + ladder row, so it and the ladder agree only for a customer without one | `packages/domain/src/reports/aging-customers.ts`, `aging-suppliers.ts` | open — needs a date to age the balance from; the posting date moves with the earliest open period |
---

## 5.1 Filing a new one

- **Found something new** → add a row here, with the **measured** evidence, not a
  description. "Off by exactly 122.00" is a defect report; "reconciliation looks wrong" is a
  feeling.
- **Fixed something** → move it to `archive/defect-register.md` with the commit that fixed
  it. Do not delete it.
- **Proved it a false alarm** → move it to that file's *not a defect* table with what
  actually caused the reading. Silently dropping it means the next person rediscovers and
  re-reports it.

A stale register is worse than none: it is how a real regression gets waved through as "oh,
that's the known one".

## 5.2 Open by decision, not by patch

These stay listed so nobody re-files them as new findings. None is a defect with a
right answer; they are in §6's territory.

**Entries struck through are closed. They are not deleted** — same rule the defect register
runs on: a closed item is how you recognise its regression, and every one of the three closed
on 2026-08-30 left residual risk behind it that a consultant still has to be able to say out
loud. Read what a closed entry says it did **not** fix before promising a client anything.
Struck-through text **inside** an otherwise-open entry marks a claim that has since been
corrected against the code — several were written ahead of the work and were simply not true;
they are struck rather than deleted so that nobody re-files the correction as a new finding.
Entries were last re-read against the tree on **2026-09-07**.

- **~~The SQLite file and the backups it produces are not encrypted at rest.~~ CLOSED
  2026-08-30 — kept here because the residuals below are real and a consultant must know
  them.** `apps/desktop/src/main/encrypted-database.ts` opens `mezan.db` with
  `better-sqlite3-multiple-ciphers` under a 32-byte random key sealed to the OS user account
  by Electron's `safeStorage` (Keychain / DPAPI / libsecret-kwallet); every backup archive is
  encrypted with the same key; an existing plaintext install converts on first launch and
  takes a full verified backup before a byte of the plaintext file is touched; a machine with
  no keyring **refuses to start** rather than quietly running in plaintext, with
  `--allow-unencrypted-database` as the operator's explicit, logged override. What did NOT
  close:
  - **It is encryption at rest. It is not a sandbox, and it is not access control.** Four
    things it does nothing about, and every one of them is a likelier scenario in a small shop
    than a stolen disk:
    - **Anything while the app is running.** The key is in process memory and the database is
      open. Malware or a person at the running machine reads the books through the app.
    - **A compromised OS user account.** `safeStorage` unseals for that account by definition
      — that is the entire mechanism. Whoever is that user is the key.
    - **An already-unlocked machine the attacker is logged into.** The shop laptop left open
      at the counter is the threat model this does not cover.
    - **Anyone holding the key card.** It is a bearer secret in plain text.
  - **The key is machine- and account-bound, so the backups are too.** That is the property
    that makes a stolen disk useless, and it is the same property that loses the books if the
    machine dies and nobody wrote the key down. Restoring an encrypted archive on hardware
    that does not hold the key fails with `BackupKeyMismatchError` and is unrecoverable by
    anyone. The mitigation is a piece of paper: a `database-key.txt` key card written beside
    the database on first encryption, warned about on every launch while it is still there,
    which a consultant must move off the machine and delete (`INSTALL.md` §4.1).
    **If the owner never keeps that card, their backups are worthless on new hardware** —
    which is precisely the disaster the backup system exists for.
  - **The pre-conversion safety copy is unencrypted** and sits in the backups folder until a
    human deletes it. The startup log names its path; nothing removes it automatically,
    because deleting the only copy of a shop's books to tidy up is the worse failure.
  - No key rotation, and no second factor on the key card.
- **~~The LAN multi-till socket is plain HTTP.~~ CLOSED 2026-08-30 — kept here because what it
  does NOT protect is a live risk a consultant has to state out loud.** The socket now serves
  **HTTPS only**: `tls` is a required option on `startLanHost` and there is no plain-HTTP
  branch to fall back to — on any TLS failure the socket stays closed and logs that it did.
  The identity (`apps/desktop/src/main/lan-tls.ts`) is a self-signed certificate minted once
  and kept for the life of the install, so it can be pinned, and it deliberately refuses to
  re-mint over a damaged key pair because a new fingerprint is indistinguishable from an
  impostor to a till that pinned the old one. The connected-devices screen shows the `https://`
  URL and the SHA-256 fingerprint. Residual — one of these was narrowed on 2026-09-07 and the
  rest are untouched:
  - **Pinning is still trust-on-first-use, but the comparison is now IN THE APP.** An attacker
    already impersonating the host at the moment a till is paired still gets pinned —
    permanently, with no later warning — and the only defence remains a human comparing the two
    fingerprint strings character by character while standing in the shop. What changed on
    2026-09-07 (N-1/N-4): that comparison exists as a screen rather than as a paragraph in a
    runbook. The till discovers hosts over mDNS `_mezan._tcp`, shows the candidate's fingerprint
    grouped in fours and `dir="ltr"` inside the RTL page beside the pinned one when there is
    one, and confirming re-reads the certificate rather than trusting what was advertised; a
    mismatch gets its own refusal screen. **It is still a procedure backed by a mechanism, not
    a mechanism** — a consultant who clicks «تأكيد» without reading has learned nothing.
  - **Nothing authenticates the client.** Unchanged. TLS here is one-way — `startLanHost` passes
    `{ key, cert }` and never `requestCert`, so there are no client certificates. The subnet
    check and the path allow-list remain the only things narrowing who and what can reach the
    socket.
  - **A stolen session token is still the whole ERP.** Untouched: `session-auth.ts` binds a
    session to no device, no address and no seat, and it lives 12 hours. TLS stops the token
    being read off the air and does nothing about one taken off a till.
  - **The private key is protected by filesystem permissions only** (`lan-tls-key.pem`,
    `0600`, beside the database).
  - **No revocation and no rotation path, still manual.** If the key leaks, recovery is
    deleting both PEM files and re-pairing every till by hand. `lan-tls.ts` deliberately
    refuses to re-mint over a damaged key pair, so there is no rotate button and there is not
    meant to be one until re-pairing can be driven from the host — a new fingerprint is
    indistinguishable from an impostor to a till that pinned the old one. In-app pairing
    (above) makes the re-pairing itself a shop task rather than a site visit, which lowers the
    cost of the manual path without closing this.
- **~~Electron auto-updates are not code-signed or notarized.~~ CONFIGURED 2026-08-30, and
  still UNSIGNED IN FACT — the gap is now a purchase order, not a code change.** What landed:
  `apps/desktop/electron-builder.yml` carries a real macOS (Developer ID, hardened runtime with
  a minimal entitlements grant, notarization via the Apple API-key form) and Windows
  (Authenticode, SHA-256 only, RFC-3161 timestamp) configuration that activates entirely from
  environment variables and holds no credential of its own, with `forceCodeSigning: true` so a
  mac/win package that could not be signed **fails** rather than shipping;
  `.github/workflows/release.yml` refuses to start without the certificates and refuses to
  publish an artifact that `apps/desktop/scripts/check-signed.mjs` cannot get the OS to vouch
  for (`codesign` + a rejection of ad-hoc signatures + `spctl --assess` for the notarization
  ticket + `stapler validate`; `signtool verify /pa /tw` or `Get-AuthenticodeSignature`; and a
  refusal to ship an app still pointed at the placeholder feed); and
  `apps/desktop/src/main/updater.ts` refuses to run at all on a build whose own signature it
  cannot confirm. What remains **open, and cannot be closed here**:
  - **Nobody has bought the certificates.** An Apple Developer ID, an Apple notarization key
    and a Windows OV/EV certificate are business purchases with real lead times
    (`docs/INSTALL.md` §8.1). Until they exist **no signed installer has ever been produced**,
    every build is unsigned, and a consultant must not tell a client the installer is provably
    ours (`INSTALL.md` §7).
  - **The signing path has therefore never run end-to-end.** `check-signed.mjs` has been
    exercised against deliberately unsigned and ad-hoc-signed bundles and correctly refuses
    them — that is the half provable without a purchase. The half that needs a certificate is
    unproven by definition.
  - **Windows and Linux have no runtime signature check.** `updater.ts` answers `unknown` on
    both and refuses, which is the safe answer, not a complete one: Electron exposes no
    code-signature API, so macOS is answered by shelling out to `codesign` and the other two
    are honestly unanswered. A real Windows check is possible via PowerShell and is deferred
    until a signed Windows release exists to test it against.
  - **The distribution channel is still unchosen.** `MEZAN_UPDATE_FEED_URL` is a repository
    variable with no value; whether it points at GitHub release assets, S3 or a self-hosted
    directory is a business decision nobody has made.
- **The audit trail is append-only by a SQLite trigger AND hash-chained now (S-3, landed
  2026-09-07) — but a person holding the file can still destroy history, just not forge it.**
  The trigger (`BEFORE UPDATE/DELETE` on `audit_event`) stops the APPLICATION from ever issuing
  an `UPDATE`/`DELETE` against its own audit rows — which is what closed the admin-CRUD and
  workflow-CRUD audit gaps (S21, S25). On top of it, each row now carries `prev_hash` and
  `row_hash` over a frozen canonical tuple, and `audit_chain_head` holds the latest row's hash
  under an **HMAC keyed outside the database** — derived from the sealed database key on
  desktop, from a `0600` `audit-chain.key` beside the file on the server edition, per-process
  in memory. `GET /audit/verify` walks the chain and the audit screen has a button for it,
  answering `OK` / `ROW_ALTERED` / `CHAIN_BROKEN` / `HEAD_MISSING` / `HEAD_ALTERED` /
  `TRUNCATED`; a restore now writes a `CRITICAL` `backup.restored` event after the swap. What
  is still open, and must be said plainly: **the row hashes alone stop an edit in place, not a
  re-hash of the whole table** — the algorithm is public. The head MAC is what cannot be
  forged, and it is only as good as the key's separation from the file, so **a person with
  filesystem access can `DROP` the trigger, delete rows and re-chain what is left — they simply
  cannot produce a head MAC that agrees**, so the tampering is detectable rather than
  preventable, and detectable only if someone presses verify. Restoring an OLDER backup that
  never held the damaging entry remains undetectable from inside. A sink the application itself
  cannot write to — signed export on a schedule, syslog to an external collector — is still the
  real answer and is still open.
- **License verification is wired (was a stub — D115, now fixed).** Desktop startup now reads `license.mezan` and runs the
  Ed25519 verifier (`packages/domain/src/licensing/license.ts`) end to end — signature,
  clock-rollback guard, machine fingerprint, expiry and grace — through
  `main/license.ts` + `main/license-runtime.ts`. The verified licence is the single source
  of both entitlements and write permission; past grace the app is READ_ONLY, enforced by
  the server-side write-gate (`packages/api/src/license-gate.ts`), and a packaged build with
  no authentic licence fails closed to read-only. `MEZAN_ENTITLEMENTS_JSON` survives only as
  a documented DEV convenience (ignored by packaged builds). ~~The vendor public key and
  fingerprint salt are baked by the release build~~ — **that was false when written and is
  true now (D177, 2026-09-07).** They were `process.env` reads with empty compile-time
  defaults and nothing anywhere that set them, so every packaged build resolved
  `NO_PUBLIC_KEY` → `UNLICENSED`. They are now esbuild `define` substitutions
  (`__MEZAN_LICENSE_PUBLIC_KEY__`, `__MEZAN_LICENSE_FINGERPRINT_SALT__`,
  `__MEZAN_LICENSE_CHECKIN_URL__` in `apps/desktop/scripts/build.mjs`'s `vendorDefine`, fed
  from the release environment), i.e. string literals in the binary — and `app.isPackaged`
  refuses every environment override of the key, the salt, the check-in URL and the licence
  path. `release.yml`'s `preflight` fails the run if any is empty. The vendor side exists too
  (`pnpm licence:keygen` / `licence:issue`, `apps/licence-server`, `INSTALL.md` §9). What
  remains: the full activation portal / air-gapped reprieve-code UX is still Phase 8, and the
  7/30-day online check-in against the offline-first promise is an owner decision, not a
  defect (§6).
- **The auto-update channel is signed and user-consented (was CONFIG-ONLY).** The electron-updater flow (`main/updater.ts`) checks on
  launch only when the operator opts in (`MEZAN_AUTO_UPDATE=1`, and outside shop hours),
  never auto-downloads, and verifies a detached Ed25519 signature (`main/update-verify.ts`)
  BEFORE downloading — refusing any release that does not verify — **and again after**, on the
  bytes it actually received. Progress and the refusal surface in an Arabic-first banner
  (`apps/web/src/UpdateBanner.tsx`). This is the offline-first trust layer and is independent
  of OS code-signing/notarization, which is still a vendor-cert release step
  (`electron-builder.yml`). Guarded: `update-verify.test.ts`. Two claims here were stale and
  are corrected: ~~the signature is over the release's SHA-512~~ — it is over
  `version || channel || arch || sha512`, because a signature bound to bytes alone lets an old,
  genuinely signed installer be republished under a higher version on a hostile feed (U-6/U-7);
  and ~~verified against `MEZAN_UPDATE_PUBLIC_KEY`~~ — that key is no longer read from the
  environment at runtime. It is `define`d into the bundle (`__MEZAN_UPDATE_PUBLIC_KEY__`), like
  the licence key, and `MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED` — which let whoever launched a
  packaged app decide whether it checked its own signature — is deleted and replaced by the
  build-time `MEZAN_ALLOW_UNSIGNED_UPDATES`, false in everything the release workflow produces.
  `apps/desktop/scripts/sign-release.mjs` is the vendor half; it refuses to sign if the public
  key is not the signing key's own half.
- **A fresh, never-configured install can still be claimed by whoever reaches it first.**
  `POST /bootstrap/admin` has to be open before there is anyone to authenticate as; it now
  closes the moment the tenant has an account of its own (S1, hardened by S17 so that fact
  is recorded rather than inferred). On desktop the window is smaller than it was: an
  unlicensed install opens no LAN socket at all, and even a LICENSED one's socket does not
  forward `/bootstrap/*` — the path allow-list in `lan-host.ts` names exactly `/auth/login`,
  `/auth/logout`, `/tenant`, `/health` and `/lan/*`, so first-run claiming is reachable over
  the network only from the host's own IPC mount, never from the shop wifi. It is still
  reachable there on `apps/server`, which is a development mount with no allow-list.

- **Outbound notification channels do not deliver.** `packages/domain/src/notifications/engine.ts`
  delivers **in-app only**: every other channel is stamped `"queued"` and nothing drains the
  queue. The channel type is `"in_app" | "email" | "push"` — there is **no WhatsApp channel**,
  modelled or otherwise, so earlier notes claiming one were wrong. An SMTP transport exists
  (`packages/api/src/smtp-client.ts`, used by the settings test-send), so email is no longer
  a missing-transport problem — it is a delivery/retry decision for a product that is
  normally offline. **The UI no longer pretends otherwise (support #10, 2026-09-07.)** The
  triggers endpoint answers `implementedChannels`, and قواعد التنبيهات marks every channel
  outside it « — غير مفعّل بعد (لن تصل رسائل)» *and* renders its option **disabled**, so a rule
  cannot be SAVED against a channel with no transport. Before that, a rule saved against email
  showed «قيد الإرسال», which reads as "on its way", and the operator came back to the screen
  for a message that was never going to arrive. Until the endpoint answers, nothing is marked
  undeliverable — labelling a working channel "not enabled" is the same lie in the other
  direction. Events that are modelled but never emitted carry their own « — لا يُطلق بعد»
  suffix on the trigger picker.
- **The API-key and webhook backend has no consumer.** `packages/domain/src/api-keys`,
  `packages/domain/src/webhooks`, their contracts and their routes. The two screens that
  drove them were deleted (F129) because a desktop, offline-first v1 has nothing to call
  them, and API keys are not used for request auth either. Removing the rest reaches into
  the webhook dispatcher that document events run through — a wider change than deleting a
  screen, so it is filed rather than done.

## 5.4 Egyptian statutory compliance — landed 2026-09-07

None of this was a defect row: it was absent, and its absence is what decided whether
three of the five named buyer segments could legally transact at all.

### B2C e-receipt — الإيصال الإلكتروني

A separate ETA mandate from e-invoicing, in force since 15 September 2025, and this build
had nothing for it: retail, restaurants and pharmacies could not legally ring a consumer
sale. `EtaDocumentType` now carries `receipt`, the queue reports AFTER the sale rather than
clearing before it, the printed receipt carries a QR (`packages/ui/src/print/qr.ts`,
`QrCode.tsx`), and a reprint is **idempotent** — it reproduces the same UUID and QR rather
than minting a second submission.

**The window is 24 hours, not 72 — corrected 2026-09-14.** The ETA's own POS FAQ says a
receipt must be reported «خلال 24 ساعة من إصداره», and Daftra's guide agrees; the 72-hour
figure this section previously asserted comes from secondary compliance vendors. Because the
two sources disagree and only one is primary, the window is now configuration defaulting to
24 rather than a constant — see D148 and DEC-9.

**Until DEC-9 lands, none of this is reachable.** `POST /eta/receipts` has no caller in the
web app, and the confirm bridge sends a customer without a `taxNumber` as receiver type `"P"`
on an **e-invoice**, never as a receipt — so the QR, the idempotent reprint and the queue are
built and unwired. The claim above describes mechanism that exists, not behaviour a user can
reach.

The offline-first architecture is an advantage here rather than a liability, and it is
worth saying so in a demo: a shop with no internet keeps selling and the queue drains
later, which is exactly what the regime's post-clearance window is for.

### The e-seal — honest rather than wired

`signingMethod: "eseal"` used to park a submission on `pending_signature` and nothing ever
signed it. There is no HSM to call in this build, so the state is now VISIBLE — the
submission row, the ETA screen and the printed document all say «في انتظار الختم
الإلكتروني» — and the signing agent is an injectable port with a test double, so wiring a
real e-seal later is configuration rather than surgery. **A consultant must not tell a
client documents are sealed.** The second submit no longer transmits an unsigned document
either; the test that asserted it did was pinning the hole, not the behaviour.

### نموذج 41 — the quarterly withholding return

The mechanics were already right (GL 2210, the voucher's withholding fields, the
withholding report). What was missing was the filing object, and it now clones the shape
`tax/vat-filing.ts` already uses: a quarterly period, a filing record, the remitted
figure, the authority reference, and a refusal to backdate a voucher into a filed quarter.
Statutory, filed within one month of quarter end; anyone paying local B2B suppliers failed
an audit without it.

**Still open on the tax side:** D78 (the ETA payload hardcodes `currencySold: "EGP"` on
every line regardless of the document's currency) and D79 (the sub-type resolver matches
on the tax-rate VALUE alone, so exempt V003 and zero-rated export V001 — both 0% — can be
filed as each other). Both are `packages/domain/src/eta/payload.ts`.

---

## 5.3 Two seeded paths that prove nothing

The demo seed deliberately steers around both, to keep the books exact: **its physical
counts net to zero**, and **no work order is completed**. So the demo data is not evidence
that either path is sound. Exercise them by hand.

---

# 6. Decisions waiting on a human

A defect has a right answer and belongs in §5; a decision here has two or more defensible
answers, and each changes a shared contract, so it is not a one-line patch.

**Taking a decision** → record the option chosen and why, move the row to *decided*, and
link the commit that implemented it. Do not delete it — the next person needs to know the
alternative was considered and rejected. **A decision that turns out to have a right answer**
was a defect; move it to §5 with measured evidence. Each entry below states the options, not
a recommendation dressed as a fact; where one option has the smaller blast radius, that is
said explicitly.

## 6.1 Open

**None.** The fourteen decisions that stood here and in §6.2 were all put to a persona panel
on 2026-09-14 and taken; each is recorded in §6.4 with the option chosen, what other
platforms do, who dissented, and what it would cost to reverse. Three scope questions remain
in §6.3, and they are product-pricing calls rather than decisions blocked in code.

**How these were approved.** Each decision went to the subset of the persona panel whose
profile actually bears the consequence — the ledger decisions to `accountant`,
`chartered-accountant`, `internal-auditor`, `cost-accountant`, `reports-analyst`,
`warehouse-keeper` and the affected buyer personas; the compliance decisions to `tax-expert`,
`implementation-consultant`, `support-agent`, `it-admin` and `security-officer`; the strategy
decisions to `product`, `owner` and the seven buyer personas. Convergence of the panel was
taken as the approval. Dissents are recorded rather than resolved away, because a dissent is
the argument the next person needs when the decision is revisited.

**Two caveats that survive the approval**, and are held regardless of what the panel said:

- **DEC-6 rests on unverified statutory numbers.** Nothing in the leave-policy preset was
  checked against the primary text of Law 14/2025 — the Gazette text could not be read, and
  every article number cited comes from press and law-firm summaries. The preset is therefore
  implemented as effective-dated, provenance-stamped, editable data marked «غير مُتحقَّق منه»,
  never as an asserted fact.
- **DEC-13 is built but not claimed.** A regime computation with the wrong turnover base is a
  tax exposure for the buyer, not a marketing miss. It ships quietly and is marketed only
  after a محاسب قانوني signs off on the base.

## 6.2 Proposed, not yet opened

**None.** All eleven proposed in `artifacts/best-erp-in-egypt.html` §14 were opened and taken
on 2026-09-14. See §6.4.

## 6.3 Longer-standing product decisions

Eight were carried here from `archive/plan.md` §6.3. **Measured against the code on
2026-09-14, five are already settled by shipped work and one was not a decision at all.**

| Carried as | Actually |
|---|---|
| Licensing mechanism finalization | **Settled.** `verifyLicense` runs end to end on desktop startup — signature, clock-rollback guard, machine fingerprint, expiry and grace — through `main/license.ts`, `license-runtime.ts` and `license-checkin.ts`, with a server-side write gate past grace (D115) |
| Branch-scoped numbering | **Settled.** `next-number.ts` scopes a sequence by `branchId` when `def.branchScoped`, and formats with the branch code |
| Lead → opportunity conversion mechanism | **Settled.** `crm/convert-lead.ts` and `crm/move-opportunity-stage.ts` |
| Projects progress billing (مستخلصات) | **Settled** — and then some. The whole contracting module shipped (§3.2), المستخلص included |
| FIFO-in-v1 scope | **NOT a decision — a defect, now filed as D146.** `costingMethod` accepts `"FIFO"`, stores it and reads it back, and no valuation path anywhere reads the field: an item marked FIFO is valued WAC while the screen says otherwise |
| Installment late-fee rule | **Genuinely open.** `computeLateFee` in `installments/overdue.ts` is an explicit stub returning zero, with `LateFeeConfig`'s fields typed and threaded so the real rule is a drop-in. It needs a product answer — grace period, flat vs percent, and whether the fee is revenue or a recovery |
| Delivery notes | **Genuinely open.** Nothing in the tree implements one. A scope question, not a defect |
| A third locale | **Genuinely open.** `Locale` is `"ar" \| "en"`. A scope question |

So three remain, and each is a scope or pricing question rather than anything blocked in code.

## 6.4 Decided

### Taken 2026-09-14 — the fourteen carried decisions

Each entry states the option chosen, the evidence that decided it, and the cost of reversing
it. Where a decision turned out to describe a codebase that no longer exists, that is said.

---

#### DEC-3 — Moot: the allocation sub-ledger is already the single writer

`POST /:id/payments` creates and confirms a real collection voucher and allocates it
(`sales-invoices-routes.ts:1055-1095`); `assertCollectable` validates and writes nothing
(`sales-invoices/service.ts:512-538`); `applyAllocatedSettlement` is the only writer of
`amountPaid` (`service.ts:748-770`), called from allocate *and* unallocate. The migration
this decision asked about had already happened, under F60/F82 — §6.1's text described a
build that no longer existed.

Residue, deliberately kept: `reports/aging-customers.ts:178-179` still takes
`max(allocated, amountPaid)`. **Do not remove it** — historical-import invoices carry
`amountPaid` with no allocation (`sales-invoices/historical-import.ts:42,133`), and the max
correctly picks it up. Two doc comments (`aging-customers.ts:16`, `sales-by-customer.ts:16`)
still cite a `recordPayment` that no longer exists; hygiene only.

**Panel:** `accountant` and `chartered-accountant` backed closing it — one writer, one fact.
`internal-auditor`'s only reservation was the surviving fallback read, which the import case
justifies. **No migration. Record only.**

---

#### DEC-4 — The discount stays netted into the revenue credit. No contra-revenue account.

**What other platforms do:** QuickBooks Online is the outlier — it auto-creates a *Discounts
given* contra-income account. Xero reduces the line and records no discount account (users
are still asking for one). Odoo nets line discounts into price and keeps separate accounts
only for *cash* (early-payment) discounts. Zoho applies transaction-level discounts with no
contra posting. Daftra documents no contra account.

**Why net:** EAS/IFRS 15 measures revenue net of trade discounts, so today's posting *is* the
standard. Sales returns already debit 4100 directly (`create-backend.ts:301`,
`sales-returns/sales-return-document.ts:201`), so a discount contra without a returns contra
would be half a policy. And the discounts are already visible off the ledger —
`totals.ts:103-108` carries `lineDiscountTotal` and `promotionDiscountTotal`, and
`sales-by-salesperson.ts:47` reports `promotionDiscount` per row.

**Panel:** `chartered-accountant` and `accountant` backed net. `reports-analyst` dissented
wanting discounts visible — they are, in the reports above. `internal-auditor` dissented on
discount abuse — a GL total does not catch that; a per-user exception report does.

**Reversal cost:** a chart-of-accounts template line, one bucket in `gl.ts`, and the returns
twin. Posted history stays net, which is acceptable because the two conventions differ only
in presentation. **Not implemented, by choice.**

---

#### DEC-5 — Give the purchase chain a publisher of its own; no `DocumentService` migration

The build emits exactly 5 of 39 catalogued events. Five purchase codes have no producer.
`confirmPurchaseOrder` / `confirmGoodsReceipt` / `confirmPurchaseInvoice` are plain functions
called from `purchases-routes.ts:476, 644, 1095`, and `PurchasesRoutesDeps` has no `events`
port. The precedent already exists outside the document framework:
`vouchers/voucher-service.ts:129` declares `events?: DocumentEventPublisher` — and
`create-backend` never passes it, so `CASH_VOUCHER_CONFIRMED` is a **sixth** silent code.

**Why not the framework migration:** routing the purchase chain through `DocumentService`
touches receipt→PO status propagation, invoice-from-receipt auto-fill, the `layers` cancel
path and D75's landed-cost accounting. High blast radius for a notification feature.
Accepting no purchase events instead would leave seven catalogued, UI-selectable triggers
permanently decorative — the D5 shape again.

**Panel:** `implementation-consultant`, `support-agent` and `it-admin` backed it (webhook
integrators see purchases as dead today). `chartered-accountant` dissented, preferring the
framework migration so audit, numbering, gate and events stay one thing; accepted the
publisher as interim because the audit sink already records purchase confirms independently.
`security-officer`: fire-and-forget only — a bus failure must never fail a confirm.

**Reversal cost:** near zero; the bridge mapping is data, and a later migration reuses the
same port. **Implement:** `events?: DocumentEventPublisher` on `PurchasesRoutesDeps`; publish
`DOCUMENT_CONFIRMED`/`DOCUMENT_CANCELLED` for `PURCHASE_ORDER`, `GOODS_RECEIPT`,
`PURCHASE_INVOICE`; add `purchasesEventMapping` beside `returnsEventMapping` and include it
in `emittedEventCodesOf` → 10 of 39. Wire `vouchers.events` in the same pass.

---

#### DEC-6 — Provenance-stamped, effective-dated presets marked «غير مُتحقَّق منه». No line asserts a number as fact.

**§6.1's claim that "annual 21 and sick 180 are solid" is wrong and is corrected here.** The
sick figure of 180 days is the **2003** law's number. Law 14/2025 restructures sick leave into
tiers — 3 months at 100%, 6 at 85%, 3 at 75%, up to 12 months per three-year cycle. The
preset is not solid; it is stale.

| Line | Preset today | Best evidence | Confidence |
|---|---|---|---|
| Casual | 7/yr | Art. 128: max 7/year, max 2 per occurrence, deducted from annual | High on the figures, medium on the article number |
| Paternity | 1 day | Art. 129: one paid day, max 3 times in service, **not** deducted from annual | Medium-high; article number unverified |
| Maternity | 120 days, 3× | Art. 54: four months, ≥45 after birth, 3 times | High |
| Annual | 21, monthly accrual | 15 days in year one (after 6 months), 21 from year two, 30 after 10 years or age 50, 45 if disabled; carry-over capped at 2 years | High on figures — but **the preset ignores the 15-day first year and the 2-year carry cap** |
| Sick | 180 | Tiered as above under the 2025 law | **The preset is wrong** |
| Effective | 2025-09-01 | Art. 13 of the issuing law: first of the month after 90 days from publication | Consistent |

**Nothing above was verified against primary text.** Wikisource truncated before the leave
chapter, the ECSS PDF was unreadable, manshurat.org timed out. Article numbers 124/128/129/131
are secondary-source.

**Panel:** `hr-payroll` notes the engine cannot express the two rules that matter (the 2-day
per-occurrence cap, the 3-per-service cap on paternity, the 15-day first year), so 7 and 1 are
entitlements the code will **over-grant**; would delete the 2025 sick line rather than flag it.
`chartered-accountant`: a product printing «إجباري قانوناً» beside an unverified number
creates liability for the buyer's payroll. `implementation-consultant` and `support-agent`:
the consultant must see which rows are unverified before training staff.

**Urgency is low — HR's statutory computation is descoped (§4.1), so nothing here blocks v1.**
**Implement when HR returns:** `LeavePolicyPresetLine` gains `source` and `verified`; the
matrix and the preset dropdown render «غير مُتحقَّق منه»; the sick line changes to the tiered
structure or is dropped; annual gains a first-year rule. **Recorded now, built later.**

---

#### DEC-7 — Already built as a real `Employee` field. Keep it — and fix the `view_own` gate.

**What other platforms do:** QuickBooks Online has no rep field (a custom field plus a filtered
report is the documented workaround). Xero has none. Zoho Books has the field and the report.
Daftra ships *both* "sales by staff" (who typed it) and "sales by salesperson" as separate
reports — the Egyptian incumbent treats `createdBy` as a different question, not a substitute.

**§6.1's text described a schema change that had already landed.** `salespersonId` is an
`Employee.id` (`sales-invoices/sales-invoice.ts:160-167`), on the contract
(`contracts/src/sales-invoice.ts:78`), bound through a real employee picker
(`SalesInvoicesScreen.tsx:506-514, 815-820`), and the report exists with an explicit
«غير محدد» row (`reports/sales-by-salesperson.ts:11-28`).

**Defect found and filed as D147:** the `view_own` tier compares `invoice.salespersonId` to
`actorOf(c)`, which is a **user id**, at `sales-invoices-routes.ts:386, 733, 876`. The picker
stores an **employee id**, so a real rep holding only `view_own` sees nothing. The scenario at
`scripts/scenarios/seams.ts:939-959` passes vacuously — `[].every(...)` is true on the zero
rows the confirmer gets. The link already exists: `User.employeeId` (`users/user.ts:39`),
resolved by `hr-routes.ts:268-273`. This is the twin of DEC-2's shape: one kind of id compared
against another.

**Panel:** `owner`, `reports-analyst` and `client-wholesale` backed the entity field —
commission runs on it. `internal-auditor` rejected `createdBy` as a proxy: it credits the
clerk and makes rep-level exception reporting meaningless.

**Noted, not built:** quotes carry no rep, so `convert-to-invoice`
(`sales-quotes-routes.ts:59-64`) produces an unattributed draft. Acceptable.

---

#### DEC-8 — The baseline is QuickBooks Online Plus for interaction, Desktop **Enterprise** for depth, stated explicitly

**What changed under the old framing:** Intuit stopped selling new Pro Plus / Premier Plus /
Mac Plus on 30 Sep 2024, and Desktop 2024 is the last non-Enterprise release (supported to
30 Sep 2027). **Enterprise has no announced end date and is still sold to new customers.** All
13 "QBD-only" screens in the screen ledger — assemblies, multi-site transfers, price levels,
landed cost, barcode, physical count, sales-by-rep, fixed-asset manager — are Enterprise
features, so the retirement erodes nothing under them.

QuickBooks has no Arabic and is not sold in Egypt; an Egyptian buyer never compares to it. The
baseline is an engineering yardstick, not a competitor.

**Panel:** `product` — the three-question rule already demotes QuickBooks to "how thin", not
"whether". `owner` is indifferent, having never heard of it. **Dissent:** `client-accounting-office`
wanted "Online Plus only" for the discipline of fewer screens; overruled because Online has no
goods receipt, and honest WAC costing needs one — a ledger invariant, not taste.

**Outstanding:** the `docs/quickbooks-baseline/` live audit the artifact asks for has still
never been done. Every QuickBooks claim in this repo is from documentation, not a live tenant.
**Record only.**

---

#### DEC-9 — Build the receipt producer into the sales-invoice confirm path. Nothing assumes a POS *screen*; everything assumes a registered POS *device*.

**What the law requires:** the ETA's own POS FAQ says an accounting system can be registered as
a software POS and treated as SW POS; every device needs a serial and an activation; e-receipts
need **no** e-signature; and the reporting window is **24 hours**. Daftra's guide agrees on all
three. Secondary compliance vendors say 72 hours — **the primary source says 24, and the figure
is disputed enough that it must be configuration, not a constant.** Mandate: Resolution 281/2025,
all B2C from 15 Sept 2025.

**What the build actually did — four findings, all verified:**

1. **No producer.** `POST /eta/receipts` (`eta-routes.ts:442`) has **no caller in the web app**.
   The confirm bridge (`create-backend.ts:477, 598`) sends a customer without a `taxNumber` as
   receiver type `"P"` on an **e-invoice**, never as a receipt. The QR, the idempotent reprint
   and the queue are a built-and-unwired feature — the D5 shape again. `etaQrValue`
   (`ui/src/print/types.ts:266`) is never produced.
2. **The device serial is caller-supplied** per request (`issueReceiptSchema.seller.deviceSerialNumber`);
   `EtaConfig` has no device field. The till identity the authority binds to is whatever the
   client sends.
3. **Receipts are wrongly gated by the seal.** `EtaService.submit` (`eta/service.ts:235`) checks
   `signingMethod === "eseal"` for every `documentType`, so a tenant with a seal parks consumer
   receipts on `pending_signature` awaiting a signature the regime does not require.
4. **`ETA_RECEIPT_REPORTING_WINDOW_HOURS = 72`** (`eta/receipt.ts:308`) is a defaulted parameter,
   not config, and 72 is the disputed figure.

Findings 3 and 4 are compliance defects, filed as **D148**.

**Panel:** `client-retail`, `client-pharmacy` and `client-restaurant` all backed it — they
cannot ring a consumer sale legally without it, and were told POS is last. Retail insists on one
device serial **per branch**. `tax-expert` backed it and filed 3 and 4 as defects.
`implementation-consultant`: the serial and the POS credentials must be a settings field, not an
API argument. No dissent; nobody wanted a third receipt-only screen.

**Reversal cost:** none — when POS lands it calls the same `enqueueReceipt`.

##### What shipped, and three more things that were wrong

A consumer sale now produces a receipt end to end: a customer with no `taxNumber` confirms an
invoice, and `GET /eta/receipts/{docNo}` answers with a real SHA-256 UUID, a `qrValue` carrying
`/receipts/search/{uuid}/share/`, and a payload whose device serial and branch code both came
from branch configuration rather than from the caller.

Three defects surfaced that the panel's reading had not reached, each of which would have left
the feature inert:

- **The UUID port was never wired.** `new EtaService(...)` omitted `receiptUuid`, so every
  receipt would have thrown `ETA_RECEIPT_UUID_UNAVAILABLE` the moment a producer existed.
  Routing the bridge alone would have produced nothing.
- **`etaDocumentTypeSchema` had no `"receipt"` member** even though the domain has carried it all
  along, and the ETA screen was casting around the gap.
- **The print page matched on `invoice.id` while the queue keys on `docNo`**, so `etaUuid` never
  rendered on a single confirmed invoice — the QR the regime requires was unreachable for the
  same reason the receipt was.

Also: `dueSoon` was hard-coded to 24 hours, which at a 24-hour window marks every pending receipt
urgent; it now scales to the configured window. The device secret follows the existing
`hasClientSecret` precedent — sealed at rest, never returned by any route. A branch with no
registered device refuses with `ETA_DEVICE_SERIAL_NOT_REGISTERED` in both languages, and the
invoice confirm still succeeds, because a queue failure must never fail a confirm.

The D5 scenario now asserts `queued invoices + queued receipts === live sales invoices`, that the
B2C half is non-empty, and that every queued receipt carries the SHA-256 its printed QR encodes —
the split the old single-queue assertion could not express.

---

#### DEC-10 — Ship. Claim e-receipt compliance only. Sell e-invoicing as "pre-production until your signing agent is installed", never as sealed.

**What the law requires:** production e-invoices (document v1.0) must carry the issuer's CAdES
seal from a USB token or HSM; v0.9 is pre-production with signature validation off. E-receipts
need no seal. Daftra ships a token-signing path the user unlocks with the token PIN. Qoyod is
not live in Egypt at all.

**The build is already honest:** `signingMethod: "eseal"` → `unavailableEsealSigningPort()`
throws → the row parks on `pending_signature` with the reason (`eta/signing.ts:44-69`,
`service.ts:235-250`); the ETA screen shows «في انتظار الختم» and a test-mode pill when the
environment is preproduction (`EtaScreen.tsx:925-938`).

**Panel:** `tax-expert` — allowed to sell, forbidden to say "compliant e-invoicing"; a v1.0
document that is never filed is a penalty, and the customer must know before go-live that the
seal is theirs to buy. `chartered-accountant` agrees on condition the statement is in writing on
the rollout sheet, and would rather hold the claim entirely — **overruled**, because the receipt
regime is claimable and is exactly what the three blocked B2C segments buy. `security-officer`
sets the constraints for the eventual agent: the PIN is never persisted in SQLite, signing is
out-of-process, and the token lives on the machine running the backend. `it-admin`: a USB token
is the desktop-native answer; HSM only for volume.

**The sentence the consultant must say before contract** (now in the ETA screen's help text):

> «ميزان يُعدّ فواتيرك الإلكترونية ويرسل إيصالات المستهلك للمصلحة بنفسه، أما فاتورة B2B فلا
> تُرسَل إلى الإنتاج إلا بعد توصيل ختمك الإلكتروني (توكن أو HSM تشتريه أنت من مقدّم معتمد)
> بوكيل التوقيع الذي لم يُشحن بعد — وحتى ذلك الحين ستظهر كل فاتورة بوضوح «في انتظار الختم
> الإلكتروني» ولن تُعدّ مُقدَّمة للمصلحة.»

> "Mezan prepares your e-invoices and reports consumer e-receipts to the Tax Authority itself;
> B2B invoices are not filed to production until your own e-seal (a token or HSM you buy from an
> accredited provider) is connected through the signing agent, which is not yet shipped — until
> then every invoice shows «في انتظار الختم الإلكتروني» and is not considered filed."

**Reversal cost:** none — supplying the signing port is purely additive.

---

#### DEC-11 — Contracting stays in scope, as a licensable module. Building it was right.

**What other platforms do:** Daftra ships مستخلصات المقاولات and خصم ضمان الأعمال — so
contracting is **not** a Daftra gap and must not be sold as one. Of fourteen Egyptian and Gulf
products surveyed, none advertises خطابات الضمان. QuickBooks and Odoo both fail at retainage and
at progress certificates; Odoo's `stock.move` carries no analytic dimension. The Law 157/2025 +
MoF 418/2025 dual VAT regime (14% full recovery versus 14% on a 36% transitional basis, keyed on
contract date) is modelled in Slice 1; no competitor was found claiming to model the transitional
basis, but that is an unverified absence.

**Panel:** `client-contractor` — the module answers every dealbreaker in its profile.
`client-accounting-office` — the EAS 48 recognition run and the `/reconciliation` endpoint
proving ten control rows is what wins a bureau referral. `product` — it is a beyond-catalog
surface, but it was built as its own workspace and entitlement, so it does not distort the core.
**Dissent:** `support-agent` — the certificate's three-person rule will generate "why can't I
approve my own certificate" calls in one-man firms; answered by the tenant `singleOperatorMode`
switch, but **that switch needs to be in the first-run wizard, not buried**.

**Reversal cost:** the highest in this set short of DEC-15 — it would mean deleting `projectId`
and `costCategory` from `journal_line` and ten posting paths. A migration, not a revert.
**Positioning constraint: do not claim contracting as a Daftra gap.**

---

#### DEC-12 — HR stays built and licensable, stays out of the default plans and the v1 pitch. Statutory payroll returns only against Egyptian statute, with DEC-6's legal review as a hard prerequisite.

**The framing was wrong.** HR is not "15 screens waiting to come back" — it is **built**:
`packages/domain/src/hr` (employees, contracts, attendance, leave, payroll runs, advances), 31
gated routes across `hr-routes.ts`, `hr-payroll-routes.ts` and `hr-time-leave-routes.ts`, the
`people` workspace in `nav-config.tsx:196-205`, and `hr` in `MODULE_CATALOG`. The seeded plans
already exclude it. What is absent is the **statutory computation**, and the payslip says so.

**What the statute requires:** income tax brackets 0–27.5% with an EGP 20,000 exemption; social
insurance 11% employee / 18.75% employer on an insurable wage capped between EGP 2,300 and
14,500 and rising 15%/yr to 2027; plus 1% / 3.25% health. Daftra includes HR in every plan and
markets payroll — but it could **not** be verified from Daftra's own pages that it computes these
automatically for Egypt. Treat "competitors show a payslip" as plausible, not proven.

**Panel:** `hr-payroll` — the one structural requirement is that rates are effective-dated data,
not constants; today's `payroll-component.ts` is already the right shape. `owner` would not pay
for a payroll that prints an incomplete net, but is fine with it as an unlicensed module.
`implementation-consultant` — a client migrating from Daftra asks on day one, and the honest
answer ("employees, leave, advances yes; net pay no") is sellable. `client-restaurant` (35 staff)
needs attendance and shifts more than tax. **Dissent:** `product` wanted the workspace out of the
nav entirely to match §4.1 — **rejected**, because the module is real and licence-gated, and
pulling a working workspace to satisfy a stale scope line is exactly the "lost in a merge"
failure the working agreement warns about.

**Stale text to fix:** §4.1 should say *statutory payroll computation* is out of scope, not "HR".
`.claude/agents/hr-payroll.md` and `.claude/agents/product.md` still say the HR module is
descoped. **Reversal cost:** a plan row. The real cost is a wrong net on a payslip, so the gate
is legal review, not engineering.

##### 2026-09-18 — PR #50 closed, its work re-landed in two parts (D-B)

The HR-finalisation branch (#50, 11 commits, +6,286 lines) was the statutory computation this
decision deferred. The panel — `hr-payroll`, `tax-expert`, `chartered-accountant`, `accountant`,
`owner`, `implementation-consultant` — checked its figures against current Egyptian sources.

**Its structure met the bar; its content did not.** Effective-dated tables, a citation per row,
integer basis points, runs refused for uncovered periods — all right. But:

- **End of service** was computed on every termination and accrued monthly to the ledger for every
  employee. Under Law 14/2025 the employer owes it only when the worker reaches 60 without a pension
  entitlement covering the period. The monthly provision overstated liabilities on every client's
  balance sheet; the chartered accountant would not sign it.
- **Insurance shares** were fixed constants. Law 148/2019 Art. 19 raises old-age cover to 12.5% /
  9.5% from 1 January 2027 — wrong in under four months.
- **Salary tax** started 2025-01-01 citing Law 30/2023; the brackets are Law 7/2024 from 2024-03-01.
  The disability exemption was missing.
- **The martyrs' fund levy** applied to daily workers, whom the law excludes.
- Nothing was marked unverified, and the branch declared this decision "taken".

Verified correct: the 2025 and 2026 insurable-wage limits (2,300–14,500; 2,700–16,700, NOSI) and the
salary-tax brackets themselves (40k at 0%, then 10/15/20/22.5/25/27.5; 20k exemption).

**What other platforms do:** computing Egyptian statutory payroll is market standard — Odoo ships an
official Egypt payroll localisation, ZenHR automates tax, the martyrs' levy, insurance and end of
service. Zoho Payroll is not offered in Egypt. Odoo's own sick-leave tiers are pre-2025.

**Taken:** #50 closed unmerged, the branch archived as tag `pr50-archive`. Re-landed on current `main`
as `hr/payroll-foundations` (garnishments, the payroll day divisor, the HR reports without the
end-of-service provision, the printable payslip, overtime-hours capture — merges normally) and
`hr/statutory-payroll` (the engine with every fix above, `source` + `verified` on every row with
«غير مُتحقَّق منه» on unverified figures, the end-of-service provision dropped until its condition
exists, **behind a tenant flag `hr.payroll.statutory` that is off by default** and needs an audited
admin acknowledgement to turn on). **This decision's wording stands:** statutory payroll is built, not
claimed, until a محاسب قانوني signs the figures row by row.

**Dissent:** `owner` and `implementation-consultant` wanted #50 merged behind a flag as it was —
rejected, because a flagged wrong end-of-service provision still posts to the ledger the day the flag
is turned on.

---

#### DEC-13 — Build Law 6/2025 now, quietly. Claim it only once the pieces below exist and an accountant has signed off on the turnover base.

**What the regime requires** (verified): effective 1 Mar 2025; turnover ≤ EGP 20m; income tax on
**gross turnover** at 0.4% (<500k) / 0.5% (500k–2m) / 0.75% (2–3m) / 1% (3–10m) / 1.5% (10–20m);
election by Form 1/10, irrevocable five years, withdrawal by Form 1/11; annual return on Form 20;
**VAT return quarterly**, due within one month of quarter end; payroll tax annual; **exempt from
withholding and advance payments**, stamp duty, development fees, dividend and capital-gains tax;
audit deferred five years; a 20% overshoot grace for one year at 1.5%; excluded if ≥90% of revenue
comes from one or two clients. Entry requires having joined e-invoicing/e-receipt. Records under
**MoF Decree 420/2025 Art. 3**: fixed-asset register, raw-materials stock register, sales journal,
purchases journal, tax-summary book.

**Does any competitor model it?** Searches across Daftra, Qoyod, Zoho Books Egypt, Odoo
`l10n_eg`, Wafeq, AccFlex and Al-Ameen returned **zero hits** for a turnover-band computation, a
regime election, quarterly VAT under the regime, or a regime-comparison screen. This is a negative
search result, not proof — the artifact's "none of twenty-six" claim is consistent with it but
remains unverified against live tenants.

**Repo fact:** nothing existed. A grep for `regime` or `Law 6` in `packages/domain/src` returned
nothing outside docs; `tax/vat-filing.ts` had no monthly/quarterly notion.

**Panel:** `tax-expert` — this is the one feature that changes what a buyer *pays*, and the
mechanics are two days, but the modelling needs a محاسب قانوني. `owner` — "show me what I'd pay
under each regime" is the first screen that makes an owner rather than an accountant care.
`client-accounting-office` — 60 clients, most under 20m; a bureau elects for dozens at once.
`client-retail`, `client-restaurant`, `client-pharmacy` are all eligible, and the e-receipt entry
condition is met by the §5.4 build. **Dissent:** `product` argued "quietly, then claim" rather than
"market now" — **accepted**, because a claimed regime with the wrong turnover base is a tax
exposure. `support-agent`: the election is irrevocable for five years, so **the screen must never
let a click elect** — it records what was filed on Form 1/10.

**Binding build conditions:** every statutory number is effective-dated data with a `source`
naming the article, never a hardcoded constant; liability is presented as an **estimate** with its
source cited; the ≥90% concentration is **flagged to the user, not decided by the code**. The
Decree 420 five books are named exports of reports that already exist — no new registers.

##### What shipped

`SIMPLIFIED_REGIME_SCHEDULES`, selected by `simplifiedRegimeScheduleOn(day)`. Each schedule
carries `effectiveFrom`/`effectiveTo`, and every figure inside is a `StatutoryValue<T>` of
`{ value, source }` naming the law and article — bands carry their own source each. **An
amendment is appended as a new schedule, never edited in place**, so any figure Mezan ever
displayed is still explicable by the table in force that day.

It is a code table rather than a tenant-editable row, deliberately: statutory data a user can
edit is statutory data a user can get wrong. The bands are served to the client so the screen
can print the citation beside the number.

The election screen **records what was filed on Form 1/10**; it cannot perform an election. The
regime is irrevocable for five years and no click in this product may cause that.

The Decree 420 books are aliases over existing reports — `createDecree420SalesJournal` over
sales-by-period, `…PurchasesJournal` over purchases-by-period, `…StockRegister` over
inventory-valuation, `…TaxSummaryBook` over the VAT return. The fixed-asset register has no
`ReportDefinition` at all, so its registry entry carries `reportId: null` and points at the live
asset screen rather than naming a report that does not exist.

Smoked against the seeded demo: turnover 9,711,769.89 → the 1.0% band → 97,117.70 estimated,
client concentration 23.09% (no flag); the comparison prices 97,117.70 simplified against
162,878.32 normal.

##### Not built, and why

- **Pricing the other exemptions** — stamp duty, development fee, dividend tax, capital gains,
  advance payments. Each is listed with its article and its money column left **null**, because
  Mezan does not hold the facts to price them and a plausible figure is a bug.
- **A branch filter on the comparison.** Invoices carry a branch; journal lines carry one only
  where DEC-20's attribution has reached that posting path. Filtering would narrow the turnover
  side fully and the profit side partly, which is worse than not offering it.
- **Enforcement of quarterly filing.** `recordVatFiling` gained an optional `expectedPeriodMode`
  that refuses a wrong-length window; nothing passes it yet.
- **A new permission.** It reuses `admin.settings.view`/`.edit` rather than growing the catalogue
  DEC-14 had just cut.

**Withholding suppression DID ship**, after the fact: a regime tenant is now refused on a voucher
that withholds, rather than silently zeroed. The operator typed a number, and a number that
vanishes without a word is how a wrong filing gets signed.

##### Six numbers nobody verified against a primary source

1. **Band boundary inclusivity.** Read as inclusive-lower/exclusive-upper, so exactly 500,000
   sits at 0.5%. Checked only against secondary summaries.
2. **What «حجم الأعمال» means.** Taken as invoiced revenue after discount and **before VAT**.
   Whether VAT, sales returns or exports belong in the base is unconfirmed. **This is the single
   biggest exposure, and the reason every figure is stamped `estimate: true`.**
3. **The quarterly due date.** Read literally as "within one month of quarter end" — same day next
   month, clamped. Egyptian deadlines are usually written "by the end of the following month",
   which would be later. The earlier, safer reading was taken.
4. **The 22.5% normal-regime rate** (Law 91/2005) is from memory, not a fetched source. It sits in
   the schedule with its citation so one edit corrects it.
5. **The monthly VAT due date is deliberately `null`** — no sourced rule was found and none was
   invented. The screen says so.
6. **Scope of the withholding exemption** — whether the taxpayer is exempt from *suffering* it,
   from *applying* it, or both.

---

#### DEC-14 — Delete the codes that name what does not exist. Wire the ones that name a real route gated on the wrong code. "Hide" was never a decision — POS is already hidden by licensing.

**Two repo facts that changed the question.** `platform/module-catalog.ts` already excludes
`pos`, and the role editor renders only `licensedModules(entitlements)` — so the 37 POS codes are
**already invisible** on any licence the platform issues. What *is* visible and overstated today
is `dashboard.*` and `transactions.*`, because they sit in `ALWAYS_LICENSED_MODULES`, plus the
treasury per-type codes any licensed tenant can tick. A script over every `packages/api` route file
plus desktop IPC found **80 of ~298 codes gated by no API route**, three of which are gated by
desktop IPC and are fine.

**Panel:** `it-admin` — a checkbox that changes nothing is the worst kind: the admin ticks it,
tests, and concludes the product is broken. Delete beats hide. `owner` — "can I stop a staff
member from refunding a customer?" is today **no**, because all ten voucher types gate on one
code; that is the one place to wire rather than delete. `support-agent` — every phantom permission
is a ticket. `product` — deleting POS rows is not a scope decision; DEC-16 keeps POS out and a
catalogue row is not a module. **Dissent:** `implementation-consultant` wanted the POS rows kept
for the day POS returns; **rejected** — they are transcribed in `docs/archive/catalog/09` and a
revert is one commit.

**Delete (55):** all 37 `pos.*`; `dashboard.view`/`.export`; `transactions.view`/`.view_all`;
`accounting.journal.approve` and `treasury.customer_refund.approve` (approval is role-based by
DEC-2, so a permission-coded approve can never be honoured); `sales.invoice.print` and
`inventory.label.print` (printing is renderer-side from data the holder can already view — a
server cannot enforce it); `sales.customer.merge`; `crm.lead.assign` and `crm.lead.view_own`
(leads have no owner field, so neither can be evaluated); `installments.collection.create`
(duplicate of `installments.collect`); `hr.payroll.run`; `hr.leave_accrual.year_end` and
`.migrate_open`; `hr.employee.view_personal`; `admin.branches.deactivate` and
`admin.warehouses.deactivate`; `admin.modules.view`/`.manage`; `assets.depreciation.void`;
`purchases.invoice.delete_draft`, `purchases.landed_cost.delete_draft`, `purchases.landed_cost.edit`;
`treasury.transfer.view` and `treasury.customer_refund.view`; and the four
`treasury.*_adjustment.create` / `balance_transfer.create` codes.

**Keep and wire (9)** — these are the live half of D116, not DEC-14:
`treasury.customer_refund.create/confirm/void` and `treasury.transfer.create/confirm/void`
(`vouchers-routes.ts:430/509/533` gates every voucher type on `treasury.cash_voucher.*`; refund is
money out to a customer and both `owner` and `internal-auditor` want it separable);
`sales.return.view_own` and `purchases.invoice.view_own` (`attachments/entity-type.ts:33,37`
already treats them as view tiers and `sales-invoices-routes.ts:775` shows the three-tier pattern,
but the list routes gate on `.view` alone, so a `view_own` holder gets 403);
`contracting.certificate.collect` (designed as the fourth right, seeded, gated nowhere —
collection currently rides `treasury.cash_voucher.create`).

**Keep as is (4)** — an API-only grep and D116 both under-counted these: `admin.backup.view`,
`admin.backup.restore` and `admin.tenant.settings.edit` are gated in `desktop/src/main/restore-ipc.ts`,
the only place a restore can happen; `purchases.order.edit` is consumed as the `manage` right for
PO attachments. Note there is **no PO edit route at all** — a separate functional question.

##### What shipped, and the one thing the decision got wrong

**231 permissions across 18 modules**, down from 298 across 21. `CATALOG_VERSION` 1 → 3. Both
`dashboard` and `transactions` are gone from the catalogue, from `ALWAYS_LICENSED_MODULES`, from
`MODULE_CATALOG` and from the platform's seeded plans. 36 stale grant lines came out of the demo
seed, and 18 orphaned `perm.entity.*` keys came out of both locales. The coverage scanner's
ungated cap fell from 89 to **13**.

The delete list said "all 37 `pos.*`" and attached a caution to verify first. **The caution was
right, and the count was wrong: there were 38, and one of them is checked.**
`sales-invoices-routes.ts` reads it on the sales-invoice discount ceiling *inline* rather than
through `gate()`/`gateAny()`, which is exactly why the coverage scanner — which only reads gate
call sites — reported the whole module as gating nothing. Deleting it would have made an oversized
discount refused outright instead of escalated, and six route tests plus a scenario would have
caught it.

Keeping it was right; keeping its name was not. Under `pos.discount.approve` it sat in a module
that is deliberately never licensed, and the role editor renders only licensed modules — so the
one real control in POS was **ungrantable by anyone except the `*` wildcard**. That is D116's
failure inverted: not a configurable field no code reads, but an enforced rule no screen can
grant. It reads identically to the user, who meets a refusal with no way to resolve it.

It is now **`sales.discount.approve`**, in the module whose document it actually guards. The route
still honours the old code so grants written before the rename keep working; the old code is out
of the catalogue, so nothing new is granted under it. `SUPERVISOR` — «مشرف المبيعات», seeded with
the description «يعتمد ما يحتاج موافقة» — now holds it, which it could not before. The `pos`
module is empty and gone.

Two wirings were tightened beyond the brief, both because the brief would have been too wide:
the voucher routes take a second narrow check on the actual voucher type after the `gateAny`, or
a `treasury.customer_refund.create` holder could have raised any voucher type; and
`sales.return.view_own` narrows by **warehouse** scope, because `FrameworkDocument` records no
creator — the same resolution quotes already reached under D70.

---

#### DEC-15 — The desktop bet is a moat for a specific buyer. Fund the offline story, not cloud parity.

**Evidence for.** The 7 Jul 2025 Ramses Exchange fire took national connectivity to 62% then
**44%** overnight, with POS terminals and banking apps down across 20 of 27 governorates; the
facility carries ~40% of Egypt's traffic and WE holds ~80% of fixed broadband in a market rated
"Very Poor" for competition. Load-shedding ran 1–5 hours a day through 2023–24 — a power cut kills
a router before it kills a laptop on battery. Fixed broadband is 12.96m subscriptions against ~26m
households.

**Evidence for distrust of hosted books: could not be verified with survey data.** The proxy is
what the incumbents had to build — Daftra ships a Windows "POS Desktop Application (Online &
Offline)" because its cloud POS could not survive the counter; Al-Ameen and Al-Afdal still sell
Windows desktop accounting with local databases and ETA integration. The desktop category is alive
in Egypt at the low end; Intuit's retreat is a US mid-market story.

**Evidence against.** Cloud ERP for Egyptian SMEs is a growing market and 60% of SMEs say they want
digital tools — vendor-sponsored figures, none of which measure the sub-20m shop.

**Panel:** `owner` — "my internet fails" is item 4 in the profile, and the pitch lands only if the
product *tells the story* (a status line: sold offline, N receipts queued, next drain).
`client-wholesale` — "anything that needs the internet" is a listed dealbreaker. `it-admin` — the
moat is only as real as the restore drill, and §5.2's key-card residual (backups unrecoverable on
new hardware without a paper key) is what turns "offline" into "lost the books". **Dissent:**
`client-accounting-office` — single-tenant desktop forces one install per client and no remote view
of 60 sets of books; for a bureau the desktop bet is a **cost**, and the SaaS models slice is the
answer. `product` agrees: the bet is per buyer, not per company.

**Reversal cost: the highest in this set — the architecture is the product.**
**Backlog consequence:** E1-06 (verified backup and restore drills) and the key-card recovery path
come **before** any E3 cloud-parity item. ENH-E3-01 (remote glance) waits.

---

#### DEC-16 — POS stays out of v1. Say so in positioning. The e-receipt obligation is met without it.

**What other platforms do:** Daftra puts cloud POS in every plan (489.50–1,960 EGP/mo annual), with
offline hardware POS only on Premium. Foodics dominates restaurant POS in Egypt with offline mode.
The ETA e-receipt mandate requires POS **or ERP** integration, and shops under 50 receipts/month may
use the portal.

**The legal obligation does not need a till.** §5.4 already has `EtaDocumentType.receipt`, the
post-clearance queue, the QR on print and the idempotent reprint — all on the sales-invoice path,
and DEC-9 wires the producer.

**Panel:** `owner` wants the counter but will not pay for a v1 that slips — and the 26-task plan
starts with a mandatory hardware design spike for a screen with **no reference implementation
anywhere**. `client-retail` is told plainly in its own profile to keep its current till; its real
asks (branch scope, per-branch stock, daily cash close) are built. `client-restaurant` needs recipes
and the kitchen store more, and Foodics owns that counter anyway. `client-pharmacy` sells through a
till it already owns. `product` — POS is the one sanctioned net-new surface and the highest design
risk in the plan. **Dissent:** `owner` and `client-retail` both want the roadmap to name a date;
`support-agent` warns that "no POS" must be stated in the **first** sales conversation or it becomes
the most common refund request.

**Positioning line:** "Mezan runs the books, stock and branches behind your existing till; every
consumer sale it records is an e-receipt." **Reversal cost:** reversing a "no" costs nothing;
reversing a half-built POS costs a design spike done wrong.

**Re-confirmed 2026-09-18 (D-E)**, against the owner's request that "all modules are handled and
finalized". POS has no code at all; "handled" is met by this recorded decision, not by building a
till. Intuit — the QuickBooks baseline — discontinued QuickBooks Desktop Point of Sale on 3 October
2023. `client-retail` and `owner` still want a date; the answer is a trigger instead: **POS reopens
when three paying retail or restaurant tenants ask for it, or one quarter after v1 general
availability, whichever comes first.**

---

#### DEC-17 — Delete the API-key and webhook back end. Keep the event bus. Rebuild integration as a licensable module when the cloud edition has a public HTTP surface.

**What other platforms do:** Daftra publishes a REST API and Zapier/Make webhooks; Zoho Books has
in-app webhooks; QuickBooks Online and Xero have webhook APIs. **Every one of them is cloud** — the
API is reachable because the server is on the internet.

**The repo facts that decide it.** On desktop the only network surface is the LAN socket, and
`desktop/src/main/lan-host.ts:128-134` allow-lists exactly `/auth/login`, `/auth/logout`, `/tenant`,
`/health` and `/lan/*` — `/api-keys` and `/webhooks` are unreachable from anything but the host's own
IPC. Nothing authenticates a request by API key; `session-auth.ts` is session-only. The dispatcher
is the second subscriber on the event bus and only ever sees 5 of 39 events. The two screens were
already deleted (F129). What remains is `domain/{api-keys,webhooks}`, `contracts/{api-keys,webhooks}.ts`,
`persistence/{api-key-store,webhook-store}.ts`, `api/{api-keys,webhooks}-routes.ts` (345 lines), and
the options in `app.ts:385-395, 1719-1738`.

**Panel:** `it-admin` — an outbound dispatcher that POSTs signed bodies from a shop laptop is a
surface nobody can see or turn off from the UI now that the screens are gone. `security-officer` —
the day the LAN allow-list widens to serve a second machine, an unreached `/api-keys` route becomes a
reached one. `product` — "finish as a module" means opening the LAN socket to `/api/*` with key auth,
and that is the cloud edition's job, not v1's. `client-accounting-office` wants data *portability*,
which is a different feature and already exists. **Dissent:** `owner` — the comparison-grid row
"API: no" will be used against us by Daftra's sales; **accepted as the price**, stated in positioning
as "integrations arrive with the cloud edition".

**It cannot stay: built, used by nobody, reachable by nothing.** Deleting costs the dispatcher's bus
subscription and a migration to drop two tables; the event bus, `DocumentEventPublisher` and the
notification subscriber stay untouched. Reversal is a git revert plus the DEC-5 work that would have
been needed anyway.

##### What shipped, and the thing worth more than the deletion

The two domain packages, the two contracts, the two stores, the two route files, the transport, the
dispatcher's bus subscription and the seeding are gone. Because every store builds its own schema on
open and this repo has no central migration runner, the dropped tables are dropped where the
connection opens — an existing books file was still carrying hashed API keys and webhook signing
secrets for a surface that no longer exists.

**The webhook routes were the only audit writer that ever stamped a branch on its row.** Removing
them would have left `AuditEvent.branchId` — a decision recorded in this very section — and the audit
screen's branch filter with no producer at all: a column nothing fills and a filter over an empty
dimension. That is the identical failure this whole sweep has been closing, arrived at by deleting
rather than by building.

So every administrative audit record now carries the branch, read off the caller's own resolved scope
rather than off anything they send. An all-branch caller resolves to null and stays visible
unfiltered, exactly as before. The scenario that proved branch-scoped auditing used webhook
registration as its vehicle; it uses a role write now, and still asserts that a specific-branch filter
excludes both another branch and the branchless rows.

---

#### DEC-18 — Two named axes (cost centre and project), and stop. Branch becomes the third only via DEC-20. No generic dimension engine.

**What other platforms do:** Xero caps at **2** active tracking categories by design. QuickBooks
Online: class per line plus location per transaction = **2**. Zoho has unlimited reporting tags, but
tags are not a posting model. Only Business Central (8) and Odoo's analytic plans go further, and
neither is a target.

**The GL line already carries `costCenterId` and `projectId`** (`gl/ledger.ts:55-57, 66-68`;
`persistence/ledger-store.ts:59, 475`) — the same count as the baseline.

**Panel:** `cost-accountant` asked for a department axis; the cost centre already links 1:1 to a
department (`cost-centers/cost-center.ts:35-36`), so it is derivable. `accountant` backed two: each
axis is another field every clerk must fill, or every report shows "unallocated". **Dissent:**
`reports-analyst` wants percentage splits, Odoo-style — **rejected**, no comparator the buyer knows
has it.

**Reversal cost:** zero; adding an axis later is the D97 recipe. **Record only.**

---

#### DEC-19 — Keep the one-step transfer document. The in-transit leg is a TRANSIT warehouse, and a shortfall is a SHORTAGE adjustment on it. Both already exist.

**What other platforms do:** QuickBooks Enterprise transfers are instant, and transit tracking is
"currently unavailable". Xero core has no locations at all. Zoho Inventory has Initiate Transfer →
In Transit → mark transferred, whole-order, with no per-line shortfall. Odoo uses two pickings
through a transit location. **Daftra requires «قبول التحويل» at the receiving branch and raises a
«تحويلات لم تستلم» alert** — the Egyptian incumbent does have a receiving side.

**Panel:** `warehouse-keeper` and `internal-auditor` both hold "a transfer that can vanish" as a
dealbreaker; `client-wholesale` (6 vans) says van loading is where shrinkage hides; `owner`'s third
question is "is anyone stealing". `cost-accountant` and `chartered-accountant` objected to a
receiving confirm that admits shortfalls inside a valuation-neutral document: **the loss must be a
named, gated, posted adjustment, not a silent delta.** Both sides are satisfied by mechanism that
already exists.

**The resolution:** `WAREHOUSE_TYPES` already has `TRANSIT` — «مستودع وسيط» (`settings/warehouse.ts:18-25`)
— and the `SHORTAGE` reason posts Dr 5073 / Cr 1200 (`inventory/reasons.ts:95-101`, tenant-routable
at `create-backend.ts:326-337`) and passes the adjustment approval gate. So **dispatch** = transfer
A→TRANSIT, **arrival** = transfer TRANSIT→B, **shortfall** = a SHORTAGE adjustment on TRANSIT: a loss
with a cause, an approver and a GL entry. The transfer document stays valuation-neutral and matches
the catalog.

**The one gap versus Daftra is the alert.** On-hand in TRANSIT-type warehouses is «بضاعة قيد التحويل»;
`reports/inventory-stock-levels.ts:35,56` already takes a `warehouseId`, so a dashboard tile or a saved
view over TRANSIT warehouses is the whole build. **Do not** add an `in_transit` state or a
receive-with-shortfall confirm.

---

#### DEC-20 — Add a nullable `branchId` to the journal line, beside `costCenterId`/`projectId`, filled path by path. The statements get a branch filter with a mandatory «غير مخصص» bucket.

**What other platforms do:** Zoho Books stamps a branch on every sales, purchase, bank and **manual
journal** transaction and offers P&L compared by branch. QuickBooks Online: one location per
transaction, P&L by Location. Xero: a tracking category. Daftra filters sales reports by branch but
documents no per-branch income statement. **Every comparator that has branches puts the branch on the
entry; none derives it from the source document.**

**"Derive from source" is rejected** for the reason §6.1 already gave: manual journals
(`documents/journal-document.ts`), payroll, depreciation and year-end close have no document branch,
and the join would silently drop them.

**Panel:** `client-retail` (4 shops) and `owner` — per-branch P&L is the first question asked.
`reports-analyst` — "a report locked to all branches is unusable in a 4-branch business".
**`chartered-accountant` objected conditionally: a partially-filled dimension gives branch P&Ls that
do not sum to the entity unless the unattributed bucket is always shown. Never hide it.**
**`accountant` objected on scope: inter-branch cash and stock movements need due-to/due-from clearing
accounts to make branch books balance. A dimension is a management view, not statutory branch books —
say so in the docs.**

**Blast radius is real** — 9 `buildGlPosting` document types plus ~12 direct posting services
(`voucher-service`, `cheque-service`, `post-payroll-run`, `post-depreciation-run`, `year-end-close`,
contracting ×5, landed costs, writedowns) — **but it is additive and nullable, so it can be staged
and abandoned at zero cost.** The shape is known: D97 is the precedent.

**Hard sequencing rule:** do not ship the filter on any statement before the fill lands for the
sales, purchase and treasury paths. A filter over an empty dimension is the "silently does nothing"
failure D111 warned about.

##### What shipped — all five steps

`branchId` on `JournalLine`, `JournalLineInput`, `PostedLine` and `PostedLineFilter`, plus the
`journal_line.branch_id` column and its index. The migration guard is the D97 recipe already used for
`project_id`: read `PRAGMA table_info(journal_line)` at store construction, `ALTER TABLE … ADD COLUMN`
when absent. Nullable, so every line in an existing books file reads back unattributed.

**Carrying a branch now:** sales invoice on all legs (AR, revenue, VAT, COGS, inventory), purchase
invoice (inventory/GRNI, freight, expense, input VAT, AP), treasury voucher on both legs, and the
manual journal per line, through a picker over the real branch register.

**Still null:** payroll, depreciation, contracting, and both return documents — a return's branch has
to come from the source-invoice snapshot. No field was added that nothing fills.

Step 5 shipped because step 3 had landed. `branchScopeOf` is authority and is applied first;
`branchId` is presentation. **«غير مخصص» is an always-present, footer-totalled column computed without
the branch parameter**, so no filter can hide the reconciling item — the chartered accountant's
condition, enforced in code rather than promised. All four statements print the scope caveat in their
own `descriptionAr`: a management view, not statutory branch books, with no due-to/due-from clearing.

##### A real bug the invariants caught: the year-end close dropped the branch

`year-end-close.ts` grouped only by `projectId`, so closing a year swept each branch's result into an
unattributed retained-earnings line while that branch's own P&L accounts kept a mirror of what they
had earned. **A branch's balance sheet stopped balancing the day the year closed.** It now buckets by
(project, branch), and retained-earnings lines are emitted unconditionally — a profitable branch and a
loss-making one can net to a zero company result while each still needs its own line.

The four zero-invariants read exactly `0.000000` before and after.

---

### Taken 2026-09-18

#### DEC-21 — The public demo keeps a published login, scoped to the demo tenant; a shared password is the real gate

The Render demo auto-deployed from git with `MEZAN_SEED_ADMIN_PIN=123456`. PR #55's cloud entrypoint
**refuses to boot** with that variable set (its audit finding S-1: "a writable ERP on the open
internet behind a published PIN") and otherwise generates a random PIN, printed once to the deploy log.

**Four facts decided it:**

1. **The refusal protected nothing on the demo tenant.** Its seed creates ~20 personas, all on
   `123456`, including a second company admin with the `*` wildcard. A random PIN on one admin still
   leaves a published admin login.
2. **A per-deploy PIN is unusable on a free instance.** Render's free plan sleeps after 15 idle minutes
   and the demo re-seeds on every wake, so the PIN would change on every wake.
3. **The refusal did not take the demo down — it froze it.** Render keeps environment variables that
   are removed from `render.yaml` and never prompts for `sync: false` ones after creation, and a deploy
   that fails its health check leaves the previous one serving. So every new build failed and the
   **old** build — with optional auth and the published PIN — stayed on the internet.
4. **The variable is genuinely dangerous process-wide.** It fed the seed-admin secrets of every tenant,
   including tenants the platform console provisions. That is the legitimate reason to refuse it.

**What other platforms do:** QuickBooks Online's Test Drive needs no sign-in and wipes each visitor's
sandbox; Odoo's public demo databases live a few hours and its runbot publishes `admin`/`admin` on
throwaway builds; ERPNext offers a one-click demo login. **A known admin login is normal when the
instance is disposable and isolated.** None of them put one on a host that also serves real tenants.

**Taken:** the demo tenant's PIN is pinned **in code, for that tenant only** (`demo-tenant.ts` passes
`seedAdminPin` to `createBackend`, which refuses it unless the demo is being seeded). The process-wide
variable stays refused. `MEZAN_DEMO_PASSWORD` (basic auth) becomes mandatory exactly when the demo is
seeded, and is the real gate — handed to each prospect by sales, rotated monthly and after any leak,
never published. Without `MEZAN_SEED_DEMO=1` neither applies, so the future AWS SaaS is not behind a
`demo:` prompt. A test proves the pinned PIN does not reach a platform-provisioned tenant.

**Panel:** `owner`, `support-agent`, `product` backed the known PIN — a demo that needs a log lookup
before every call does not get used. `it-admin` backed it on condition the dashboard is fixed first.
`security-officer` backed it on three conditions, all met: the process-wide refusal stays, the gate is
mandatory wherever the demo is seeded, and the password is never published. **Dissent:**
`security-officer` prefers per-visitor ephemeral tenants, as QuickBooks does — deferred, because a
seeded tenant is ~375 MB on a 512 MB free instance; recorded as the target for the AWS demo.

**Ops step that only the dashboard can do** (Render keeps removed variables): delete
`MEZAN_SEED_ADMIN_PIN`, set `MEZAN_DEMO_PASSWORD`, set the platform-owner credentials, deploy, and check
`/` answers 401 without credentials and `/healthz` answers 200. `docs/DEPLOY-DEMO.md` has the steps.

**Also fixed by this:** `pnpm env:testing` / `env:staging` could not start on `main` — `scripts/env.mjs`
set the refused variable and not the now-required password. And the demo seeder's own second lock
(`assertLocalOrTest`) refused `NODE_ENV=production` outright, while `cloud.ts` and the Dockerfile both
run in production — so the demo would have crashed on boot even with the PIN fixed. Production now
passes that lock only with `MEZAN_SEED_DEMO=1` in the process's own environment. Landed as PR #63.

**Reversal cost:** low — drop the `seedAdminPin` argument.

---

#### DEC-22 — One set of security reports: the `report-*` screens survive, the `security-*` duplicates go

The #55 merge left two complete sets of screens routed and in the nav for the same four reports
(exceptions, post-posting changes, after hours, new accounts).

**Taken:** keep `screens/reports/` (rendered through `ReportRunner`); delete `screens/security/`. The
kept set has Excel/CSV export and print/PDF — an auditor needs both to file evidence — real date-range
fields defaulting to this month, and it is the only set with a navigation permission entry
(`audit.logs.view`); the deleted set had none, so the menu showed it to users who then got a 403.

Two defects fixed in the survivor on the way: the after-hours report offered three audit streams the
contract does not have (`financial`, `operational`, `admin` — each a validation error) and omitted
`sensitive`; and its KPI and gap labels rendered raw Arabic with no English. The deleted set's
translated labels were ported across. Landed as PR #64.

**What other platforms do:** exception and audit reports in QuickBooks (Audit Log, Voided/Deleted
report) and Odoo are exportable and printable; for audit evidence that is table stakes (ISA 230).
**Dissent:** `designer` preferred the deleted set's layout, which matches «سجل المراجعة» beside it —
overruled because it had no export; the part of the dissent carried out is the translated labels.

---

#### D-D — The D145–D148 collision

Main's D145–D148 (filed 2026-09-11 and 2026-09-14) keep their numbers; the desktop audit's first four,
filed as D145–D148 on the #55 branch, are **D177–D180**. §5.1 assigns an id by adding a row to the
register on `main`, so a number is the next free integer at the moment it lands there — main's four
landed first. Main's are also cited in 16 places in code and tests and in DEC-7, DEC-9 and §6.3; the
audit's are cited only here, and its code refers to the audit's own tags (L-1…S-*).

---

### Taken earlier

| # | Decision | Taken |
|---|---|---|
| DEC-2 | **The workflow gate is fed the actor's real ROLE code**, not the resolved permission set. `sales-invoices-routes.ts` and `vouchers-routes.ts` now resolve the role through `uow.users` → `uow.roles` before calling the gate, the way the approvals endpoints always did. Chosen over letting the gate match either, which would have broadened the meaning of every existing gate configuration — this option keeps `GateStep.role` meaning what its type and its tests already say. | 2026-09-07 |
| — | **The unabsorbed share of a landed cost posts to COGS 5100**, not to a new landed-cost variance leaf. Debiting the whole amount to inventory 1200 left GL 1200 above the valuation report by exactly the unabsorbed figure whenever a landed cost arrived after the goods were sold. COGS needs no chart-of-accounts template change and no migration; a dedicated variance leaf would need both and does not exist in the seed template. Reversible if an accountant wants the variance broken out. | 2026-09-07 |
| — | **Purchase receipt/invoice cancel routes 404** — turned out to be a defect, not a decision: `create-backend` now passes `purchases.layers`, which mounts both. Cancelling a confirmed invoice marks the original entry `reversed` and posts a linked mirror entry, and an invoice whose goods were already sold is refused with `PURCHASE_ITEMS_ALREADY_CONSUMED`. | 2026-08-25 |
| — | **Promotions persisted onto documents** as a value snapshot, not a foreign key, so a campaign edited later cannot retroactively change what a historical invoice says it granted. Evaluated server-side at confirm against the invoice's real lines. | 2026-08-25 |
| — | **`AuditEvent` carries `branchId`**, recorded from the scope the shell already sends and filterable in the viewer. Historical rows stay null: the table is append-only by trigger, so a back-fill is impossible by design and a default would fabricate evidence. | 2026-08-25 |
| — | ~~**Automated business-logic test execution is disabled** in favour of live verification against a seeded backend.~~ **REVERSED 2026-08-30 at the owner's instruction** — `TESTING.md` §1 now requires both halves: automated tests run locally *and in CI*, in addition to live verification, never instead of it. Kept here because the row stood unamended for two weeks after the reversal, and because CI went on not running a single test for a further two weeks after that — a withdrawn decision is only withdrawn where someone reads it. | 2026-08-23, reversed 2026-08-30 |

#### DEC-1 — Workflow `minAmount` — CLOSED 2026-08-27, moot

Resolved by removal rather than by decision. `minAmount` no longer exists anywhere in the
repo — not in `/settings/workflow`, not in the workflow config, not in
`DocumentWorkflowInput`. The threshold the UI once presented as enforced is gone, so there
is no longer a gap between what the screen promises and what the gate reads, and none of
the three options below were taken.

Kept as a record because the failure shape recurs: a configurable field that no code path
reads looks identical, on screen, to one that is enforced.

---

# 7. Beyond parity — the enhancement backlog


> **These are ENHANCEMENTS beyond 1:1 parity with the reference app.** **None is started, and none is on `main`** — `main` remains parity-only. Work on any of them belongs on its own branch tracking `main`.
>
> This is a **phased backlog of candidate issues**, ready to turn into tracker tickets later. Each candidate cites its requirement (`ENH-###`, `archive/enhancements/requirements.md`) and enabling workflow (`WF-##`, `archive/enhancements/workflows.md`). Sizes: S ≤1wk · M 1–3wk · L 3–6wk · XL >6wk. Estimates are relative to an already-built parity module and are planning inputs, not commitments.

---

## Sequencing principles

1. **Parity first.** Every candidate depends on its parity module existing on `main`; nothing starts before its dependency lands.
2. **Value-dense before broad.** Phase E1 is the six items every persona notices immediately.
3. **Shared substrate early.** The **Audit Ledger** (ENH-050) and the **event/notification taxonomy** underpin many later items — build them early.
4. **Vertical unlocks together.** Expiry/FEFO + van + reorder ship as the "distribution & pharma" cluster.
5. **The offline bet is funded before cloud parity is** — DEC-15, taken 2026-09-14. The desktop
   architecture is the product, and it is only as good as the day the machine dies: **ENH-E1-06
   (verified backup and restore drills) and the key-card recovery path in §5.2 come before any
   Phase E3 cloud-parity item**, ENH-E3-01 (read-only remote glance) included. The dissent is
   recorded and real — for a bookkeeping bureau running 60 sets of books, single-tenant desktop
   is a cost rather than a moat, and the SaaS models slice is the answer for that buyer, not a
   retreat from this one.

---

## Phase E1 — Foundation & daily-driver value (Must)

> Goal: the enhancements an owner, accountant, and auditor feel on day one, plus the shared substrate later phases build on.

| Issue | Title | Req | WF | Size | Depends on (parity) |
|---|---|---|---|---|---|
| ENH-E1-01 | Live Owner Cockpit dashboard | ENH-001 | WF-01 | L | Dashboard, Sales, Treasury, Inventory, Reports |
| ENH-E1-02 | Cash-runway & liquidity forecast | ENH-002 | WF-01 | M | Treasury, cheque register, AR, AP |
| ENH-E1-03 | Smart bank reconciliation | ENH-011 | WF-03 | L | Treasury, Accounting, import |
| ENH-E1-04 | Guided month-end close workspace | ENH-010 | WF-02 | L | Accounting periods, sub-ledgers, Multi-currency |
| ENH-E1-05 | Immutable searchable audit ledger (substrate) | ENH-050 | WF-13, WF-14 | L | Platform audit log, all module events |
| ENH-E1-06 | Verified backup & restore drills | ENH-060 | WF-15 | M | Desktop backup, Licensing |

**Exit criteria:** owner opens the cockpit daily; a period can be closed through the guided workspace; every sensitive change is in the audit ledger; a restore drill passes.

---

## Phase E2 — Per-persona wins (Should)

> Goal: concrete wins for accountant, warehouse, cashier, sales, and compliance built on the E1 substrate.

| Issue | Title | Req | WF | Size | Depends on |
|---|---|---|---|---|---|
| ENH-E2-01 | ETA e-invoice pre-validation & bulk resubmit | ENH-011b | WF-04 | L | Sales, ETA integration |
| ENH-E2-02 | Recurring & template journal automation | ENH-012 | WF-02 | M | Accounting, Fixed Assets, scheduler |
| ENH-E2-03 | Scanner-driven physical stock count | ENH-020 | WF-05 | L | Inventory, barcodes, companion device |
| ENH-E2-04 | Expiry tracking & FEFO engine | ENH-021 | WF-06 | L | Inventory costing/warehouses, dispatch |
| ENH-E2-05 | Keyboard/scanner-first POS fast lane | ENH-030 | WF-09 | M | POS selling screen |
| ENH-E2-06 | In-till discount approval | ENH-031 | WF-09 | M | POS, realtime, Audit ledger (E1-05) |
| ENH-E2-07 | Crash-safe / resumable cart | ENH-032 | WF-09 | S | POS |
| ENH-E2-08 | Price-floor & margin guardrails | ENH-041 | WF-11 | M | Sales pricing, Inventory cost, Workflow |
| ENH-E2-09 | Automated AR dunning / collections | ENH-043 | WF-12 | M | Sales AR, Notifications, CRM |
| ENH-E2-10 | Segregation-of-duties conflict detection | ENH-051 | WF-13 | M | Roles/permissions, Workflow, Audit ledger (E1-05) |
| ENH-E2-11 | Bulk user/role provisioning & onboarding | ENH-061 | WF-16 | S | Users/Roles, Licensing |

**Exit criteria:** ETA rejection rate drops; stock counts run on a device; POS is keyboard-first with approvals and crash recovery; below-floor sales are blocked; maker-checker SoD is enforced.

---

## Phase E3 — Depth, reach & extensibility (Could)

> Goal: broaden reach (mobile, CRM depth, van/distribution), close the audit loop, and open the platform.

| Issue | Title | Req | WF | Size | Depends on |
|---|---|---|---|---|---|
| ENH-E3-01 | Read-only remote/mobile glance | ENH-003 | WF-01 | L | Cockpit (E1-01), sync transport, **and ENH-E1-06 landed first (DEC-15)** |
| ENH-E3-02 | Owner daily digest & anomaly alerts | ENH-004 | WF-01 | M | Notifications, Reports |
| ENH-E3-03 | Reorder-point & replenishment suggestions | ENH-022 | WF-07 | M | Inventory, Purchases, velocity reports |
| ENH-E3-04 | Van/mobile-warehouse reconciliation | ENH-023 | WF-08 | M | Inventory transfers, Sales rep, Treasury |
| ENH-E3-05 | Digital shift & cash-drawer reconciliation | ENH-033 | WF-10 | M | POS, Treasury, Accounting |
| ENH-E3-06 | CRM opportunity pipeline | ENH-040 | WF-11 | L | CRM, Sales quotes |
| ENH-E3-07 | Quote→order→invoice funnel & rep leaderboard | ENH-042 | WF-11 | M | Sales docs, CRM, Reports |
| ENH-E3-08 | Auditor read-only evidence pack | ENH-052 | WF-14 | M | Reports, Accounting, Audit ledger (E1-05), Roles |
| ENH-E3-09 | Integration API, webhooks & connectors | ENH-062 | WF-17 | L | Hono API, event taxonomy, Auth |
| ENH-E3-10 | System-health & multi-till console | ENH-063 | WF-16 | M | LAN multi-till, Licensing, Backup |

**Exit criteria:** owner has a mobile glance; distribution cluster (reorder+van) live; CRM is a pipeline; evidence pack exports in one click; external systems integrate via API.

---

## Horizon (Won't-yet — parked)

Deliberately deferred; not scheduled. Revisit after E3.

| Idea | Note |
|---|---|
| AI-assisted natural-language reporting | "Ask a question about my data" over the report engine; needs BI substrate (E1) first. |
| WhatsApp order intake / catalog | High local demand; large integration + compliance surface. |
| Loyalty & promotions deepening | Beyond the parity loyalty add-on; retail vertical polish. |
| BOQ / progress-certificate / retention billing | Contracting vertical (named catalog gap); scope its own epic. |
| Multi-currency as a licensable module + IAS-21 FX depth | Packaging + accounting-depth decision, per `archive/plan.md` §8. |
| Cheque endorsement/replacement states | Extends the 7-state lifecycle; niche but real. |

---

## Roll-up

| Phase | Candidates | Sizes |
|---|---|---|
| E1 (Must) | 6 | 4×L, 2×M |
| E2 (Should) | 11 | 3×L, 6×M, 2×S |
| E3 (Could) | 10 | 3×L, 7×M |
| Horizon | 6 | unsized |
| **Total scheduled** | **27 candidates** (28 requirements; ENH-042 & ENH-040 share WF-11, all mapped) | — |

All candidates trace to a requirement in `archive/enhancements/requirements.md` and a workflow in `archive/enhancements/workflows.md`. Beyond-parity; not on `main`; each belongs on its own branch tracking `main`.

---


---

# 9. Small screens


**Done 2026-09-14.** `pnpm test:responsive` — 17 checks at 390px (iPhone 14/15) and
360px (the narrowest Android still in real use), on a demo-seeded tenant because an empty
list has no columns to overflow and would pass while proving nothing.

The app did not work on a phone, and it was ONE cause rather than many: `WorkspaceRail`
was a fixed 256px column, so a 390px screen had 134px left for the content and the PAGE
scrolled sideways — the user dragged the whole layout to read one row, and the chrome went
with it.

- **The column is a drawer below 900px** — its own toggle, a scrim, a focus trap, Escape,
  and close-on-navigate (a drawer left open over the screen it just opened is the commonest
  way this pattern is got wrong). It also closes itself on a resize back to desktop, since
  the toggle that dismisses it is hidden at that width. **Hiding the column was tried first
  and is wrong**: it carries the brand, the workspace list and RailFooter's theme toggle,
  notifications and user menu, so hiding it left no route to any of them and broke sign-in.
- **`min-w-0` on `Panel` and `KpiTile`.** A grid child defaults to `min-width: auto` —
  "at least as wide as my content" — so they refused to shrink below the 517px aging table
  and the seven-digit figure they hold, and their own `overflow-x-auto` never got the
  chance to scroll.
- **The KPI tile shrinks below 420px** rather than the number wrapping: a money figure
  never breaks mid-digit, by design.

**The RTL trap, recorded because it cost an hour.** This app runs RTL, so overflowing
content escapes past the LEFT edge and `getBoundingClientRect().right` stays inside the
viewport the whole time. A right-edge-only detector reports nothing while the page is 149px
too wide.

**Still desktop-first by intent.** The rule the suite enforces is that wide content scrolls
inside its OWN container — an ERP row has more columns than a phone has pixels, and no
amount of stacking makes that readable. What must never scroll is the page.

---

# 8. Shell follow-ups


**Seven of the eight are done; one is a judgement call nobody has made.** Measured against
the code on 2026-09-14, not against this list — three entries below were already closed
when the list still called them open, which is why each one now names its evidence.

| § | Item | State |
|---|---|---|
| 8.1 | A better Arabic typeface | **Done.** The face is Zain (`packages/ui/src/tokens/fonts.css`), a real Arabic family across the weight range, not the old `font-ar` fallback |
| 8.2 | A real icon per sidebar item | **Done.** `nav-icons.tsx` maps 164 entries; the single-letter fallback is gone |
| 8.3 | Organising the sidebar | **Done — the restructure this asked for already happened.** The note describes a flat list of 115 entries in 17 groups. `nav-config.tsx` now holds **12 workspaces** carrying **17 sections** (`daily` / `master` / `reports` / `config` / `close`), with 27 sections collapsed by default so a workspace opens on the handful of screens used daily. Icons landed (§8.2) and `⌘K` searches across all of it including report titles (§8.4). Whether any SPECIFIC grouping is right is a product judgement, and this repo settles those against the running reference app, not by re-deciding them here |
| 8.4 | Search in the sidebar | **Done 2026-09-14.** Answered as "no separate rail filter" — `⌘K` is the one search surface. What WAS broken is fixed: the bar matched nav labels with a raw `includes`, so «قائمة الدخل» (a tab inside «التقارير المالية», with no nav label of its own) returned nothing, and an unforgiving match missed on a hamza the user did not type. Commands carry keywords, and the filter runs through `matchesSearch` |
| 8.5 | A customisable main dashboard | **Done 2026-09-14.** The four lower panels are addressable widgets; the screen renders the user's stored layout |
| 8.6 | Somewhere to store per-user preferences | **Done.** `packages/domain/src/user-preferences` + `/preferences`, and it already modelled a dashboard layout before anything read it |
| 8.7 | Widget visibility follows permissions | **Done 2026-09-14.** Checked when the layout is RESOLVED, not when it was saved, so a layout stored before a permission was revoked degrades quietly rather than rendering a card the user may not read |
| 8.8 | Mirror the directional icons under RTL | **Done 2026-09-14.** A RULE in the nav registry's one render path, not a sweep, so a new screen cannot reintroduce an unmirrored arrow. The directional set is deliberately short and a test pins its size: an icon that carries an OBJECT — a clock, a coin, a building — must not flip, and mirroring those is the usual overcorrection |

