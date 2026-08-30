# Manual test plan — external auditor (محاسب قانوني)

Persona: the person who signs the financial statements and carries personal
professional liability for that signature.
Not the staff accountant who books the month (`accountant.md`) and not the
end user keying documents (`end-user.md`). This plan assumes nothing works
until it is demonstrated. Every scenario below is grounded in a screen,
route or domain file that exists in this tree; nothing is invented. Screens
live under `apps/web/src/screens/` and `apps/web/src/pages/`, routes under
`packages/api/src/*-routes.ts` and `packages/backend/src/*.ts`, domain rules
under `packages/domain/src/`.

**Standard preconditions for every scenario unless stated otherwise:**
- Fresh seeded backend: `MEZAN_SEED_DEMO=1` against an empty database file
  (`pnpm --filter web dev` with the backend seeded).
- The seeded tenant "Cyag" (`packages/backend/src/demo-seed/access.ts`) ships
  thirteen roles, one named person per role, PIN `123456` for every account,
  email `<local>@cyag.example`. Two accounts anchor this plan:
  - **ليلى إبراهيم / Laila Ibrahim** (`laila.ibrahim@cyag.example`), role
    `AUDITOR` (مراجع داخلي) — every permission she holds is a `.view`; no
    write control should ever render for her. This is the default persona
    below unless a scenario names someone else.
  - **نادية شفيق / Nadia Shafik** (`nadia.shafik@cyag.example`) — a second
    tenant admin (`"*"`), used only where a scenario needs the admin bypass
    itself examined, never as a stand-in for a real control.
- One browser tab, one backend, one database per scenario — a second tester
  sharing the session invalidates every timing/uniqueness observation here.
- Arabic/RTL locale unless a scenario calls out English.

**Reading the assertions below.** Where a scenario checks a total, the two (or
more) figures that must agree are named explicitly. Where a "report computes
it" figure is being distinguished from a "the books hold it" figure — the
known weak point this plan probes hardest — the scenario says exactly which
screen, tab and row to look at for each, and what it would mean if they came
apart silently.

---

## Part 1 — Audit trail: who, what, when, from where

### MTP-CA-01 — A posted sales invoice is traceable to its actor, timestamp and branch
- **Persona / permission:** `laila.ibrahim` (`audit.logs.view`, `sales.invoice.view_all`).
- **Preconditions:** at least one confirmed sales invoice exists in the seed
  (any customer, any branch).
- **Steps:**
  1. Sign in as `karim.fouad` (`SALES_REP`), note the exact system time, and
     confirm a draft sales invoice on `sales-invoices` (button «تأكيد
     الفاتورة»). Note the invoice number shown (e.g. `INV-000123`).
  2. Sign out; sign in as `laila.ibrahim`.
  3. Open سجل المراجعة (`audit`).
  4. In الوحدة (module) type `sales`, and in الإجراء (action) type the
     confirm action if known, otherwise leave blank and use البحث بالمستخدم
     with `karim.fouad`.
  5. Open the matching row's side panel.
- **Expected:** a row exists whose المستخدم is `karim.fouad`'s resolved id
  (never a name the client could have supplied), whose الفرع matches the
  invoice's branch, whose التاريخ والوقت is within seconds of step 1, and
  whose تفاصيل إضافية (details JSON) names the invoice's own id/number. This
  satisfies the "who, what, when, from where" assertion for a posting event.
- **False pass:** the audit row exists but its actor is a display name string
  rather than the server-resolved user id, which would make the log
  falsifiable by a client sending a friendlier `x-user-id` — see MTP-CA-46,
  which proves this cannot happen through the header path; this scenario
  only proves the row exists and matches.

### MTP-CA-02 — A permission/role change is captured with before and after values
- **Persona / permission:** `laila.ibrahim` (`admin.roles.view`, `audit.logs.view`).
- **Preconditions:** signed in as `nadia.shafik` (tenant admin) in a separate
  session/tab to make the change.
- **Steps:**
  1. As `nadia.shafik`, open المستخدمون والأدوار → الأدوار, edit role
     `PAYROLL_OFFICER`, add permission `hr.payroll.approve` (a permission it
     does not hold in the seed), save.
  2. Revert the change (remove `hr.payroll.approve` again), save.
  3. As `laila.ibrahim`, open `audit`, filter الوحدة to `roles`/`admin` (or
     search actor `nadia.shafik`).
  4. Open both matching rows.
