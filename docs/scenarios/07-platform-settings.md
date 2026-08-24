# 07 — Settings & Platform Administration

Exhaustive UI test scenarios for every settings and platform-administration screen
in the built app: `apps/web/src/settings/*`, `apps/web/src/pages/{Users,Roles,RoleEditor}Page.tsx`,
`apps/web/src/screens/{ApprovalsInbox,AuditLog}Screen.tsx`, and the settings-adjacent
chrome in `packages/ui/src/shell/*` (language toggle, theme toggle, branch/warehouse
scope switchers). Cross-checked against `docs/catalog/09-settings-dashboard-ux.md`
(the reference product capture) — every place this build differs from, exceeds, or
falls short of the reference is called out inline.

## How this build's navigation actually works — read this first

This SPA has **no URL routing**. `App.tsx` holds `activeScreen` in React state; every
nav click calls `navigate(key)`. There is no `/settings/...` path, no `?tab=` query
string, and a browser reload always lands back on the dashboard (`activeScreen`
resets to `"dashboard"`). Every "Pre" below that says "navigate to X" means clicking
through the sidebar from wherever the previous scenario left off — there is no
deep link to paste. The one exception: **language** and **theme** persist to
`localStorage` and restore across reload (`mezan:theme`, the i18n locale key) —
covered in their own section below.

All settings screens except **Profile** live inside the collapsed **الإعدادات**
sidebar group (`nav-config.ts`'s `settings` group, `defaultCollapsed: true`) — it
must be expanded once per session before any of its 14 items are clickable. Unlike
the reference product, **Profile, API Keys, Webhooks, Audit Log, Users, and Roles
are all present in this same sidebar group** — none of them require the command
palette or a hidden route to reach (a genuine improvement over the reference,
which found Profile/API Keys/Webhooks/Audit only by extracting route strings from
the JS bundle).

## Seed data this document assumes

Per the task brief: 3 API keys (1 revoked), 2 webhooks with real failed-delivery
records, 4 notification rules (1 deactivated), 3 workflow requests (1 pending, 1
approved, 1 rejected), 2 workflow configs, 7 profile activity entries, a populated
audit trail, one system role (`SYSTEM_ADMIN` / منصة كاملة) and exactly **one real
user account** (`USER-ADMIN` — the seed tenant admin, "مدير المنشأة"). Only the
tenant admin login exists in the seed; everything below that assumes a second,
non-admin actor first walks through **PLT-USR-CREATE** to create one — see the
callout in §Approvals Inbox for why this matters.

## Two traps this document exists to keep you from misdiagnosing

1. **The submit-side bypass.** `packages/domain/src/workflow/gate.ts`'s
   `hasAdminRole` special-cases any actor whose roles include `"*"`. The signed-in
   seed account, `USER-ADMIN`, has `isCompanyAdmin: true` → `permissions: ["*"]`.
   Confirming ANY gated action while signed in as this account auto-approves on
   submit — the Approvals Inbox will look permanently empty. This is not broken;
   it is the documented behaviour. A non-admin actor is required to see anything
   land in the inbox as *pending*.

2. **The decide-side bypass — sharper than it looks.** The SAME `hasAdminRole`
   check governs `decide()`. If an admin actor opens the inbox and clicks **رفض**
   (reject) or **طلب تعديل** (request modification) on a request sitting at some
   OTHER role's step, the code path taken is the `admin` branch, which **always**
   records a `"bypass"` decision and grants the request — `input.decision` is
   never even read. Clicking "reject" as an admin does not reject; it approves.
   Only a non-admin actor holding the exact step role can actually reject or
   request modification. See **PLT-APR-08**.

---

## 1 — Global chrome: language switcher

The switcher is `packages/ui/src/shell/Topbar.tsx`'s `LanguageToggle` — a single
globe-style icon button in the topbar that flips between exactly **two** locales
(`ar` ⇄ `en`), not the reference product's three-locale dropdown (Arabic/English/
Deutsch never existed in this build; German is not offered anywhere).

- **PLT-01** — Toggle switches interface language and direction live.
  **Pre**: Signed in, language is Arabic (default), `<html dir="rtl" lang="ar">`.
  **Steps**: Click the language toggle button in the topbar (shows "ع" while
  Arabic is active).
  **Assert**: The button's visible label flips to the English short-code; every
  label on screen (sidebar group names, page titles, button text) re-renders in
  English within the same paint — no page reload; `<html>` now carries
  `dir="ltr" lang="en"`; the whole shell (sidebar rail, cards, tables) mirrors
  left-to-right.

- **PLT-02** — Toggling back restores Arabic/RTL.
  **Pre**: Language is English (from PLT-01).
  **Steps**: Click the language toggle again.
  **Assert**: `<html dir="rtl" lang="ar">` restored; all Arabic labels return
  (e.g. sidebar group "Settings" → "الإعدادات").

- **PLT-03** — Language choice survives a full reload.
  **Pre**: Language switched to English (PLT-01), not yet reloaded.
  **Steps**: Reload the browser tab (full navigation, not SPA re-render).
  **Assert**: On first paint, `<html lang="en" dir="ltr">` — the app does not
  flash Arabic before settling; login/dashboard renders in English immediately.
  Confirms `persistLocale`/`loadPersistedLocale` (`packages/ui/src/i18n/storage.ts`)
  round-trip through `localStorage`, independent of the session/auth cookie.

- **PLT-04** — Every settings screen re-labels itself in English, no missed strings.
  **Pre**: Language = English.
  **Steps**: Open each of the 14 items under Settings in turn (General, Branches,
  Warehouses, Print templates, Notification rules, Data migration, Approval
  settings, Numbering sequences, Barcode settings, Profile, API keys, Webhooks,
  Audit log) plus Users, Roles, and Approvals.
  **Assert**: Every page title, tab label, table column header, button label and
  empty-state string renders in English (`apps/web/src/i18n/catalog.ts`'s `en`
  block) — no residual Arabic string, no raw i18n key (e.g. `"nav.item.xyz"`)
  visible anywhere. A missing English key falls back to Arabic silently and logs
  `console.error("[i18n] missing "en" translation for key "…"")` in dev — check
  devtools console for this while clicking through.

---

## 2 — Global chrome: theme

`packages/ui/src/hooks/useTheme.ts` — a light/dark **toggle** button at the foot
of the sidebar rail (not a 3-way light/dark/system menu in the UI, though the hook
itself supports `"system"`; nothing in the shell exposes it). Default with nothing
stored is **light**, not system-preference.

- **PLT-05** — Toggle flips light → dark.
  **Pre**: Fresh session, no `mezan:theme` in localStorage (or cleared). Theme
  renders light (no `data-theme` attribute needed — see PLT-07).
  **Steps**: Click the theme toggle icon at the bottom of the sidebar rail.
  **Assert**: `<html data-theme="dark">` is set; every settings screen (cards,
  tables, the print-template live preview, the permission matrix) re-paints in
  the dark palette with no visible flash-of-wrong-theme; text stays legible
  (per `docs/defects.md` F2 — a fixed contrast bug now guarded by
  `scripts/check-color-tokens.mjs`, don't re-report a token/contrast mismatch
  without checking that script first).

- **PLT-06** — Toggle flips dark → light.
  **Pre**: Theme is dark (PLT-05).
  **Steps**: Click the toggle again.
  **Assert**: `<html data-theme="light">`.

- **PLT-07** — Theme persists across reload, independent of language.
  **Pre**: Theme = dark, language = English (from PLT-01/PLT-05, not yet reloaded).
  **Steps**: Reload the tab.
  **Assert**: Both preferences restore independently — dark theme AND English
  language on first paint (`localStorage["mezan:theme"] === "dark"`, i18n locale
  key = `"en"` — two separate keys, two separate restores, neither depends on
  the other).

---

## 3 — Global chrome: branch/warehouse scope switchers (sidebar rail)

`packages/ui/src/shell/ScopeSwitcher.tsx` — two native `<select>` elements pinned
above the nav groups (not topbar dropdowns as in the reference product). Branch
narrows warehouse options; warehouse selection persists via
`loadPersistedScopeSelection`/`useApi`'s `scopeSelection` state.

- **PLT-08** — Branch selector renders nothing when the tenant has no branch options.
  **Pre**: A session whose `branchOptions` (from `useScopeSelector`) is empty.
  **Assert**: `ScopeSwitchers` returns `null` — no empty/greyed selector shown;
  confirms the component's explicit "never render a fabricated list" contract.

- **PLT-09** — Selecting a branch narrows the warehouse selector.
  **Pre**: At least 2 branches, each with its own warehouse(s) — e.g. seed's
  الفرع الرئيسي (with `WH-MAIN` + `VAN`) plus a second branch created in
  **PLT-BRN-03**.
  **Steps**: Open the branch `<select>`; choose the second branch.
  **Assert**: The warehouse `<select>`'s option list re-renders to only that
  branch's warehouses (`w.branchId === scopeSelection.branchId` filter in
  `useScopeSelector`); if the previously-selected warehouse doesn't belong to the
  new branch, the warehouse selection silently clears to "كل المستودعات" (all
  warehouses) rather than staying stale.

- **PLT-10** — Scope selection persists across reload.
  **Pre**: Branch + warehouse both narrowed to a specific selection (not "all").
  **Steps**: Reload the tab.
  **Assert**: Both selects show the same narrowed selection after reload — the
  choice round-trips through the same persisted-state mechanism as
  session/scope, independent of theme and language.

- **PLT-11** — A user scoped to specific branches only sees those branches.
  **Pre**: A non-admin user (see **PLT-USR-CREATE**) whose `branchScope` is a
  specific branch list, not `ALL_SCOPE`. Log in as that user.
  **Assert**: The branch `<select>` only lists branches in `session.branchScope`
  (`allowedBranchIds` filter in `useScopeSelector`) — a branch the user isn't
  scoped to never appears as an option, even though it exists tenant-wide.

---

## 4 — General settings (`الإعدادات ← عام`)

`SettingsGeneral.tsx` — **4 tabs**, not the reference product's 10. Confirmed
**[NOT IMPLEMENTED]** relative to the reference: a standalone **البريد الإلكتروني /
Email-SMTP tab** (no SMTP host/port/sender fields, no email-template HTML editor,
no "send test email" anywhere in this build — `grep` across the whole repo for
`smtp`/`SMTP`/email-template strings returns nothing outside this note), and
standalone **نقطة البيع والولاء / POS & loyalty** and **طرق الدفع / POS payment
methods** tabs. This build folds the reference's separate Credit-control /
Inventory-policy / Purchase-control / Treasury-policy tabs into ONE **السياسات**
tab instead of four.

- **PLT-12** — Save button is disabled until a field is dirtied.
  **Pre**: Navigate to الإعدادات (Settings expanded → عام). "حفظ الإعدادات" button
  visible.
  **Assert**: Button is disabled on load (`disabled={!dirty}`); no status pill.

- **PLT-13** — Editing any field enables Save and shows the unsaved-changes pill.
  **Steps**: On the عام tab, change العملة الافتراضية (default currency) text field.
  **Assert**: "حفظ الإعدادات" becomes enabled; a "تغييرات غير محفوظة" (unsaved
  changes) warning-tone status pill appears next to the title.

- **PLT-14** — عام tab: language select changes the app UI language on save.
  **Steps**: Change "اللغة الافتراضية" to English; click "حفظ الإعدادات".
  **Assert**: On success the mutation's `onSuccess` calls `setLocale(saved.language)`
  — the WHOLE app flips to English immediately (same effect as the topbar toggle,
  §1), not just the stored tenant default. `dirty` resets to false and the
  warning pill disappears.

- **PLT-15** — عام tab: additional-currencies multi-chip picker.
  **Steps**: Open العملات الإضافية; select 2–3 of the 7 offered currencies
  (SAR/USD/AED/EUR/KWD/QAR/JOD — the reference's list additionally offered
  AED/QAR/KWD/BHD/OMR/JOD/USD/EUR/GBP against a 10-item tenant array; this
  build's picker is hardcoded to exactly these 7, so BHD/OMR/GBP are
  **[NOT IMPLEMENTED]** as selectable secondary currencies here even though the
  tenant payload could in principle carry them).
  **Assert**: Selected currencies render as active chips; Save persists them.

- **PLT-16** — عام tab: fiscal year start month, weekend days, numeral system,
  date format, timezone, FX-missing policy — every remaining field on the tab.
  **Steps**: Change each field once (fiscal start month 1→4, weekend days,
  Western↔Arabic numerals, direction RTL↔LTR, FX policy STRICT↔ALLOW_MISSING).
  **Assert**: Each change dirties the form; Save round-trips every value; a
  reopen of the settings screen shows the saved values (re-fetch from `/settings`).

- **PLT-17** — بيانات المنشأة tab: company profile + shared HR policy constants.
  **Steps**: Edit اسم المنشأة, الرقم الضريبي, السجل التجاري, الهاتف, البريد
  الإلكتروني, العنوان; edit weekend days (duplicated control — also present on
  this tab, independently wired to the same `weekendDays` field as the عام tab);
  edit فترة التنبيه على انتهاء العقد (7–365 day range hint), معامل العمل الإضافي
  (step 0.1), ساعات العمل اليومية القياسية.
  **Assert**: All save together under one "حفظ الإعدادات"; no separate save
  button per tab (differs from the reference, where each tab persisted
  independently within one page-level save — same here, single save covers all
  4 tabs' draft state at once).
  **Note**: no logo upload control on this tab in this build — **[NOT
  IMPLEMENTED]** (`شعار الشركة` file dropzone from the reference is absent).

- **PLT-18** — الضريبة tab: VAT toggle, default rate, calculation mode,
  depreciation proration, tax registration number.
  **Steps**: Toggle "تفعيل ضريبة القيمة المضافة" off; observe نسبة الضريبة
  الافتراضية field stays visible/editable regardless (no conditional hide);
  toggle back on; change طريقة حساب الضريبة between "غير شاملة" (exclusive) and
  "شاملة" (inclusive); change إهلاك شهر الاقتناء between "يومي — IFRS" and "شهر
  كامل".
  **Assert**: All four persist on save. **Note**: no info-callout deep link to
  `/accounting/taxes` for multi-rate management on this build's tax tab (present
  in the reference) — minor **[NOT IMPLEMENTED]**, not blocking.

- **PLT-19** — السياسات tab: credit control block.
  **Steps**: Toggle "تفعيل قوائم الأسعار" and "تفعيل الرقابة الائتمانية"; change
  وضع الرقابة between "تحذير فقط (WARNING)" and "منع تام (BLOCK)".
  **Assert**: Persists on save; matches `TenantSettingsDTO.creditControlMode`.

- **PLT-20** — السياسات tab: inventory-policy block.
  **Steps**: Toggle كل من — السماح بالبيع من مستودع آخر, عرض المخزون في
  المستودعات الأخرى, السماح بالطلبات المؤجلة, السماح بالمخزون السالب.
  **Assert**: All four persist. **Note**: the reference's aging-based
  write-down toggle (posting to GL 5060/1190) and auto-batch-number toggle are
  **[NOT IMPLEMENTED]** on this tab in this build — not present in
  `SettingsGeneral.tsx`'s policies section at all.

- **PLT-21** — السياسات tab: purchase-control 3-gate block.
  **Steps**: Toggle يجب وجود أمر شراء قبل استلام البضاعة, يجب وجود استلام بضاعة
  قبل فاتورة الشراء, تتبع البضاعة المستهلكة من فواتير الشراء.
  **Assert**: All three persist.

- **PLT-22** — السياسات tab: treasury-policy block.
  **Steps**: Toggle منع الرصيد السالب للحسابات النقدية (hint text explicitly
  states it applies to cash accounts only, bank accounts exempt) and السماح
  بالرصيد السالب للحسابات البنكية.
  **Assert**: Both persist; two separate booleans in this build
  (`preventNegativeCashBalance`, `allowNegativeTreasury`) rather than the
  reference's single toggle-with-hint-text — an actual second control, not
  just explanatory copy.

