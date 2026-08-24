# Shell, Dashboard, Hubs & Reports — UI test scenarios

Sources: `docs/catalog/09-settings-dashboard-ux.md` (dashboard/global-UX half), `docs/catalog/08-reports.md`, and the running implementation — `packages/ui/src/shell/*`, `packages/ui/src/primitives/{ReportRunner,SidePanel,beams,Kbd}.tsx`, `apps/web/src/dashboard/*`, `apps/web/src/screens/hubs/*`, `apps/web/src/screens/reports/*`, `packages/domain/src/reports/*`, `apps/web/src/keyboard/*`, `apps/web/src/i18n/*`, `apps/web/src/nav-config.ts`, `apps/web/src/App.tsx`.

## How this build actually works (read before running anything below)

- **No URL routing.** `apps/web` is a single page; `App.tsx` holds `activeScreen` in React state and swaps components. There are no routes, no deep links, no browser back/forward, and a page **reload always lands on the dashboard** (`activeScreen` resets to `"dashboard"`) — only the *session*, the *theme*, the *locale*, the *rail-collapsed flag* and the *branch/warehouse scope selection* persist across a reload (each via its own `localStorage` key, noted per scenario). Where the catalog says "Route: `/reports/...`" that is the reference product's URL; this build reaches the same screen by clicking the sidebar item — there is no address bar to type into.
- **Bilingual scope**: the shell (sidebar, topbar, command bar, dashboard, `ReportRunner`) is fully bilingual through `apps/web/src/i18n` (`ar`/`en`, no third locale despite the catalog's 3-flag language menu — see SHL-18). Every hub screen, every domain screen (Items, Suppliers, Journals, …) and every report's own title/columns are **hardcoded Arabic strings** — switching to English does not translate them. This is expected, not a bug; scenarios below say so at the point it would otherwise look like a defect.
- **Report parameter surface is narrower than the catalog documents.** The catalog was captured against a different, richer reference build. In this build every report's parameters come from one shared `ReportRunnerParamField` contract (`date`, `dateRange`, `select`, `text`) rendered by `<ReportRunner>` — there are no quick period-preset chips (هذا الشهر / آخر 3 أشهر …), and most of the category/branch/channel dropdowns and named-entity search boxes the catalog describes do not exist; several reports substitute a **plain text box asking for a raw internal ID** (`warehouseId`, `itemId`) where the catalog shows a picker. Each report's scenario below states the params as they actually render, verified against `packages/domain/src/reports/*.ts`, not the catalog.
- **Default date bounds are a hardcoded constant, not "today."** `SalesReportsScreens.tsx`, `PurchasesReportsScreens.tsx`, `InventoryReportsScreens.tsx`, `AgingReportsScreens.tsx`, `InstallmentsReportsScreens.tsx`, `FieldSalesReportsScreens.tsx` and `FinancialReportsScreen.tsx` all default their date range to the literal string `2026-08-22` (month-start `2026-08-01`). Only the **standalone** `TrialBalanceReportScreen` (`trial-balance-report` nav item) computes `new Date().toISOString().slice(0,10)` live. Every scenario that opens a report for the first time should note the as-loaded date is `2026-08-22`/`2026-08-01`, not the actual current date — on any day after 2026-08-22 the default window silently excludes the most recent transactions until the user manually extends it.
- **Reference defects that will fire** — noted once, not re-filed (`docs/defects.md`):
  - **D1** (`amountPaid` never updates on a confirmed collection voucher) inflates every figure this build derives from `SalesInvoiceDTO.remainingBalance` client-side: the dashboard's needs-attention "overdue"/"due soon" amounts (`useAttentionData` in `dashboard-hooks.ts`), and the Sales hub's "مبالغ مستحقة من العملاء" tile. It does **not** affect `GET /dashboard/summary`'s own `gl.receivables`, which is GL-sourced server-side.
  - **D4** (`occurredAt` is `now()` on confirm, not the document date) is the cause of spurious rows in **RPT-16** (Inventory Valuation Drift).

---

## Shell — Sidebar & navigation

### SHL-01 — Every nav entry reaches a screen with a matching heading
**Pre**: Logged in, rail expanded, no group collapsed beyond the shipped defaults (`settings` and `system` start collapsed).
**Steps**: Click the top item, then every item in every group, one at a time (117 destinations below: 1 top item + 17 groups). For each, read the destination screen's `<h1>`.
**Assert**: Every click renders a screen with an `<h1>` whose text equals the clicked item's label. No click is a no-op and none throws to a blank page.

| Group | Items (label → expected `<h1>`) |
|---|---|
| *(top)* | لوحة التحكم |
| سير العمل | الموافقات |
| المبيعات | نظرة عامة، العملاء، عروض الأسعار، فواتير المبيعات، مرتجعات المبيعات، قوائم الأسعار، العروض |
| المشتريات | نظرة عامة، الموردون، طلبات عروض الأسعار، أوامر الشراء، استلام البضائع، فواتير المشتريات، مرتجعات المشتريات، التكاليف الإضافية |
| المخزون | نظرة عامة، الأصناف، أرصدة المخزون، تحويلات المخزون، تسويات المخزون، الجرد الفعلي، منتجات قابلة للتهيئة، قوالب المنتجات، المواصفات، طباعة الملصقات، هبوط قيمة المخزون |
| التصنيع | نظرة عامة، لوحة الإنتاج، أوامر التصنيع، قوائم المواد، التصنيع المخصص |
| المحاسبة | نظرة عامة، دليل الحسابات، مراكز التكلفة، أرباح مراكز التكلفة، القيود المحاسبية، الفترات المالية، الضرائب، أسعار الصرف، إعادة تقييم العملات الأجنبية، مطابقة الأرصدة، الفاتورة الإلكترونية، ميزان المراجعة، التقارير المالية |
| الخزينة | نظرة عامة، حسابات الخزينة، السندات النقدية، تسوية كشوف البنك |
| الأوراق المالية | سجل الشيكات |
| إدارة علاقات العملاء | نظرة عامة، العملاء المحتملون، الفرص، خط المبيعات، مراحل خط المبيعات، الأنشطة |
| الموارد البشرية | لوحة الموارد البشرية، الموظفون، الأقسام، المسميات الوظيفية، العقود، الإجازات الرسمية، الحضور والانصراف، الرواتب، سلف الموظفين، طلبات الإجازات، أرصدة الإجازات، استحقاقات الإجازات، سياسات الإجازات، إجازاتي |
| المشاريع | المشاريع والمقاولات |
| الأصول الثابتة | نظرة عامة، سجل الأصول، الإهلاك، تصنيفات الأصول |
| المبيعات الميدانية | رحلات المندوبين |
| الأقساط | خطط الأقساط، متابعة التحصيل |
| التقارير (22 items) | المبيعات حسب الفترة، المبيعات حسب الصنف، المبيعات حسب العميل، المبيعات حسب المندوب، أفضل المنتجات، المشتريات حسب الفترة، المشتريات حسب المورد، المشتريات حسب الصنف، مستويات المخزون، حركة المخزون، سجل المخزون، تقييم المخزون، أعمار المخزون، أصناف قاربت على الانتهاء، أصناف بطيئة الحركة، انحراف تقييم المخزون، أعمار ديون العملاء، أعمار ديون الموردين، نظرة عامة على الأقساط، الأقساط المتأخرة، مبيعات المندوبين، التصنيع أم الشراء |
| الإعدادات *(starts collapsed)* | عام، الفروع، المستودعات، قوالب الطباعة، قواعد الإشعارات، نقل البيانات، إعدادات الموافقات، تسلسلات الترقيم، إعدادات الباركود، الملف الشخصي، مفاتيح API، الويب هوك، سجل المراجعة، المستخدمون، الأدوار والصلاحيات |
| النظام *(starts collapsed)* | حالة النظام |

**Note**: this table is 113 destinations (1 + 112 group items), close to but not exactly the "~101" figure — count them from `apps/web/src/nav-config.ts` (`buildNavGroups`) if the nav tree changes; this table is the ground truth at time of writing, not the catalog's older count. المستخدمون/الأدوار are not `ROUTABLE_SCREENS` entries (they're a 3-state machine alongside it — "users"/"roles"/"role-editor") but are still reachable and headed exactly like every other item.

### SHL-02 — Group collapse/expand
**Pre**: Rail expanded.
**Steps**: 1) Click the "المبيعات" group header. 2) Click it again. 3) Reload the page.
**Assert**: 1) The group's items disappear, the chevron rotates, `aria-expanded="false"`. 2) Items reappear, `aria-expanded="true"`. 3) The group is back to its *default* collapsed state (expanded, since "sales" has no `defaultCollapsed`) — **not** whatever state it was left in before reload. Group collapse state is plain `useState` (`Sidebar.tsx`), never persisted; only the rail-wide collapse (SHL-03) survives a reload.

