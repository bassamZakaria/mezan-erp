# Manual test plan — everyday operator

Scenarios for the store clerk and junior accountant who books invoices, chases
balances, and closes the books, judged on **friction**, not correctness. Every
scenario below is grounded in code actually present under `apps/web/src` and
`packages/{api,domain,backend}/src` — file:line references are given so a
retest starts from the same evidence, not a re-guess.

## Cast (from `packages/backend/src/demo-seed/access.ts`, password `Cyag@2026` for all)

| Person | Login | Role | Why this test plan uses them |
|---|---|---|---|
| محمد الشهابي | `admin@cyag.example` | company admin (`"*"`) | wildcard baseline, first login |
| منى عبد الرحمن | `mona.abdelrahman@cyag.example` | محاسب (ACCOUNTANT) | can post journals, close the period — **cannot** create a sales invoice |
| كريم فؤاد | `karim.fouad@cyag.example` | مندوب مبيعات (SALES_REP) | the actual "books invoices all day" persona — `view_own`, `create`, no `confirm` |
| عمر هلال | `omar.hilal@cyag.example` | مشرف المبيعات (SUPERVISOR) | holds `sales.invoice.confirm`; the approver of كريم's drafts |
| سيد جمال / مجدي رشاد | `sayed.gamal@…` / `magdy.rashad@…` | أمين مخزن (WAREHOUSE_KEEPER), same role, different `warehouseScope` | proves scoping narrows, not just displays |
| سلمى فؤاد | `salma.fouad@cyag.example` | مندوب توزيع (VAN_SALES), scoped to `WH-DEMO-VAN` | the van rep's own end-of-day close |
| هالة مصطفى | `hala.mostafa@cyag.example` | SALES_REP, `status: inactive` | the deactivated-account path |

Preconditions common to every scenario unless stated otherwise: backend booted
with `MEZAN_SEED_DEMO=1` against a **fresh** database file, one browser tab,
Arabic locale, RTL, light theme, `window.confirm/alert/prompt` un-stubbed
(this is a manual pass, not automation).

---

## Login and the password field

### MTP-USR-01 — First sign-in of the day, remembered face
- **Persona / permission:** none yet — device has no remembered user
- **Preconditions:** fresh browser profile (`localStorage` empty), seeded tenant
- **Steps:**
  1. Open the app. Screen shows «تسجيل الدخول» with an email field (no remembered faces yet — `apps/web/src/login/LoginScreen.tsx` renders the email input when `remembered.length === 0`).
  2. Type `admin@cyag.example` into «البريد الإلكتروني».
  3. Tab to «كلمة المرور», type `Cyag@2026`, and press Enter.
- **Expected:** the form submits on Enter or on «دخول» and lands on the dashboard. Total input: email, Tab, password, Enter.
- **False pass:** the form looks complete but the request never fires — confirm a network call to `/auth/login` actually left the browser.

### MTP-USR-02 — Second sign-in, face row instead of typing
- **Persona / permission:** محمد الشهابي, having signed in once already on this device
- **Preconditions:** MTP-USR-01 completed on the same browser profile (device now "remembers" this user, `apps/web/src/login/device-users.ts`)
- **Steps:**
  1. Reload the app.
  2. Observe the screen shows «مَن يعمل الآن؟» with a face chip for محمد الشهابي and an «آخر» tile — **no email field**.
  3. Click the face chip (or Tab to it and press Space/Enter — it is `role="radio"`).
  4. Type the password and press Enter.
- **Expected:** zero typing beyond the password: one click, the password, Enter.
- **False pass:** none — this one is simply good; record it as a positive.

### MTP-USR-03 — Wrong password
- **Persona / permission:** محمد الشهابي
- **Steps:** enter any password that is not `Cyag@2026`.
- **Expected:** Arabic refusal «البريد الإلكتروني أو كلمة المرور غير صحيحة.», the password field clears and keeps focus.
- **False pass:** the message reads correctly but the field is left holding the wrong password — confirm the clear actually happened.

### MTP-USR-04 — Show/hide and paste
- **Persona / permission:** any
- **Steps:** paste (Ctrl+V) `Cyag@2026` into the password field, press Enter.
- **Expected:** the whole pasted string lands in the field (no per-character truncation) and the sign-in succeeds. The field is masked by default.
- **False pass:** a trailing space or newline from the clipboard is silently kept and the sign-in fails with the wrong-password message.