- **PLT-23** — Error path: save fails server-side.
  **Steps**: Dirty a field with a value the server rejects (e.g. an invalid
  `dateNumerals` enum sent by tampering the request, or trigger any 422 from
  `/settings`).
  **Assert**: A danger-tone `StatusPill` renders the server's error message
  next to the Save button; the draft is NOT cleared, `dirty` stays true so the
  user can retry without re-entering everything.

- **PLT-24 [NOT IMPLEMENTED]** — Multi-currency toggle as a platform-admin-only,
  read-only "نشط" badge.
  The reference shows تفعيل العملات المتعددة as a read-only badge with "تدار
  هذه الميزة من قبل مدير المنصة" (managed by the platform admin). This build's
  عام tab has no such field at all — multi-currency is implied only by the
  presence of the secondary-currency picker (PLT-15), with no explicit
  enabled/disabled indicator or platform-admin-only messaging anywhere in the
  UI.

---

## 5 — Branches (`الإعدادات ← الفروع`)

`BranchesPage.tsx` — list + a genuinely rich "Branch 360" detail with 5 tabs, not
just a CRUD form. Matches the reference's finding closely.

- **PLT-BRN-01** — List: stats and default state.
  **Pre**: Navigate to الفروع.
  **Assert**: Stat cards read إجمالي الفروع (1 in fresh seed), الفرع الرئيسي (1),
  نشط (1); table shows one row — الفرع الرئيسي / `MAIN`, "—" in الفرع الرئيسي
  (parent) column since it IS the main branch, "نشط" status pill.

- **PLT-BRN-02** — Search filters by name or code.
  **Steps**: Type "MAIN" into the search box; then type a non-matching string.
  **Assert**: First search still shows the row (code match, case-insensitive);
  second search yields the "لا توجد فروع مطابقة" empty state.

- **PLT-BRN-03** — Add branch — happy path.
  **Steps**: Click "إضافة فرع"; fill اسم الفرع = "فرع الإسكندرية", رمز الفرع =
  "ALEX", الهاتف, البريد الإلكتروني, العنوان; leave "فرع رئيسي" toggle off;
  click "حفظ الفرع".
  **Assert**: Panel closes; new row appears in the list; إجمالي الفروع stat
  becomes 2; الفرع الرئيسي stat count stays 1 (this branch isn't main).

- **PLT-BRN-04** — Add branch — no client-side required-field validation.
  **Steps**: Click "إضافة فرع"; leave اسم الفرع and رمز الفرع both empty; click
  "حفظ الفرع".
  **Assert**: The form has NO asterisks and no pre-submit check (`submitNewBranch`
  calls the mutation directly) — the request reaches the server, which rejects
  it via `packages/domain/src/settings/branch.ts`'s `validate()`. The error
  surfaces as a danger `StatusPill` reading the domain's raw message in
  **English**: `"name is required"` (and/or `"code must be 1-20 uppercase
  alphanumeric/-/_ characters"`) — a genuine English string leaking into an
  otherwise fully-Arabic form. Panel stays open, entered data is preserved.

- **PLT-BRN-05** — Add branch — duplicate/invalid code shape.
  **Steps**: Enter a code with lowercase letters or a space, e.g. "alex branch".
  **Assert**: Rejected server-side with the same English "code must be 1-20
  uppercase alphanumeric/-/_ characters" message (the field auto-uppercases on
  submit via `form.code.toUpperCase()`, but spaces/symbols still fail the regex).

- **PLT-BRN-06** — Branch detail — Overview tab.
  **Steps**: Click the الفرع الرئيسي row.
  **Assert**: Header shows branch name + code, نشط status pill, "الفرع الرئيسي"
  subtitle badge; summary strip shows كود الفرع, الهاتف, البريد الإلكتروني,
  العنوان (each "لا توجد" if unset), المستودعات count, الحالة. Overview tab body
  shows 8 KPI tiles (مبيعات الفرع, مشتريات الفرع, صافي حركة السندات, قيمة
  المخزون, حسابات الخزينة, الموظفون, الأصول الثابتة, حالة الفرع) plus a حسابات
  الخزينة table listing every treasury account whose `branchId` matches.

- **PLT-BRN-07** — Branch detail — Inventory tab, populated.
  **Pre**: The branch has at least one warehouse with stock on hand.
  **Steps**: Open المخزون tab.
  **Assert**: Table lists every item on hand across the branch's warehouses
  (merged, not per-warehouse), sorted by value descending; KPI row shows عدد
  الأصناف / عدد المستودعات / إجمالي قيمة المخزون.

- **PLT-BRN-08** — Branch detail — Inventory tab, empty state: no warehouses.
  **Pre**: A newly-created branch (PLT-BRN-03) with zero warehouses attached.
  **Steps**: Open its المخزون tab.
  **Assert**: "لا توجد مستودعات مرتبطة بهذا الفرع" empty state with guidance to
  link a warehouse from the المستودعات screen — no crash, no blank table.

- **PLT-BRN-09** — Branch detail — Employees tab, empty state.
  **Pre**: A branch with zero employees assigned.
  **Assert**: "لا يوجد موظفون مسجّلون على هذا الفرع" empty state.

- **PLT-BRN-10** — Branch detail — Assets tab, empty state vs. populated.
  **Pre A**: Branch with zero assets. **Pre B**: Branch (or the main branch) with
  at least one fixed asset registered against it.
  **Assert A**: "لا توجد أصول ثابتة مسجّلة على هذا الفرع" — note the empty-state
  copy explicitly clarifies company-level assets (no `branchId`) do NOT show
  here even though they exist. **Assert B**: Table lists code/name/category/
  acquisition date/cost/accumulated depreciation/net book value/status, plus 3
  summary KPIs (عدد الأصول, إجمالي التكلفة, صافي القيمة الدفترية).

- **PLT-BRN-11** — Branch detail — Activity tab: documents, not the audit trail.
  **Steps**: Open النشاط tab on a branch with at least one confirmed sales
  invoice, purchase invoice, or voucher.
  **Assert**: Rows list the branch's own confirmed/posted documents (sales
  invoices, purchase invoices, cash vouchers/receipts/transfers), newest first,
  with a footer note explicitly stating the audit trail carries no branch
  dimension and cannot be scoped here — direct the user to سجل المراجعة
  (Audit Log) instead for that view. Confirms this tab is document-derived, not
  audit-derived — do not confuse it with the Audit Log's branch filter (§18).

- **PLT-BRN-12** — Branch detail — Activity tab, empty state.
  **Pre**: A branch with zero documents.
  **Assert**: "لا توجد حركة مسجّلة على هذا الفرع".

- **PLT-BRN-13** — "رجوع لقائمة الفروع" returns to the list.
  **Steps**: From any branch detail tab, click the back button in the header.
  **Assert**: Returns to the branches list, scroll position/filter state reset
  (component unmounts fully — `selectedId` clears).

- **PLT-BRN-14 [NOT IMPLEMENTED]** — Branch edit / deactivate.
  The reference documents "إضافة فرع" only and defers CRUD depth; this build
  goes further with the full Branch 360 view but still has **no edit form and
  no deactivate action anywhere in the UI** — `BranchesPage.tsx` exposes create
  only (`useCreateBranch`); there is no `useUpdateBranch`/`useDeactivateBranch`
  hook, no edit button on the list row, and no status-toggle control on the
  detail header, even though the domain layer's `admin.branches.edit` /
  `.deactivate` permissions exist in the matrix (§8's catalog). Once a branch is
  created, its name/code/phone/email/address/status cannot be changed from the
  UI.

---

## 6 — Warehouses (`الإعدادات ← المستودعات`)

`WarehousesPage.tsx`.

- **PLT-WH-01** — List: stats and default state.
  **Assert**: إجمالي المستودعات (2 in the fresh seed: `WH-MAIN`, `VAN`), نشط (2),
  إجمالي الفروع (1, distinct `branchId`s). Table shows both rows with type pills
  (رئيسي for `WH-MAIN`, ڤان (سيارة توزيع) for `VAN`) and افتراضي marked on
  `WH-MAIN` only.

- **PLT-WH-02** — Type filter chips.
  **Steps**: Click each of the 6 chips in turn: كل الأنواع, رئيسي, مستودع وسيط,
  مرتجعات, إنتاج, ڤان (سيارة توزيع) — all 5 catalog warehouse types plus "all".
  **Assert**: Only warehouses of the selected type remain in the table; the
  transit/returns/production chips show an empty "لا توجد مستودعات مطابقة" state
  in the fresh seed (no warehouse of those types exists yet).

- **PLT-WH-03** — Search filters by name or code, combined with the type chip.
  **Steps**: With "رئيسي" chip active, search "VAN".
  **Assert**: Empty state — the VAN warehouse is type ڤان, filtered out by the
  active type chip regardless of the search match; confirms the two filters
  AND together (`typeFilter` then `search`, sequential `.filter()` in
  `WarehousesPage.tsx`).

- **PLT-WH-04** — Add warehouse — happy path.
  **Steps**: Click "إضافة مستودع"; اسم المستودع = "مستودع الإسكندرية", رمز
  المستودع = "WH-ALEX", اسم الفرع = (any branch — defaults to the first branch
  once branches load), نوع المستودع = "مستودع وسيط" (transit), leave "مستودع
  افتراضي للفرع" off; save.
  **Assert**: Row appears; type pill reads "مستودع وسيط"; إجمالي المستودعات → 3.

- **PLT-WH-05** — Add warehouse — no client-side required-field validation
  (same pattern as PLT-BRN-04): submitting with empty name/code sends straight
  to the server; failure surfaces as a danger `StatusPill` with the server's
  message; panel stays open with entered values intact.

- **PLT-WH-06 [NOT IMPLEMENTED]** — Warehouse edit / deactivate / branch filter.
  This screen has no edit action, no deactivate action, and — unlike the
  reference, which documented a "باسم الفرع" branch filter alongside the type
  filter — **no branch filter at all** here; only free-text search and the type
  chips. A multi-branch tenant with many warehouses per branch has no way to
  narrow the list to one branch's warehouses from this screen (the branch
  column is sortable/visible, not filterable).

---

## 7 — Users (`الإعدادات ← المستخدمون`)

`UsersPage.tsx` (`apps/web/src/pages/UsersPage.tsx`).

- **PLT-USR-01** — List: stats and default state.
  **Pre**: Fresh seed (1 real user, `USER-ADMIN`).
  **Assert**: إجمالي المستخدمين = 1, مستخدمون نشطون = 1, الأدوار المستخدمة = 1
  (counts distinct `roleId` OR `"__admin__"` sentinel for company-admin rows),
  غير نشط = 0. Row shows avatar initials, full name + email stacked, "مدير
  المنشأة" info-tone role pill (since `isCompanyAdmin: true`), "كل الفروع"
  branches cell (`ALL_SCOPE`), last login timestamp or "لم يسجل بعد", "نشط"
  status pill.

- **PLT-USR-CREATE** — Add user — the setup every non-admin scenario in this
  document depends on.
  **Pre**: At least one custom (non-system) role exists — create one first via
  **PLT-ROL-03** (e.g. code `SUPERVISOR`, holding `workflow.view` +
  `workflow.approve` + `workflow.reject`, matching the seeded
  `SALES_INVOICE_CONFIRM` workflow config's step role — see §16/§17).
  **Steps**: Click "إضافة مستخدم"; fill الاسم الكامل, البريد الإلكتروني, كلمة
  مرور مؤقتة (≥8 chars, hint shown inline); leave رمز PIN empty; leave "صلاحيات
  مدير المنشأة" UNCHECKED; pick الدور = SUPERVISOR from the `EntityPicker`;
  optionally link الموظف المرتبط; check at least one branch under الفروع
  المتاحة (required — the only field this form structurally requires by
  disabling nothing, but the checkbox group is visually marked required);
  click "حفظ المستخدم".
  **Assert**: New row appears with role pill "SUPERVISOR"'s role name (not
  "مدير المنشأة"); إجمالي المستخدمين increments; the new login can now be used
  for every "non-admin actor" precondition below.

- **PLT-USR-02** — Add user — company-admin toggle hides the role picker.
  **Steps**: Open "إضافة مستخدم"; check "صلاحيات مدير المنشأة".
  **Assert**: The الدور `EntityPicker` disappears entirely from the form
  (conditional render, not just disabled) and `roleId` resets to `null` in the
  draft — confirms company-admin and role assignment are mutually exclusive at
  the form level, matching the domain model (`isCompanyAdmin` bypasses the
  granular role/permission system entirely).

- **PLT-USR-03** — Edit user — password field becomes optional.
  **Steps**: Click an existing user row (e.g. `USER-ADMIN` or the user from
  PLT-USR-CREATE); observe the password field's label.
  **Assert**: Label reads "كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)"
  (new password — leave blank to keep the current one) instead of the create
  form's "كلمة مرور مؤقتة * (٨ أحرف على الأقل)" — same input, different
  required-ness communicated only through copy (no visual required marker
  changes). Saving with it blank must not clear/reset the existing password.

- **PLT-USR-04** — Edit user — branch/warehouse scope round-trips `ALL_SCOPE`.
  **Steps**: Open `USER-ADMIN`'s edit panel.
  **Assert**: Every branch checkbox is pre-checked (`scopeToIds` maps
  `ALL_SCOPE` → all known branch ids) — confirms the form doesn't distinguish
  "all branches" from "happens to have every branch checked" on the way in; on
  save without touching the checkboxes, the user's scope should remain
  effectively "all" (re-derived from the full-checked state, not literally
  preserved as `ALL_SCOPE` — worth watching for drift if a branch is added
  later without this user's checkbox state being revisited).

- **PLT-USR-05** — Toggle status — activate/deactivate from the row action.
  **Steps**: Click "تعطيل" on an active, non-self user row (create a second
  user first if only `USER-ADMIN` exists, since deactivating your own only
  login would be self-locking — the UI does not prevent this, see PLT-USR-06).
  **Assert**: Row's status pill flips to "غير نشط"; button label flips to
  "تفعيل"; غير نشط stat count increments; the click uses `e.stopPropagation()`
  so it does NOT also open the edit panel.

- **PLT-USR-06 [gap]** — No self-deactivation guard.
  **Steps**: While signed in as `USER-ADMIN` (the only real account before
  PLT-USR-CREATE), click "تعطيل" on `USER-ADMIN`'s own row.
  **Assert**: The UI has no client-side guard against this — `onToggleStatus`
  fires unconditionally. Whether the server itself refuses to deactivate the
  last active admin is a backend contract worth confirming; this is a genuine
  risk to flag rather than assume covered, since disabling the seed's only real
  login would strand the demo tenant. **Do not actually execute this against
  a shared demo tenant** — note the risk, don't detonate it.

- **PLT-USR-07** — Status filter chips.
  **Steps**: Click نشط, then غير نشط, then الكل.
  **Assert**: Table narrows to matching status each time; chip counts match the
  stat cards.

- **PLT-USR-08** — Search filters by name or email (case-insensitive).
  **Steps**: Search a fragment of `USER-ADMIN`'s email in mixed case.
  **Assert**: Row matches regardless of case (`.toLowerCase()` on both sides).

- **PLT-USR-09 [NOT IMPLEMENTED]** — Advanced filter panel.
  The reference documents a "تصفية النتائج" panel with الدور (role), الفروع
  المتاحة (available branches), and آخر دخول من/إلى (last-login date range)
  filters, beyond the basic search+status chips. None of that exists in this
  build — `UsersPage.tsx` has only the search box and the 3 status chips; there
  is no way to filter the user list by role or by last-login window.

---

## 8 — Roles & permissions (`الإعدادات ← الأدوار والصلاحيات`)

`RolesPage.tsx` + `RoleEditorPage.tsx`. The permission matrix here is licensed:
`licensedModules`/`licensedPermissions` filter the ~268-permission catalog down to
what the tenant's `activeModules`/`features` actually license — an unlicensed
module's permissions never render as options at all (a stronger, more correct
gate than merely hiding them post-render).