### SHL-03 — Rail collapse to icon-only, persisted
**Pre**: Rail expanded (default).
**Steps**: 1) Click the rail-toggle button (top of the sidebar, next to the brand mark). 2) Observe every rail section. 3) Reload the page.
**Assert**: 1) The rail animates from 264px to 76px (`transition-[width]`); labels disappear from nav rows, the group headers, the tenant chip, the scope switchers and the user footer — only icons/monogram glyphs remain, each carrying a `title` tooltip with the full label. 2) The brand name, tenant name and every nav-item label are gone from the DOM (not just visually hidden — `showLabel={expanded}` conditionally omits them). 3) After reload the rail is **still collapsed** — `localStorage["mezan.sidebarCollapsed"] === "1"` persists it (`Sidebar.tsx`), independent of the screen-reset-to-dashboard behaviour noted above.

### SHL-04 — Active indicator follows the current screen
**Pre**: On the dashboard.
**Steps**: Navigate to "فواتير المبيعات", then to "التقارير" → "المبيعات حسب الفترة".
**Assert**: At every step exactly one nav row carries `aria-current="page"`, a highlighted background (`bg-chrome-active`) and a 3px brass bar (`bg-chrome-accent`) on its leading edge — and it is always the row just clicked, never a stale one. While on "الأدوار والصلاحيات" → "role editor" (a screen with no nav entry of its own), the "الأدوار والصلاحيات" row stays the active one (`App.tsx`: `activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}`).

---

## Shell — Scope switchers (branch / warehouse)

These sit at the **top of the sidebar rail** (moved off the topbar in this build), and are real `<select>`s wired to `apps/web/src/data/hub-hooks.ts` `useScopeSelector` → `ApiContext`'s `scopeSelection` → `authHeaders()` (`apps/web/src/data/session.ts`), which stamps `x-branch-scope` / `x-warehouse-scope` on **every** subsequent API request. This is not cosmetic — verify it as such.

### SHL-05 — Branch scope narrows real data, and persists
**Pre**: A tenant seeded with **2+ active branches** and data that differs between them (e.g. sales invoices posted against different branches). Note the current row count/figure on a branch-scoped screen (e.g. "فواتير المبيعات").
**Steps**: 1) Open the branch selector at the top of the rail, pick a specific branch (not "كل الفروع"). 2) Re-read the same screen's row count/figure. 3) Open a second terminal and `curl` the same list endpoint twice — once with `x-branch-scope: *` and once with `x-branch-scope: <chosen-branch-id>` (headers from `authHeaders`) — and diff the JSON. 4) Reload the page.
**Assert**: 2) The on-screen count/figure **changes** to a value that matches the `curl`ed branch-scoped response in (3) — not merely a relabelled chip showing the branch name while the underlying rows stay identical. 3) The two `curl` responses genuinely differ in row count or total. 4) After reload the branch selector still shows the previously chosen branch (`localStorage["mezan.scopeSelection"]`), and the screen still shows the narrowed figure — the selection is not silently reset to "all" on reload. If this scenario ever finds the on-screen number identical before/after step 1 while the `curl` diff in step 3 is non-empty, that is the switcher regressing to "relabel only" — file it.

### SHL-06 — Warehouse scope narrows real data, cascades from branch, persists
**Pre**: 2+ active warehouses under different branches.
**Steps**: 1) With no branch chosen, open the warehouse selector — note the full option list. 2) Pick a branch. 3) Re-open the warehouse selector. 4) Pick a specific warehouse and open an inventory screen (e.g. "أرصدة المخزون" or the "مستويات المخزون" report). 5) Reload.
**Assert**: 3) The warehouse option list is now filtered to only that branch's warehouses (`useScopeSelector`: `w.branchId === scopeSelection.branchId`) — a strictly shorter or equal list than (1). 4) The inventory screen's rows/values change to the warehouse-scoped subset (cross-check via `curl` with `x-warehouse-scope` as in SHL-05). 5) Both the branch and warehouse choice survive reload. Also verify: switching the branch to one that does **not** contain the currently-selected warehouse clears the warehouse selection back to "كل المستودعات" (`setBranch`'s `stillValid` check) rather than silently sending a stale, now-invalid warehouse id.

---

## Shell — Command bar

Lives inline in the topbar (always visible — there is no longer a modal-only palette; `Topbar.tsx`'s `onOpenCommandPalette` prop is accepted for source compatibility only).

### SHL-07 — ⌘K / Ctrl+K focuses the command bar from anywhere
**Pre**: Any screen, focus somewhere in the page body (not inside the command bar).
**Steps**: Press `Ctrl+K` (or `⌘K` on macOS).
**Assert**: The command bar's `<input role="combobox">` receives focus, its text is selected, and the results panel opens (`aria-expanded="true"`) even with an empty query, showing the grouped item list.

### SHL-08 — Filtering and keyboard navigation
**Pre**: Command bar open (via SHL-07 or a click).
**Steps**: 1) Type "قيود". 2) Press `ArrowDown` twice, `ArrowUp` once. 3) Press `Enter`. 4) Reopen and press `Escape`.
**Assert**: 1) The list narrows live to items whose label contains the query (case-insensitive) — "القيود المحاسبية" survives, unrelated items don't. 2) `aria-activedescendant` and the highlighted row move accordingly, clamped at the list bounds (never past the last item, never below 0). 3) The highlighted item's `onSelect` fires and the panel closes. 4) `Escape` closes the results panel without clearing the query field itself (`setOpen(false)` only).

### SHL-09 — Routes to screens and create-actions (narrow set — verify, don't over-assume)
**Pre**: Command bar open.
**Steps**: Run each of the 5 real entries: "فاتورة مبيعات جديدة", "سند نقدي جديد", "دليل الحسابات", "القيود المحاسبية", and the shortcuts entry (hint `?`).
**Assert**: The first two navigate to "فواتير المبيعات"/"السندات النقدية" **with their create panel already open** (`navigate(screen, "create")`); the next two navigate to "دليل الحسابات"/"القيود المحاسبية" plainly; the last opens the `?` shortcuts overlay (SHL-10) instead of navigating. **`[NOT IMPLEMENTED]`**: the catalog's command palette is "the most complete map of the app's page inventory" (~80 pages, including per-module overview dashboards, an inbox, audit logs). This build's `commandItemSpecs` (`nav-config.ts`) hard-codes exactly these 5 entries — typing the name of any other screen (e.g. "الموردون", "المشتريات") returns **no results**, not a fuzzy-matched page link. Do not expect the command bar to reach arbitrary screens; only the sidebar does.

---

## Shell — Keyboard shortcuts

`apps/web/src/keyboard/useGlobalShortcuts.ts` is the single global `keydown` listener, wired once from `App.tsx`.

### SHL-10 — `?` opens the shortcut list, Esc closes it
**Pre**: Focus on the page body (not a text field).
**Steps**: 1) Press `?`. 2) Read both columns. 3) Press `Escape`.
**Assert**: 1) The `ShortcutsOverlay` dialog opens (`role="dialog"`, `aria-modal="true"`), focus moves to its close button. 2) The left column lists the fixed global keys — `⌘/Ctrl+K` (or the platform-correct modifier via `modKeyLabel()`), `⌘/Ctrl+N`, `⌘/Ctrl+S`, `/`, `J+K`, `Esc`, `?` — each with the correct label; the right column lists one row **per nav group that has a routable item**, each showing `g` + a single derived letter (see SHL-11) and the group's label. This list is generated from the *live* nav tree (`buildModuleJumps`), so it is guaranteed to be in sync with SHL-01's table — if in doubt, read the letters from here rather than memorising them. 3) `Escape` closes the dialog and all global shortcuts (which are `disabled` while it's open) resume working.

### SHL-11 — `g` then a letter jumps between modules
**Pre**: Focus on the page body. Open `?` first (SHL-10) to read the current letter for two or three groups, e.g. "لوحة التحكم" and one module hub.
**Steps**: 1) Press `g`, then within one second press the letter shown next to "لوحة التحكم" while on some other screen. 2) From the dashboard, press `g` then wait **over** 1000ms, then press a valid module letter.
**Assert**: 1) The screen navigates to the dashboard (or whichever group's first routable item, typically its hub) — matching exactly what the `?` overlay showed for that letter. 2) Because the chord has a 1-second window (`CHORD_TIMEOUT_MS`) and disarms itself via `setTimeout`, the late letter press does **nothing** — the screen does not navigate (it's treated as a fresh, unchorded `g` immediately followed by an unrelated key). Also verify a doubled `g g` does not navigate — `g` is deliberately excluded as a target letter (`pickLetter`/`firstFreeLetter` both skip `'g'`).

