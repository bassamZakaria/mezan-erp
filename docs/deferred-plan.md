# Mezan — Deferred Areas Build Plan: HR/Payroll, POS, Cloud/SaaS

> Scope: the three areas explicitly descoped at v1 kickoff (`docs/plan.md` §"v1 Scope"): **HR/Payroll**, **POS (including the net-new selling screen)**, and the **Cloud/SaaS website edition**. `docs/backlog.md` already reserves these as Phase 13/14/15 stubs (13/16/15 issues respectively); this document expands each into a dependency-ordered, issue-level plan and is the thing to work from once v1 (Phases 0–12, SQLite-only Electron desktop) ships. Nothing here invents scope beyond `docs/catalog/06-crm-hr.md`, `docs/catalog/05-pos-installments.md` and `docs/plan.md`'s architecture sections — deviations and open decisions are flagged inline, not silently resolved.

**Why these three, together, now:** all three were deferred by the same Path-A decision — build the SQLite-only desktop core first, but keep the domain core behind repository ports and the transport behind a Hono app so nothing here requires re-architecting anything already shipped. HR/Payroll and POS are pure domain-service additions on top of the finished GL/treasury/cost-center/sales-invoice/inventory engines. Cloud/SaaS is almost entirely *infrastructure* — a Postgres dialect, a real HTTP host, multi-tenant auth — sitting underneath the same `packages/api` Hono app and `packages/domain` core that already exist and already run over HTTP today (`apps/server` currently serves the shared app against SQLite as a Postgres stand-in — see Cloud §0).

**Sequencing between the three areas:** independent tracks, no cross-blocking. HR and POS both depend only on v1-core engines (GL, treasury, cost centers, sales-invoices, inventory, stock, permissions, numbering, workflow, notifications, print/report engine) — pick either first based on business priority. Cloud/SaaS can start in parallel with either, since its Phase 0 (Postgres dialect + conformance suite) only needs the schema-spec DSL that already exists; it does *not* need HR or POS domain code to exist first, though shipping it after both gives the conformance suite more domain surface to prove out.

---

## Legend