- **PLT-ROL-01** — List: stats and default state.
  **Pre**: Fresh seed — only the system role exists.
  **Assert**: إجمالي الأدوار = 1, أدوار مخصصة = 0, أدوار النظام = 1, إجمالي
  الصلاحيات الممنوحة = 1 (`SYSTEM_ADMIN`'s single `"*"` entry counted as 1, not
  268 — worth noting the stat is a raw array length, not an expanded count).
  Row shows اسم الدور = "مدير النظام", الكود = `SYSTEM_ADMIN`, عدد الصلاحيات = 1,
  "نظام" info-tone pill, creation date.

- **PLT-ROL-02** — Type filter chips + search.
  **Steps**: Click نظام, مخصص, الكل chips; search by role name/code fragment.
  **Assert**: Filters narrow correctly; chip counts match stat cards.

- **PLT-ROL-03** — Create a custom role — happy path.
  **Steps**: Click "دور جديد"; enter اسم الدور = "مشرف", رمز الدور = "SUPERVISOR"
  (auto-uppercases as typed), وصف الدور optional; in the permission matrix,
  search "موافق" and check `workflow.view`, `workflow.approve`,
  `workflow.reject`; click "حفظ الدور".
  **Assert**: Returns to the roles list; new row "مشرف" / `SUPERVISOR`, "مخصص"
  tone pill, عدد الصلاحيات = 3 (or more if dependencies pulled in others — see
  PLT-ROL-06). أدوار مخصصة stat increments.