### SHL-12 — `/` focuses the in-page search, falling back to the command bar
**Pre**: On a screen with its own search/filter input, e.g. "فواتير المبيعات". Focus on the page body.
**Steps**: 1) Press `/`. 2) Navigate to a screen with **no** in-page search box (e.g. "لوحة التحكم" itself, or "التقارير المالية"'s trial balance tab, which has only date/account params — none marked `data-mz-search` or `type=search`/`text` inside `<main>` if the report has zero text params). Press `/` again.
**Assert**: 1) The screen's own search input receives focus and its contents are selected (`findSearchInput` prefers `[data-mz-search]`, then `input[type=search|text]` inside `<main>`). 2) With no in-page candidate, focus lands on the topbar's command-bar input instead (the documented fallback) — never a thrown error, never a silent no-op.

### SHL-13 — `j`/`k` move the table selection — currently a dead shortcut
**Pre**: Any screen with a `DocumentList`-based table with 2+ rows, e.g. "الموردون".
**Steps**: Click into empty page space (not a field), then press `j`, then `k`, then `Enter`.
**Assert**: `[NOT IMPLEMENTED]` — the keys **do** get intercepted (no character is typed anywhere, `event.preventDefault()` fires) and a `mz:list-nav` `CustomEvent` is dispatched on `window` with `{action: "next"|"prev"|"open"}` (`shortcuts.ts` `emitListNav`), but **nothing in the codebase listens for it** — `packages/ui/src/primitives/DocumentList.tsx` has no `mz:list-nav` handler despite the code comment claiming it does. Assert explicitly: no row gets a visible focus/selection ring after `j`, and `Enter` opens nothing. This is a real, verifiable gap distinct from "works but I didn't test it" — grep the repo for `mz:list-nav` before re-testing after a fix lands.

### SHL-14 — ⌘N creates on a screen that has a create flow
**Pre**: none.
**Steps**: 1) On "فواتير المبيعات" (one of the six screens wired via `useScreenIntent`: goods-receipts, purchase-invoices, purchase-orders, sales-invoices, sales-quotes, treasury-vouchers), press `⌘N`/`Ctrl+N`. 2) On a screen with no create flow of its own, e.g. "الموردون", press `⌘N`.
**Assert**: 1) The screen's own create panel/side-panel opens directly. 2) `⌘N` instead navigates to "فواتير المبيعات" **with its create panel open** — the documented fallback (`DEFAULT_CREATE_SCREEN = "sales-invoices"`), not a no-op and not an error. Also verify the browser's own "new window/tab" shortcut never fires — `event.preventDefault()` runs before any fallback logic.

### SHL-15 — ⌘S saves an open form and never shows the browser's Save dialog
**Pre**: A create/edit panel open on any of the six intent-registered screens, with the form focused.
**Steps**: 1) Fill required fields, press `⌘S`/`Ctrl+S`. 2) With no form open anywhere on screen (e.g. plain "لوحة التحكم"), press `⌘S`.
**Assert**: 1) The nearest `<form>` (`findDocumentForm`: the one owning current focus, else the first one inside an open `role="dialog"`, else the first visible form on the page) receives `.requestSubmit()` and the record saves. 2) `event.preventDefault()` still runs **unconditionally** on the mod+S combo even when `findDocumentForm()` returns `null` — the browser's native "Save Page As…" dialog must **never** appear, on any screen, at any time, form or no form. This is the one keyboard rule with zero exceptions; test it on at least three unrelated screens including one with no form at all.

### SHL-16 — Typing guard: literal text wins over shortcuts
**Pre**: Any text `<input>`, `<textarea>`, `contenteditable`, or `role="textbox"`/`role="combobox"` field with focus — e.g. a customer-name field in a create panel, or the command bar itself.
**Steps**: Type the literal string `gis` into the field, character by character.
**Assert**: All three characters (`g`, `i`, `s`) appear in the field's value, in order, and the app does **not** navigate, does not open the shortcuts overlay, and does not arm a `g`-chord — `isTypingTarget(event.target)` short-circuits the whole handler for bare letters while a text-accepting element has focus (`useGlobalShortcuts.ts`: `if (event.altKey || typing) { if (typing) disarmChord(); return; }`). Also verify from within the same field: `Escape` still works (blurs a `/`-focused search field and clears its marker), and `⌘K`/`⌘N`/`⌘S` still fire even while typing (mod-combos are explicitly allowed regardless of `typing`).

---

## Shell — Theme

### SHL-17 — Theme toggle, persisted
**Pre**: Default (light) theme, i.e. no `mezan.theme` key or value `"light"`.
**Steps**: 1) Click the theme toggle at the foot of the sidebar rail. 2) Reload. 3) Click it twice more.
**Assert**: 1) `document.documentElement[data-theme]` flips to `"dark"`, every dark-mode token takes effect (surfaces, ink colours), and the icon swaps from sun to moon. 2) After reload the theme is still dark — `localStorage["mezan.theme"] === "dark"` persists it (`useTheme.ts`). 3) Toggling twice more returns to light, then dark again — simple two-state flip (no `"system"` UI is exposed even though `useTheme` supports it programmatically).

---

## Shell — Language / RTL–LTR

### SHL-18 — Language toggle flips locale and direction live, persisted
**Pre**: Default Arabic/RTL (`localStorage["mezan.locale"]` unset or `"ar"`).
**Steps**: 1) Click the language button in the topbar (single icon button, not a dropdown — shows "EN" while in Arabic). 2) Observe the whole shell. 3) Reload. 4) Click it again to switch back.
**Assert**: 1) `document.documentElement` flips `lang="en"` / `dir="ltr"` **instantly, with no reload** (`I18nProvider`'s `useLayoutEffect`) — the sidebar moves to the left, icons/chevrons mirror, and every shell string translated in `apps/web/src/i18n/catalog.ts` (nav labels, dashboard copy, command-bar placeholder, shortcuts overlay, `ReportRunner`'s own chrome: export buttons, "عرض التقرير"/"Run report", empty-state text) switches to English. 3) After reload the language is still English (`mezan.locale` persists it) — independent of, and orthogonal to, the theme and rail-collapse persistence. 4) Switching back restores Arabic/RTL exactly.
**`[NOT IMPLEMENTED]` / scope note**: the catalog documents a 3-flag dropdown (العربية 🇪🇬 / English 🇺🇸 / Deutsch 🇩🇪); this build supports exactly two locales (`ar`/`en`, `packages/ui/src/i18n/locale.ts` `LOCALES`) via a single toggle button, no German. **Also expected, not a bug**: switching to English does not translate screen bodies — hub screens, list/report screens (Items, Suppliers, Journals, every report's title/columns/param labels) are hardcoded Arabic strings that never call `t()`. Confirm this precisely: after switching to English, the *shell* (sidebar labels, topbar, dashboard, the `ReportRunner` chrome around every report) is English, but the moment you open e.g. "الموردون" or any report's own column headers, they remain Arabic. That split is the intended, current scope — don't file it as a bug, but do verify the split lands exactly at that boundary and no shell string leaks Arabic (or vice versa) inside it.

---

## Shell — Notifications

### SHL-19 — Bell, panel, tabs, mark-all-read
**Pre**: A tenant with several unread notifications.
**Steps**: 1) Read the bell's badge and `aria-label`. 2) Click the bell. 3) Switch to the "غير مقروء" tab. 4) Click one unread item. 5) Click "تحديد الكل كمقروء". 6) Click outside the panel.
**Assert**: 1) The badge itself is a plain **dot** (`h-[7px] w-[7px]` circle), not a rendered count — the actual unread count only exists in the `aria-label` text (`t("shell.notifications.withCount", {count})`). If a scenario expects a "9+"-style visible number on the bell face itself, that's the catalog's older UI, not this one. 2) The dropdown opens (`role="dialog"`) anchored under the bell, header shows the true unread count as a number. 3) The list re-fetches filtered to unread only, and the tab label repeats the count (`غير مقروء {N}`). 4) Clicking an unread item calls the mark-read mutation for that one id (unread ones only — already-read items don't re-fire it) — but does **not** navigate anywhere; there is no click-through from a notification to its source document. 5) All items in the current tab become read; the header badge count drops to 0. 6) The panel closes on outside click.
**`[NOT IMPLEMENTED]`**: the panel's own "عرض جميع الإشعارات" footer button is part of `NotificationsPanel`'s API but `apps/web/src/notifications/NotificationsBell.tsx` never passes `onViewAll` — the button **does not render at all**, and there is no full notifications page to view. The catalog documents this button as present; confirm it is genuinely absent here (not merely disabled).

---

## Shell — User menu

### SHL-20 — Menu contents, Escape closes with focus return
**Pre**: none.
**Steps**: 1) Click the user avatar/name button. 2) Press `Escape`. 3) Reopen, click "تسجيل الخروج".
**Assert**: 1) A dropdown opens with the user's name/role header, then "المستخدمون", "الأدوار", "الإعدادات العامة", a separator, and "تسجيل الخروج" in danger styling. 2) `Escape` closes the menu **and returns focus to the trigger button** (`TopbarMenu.tsx`), not to `<body>`. 3) Sign-out clears the session and returns to the login screen with `activeScreen` reset to `"dashboard"` for the next login.