- **Expected:** `packages/api/src/admin-audit.ts`'s `changedKeys()` records
  exactly which key changed and both its `from` and `to` value — two audit
  rows exist, one showing `permissions` gaining `hr.payroll.approve`, the
  other showing it removed. This is the exact before/after pairing §1 of the
  audit programme requires for master-data changes.
- **False pass:** a row exists that only says "role updated" with no `from`/
  `to` detail — that shows an edit happened, not what changed, which does not
  meet the audit-trail bar for a permission change.

### MTP-CA-03 — Fiscal-period close and reopen are both audited, independently of the GL entry
- **Persona / permission:** `laila.ibrahim`; period actions performed by
  `tarek.mansour` (`FINANCE_MANAGER`, `accounting.period.close`).
- **Preconditions:** an open period exists on `fiscal-periods`.
- **Steps:**
  1. As `tarek.mansour`, open `fiscal-periods`, click «إغلاق» on the current
     open month.
  2. Click «إعادة فتح» on the period just closed.
  3. As `laila.ibrahim`, open `audit`, search الوحدة for `accounting` /
     actor `tarek.mansour`.
- **Expected:** two rows, one per action, both naming the period (year +
  month) in details, both attributed to `tarek.mansour`, both `sensitive`
  stream. This is distinct from the year-end-close journal entry (MTP-CA-12) —
  a period close is a state transition on `FiscalPeriodRepository`, not a
  posting, and per `admin-audit.ts`'s own stated motivation this used to
  "write nothing at all."
- **False pass:** only the CLOSE is audited and the REOPEN is not (or vice
  versa) — a reopen with no trail is the more dangerous half, since it is
  what lets a later backdated posting into a period the statements were
  already drawn from.

### MTP-CA-04 — A settings change records which keys changed, not just "settings updated"
- **Persona / permission:** `laila.ibrahim`; change made by `nadia.shafik`.
- **Preconditions:** none beyond the seed.
- **Steps:**
  1. As `nadia.shafik`, open الإعدادات → عام, toggle تفعيل الرقابة الائتمانية
     off (or any boolean it currently holds on), save.
  2. As `laila.ibrahim`, open `audit`, filter to module `settings`.
- **Expected:** the row's details show the specific key (e.g.
  `enableCreditControl`) with `from: true, to: false` — not the whole settings
  object dumped, and not a keyless "SETTINGS_UPDATED" action.