| Size | Meaning (same scale as `docs/backlog.md` §2) |
|---|---|
| **S** | < 1 day — CRUD screen, config toggle, single report, small fix |
| **M** | 2–4 days — a screen with real workflow/state machine, or a medium engine slice |
| **L** | ~1–2 weeks — a screen family or a substantial engine component |
| **XL** | 2+ weeks — phase-defining engine work; usually warrants its own sub-breakdown (Payroll's calc kernel and the POS selling screen both get one below) |

Each task row carries a **Reuse** column naming the actual existing package/module it builds on — verified against the current `packages/domain/src`, `packages/persistence/src`, `packages/api/src` and `apps/server` trees, not inferred from the architecture doc alone.

**Confirmed already in the repo and reusable by every task below:**
- `packages/domain/src/gl`, `journal.ts`, `post-journal-entry.ts` — the balanced-entry posting engine (Article-47/payroll/accrual/advance postings all route through this, not a new engine).
- `packages/domain/src/treasury-accounts`, `vouchers` — cash accounts, the 10-type voucher document, allocation/cash-application.
- `packages/domain/src/cost-centers`, `cost-center-pl` — for departmental/branch cost allocation.
- `packages/domain/src/sales-invoices`, `sales-returns` — the document engines the POS selling screen and refunds specialize, not reimplement.
- `packages/domain/src/permissions`, `numbering`, `workflow`, `events` (typed event bus/catalog), `entitlements`, `licensing`, `lan` (LAN multi-till session registry + feature flags), `reports/engine.ts` (`ReportDefinition` abstraction).
- `apps/server` — already mounts the shared `packages/api` Hono app over HTTP with SQLite standing in for Postgres (Path A proof point); Cloud's job is to swap the dialect and add real multi-tenancy underneath this, not stand up a server from zero.
- **Not yet built anywhere** (confirmed by search — flag honestly rather than claim false reuse): a `FileStore`/attachments port and implementation. HR (employee photos, contract attachments), POS (item images already exist via Items) and Cloud (S3 adapter) all need this; it does not exist today and is called out as new work where it first becomes a hard dependency (HR §1, Cloud §2).

---

## Part 1 — HR/Payroll (27 tasks)

Ordered by the dependency chain the catalog itself implies: Employees is the hub record every other HR screen scopes against (`06-crm-hr.md`: "most other HR screens ... are really employee-scoped sub-resources"); Payroll is deliberately last because it consumes Contracts + Attendance + Advances and is the single largest unknown in the whole catalog (§0.6 below).

### HR-0 — Foundation & master data

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 1 | HR numbering: `EMP-####` employee-code sequence registered in the numbering engine | S | v1 numbering engine | `packages/domain/src/numbering` — add one more of the 25 sequence types, same atomic-counter mechanism already used for invoices/POs |
| 2 | HR permission set: register `hr.*` dot-notation perms (employees/contracts/attendance/leave/payroll/advances, `⚠ sensitive` on salary/personal-data reads) into the permission catalog + dependency graph | S | v1 permissions engine | `packages/domain/src/permissions` (data-driven manifest), `packages/api/src/permission-gate.ts`, `module-gate.ts` |
| 3 | Departments: CRUD, self-referencing parent hierarchy, manager picker | S | #2 | `packages/domain/src/users` (manager select), branches |
| 4 | Job Titles: dept-scoped CRUD (title disabled until department chosen) | S | #3 | same list/CRUD primitives as Departments |
| 5 | Shift Settings: named time-window templates, optional branch scope | S | branches | none new — same pattern as v1's branch-scoped master data |

### HR-1 — Employee & Contract core

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 6 | Employee domain model + repository: identity, employment info (worker category, overtime-eligibility inheritance chain dept→company, `priorServiceYears` for Article 47), address, emergency contact | L | HR-0 | branches (assignment), users (account-link for self-service, HR-3 #16) |
| 7 | Employee attachments/photo — **new**: minimal content-addressed `FileStore` port + desktop impl (mirrors the file-storage design already specified for Cloud, built once and shared) | M | #6 | none existing — first hard need for the FileStore port; build the port here so Cloud §2 only swaps the adapter |
| 8 | Employee create/edit full-page form (all sections incl. clock-in biometric/selfie switches, probation end date) | L | #6 | `<DocumentDetail>`/form primitives, `<EntityPicker>` (v1 design system) |
| 9 | Employee list + detail page (8 tabs, side-panel quick-view variant) + status machine (active/on-leave/suspended/terminated) + terminate action | L | #6, #8 | `<DocumentList>` primitive |
| 10 | Contracts domain model: type/pay-basis/frequency, currency (reuse the 11-currency list), leave-entitlement overrides, allowance/deduction line items | L | #6, Leave Policies (HR-3 #14 — can stub entitlement defaults until then) | multi-currency (`packages/domain` money/qty), same currency picker as Sales Customers |
| 11 | Contracts list + detail page (پay-terms tab, audit tab) + terminate-contract action | M | #10 | `<DocumentDetail>` tabs pattern |

### HR-2 — Attendance & Holidays

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 12 | Attendance domain model: daily status codes (P/A/H/L/HO/weekly-off), manual entry path (device/biometric ingestion is a stub hook, not built — no hardware integration evidenced in the catalog) | L | #6, #5 | none new |
| 13 | Attendance calendar-grid screen (month navigator, per-employee row × day-of-month columns) + monthly-summary dialog | L | #12 | **new component** — the one HR screen that isn't the standard list+filter+table pattern; nothing to reuse from v1's `<DocumentList>` |
| 14 | Official/Public Holidays: year-tabbed CRUD, recurring-vs-one-time flag | S | none | none new |

### HR-3 — Leave

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 15 | Leave Policies: type matrix (entitlement/accrual-frequency/carryover/termination-payout/legal-mandate flag) + two dated presets (Egypt Labour Law 12/2003, 14/2025) modeled as **versioned dated data**, never hardcoded | M | none | follows `plan.md` §6.2's explicit mitigation for "Egyptian regulatory change" risk — legal constants as data, not logic |
| 16 | Leave Requests: domain + workflow (half-day = 0.5-day calc, leave-type resolution from policy + contract override) | L | #10, #15 | `packages/domain/src/workflow` (26 action types) — **[decision]** confirm whether the 9 granular per-leave-type gates the task brief names are real distinct action types or one gate applied per leave-type instance; not directly evidenced in `06-crm-hr.md` itself, cross-check `09-settings-dashboard-ux.md`'s 26-type catalog before finalizing |
| 17 | Leave Requests screens: admin list + full-page new-request form | M | #16 | `<DocumentList>`, standard form primitives |
| 18 | My Leave (employee self-service, gated on account-linked-to-employee-record) | S | #9, #16 | same list/form components as #17, scoped to `me` |
| 19 | Leave Accrual Batches: manual ("run now") + scheduled runs, **posts a journal entry** and updates balances immediately | M | #16, GL | **`packages/domain/src/gl`, `journal.ts` directly** — this is a JE-posting consumer of the existing engine, not a new one; scheduler pattern per `plan.md` §3.5 (desktop in-process scheduler with catch-up semantics) |

### HR-4 — Advances

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 20 | Employee Advances domain: 4-state workflow (pending→approved→disbursed→repaid), explicitly a **balance-sheet asset/debt**, expensed only on write-off | M | #6, GL/accounts | **`packages/domain/src/gl`, `accounts`, `treasury-accounts`/`vouchers`** for the disbursement cash-out leg |
| 21 | Advances screens: list + request dialog + approve/disburse/repay row actions | S | #20 | same list/dialog primitives |

### HR-5 — Payroll engine (deliberately its own sub-phase — largest specification hole in the whole catalog)

The create-run dialog itself is two fields (year, month); everything else — the actual calculation — was never observed running against real data in the source (one seeded employee, no executed run). Per `docs/backlog.md` §7.4's finding, this needs a standalone design deliverable before it can be split into safely-sized build tickets; the breakdown below is the *shape* of that split, not a claim the internals are already known.

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 22 | **Payroll calc-engine design spike** — resolve the day-divisor basis (tenant setting observed as `payrollDayDivisorBasis: "FIXED_30"` with zero UI surface), the Article-47 seniority-bonus formula, the overtime multiplier, and how allowances/deductions/leave-entitlement contract overrides combine into gross pay. Output: a written calc spec, not code. | M | none (research/product decision) | **[decision]** — needs either a populated reference tenant with an executed payroll run, or a from-first-principles design against Egyptian payroll law; do not start #23 until this lands |
| 23 | Payroll calc kernel: base-salary proration (day-divisor), Article-47 seniority bonus, overtime multiplier, allowance/deduction application | XL | #22, #10 | `Money`/`Qty` scaled-int value objects + `decimal.js` rounding policy (v1 Phase 0) — same largest-remainder allocation discipline used for invoice discount/tax rounding |
| 24 | Payroll ↔ Attendance integration (pull absence/overtime hours into the calc kernel) | M | #23, #12 | none new |
| 25 | Payroll ↔ Advances integration (pull installment deductions into the calc kernel) | M | #23, #20 | none new |
| 26 | Payroll run lifecycle (draft→calculated→approved→disbursed, +cancelled) + GL posting + payslip generation/print | L | #23–#25, GL, print engine | **`packages/domain/src/gl`/`journal.ts`** for posting; **`packages/domain/src/reports/engine.ts`** (`ReportDefinition`)+ v1's print pipeline and Arabic amount-in-words for payslips — no new print mechanism |
| 27 | Payroll screens: run list, new-run dialog, run detail (recalc/approve/disburse actions); HR Dashboard (KPI tiles, 3 charts, leave-consumption table, alert chips) | L | #26 | `<DocumentList>`/`<DocumentDetail>`, Recharts (already wired for the main Dashboard) |

*(27 numbered tasks above — HR-0 through HR-5.)*

---

## Part 2 — POS (26 tasks)

Highest design risk in the whole deferred scope: back-office parity (terminals/sessions/sales/refunds/discount-approvals/restaurant mode) is a straightforward build against v1 engines; the selling screen has **no reference implementation anywhere** — the source app's `/pos/sell` renders "نقطة البيع انتقلت إلى تطبيقات الجوال وسطح المكتب" (moved to mobile/desktop apps) and 404s the moment you try to reach it on web. It is broken out as its own sub-phase (POS-3) with a mandatory design spike ahead of any code, per `plan.md` §7.4.

### POS-0 — Foundation

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 1 | POS permission set: register the 38 POS permissions (largest single module in the catalog) into the catalog + dependency graph | S | v1 permissions engine | `packages/domain/src/permissions`, `packages/api/src/module-gate.ts` |
| 2 | Payment-method catalog: company-wide list, 2 non-deletable built-ins (Cash `CASH`, Card `CARD`), per-method account-type + default-account mapping | S | treasury-accounts | `packages/domain/src/treasury-accounts`, `accounts` |
| 3 | Terminals: CRUD (branch/warehouse/cash-drawer-account/enabled-payment-methods/thermal-printer-address) | M | #1, #2, branches/warehouses | branches, warehouses, treasury-accounts |

### POS-1 — Sessions/shifts & back-office ledgers

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 4 | Sessions/Shifts domain: open→running→close lifecycle, cash-drawer manual movements (float top-up/withdrawal/payout, distinct from customer cash sales), close-out variance calc | L | #3 | `packages/domain/src/treasury-accounts`/`vouchers` pattern for cash-movement entries |
| 5 | Session settlement UI: 6 sub-tabs (settlement, payment breakdown, AR/credit collections, cash movements, sales summary, salesperson breakdown) + close-shift dialog (expected vs. actual cash, closing notes) | L | #4 | `<DocumentDetail>` tabs pattern |
| 6 | POS Sales domain: immutable sale record created by the selling screen, GL + stock posting on confirm | M | #4, GL, Inventory | **specializes `packages/domain/src/sales-invoices` directly** — a POS sale is a constrained sales-invoice confirm path (walk-in default customer, immediate full payment), not a parallel document engine |
| 7 | POS Sales list + detail screens (items/payments/accounting-entries/attachments/audit tabs) | M | #6 | `<DocumentDetail>` "effects of this transaction" explainer pattern already built for Sales Invoices |
| 8 | POS Refunds domain: per-line qty-capped returns against an original sale, tied to an active shift | M | #6 | **specializes `packages/domain/src/sales-returns`** |
| 9 | POS Refunds screens (list + new-refund form, pre-scoped from a sale or opened blank) | S | #8 | same list/form primitives |
| 10 | Discount Approvals: manager queue, cashier/manager % + amount thresholds, 5-minute request expiry | M | #1 | **deliberately not the general workflow engine** — a separate, threshold-driven mechanism per `plan.md` §5.6; wired via `packages/domain/src/events` (notification-style, not the 26-action-type workflow gate) |
| 11 | POS Hub (domain landing page) | S | #3–#10 | same hub pattern already built for the other 8 domains |

### POS-2 — Restaurant mode

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 12 | Table Management: floor designer (drag-drop layout editor, staging area for unplaced tables, section/zone grouping) | L | #3 | none new — bespoke drag-drop, no v1 equivalent |
| 13 | Table Management: live occupancy view + per-table stats tab | M | #12, #6 | POS sales for revenue-by-table stats |
| 14 | Reservations: **consolidate** the embedded tables-tab reservation flow and the standalone `/pos/reservations` screen into one data model with two entry points (per `docs/backlog.md` §5, decision 10 — the source shows the same data behind two disconnected surfaces; pick one to avoid inheriting the ambiguity) | M | #12 | shared form/list |
| 15 | Kitchen Display System: order-card queue, stage transitions (queued→preparing→urgent→ready→picked-up), meal/course-section routing config | L | #6, dedicated realtime channel | **`packages/domain/src/events`** (typed event bus) — needs a dedicated, well-tested channel with polling fallback per `plan.md` §2.6, since this is the one screen with hard latency requirements; **[spec-risk]**: empty queue in the source, order-card layout/bump controls inferred, not observed |
| 16 | Deliveries: 6-state pipeline (pending→prepared→dispatched→delivered, +failed/returned), driver assignment, live-map placeholder | L | #6 | none new; **[spec-risk]**: 0 records in source, driver-assign/live-map mechanics unconfirmed |
| 17 | Loyalty points config (source shows this as platform-managed-only; **[decision]** whether Mezan makes it tenant-editable) | S | none | none new |

### POS-3 — The net-new selling screen

The single deliberate net-new UI surface in the entire Mezan rebuild. Every sub-task below reuses an existing engine for its *logic*; only the screen itself is new.

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 18 | **Selling-screen design spike** — interview a real cashier, storyboard scan→cart→discount-request→split-payment→receipt→drawer, hold/resume, AR collection at the till, offline queue + force-close; prototype in the design system; test on real hardware (barcode scanner, 80mm thermal printer, cash drawer, touch screen) | L | POS-1/POS-2 domain models | mandatory per `plan.md` §7.4 — do not start #19 until this produces an agreed screen spec |
| 19 | Product grid + search + barcode scan (incl. embedded price/weight barcodes: prefix + item-code digits + price digits + decimals + EAN-13 check) | L | #18, Items, v1 barcode-parsing rules | **v1's embedded-barcode parsing rules (Phase 9/10) + item search**, reused verbatim |
| 20 | Cart engine: line discounts, held/suspended sales, customer attach + walk-in default (`زبون عابر`) | L | #19 | **`packages/domain/src/sales-invoices` line/discount/tax computation directly** |
| 21 | Split & multi-method payment, AR/credit collection from the till (gated by the `السماح بتحصيل الآجل من الكاشير` setting) | L | #20, #2, treasury | **treasury cash-application/allocation engine (`packages/domain/src/treasury-accounts`, `vouchers`)** |
| 22 | Discount-over-limit request flow: cashier-side trigger feeding the manager approval queue | M | #10, #20 | POS-1 #10's Discount Approvals domain |
| 23 | Table assignment + course/meal routing to the kitchen | M | #12, #15, #20 | POS-2's table + kitchen domains |
| 24 | Cash-drawer movements + receipt print + drawer kick | M | #4 | **v1's client-rendered print pipeline + ESC/POS `tcp://ip:9100` raster/text path** (`plan.md` §2.4) for auto-cut/drawer-kick — not a new printing mechanism |
| 25 | Hard offline behaviour: offline sale queue + `force_close` permission ("close with pending offline sales") | L | #20, #21 | **`packages/domain/src/lan`** (session registry + feature flags already built for LAN multi-till) — a till losing its LAN connection to the shop's SQLite host is the actual offline scenario in Mezan's architecture (the desktop app itself is already offline-first by construction; this is specifically the *multi-till* disconnection case) |
| 26 | Selling-screen hardware E2E suite (scanner, thermal printer, drawer, touch) | M | #19–#25 | v1's Playwright **Electron** project (already in CI per `plan.md` §2.7) |

*(26 numbered tasks above — POS-0 through POS-3.)*

---

## Part 3 — Cloud/SaaS website edition (20 tasks)

Everything the Path-A decision was made to defer, not to avoid: `apps/server` already exists today and mounts the shared `packages/api` Hono app over real HTTP with SQLite standing in for Postgres (`apps/server/src/index.ts`). This part is genuinely additive infrastructure work underneath code that already runs the same way in production form on desktop — no domain rewrite anywhere in this section.

### Cloud-0 — Postgres dialect & conformance (the deferred core of Path A)

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 1 | Postgres schema-spec DSL codegen: emit `schema.pg.ts` + `drizzle-kit generate` migrations from the same spec that already emits SQLite | L | none | **`packages/persistence/src/schema.ts`** — the spec DSL is already authored once for SQLite per `plan.md` §2.2; this is the second codegen target it was built for |
| 2 | `SqlDialect` capability shim, Postgres implementation: upsert syntax, `RETURNING`, window functions, `ILIKE`, JSON functions, `pg_advisory_xact_lock` | M | #1 | shim interface scoped in `plan.md` §2.2 for exactly this swap-in |
| 3 | Dual-engine conformance test suite in CI: the full existing Vitest domain/repository corpus run against both a fresh Postgres (Testcontainers) and SQLite on every run | L | #1, #2 | **the entire existing test suite** across `packages/domain`, `packages/persistence`, `packages/api` — this task runs it twice, doesn't rewrite it |
| 4 | Golden-ledger fixture assertion on both engines (invoice→stock+COGS+AR+VAT, FX revaluation, payroll run, depreciation run — asserted to the minor unit) | M | #3 | existing golden-ledger/`post-journal-entry` test fixtures |
| 5 | Arabic search on Postgres: `pg_trgm` GIN index + `tsvector`(`simple`) over the shared `search_norm` column that SQLite's FTS5 already indexes | M | #1 | `normalizeArabic()` + `search_norm` column (already written by the domain on save for SQLite/FTS5 per `plan.md` §2.3) — same normalized text, new index type only |

### Cloud-1 — Auth & multi-tenancy

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 6 | Cloud JWT auth + refresh-token flow (`HttpOnly` cookie, in-memory access token — the two deliberate improvements over the source app's `localStorage` tokens), Argon2id password hashing | M | #1 | `packages/domain/src/users`, `roles`, `permissions` — same `AuthContext` shape the desktop local-user-store already produces (`plan.md` §3.3) |
| 7 | Postgres Row-Level Security: per-request `SET LOCAL app.tenant_id`, defence-in-depth under the repository's own tenant scoping | M | #6 | `tenant_id` already present on every desktop table (kept deliberately for this — `plan.md` §2.3) |
| 8 | Multi-tenant admin/platform-admin permission tier (the 2 platform-only permissions: `admin.tenant.settings.edit`, `admin.modules.manage`) | S | #6 | permissions engine's dependency-graph mechanism |

### Cloud-2 — Server, realtime & storage

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 9 | Node server hardening: real tenant resolution by company code (today's `apps/server` is single-tenant/dev-only), request-scoped `UnitOfWork`, structured error handling | M | #6, #7 | **`apps/server`, `packages/api`** — extends the existing mount, doesn't replace it |
| 10 | SSE + Redis pub/sub realtime fan-out, scoped per tenant/user | M | #9 | **`packages/domain/src/events`** — the typed event bus/catalog already used for desktop's in-process `webContents.send` delivery; same events, new transport |
| 11 | `FileStore` port, S3-compatible implementation (private buckets, short-lived signed URLs, server-side MIME scanning) | M | #9 | port interface built in HR §1 #7 for the desktop content-addressed store — this task adds the second adapter, not the port |
| 12 | Kitchen Display's dedicated low-latency realtime path over SSE (the one screen with hard latency needs, per `plan.md` §2.6) | M | #10, POS-2 #15 | same event bus/catalog |

### Cloud-3 — Entitlements, billing, onboarding

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 13 | Subscription/plan → entitlements mapping (`{plan, activeModules[], features{}, seats, expiresAt}`) | M | #6 | **`packages/domain/src/entitlements`** — same shape the desktop Ed25519 license file already encodes (`plan.md` §2.5); cloud just derives it from a subscription record instead of a signed file |
| 14 | Tenant onboarding: company-code registration + seed wizard (COA, tax profile, numbering sequences, branch, warehouse) | M | #13 | mirrors the desktop first-run wizard already specified in `plan.md` §3.3 |
| 15 | Billing integration (provider **[decision]** — Stripe vs. a regional processor for EGP) | L | #13 | new work — no existing analog |

### Cloud-4 — Deferred platform surfaces that only make sense once multi-tenant

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 16 | API Keys + Connected Apps screen (real feature in the source, just unlinked from its nav) | M | #8 | v1's permission-gated settings-screen pattern |
| 17 | Webhooks: outbound HMAC-signed event delivery + event-type picker | M | #10 | same typed event catalog doubles as the webhook trigger source per `plan.md` §5.6 |
| 18 | Email delivery (SMTP/Resend) + headless-Chromium server-side PDF generation | M | #9, v1 print engine | **v1's client-rendered print DOM** — server renders the identical components via headless Chromium instead of `webContents.printToPDF`; offline (desktop) never depends on this path |
| 19 | Cloud backup: PITR, cross-region snapshots, per-tenant export (doubles as the cloud→desktop migration path) | M | #9 | desktop's backup/restore manifest + integrity-check design (`plan.md` §3.7) — same shape, platform-operated instead of scheduled-in-app |

### Cloud-5 — Packaging & deploy (local build/deploy steps only — no CI wiring as part of this plan)

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 20 | Production server deployment shape: container image, environment/secrets config, migration-on-deploy step, basic monitoring/logging | M | #9 | existing GitHub Actions pipeline structure (extended, not replaced) |

*(20 numbered tasks above — Cloud-0 through Cloud-5.)*

---

## Cross-cutting notes carried over from `docs/plan.md` and `docs/backlog.md`

- **WhatsApp integration settings** and the **third locale (German)** are named in the source catalog but flagged `[spec-risk]`/`[decision]` in `docs/backlog.md` §5 — neither is scoped as a numbered task above; resolve the product question first, then it's a small addition to Cloud-4 or the app-shell respectively.
- **ETA e-invoicing on the cloud edition** is already in v1 scope (online-only, per `plan.md` §3.6) and does not repeat here; Cloud's job is only to make sure the multi-tenant transport doesn't change its online-only constraint.
- **Payroll (HR-5) and the POS selling screen (POS-3)** are the two genuine unknowns in this entire deferred scope — both carry a mandatory design spike as their first task (#22 and #18 respectively) precisely so the size estimates on the tasks that follow them are honest rather than optimistic placeholders.