---

## Dashboard

Every figure comes from `GET /dashboard/summary` (KPI strip + beam + system data + recent activity) or from the **same live report endpoints the report screens themselves call** (`apps/web/src/dashboard/dashboard-hooks.ts`) — so every dashboard widget below has an independent report to reconcile against.

### DSH-01 — Header and quick actions
**Pre**: none.
**Steps**: Click each of the four quick-action buttons: "فاتورة جديدة", "سند نقدي", "استلام بضاعة", "عرض سعر".
**Assert**: Each navigates to its screen (فواتير المبيعات / السندات النقدية / استلام البضائع / عروض الأسعار respectively) with the create panel already open (`intent: "create"`). The greeting reads "مرحباً، {first name} · طاب يومك" using only the session user's first name (`firstNameOf`).

### DSH-02 — Period toggle changes every figure that depends on it
**Pre**: A tenant with postings in both the current and a prior month.
**Steps**: 1) Note the KPI strip, the beam's net figure, the aging matrix, the expense donut and the top-items list under "هذا الشهر". 2) Switch to "هذا العام". 3) Switch to "كل الفترات".
**Assert**: 2)/3) The KPI strip (revenue/expenses/net/cash), the beam's tilt and verdict text, the expense donut and the top-items list all **recompute** to the new window — `reportWindow()` maps "month" → current calendar month, "year" → Jan 1–Dec 31 of the current year, "all" → `1900-01-01`–`{year+50}-12-31` (an explicit wide bound, not an omitted one, precisely so every panel stays in agreement — see the "default date bounds" preamble note). The **aging matrix does not change** with the range toggle — it's an as-of-today snapshot (`useCustomerAging`/`useSupplierAging` take no window param) and should read identically across all three range choices; if it changes, that's a bug. Also verify the delta line under revenue/expenses/net compares against the correct **prior** window: prior-month for "هذا الشهر", prior-year for "هذا العام", and — since "all periods" has no predecessor — the delta line reads "لا توجد فترة سابقة للمقارنة" for "كل الفترات", never a stale or zeroed comparison.

### DSH-03 — KPI strip reconciles with `/dashboard/summary`, and is not clickable
**Pre**: none.
**Steps**: 1) Read the four KPI tiles (الإيرادات، المصروفات، صافي الربح، السيولة النقدية) and the three "على مستوى الشركة" tiles (مبالغ لدى العملاء، مستحقات الموردين، قيمة المخزون). 2) `curl /dashboard/summary` with the same date bounds and compare `gl.{revenue,expenses,netProfit,cash,receivables,payables,inventoryValue}`. 3) Click each tile.
**Assert**: 1)/2) Every displayed figure equals its `gl.*` field exactly (both are the same number, just formatted). Net profit renders in danger red with a "−" sign when negative, success/default otherwise. 3) `[NOT IMPLEMENTED]` — **no KPI tile is clickable**; `KpiTile`/`StatCard` never receive an `onClick`. The catalog's "each clickable — likely drills into a report" does not hold in this build; clicking does nothing (no cursor change, no navigation). Note per the preamble: مبالغ لدى العملاى/receivables here is the **GL-sourced** figure and is not the one D1 corrupts — don't conflate it with DSH-05's overdue amount.

### DSH-04 — Balance-beam hero tilts toward profit and reads out the net
**Pre**: A period with revenue ≠ expenses (any sign of net).
**Steps**: 1) Read the beam's `aria-label` and the verdict text beneath the centre figure. 2) Compare the beam's tilt direction against the sign of net profit. 3) Switch to a period where revenue equals expenses exactly, or where the tenant has no postings at all.
**Assert**: 1) `aria-label` reads exactly `"ميزان يميل نحو الربح · صافي {money}"` when net > 0, `"...نحو الخسارة..."` when net < 0, `"ميزان متعادل · صافي {money}"` at net = 0 — where `{money}` is the formatted net profit figure, i.e. the beam **reads out the net** as the task requires, not just an icon. The verdict line under the centre figure matches the same three-way split. 2) `beamTiltDegrees(revenue, expenses, net)` (`BalanceBeam.tsx`) is `0` only when `net === 0` or `revenue+expenses === 0`; otherwise its sign strictly follows the sign of net — assert the SVG's rotation angle is non-zero and its sign matches (a positive net must not render a beam tilted toward the loss side). 3) At an exact break-even or an all-zero period the beam renders level (`tilt = 0`) and the "متعادل" verdict shows — not a division-by-zero glitch. Also verify RTL mirroring: in Arabic (default) the revenue pan sits on the visual right (`revenueAtEnd = rtl = true`); after switching to English/LTR (SHL-18) the whole beam mirrors so revenue moves to the visual left, and the tilt direction is still correct for the same net sign (the component explicitly flips the rotation sign to compensate — `angle = revenueAtEnd ? tilt : -tilt`).

### DSH-05 — Needs-attention queue reconciles with its own linked screens
**Pre**: A tenant with at least one overdue sales invoice, one invoice due within 30 days, VAT payable > 0, one item at/under reorder point, and supplier balances aged past 30 days.
**Steps**: For each of the five rows (فواتير مبيعات متأخرة، تستحق خلال ٣٠ يوماً، ضريبة القيمة المضافة المستحقة، أصناف عند حد إعادة الطلب، مستحقات موردين تجاوزت ٣٠ يوماً): 1) note the displayed count/amount, 2) click its action button, 3) on the destination screen (or report), independently filter/read the same figure.
**Assert**: 1)/3) **Overdue**: count/amount = sales invoices with status not in `{draft, cancelled, reversed, paid}`, `remainingBalance > 0`, and `dueDate` strictly before today — cross-check against "فواتير المبيعات" filtered the same way (note the D1 caveat: this amount is `remainingBalance`-derived and is inflated for any invoice collected via a voucher, per the preamble). **Due soon**: same open-invoice set with `0 ≤ daysUntil(dueDate) ≤ 30`. **Tax due**: exactly `vat.grandTotals.tax` from the VAT-return report for the current window (RPT-28) — cross-check the two side by side. **Stock**: count of rows from "مستويات المخزون" (RPT-09) whose `status === "low"`, first-name shown matches that report's first low-stock row alphabetically-as-returned (not re-sorted). **Payables**: sum of the customer... i.e. supplier aging report's (RPT-19) `d31to60 + d61to90 + d91to120 + over120` across all rows — cross-check against that report's own bucket totals. 2) Every action button **navigates to the right screen** (فواتير المبيعات / فواتير المبيعات / التقارير المالية / تقرير مستويات المخزون / تقرير أعمار ديون الموردين respectively) but **does not pre-filter it** — there is no query param carrying "show me only the overdue ones." Assert explicitly: after the navigation, the destination screen shows its full unfiltered list; matching the attention-queue's number back to it requires the tester to apply the same filter/date window by hand, not a deep link doing it automatically. Also verify: with a tenant that has zero of a given condition, that row still renders (never hidden) with its "…clear" copy (e.g. "لا توجد فواتير متأخرة") and a neutral/success tone — the queue always shows exactly 5 rows.

### DSH-06 — Aging matrix reconciles exactly with the aging reports
**Pre**: A tenant with both AR and AP balances outstanding across at least two buckets.
**Steps**: 1) Read the dashboard's two-row (العملاء/الموردون) × five-bucket matrix. 2) Open "أعمار ديون العملاء" (RPT-18) and "أعمار ديون الموردين" (RPT-19), each with today as `asOfDate`, and read their grand-total rows.
**Assert**: The dashboard's "العملاء" row is byte-for-byte the customer report's `grandTotals` (`current`, `d31to60`, `d61to90`, `d91to120`, `over120`) — same for "الموردون" against the supplier report — since `AgingMatrix` is fed directly from `customerAging.data.grandTotals`/`supplierAging.data.grandTotals` with no client transform beyond bucket ordering. Also verify the heat tint: a zero-valued cell renders plain/untinted (`hot = value !== 0`), and among non-zero cells the tint strength scales with that cell's share of the largest single value on the whole matrix (`peak`), not per-row — so the single largest balance anywhere on the matrix should be visually the hottest cell.