- **False pass:** the action fired but details is `null` — `admin-audit.ts`'s
  own doc comment says this exact silence ("editing tenant settings ... wrote
  nothing at all") was the defect the module exists to close; confirm it
  stays closed.

### MTP-CA-05 — Login and logout are NOT in the audit trail (gap, not a false pass)
- **Persona / permission:** `laila.ibrahim`.
- **Preconditions:** none.
- **Steps:**
  1. Sign out. Sign in as any seeded user with the correct PIN.
  2. Sign out again.
  3. As `laila.ibrahim`, open `audit`, filter الوحدة to `auth` / `profile`,
     and separately try الإجراء `LOGIN`.
- **Expected — this is a documented gap, not a defect to "fix" by re-testing
  differently:** no row exists for a successful login, a failed PIN attempt,
  or a logout. `packages/backend/src/auth-routes.ts`'s `POST /auth/login`
  calls no `recordSecurityEvent`/`recordSensitiveEvent` anywhere on the
  success or failure path; only `PASSWORD_CHANGED` and the PIN-change actions
  are recorded, from `packages/api/src/profile-routes.ts`. The domain audit
  module's own doc comment names "account lockout = CRITICAL" as something
  "observed in the captured app" — i.e. the reference system had this, this
  build does not.
- **Implication for the opinion:** who accessed the system and when — a
  baseline forensic question — is unanswerable from this system's own
  records. Record as a finding; do not accept "the OS/network log has it" as
  a substitute without independently verifying such a log exists and is
  retained.

### MTP-CA-06 — A permission-denied attempt is a visible 403, not a silently empty screen
- **Persona / permission:** `amir.zaki` (`PAYROLL_OFFICER` — holds
  `hr.payroll.calculate`/`.run` but not `.approve`/`.pay`).
- **Preconditions:** a calculated (unapproved) payroll run exists on `payroll`.
- **Steps:**
  1. Sign in as `amir.zaki`. Open `payroll`.
  2. Attempt to find and click an approve/pay action on the calculated run.
  3. If no UI control exists (expected — his role has no such permission), call
     the approve endpoint directly with `amir.zaki`'s session token.
- **Expected:** no approve/pay control renders for `amir.zaki` in the UI at
  all (permission absent, not present-but-disabled). The direct API call
  returns `403 PERMISSION_DENIED` naming the missing permission
  (`hr.payroll.approve`), per `createPermissionGate`'s explicit response
  shape in `packages/api/src/permission-gate.ts`. Nothing about the payroll
  run's own state changes.
- **False pass:** the screen shows an empty list where the run should be —
  that reads as "no data" to a tester, not "access denied," and hides the
  fact that a control existed and was refused; `createAnyPermissionGate`'s own
  doc comment (D31) names exactly this failure mode for a too-narrow gate.

### MTP-CA-07 — The audit log cannot be edited, deleted or cleared through any route
- **Persona / permission:** `laila.ibrahim`.
- **Preconditions:** at least one audit row exists (any of the above).
- **Steps:**
  1. Open `audit`. Search the whole screen and every row's side panel for any
     «تعديل» / «حذف» / "clear log" control. There is none — `AuditLogScreen`'s
     own doc comment states it mounts no edit/delete affordance.
  2. Inspect `packages/api/src/audit-routes.ts`: it mounts only `GET /`.
  3. If direct DB access is available for this test (a desktop-edition SQLite
     file), attempt `UPDATE audit_event SET ...` and `DELETE FROM
     audit_event ...` against the file directly.
- **Expected:** the API exposes no PATCH/PUT/DELETE on `/audit` at all — a
  raw request to any such verb 404s. The direct SQL attempts abort:
  `packages/persistence/src/audit-sink.ts` creates
  `audit_event_no_update`/`audit_event_no_delete` `BEFORE` triggers that
  `RAISE(ABORT, 'audit_event is append-only')` — so even a stray SQL
  statement, not just the application code, cannot mutate history. This is
  the strongest form of the immutability assertion: it holds at the storage
  layer, independent of the API.
- **False pass:** the UI simply hides the button (a defect the audit brief
  explicitly warns against accepting at face value) — the SQL-level check in
  step 3 is what actually clears this dealbreaker, not the absence of a
  button.

---

## Part 2 — Immutability of posted entries: correction only by reversal

### MTP-CA-08 — A posted journal entry has no edit/delete control, in the UI or on the wire
- **Persona / permission:** `tarek.mansour` (`accounting.journal.post`).
- **Preconditions:** one posted journal entry (any prior period's postings from
  the two-and-a-half years of seeded trading, or post a new one on `journals`).
- **Steps:**
  1. Open the posted entry's detail panel on `journals`.
  2. Search the panel for any «تعديل» control — only «عكس القيد» is present.
  3. Send `PATCH`/`PUT`/`DELETE` directly to `/gl/journal-entries/:id`.
- **Expected:** `packages/api/src/gl-routes.ts` mounts only `GET
  /journal-entries/:id`, `POST /journal-entries/:id/post` and `POST
  /journal-entries/:id/reverse` — no mutating verb exists on the entry's own
  id at all. A raw request to an unmounted verb 404s.
- **False pass:** a route exists that "edits" an entry by accepting a body and
  silently no-opping the fields — confirm the response is a routing 404, not
  a 200 that changed nothing.

### MTP-CA-09 — Correcting a posted journal entry is only possible by reversal
- **Persona / permission:** `tarek.mansour`.
- **Preconditions:** MTP-CA-08's posted entry.
- **Steps:**
  1. Click «عكس القيد».
  2. Reload `journals`.
- **Expected:** two facts change together: the original flips to status
  «معكوس», and a new entry appears whose lines are the exact mirror (debit ↔
  credit swapped, same accounts), dated per the reversal call, its own total
  debit = total credit = the original's total. Both entries remain visible —
  the correction is additive, never a rewrite. This is the domain's own stated
  rule: `document.ts`'s `DOCUMENT_TRANSITIONS` allows `confirmed`/`posted`
  only to transition to `reversed` — there is no path back to `draft` or to
  any edit-in-place state once a document is active.
- **False pass:** the reversal posts but the original entry's own status stays
  «مرحل» — the ledger would then carry the same money twice as live, which is
  worse than either entry alone.

### MTP-CA-10 — A confirmed sales invoice cannot be edited; its correction is a سند مرتجع مبيعات
- **Persona / permission:** `omar.hilal` (`SUPERVISOR`, `sales.invoice.confirm`).
- **Preconditions:** a confirmed sales invoice.
- **Steps:**
  1. Open the confirmed invoice on `sales-invoices`.
  2. Confirm there is no field-level edit affordance on a confirmed invoice —
     only `POST /:id/payments` (recording a collection) is available, per
     `packages/api/src/sales-invoices-routes.ts`'s route list.
  3. Attempt `PATCH`/`PUT` directly against `/sales-invoices/:id`.
  4. Instead, open `sales-returns`, raise a return against this invoice, and
     confirm it.
- **Expected:** no mutating verb exists on the confirmed invoice's id (404 on
  direct attempt). The correction path is the separate `sales-returns`
  document type (its own numbering sequence, `SALES_RETURN` / `SRT-`), which
  posts its own reversing effect on AR and inventory rather than altering the
  original invoice's lines. This is architecturally distinct from journal
  reversal (MTP-CA-09) but the same principle: no mutation of a live document,
  ever — only a new, linked document.