- **PLT-ROL-04** — Create role — required-field validation.
  **Steps**: Click "دور جديد"; leave both name and code empty; click "حفظ الدور".
  **Assert**: Danger banner "اسم الدور ورمزه مطلوبان" (role name and code are
  required); no navigation away, no request sent (client-side guard here,
  unlike Branches/Warehouses/Users' server-only validation).

- **PLT-ROL-05** — Edit an existing custom role — code is immutable.
  **Steps**: Click "تعديل" on the "مشرف" row (from PLT-ROL-03).
  **Assert**: رمز الدور input is `disabled` (role !== null → `disabled` prop
  true); name/description/matrix remain editable.

- **PLT-ROL-06** — Permission matrix — checking a permission auto-selects its
  dependencies.
  **Steps**: In the "مشرف" role editor, uncheck everything; check
  `sales.invoice.confirm` alone.
  **Assert**: `sales.invoice.view_own` (its declared dependency) becomes
  checked automatically (`togglePermission`'s dependency-closure walk over
  `resolvePermissions`); الصلاحيات المحددة summary count reflects both, not
  just 1.

- **PLT-ROL-07** — Permission matrix — unchecking a dependency cascades to
  dependents.
  **Steps**: With `sales.invoice.confirm` + `sales.invoice.view_own` both
  checked (PLT-ROL-06), uncheck `sales.invoice.view_own`.
  **Assert**: `sales.invoice.confirm` is automatically unchecked too (the
  cascading "anything left selected that depends on a now-removed code must go
  too" loop in `togglePermission`) — a permission is never left selected
  without its prerequisite.

- **PLT-ROL-08** — Permission matrix — module "select all" checkbox.
  **Steps**: Click the header checkbox (aria-label "تحديد الكل — <module>") on
  a fully-licensed module, e.g. لوحة التحكم (Dashboard, 2 permissions).
  **Assert**: Both `dashboard.view` and `dashboard.export` become checked in
  one click (dependency-closed via `toggleAll`); clicking it again with both
  checked deselects both.

- **PLT-ROL-09** — Permission matrix — platform-admin-only permissions are
  visibly disabled, not just unselectable.
  **Steps**: Search the matrix for `admin.tenant.settings.edit` or
  `admin.modules.manage`.
  **Assert**: The permission card is rendered `disabled`, with `title`/hover
  text "صلاحية مخصصة لمدير المنصة فقط" (platform-admin-only); clicking it does
  nothing; the module "select all" checkbox does NOT include it when selecting
  the whole module (`isPlatformAdminOnly` filtered out of `handleToggleModule`'s
  `selectableCodes`).

- **PLT-ROL-10** — Permission matrix — sensitive permissions carry a visible
  warning marker.
  **Steps**: Search for `sales.invoice.view_cost` (cost-price visibility) or
  `pos.delivery.cancel` (reverses a money movement).
  **Assert**: A "صلاحية حساسة" (sensitive permission) marker renders on the
  card with a warning-tone ring; the role editor's حساسة summary stat counts
  it once selected.

- **PLT-ROL-11** — Permission matrix — search narrows across modules.
  **Steps**: Type "فاتورة" (invoice) into the matrix search box.
  **Assert**: Only permission cards whose Arabic label matches remain visible,
  spanning sales/purchases modules simultaneously — confirms search isn't
  scoped to one expanded module.

- **PLT-ROL-12** — Delete a role that's in use — blocked.
  **Pre**: The "مشرف"/`SUPERVISOR` role has at least one user assigned
  (PLT-USR-CREATE).
  **Steps**: Attempt to click "حذف" on that role's row.
  **Assert**: The delete button itself is `disabled`, with `title` "الدور
  مستخدم من قبل مستخدمين" (role is in use by users) — the guard is client-side
  and pre-emptive, not a failed-request-then-error round trip.

- **PLT-ROL-13** — Delete an unused custom role — happy path.
  **Pre**: A second custom role with zero users assigned.
  **Steps**: Click "حذف"; confirm (no modal in this UI — the click deletes
  directly via `onDelete`).
  **Assert**: Row disappears; أدوار مخصصة stat decrements; a delete error (if
  the server independently refuses) surfaces as a danger banner in
  `filterBarExtra`, not a silent failure.

- **PLT-ROL-14** — System role — every field is locked.
  **Steps**: Click "تعديل" on the "مدير النظام" / `SYSTEM_ADMIN` system row.
  **Assert**: Name, code, description inputs all `disabled`; "حفظ الدور" is
  disabled (`disabled={saving || role?.isSystem}`); the permission matrix
  still RENDERS (read view) but the role's `"*"` grant can't be edited through
  it in any meaningful way; there is also no "حذف" button for this row on the
  list at all (system roles never render a delete action — `RolesPage.tsx`
  only renders it `{!row.isSystem ? ... : null}`).

- **PLT-ROL-15 [RBAC]** — A user without `admin.roles.view` cannot reach this
  screen.
  **Pre**: Sign in as a non-admin user whose role holds no `admin.roles.*`
  permission (e.g. the `SUPERVISOR` user from PLT-USR-CREATE, unmodified).
  **Steps**: Expand الإعدادات; click "الأدوار والصلاحيات".
  **Assert**: The sidebar item is NOT hidden and NOT disabled — this build has
  **no client-side nav gating at all** (`nav-config.ts` renders every item for
  every session regardless of permissions). The screen mounts its shell, but
  the underlying `useRoles()` query returns 403 from `gate("admin.roles.view")`
  in `roles-routes.ts`; the component's `query.isError` branch shows a danger
  card "تعذّر تحميل ..." with a "إعادة المحاولة" retry button instead of any
  role data — enforcement is server-only, surfaced as a load failure, not as
  a hidden or greyed-out nav entry. This is the general pattern for every
  `admin.*`/`workflow.*`/`notifications.rule.*`/`audit.logs.view`-gated screen
  in this document; it is called out once here in full and referenced by ID
  elsewhere rather than repeated per screen.

---

## 9 — API Keys (`الإعدادات ← مفاتيح API`)

`ApiKeysPage.tsx`. Diverges from the reference in two structural ways worth
testing explicitly: this build's scope picker is the **full** ~268-permission
matrix (with platform-admin-only entries visibly disabled), not a `.view`-suffixed
38-scope subset; and there is **no rate-limit field** and **no Connected Apps /
OAuth third-party grants table** anywhere on this screen.

- **PLT-API-01** — List: seeded 3 keys, one revoked.
  **Pre**: Demo seed (`packages/backend/src/demo-seed/platform.ts`).
  **Assert**: Table shows 3 rows — "تكامل المتجر الإلكتروني" (scopes
  `sales.invoice.view`+`.create`, "نشط" success pill), "لوحة التقارير المالية
  الخارجية" (scopes `accounting.coa.view`+`accounting.journal.view`, "نشط"),
  "مفتاح تكامل قديم" (scope `inventory.item.view`, "ملغى" neutral pill). إجمالي
  المفاتيح = 3, نشطة = 2, ملغاة = 1.

- **PLT-API-02** — Revoked key hides the revoke action.
  **Steps**: Locate "مفتاح تكامل قديم"'s row.
  **Assert**: No "إلغاء" button renders in its actions cell (`k.revokedAt ?
  null : <Button>` — the button is entirely absent, not disabled) — confirms a
  key can't be double-revoked from the UI.

- **PLT-API-03** — Create a key — full flow, reveal-once secret.
  **Steps**: Click "مفتاح جديد"; enter الاسم = "اختبار"; in the permission
  matrix check `inventory.item.view` and `inventory.stock.view`; click "إنشاء
  المفتاح".
  **Assert**: Panel closes; a warning-tone banner appears above the list:
  "تم إنشاء المفتاح "اختبار" — انسخه الآن، لن يُعرض مرة أخرى" with the full
  plaintext key in a `<code>` block and a "نسخ" copy button (label flips to
  "تم النسخ" after a successful `navigator.clipboard.writeText`); new row
  appears in the table showing only `k.prefix…` (masked), never the full key
  again — reload or reopen the screen and the plaintext is genuinely gone,
  only the prefix persists.

- **PLT-API-04** — Create a key — validation.
  **Steps A**: Leave الاسم empty, select at least one scope, submit.
  **Assert A**: Danger pill "اسم المفتاح مطلوب".
  **Steps B**: Enter a name, select zero scopes, submit.
  **Assert B**: Danger pill "اختر صلاحية واحدة على الأقل" (choose at least one
  permission).

- **PLT-API-05** — Create a key — platform-admin-only scopes are disabled in
  the picker, same as the role editor (§8's PLT-ROL-09).
  **Steps**: Search the create-key matrix for `admin.tenant.settings.edit`.
  **Assert**: Card renders disabled with the identical "صلاحية مخصصة لمدير
  المنصة فقط" reason — confirms the SAME `buildScopeModules`/`isPlatformAdminOnly`
  guard is reused here, not a separately-maintained (and possibly drifted) copy.

- **PLT-API-06** — Revoke an active key.
  **Steps**: Click "إلغاء" on "تكامل المتجر الإلكتروني"; observe the button
  shows "جارٍ الإلغاء…" while pending.
  **Assert**: Row's status pill flips to "ملغى"; its "إلغاء" action disappears
  (PLT-API-02's rule applies immediately); نشطة/ملغاة stat counts update.

- **PLT-API-07** — Search filters by name or key prefix.
  **Steps**: Search "قديم" (old); then search a fragment of a known key prefix.
  **Assert**: Both match — search checks `k.name.includes` OR `k.prefix.includes`.

- **PLT-API-08 [NOT IMPLEMENTED]** — Rate limit and Connected Apps.
  Neither the create-key form nor the list has a حد الطلبات (في الدقيقة) /
  rate-limit-per-minute field (present in the reference), and there is no
  second "التطبيقات المرتبطة" (Connected Apps) table anywhere on this screen —
  the reference's OAuth-style third-party-app-authorization story (which
  explicitly namechecked Claude as an example integration) does not exist in
  this build at all. Do not spend time hunting for a disconnect button; it was
  never built.

---

## 10 — Webhooks (`الإعدادات ← الويب هوك`)

`WebhooksPage.tsx`. This is the section with the most load-bearing, precisely
verifiable backend behaviour in the whole document — every assertion below is
checked against `packages/domain/src/webhooks/dispatcher.ts` and the exact
seed data in `packages/backend/src/demo-seed/platform.ts`.

- **PLT-WHK-01** — Event picker offers only what this build actually emits.
  **Steps**: Click "ويب هوك جديد"; open the events checklist.
  **Assert**: Exactly **5 events** are offered, across 2 categories — Sales:
  `SALES_INVOICE_CONFIRMED` (تم تأكيد فاتورة مبيعات), `SALES_INVOICE_VOIDED`
  (تم إلغاء فاتورة مبيعات), `SALES_RETURN_CONFIRMED` (تم تأكيد مردود مبيعات);
  Purchases: `PURCHASE_RETURN_CONFIRMED` (تم تأكيد مردود مشتريات),
  `PURCHASE_RETURN_VOIDED` (تم إلغاء مردود مشتريات). The other 34 codes in the
  39-event catalog (`DOMAIN_EVENT_CATALOG`) — every workflow/treasury/
  installments/cheques/POS/inventory/manufacturing/platform event except those
  5 — are absent from this picker entirely, not shown-and-disabled. This
  reflects `GET /webhooks/events`' live-narrowed response
  (`emittedEventCodes` wired in `create-backend.ts` from the sales-invoice and
  returns document-event bridges only).

- **PLT-WHK-02** — Subscribing to a non-deliverable event is rejected with
  `INVALID_WEBHOOK` — confirm the server refuses even if the client were
  bypassed.
  **Steps**: Using devtools or an API client, `POST /webhooks` with
  `events: ["CHEQUE_BOUNCED"]` (a real catalog code, just not deliverable).
  **Assert**: `422` with `{ error: "INVALID_WEBHOOK", reasons: [...] }`
  (`InvalidWebhookError`, thrown by `registerWebhook`'s event-policy check).
  The UI itself can never construct this request since the picker doesn't
  offer the code — this scenario proves the guard isn't merely cosmetic.

- **PLT-WHK-03** — List: seeded 2 webhooks.
  **Pre**: Demo seed.
  **Assert**: Table shows "تكامل نظام نقطة البيع الخارجي" (target
  `http://127.0.0.1:39217/hooks/mezan`, 3 events, "مفعّل" success pill) and
  "تكامل النظام المحاسبي القديم" (target `http://127.0.0.1:39218/legacy/
  receiver`, 2 events, "معطّل" neutral pill — created active then immediately
  PATCHed to `active: false` by the seed). إجمالي الويب هوك = 2, مفعّلة = 1.

- **PLT-WHK-04** — Create a webhook — reveal-once HMAC secret.
  **Steps**: Click "ويب هوك جديد"; الاسم = "اختبار", رابط الوجهة =
  `https://example.com/hooks/test`; check `SALES_INVOICE_CONFIRMED`; click
  "إنشاء الويب هوك".
  **Assert**: A warning banner shows the full `whsec_...` secret once, with
  copy/dismiss, identical UX pattern to the API key reveal (PLT-API-03); the
  new row's detail view never shows the secret again — only its subscribed
  events and delivery attempts.

- **PLT-WHK-05** — Create a webhook — validation (name, URL, ≥1 event, each
  independently).
  **Assert**: "اسم الويب هوك مطلوب" / "رابط الوجهة مطلوب" / "اختر حدثًا واحدًا
  على الأقل" fire in the order name→url→events, matching the three sequential
  `if` guards in `submitNewWebhook`.

- **PLT-WHK-06** — Toggle active/inactive from the list.
  **Steps**: Click the status pill/button in the الحالة column on the active
  seeded webhook.
  **Assert**: Shows "…" while pending (`togglingId === w.id`), then flips to
  "معطّل"; `e.stopPropagation()` on this click means it does NOT also open the
  detail view.

- **PLT-WHK-07** — Detail view — Overview tab.
  **Steps**: Click "تكامل نظام نقطة البيع الخارجي"'s row (not the status pill).
  **Assert**: Header shows name + target URL as subtitle, active/inactive
  status; Overview tab lists its 3 subscribed events as active chips with
  their Arabic labels resolved from `DOMAIN_EVENT_CATALOG`.

- **PLT-WHK-08** — Detail view — Deliveries tab: seeded failure evidence.
  **Steps**: Open محاولات التسليم on the same webhook.
  **Assert**: At minimum the 2 manually-seeded rows are present —
  `SALES_INVOICE_CONFIRMED` / نجحت (success) / status code `200` / no error
  message; `SALES_RETURN_CONFIRMED` / فشلت (failed) / no status code / error
  text containing `connect ECONNREFUSED 127.0.0.1:39217`.
  **Note**: because the seed also confirms a REAL sales return
  (`SRET-DEMO-1`) that this same active webhook is genuinely subscribed to,
  the real `WebhookDispatcher` fires against `127.0.0.1:39217` for real at
  seed time too — expect additional rows beyond the 2 manually inserted ones
  (see PLT-WHK-09 for the exact count this produces).

- **PLT-WHK-09** — Delivery retries are bounded, then stop — proven by the
  seed itself, not a synthetic test.
  **Pre**: `DEFAULT_WEBHOOK_RETRY_POLICY.maxAttempts = 3`
  (`packages/domain/src/webhooks/dispatcher.ts`). The seed confirms
  `SRET-DEMO-1` (a real sales return) while "تكامل نظام نقطة البيع الخارجي" is
  active and subscribed to `SALES_RETURN_CONFIRMED`, targeting an unreachable
  loopback port with nothing listening.
  **Steps**: Open the same webhook's محاولات التسليم tab; filter/scan for rows
  with event `SALES_RETURN_CONFIRMED`.
  **Assert**: Exactly **3** real dispatch-attempt rows for
  `SALES_RETURN_CONFIRMED` from the live confirm (on top of the 1 manually
  seeded synthetic failure row for the same event code — 4 total for that
  event, distinguishable by `attemptedAt` clustering), each failed, each with
  an error message ending in `attempt N/3: ... — giving up` on the final one
  — then no further rows accumulate no matter how long the tenant runs. This
  is the bounded-retry guarantee (`WebhookDispatcher.deliver`'s `for (attempt
  = 1; attempt <= maxAttempts; ...)` loop) made visible entirely through
  ordinary demo data, with no test harness required.

- **PLT-WHK-10** — A failing webhook never rolls back the operation that
  triggered it.
  **Pre**: Same as PLT-WHK-09 — the webhook target is provably unreachable.
  **Assert**: `SRET-DEMO-1` (the sales return whose confirm fired the doomed
  webhook) is nonetheless fully confirmed in the system — check it under
  المرتجعات ← مرتجعات المبيعات: status "مؤكد", inventory/GL effects applied
  normally. The webhook dispatch is fire-and-forget from the confirming
  request's perspective (`WebhookDispatcher.handle` never rejects — invariant
  1 in the dispatcher's own doc comment); a red network error in the delivery
  log must never correlate with a stuck or reverted business document.

- **PLT-WHK-11 [known gap, D6]** — Retries can outlive a backend shutdown.
  Not something to reproduce through the UI — recorded here as context for
  anyone who sees a delivery attempt missing its final row or a stack trace
  in server logs mentioning `"The database connection is not open"` right
  after a restart during PLT-WHK-09's window. Per `docs/defects.md` D6, this
  is a known, low-severity gap in shutdown ordering, not a UI defect — do not
  re-file it as a new finding.

- **PLT-WHK-12 [NOT IMPLEMENTED]** — No description field.
  The reference's create-webhook dialog includes an optional الوصف
  (description) textbox; this build's form has only name + URL + events — no
  description field anywhere on create, edit, or detail.

---

## 11 — Notification rules (`الإعدادات ← قواعد الإشعارات`)

`NotificationRulesPage.tsx`. This build's rule builder is a superset of the
reference in one respect (a fully working optional condition block, not merely
disabled placeholder fields) and a subset in another (no event/priority filter
dropdowns, no edit-existing-rule flow).

- **PLT-NOT-01** — List: seeded 4 rules.
  **Pre**: Demo seed.
  **Assert**: 4 rows — "تنبيه تأكيد فاتورة مبيعات" (event
  `SALES_INVOICE_CONFIRMED`, "عادية" info pill, in-app channel, active),
  "تنبيه مرتجع مبيعات" (event `SALES_RETURN_CONFIRMED`, "عالية" warning pill,
  in-app+email, active), "تنبيه مرتجع مشتريات" (event
  `PURCHASE_RETURN_CONFIRMED`, "عاجلة" danger pill, in-app, active), "تنبيه
  إلغاء مرتجع مشتريات" (event `PURCHASE_RETURN_VOIDED`, "منخفضة" neutral pill,
  push, **غير نشط** — this one was deactivated by the seed after creation).
  إجمالي القواعد = 4, القواعد النشطة = 3, القواعد المعطلة = 1.

- **PLT-NOT-02** — Status chips + toggle.
  **Steps**: Click "غير نشط" chip; assert only NR-DEMO-4 shows. Click its
  status pill to re-activate.
  **Assert**: Pill flips نشط↔غير نشط; stat counts update; chip filtering
  matches PLT-USR-07's pattern exactly (same `DocumentListStatusChip` idiom
  reused across this document's screens).

- **PLT-NOT-03** — Create a rule — event picker flags un-emitted events.
  **Steps**: Click "إضافة قاعدة"; open الحدث dropdown.
  **Assert**: Every one of the 39 catalog events IS offered here (unlike
  webhooks' 5-event picker — notification rules aren't narrowed the same way),
  but any event NOT in the live `emitted` set carries a visible " — لا يُطلق
  بعد" (not emitted yet) suffix on its label, and a hint line below the field
  reads "الأحداث المعلَّمة (لا يُطلق بعد) مسجَّلة في الكتالوج لكن لا يوجد في
  هذا الإصدار ما يطلقها — القاعدة المبنية عليها لن تعمل" (a rule built on one
  of these will never fire). Selecting an un-emitted event is NOT blocked —
  only warned against; this is deliberately softer than the webhook picker's
  hard 422 refusal.

- **PLT-NOT-04** — Create a rule — recipient type switches the value picker.
  **Steps**: Change نوع المستلم across all 3 options — حسب الصلاحية
  (permission), دور محدد (role), مستخدم محدد (user) — each time observing قيمة
  المستلم.
  **Assert**: Permission mode offers every permission code with its Arabic
  label; role mode offers the tenant's real roles list; user mode offers the
  tenant's real users list. Switching types clears the previously-selected
  value (`recipientValue: ""` reset in the `onChange`) rather than leaving a
  stale, type-mismatched value selected.

- **PLT-NOT-05** — Create a rule — channels multi-select with implementation
  hint.
  **Steps**: Observe قنوات الإرسال checkboxes.
  **Assert**: داخل التطبيق checked by default; hint text states in-app always
  works offline while بريد إلكتروني/إشعار فوري are only "queued" (قيد
  الإرسال). At least one channel is required to submit (submit button disabled
  when `form.channels.length === 0`).

- **PLT-NOT-06** — Create a rule — optional condition block.
  **Steps**: Toggle "إضافة شرط" on; fill حقل الشرط = "amount", العامل =
  "أكبر من" (gt), قيمة الشرط = "1000".
  **Assert**: The 3 condition sub-fields appear only once the toggle is on
  (contrast with the reference, where these fields existed but were
  permanently disabled/inert); submitting persists
  `condition: { field: "amount", operator: "gt", value: "1000" }` — a real,
  functioning feature in this build, not a stub.

- **PLT-NOT-07** — Create a rule — custom title/body with template variables.
  **Steps**: Fill عنوان مخصص (عربي) and نص الإشعار (عربي) using
  `{{customerName}}`, `{{amount}}`, `{{documentNumber}}` placeholders per the
  hint line; submit.
  **Assert**: Rule saves with the custom `titleAr`/`bodyAr`; row's subtitle
  under the rule name still shows the event's default Arabic label (from
  `EVENT_LABEL`), not the custom title — the custom copy is stored but not
  surfaced back on this list view (only relevant where the notification is
  actually rendered, e.g. the bell panel).

- **PLT-NOT-08** — Delete a rule.
  **Steps**: Click "حذف" on any rule.
  **Assert**: Row removed immediately (no confirmation modal); stat counts
  update.

- **PLT-NOT-09 [NOT IMPLEMENTED]** — Edit an existing rule.
  There is no "تعديل" action anywhere on this screen — the row click doesn't
  open a detail/edit view, and the actions column only has status-toggle and
  delete. A rule's event/recipient/priority/channels/condition/copy can only
  be set once, at creation; changing any of it means delete-and-recreate.

- **PLT-NOT-10 [NOT IMPLEMENTED]** — Event/priority filter dropdowns.
  The reference documents filter-by-الحدث (event) and filter-by-الأولوية
  (priority) comboboxes alongside the status tabs; this build has neither —
  only the search box (which, notably, has no visible search input wired in
  `NotificationRulesPage.tsx`'s `DocumentList` props either — re-verify
  against the live component if this matters for a specific test pass, since
  no `searchValue`/`onSearchChange` prop is passed here unlike every other
  `DocumentList` screen in this document) and the active/inactive/all chips.

---

## 12 — Numbering sequences (`الإعدادات ← تسلسلات الترقيم`)

`SequencesPage.tsx`. The counter itself is read-only in the main edit form by
design — a separate, deliberately friction-heavy panel is required to touch it.

- **PLT-SEQ-01** — List: all 25 document-type sequences.
  **Assert**: إجمالي التسلسلات = 25; row for each of the 25 codes documented in
  the reference (ASSET/AST-, BOM/BOM-, CASH_VOUCHER/CV-, CHEQUE/CHQ-,
  CONFIG_INSTANCE/CM-, CONTRACT/CTR-, CUSTOMER_REFUND/CRF-,
  DELIVERY_ORDER/DLV-, EMPLOYEE/EMP-, GOODS_RECEIPT/GR-,
  INSTALLMENT_PLAN/IP-, JOURNAL_ENTRY/JE-, LANDED_COST/LC-,
  LEAVE_REQUEST/LR-, PAYMENT_DISBURSEMENT/PAY-, PAYMENT_RECEIPT/REC-,
  PAYROLL_RUN/PR-, PAYSLIP/PS-, POS_SALE/POS- (pad length 8, the longest of
  the set), PURCHASE_INVOICE/PI-, PURCHASE_ORDER/PO-, PURCHASE_RETURN/PRT-,
  PURCHASE_RFQ/RFQ-, SALES_INVOICE/INV-, SALES_ORDER/SO-); إعادة ضبط سنوي stat
  = 0 (none flagged for annual reset in a fresh seed).

- **PLT-SEQ-02** — Search by code or label.
  **Steps**: Search "INV"; then search "فاتورة" (matches both SALES_INVOICE
  and PURCHASE_INVOICE labels).
  **Assert**: First narrows to `SALES_INVOICE`; second returns 2 rows.

- **PLT-SEQ-03** — Edit prefix — happy path, next-number preview updates.
  **Steps**: Click the `SALES_INVOICE` row; change البادئة from "INV-" to
  "SI-"; click "حفظ".
  **Assert**: Panel closes; row's البادئة column now "SI-"; الرقم التالي
  recomputes with the new prefix against the SAME current counter value (e.g.
  if current value was 14, next number is now `SI-000015`, not reset to
  `SI-000001`) — **prefix changes affect only the next document, never
  renumber history.**

- **PLT-SEQ-04** — Prove the no-renumbering guarantee against a real document.
  **Pre**: At least one confirmed sales invoice exists with number `INV-0000xx`
  under the old prefix (from before PLT-SEQ-03).
  **Steps**: After PLT-SEQ-03's prefix change, open that existing invoice.
  **Assert**: Its stored `docNo` still reads `INV-0000xx` — unchanged. Confirm
  a NEW invoice, and only the new one carries the `SI-` prefix. This is the
  single most important sequence assertion in this section; do not skip it in
  favor of just checking the settings-screen preview number.

- **PLT-SEQ-05** — Edit pad length.
  **Steps**: Change طول الترقيم (عدد الأصفار) from 6 to 4 on a low-volume
  sequence (e.g. `BOM`, currently at counter value 4); save.
  **Assert**: الرقم التالي preview recomputes to the shorter zero-padded form
  (`BOM-0005` instead of `BOM-000005`).

- **PLT-SEQ-06** — Edit pad length — required-field guard.
  **Steps**: Clear البادئة entirely, or set طول الترقيم to 0; attempt save.
  **Assert**: Danger pill "البادئة وطول الترقيم مطلوبان" (client-side guard —
  `form.prefix.trim() === "" || form.padLength < 1`); no request sent.

- **PLT-SEQ-07** — Toggle annual reset.
  **Steps**: Enable إعادة الضبط بالسنة المالية on any sequence; save.
  **Assert**: Row's column flips to "نعم"; إعادة ضبط سنوي stat increments.

- **PLT-SEQ-08** — Counter is read-only in the main form.
  **Steps**: Open any sequence's edit panel.
  **Assert**: القيمة الحالية للعداد and الرقم التالي render as plain text
  inside a `<dl>`, with explicit copy: "العداد للقراءة فقط هنا — لا يمكن
  تعديله بحرية حتى لا تنكسر ضمانة عدم وجود فجوات في الترقيم. لتعديله صراحةً
  انظر أدناه" (read-only here to protect the no-gaps guarantee; see below to
  change it explicitly) — no input control anywhere near these two values in
  the main form.

- **PLT-SEQ-09** — Explicit counter adjustment — guard rails.
  **Steps**: Click "تعديل العداد يدويًا…"; observe the panel that opens.
  **Assert**: Danger-tone panel with explicit warning copy that decreasing is
  always rejected (risk of reissuing a used number) and increasing creates a
  deliberate gap; a numeric field pre-filled with the CURRENT counter value
  and `min={sequence.currentValue}`; an acknowledgment checkbox
  ("أؤكد أنني أدرك أثر هذا التعديل ... ولا يمكن التراجع عنه") that must be
  checked before "تأكيد تعديل العداد" enables at all.

- **PLT-SEQ-10** — Explicit counter adjustment — below-current value rejected
  client-side.
  **Steps**: In the counter-adjust panel, type a value lower than the current
  counter (bypass the `min` attribute via devtools if the browser enforces
  it natively).
  **Assert**: Inline warning "القيمة الجديدة أقل من القيمة الحالية (N) — هذا
  التعديل مرفوض من الخادم"; "تأكيد تعديل العداد" stays disabled
  (`canConfirm = ack && !belowCurrent && !busy`) even with the checkbox
  ticked.

- **PLT-SEQ-11** — Explicit counter adjustment — happy path, deliberate gap.
  **Steps**: Type a value 5 higher than current; check the acknowledgment; click
  "تأكيد تعديل العداد".
  **Assert**: Server accepts (`confirm: true` in the request body); panel
  closes; القيمة الحالية للعداد in the parent form now reflects the new,
  higher value; الرقم التالي preview jumps accordingly — confirming a
  documented, intentional numbering gap was just created.

- **PLT-SEQ-12 [RBAC]** — `admin.sequences.edit`/`.reset` vs `.view` — a
  viewer without edit rights.
  **Pre**: A non-admin user whose role holds `admin.sequences.view` but not
  `.edit`/`.reset`.
  **Assert**: List loads normally (view-gated endpoint succeeds); the edit
  panel's save/counter-adjust calls fail with 403 from the server — surfaces
  as the same danger-`StatusPill` pattern used everywhere else in this
  document (PLT-ROL-15's general RBAC pattern, applied here).

---

## 13 — Barcode configuration (`الإعدادات ← إعدادات الباركود`)

`BarcodeConfigPage.tsx`. Genuinely a parsing-rules screen (scale/PLU barcode
price-embedding), not a label-design tool — label printing lives at
`/inventory/labels` (out of this document's scope, a different nav group
entirely; note it exists so a "where are the barcode label templates" search
doesn't stall here).

- **PLT-BAR-01** — General tab — defaults on a fresh tenant.
  **Assert**: نوع الترميز الافتراضي = "EAN-13"; طريقة تحديد باركود الصنف =
  "إدخال يدوي" (manual); no embedded rules exist yet
  (`createDefaultBarcodeConfig()`'s zero-rules default).

- **PLT-BAR-02** — General tab — switching to auto-generate reveals the prefix
  field.
  **Steps**: Change طريقة تحديد باركود الصنف to "توليد تلقائي".
  **Assert**: بادئة الترقيم التلقائي textbox appears (conditional render, only
  shown when mode is `AUTO`); typing non-digit characters is stripped live
  (`.replace(/\D/g, "")`).

- **PLT-BAR-03** — Embedded rules tab — add a rule with the worked example
  values.
  **Steps**: Click "إضافة قاعدة"; fill اسم القاعدة = "ملصق تخفيض"; leave
  defaults: البادئة = "2", الطول الكلي = 13, بداية كود الصنف = 1, طول كود
  الصنف = 5, بداية القيمة = 7, طول القيمة = 5, نوع القيمة = "سعر", الخانات
  العشرية = 2; click "حفظ الإعدادات".
  **Assert**: Rule card persists; القواعد (N) count increments; "مفعّلة"
  status pill on the card by default.

- **PLT-BAR-04** — Embedded rules — validation errors surface all reasons
  together.
  **Steps**: Add a rule with بداية القيمة set BEFORE بداية كود الصنف + طول
  كود الصنف ends (i.e. overlapping segments), and طول القيمة such that
  valueStart + valueLength exceeds الطول الكلي; click "حفظ الإعدادات".
  **Assert**: Save is blocked client-side —
  `validateBarcodeConfig(draft)` runs before the mutation fires; the combined
  Arabic reasons (segment-overlap + exceeds-total-length, joined by "، ") show
  next to the save button; nothing is sent to the server.

- **PLT-BAR-05** — Embedded rules — remove a rule.
  **Steps**: Click "×" on a rule card; save.
  **Assert**: Card disappears from the draft immediately (`removeRule`
  filters it out); persists on save.

- **PLT-BAR-06** — Live parse test — match.
  **Pre**: The rule from PLT-BAR-03 saved.
  **Steps**: In اختبار مسح باركود, paste `2012345025004` (prefix `2`, item
  code `012345`, price digits `02500`, check digit `4` — the worked example
  from the reference, adapted to this build's field layout); click "اختبار".
  **Assert**: Success-tone pill: "تطابق: كود الصنف 012345 — سعر 25". (Confirm
  the exact digit split against whatever rule fields were actually saved —
  the reference's example used `itemCodeLength: 6`; this build's blank-rule
  default is 5, so adjust the test string's digit count to match the SAVED
  rule, not the reference's illustration, before asserting a match.)

- **PLT-BAR-07** — Live parse test — no match.
  **Steps**: Paste an arbitrary barcode that matches no saved rule's prefix
  (e.g. all rules use prefix "2", paste one starting with "9").
  **Assert**: Neutral-tone pill "لا يوجد تطابق مع أي قاعدة".

- **PLT-BAR-08** — Live parse test only reflects SAVED rules, not the dirty
  draft.
  **Steps**: Edit a saved rule's totalLength in the draft (don't save yet);
  immediately run the live test against a barcode matching the OLD saved
  shape.
  **Assert**: The help copy explicitly warns "احفظ التغييرات أولًا لتظهر في
  نتيجة الاختبار" (save first for changes to show in the test result) — the
  test still matches against the last-saved config, not the in-progress edit;
  confirm this is actually true and not just documented, since it's an easy
  place for a UI to silently test against stale or dirty state either way.

- **PLT-BAR-09 [NOT IMPLEMENTED]** — EAN-13 check-digit validation toggle and
  max-value sanity cap.
  The reference's add-rule form includes التحقق من رقم المراجعة (EAN-13)
  (validate the trailing check digit) and الحد الأقصى للقيمة (a sanity-check
  max price, above which a read is treated as a scan error). Neither field
  exists on this build's `RuleCard` or in `EmbeddedBarcodeRule`'s type —
  confirmed absent from `packages/domain/src/barcode-config/barcode-config.ts`.
  A malformed barcode with a wrong check digit, or an absurdly large embedded
  price, will parse and "match" without complaint in this build.

---

## 14 — Print templates (`الإعدادات ← قوالب الطباعة`)

`PrintTemplatesPage.tsx` — full 9-tab designer, real API-backed, with a live
preview using the SAME `PrintView` renderer real documents print through.

- **PLT-PRT-01** — Save/undo gating.
  **Pre**: Fresh load — no draft.
  **Assert**: "تراجع" and "حفظ القالب" both disabled (`!dirty`); no status
  pill next to the title.
  **Steps**: Change any toggle.
  **Assert**: Both buttons enable; "تغييرات غير محفوظة" warning pill appears;
  clicking "تراجع" discards the draft (`setDraft(null)`) and both buttons
  disable again, reverting every changed field.

- **PLT-PRT-02** — Live preview reflects every toggle in real time.
  **Steps**: Toggle العنوان off under الترويسة tab.
  **Assert**: The aside preview panel (rendered via `PrintView` at 0.62 scale)
  updates immediately — the sample invoice's address line disappears from the
  rendered header — with no separate "refresh preview" action; the preview is
  driven by the SAME draft state as the form, not a stale snapshot.
  **Note [gap vs. reference]**: this build's preview always renders one fixed
  sample sales invoice (`createSampleInvoiceDocument()`); there is no
  document-type selector on the preview pane itself (the reference offered
  فاتورة مبيعات/عرض سعر/إيصال نقاط بيع as 3 preview-able types) — you cannot
  preview how a quote or a POS receipt would actually look from this pane;
  only the separate تخصيص حسب الوثيقة tab lets you configure other document
  types blind, without a matching preview.

- **PLT-PRT-03** — Identity tab: logo URL, position, size, primary color
  (dual-input color+hex-text sync), subtitle, page size.
  **Steps**: Set رابط الشعار to a URL, موضع الشعار = "الوسط", حجم الشعار =
  "كبير", change اللون الأساسي via both the color swatch AND the paired hex
  text input, set الوصف الفرعي, change مقاس الصفحة to A5.
  **Assert**: Changing the color swatch updates the hex text field and vice
  versa (both bound to the same `identity.primaryColor` string); preview's
  title/border color changes to match; page-size change is reflected (A5 vs
  A4 aspect in the scaled preview, if visually distinguishable).

- **PLT-PRT-04** — Header tab: 5 toggles.
  **Steps**: Toggle each of العنوان, الهاتف, البريد الإلكتروني, الرقم
  الضريبي, السجل التجاري off one at a time, observing the preview after each.
  **Assert**: Each corresponding line disappears from the preview's header
  block independently — no toggle affects another.

- **PLT-PRT-05** — Content tab: 5 toggles (اسم الفرع, اسم المستودع, الرقم
  الضريبي للعميل/المورد, شروط الدفع, الملاحظات) — same pattern as PLT-PRT-04,
  applied to the document-body metadata block.

- **PLT-PRT-06** — Columns tab: 6 line-item column toggles (كود الصنف, الوحدة,
  الوصف, خصم السطر, نسبة ضريبة السطر, مبلغ ضريبة السطر).
  **Assert**: Toggling كود الصنف on adds an item-code column to the preview's
  line-items table; toggling الوصف off removes the description column —
  confirm column COUNT in the rendered table matches the number of ON toggles
  plus the always-present item/qty/price/total core columns.

- **PLT-PRT-07** — Totals tab: subtotal, total discount, tax breakdown, amount
  in words.
  **Steps**: Toggle كتابة المبلغ بالحروف on.
  **Assert**: Preview renders the grand total spelled out in Arabic words via
  `amountInWords`/`EGP_WORDS` — confirm the spelled-out amount matches the
  sample invoice's actual numeric total (this is computed live, not a static
  string).

- **PLT-PRT-08** — Footer tab: text, signatures toggle, signature count,
  per-signature labels.
  **Steps**: Set نص التذييل; enable إظهار التوقيعات; set عدد التوقيعات to 2;
  fill both تسمية التوقيع fields (e.g. "أعده" / "اعتمده").
  **Assert**: Exactly 2 signature-label text fields render (driven by
  `signatureLabelList(count, labels)` which pads/truncates the labels array to
  match `signatureCount`); reducing the count to 1 removes the second label
  field WITHOUT discarding its typed text if the count is raised back to 2
  (the underlying array isn't cleared, only sliced/padded for display).

- **PLT-PRT-09** — Watermark tab: text + opacity, auto-disabled when text is
  empty.
  **Steps**: Leave نص العلامة المائية empty, set الشفافية to 0.5; observe no
  watermark in the preview despite the opacity value; then type "مسودة"
  (draft) into the text field.
  **Assert**: Description on this tab states explicitly the watermark
  "تُعطَّل تلقائيًا عند ترك النص فارغًا، بصرف النظر عن الشفافية" (auto-disables
  when text is empty, regardless of opacity) — confirm the preview shows NO
  watermark with empty text + nonzero opacity, and DOES show one once text is
  entered.

- **PLT-PRT-10** — POS receipt tab: independent of the main document settings.
  **Steps**: Toggle إظهار عنوان المستند, إظهار الرقم الضريبي, إظهار اسم
  العميل; set نص الشكر.
  **Assert**: Banner note on this tab states these settings apply ONLY to
  thermal POS receipts, not the main invoice/quote layout — confirm changing
  these does NOT alter the aside preview (which only ever renders the sample
  sales invoice, not a POS receipt — see PLT-PRT-02's gap note; there is no
  live way to visually confirm a POS-receipt-tab change from this screen at
  all).

- **PLT-PRT-11** — Per-document overrides — tri-state fields default to
  "inherit".
  **Steps**: Open تخصيص حسب الوثيقة tab; select نوع المستند = "مرتجع مبيعات".
  **Assert**: Every tri-state field (إظهار العنوان, إظهار الهاتف, ... — the
  same 20 fields listed in `TRI_STATE_FIELDS`) shows "افتراضي (بدون تخصيص)"
  by default (`value === undefined`), meaning this doc type currently follows
  the tenant-wide settings from the earlier tabs with no per-type override.

- **PLT-PRT-12** — Per-document overrides — set then clear a field.
  **Steps**: On "مرتجع مبيعات", set إظهار الهاتف to "إخفاء" (hide); save;
  reopen the tab and switch to "فاتورة مشتريات" then back to "مرتجع مبيعات".
  **Assert**: The override persists per document type — "مرتجع مبيعات" still
  shows "إخفاء" for that field after navigating away and back, while
  "فاتورة مشتريات" (never touched) still shows "افتراضي"; setting a field back
  to "افتراضي" removes that key entirely from the stored override object
  (`delete next[f.key]` when `v === undefined`), not just setting it to some
  sentinel — confirm via a subsequent GET that the key is truly absent, not
  present-with-null.

- **PLT-PRT-13** — Per-document override dropdown offers 9 document types.
  **Assert**: نوع المستند lists exactly فاتورة مبيعات, مرتجع مبيعات, عرض سعر,
  فاتورة مشتريات, مرتجع مشتريات, أمر شراء, استلام بضاعة, سند نقدي, سند تحصيل —
  9 types (`DOCUMENT_TYPE_OPTIONS`), fewer than the reference's "many more,
  scrollable/truncated" list — confirm no additional types are hidden below a
  scroll boundary in this build; the list is short enough to render in full.

- **PLT-PRT-14** — Error path: load failure.
  **Pre**: Force `GET /print-template-config` to fail (network throttling or
  a temporary permission removal).
  **Assert**: The whole page renders a single danger `StatusPill` "تعذّر تحميل
  قالب الطباعة" — no tabs, no preview, no partial UI; confirm there's no
  retry button on THIS particular failure path (unlike most other screens in
  this document) — a real gap if a transient failure requires a full
  navigation-away-and-back to recover rather than a retry click.

---

## 15 — Data migration (`الإعدادات ← نقل البيانات`)

`DataMigrationPage.tsx` + `data-migration-steps.ts`. **This section carries the
most important, evidence-backed findings in this entire document — read the
callout before writing any scenario against the shipped fixtures.**

> ### The commit gate is all-or-nothing per file, not per row
>
> `runStep()` (`packages/api/src/data-migration-routes.ts`) returns early
> without persisting ANYTHING when `!commit || errors.length > 0`. The UI's own
> `canCommit` guard (`!!result && result.errors.length === 0 && !result.createdIds`)
> disables "تأكيد الاستيراد" entirely whenever the preview reports even ONE
> error row. **A file with 3 valid rows and 1 invalid row cannot commit the 3
> valid rows — the commit button stays disabled until every row in that upload
> is clean.** The only way to "commit the valid rows while refusing the
> invalid ones" is to fix or remove the bad rows in the spreadsheet and
> re-upload a clean file. Every scenario below tests the REAL behaviour, not
> the row-level partial-commit some might assume from the phrase "refuse the
> invalid rows while committing the valid ones."

> ### Two of the four fixtures with an intentionally-invalid row also break
> their intentionally-valid rows
>
> `employees.xlsx` and `items.xlsx` (`test-fixtures/data-migration/`) leave a
> REQUIRED column blank on every row, including the rows meant to demonstrate
> a clean import. Confirmed by unzipping and reading the raw XLSX XML:
> - `employees.xlsx`: column D (تاريخ التعيين / hire date) is empty on **all
>   3 rows** (`E-101`, `E-102`, `E-103`). `employeesStep`'s
>   `if (!hireDate) reasons.push("تاريخ التعيين مطلوب")` fires unconditionally.
>   **Result: 0 of 3 rows are importable as shipped** — not "2 valid + 1
>   invalid" as the task brief's general description implies.
> - `items.xlsx`: column D (وحدة القياس الأساسية / base unit code) is empty on
>   **all 3 rows** (`IT-9001`, `IT-9002`, `IT-9003`). `itemsStep`'s
>   `if (!baseUnitCode) reasons.push("وحدة القياس الأساسية مطلوبة")` fires
>   unconditionally AND returns before ever reaching the `Money.fromMajor`
>   parse that would flag row 3's intended non-numeric-price defect
>   (`سعر غير رقمي` / "غير رقمي" in column E). **The deliberately-invalid
>   price test is masked** — the reported reason for row 3 will read only
>   "وحدة القياس الأساسية مطلوبة", never anything about the price.
>
> Write the scenarios below against what the fixtures ACTUALLY produce. Where
> the intended lesson ("preview reports it, commit refuses it, valid rows
> still commit") doesn't survive contact with the real file, that's the
> finding — report it, don't paper over it by hand-editing the fixture before
> testing.

- **PLT-MIG-01** — 13 steps, correctly ordered and numbered, no display bug.
  **Assert**: Steps render ١ through ١٣ in sequence with no repeated number
  (the reference's "٩ used twice" display bug is not reproduced here — this
  build's `data-migration-steps.ts` numbers cleanly: ١ الأقسام, ٢ الموظفين, ٣
  حسابات الخزينة, ٤ الموردون, ٥ العملاء, ٦ الأصناف, ٧ وحدات الأصناف, ٨
  تصنيفات الأصول, ٩ الأصول الثابتة, ١٠ فواتير المبيعات السابقة, ١١ مرتجعات
  المبيعات السابقة, ١٢ فواتير المشتريات السابقة, ١٣ مرتجعات المشتريات
  السابقة); only the first step starts expanded, the rest collapsed
  (accordion — one open at a time, `openStep` state).

- **PLT-MIG-02** — Step order is guidance, not a lock.
  **Steps**: With zero departments/employees imported, jump straight to step
  ٦ الأصناف (skipping ١–٥) and download its template.
  **Assert**: No blocking message, no disabled state — every step is
  independently openable at any time, matching the in-app Egyptian-Arabic
  intro copy ("تقدر تفتح أي خطوة في أي وقت — الترتيب إرشاد مش قفل").

- **PLT-MIG-03** — Departments (step ١) — template download.
  **Steps**: Click "تنزيل النموذج".
  **Assert**: An `.xlsx` downloads with sheet "الأقسام", columns الكود / الاسم
  / الاسم (إنجليزي) — matches `HISTORICAL_COLUMNS`-independent, department-
  specific spec.

- **PLT-MIG-04** — Departments — import the shipped fixture as-is: partial
  success, all-or-nothing gate blocks commit.
  **Steps**: Click "استيراد"; choose `test-fixtures/data-migration/
  departments.xlsx` (4 rows: `SALES`, `FIN`, `OPS`, then a duplicate `SALES`
  row labeled "مكرر — كود موجود بالفعل").
  **Assert**: Preview summary "3 صف صالح من إجمالي 4"; errors table shows one
  row — row 5 (the 1-indexed data row, i.e. the 4th data row after the
  header), reason `الكود "SALES" مكرر في نفس الملف` (code duplicated within
  the same file — this fires `checkDuplicateInBatch`, not the "already
  registered" check, since none of these codes exist in the tenant yet).
  "تأكيد الاستيراد" is **disabted** (per the callout above) despite 3 clean
  rows sitting right there.

- **PLT-MIG-05** — Departments — remove the bad row, re-upload, commit
  succeeds.
  **Steps**: Edit a copy of `departments.xlsx` removing the duplicate `SALES`
  row (leaving `SALES`/`FIN`/`OPS`); re-run "استيراد" with the edited file;
  once the preview shows "3 صف صالح من إجمالي 3" with zero errors, click "تأكيد
  الاستيراد".
  **Assert**: Summary flips to "تم استيراد 3 سجل بنجاح"; the step card shows a
  ✓ checkmark and "مسجّل: 3"; re-opening step ٢ الموظفين's department-code
  lookup now resolves `SALES`/`FIN`/`OPS`.

- **PLT-MIG-06** — Employees (step ٢) — import the shipped fixture: ALL rows
  rejected, not 2-of-3.
  **Pre**: PLT-MIG-05 completed (departments SALES/FIN/OPS exist).
  **Steps**: Import `employees.xlsx` (3 rows: `E-101`/SALES, `E-102`/FIN,
  `E-103`/NOPE — all with a blank hire-date column).
  **Assert**: Preview summary "0 صف صالح من إجمالي 3"; errors table has 3
  rows — `E-101`: "تاريخ التعيين مطلوب"; `E-102`: "تاريخ التعيين مطلوب";
  `E-103`: BOTH "تاريخ التعيين مطلوب" AND `القسم بالكود "NOPE" غير موجود —
  استورد الأقسام أولاً" (2 reasons on this row). "تأكيد الاستيراد" disabled.
  This is the fixture-breaks-its-own-valid-rows finding from the callout,
  made concrete.

- **PLT-MIG-07** — Employees — hand-fix hire dates, keep the bad-department
  row, confirm the intended lesson DOES work once the fixture bug is worked
  around.
  **Steps**: Edit a copy of `employees.xlsx`: fill a valid `hireDate` (e.g.
  `2026-01-01`) on all 3 rows, leaving `E-103`'s department code `NOPE`
  untouched; re-import.
  **Assert**: Preview "2 صف صالح من إجمالي 3"; the single remaining error is
  `E-103`'s "القسم بالكود \"NOPE\" غير موجود — استورد الأقسام أولاً" — commit
  still disabled (all-or-nothing). Remove `E-103` entirely and re-import a
  2-row file to actually see "تم استيراد 2 سجل بنجاح" — only then does the
  step's مسجّل badge show 2 and the ✓ checkmark appears.

- **PLT-MIG-08** — Treasury accounts (step ٣) — clean import, no deliberately
  invalid row exists in this fixture.
  **Steps**: Import `treasury-accounts.xlsx` (1 row: `CASH-001`, type `cash`,
  opening balance `0.00`).
  **Assert**: Preview "1 صف صالح من إجمالي 1"; commit succeeds. **Note**: this
  fixture contains NO negative-opening-balance row — contrary to a literal
  reading of the task brief, the negative-value test lives in `customers.xlsx`
  instead (PLT-MIG-11), not here. `treasuryStep`'s own validation DOES reject
  a negative opening balance for a `cash`-type account with reason "لا يمكن
  أن يكون الرصيد الافتتاحي لحساب نقدي سالبًا" — if a negative-balance
  regression test is wanted for THIS step specifically, hand-edit a copy of
  this fixture to add one; the shipped file won't exercise it.

- **PLT-MIG-09** — Suppliers (step ٤) — clean import.
  **Steps**: Import `suppliers.xlsx` (2 rows: `S-9001`, `S-9002`, both
  complete).
  **Assert**: Preview "2 صف صالح من إجمالي 2"; commit succeeds; no
  deliberately-invalid row in this fixture either.

- **PLT-MIG-10** — Customers (step ٥) — independent of prior steps, ordering
  confirmed.
  **Steps**: Import `customers.xlsx` with NO prior steps completed in this
  session (customers don't reference departments/employees/treasury/
  suppliers).
  **Assert**: Import succeeds regardless of what other steps have or haven't
  run — confirms the help text's "مستقل عن باقي الخطوات" claim.

- **PLT-MIG-11** — Customers — the fixture's actual invalid row, precisely.
  **Steps**: Import `customers.xlsx` (3 rows: `C-9001`, `C-9002` clean;
  `C-9003` named "رصيد سالب غير صالح" / "invalid negative balance" with
  paymentTermsDays = `-5`).
  **Assert**: Preview "2 صف صالح من إجمالي 3"; the row-3 error reads
  **"مدة السداد يجب أن تكون رقمًا صحيحًا غير سالب"** (payment terms must be a
  non-negative whole number) — from `validatePartnerBase`'s
  `paymentTermsDays < 0` check. **Correction to the task brief's framing**:
  customers have no `openingBalance` field in this import step at all (that
  concept only exists for treasury accounts, PLT-MIG-08); the row's Arabic
  label calls it a "negative balance" but the actual rejected value is a
  negative payment-terms-days figure. The row IS correctly rejected — just not
  for the reason its own name suggests. Commit is disabled until the bad row
  is removed or fixed; a 2-row clean re-upload commits "2 سجل بنجاح".

- **PLT-MIG-12** — Items (step ٦) — see PLT-MIG-06's sibling finding.
  **Steps**: Import `items.xlsx` as shipped (3 rows, all missing
  `baseUnitCode`).
  **Assert**: Preview "0 صف صالح من إجمالي 3"; all 3 rows show reason
  "وحدة القياس الأساسية مطلوبة" ONLY — `IT-9003`'s deliberately non-numeric
  `salePrice` ("غير رقمي") is never evaluated because the row returns early on
  the missing-unit-code check before reaching the `Money.fromMajor` try/catch.

- **PLT-MIG-13** — Items — hand-fix unit codes, confirm the non-numeric-price
  test actually works once unmasked.
  **Steps**: Edit a copy of `items.xlsx`: fill `baseUnitCode = "PCS"` (a real
  seeded unit code) on all 3 rows, leaving `IT-9003`'s `سعر البيع` = "غير
  رقمي" untouched; re-import.
  **Assert**: Preview "2 صف صالح من إجمالي 3"; row 3's error now correctly
  surfaces a price-parsing failure (`Money.fromMajor("غير رقمي")` throws,
  caught and reported as the row's `reasons`) — THIS is the scenario that
  actually demonstrates "non-numeric price rejected," and it only works after
  correcting the fixture's own blocking defect.

- **PLT-MIG-14** — Item units (step ٧) — references items by code, single
  clean row.
  **Steps**: Import `item-units.xlsx` (1 row: `ITM-1`/`BOX`/كرتونة/factor 12)
  — note this references item code `ITM-1`, which doesn't match either
  fixture item code (`IT-9001`/`IT-9002`/`IT-9003` from `items.xlsx`).
  **Assert**: Depending on whether the item-lookup is a hard requirement or
  silently skips unmatched rows, confirm the actual behavior — if
  `itemUnitsStep` requires the referenced item to exist first (per its help
  text: "بعد الأصناف، لأن كل صف بيرجع لصنف بالكود"), this row should be
  rejected with an item-not-found reason UNLESS `ITM-1` happens to exist from
  a prior step. Do not assume success; the fixture's item code doesn't line
  up with the items fixture's codes, which is itself worth flagging as a
  cross-fixture inconsistency if confirmed.

- **PLT-MIG-15** — Asset categories (step ٨) — clean import.
  **Steps**: Import `asset-categories.xlsx` (1 row: `CAT-1` أثاث ومعدات, 60mo
  useful life, 10% salvage).
  **Assert**: Preview "1 صف صالح من إجمالي 1"; commits cleanly.

- **PLT-MIG-16** — Fixed assets (step ٩) — clean import, references category.
  **Pre**: PLT-MIG-15 completed (`CAT-1` exists).
  **Steps**: Import `assets.xlsx` (1 row: `AST-1` مكتب, category `CAT-1`,
  acquisition 2026-01-01, cost 5000.00) as a legacy opening-balance asset.
  **Assert**: Preview "1 صف صالح من إجمالي 1"; help text confirms this posts
  NO new GL journal entry (registered as رصيد افتتاحي).

- **PLT-MIG-17** — Historical sales invoices (step ١٠) — the 4 historical
  fixtures are identical placeholders, not distinct scenario data.
  **Steps**: Open and diff `historical-sales-invoices.xlsx`,
  `historical-sales-returns.xlsx`, `historical-purchase-invoices.xlsx`,
  `historical-purchase-returns.xlsx`.
  **Assert**: All 4 files contain the exact SAME single row — `documentNumber
  INV-1001`, `partyId cus-1`, `date 2026-01-15`, `qty 10`, `unitCost 85.00`,
  `amountPaid 500.00` — a generic template example, not a document-type-
  specific scenario, and none of the 4 files contains a deliberately-invalid
  row (no bad date, no negative qty, no non-numeric cost). Whatever
  "deliberately invalid historical row" behavior needs testing must be
  hand-authored; the shipped fixtures don't provide one for any of these 4
  steps.

- **PLT-MIG-18** — Historical import — `partyId` is never checked against a
  real customer/supplier.
  **Steps**: Import `historical-sales-invoices.xlsx` as shipped (`partyId:
  "cus-1"`, which matches no real seeded customer code such as `C-9001`).
  **Assert**: The row is accepted at the domain-validation layer regardless
  (`packages/domain/src/purchasing/historical-import.ts`'s row validator only
  checks non-empty presence — `if (row.supplierId.trim() === "")` — never
  existence against a repository; the sales-side route
  (`sales-historical-import-routes.ts`) likewise never resolves `customerId`
  against `CustomerRepository`). The archived document ends up carrying a
  `partyId` of `cus-1` that corresponds to no real customer record anywhere —
  confirm this by trying to find "cus-1" attributed anywhere in Customer 360
  or an AR aging report; it won't appear, because it isn't a real customer id.
  This is a genuine, testable gap: historical import happily creates orphaned
  party references.

- **PLT-MIG-19** — Historical sales returns (step ١١) — "import invoices
  first" ordering.
  **Pre**: Step ١٠ (historical sales invoices) has NOT yet been committed in
  this session.
  **Steps**: Attempt to preview/import `historical-sales-returns.xlsx` first.
  **Assert**: Confirm whether the preview step actually enforces "the return
  must link to an imported invoice" (per the in-app warning copy: "استورد
  الفواتير أولاً — المرتجع لازم يتربط بفاتورة مستوردة") or merely displays the
  warning without a hard block — the row's `documentNumber` in the shipped
  fixture (`INV-1001`) matches the invoices fixture's `documentNumber`
  exactly, so testing this ordering rule meaningfully requires committing
  step ١٠ first with that exact document number, then re-running step ١١'s
  identical-numbered row and confirming it correctly attaches rather than
  silently creating an unlinked return.

- **PLT-MIG-20** — Registered-count badge and ✓ checkmark reflect live status,
  not the last preview.
  **Pre**: Any step successfully committed (e.g. PLT-MIG-05).
  **Steps**: Collapse and re-expand that step's card.
  **Assert**: مسجّل: N badge and the header ✓ checkmark both come from
  `useDataMigrationStatus()` (a live server count), not from the local
  `result` state of the last preview/commit — confirm they survive a full
  page reload (which resets all local React state) by reloading and
  re-checking the badge.

- **PLT-MIG-21** — Footer scope-boundary note.
  **Assert**: Page footer explicitly states physical-count import and
  stock-transfer import are NOT part of this wizard — they live inside the
  physical-count sheet and the transfer screen themselves. Do not treat their
  absence here as a gap; it's a documented, deliberate IA boundary.

- **PLT-MIG-22 [RBAC]** — Preview vs. commit permission split.
  **Pre**: A non-admin user whose role holds `admin.settings.view` but not
  `admin.settings.edit`.
  **Assert**: Every step's preview ("استيراد") succeeds (gated on `.view`);
  every step's commit ("تأكيد الاستيراد") fails with 403 (gated on `.edit`) —
  confirm the button click surfaces a failure rather than silently doing
  nothing; `MasterStepCard`/`HistoricalStepCard` don't appear to special-case
  a 403 on commit distinctly from any other mutation error, so check what
  actually renders (likely nothing visible beyond the button staying in its
  "جارِ التأكيد…" state briefly then reverting with no error surfaced — a gap
  worth confirming precisely).

---

## 16 — Workflow / approval settings (`الإعدادات ← إعدادات الموافقات`)

`WorkflowConfigPage.tsx` — the chain-builder that feeds the Approvals Inbox
(§17). This build supports full edit and delete, unlike the reference (create
only observed there).

- **PLT-WFC-01** — List: seeded 2 configs.
  **Pre**: Demo seed.
  **Assert**: 2 rows — تأكيد فاتورة المبيعات (`SALES_INVOICE_CONFIRM`, 1 step,
  "نشط") and تأكيد فاتورة المشتريات (`PURCHASE_INVOICE_CONFIRM`, 1 step,
  "نشط"). سير عمل مُعرّف stat = 2.

- **PLT-WFC-02** — "إضافة سير عمل جديد" only offers UN-configured action
  types.
  **Steps**: Click "إضافة سير عمل جديد"; open نوع الإجراء.
  **Assert**: `SALES_INVOICE_CONFIRM` and `PURCHASE_INVOICE_CONFIRM` are
  ABSENT from the dropdown (`availableActionTypes` filters out
  `configuredActionTypes`); the remaining 24 of the 26 catalog action types
  are offered (Sales quote-send, PO confirm, GRN confirm, purchase-return
  confirm, landed-cost confirm, payment/receipt voucher confirm, capital
  withdrawal confirm, tax payment confirm, stock transfer confirm, stock
  adjustment confirm, journal post/void, payroll run approval, the 9
  leave-type-specific approvals, and work-order start).

- **PLT-WFC-03** — Create a chain — role picker is custom-roles-only.
  **Pre**: At least one custom role exists (PLT-ROL-03's "مشرف"/`SUPERVISOR`).
  **Steps**: Select نوع الإجراء = "تأكيد سند صرف/قبض" (any un-configured
  type); in خطوات الموافقة, اختر الدور dropdown.
  **Assert**: Only custom (non-system) roles appear — `SYSTEM_ADMIN` is
  filtered out entirely (`customRoles = roles.filter(r => !r.isSystem)`),
  consistent with admins bypassing every gate via `permissions: ["*"]`
  regardless of chain configuration.

- **PLT-WFC-04** — Create a chain — no custom roles exist yet: guarded, not
  broken.
  **Pre**: A tenant with zero custom roles (hypothetically — or test against
  the very first load before PLT-ROL-03 exists).
  **Assert**: "لا توجد أدوار مخصصة — أنشئ دورًا مخصصًا أولًا من صفحة الأدوار
  والصلاحيات" guidance text renders; "إضافة خطوة" button is disabled
  (`disabled={customRoles.length === 0}`) — cannot even start building a step
  without a role to assign it to.

- **PLT-WFC-05** — Create a chain — multi-step sequential approval.
  **Steps**: Add step 1 (role = "مشرف", وصف = "مراجعة أولى"); click "إضافة
  خطوة"; add step 2 (role = a second custom role, وصف = "اعتماد نهائي");
  save.
  **Assert**: New row shows عدد الخطوات = 2; opening it for edit shows both
  steps in order with their step-number badges ("خطوة 1", "خطوة 2").

- **PLT-WFC-06** — Create a chain — remove a step (only when >1 exists).
  **Steps**: With 2 steps drafted, click "إزالة" on step 2.
  **Assert**: Step 2 disappears, only step 1 remains; the "إزالة" button is
  absent entirely on step 1 while it's the only step
  (`steps.length > 1` guard) — cannot remove down to zero steps from the UI.

- **PLT-WFC-07** — Create a chain — validation.
  **Steps**: Leave every step's role unselected (or all steps removed down to
  one with an empty role); click "حفظ سير العمل".
  **Assert**: Danger message "أضف خطوة واحدة على الأقل مع اختيار الدور
  المعتمد" (add at least one step with an approver role selected); no request
  sent (`cleanSteps.length === 0` guard, client-side).

- **PLT-WFC-08** — Edit an existing chain — action type is locked.
  **Steps**: Click the "تأكيد فاتورة المبيعات" row (or its "تعديل" button).
  **Assert**: نوع الإجراء select is `disabled`, pre-filled to the existing
  action type only; only the steps list is editable; save calls the update
  endpoint (`useUpdateWorkflowConfig`), not create.

- **PLT-WFC-09** — Edit an existing chain — add a second step to a 1-step
  chain.
  **Steps**: Open "تأكيد فاتورة المبيعات" (currently 1 step, role SUPERVISOR);
  add a second step with a different custom role; save.
  **Assert**: عدد الخطوات → 2 on the list; the Approvals Inbox's step counter
  for any future request against this action type would now show "1 / 2"
  instead of "1 / 1" — this directly changes what §17's approve flow requires.

- **PLT-WFC-10** — Delete a chain.
  **Steps**: Click "حذف" on any non-seed-critical row (avoid deleting the two
  seeded configs if §17's scenarios still depend on them being intact — use a
  chain created in PLT-WFC-05 instead).
  **Assert**: Row disappears; سير عمل مُعرّف decrements; the deleted action
  type reappears as selectable in "إضافة سير عمل جديد"'s dropdown.

- **PLT-WFC-11** — Search by action type label.
  **Steps**: Search "فاتورة".
  **Assert**: Matches both sales- and purchase-invoice-confirm rows.

- **PLT-WFC-12 [RBAC]** — `workflow.config.view` vs `.manage`.
  **Pre**: A non-admin user with `workflow.config.view` but not `.manage`.
  **Assert**: List loads; "إضافة سير عمل جديد" / edit / delete all fail
  server-side with 403 (same general pattern as PLT-ROL-15) — confirm the UI
  doesn't crash on the failed mutation, and that whatever error surfaces (or
  fails to) matches what PLT-MIG-22 found for the analogous split there.

---

## 17 — Approvals inbox (`الموافقات`, top-level nav item)

`ApprovalsInboxScreen.tsx`. **Read the two traps at the top of this document
before writing or running anything here** — they are not general color, they
are the entire reason this section's Pre-conditions look the way they do.

- **PLT-APR-01 — THE TRAP, reproduced and confirmed.**
  **Pre**: Signed in as `USER-ADMIN` (the seed's only account, `permissions:
  ["*"]`). At least one workflow config exists gating some action (seeded:
  `SALES_INVOICE_CONFIRM`).
  **Steps**: Create and confirm a new sales invoice as this admin account.
  **Assert**: The invoice confirms IMMEDIATELY — no "بانتظار الموافقة" hold,
  because `startApproval`'s `hasAdminRole` check short-circuits the gate for
  any submitter whose roles include `"*"`. Open الموافقات: it is empty (0
  rows) with respect to anything this admin action would have produced. **This
  is correct, documented behavior, not a bug** — do not file "approvals inbox
  is broken" from this alone.

- **PLT-APR-02** — Seeded pending request IS visible to the admin account
  (because admin sees everything, not because admin submitted it).
  **Pre**: Demo seed's `APR-DEMO-1` (سير عمل: `SALES_INVOICE_CONFIRM`, step 0
  requiring role `SUPERVISOR`, submitted by the synthetic actor
  `USER-SALES-REP-1` during seeding — NOT a real login in this build, see the
  callout below).
  **Steps**: Signed in as `USER-ADMIN`, open الموافقات.
  **Assert**: `APR-DEMO-1` DOES appear — one row, "فاتورة مبيعات بقيمة 5,200
  ج.م — مجموعة الفجر التجارية", الخطوة الحالية "1 / 1", الدور المطلوب
  "SUPERVISOR", مُقدَّم من `USER-SALES-REP-1`. This works because
  `listPendingForRoles` special-cases `roles.includes("*")` to return every
  pending request unfiltered (`packages/persistence/src/approval-request-
  store.ts`) — admin sees the whole queue, distinct from the submit-side
  bypass in PLT-APR-01.

- **PLT-APR-03 — the decide-side trap, confirmed against real seed data.**
  **Pre**: Same as PLT-APR-02 — `APR-DEMO-1` visible, signed in as
  `USER-ADMIN`.
  **Steps**: Click "رفض" (reject) on `APR-DEMO-1`'s row.
  **Assert**: The request does NOT end up rejected. `decide()`'s admin branch
  ignores `input.decision` entirely and always grants — the request's status
  becomes `"approved"` with a `"bypass"` decision kind, and it disappears from
  the pending list as if approved. **Clicking "reject" as an admin approves.**
  Do not run this against `APR-DEMO-1` if a later scenario (PLT-APR-06/07)
  still needs it pending — use a disposable request instead, or restore the
  seed.

- **PLT-CALLOUT — there is no real non-admin login in this seed; you must
  create one.**
  The synthetic actors named in `demo-seed/platform.ts`
  (`USER-SALES-REP-1`, `USER-PURCHASING-1`, `USER-FINANCE-MGR`,
  `USER-SUPERVISOR-1`, `USER-SALES-REP-2`) are `x-user-id`/`x-role-codes`
  HTTP headers the seed script sends directly to the backend — they are
  **not** rows in the Users table, have no password, and cannot be signed
  into through the login screen (`packages/backend/src/seed.ts` creates
  exactly one real account, `USER-ADMIN`). To genuinely exercise a non-admin
  approve/reject/request-modification decision through the live UI (not via
  raw API calls), you must first: (1) create a custom role via **PLT-ROL-03**
  with `code: "SUPERVISOR"` — matching `APR-DEMO-1`'s required step role
  exactly, string-for-string — holding at least `workflow.view` +
  `workflow.approve` + `workflow.reject`; (2) create a user via
  **PLT-USR-CREATE** assigned to that role; (3) sign out of `USER-ADMIN` and
  sign in as the new user. Only then does clicking "رفض"/"موافقة"/"طلب تعديل"
  exercise the REAL non-admin decision path (`decide()`'s non-admin branch,
  which actually reads `input.decision`).

- **PLT-APR-04** — Non-admin approve — happy path, correct step-role match.
  **Pre**: Signed in as the `SUPERVISOR`-role user from **PLT-CALLOUT**.
  **Steps**: Open الموافقات; confirm `APR-DEMO-1` is visible (role match);
  type an optional note in the row's ملاحظة field, e.g. "المستندات سليمة";
  click "موافقة".
  **Assert**: Row disappears from the pending list; the mutation's response
  body (`ApprovalRequestDTO`) — inspect via network tab — shows `status:
  "approved"`, `decisions: [{ stepIndex: 0, kind: "approve", actorId:
  <this user's id>, comment: "المستندات سليمة", at: <timestamp> }]`. Since
  this chain has only 1 step, one approval is final — confirm there is no
  second-step handoff expected here (contrast with a 2-step chain, PLT-APR-09).

- **PLT-APR-05** — Non-admin reject — happy path, real rejection this time.
  **Pre**: A fresh pending request against a 1-step chain requiring this
  user's role (create one: submit a new `SALES_INVOICE_CONFIRM` request via
  the seed's own pattern, or reuse `APR-DEMO-1` if PLT-APR-04 wasn't run
  against it).
  **Steps**: Type a rejection reason in the row's ملاحظة field, e.g. "تجاوز
  الحد الائتماني"; click "رفض".
  **Assert**: Row disappears from pending; response shows `status:
  "rejected"`, `decisions: [{ kind: "reject", actorId: <this user's id>,
  comment: "تجاوز الحد الائتماني", ... }]` — a REAL rejection this time,
  contrasting directly with PLT-APR-03's admin-forced approval on the
  identical button.

- **PLT-APR-06** — Reject's consequence: **the underlying document does not
  post — but only provably so for a request that's actually tied to one.**
  **Pre / important scope note**: `APR-DEMO-1`/`2`/`3` are synthetic
  (`entityLabel`-only) requests created by direct `POST /workflow/requests`
  calls during seeding — they were never produced by a real sales/purchase
  invoice's confirm action, and deciding them has no effect on any real
  document (there is no linked invoice to check). To test "a rejected
  document must not post" against a REAL document, see **PLT-APR-10** below —
  read it before assuming this scenario alone proves the consequence.
  **Steps**: With `APR-DEMO-3` (seeded, already `status: "rejected"`, decided
  by the synthetic `USER-SUPERVISOR-1` with comment "تم الرفض: تجاوز الفاتورة
  الحد الائتماني المسموح للعميل") — confirm it does NOT appear in the pending
  inbox for any actor, admin or otherwise (a rejected request is terminal,
  never re-enters the queue).
  **Assert**: `APR-DEMO-3` is absent from `/workflow/requests/pending`
  regardless of who's signed in; there is no UI screen that lists it as
  "rejected" anywhere either (see PLT-APR-12's gap note) — its only visible
  trace is that it no longer appears pending.

- **PLT-APR-07** — Request-modification's consequence — status transition
  confirmed, but with no UI path forward.
  **Pre**: `SUPERVISOR`-role user (PLT-CALLOUT), a fresh pending request
  against their role.
  **Steps**: Type a note, e.g. "أضف تفاصيل الشحن"; click "طلب تعديل".
  **Assert**: Row disappears from pending; response shows `status:
  "modification_requested"`, decision kind `request_modification` recorded.
  **Then check the gap**: there is no "طلباتي" (my requests) screen, no
  resubmit button, and no hook anywhere in `apps/web/src` wired to `GET
  /workflow/requests/mine` (`useSubmitApproval` exists in `data/hooks.ts` but
  is never imported by any screen) — despite `resubmit()` existing and being
  fully implemented in `packages/domain/src/workflow/gate.ts`. **A request
  that comes back "modification_requested" is, from this build's UI, a dead
  end**: the submitter has no way to see it, edit it, or resubmit it through
  the product. This is the task brief's "returns it editable to its
  submitter" behavior — confirmed NOT IMPLEMENTED on the UI side; the domain
  logic exists, nothing surfaces it.

- **PLT-APR-08** — Wrong approver — 403, cannot decide someone else's step.
  **Pre**: A second custom-role user whose role is NOT the step's required
  role (e.g. a `SALES_REP`-coded user, while the pending request needs
  `SUPERVISOR`).
  **Steps**: Sign in as this mismatched user; open الموافقات.
  **Assert**: The request is absent from THIS user's pending list entirely
  (`listPendingForRoles` filters by role match — it was never fetched to
  begin with, so there's no row to even attempt a decision on). If attempted
  directly via API (`POST /workflow/requests/:id/decide` with the wrong
  role), the server responds 409 `WRONG_APPROVER` from `decide()`'s
  `if (!step || !input.actorRoles.includes(step.role))` guard — worth
  confirming this maps to a sensible UI-level error if ever surfaced, though
  in practice the UI's own pending-list filtering prevents the click from
  ever being possible in the first place.

- **PLT-APR-09** — Multi-step chain — approving step 1 hands off to step 2's
  role, not to the same approver again.
  **Pre**: PLT-WFC-09's 2-step `SALES_INVOICE_CONFIRM` chain (step 1 =
  SUPERVISOR, step 2 = a second custom role); a fresh request submitted
  against it.
  **Steps**: As the SUPERVISOR-role user, approve step 1.
  **Assert**: The request does NOT disappear from ALL inboxes — it disappears
  from the SUPERVISOR user's pending list but becomes visible in the step-2
  role holder's pending list instead, now showing "الخطوة الحالية: 2 / 2".
  Sign in as the step-2 user and approve; only THEN does the request reach
  `status: "approved"` and vanish from every inbox. Confirms sequential
  (not parallel) approval — step 2 was never visible before step 1 resolved.

- **PLT-APR-10 [the bigger trap]** — A real gated document's "pending" state
  never reaches this inbox at all.
  **Pre**: `SALES_INVOICE_CONFIRM` workflow config active (seeded). Signed in
  as a non-admin user (any real custom-role user, e.g. the SUPERVISOR-role
  user themselves, or better, a THIRD user with no workflow permissions at
  all, to mirror an ordinary sales rep submitting).
  **Steps**: Create a sales invoice; click "تأكيد" (confirm) as this
  non-admin user.
  **Assert**: The invoice's own status becomes `"pending"` (بانتظار الموافقة)
  — `SalesInvoiceService.confirm`'s gate branch holds it locally
  (`this.deps.repo.update(held)`), matching the reference's expected
  behavior. **Then check the inbox**: it does NOT contain this invoice.
  `createDocumentWorkflowGate`'s `evaluate()` (used by every document type
  including sales invoices) calls the PURE `startApproval()` function
  directly and never persists anything to the `ApprovalRequestRepository`
  that `/workflow/requests/pending` reads from — confirmed by grepping the
  whole backend for any subscriber to the `DOCUMENT_SUBMITTED` event or any
  call to `submitApproval`/the repository from the document-confirm code
  path; there is none. **A document held pending by a real confirm action is
  invisible to this inbox and has no path to resolution anywhere in the UI**
  — no approve button on the document itself, no matching inbox row, no
  resubmit. It simply sits at status "pending" forever. This is a materially
  different (and more serious) finding than PLT-APR-01/02's admin-bypass
  trap: even a correctly-configured, correctly-non-admin submission produces
  a stuck document, not a working approval flow. The task brief's "a rejected
  document must not post" is technically true here (a stuck-pending document
  never posts either), but not for the reason intended, and there is no way
  to ever un-stick it through this build's UI. Recommend filing this as its
  own tracked defect (candidate D7) rather than folding it into an existing
  D-number — it touches sales invoices, purchase invoices, and every other
  document type wired through `DocumentService`/`SalesInvoiceService`'s
  identical gate pattern, not just one module.

- **PLT-APR-11** — Comment field has an accessible name (regression guard for
  `docs/defects.md` F6).
  **Steps**: Inspect the ملاحظة input's accessible name via devtools/a11y
  tree on any pending row.
  **Assert**: `aria-label="ملاحظة على الطلب <entity label or id>"` — present
  per-row, matching F6's fix ("the approvals note field had no accessible
  name — found the first time the inbox had a row to test"). If this
  regresses, it's exactly the class of defect F6 already fixed once.

- **PLT-APR-12 [NOT IMPLEMENTED]** — No visibility into decided (approved/
  rejected/modification-requested) requests anywhere in the UI.
  `GET /workflow/requests` (all) and `GET /workflow/requests/mine` both exist
  server-side and are fully gated/working, but neither has a corresponding
  `useQuery` hook or screen in `apps/web/src`. Once a request leaves the
  pending state — approved, rejected, or bounced for modification — its only
  remaining trace is the raw API response from the decide call itself. There
  is no "سجل الموافقات" / decision-history screen to browse later.

---

## 18 — Audit log (`الإعدادات ← سجل المراجعة`)

`AuditLogScreen.tsx`. Read-only over an append-only store (BEFORE UPDATE/DELETE
triggers `RAISE(ABORT)` at the storage layer per the component's own doc
comment) — there is no edit or delete affordance anywhere on this screen, by
design.

- **PLT-AUD-01** — Stats and stream chips.
  **Pre**: Populated audit trail (ordinary seed activity plus §9/§10's 7
  platform-admin actions, per §19).
  **Assert**: 3 stat cards — إجمالي حسب الفلاتر الحالية (respects active
  filters), أحداث الأمان, العمليات الحساسة (both independent of filters —
  they query `{ stream: "security", limit: 1 }` / `{ stream: "sensitive",
  limit: 1 }` purely for their `.total`, ignoring every other active filter
  deliberately, per the component's own comment); 3 status chips الكل/أحداث
  الأمان/العمليات الحساسة with matching counts.

- **PLT-AUD-02** — Row click opens a detail side panel.
  **Steps**: Click any row.
  **Assert**: `SidePanel` opens titled "تفاصيل الحدث" showing the full 8-field
  breakdown (timestamp, stream, module, entity type, action, actor, branch,
  severity) plus a "تفاصيل إضافية" block — either "لا توجد تفاصيل إضافية" or
  a pretty-printed JSON `<pre>` block of `selected.details`. Confirm the panel
  is read-only — no edit/delete action anywhere inside it.

- **PLT-AUD-03** — Filter: module (free text).
  **Steps**: Type "webhooks" into الوحدة filter.
  **Assert**: Only rows whose `module === "webhooks"` remain — from §10's
  seeded webhook create/patch actions (`recordSensitiveEvent({ module:
  "webhooks", ... })` in `webhooks-routes.ts`).

- **PLT-AUD-04** — Filter: action (free text).
  **Steps**: Type "REGISTERED".
  **Assert**: Matches the webhook-registration sensitive events specifically
  (action `"REGISTERED"` per `webhooks-routes.ts`'s `recordSensitiveEvent`
  call on `POST /webhooks`).

- **PLT-AUD-05** — Filter: entity type, severity, actor (search box).
  **Steps**: Set الكيان = "WEBHOOK"; separately test الخطورة dropdown across
  all 4 levels (حرج/خطأ/تحذير/معلومة); separately search the actor box for
  `USER-ADMIN`.
  **Assert**: Each filters independently and all combine via AND (confirm by
  stacking 2+ filters at once and checking the row count only narrows,
  matching the query-param assembly in `AuditLogScreen.tsx`'s `useAuditLog`
  call).

- **PLT-AUD-06** — Filter: date range (`من تاريخ` / `إلى تاريخ`).
  **Steps**: Set a `from`/`to` window that excludes today's seed-time events.
  **Assert**: Table narrows to zero rows / the correct subset; "مسح الفلاتر"
  resets every filter (including date range) back to `BLANK_FILTERS` in one
  click and resets to page 1.

- **PLT-AUD-07** — Filter: branch — the "all branches" requirement, proven
  against real data.
  **Pre**: At least one audit event with `branchId: null` (an event recorded
  by a code path that predates or doesn't carry branch context — check
  whether any seeded event qualifies; if none does by default, this can be
  produced by triggering an action through a route that never resolves
  `auditBranchFromScope`, e.g. certain platform-admin actions where
  `branchOf(c)` returns `null` because the actor's scope wasn't branch-scoped
  at the time) alongside at least one event with a real `branchId` set.
  **Steps**: Set الفرع filter to a SPECIFIC branch (not "كل الفروع").
  **Assert**: The `branchId: null` event(s) do NOT appear under this specific-
  branch filter — only events actually stamped with that branch's id show.
  **Steps (cont.)**: Reset الفرع filter back to "كل الفروع".
  **Assert**: The `branchId: null` event(s) reappear, rendering "—" in the
  table's الفرع column and "لم يُسجَّل فرع لهذا الحدث" in the detail panel —
  confirming events recorded before/without branch tracking are visible ONLY
  under the unfiltered "all branches" state, never under any specific-branch
  filter, exactly as the task brief specifies.

- **PLT-AUD-08** — Pagination.
  **Pre**: More than 25 events matching the active filter (`PAGE_SIZE = 25`).
  **Steps**: Clear all filters to maximize row count; page forward.
  **Assert**: `pageSummary` reads "عرض 25 من N حدث" on page 1; page-count and
  navigation controls reflect `Math.ceil(total / 25)`; changing any filter
  resets `page` back to 1 (`updateFilters` always calls `setPage(1)`).

- **PLT-AUD-09** — Severity taxonomy — all 4 levels render distinct tones.
  **Assert**: CRITICAL and ERROR both render danger-tone pills, WARNING
  warning-tone, INFO neutral-tone (`SEVERITY_TONE` mapping) — confirm at
  least one real CRITICAL row exists (an `ACCOUNT_LOCKED` event from repeated
  failed logins, if reproducible, or any other seeded CRITICAL-severity row)
  to actually see the danger tone rendered, not just assume the mapping from
  source.

- **PLT-AUD-10 [RBAC]** — `audit.logs.view` gate.
  **Pre**: A non-admin user without `audit.logs.view`.
  **Assert**: Same general pattern as PLT-ROL-15 — sidebar item visible and
  clickable (no client-side nav gating), screen mounts, `useAuditLog()` fails
  with 403 from `audit-routes.ts`'s `gate("audit.logs.view")`, and the danger-
  card-with-retry pattern renders instead of the table.

---

## 19 — Profile (`الإعدادات ← الملف الشخصي`)

`ProfilePage.tsx`. Self-service — every action scoped to the caller's own id
server-side, no permission gate, no user picker. This build adds a PIN
quick-login feature the reference never documented at all.

- **PLT-PRO-01** — Header summary fields.
  **Pre**: Signed in as `USER-ADMIN`.
  **Assert**: Title = full name, subtitle = email; status pill "مدير الشركة"
  success-tone (`isCompanyAdmin: true`); summary strip shows الرقم السري
  (مُفعّل/غير مُفعّل depending on whether a PIN is set — seed sets
  `SEED_ADMIN_PIN`, so expect "مُفعّل"), آخر تسجيل دخول, تاريخ الإنشاء.
  **Gap vs. reference**: there is no "الدور" (role) field anywhere on this
  screen — the reference showed a disabled/read-only role textbox; this
  build's header/summary/Info-tab has nothing equivalent, even though
  "مدير الشركة" is visible via the status pill as a proxy.

- **PLT-PRO-02** — Info tab: email is EDITABLE here — a real difference from
  the reference.
  **Steps**: Change البريد الإلكتروني to a new value; click "حفظ التغييرات".
  **Assert**: Unlike the reference (where email was a disabled/read-only
  textbox on this exact tab), this build's email field is a live, editable
  `TextField` with no `disabled` prop — the save succeeds and the header
  subtitle updates to the new email immediately. Confirm this is intentional
  self-service behavior and not an oversight, since changing your own login
  email with no re-verification step is a meaningfully different security
  posture than the reference's read-only field.

- **PLT-PRO-03** — Info tab: full name and phone.
  **Steps**: Edit الاسم الكامل and رقم الهاتف (optional, placeholder
  "اختياري"); save.
  **Assert**: Success message "تم حفظ بيانات الحساب."; header title updates
  to the new name.

- **PLT-PRO-04** — Info tab: save failure surfaces inline.
  **Steps**: Trigger a server-side rejection (e.g. an email format the
  backend rejects).
  **Assert**: Danger-tone inline message next to the save button with the
  server's error text (or a generic "تعذر حفظ البيانات." fallback) — no full
  page error, the form stays populated.

- **PLT-PRO-05** — Security tab: change password — happy path.
  **Steps**: Fill كلمة المرور الحالية correctly; كلمة المرور الجديدة (≥8
  chars per the hint); تأكيد كلمة المرور الجديدة matching; submit.
  **Assert**: Success message "تم تغيير كلمة المرور."; all 3 fields clear
  immediately after success (not left populated).

- **PLT-PRO-06** — Security tab: change password — mismatch guard.
  **Steps**: Enter a new password and a DIFFERENT confirmation string; submit.
  **Assert**: Client-side guard fires before any request: "كلمة المرور
  الجديدة وتأكيدها غير متطابقين." — no network call.

- **PLT-PRO-07** — Security tab: change password — wrong current password.
  **Steps**: Enter an incorrect كلمة المرور الحالية; valid new/confirm pair;
  submit.
  **Assert**: Server rejects; error message renders (server's message or the
  "تعذر تغيير كلمة المرور." fallback); fields are NOT cleared on failure
  (only cleared in the success branch) — confirm the user doesn't have to
  retype everything after a mistyped current password.

- **PLT-PRO-08** — Security tab: submit button disabled until both required
  fields are non-empty.
  **Assert**: "تغيير كلمة المرور" stays disabled while either كلمة المرور
  الحالية or كلمة المرور الجديدة is empty (`!currentPassword || !newPassword`
  — confirm/tأكيد is NOT part of this disabled-check, only checked at submit
  time per PLT-PRO-06).

- **PLT-PRO-09** — Security tab: set a PIN.
  **Steps**: In the الرقم السري (PIN) card, enter كلمة المرور الحالية
  (required to authorize the change) and a new 4–6 digit PIN; save.
  **Assert**: Success message "تم تغيير الرقم السري."; header's الرقم السري
  summary field flips to "مُفعّل" if it wasn't already.

- **PLT-PRO-10** — Security tab: clear the PIN by submitting blank.
  **Steps**: Enter كلمة المرور الحالية correctly; leave الرقم السري الجديد
  EMPTY; save.
  **Assert**: Success message differs on purpose: "تم إلغاء الرقم السري."
  (not the "changed" message) — `newPin.trim() === ""` sent as `null`; header
  summary flips back to "غير مُفعّل".

- **PLT-PRO-11** — Security tab: PIN save button requires only the current
  password, not the PIN field itself.
  **Assert**: "حفظ" under the PIN card is disabled only on
  `!pinCurrentPassword` — an empty new-PIN field does NOT disable it (that's
  the intentional "clear PIN" path from PLT-PRO-10, not a validation
  failure).

- **PLT-PRO-12** — Activity tab: 7 seeded entries, precisely accounted for.
  **Pre**: Demo seed's `PLATFORM_ADMIN` (`USER-ADMIN`) actions in
  `demo-seed/platform.ts`: 3× `POST /api-keys` (create), 1×
  `POST /api-keys/:id/revoke`, 2× `POST /webhooks` (create), 1×
  `PATCH /webhooks/:id` (deactivate) — exactly 7 sensitive-audit-eligible
  actions attributed to this exact account (the seed's own comment explains
  WHY: these writes are deliberately run as `USER-ADMIN` rather than a
  synthetic seeder identity specifically so this tab has real content).
  **Steps**: Open النشاط tab.
  **Assert**: 7 rows, each showing an event label, module, severity pill, and
  timestamp — table columns الحدث/الوحدة/الخطورة/التاريخ, newest first (the
  `/profile/activity` endpoint sorts descending and filters `audit.query(...)`
  events down to `event.actor === callerId`). If the actual count differs
  from 7 when reproduced, that's a real discrepancy worth re-checking against
  the exact seed script version running — don't just trust this document's
  math over what the live screen shows.

- **PLT-PRO-13** — Activity tab: empty state for an account with no
  qualifying actions.
  **Pre**: A freshly-created ordinary user (PLT-USR-CREATE) who has never
  performed a security- or sensitive-audit-eligible action.
  **Steps**: Sign in as that user; open their own الملف الشخصي ← النشاط.
  **Assert**: "لا يوجد نشاط مسجّل على حسابك بعد." — confirms activity truly
  is scoped to actions THIS caller performed (`event.actor === callerId`),
  not a tenant-wide feed.

---

## Summary — every `[NOT IMPLEMENTED]` and structural gap in this pass

| Area | Gap | Scenario |
|---|---|---|
| General settings | No email/SMTP tab, no email-template HTML editor, no send-test-email | PLT-24 (section) |
| General settings | No standalone POS & loyalty / POS payment-methods tabs (folded/absent) | §4 intro |
| General settings | No company-logo upload | PLT-17 |
| General settings | No aging-based write-down toggle, no auto-batch-number toggle | PLT-20 |
| General settings | No multi-currency platform-admin-managed badge/explainer | PLT-24 |
| Branches | No edit form, no deactivate action | PLT-BRN-14 |
| Warehouses | No edit/deactivate action, no branch filter | PLT-WH-06 |
| Users | No role / branch / last-login filter panel | PLT-USR-09 |
| Users | No self-deactivation guard confirmed | PLT-USR-06 |
| API Keys | No rate-limit field, no Connected Apps/OAuth table | PLT-API-08 |
| Webhooks | No description field | PLT-WHK-12 |
| Webhooks | Retries can outlive shutdown (known, D6) | PLT-WHK-11 |
| Notification rules | No edit-existing-rule action | PLT-NOT-09 |
| Notification rules | No event/priority filter dropdowns | PLT-NOT-10 |
| Barcode config | No EAN-13 check-digit toggle, no max-value sanity cap | PLT-BAR-09 |
| Print templates | Preview only ever renders one fixed sample invoice; no doc-type preview selector | PLT-PRT-02 |
| Print templates | No retry on load failure | PLT-PRT-14 |
| Data migration | Commit is all-or-nothing per file, not per row (contradicts a literal reading of "commit the valid rows") | callout, PLT-MIG-04/06/12 |
| Data migration | `employees.xlsx`/`items.xlsx` fixtures reject their own "valid" rows | callout, PLT-MIG-06/12 |
| Data migration | `items.xlsx`'s non-numeric-price test is masked by the unit-code bug | PLT-MIG-12/13 |
| Data migration | Historical `partyId` is never validated against a real customer/supplier | PLT-MIG-18 |
| Data migration | The 4 historical fixtures are identical placeholders, no invalid rows | PLT-MIG-17 |
| Workflow config | (none found — full CRUD, exceeds the reference) | — |
| Approvals inbox | Decide-side admin bypass ignores reject/request-modification entirely | PLT-APR-03 |
| Approvals inbox | **Real document confirms never create an inbox-visible request at all** — the gate and the inbox are disconnected for every document type | PLT-APR-10 |
| Approvals inbox | `modification_requested` has no resubmit UI anywhere (`useSubmitApproval` unused) | PLT-APR-07 |
| Approvals inbox | No decision-history / "my requests" screen (`GET /workflow/requests`, `/mine` unused) | PLT-APR-12 |
| Approvals inbox | Decisions are never written to the Audit Log (`workflow-routes.ts` calls no `recordSensitiveEvent`) | PLT-APR-04/05 notes |
| Audit log | (none found — matches/exceeds the reference) | — |
| Profile | No role field shown | PLT-PRO-01 |
| Profile | Email is editable (differs from reference's read-only field — flagged, not necessarily a defect) | PLT-PRO-02 |
| Global chrome | Language switcher is AR/EN only, no German/3rd locale | §1 intro |
| Global chrome | No URL routing at all — reload always returns to dashboard | intro |

**Recommend for `docs/defects.md`**: PLT-APR-10 (real gated documents never
reach the approvals inbox, across every document type) is the single most
severe finding in this pass and is not yet tracked as D1–D6. Everything else
above is either a smaller UI gap or a fixture-data defect in
`test-fixtures/data-migration/`, not a product defect.