### DSH-07 — Expense donut reconciles with the income statement
**Pre**: A period with 2+ distinct expense accounts posted to.
**Steps**: 1) Read the donut's centre total and its per-category legend rows (label, amount, %). 2) Open "التقارير المالية" → "قائمة الدخل" (RPT-25) for the exact same window, and sum every row whose `sectionKey !== "revenue"`.
**Assert**: The centre total equals that sum, and equals the dashboard's own "المصروفات التشغيلية" KPI tile (DSH-03) for the same window — all three numbers must agree, since `expenseSlices()`/`periodTotals()` both derive from the same income-statement fetch. Each legend row's % = its `value / total × 100`, rounded, and rows are sorted largest-first. On a period with zero expenses, the donut renders its empty-state text instead of a zero-radius circle.

### DSH-08 — Top items reconciles with the top-products report
**Pre**: A period with 5+ distinct items sold.
**Steps**: 1) Read the dashboard's top-5 ranked list (rank, name, qty, revenue). 2) Open "أفضل المنتجات" (RPT-05) for the same window with `limit=5`, sorted by revenue.
**Assert**: The two lists are identical in order, name, qty and revenue — the dashboard calls the exact same endpoint (`/reports/sales/top-products?dateFrom&dateTo&limit=5`) with no re-sort. Each row's progress bar width is proportional to `sharePercent`, clamped to a visible minimum of 2% even for a very small share.

### DSH-09 — Recent activity, no view-all
**Pre**: A tenant with recent posted journal entries.
**Steps**: Read the "النشاط الأخير" panel.
**Assert**: Entries show memo (falling back to entry number, then id) and date, newest first, sourced from `summary.recentActivity`. `[NOT IMPLEMENTED]`: there is no "عرض الكل"/view-all control on this panel in this build (the earlier catalog-aligned version had one; the current dashboard component has none) — confirm none renders, and that the list is capped at whatever `recentActivity` returns without a load-more affordance.

### DSH-10 — Footer disclaimer and branch-scope independence
**Pre**: A branch selected in the sidebar scope switcher (SHL-05), different from "كل الفروع".
**Steps**: Read the dashboard footer text, then compare the KPI strip's revenue figure with the branch selector set to a specific branch vs. "كل الفروع".
**Assert**: Footer reads "جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة" verbatim, and the claim holds: the dashboard's figures are **identical** regardless of the sidebar branch/warehouse scope selection — `useDashboardSummary` calls `/dashboard/summary` with only date params, no scope headers factored into its query key differently. This is the one place in the app where SHL-05/06's "scope must change the data" rule is *deliberately* not supposed to apply — don't mistake this for the switcher being broken; it's the dashboard being explicitly company-wide.

### DSH-11 — System data card
**Pre**: none.
**Steps**: Read the six tiles (حسابات دليل الحسابات، العملاء، الموردون، الأصناف، القيود المحاسبية، المستخدمون).
**Assert**: Each equals `summary.counts.{accounts,customers,suppliers,items,journalEntries,users}` — cross-check at least "العملاء" and "الموردون" against the actual row counts on "العملاء"/"الموردون" screens (unfiltered, all statuses).

### DSH-12 — Error and retry state
**Pre**: Force `/dashboard/summary` to fail (stop the backend, or a permission-denied session).
**Steps**: Load the dashboard, then click "إعادة المحاولة".
**Assert**: A card reads "تعذّر تحميل بيانات لوحة التحكم." with a retry button; every widget below it renders its own empty/zero state rather than crashing (all figures optional-chain to `0`/`[]`). Retry re-fires the query.

---

## Domain hubs

Every hub follows the same shape: 3–4 `StatCard`/inline KPI tiles computed client-side from the same list endpoints the domain's own screens use (never a separate summary endpoint, except Manufacturing which reuses `/manufacturing/dashboard`), a row of quick-action buttons (first one primary, each a plain `navigate()` — none carry `"create"` intent except where noted), and a "recent activity" list. None of the KPI tiles are clickable.

### HUB-01 — Sales hub
**Pre**: A tenant with sales invoices, quotes and customers.
**Steps**: Read the four tiles; click each of the five quick actions ("فاتورة مبيعات جديدة" primary، "عرض سعر جديد"، "قوائم الأسعار"، "العروض والترويج"، "مرتجعات المبيعات"); read "أحدث فواتير المبيعات".
**Assert**: "فواتير المبيعات" = `invoices.length` (unfiltered count, cross-check against the Sales-Invoices screen's own row count). "مبالغ مستحقة من العملاء" = sum of `remainingBalance` over invoices with status `confirmed`/`partially_paid` — **subject to D1**, confirm it against the actual invoice list rather than assuming it's correct. "عروض أسعار قيد الإرسال" = count of quotes with status `sent`. "عدد العملاء" = `customers.length`. Each quick action navigates to its screen (none open a create panel — plain navigation, unlike the dashboard's quick actions). "أحدث فواتير المبيعات" shows exactly the 5 most-recently-dated invoices, newest first, each linking customer name, date, doc number and grand total; with zero invoices it shows "لا توجد فواتير مبيعات بعد…".

### HUB-02 — Purchases hub
**Pre**: A tenant with POs, receipts, purchase invoices, suppliers.
**Steps**: Read the four tiles ("أوامر شراء مفتوحة"، "استلامات غير مفوترة"، "فواتير المشتريات"، "عدد الموردين"); click all five quick actions.
**Assert**: Figures match unfiltered counts on their respective screens (open POs = sent or partially-received; uninvoiced receipts = receipts without a linked purchase invoice). Quick actions ("أمر شراء جديد" primary، "استلام بضاعة"، "فاتورة مشتريات جديدة"، "طلب عرض سعر"، "مرتجعات المشتريات") all navigate correctly.

### HUB-03 — Inventory hub
**Pre**: A tenant with items across active/inactive states and stock value.
**Steps**: Read the three tiles ("عدد الأصناف"، "أصناف نشطة"، "قيمة المخزون"); click all four quick actions.
**Assert**: "قيمة المخزون" here is a **client-computed** figure (not the same code path as the dashboard's `gl.inventoryValue`, nor RPT-12's server-computed valuation) — cross-check all three against each other; they should agree in value even though computed three different ways, and if they don't, that's a real reconciliation gap worth its own defect entry (not pre-filed here). Quick actions ("صنف جديد" primary، "أرصدة المخزون"، "تحويل مخزون"، "جرد فعلي") all navigate correctly.

### HUB-04 — Manufacturing hub
**Pre**: A tenant with active work orders.
**Steps**: Read the four KPI cards ("أوامر تصنيع نشطة"، "قيمة الإنتاج تحت التشغيل"، "الوحدات المنتجة هذا الشهر"، "متوسط تكلفة الوحدة") and the "أوامر التصنيع النشطة" list (top 5); click "عرض لوحة الإنتاج الكاملة" and all four quick actions.
**Assert**: All four KPI cards come from the **same** `GET /manufacturing/dashboard` payload the Production dashboard (HUB-05) reads — the two screens must show byte-identical `kpis.{activeWorkOrders,wipValue,unitsProducedThisMonth,avgCostPerUnit}`, this is the one hub with a shared upstream summary rather than independent client aggregation. Overdue count subtitle ("N أمر متأخر عن الموعد المجدول") = `dashboard.overdueCount`. Each list row shows order number, priority label, produced/planned qty, and either a "متأخر" danger pill (if `overdue`) or a rounded progress-% info pill. "عرض لوحة الإنتاج الكاملة" navigates to `production-dashboard`.

### HUB-05 — Production dashboard (لوحة الإنتاج)
**Pre**: Same tenant as HUB-04.
**Steps**: Compare its four KPI tiles against HUB-04's. Read the three bucket lists ("بانتظار صرف المواد"، "بانتظار استلام المنتج"، "جاهزة للإنهاء") and the full active-orders table (رقم، تقدّم، أولوية، موعد مجدول، إجراء تالي).
**Assert**: KPIs match HUB-04 exactly (same source query). "أوامر متأخرة" tile renders in danger red only when `overdueCount > 0`. Each bucket list's badge count equals its row count. The table's "التقدّم" column shows `round(progress×100)%` alongside the raw produced/planned qty in parentheses; "الإجراء التالي" renders a button labelled per `nextAction` (بدء التنفيذ/صرف المواد/استلام المنتج/إنهاء الأمر) that navigates to "أوامر التصنيع" — or an em-dash when the order has no next action. Rows with `overdue: true` carry a "متأخر" pill next to the order number.

### HUB-06 — Accounting hub
**Pre**: A tenant with a chart of accounts, journal entries, fiscal periods.
**Steps**: Read the three tiles ("عدد الحسابات"، "القيود المحاسبية"، "الفترات المالية المفتوحة"); click all four quick actions.
**Assert**: "القيود المحاسبية" reuses `summary.counts.journalEntries` from the same `/dashboard/summary` call the main dashboard uses — cross-check the two are identical. "الفترات المالية المفتوحة" = count of fiscal periods with an open status, out of the total shown in the subtitle. Quick actions ("قيد محاسبي جديد" primary، "دليل الحسابات"، "ميزان المراجعة"، "التقارير المالية") navigate correctly — "ميزان المراجعة" here goes to the **standalone** `trial-balance-report` screen, not the tab inside "التقارير المالية" (see RPT-24's dual-entry-point note).

### HUB-07 — Treasury hub
**Pre**: A tenant with treasury accounts, vouchers, cheques.
**Steps**: Read the four tiles ("حسابات خزينة نشطة"، "السيولة النقدية"، "السندات المسجّلة"، "شيكات قيد التحصيل"); click all four quick actions.
**Assert**: "السيولة النقدية" here should equal the dashboard's own "السيولة النقدية" KPI (DSH-03) and `gl.cash` — cross-check. Quick actions ("سند نقدي جديد" primary، "حسابات الخزينة"، "تسوية كشف بنك"، "سجل الشيكات") navigate correctly.

### HUB-08 — CRM hub
**Pre**: A tenant with leads, opportunities, activities.
**Steps**: Read the four tiles ("عملاء محتملون جدد"، "الفرص المفتوحة"، "القيمة المتوقعة للفرص المفتوحة"، "أنشطة قيد الانتظار"); click all four quick actions.
**Assert**: Figures cross-check against unfiltered counts/sums on "العملاء المحتملون"/"الفرص"/"الأنشطة". Quick actions ("عميل محتمل جديد" primary، "فرصة جديدة"، "خط المبيعات"، "نشاط جديد") navigate correctly.

### HUB-09 — Assets hub
**Pre**: A tenant with registered fixed assets.
**Steps**: Read the four tiles ("عدد الأصول"، "أصول نشطة"، "إجمالي تكلفة الاقتناء"، "إجمالي الإهلاك المتراكم"); click all three quick actions.
**Assert**: Figures cross-check against "سجل الأصول". Quick actions ("أصل جديد" primary، "تشغيل إهلاك جديد"، "تصنيفات الأصول") navigate correctly.

### HUB-10 — System status (حالة النظام)
**Pre**: none.
**Steps**: 1) Read the overall status pill and the two live-checked service cards (API health, SQLite read). 2) Click "إعادة الفحص الآن". 3) Read "سجل الأعطال" and "آخر التحديثات".
**Assert**: 1) The overall pill reads "كل الأنظمة تعمل بشكل طبيعي" (success) only when **every** listed service is `operational`; any `degraded`/`down` flips it to "توجد مشكلة في أحد الأنظمة" (danger). Each service card's detail line states a real, freshly-measured latency (`قراءة فعلية ناجحة خلال {ms} مللي ثانية`) — this is a live check, not a cached flag; killing the backend mid-session and re-checking should flip the API card to `down`. 2) Re-check re-runs both probes and updates `آخر فحص` with a new timestamp. 3) "سجل الأعطال" always shows "لا توجد حوادث مسجّلة" with explanatory copy explaining there is no cloud incident-tracking system in this local-first desktop app — this is intentional, not a hidden failure. "آخر التحديثات" lists real commit-derived changelog entries (`RECENT_CHANGES`, hardcoded from `git log`), not live data — don't expect it to update without a code change. **`[NOT IMPLEMENTED]` relative to the catalog**: there is no "يوجد عطل في النظام" top-bar status indicator/red-dot anywhere in the shell (`Topbar.tsx` has no such control) — status is only visible by navigating to this screen, consistent with the screen's own explanation that this is an offline desktop app with no cloud status page to surface ambiently.