- **False pass:** `/:id/cancel` (gated on `sales.invoice.delete_draft`) is
  mistaken for a correction path on a CONFIRMED invoice — per
  `DOCUMENT_TRANSITIONS`, `cancelled` is only reachable from `draft`/`pending`,
  so this route cannot touch a confirmed invoice; verify it 4xxs if attempted
  on one.

### MTP-CA-11 — Stock movements and cost layers are immutable at the storage layer
- **Persona / permission:** `laila.ibrahim` for observation; any warehouse
  transaction for setup.
- **Preconditions:** at least one item with posted stock movements (any seeded
  sale or receipt).
- **Steps:**
  1. Confirm on `stock-balance` / the item's ledger tab that a movement's
     quantity and unit cost are shown as read data with no edit control.
  2. If direct DB access is available, attempt `UPDATE stock_movement SET
     unit_cost = ...` and `UPDATE` against the cost-layer table directly.
- **Expected:** `packages/persistence/src/stock-ledger-store.ts` creates
  `stock_movement_no_update`/`stock_movement_no_delete` and
  `cost_layer_immutable_cost` `BEFORE` triggers — a stock movement cannot be
  updated or deleted, and a cost layer's receipt-time unit cost specifically
  cannot be altered once written, at the SQL layer. This is the WAC-costing
  half of the "immutable cost layers" assertion in the audit brief.
- **False pass:** the item's on-screen valuation looks internally consistent
  even though the underlying rows were never actually protected — the SQL
  trigger check in step 2 is what proves the guarantee, not the screen.

### MTP-CA-12 — The year-end close entry is an ordinary, reversible journal entry — not a privileged one
- **Persona / permission:** `tarek.mansour` (`accounting.period.close`).
- **Preconditions:** a fiscal year with posted revenue/expense activity, not
  yet closed.
- **Steps:**
  1. On `journals` (or wherever year-end close is triggered —
     `GET /gl/year-end-close/:year/preview` then `POST /gl/year-end-close`),
     preview the close for the seeded year, then post it.
  2. Locate the resulting entry (id `YEAR-CLOSE:<year>`) on `journals`.
  3. Confirm it shows «مرحل» like any other entry, and click «عكس القيد» on it.
  4. Attempt to close the SAME year again.