### MTP-USR-05 — Deactivated account
- **Persona / permission:** هالة مصطفى (`hala.mostafa@cyag.example`, `status: inactive`)
- **Steps:**
  1. From the login screen, click «آخر» (she is not a remembered face on a fresh device).
  2. Type her email, then the password `Cyag@2026`.
- **Expected:** refused with the **same** Arabic message as a wrong password («البريد الإلكتروني أو كلمة المرور غير صحيحة.») — `auth-routes.ts:91` treats `status !== "active"` identically to a bad hash.
- **False pass / note for the admin:** this is a deliberate non-disclosure (don't tell an attacker the account exists), but it also means an admin troubleshooting "Hala can't log in" gets no signal that the account is disabled rather than her password being wrong. Worth knowing before filing it as a bug.

### MTP-USR-06 — Session-expired banner
- **Persona / permission:** any
- **Preconditions:** a session that the server has invalidated (or `sessionExpiredPending` set)
- **Steps:** land back on the login screen after the session ends.
- **Expected:** a warning banner «انتهت الجلسة. سجّل الدخول من جديد للمتابعة.» sits above the face row (`LoginScreen.tsx:163-173`) rather than the screen looking like a fresh, unexplained logout.
- **False pass:** the banner shows once then reappears on a plain manual logout too — confirm it is scoped to the expiry path only.

### MTP-USR-07 — Ctrl+K from anywhere, no mouse
- **Persona / permission:** any signed-in user
- **Steps:** anywhere in the app, press **Ctrl+K** (⌘K on the doc's own label, `packages/ui/src/shell/CommandBar.tsx:207`), type `فوا` (partial for فواتير), press **Enter** on the first match.
- **Expected:** the command palette opens, filters live, Enter navigates — a genuine mouse-free way to reach any of the 116 routed screens.
- **False pass:** the palette opens but Enter does nothing until you click the row with the mouse — confirm keyboard selection actually navigates.

---

## Booking a sales invoice, keyboard first

Persona for this whole block: **كريم فؤاد** (SALES_REP) — `sales.invoice.create`
and `view_own`, **no** `sales.invoice.confirm`. This is the actual "books
invoices all day" job; a different persona is used only where noted.

### MTP-USR-08 — Reach the invoice form without the mouse
- **Steps:** Ctrl+K → type `فواتير` → Enter (lands on `#/sales/sales-invoices`) → Ctrl+K again → type `جديدة`/`فاتورة` or Tab to the list screen's own "new" affordance and press Enter.
- **Expected:** lands on the create sub-page `#/sales/sales-invoices/new` (`apps/web/src/screens/SalesInvoicesScreen.tsx:1756`, addressed in the URL, not a modal state) showing the method choice card «إنشاء فاتورة جديدة» / «إنشاء من عرض سعر».
- **False pass:** the URL changes but the form under it is the stale one from a previous visit — reload once to confirm it always renders fresh.

### MTP-USR-09 — Customer picker: does it forgive a spelling variant?
This is the flagship finding of this pass.
- **Preconditions:** demo seed customer شركة الأمل للتجارة exists.
- **Steps:**
  1. On the العملاء list (`#/sales/customers`), type `الامل` (bare alif, no hamza) into «بحث بالاسم أو الكود أو الهاتف…».
  2. Confirm شركة الأمل للتجارة (spelled with hamza, أ) appears — it does: the list's own filter goes through `matchesSearch`/`normalizeForSearch` (`packages/domain/src/search/arabic.ts:27-52`), which folds أ/إ/آ onto ا exactly for this reason.
  3. Now go to a new sales invoice and type the same `الامل` into the «العميل» field.
- **Expected if consistent:** the same customer should appear in the invoice's customer picker.
- **Actual (defect):** it does not. `EntityPicker` (`packages/ui/src/primitives/EntityPicker.tsx:48-54`) filters with plain `label.toLowerCase().includes(query)` — no `normalizeForSearch` call at all. Typing the bare-alif spelling a real clerk types by habit returns **no results** in the exact control used to book an invoice, while the list screen ten seconds earlier proved the match exists. This is the same shape as the closed defect D32 the domain helper was built to fix — it just never reached the picker component every document screen shares (customer, item, salesperson, account, cost centre — all ~35 `EntityPicker` call sites are affected identically).
- **False pass:** typing the *exact* spelling (with hamza) does work, so a quick smoke test looks clean. The defect only shows with the spelling variance an Egyptian clerk actually types.

### MTP-USR-10 — Item picker: is it a real picker or free text wearing a picker's clothes?
- **Steps:**
  1. In the invoice's line item field «الصنف — سطر ١», type `أرز` (matches أرز أبيض 5 كجم, `ITEM-DEMO-1`).
  2. Press Enter without arrowing — the highlighted (first) match should be accepted (`EntityPicker.tsx:70-73`, highlight resets to 0 on every keystroke).
  3. Confirm the invoice, then check the persisted row (via the API `GET` or the SQLite file) rather than the screen.
- **Expected:** the stored `itemId` is the real seed id `ITEM-DEMO-1`, not a string built from the label text.
- **False pass:** the row on screen shows the right Arabic name — that alone proves nothing; per this codebase's own history (a quote line once invented `ITEM-1` behind a plausible label and still returned 201), the label is not evidence, only the stored id is.
- **Note:** `SalesInvoicesScreen.tsx:522-526` does filter dropped/blank lines by `items.find((i) => i.id === l.itemId)`, so this screen is in fact correctly bound — this scenario exists to *prove* that, not to assume it.

### MTP-USR-11 — A line with no item is silently dropped
- **Steps:**
  1. Click «إضافة بند» twice to get three lines.
  2. On the third line, enter a quantity and a price but leave «الصنف» empty.
  3. Confirm the invoice.
- **Expected / actual:** the line vanishes with no warning — `domainLines` (`SalesInvoicesScreen.tsx:522-526`) `continue`s past any line whose `itemId` does not resolve to a real item, so it is never sent to the server at all.
- **Why this is friction, not a crash:** the clerk who typed a quantity and a price and clicked «تأكيد الفاتورة» will only discover the missing line by re-opening the printed invoice and recounting rows — nothing on screen says "one line was ignored."

### MTP-USR-12 — Tab order end to end
- **Steps:** starting at «العميل», press Tab repeatedly through: التاريخ → تاريخ الاستحقاق → الفرع → المستودع → العملة → المندوب → كود القسيمة → الصنف (سطر ١) → الكمية → الوحدة → السعر → نوع الخصم → قيمة الخصم → إضافة بند/حذف السطر → الملاحظات → save/confirm buttons.
- **Expected:** Tab order matches the visual top-to-bottom reading order for RTL — the fields are laid out in plain DOM order with no explicit `tabindex` overrides (confirmed by reading `SalesInvoicesScreen.tsx:744-1042`), so there is no "Tab jumps backwards" bug on this screen.
- **False pass:** a screen reader or a sighted Tab-only pass both need to be run — a DOM-order match does not by itself prove focus rings are visible at every stop; check that each field shows a visible focus outline before calling this clean.

### MTP-USR-13 — Enter does not add a line
- **Steps:** in a line's «الكمية» or «السعر» field, having just typed a value, press Enter.
- **Expected/actual:** nothing happens — no new line, no submit. A repo-wide search for `key === "Enter"` (excluding the picker's own select-highlighted-option behaviour) turns up **zero** handlers on any line-item document screen (sales invoices, purchase invoices, purchase orders, sales returns all share this shape). Adding a line is a mouse-only action: click «إضافة بند».
- **Why it matters:** a clerk keying ten lines from a paper order does 10× (Tab, Tab, Tab, Tab, **click**) instead of the muscle memory Excel and most POS-style entry screens train — the click is the one break in an otherwise keyboard-friendly form.

### MTP-USR-14 — Zero the price, get told why in Arabic
- **Steps:** set a line's «السعر» to `0` (or set the line discount to 100%), then attempt «تأكيد الفاتورة».
- **Expected:** server refuses with «سعر صفري أو خصم كامل يحتاج صلاحية تعديل السعر.» (`packages/api/src/sales-invoices-routes.ts:510`), surfaced verbatim via `errorMessage()` (`apps/web/src/lib/error-message.ts:17-20`).
- **Good news:** this is exactly the kind of refusal that names the missing permission in plain accounting Arabic rather than a status code.

### MTP-USR-15 — Discount past the ceiling
- **Steps:** set the invoice-level discount to a value above the tenant's configured ceiling (demo default; check «الإعدادات» first).
- **Expected:** «الخصم يتجاوز الحد المسموح (X%) ويحتاج اعتماداً.» (`sales-invoices-routes.ts:524`) — again correct, specific Arabic.

### MTP-USR-16 — Save/confirm disabled with no reason shown
- **Steps:** open a new invoice, choose «إنشاء فاتورة جديدة», leave «العميل» empty, add one valid line.
- **Expected/actual:** both «حفظ كمسودة» and «تأكيد الفاتورة» stay disabled (`canSubmit` requires `customer !== null`, `SalesInvoicesScreen.tsx:577`) — but nothing on screen says *why* they're greyed out. The client-side `t("salesInvoices.error.customerRequired")` ("العميل مطلوب.") string exists in the code (`SalesInvoicesScreen.tsx:602`) but is unreachable in normal use, because a disabled button cannot be clicked to trigger it.
- **False pass:** a tester who never tries to submit with an empty customer will never see this — the friction is specifically "I don't know what I'm missing," not a crash.

### MTP-USR-17 — Draft vs confirm, and who can do which
- **Persona:** كريم فؤاد (SALES_REP — `create` but not `confirm`)
- **Steps:** complete a valid invoice (customer + one bound line), click «تأكيد الفاتورة».
- **Expected (business rule):** كريم can create; only a holder of `sales.invoice.confirm` (عمر هلال, السوبرفايزر) or an admin should be able to confirm.
- **Actual:** the confirm button is not hidden or disabled for a role that lacks the permission — `SalesInvoicesScreen.tsx` has no `usePermission`/`can()` check anywhere in the file. Clicking «تأكيد الفاتورة» sends the request, and the refusal comes back **in English**: `Missing permission 'sales.invoice.confirm'.` (`packages/api/src/permission-gate.ts:60-69` — the literal fallback message, no Arabic translation table at all). This is one of the six-plus refusals below; see MTP-USR-25.
- **Why this is more than an annoyance:** a clerk who does this all day will hit this exact wall on every invoice they try to close out themselves, every day, until someone explains that confirming isn't their job — the screen itself never says so.

### MTP-USR-18 — The proper confirm path (SUPERVISOR)
- **Persona:** عمر هلال (`sales.invoice.confirm`, `view_all`)
- **Steps:** sign in as عمر, open the draft كريم just created (visible because عمر holds `view_all`, unlike كريم's `view_own`), click «تأكيد الفاتورة».
- **Expected:** succeeds — stock and GL should move; cross-check the item's on-hand quantity and the trial balance before/after (per the "two numbers that must agree" rule).
- **Pair with MTP-USR-43** for the `view_own` vs `view_all` contrast this pairing exists to test.

### MTP-USR-19 — Reload mid-form loses everything, silently
- **Steps:**
  1. Open a new invoice, choose a customer, add two lines with real quantities and prices.
  2. **Before saving**, press F5 (or Ctrl+R).
- **Expected/actual:** the URL still reads `#/sales/sales-invoices/new` (sub-page state lives in the URL — `apps/web/src/navigation.tsx:103-114`), so the screen *looks* like it picked up where you left off. It has not: customer, lines, quantities and prices are all React component state, held nowhere else — no `localStorage`, no draft autosave, and no `beforeunload` confirmation exists anywhere in the app to warn before the reload. The form re-mounts empty.
- **Blocks my day:** a five-line invoice typed from a phone call, lost to an accidental F5 or a LAN hiccup that bounces the tab, with zero warning and zero recovery. This is the single highest-value fix candidate in this pass.
- **False pass:** the tester reloads *after* saving a draft (which does persist server-side) and concludes reload-safety is fine — the defect is specifically about the unsaved, mid-typing state.

### MTP-USR-20 — Browser Back from the create form
- **Steps:** from `#/sales/sales-invoices/new` with some typed-but-unsaved data, click the browser's own Back button.
- **Expected:** returns to the invoice list (`subPage.close()` → `openSubPage([])`, `navigation.tsx:112`) — this part works, because the sub-page is addressed in history.
- **Same loss as MTP-USR-19:** no confirmation dialog appears before discarding typed data; Back silently drops it exactly like a reload does.

### MTP-USR-21 — Add a customer mid-invoice: there is no shortcut
- **Steps:** while on the invoice create form, look for any inline "add new customer" affordance next to the «العميل» field.
- **Expected/actual:** none exists — `customerOptions` in `SalesInvoicesScreen.tsx:352-357` has no companion "create" action, and the file contains no reference to opening `CustomersScreen`'s add-customer panel. The only path is: abandon the invoice (see MTP-USR-19/20 for what that costs), navigate to العملاء, add the customer there, then start the invoice over.
- **Slows my day, every time it happens:** a first-time customer calling in an order is a routine event in a small shop; this workflow currently costs a full form restart.

### MTP-USR-22 — Print a confirmed invoice
- **Persona:** any with `sales.invoice.print` (عمر هلال, سلمى فؤاد)
- **Preconditions:** the tenant's «إعدادات» is missing at least one of tax registration number / company name / address (demo default — check first).
- **Steps:** open a confirmed invoice, click «طباعة».
- **Expected:** lands on a **routed** print page (not a popup/overlay — `apps/web/src/print/SalesInvoicePrintPage.tsx:9-16`, reachable by its own URL, reloadable, has its own Back), and — because compliance fields are missing — shows an on-screen (never printed, `print:hidden`) Arabic warning naming exactly which fields are absent, rather than silently producing a tax-non-compliant page that looks fine.
- **Good news:** this is a genuinely well-thought-out piece of the app; record it as a positive.

### MTP-USR-23 — Collect a payment against a confirmed invoice
- **Persona:** يوسف بدر (TREASURY_CASHIER) or عمر هلال
- **Steps:** open a confirmed invoice with a remaining balance, use the collect-payment action, submit without choosing a treasury account.
- **Expected:** Arabic refusal «اختر الخزينة التي استُلم فيها المبلغ» (`SalesInvoicesScreen.tsx:1276`, catalog key `salesInvoices.error.treasuryRequired`) — names exactly the missing field.

### MTP-USR-24 — Confirm an invoice whose period has since closed
- **Persona:** عمر هلال
- **Preconditions:** كريم drafts an invoice dated inside the current period; منى عبد الرحمن then closes that fiscal period (see MTP-USR-33) before عمر confirms it.
- **Steps:** عمر opens the still-draft invoice and clicks «تأكيد الفاتورة».
- **Expected (business rule):** correctly refused — posting into a closed period must fail.
- **Actual:** refused with `Fiscal period "…" is "closed" and does not allow posting.` — raw English (`packages/domain/src/fiscal-periods/errors.ts:44-52`, passed through verbatim at `packages/api/src/sales-invoices-routes.ts:304-309`). One more instance of the same pattern as MTP-USR-17/MTP-USR-33/MTP-USR-34 — see the summary in MTP-USR-25.

### MTP-USR-25 — The six-plus refusals, side by side
Run these back to back and read the exact text of each. Three genuinely wrong, four genuinely right — the point is the inconsistency is easy to trigger in one sitting, not that everything is broken.

1. **English (defect):** confirm an invoice as كريم (no `sales.invoice.confirm`) → `Missing permission 'sales.invoice.confirm'.` (`permission-gate.ts:60-69`, MTP-USR-17).
2. **English (defect):** confirm an invoice dated into a closed period → `Fiscal period "…" is "closed" and does not allow posting.` (MTP-USR-24).
3. **English (defect):** as منى (ACCOUNTANT, holds `accounting.period.view` but not `.close`), attempt «إغلاق» on an open period → `Missing permission 'accounting.period.close'.` (same `permission-gate.ts` fallback — see MTP-USR-33).
4. **Arabic (correct):** zero-price line → «سعر صفري أو خصم كامل يحتاج صلاحية تعديل السعر.» (MTP-USR-14).
5. **Arabic (correct):** discount over ceiling → «الخصم يتجاوز الحد المسموح (…٪) ويحتاج اعتماداً.» (MTP-USR-15).
6. **Arabic (correct):** collect payment with no treasury chosen → «اختر الخزينة التي استُلم فيها المبلغ» (MTP-USR-23).
7. **Arabic (correct):** wrong password → «البريد الإلكتروني أو كلمة المرور غير صحيحة.» (MTP-USR-03).

- **Expected:** all seven should read as accounting Arabic a محاسب would say out loud.
- **Actual:** three of seven read as raw JavaScript-error English inside an otherwise fully Arabic screen — and all three share one root: `packages/api/src/permission-gate.ts` and `packages/domain/src/fiscal-periods/errors.ts` were never given an Arabic message table the way `sales-invoices-routes.ts`'s own hand-written refusals were. Because `errorMessage()` (`apps/web/src/lib/error-message.ts`) shows any `ApiError.message` verbatim by design, **every** route that surfaces a permission-gate or fiscal-period-transition failure inherits the same English leak — this is not one bug, it is the shape of a whole class of refusals across sales invoices, purchase invoices, journals, vouchers, cheques, GL posting and payroll (each of those routes imports `PeriodNotOpenForPostingError`).

---

## Master data pickers away from the invoice screen

### MTP-USR-26 — Add a customer, required-field message
- **Persona:** any with `sales.customer.create` (not كريم — see MTP-USR-30)
- **Steps:** العملاء → «+» → leave «الاسم بالعربية» empty → submit.
- **Expected:** «الاسم بالعربية مطلوب» (`CustomersScreen.tsx:883`, catalog key `customers.error.nameRequired`) — names the field, in Arabic, correctly.

### MTP-USR-27 — Customer balance visible before taking an order
- **Steps:** open العملاء, locate a customer with open invoices, read the «المستحق» (owed) column without opening the record.
- **Expected:** the list column exists and is populated (`CustomersScreen.tsx:858`, `owedOf()`), so a clerk can check "does this customer already owe me money" in one glance before booking a new order — this matches the exact task named in this plan's own brief and it works.

### MTP-USR-28 — Customer's price list field is a real picker
- **Steps:** in the add-customer form, click «قائمة الأسعار», confirm it opens a searchable list rather than accepting typed text.
- **Expected:** `EntityPicker` (`CustomersScreen.tsx:956-961`), bound to `priceListId`, sourced from the real price-lists endpoint — correctly a picker, not free text. (Its Arabic-forgiving search has the same MTP-USR-09 gap as every other `EntityPicker`.)

### MTP-USR-29 — Warehouse and branch on the invoice are real selects, not typed text
- **Steps:** on the invoice create form, try to type directly into «الفرع» / «المستودع».
- **Expected:** both are `SelectField`s (`SalesInvoicesScreen.tsx:770-786`) bound to real branch/warehouse ids from `useBranches()`/`useWarehouses()` — no free-text path exists to invent a warehouse id.

### MTP-USR-30 — Add a customer, wrong role
- **Persona:** كريم فؤاد (`sales.customer.view` only, no `.create`)
- **Steps:** sign in as كريم, open العملاء, click «+», fill a valid name, submit.
- **Expected (business rule):** refused — كريم cannot create customers.
- **Actual:** the «+» button is not hidden for him (no permission check found in `CustomersScreen.tsx`), so he can fill the whole form before being told no — and per the MTP-USR-25 pattern, the refusal text is the English `Missing permission 'sales.customer.create'.`

### MTP-USR-31 — Item creation, required name
- **Steps:** الأصناف → new item sub-page → leave «اسم الصنف» empty → try to submit.
- **Expected:** the field carries the native HTML `required` attribute and a visible `*` (`apps/web/src/screens/item-form-controls.tsx:21-28`, `apps/web/src/screens/ItemsScreen.tsx:1070`) — the browser's own (Arabic-localized, given `<html lang="ar">`) validation bubble blocks submission. No custom Arabic string was written for this one, but the platform's own message should already be Arabic; confirm it actually reads in Arabic in the target browser.

---

## Treasury, cheques and reconciliation

### MTP-USR-32 — Treasury voucher account is a bound select
- **Persona:** يوسف بدر (TREASURY_CASHIER)
- **Steps:** create a voucher, inspect «حساب الخزينة» — confirm it is a `SelectField` populated from `treasuryAccounts` (`TreasuryVouchersScreen.tsx:1087-1094`), not typed text, and that a customer-collection voucher's party field is an `EntityPicker` (`TreasuryVouchersScreen.tsx:914`).
- **Expected:** bound in both cases.

### MTP-USR-33 — Accountant closes the current period
- **Persona:** منى عبد الرحمن (`accounting.period.close`)
- **Steps:** الفترات المالية → find the current open period → row menu → «إغلاق».
- **Expected:** succeeds with **no confirmation dialog** at all (`FiscalPeriodsScreen.tsx:113-124` calls `closePeriodMutation.mutateAsync` directly on click) — closing is reversible («إعادة فتح» becomes available once closed), so the absence of a confirm step is defensible, but it means a stray click closes the books for everyone with no "are you sure."
- **Recovery path:** «إعادة فتح» (reopen) is present for a closed period and restores posting.

### MTP-USR-34 — Lock a period: the terminal, no-undo action
- **Persona:** طارق منصور (FINANCE_MANAGER)
- **Steps:** on a **closed** period, row menu → «قفل».
- **Expected:** succeeds, again with no confirmation dialog, and this one genuinely is terminal — a locked row's menu goes empty (`FiscalPeriodsScreen.tsx:287-296`, the `else []` branch), so there is no UI path back. The only recovery is whatever the backend offers outside this screen (none found).
- **Blocks my day if mistaken:** locking the wrong period, or locking a period one day too early, has no in-app undo. This deserves a confirmation step precisely because MTP-USR-33's lack of one is tolerable and this one's is not.

### MTP-USR-35 — Two terminals racing to lock the same period
- **Persona:** طارق منصور on two tabs/PCs (this app is explicitly LAN-shared, `apps/web/src/lan/`)
- **Steps:** load الفترات المالية on two sessions with the same closed period visible. On session A, lock it. Without reloading session B, click «قفل» there too.
- **Expected (business rule):** the second lock attempt should fail cleanly.
- **Actual:** it does, but with `Fiscal period "…" cannot lock from status "locked".` — raw English (`packages/domain/src/fiscal-periods/errors.ts:26-34`, passed through unmapped at `packages/api/src/fiscal-periods-routes.ts:36-37`). This is a realistic scenario on a two-PC shop, not a contrived one.

### MTP-USR-36 — Journal entry: the out-of-balance indicator
- **Persona:** منى عبد الرحمن
- **Steps:** القيود المحاسبية → new entry → add two lines, put ١٠٠٫٠٠ debit on one account and ٩٥٫٠٠ credit on another, leave a memo.
- **Expected:** «ترحيل القيد» stays disabled (`JournalsScreen.tsx:474-476`, `canPost` requires `balanced`), and the difference between the two sides is computed and shown live via `Money` (no float drift) rather than the clerk having to subtract it themselves.
- **Good news:** the unbalance case never reaches the server on this screen, so the raw-English `UnbalancedEntryError` (`packages/domain/src/post-journal-entry.ts:5-15`) is not directly reachable here — it is a defect only for any *other* path that posts without this client guard, out of scope for this pass.

### MTP-USR-37 — Journal entry's account field is bound
- **Steps:** in the same new-entry form, confirm «الحساب» per line is a `SelectField` sourced from the chart of accounts (`JournalsScreen.tsx:563-564`) rather than a typed account code — typing a nonexistent code should not be possible at all.

### MTP-USR-38 — Trial balance after posting
- **Persona:** منى عبد الرحمن
- **Steps:** open ميزان المراجعة (Trial Balance report) before and after posting the balanced entry from MTP-USR-36.
- **Expected:** total debits equal total credits exactly, both before and after — this is the "two numbers that must agree" check; if it moves by anything other than the exact entry amount, that is the finding, not the report.

---

## Inventory and the daily/field close

### MTP-USR-39 — Stock adjustment: reason and warehouse are both bound
- **Persona:** سيد جمال (WAREHOUSE_KEEPER)
- **Steps:** تسويات المخزون → new adjustment → confirm «المستودع» is a select bound to real warehouse ids, and «السبب» offers seeded reason codes rather than free text.
- **Expected:** both bound; a made-up reason should be structurally impossible to enter.

### MTP-USR-40 — Warehouse scope actually narrows, not just displays
- **Persona pair:** سيد جمال (`warehouseScope: "*"`) vs مجدي رشاد (`warehouseScope: ["WH-DEMO-2"]`), same WAREHOUSE_KEEPER role
- **Steps:** both open المخزون → أرصدة المخزون (stock balance) list.
- **Expected:** سيد جمال sees rows across every warehouse (~40 in the demo tenant); مجدي رشاد sees only Giza's rows (~3). If both see the same count, the scope is decorative, not enforced.

### MTP-USR-41 — Van rep's own end-of-day settle
- **Persona:** سلمى فؤاد (VAN_SALES, `field.van_trip.settle`)
- **Steps:** رحلات التوزيع → her open trip → «تسوية» (settle) action → reconcile cash collected against invoices confirmed during the trip.
- **Expected:** this is the closest thing this app has to a literal "daily close" for a field operator — confirm it actually posts a treasury voucher / journal entry rather than just flipping a status flag.

### MTP-USR-42 — Approvals inbox: reject with a note
- **Persona:** عمر هلال
- **Steps:** الموافقات المعلّقة → a pending request from كريم → row menu → «رفض», type a one-line Arabic reason in the optional note field, confirm.
- **Expected:** the request moves to status «مرفوض», the note is attached, and — this specific defect was fixed and is worth re-proving — the reject actually reads `input.decision` rather than approving regardless of which button was clicked (`ApprovalsInboxScreen.tsx:84-97`).

### MTP-USR-43 — view_own vs view_all, side by side
- **Persona pair:** كريم فؤاد (`sales.invoice.view_own`) vs عمر هلال (`sales.invoice.view_all`)
- **Steps:** both open فواتير المبيعات. كريم confirms his own list only shows invoices where he is the salesperson.
- **Expected:** كريم's list is a strict subset of عمر's; if كريم can see another rep's invoice by number/URL guess, the `view_own` scope is not actually enforced server-side (the route should 404, per the codebase's own documented rule that a `view_own` holder gets 404 not 403 on someone else's document, `sales-invoices-routes.ts:737`).

### MTP-USR-44 — Notification channel: honestly labeled, not silently broken
- **Persona:** any with settings access
- **Steps:** الإعدادات → قواعد التنبيهات → new rule → open the «القنوات» multi-select, look at the البريد الإلكتروني (email) option.
- **Expected:** the option is labeled «البريد الإلكتروني — قيد الإرسال فقط» (queued only, `apps/web/src/i18n/catalog.ts:638`) rather than presenting as a working channel that silently never sends — a good example of not overpromising a feature as if it were done.

### MTP-USR-45 — Reload a list screen mid-filter
- **Steps:** on فواتير المبيعات, set a status filter and a date range, then reload the page.
- **Expected:** filters are carried in the URL (`useUrlParam`/`useUrlSearch`, seen throughout `SalesInvoicesScreen.tsx`), so a reload should restore the same filtered view — unlike the create-form data loss in MTP-USR-19, list-level state is intentionally URL-backed. Confirm this holds after a full reload, not just a soft navigation.

---

## Gaps — no screen to test

These are named directly in the project's own testing notes and confirmed
absent from `apps/web/src/router/screens.ts` (116 routed screens,
exhaustively listed — none of the following appear):

- **POS / point-of-sale.** No `pos.*` route exists at all; the ROLES table even
  carves POS permissions out of every seeded role's grant on purpose
  (`packages/backend/src/demo-seed/access.ts:40`, "`pos.*` is the one module
  this tenant does not hold").
- **Email / WhatsApp notification delivery.** The rule-builder UI exists and is
  honestly labeled «قيد الإرسال فقط» (MTP-USR-44) — there is no screen where a
  clerk could watch a WhatsApp message actually leave, because the channel
  itself is unimplemented by decision, not by omission.
- **Statutory payroll filing, five-year volume behaviour, offline/restore
  flows, Postgres parity.** Named as manual/out-of-scope in the project's own
  testing notes — no operator-facing screen surfaces any of these for a
  click-through.
- **Workflow `minAmount` enforcement.** `DocumentWorkflowInput` carries no
  amount field to compare against, so a "requires approval above amount X"
  rule can be configured in الإعدادات but has no effect — there is a screen to
  *set* the threshold, none where its effect can be observed, because it does
  nothing yet.