---

## Reports

**30 total: 22 operational (generic `<ReportScreen>`/`<ReportRunner>`) + Cost-Center P&L (bespoke) + 7 financial statements** (`packages/domain/src/reports/*.ts`, confirmed by file count — not the catalog's "33 across 8 domains", which includes a promotions report and POS reports this build never implemented; see RPT-31).

**Cross-cutting contract — true for every report below unless its own scenario says otherwise:**
- **Export** (تصدير CSV / تصدير Excel) is present and enabled once rows exist, disabled while empty/exporting. The file is named `{definition.id}.{csv|xlsx}` (e.g. `sales.by-period.csv`), and contains **only the raw data rows** — no group-subtotal or grand-total rows, and cell values are the raw numbers/strings the column's `value()` returns, **not** the on-screen formatted string (a money column exports as a plain number, not "1,234.00 ج.م"). "Export matches the screen" therefore means: exported row count = on-screen data-row count (excluding total/subtotal rows), and each exported value numerically equals its on-screen figure once you strip formatting.
- **Grand total row**: rendered automatically whenever the report has at least one column flagged `total: true`; it sums that column's raw values across every row. A report with **no** `total: true` column (Stock Ledger, Make-vs-Buy, Inventory Movement Drift's own descriptive columns) shows **no** total row at all — don't expect one.
- **Invalid parameter → specific error message**: this is **half-fixed**. `useFinancialReport` (`apps/web/src/data/financial-reports-hooks.ts`) parses a 400 response's `{errors: [{field, message}]}` body into `fieldErrors`, which `<ReportRunner>` renders as a labelled red banner under the header (F3's actual fix) — this works for RPT-24–30 (the 7 financial statements, including the standalone trial-balance screen). **`useReport`** (`apps/web/src/data/reports-hooks.ts`), used by **every one of RPT-01–22**, throws `new ApiError(status, "تعذّر تحميل التقرير.")` with **no third `fieldErrors` argument** — so for all 22 operational reports, an invalid parameter reproduces F3's *original* symptom: the screen just sits on its "لا توجد بيانات."/loading placeholder with no specific message telling the user what's wrong. Test this explicitly per operational report (send a malformed date, e.g. `dateFrom=not-a-date`) and confirm no banner appears — if one ever does, `useReport` has been fixed and this note is stale.

### المبيعات

**RPT-01 — المبيعات حسب الفترة** (`sales.by-period`, `/reports/sales/by-period`)
**Pre**: none. **Steps**: 1) Open the report — note the default `dateRange` is `2026-08-01`→`2026-08-22` (hardcoded, see preamble). 2) Change "التجميع" from يومي to أسبوعي to شهري. 3) Export CSV. 4) Set `dateFrom` to `not-a-date` in the network tab / by malformed URL param.
**Assert**: 1) Table columns: التاريخ، عدد المبيعات (qty total)، الإجمالي (money total)، الخصم (money total)، الضريبة (money total)، الصافي (money total) — all five numeric columns carry a grand total row. 2) Row grouping/bucketing changes (fewer, wider rows for شهري) and the grand totals stay constant across all three groupings (same underlying period, different bucketing). 3) `sales.by-period.csv` contains exactly the visible data rows, no total row. 4) Per the cross-cutting note: **no specific error banner** — placeholder/loading state only.

**RPT-02 — المبيعات حسب الصنف** (`sales.by-item`, `/reports/sales/by-item`)
**Pre**: none. **Steps**: Params are `dateRange` **only** — confirm there is no category/branch/channel filter despite the catalog. Change the date range narrower and wider; export.
**Assert**: Columns: الصنف، إجمالي الكمية المباعة (qty total)، الإيرادات (money total)، نسبة المساهمة (percent, not totalled). Narrowing the range strictly reduces or holds the row set and totals; export matches.

**RPT-03 — المبيعات حسب العميل** (`sales.by-customer`, `/reports/sales/by-customer`)
**Pre**: none. **Steps**: Toggle "عرض الإيرادات" between شامل الضريبة/غير شامل الضريبة (`taxMode=inc|exc`).
**Assert**: Columns: اسم العميل، عدد المبيعات (qty total)، الإجمالي (money total)، المستحق (money total, subject to D1 — cross-check against actual `remainingBalance`), نسبة المساهمة. Toggling tax mode changes الإجمالي's value (inclusive is ≥ exclusive) without changing row order or count.

**RPT-04 — المبيعات حسب المندوب** (`sales.by-salesperson`, `/reports/sales/by-salesperson`)
**Pre**: POS sales tagged with a salesperson at checkout (otherwise expect the empty state). **Steps**: Toggle عرض الإيرادات as in RPT-03.
**Assert**: Columns: المندوب، عدد الفواتير (qty total)، الإجمالي (money total)، خصم العروض (money total)، المستحق (money total)، نسبة المساهمة. With no tagged POS sales, table is empty but the report itself still "runs" (no error) — confirm the empty state is a deliberate no-data message, not a crash.