- **Expected:** the close entry is dated the last day of the year
  (`YYYY-12-31`), passes the same fiscal-period gate as any posting (a locked
  December refuses it — see MTP-CA-32), and is reversible exactly like any
  other entry (step 3 succeeds and produces a mirror entry). Re-closing the
  same year is refused with `YearAlreadyClosedError` — `packages/domain/src/
  gl/year-end-close.ts`'s `planYearEndClose` checks for an existing entry at
  the deterministic id before building a new plan.
- **False pass:** the close entry renders with no «عكس القيد» button (treating
  it as special/protected) — the domain's own doc comment is explicit that
  this must NOT be true: "it is corrected by reversal like any other
  posting." A close that cannot be reversed if it turns out to be wrong (wrong
  retained-earnings account chosen, wrong year) is a trap, not a control.

---

## Part 3 — Completeness and sequence (the 25 defined sequences)

### MTP-CA-13 — Document numbers are gap-free under ordinary confirmation
- **Persona / permission:** `karim.fouad` (`sales.invoice.create/confirm`
  is actually `sales.invoice.view_own`+`.create` — confirmation needs
  `omar.hilal`).
- **Preconditions:** note the next sales-invoice number shown on a fresh
  draft.
- **Steps:**
  1. Create and confirm three sales invoices back to back, noting each
     confirmed number.
  2. Open `settings-sequences`, find `SALES_INVOICE`, compare its "next"
     preview to the last confirmed number + 1.
- **Expected:** the three numbers are strictly consecutive
  (`formatSequenceNumber` zero-pads to the sequence's `padLength`, prefix
  `INV-`), and the sequence's admin preview matches. `NextNumberService`
  allocates via an atomic counter (`SELECT`/`BEGIN IMMEDIATE` per
  `next-number.ts`'s doc comment) inside the same transaction as the document
  insert — a value handed out is never reused and never skipped.
- **False pass:** the numbers "look" sequential because only one tester was
  active — this scenario alone does not prove gap-freedom under concurrency;
  see MTP-CA-15 for that.

### MTP-CA-14 — A cancelled draft consumes no number; a reversed posted document leaves its number visibly reversed, not deleted
- **Persona / permission:** `karim.fouad` for the draft; `tarek.mansour` for
  the posted entry.
- **Preconditions:** none beyond the seed.
- **Steps:**
  1. Create a draft sales invoice, note whether it already carries a number
     (check the draft's own detail — sales-invoice numbers are allocated at
     confirm, per the `confirm` route calling into numbering, not at draft
     creation).
  2. Cancel the draft (`sales.invoice.delete_draft`).
  3. Create and confirm a NEW sales invoice; note its number.
  4. Separately, post and then reverse a journal entry (MTP-CA-09); note its
     number stays visible in the list under status «معكوس», not removed.
- **Expected:** the cancelled draft either never had a number, or — if it did
  — the next confirmed invoice's number is unaffected by the cancellation
  (no gap was created because no number was consumed by a draft). The
  reversed journal entry's own number remains permanently visible in the
  list with status «معكوس»: a correction leaves a VISIBLE marker at its own
  number, never a silent hole.
- **False pass:** cancelling a draft is found to consume a sequence number
  anyway — record this as a finding (a visible gap the tenant did not choose
  to create), distinct from the expected, controlled gap a void/reversal
  produces.

### MTP-CA-15 — Two concurrent confirmations cannot allocate the same document number
- **Persona / permission:** `karim.fouad` and `omar.hilal` (or any two
  sessions holding `sales.invoice.confirm`/`.create`).
- **Preconditions:** two draft sales invoices ready to confirm.
- **Steps:**
  1. Open two draft invoices in two tabs/sessions.
  2. Click «تأكيد الفاتورة» on both as close together as the UI allows (or
     fire two `POST /:id/confirm` calls back to back from a script).
  3. Compare the two resulting invoice numbers.
- **Expected:** the two numbers differ and are consecutive — `SequenceStore.
  increment` (`packages/domain/src/numbering/next-number.ts`) is documented
  to take a write lock per counter row (`BEGIN IMMEDIATE` on SQLite), so two
  callers can never read the same value. No duplicate number, no gap.
- **False pass:** both confirmations "succeed" with visually different
  numbers but a background job later shows two documents sharing one number —
  re-check by querying `GET /sales-invoices` for any duplicate `number` field
  across the whole tenant, not just the two just created.