**RPT-05 — أفضل المنتجات** (`sales.top-products`, `/reports/sales/top-products`)
**Pre**: none. **Steps**: 1) Change "الحد الأقصى" (a free-text field, not a spinner) from its default to a small number (e.g. `3`) and to `0`. 2) Toggle "الترتيب حسب" بين إيرادات/كمية.
**Assert**: 1) Row count caps at the entered limit; at `0` confirm the app either shows zero rows or clamps to a sane minimum server-side — do not assume client-side validation blocks it, since this is a bare `text` field with no min/max. 2) Sort order changes to match the chosen metric; the #1 row by إيرادات need not be #1 by كمية.

### المشتريات

**RPT-06 — المشتريات حسب الفترة** (`purchases.by-period`) — mirrors RPT-01 minus discount column: التاريخ، عدد الفواتير، الإجمالي، الضريبة، الصافي، grouping select day/week/month, no branch/channel filter (confirmed absent, matching the catalog here for once).

**RPT-07 — المشتريات حسب المورد** (`purchases.by-supplier`) — `dateRange` only (no branch filter, contra the catalog). Columns: اسم المورد، عدد الفواتير، الإجمالي، المستحق، نسبة المساهمة.

**RPT-08 — المشتريات حسب الصنف** (`purchases.by-item`) — `dateRange` only (no category/branch filter, contra the catalog). Columns: الصنف، الكمية المشتراة، التكلفة، نسبة التكلفة.
**Assert for all three**: total row sums قابل للجمع columns; export matches; malformed date → no specific error (cross-cutting note).

### المخزون

**RPT-09 — مستويات المخزون** (`inventory.stock-levels`, `/reports/inventory/stock-levels`)
**Pre**: none. **Steps**: 1) Fill "المستودع" — read its placeholder carefully. 2) Fill "الصنف" (بحث) with a real item name.
**Assert**: 1) `[UX gap, not a missing feature]`: the "المستودع" field is a bare **text box** whose placeholder literally says "معرف المستودع (اتركه فارغاً لكل المستودعات)" — it expects a raw warehouse **id**, not a name, and offers no dropdown or autocomplete. A user without the warehouse's internal id cannot practically use this filter; confirm this is really a plain `<input type=text>`, not a disguised picker, before treating it as usable. 2) "الصنف" free-text does perform a substring name/code match. Columns: اسم الصنف، الكود، عدد المستودعات، إجمالي المخزون (qty total)، متوسط التكلفة، قيمة المخزون (money total)، الحالة.

**RPT-10 — حركة المخزون** (`inventory.movement`)
**Pre**: none. **Steps**: Toggle "الاتجاه" بين الكل/وارد/صادر; fill "الصنف"/"المستودع" (same raw-id caveat as RPT-09).
**Assert**: Filtering to وارد/صادر strictly narrows rows to that direction. Columns: التاريخ، اسم الصنف، المستودع، الاتجاه، الكمية (qty total)، نوع المرجع، المرجع.

**RPT-11 — سجل المخزون** (`inventory.ledger`)
**Pre**: none. **Steps**: Run with the default blank/wide date range; export.
**Assert**: **No grand-total row** — none of its columns (الحدث، الصنف، المستودع، الحركة، التكلفة، الرصيد) is flagged `total: true`; confirm the report simply omits the total row rather than showing a broken/empty one.

**RPT-12 — تقييم المخزون** (`inventory.valuation`)
**Pre**: none. **Steps**: Fill "بحث" and "المستودع" (raw-id caveat again).
**Assert**: Columns: الصنف، المخزون الحالي (qty total)، متوسط التكلفة، القيمة الإجمالية (money total). Cross-check "القيمة الإجمالية"'s grand total against the dashboard's `gl.inventoryValue` (DSH-03) and the Inventory hub's own figure (HUB-03) — three independently-computed numbers that should agree.

**RPT-13 — أعمار المخزون** (`inventory.aging`)
**Pre**: stock older than 30 days exists. **Steps**: Cycle through the "الشريحة العمرية" bucket select.
**Assert**: Columns: الصنف، المستودع، الكمية المتاحة (qty total)، إجمالي القيمة (money total)، العمر (يوم)، الشريحة العمرية، آخر استلام. Each bucket choice strictly narrows rows to that age band.

**RPT-14 — أصناف قاربت على الانتهاء** (`inventory.expiring`)
**Pre**: batch/lot-tracked items with expiry dates near or past due. **Steps**: Cycle "فترة الاستحقاق"; fill "بحث"/"المستودع".
**Assert**: Columns: الصنف، رقم الدفعة، المستودع، تاريخ الانتهاء، الأيام المتبقية، الحالة، الكمية المتاحة (qty total)، القيمة (money total)، تاريخ الاستلام، مستند الاستلام. Empty state when the tenant has no batch-tracked stock.

**RPT-15 — أصناف بطيئة الحركة** (`inventory.slow-moving`)
**Pre**: items with no/old sales. **Steps**: Cycle "مستوى الخطورة"; change "أيام منذ آخر بيع" (free-text number, default 90).
**Assert**: Columns: اسم الصنف، المخزون الحالي (qty total)، قيمة المخزون (money total)، أيام منذ آخر بيع، تاريخ آخر بيع، مستوى الخطورة. Lowering the day threshold widens the "حرج" bucket; items never sold show "لا مبيعات" rather than a numeric day count.

**RPT-16 — انحراف تقييم المخزون** (`inventory.drift`) — **D4 reference**
**Pre**: a tenant with confirmed purchase/sales invoices whose `occurredAt` (stamped `now()`) sorts after a document-dated movement (a transfer/adjustment carrying its own calendar date) that it should logically precede — reproducible on any demo-seeded tenant. **Steps**: 1) Cycle the "النوع" filter (الكل/فارق قيمة فقط/فارق كمية فقط). 2) Read any row with a non-zero فارق القيمة.
**Assert**: Columns: الصنف، المستودع، كمية المخزون، المتوسط المحسوب، متوسط الكاش، فارق القيمة (money total), أعلى نسبة انحراف، النوع — no reconciliation block (this report's whole purpose IS the reconciliation). **Per D4**: expect to see spurious rows here that do not indicate a real costing bug — the report replays movements in `occurredAt` order, and because confirms stamp wall-clock time rather than the document date, a later-confirmed-but-earlier-dated movement can appear to consume stock before its funding receipt. Do not re-file a drift row as a new defect without first checking whether it's explained by an `occurredAt`/document-date mismatch on the underlying movements (D4). The WAC snapshots themselves are correct per the defect note — only this replay-based report is affected.

### التصنيع

**RPT-17 — التصنيع أم الشراء** (`manufacturing.make-vs-buy`)
**Pre**: items with both a BOM and purchase history. **Steps**: Fill "بحث"; export.
**Assert**: Columns: الصنف، قائمة المواد، تكلفة التصنيع، تكلفة الشراء، الفرق (الشراء − التصنيع)، الأرخص — **no total row** (no `total: true` column). Manufacture-only items (no purchase cost on record) should show a clear "لا توجد بيانات"-style value in تكلفة الشراء/الفرق, not `0` or `NaN`.

### أعمار الديون

**RPT-18 — أعمار ديون العملاء** (`aging.customers`, param: single `asOfDate`, no range)
**Pre**: none. **Steps**: Change `asOfDate` to a past date and to today; export.
**Assert**: Columns: اسم العميل، جاري، 31-60، 61-90، 91-120، أكثر من 120، الإجمالي — all six money columns total. A past `asOfDate` recomputes the whole aging ladder as of that date, not just re-filters today's numbers. Feeds DSH-06 directly — cross-check.

**RPT-19 — أعمار ديون الموردين** (`aging.suppliers`) — mirror of RPT-18 for AP; same 6 totalled columns, same single-date param, feeds DSH-06 and DSH-05's "مستحقات موردين".

### المبيعات الميدانية

**RPT-20 — مبيعات المندوبين** (`field.van-sales`, `/reports/field/van-sales`)
**Pre**: van/rep trips recorded. **Steps**: Cycle "الحالة" (كل الحالات/جارية/مسواة/ملغاة).
**Assert**: Columns: الرحلة، التاريخ، الطاقم، المحمّل، المرتجع، المنصرف (all qty, totalled)، مبيعات نقدية، تحصيلات، العهدة الافتتاحية، النقدية المتوقعة، النقدية المستلمة، فرق النقدية (all money, totalled). "فرق النقدية"'s grand total across all trips is a genuinely useful cross-check figure — verify it equals `Σ(countedCash − expectedCash)` row by row.

### الأقساط

**RPT-21 — نظرة عامة على الأقساط** (`installments.overview`) — **no params at all** (confirm no filter bar renders). Columns: رقم الخطة، العميل، المبلغ الكلي (money total)، نسبة السداد (percent)، المبلغ المتبقي (money total)، الأقساط (qty, not totalled)، تاريخ البدء، الحالة. Empty state on a tenant with no active plans.

**RPT-22 — الأقساط المتأخرة** (`installments.overdue`)
**Pre**: overdue installments exist. **Steps**: Cycle the overdue-bucket select (الكل/1-30/31-60/61-90/91+).
**Assert**: Columns: #، اسم العميل، رقم خطة التقسيط، المبلغ (money total)، المبلغ المتبقي (money total)، تاريخ الاستحقاق، أيام التأخير. Bucket choice strictly narrows to that day range.

### أرباح مراكز التكلفة — bespoke, not `<ReportRunner>`

**RPT-23 — أرباح مراكز التكلفة** (`/cost-center-pl`, `CostCenterPnLScreen.tsx`)
**Pre**: journal lines carrying a cost-center dimension. **Steps**: 1) Change from/to date (default hardcoded `2026-08-01`→`2026-08-31`). 2) Attempt to find an export control. 3) Send an invalid date.
**Assert**: 1) Columns: الكود، مركز التكلفة، الإيرادات، المصروفات، صافي الربح — sourced from `DocumentList`, not `ReportRunner`. The three header `StatCard`s ("إجمالي الإيرادات"/"إجمالي المصروفات"/"صافي الربح") must equal the sum of the table's own revenue/expense/profit columns — this screen's stand-in for a "total row." An unassigned catch-all "غير مخصص لمركز تكلفة" row is expected when no cost centers are actually tagged on transactions. 2) `[NOT IMPLEMENTED]`: **no export button exists on this report at all** — `DocumentList` has no export capability, unlike every one of the other 29 reports. This is the one report in the whole set where "export matches the screen" cannot be tested because there is nothing to export. 3) Same as RPT-01–22: this screen's own `useCostCenterPnL` hook has no field-error parsing either — expect only the generic "تعذّر تحميل أرباح مراكز التكلفة." card with a retry button, no specific message.

### المحاسبة / القوائم المالية — 7 tabs, one page (`FinancialReportsScreen.tsx`, nav item "التقارير المالية")

All seven share the page's tab bar; switching tabs preserves nothing between them (`key={tab.id}` remounts each). `showGrandTotal` is `true` by default; only the balance sheet turns it off. Every account-code/name cell is expected to be clickable into a side-panel drill-down per the catalog — verify this still holds per tab, it wasn't independently re-checked in this pass.

**RPT-24 — ميزان المراجعة (tab)** — auto-runs on tab entry (`FinancialReportsScreen` explicitly overrides `onDemand={false}` here even though the underlying definition itself is `onDemand: true`). Columns: رقم الحساب، اسم الحساب، مدين (total)، دائن (total) — the two totals must be equal (an explicit reconciliation block enforces and displays `مدين = دائن`).
**`[dual-entry-point inconsistency — test explicitly]`**: the **same** trial-balance report is also reachable as its own standalone nav item, "ميزان المراجعة" under Accounting (`TrialBalanceReportScreen.tsx`, `trial-balance-report` key). That screen does **not** override `onDemand` — it reads the definition's own `onDemand: true` and therefore **requires an explicit "عرض التقرير" click**, and its default `asOfDate` is computed live (`new Date()`), unlike the tab's hardcoded `2026-08-22`. Run both, side by side, with the same `asOfDate`, and confirm they produce identical figures despite the different default-date and auto-run behaviour — and separately confirm the standalone screen really does sit on a "اختر الفلاتر…" placeholder until clicked, while the tab shows data immediately on arrival.

**RPT-25 — قائمة الدخل (tab)** — params: `periodFrom`/`periodTo` (default `2026-01-01`→`2026-08-22`) + "المقارنة" select with **two** real options, "الفترة السابقة" and "نفس الفترة من العام الماضي" (`compareTo: previous|lastYear`) — richer than the catalog's single toggle button. Columns: رقم الحساب، البند، الفترة الحالية (total)، فترة المقارنة (total)، التغيّر (a `variance`-formatted column: a small tilt-beam icon + signed money, from `beams.tsx`'s `VarianceBeam`, not plain text). **Assert**: switching "المقارنة" from السابقة to نفس الفترة من العام الماضي changes فترة المقارنة's values (and therefore التغيّر) without touching الفترة الحالية; the variance beam tilts up/green when a rise is good news and down/red when it isn't, per row.

**RPT-26 — الميزانية العمومية (tab)** — param: single `asOfDate`. Columns: رقم الحساب، الحساب، الرصيد. **`showGrandTotal: false`** explicitly — confirm no grand-total row renders even though "الرصيد" is a `total: true` column; the three-section balance check (الأصول = الالتزامات + حقوق الملكية) is shown as its own explicit summary line instead, and that's the number to verify, not a table total.

**RPT-27 — التدفقات النقدية (tab)** — params: `periodFrom`/`periodTo` + "المقارنة" select (same two options as RPT-25). Columns: البيان، التدفق النقدي (total)، فترة المقارنة (total)، التغيّر (variance beam). Reconciliation block: الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي — verify the arithmetic holds exactly.

**RPT-28 — إقرار ضريبة القيمة المضافة (tab)** — params: `periodFrom`/`periodTo` only (no branch, no comparison — matches the catalog here). Columns: نسبة الضريبة، الوعاء الخاضع (total)، مبلغ الضريبة (total), rendered as two separate grouped tables (output/input) via the report's `group` config. A `renderSummary` block above the table (the **only** operational/financial report using this optional slot) reads "ضريبة المخرجات − ضريبة المدخلات = {صافي الضريبة المستحقة الدفع|صافي الضريبة القابلة للاسترداد}: {amount}" — verify the label flips correctly when net VAT goes negative (refundable) vs positive (payable). This exact `net` figure is what DSH-05's "ضريبة القيمة المضافة المستحقة" attention row reads.

**RPT-29 — دفتر الأستاذ العام (tab)** — on-demand (`onDemand: true`, not overridden here): loads to a "اختر الفلاتر…" placeholder until "عرض التقرير" is clicked. Params: `periodFrom`/`periodTo` only (a "بحث عن حساب" text box from the catalog does not exist in this definition's `paramFields` — confirm). Columns: التاريخ، رقم القيد، البيان، مدين (total)، دائن (total) — after running, confirm مدين's grand total equals دائن's (every posted period should balance).

**RPT-30 — دفتر حساب (tab)** — on-demand, **but pre-populated**: `AccountLedgerTab` builds its definition with `accountId` defaulted to the tenant's first postable account (`accounts.find(a => !a.isHeader)`), not left blank. **`[behaviour differs from the catalog]`**: the catalog documents "عرض التقرير" as **disabled** until an account is chosen; in this build the button is only ever `disabled={loading}` — it is clickable immediately on arrival, and running it without ever touching the "الحساب" select produces a real ledger for that pre-selected first account. Test both paths: (a) click "عرض التقرير" immediately — confirm it runs against the pre-selected account, not a blank/error state; (b) change "الحساب" to a different real account first, then run — confirm the ledger switches accordingly, columns التاريخ، رقم القيد، البيان، مدين (total)، دائن (total)، الرصيد الجاري (running balance, not totalled).

### RPT-31 — Reports the catalog documents that this build does not have
**Pre**: none. **Steps**: 1) Search the sidebar "التقارير" group and the command bar for "ملخص المبيعات اليومي" / "تقارير الورديات" (POS daily summary / shift reports) and "تقرير العروض" (Promotions report). 2) Grep-equivalent: check `apps/web/src/screens/reports/*.tsx` and `apps/web/src/App.tsx`'s `ROUTABLE_SCREENS` for any POS-report or promotions-report screen or key.
**Assert**: `[NOT IMPLEMENTED]` — none of the three exist: no nav entry, no screen file, no `ROUTABLE_SCREENS` key, no domain report definition under `packages/domain/src/reports/`. The catalog's 33-report inventory includes these (POS domain, 2 reports; Promotions, 1 cross-referenced report) on top of this build's 30; confirm they are genuinely absent rather than merely unlinked (unlike, say, the settings-catalog's audit log, which exists but is only reachable via the command bar — these three have **no** reachability path at all, command bar included, since the command bar's item list is the fixed 5-entry set from SHL-09).
