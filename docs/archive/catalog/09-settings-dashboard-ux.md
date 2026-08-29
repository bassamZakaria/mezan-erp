# Pass 9 — Settings, Dashboard, Global UX

> **Archived 2026-08-29 — a record, not current state.** Read `../../ROADMAP.md` for what is
> built and open, and `../../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `../README.md` in the archive root maps them.


Target: the reference system's staging environment (Arabic RTL). Tenant: النور للتجارة والتوزيع (code `<redacted>`), plan `ENTERPRISE`, industryType `TRADING`, businessProfile `FULL_ERP`.
Logged in as: يوسف محمد (<redacted>), `isTenantAdmin: true`, `permissions: ["*"]` — full-access account, so permission-matrix docs below reflect the schema, not this user's restricted view.

## Inventory of screens covered in this pass

### Settings (`/settings/*`)
- [x] عام (General) — `/settings`
- [x] نقل البيانات (Data migration) — `/settings/data-migration`
- [x] المستخدمون (Users) — `/settings/users`
- [x] الأدوار والصلاحيات (Roles & permissions) — `/settings/roles` (+ permission matrix)
- [x] الفروع (Branches) — `/settings/branches` (only what's new; shifts/POS/payment-methods tabs skipped per scope)
- [x] المستودعات (Warehouses) — `/settings/warehouses`
- [ ] إعدادات الوردية (Shift settings) — `/settings/shifts` — OUT OF SCOPE (already documented by another pass)
- [x] إعدادات الموافقات (Workflow/approvals config) — `/settings/workflow`
- [x] قواعد الإشعارات (Notification rules) — `/notifications/rules`
- [x] قوالب الطباعة (Print templates) — `/settings/print`
- [x] أكواد الباركود المدمجة (Barcode/label templates) — `/settings/barcode`
- [x] تسلسلات الترقيم (Numbering sequences) — `/settings/sequences`
- [x] سياسات الإجازات (Leave policies) — `/settings/leave-policies` — noted only (HR-owned, likely covered by pass 06)
- [x] الملف الشخصي (Profile) — `/settings/profile` — **not linked from the sidebar nav**; added by verification pass.
- [x] مفاتيح API (API Keys) — `/settings/api-keys` — **not linked from the sidebar nav**; added by verification pass. This IS the "Integrations screen" the original pass searched for and marked as a gap below (line "[ ] Integrations screen") — it just isn't reachable from anywhere in the visible UI, only by direct URL.
- [x] Webhooks — `/settings/webhooks` — **not linked from the sidebar nav**; added by verification pass. Same "Integrations screen" gap as API Keys, above.
- [x] واتساب (WhatsApp) — `/settings/whatsapp` — route confirmed real but **module-gated off** for this tenant (`activeModules[]` has no `whatsapp`); only the generic "module not activated" gate screen was capturable. Unfixable in this tenant without either a different demo tenant or platform-admin access to the feature flag.

### Dashboard (`/`)
- [x] KPI tiles, charts, widgets

### Global UX
- [x] Top bar: quick search (Ctrl+K), branch/warehouse scope selectors, language switcher, "system fault" banner, support, notifications bell, user menu
- [x] الموافقات (Approvals inbox) nav item — reachable, badge-driving endpoints identified
- [x] سجلات المراجعة والأمان (Audit & security log) — `/audit/reports`, found via quick-search only (not in sidebar nav)
- [ ] Subscription/plan screen — searched, not found as standalone UI (plan is read from tenant object: `ENTERPRISE`); noted as gap
- [x] Integrations screen — **RESOLVED by verification pass**: it exists as two separate un-linked routes, `/settings/api-keys` and `/settings/webhooks` (see the new "Settings — Developer/Integrations & Personal Account" section below) — the original pass's search was scoped to the visible sidebar/settings-tab UI, which never surfaces these; they were only found by extracting route strings from the JS bundle.
- [ ] Currencies management screen — not found separately; multi-currency config appears inline in general/financial settings + exchange rates under Accounting (out of scope, other pass)
- [x] المستودعات (Warehouses) + warehouse-type catalog
- [x] نقل البيانات (Data migration onboarding wizard) — 12-step import tool

## Tenant settings payload (raw, from `/api/auth/me` and localStorage `tenant`)

This is the authoritative source for tenant-level configuration (financial/general settings), decoded once via API rather than per-screen, since several settings tabs merely render slices of this object.

```json
{
  "plan": "ENTERPRISE",
  "industryType": "TRADING",
  "activeModules": ["sales","purchases","inventory","accounting","treasury","installments","financial_papers","crm","pos","hr","manufacturing","assets","notifications","loyalty","field"],
  "features": {
    "accounting.multi_currency": true,
    "accounting.eta": true,
    "accounting.cost_centers": true,
    "accounting.projects": true,
    "inventory.multi_warehouse": true,
    "sales.multi_price_list": true,
    "sales.credit_control": true,
    "purchases.sold_purchase_tracking": true,
    "pos.kitchen_display": true,
    "pos.restaurant_mode": true,
    "pos.delivery_tracking": true,
    "hr.attendance_biometric": true,
    "hr.attendance_mobile": true
  },
  "settings": {
    "currency": "EGP",
    "language": "ar",
    "timezone": "Africa/Cairo",
    "direction": "LTR",
    "dateFormat": "DD/MM/YYYY",
    "dateNumerals": "western",
    "weekendDays": [5, 6],
    "taxEnabled": true,
    "defaultTaxRate": 14,
    "taxCalculation": "EXCLUSIVE",
    "businessProfile": "FULL_ERP",
    "industryType": "GENERAL",
    "fiscalYearStartMonth": 1,
    "allowBackorder": false,
    "allowNegativeStock": false,
    "allowNegativeTreasury": true,
    "allowCrossWarehouseSales": true,
    "showOtherWarehouseStock": true,
    "requirePoForGrn": false,
    "requireGrnForInvoice": false,
    "priceListsEnabled": true,
    "multiCurrencyEnabled": true,
    "secondaryCurrencies": ["SAR","AED","QAR","KWD","BHD","OMR","JOD","USD","EUR","GBP"],
    "wacDriftTolerance": 0.01,
    "wacDriftAlertThreshold": 0,
    "wacAutoRebuildOnDrift": false,
    "fxRateMissingPolicy": "STRICT",
    "fxResidualTolerance": 0.05,
    "revaluationReversalMode": "NEXT_DAY",
    "creditControlEnabled": false,
    "accountingApprovalRequired": false,
    "attachmentsEnabled": true,
    "loyaltyEnabled": true,
    "trackSoldPurchaseItems": true,
    "salesDiscountContraEnabled": true,
    "salesLineDiscountContraEnabled": true,
    "depreciationProrate": "DAILY",
    "payrollDayDivisorBasis": "FIXED_30",
    "hrContractExpiryWarningDays": 30,
    "onboardingDismissed": false,
    "workflowConfig": [],
    "discount": {
      "approvalExpiryMinutes": 5,
      "cashierAutoAllowedAmount": 50,
      "managerAutoAllowedAmount": 500,
      "cashierAutoAllowedPercent": 10,
      "managerAutoAllowedPercent": 30
    }
  }
}
```

Notes on the payload:
- `activeModules` is the per-tenant module toggle list gating the entire left nav (matches what's visible: sales/purchases/inventory/accounting/treasury/installments/financial_papers/crm/pos/hr/manufacturing/assets/notifications/loyalty/field). No `projects` module flag despite a "المشاريع" nav item — projects appears to ride on `accounting.projects` feature flag instead.
- `features` is a finer-grained per-capability flag map layered under module activation (e.g. `pos.kitchen_display`, `pos.restaurant_mode`, `hr.attendance_biometric`).
- `workflowConfig: []` at the tenant-settings level looks like a legacy/unused field — the actual approvals engine config lives under `/settings/workflow` with its own API (see below), not in this array.
- `wacDriftAlertThreshold: 0` combined with `wacDriftTolerance: 0.01` suggests alerting is effectively disabled at 0 while a 1% tolerance still governs auto-adjustment.

---

## Dashboard

### لوحة التحكم (Dashboard — Home)
- **Route**: `/`
- **Purpose**: Company-wide (branch-scope-independent per footer note) landing page summarizing financial health, receivables/payables, inventory value, top performers, and recent activity for the day.
- **Content**:
  - Header: greeting "مرحباً، يوسف · طاب يومك" + date "الجمعة، ٢١ أغسطس ٢٠٢٦"; quick-action button row: فاتورة جديدة (new sales invoice), سند نقدي (cash voucher), استلام بضاعة (goods receipt), فاتورة مشتريات جديدة (new purchase invoice), أمر شراء جديد (new PO), عرض سعر (quote) — each presumably deep-links to the respective create form.
  - **KPI tiles** (4, each clickable — likely drills into a report):
    1. إجمالي الإيرادات · هذا الشهر (Total revenue this month) — value + "مقارنة بالشهر الماضي" (vs last month) + "خصومات الشهر" (month's discounts) sub-metric.
    2. المصروفات التشغيلية (Operating expenses) — value + vs-last-month.
    3. صافي الربح (Net profit) — value (can be negative, shown e.g. ‎-18,087.50) + هامش الربح (profit margin %, can be negative e.g. -643.3%).
    4. السيولة النقدية (Cash liquidity) — value + currency code (EGP).
  - **أداء الفترة (Period performance) chart**: line/area chart of Revenue/Expenses/Net Profit over time; legend: الإيرادات, المصروفات, صافي الربح. Range toggle buttons: 3 أشهر / 6 أشهر / 12 شهر. Subtitle notes "الخط المتقطع = الشهر الحالي (جزئي)" (dashed line = current month, partial). Backed by `GET /api/dashboard/revenue-trend?months=N`.
  - **يحتاج متابعة (Needs follow-up)** panel — "أولويات اليوم" (today's priorities), list of actionable alerts each with an action button:
    - "2 فواتير متأخرة" (2 overdue invoices) — 939.30 ج.م — button "تحصيل الآن" (collect now).
    - "ضريبة مستحقة للسداد" (tax due) — 308.70 ج.م — button "سداد للمصلحة" (pay to tax authority).
  - Second KPI row (3 clickable tiles, company-wide scope labeled "على مستوى الشركة"):
    - مبالغ لدى العملاء (Amounts held by customers / AR) — 2,782.30 ج.م
    - مستحقات الموردين (Payables to suppliers / AP) — 110.00 ج.م
    - قيمة المخزون (Inventory value) — 604,950.90 ج.م
  - **النشاط الأخير (Recent activity)** list, "ما يحدث في النظام", with "عرض الكل" (view all) button. Entries show action + date, e.g. "تفعيل منتج قابل للتهيئة WIRE-CU" (configurable product activated), "إيقاف منتج قابل للتهيئة WIRE-CU" (deactivated). Backed by `GET /api/dashboard/activity?limit=8`.
  - **المبالغ المتأخرة (Aging: overdue amounts)** widget — comparison table of العملاء (customers/AR) vs الموردين (suppliers/AP) across buckets: 1-30 يوم, 31-60 يوم, 61-90 يوم, +90 يوم. Backed by `GET /api/dashboard/invoice-aging` and `GET /api/dashboard/ap-aging`.
  - **توزيع المصروفات (Expense breakdown)** donut/pie chart — "نسبة كل فئة" (share per category); date-range filter buttons: هذا الشهر / آخر 3 أشهر / آخر 6 أشهر / آخر 12 شهرا. Center label shows total (e.g. "21.4 ألف · الإجمالي"). Legend list with % per category, observed categories: تكلفة البضاعة المباعة (COGS) 95%, هالك التصنيع (manufacturing waste) 5%, خسارة المخزون / النقص (inventory loss/shrinkage) 0%, خدمات خارجية ومقاولات (external services/contracting) 0%. Backed by `GET /api/dashboard/expense-breakdown?dateFrom=&dateTo=`.
  - **الأصناف الأعلى مبيعا (Top-selling items)** ranked list (top 5 shown, "الكل" to see more) — each row: rank, thumbnail, item name, unit qty, revenue value. Filter controls: date range (هذا الشهر/3/6/12 أشهر) × sort mode (بالقيمة value / بالكمية quantity) × tax mode (شامل الضريبة incl. tax / غير شامل الضريبة excl. tax). Backed by `GET /api/dashboard/top-products?sortBy=revenue&dateFrom=&dateTo=&taxMode=inc`.
  - **أعلى العملاء مبيعاً (Top customers)** ranked list — rank, name, invoice count, revenue value; same date-range and tax-mode filters. Backed by `GET /api/dashboard/top-customers?dateFrom=&dateTo=&taxMode=inc`. Includes a synthetic "عميل نقدي (نقطة بيع)" (POS cash customer) row.
  - Footer disclaimer: "جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة" (all financial figures are sourced from posted journal entries; branch scope does not affect company-wide figures) — important: dashboard KPIs are NOT branch-filtered despite the branch selector in the top bar.
- **Actions**: Quick-create buttons (6, see above); per-widget range/filter toggles; per-KPI-tile click-through (not followed, to stay read-only); "عرض الكل" on recent activity; "الكل" on top-items/top-customers.
- **API observed**:
  - `GET /api/dashboard/setup` → `{hasTransactions, hasBranches, hasWarehouses, hasItems, hasTreasuryAccounts, hasCustomers, hasCompanyInfo}` (all `true` here — drives an onboarding checklist that's hidden once all true).
  - `GET /api/dashboard/stats`
  - `GET /api/dashboard/attention` (feeds "يحتاج متابعة")
  - `GET /api/dashboard/activity?limit=8`
  - `GET /api/dashboard/revenue-trend?months=6` (also called with other month counts on toggle)
  - `GET /api/dashboard/drafts?limit=3`
  - `GET /api/dashboard/invoice-aging`
  - `GET /api/dashboard/ap-aging`
  - `GET /api/dashboard/expense-breakdown?dateFrom=&dateTo=`
  - `GET /api/dashboard/top-products?sortBy=revenue&dateFrom=&dateTo=&taxMode=inc`
  - `GET /api/dashboard/top-customers?dateFrom=&dateTo=&taxMode=inc`
  - `GET /api/me/dashboard-layout` → returned `data: null` for this user (suggests a per-user customizable widget layout feature exists but is unconfigured/default here — no visible "customize dashboard" UI control was found in this pass).
  - `GET /api/banners/active` (drives a promo/announcement banner slot, none visible today)
  - `GET /api/status/summary` (drives the "يوجد عطل في النظام" / system-fault top-bar indicator)
- **Notes**: `dashboard-layout` endpoint hints at per-user widget customization capability not surfaced in the UI during this pass (no edit/drag affordance found on tiles/widgets). Net profit and margin can render as negative values with proper RTL minus-sign placement (‎-18,087.50). Screenshots: `settings-00-dashboard.png` (full page), `settings-01-dashboard-charts.png` (viewport after switching trend chart to 3-month range).

---

## Global UX (top bar and app chrome)

### شريط علوي (Top bar)
- **Route**: present on every authenticated page.
- **Purpose**: global navigation, quick actions, scope selection, notifications, and account access.
- **Content / controls, right-to-left as rendered**:
  - **بحث سريع... (Quick search)** button, shortcut `Ctrl+K`. Opens a command-palette dialog (see below).
  - **الفرع الرئيسي (branch selector)** — dropdown button, currently shows the single active branch name ("الفرع الرئيسي" = Main Branch). Tenant has only `activeBranchCount: 1` so multi-branch switching wasn't exercisable in this tenant.
  - **كل المستودعات (warehouse selector)** — dropdown button, defaults to "all warehouses" scope; backed by `GET /api/warehouses`, `GET /api/warehouses/select?forTransferDestination=true`.
  - **اللغة (Language switcher)** — globe icon button, opens a dropdown with 3 options each with a flag icon: العربية 🇪🇬 (checked/active), English 🇺🇸, Deutsch 🇩🇪. Confirms the app is built for 3-locale support even though only Arabic was exercised.
  - **يوجد عطل في النظام (System fault indicator)** — a red-dot status button, backed by `GET /api/status/summary`; indicates a live system-health/incident banner capability (a status-page-style indicator sitting directly in the top bar, not just a separate status page).
  - **الدعم الفني (Support/help)** button — headset icon; likely opens a support/help contact flow (not opened, to stay non-destructive/read-only-safe; no obvious risk but out of pass scope to fully explore).
  - **الإشعارات (Notifications bell)** — badge shows unread count capped/displayed as "9+" pre-click, but the panel header showed "11" unread. Opens a dropdown panel (see below).
  - **User menu (يوسف محمد)** — avatar/name button, opens a menu with: الملف الشخصي (Profile), الإعدادات (Settings — links into `/settings`), separator, تسجيل الخروج (Logout).
- **API observed**: `GET /api/status/summary`, `GET /api/notifications/unread-count`, `GET /api/notifications?limit=10`, `GET /api/branches`, `GET /api/warehouses`.
- **Notes**: The collapsed/compact top bar (seen in the language-switcher screenshot) reflows controls into an icon-only row — avatar, notification bell, support, system-status dot, language globe, warehouse selector, branch selector, search — confirming the bar is responsive/collapsible. Screenshot: `settings-04-lang-switcher.png`.

### البحث السريع (Quick search / command palette)
- **Route**: modal dialog, triggered by the search button or `Ctrl+K`, layered over any page (URL doesn't change).
- **Purpose**: global omnibox to jump to any page or trigger a quick-create action, Arabic placeholder: "ابحث عن صفحة، عميل، مورد، فاتورة، أو إجراء" (search for a page, customer, supplier, invoice, or action).
- **Content**: Two suggestion groups shown with an empty query:
  - **إجراءات سريعة (Quick actions)**: إنشاء فاتورة مبيعات (create sales invoice), تحصيل دفعة (collect payment), إنشاء سند نقدي (create cash voucher), استلام بضائع (receive goods), صرف دفعة (disburse payment).
  - **الصفحات (Pages)**: a flat list of ~80 navigable pages/dashboards across every module, including several NOT present as direct sidebar links — notably dashboard overview pages per module (لوحة المبيعات, لوحة المشتريات, لوحة المخزون, لوحة الخزينة, نظرة عامة على المحاسبة, نظرة عامة على الأصول, لوحة علاقات العملاء, لوحة العمليات) and a **صندوق الوارد (Inbox)** page and **سجلات المراجعة (Audit logs)** page — see below.
- **Behavior**: typing filters the pages list live (tested with "سجلات المراجعة" → single matching option); Enter/click navigates directly, closing the dialog.
- **Notes**: This palette is the most complete map of the app's page inventory found in this pass — it surfaces pages absent from the visible sidebar, including the audit log (`/audit/reports`) and an inbox page (not yet resolved to a route in this pass — worth follow-up).

### الإشعارات (Notifications panel)
- **Route**: dropdown panel from the top-bar bell, not a full page (a "عرض جميع الإشعارات" / view-all button suggests a full listing page exists, unvisited).
- **Purpose**: real-time feed of system events relevant to the user.
- **Content**: Header "الإشعارات" with total count badge (11). Tabs: الكل (All, active by default) / غير مقروء N (Unread N). Button "تحديد الكل كمقروء" (mark all as read) — NOT clicked (would mutate state). List of notification cards, each with: title (e.g. "اكتمل أمر التصنيع" / manufacturing order completed, "بدأ أمر التصنيع" / manufacturing order started), relative timestamp (e.g. "قبل 17 دقيقة" / 17 minutes ago), and detail line (e.g. "اكتمل أمر التصنيع رقم WO-0010 — الكمية المنتجة: 2"). A "سابقا" (earlier) section divider groups older items. Footer button: "عرض جميع الإشعارات" (view all notifications).
- **API observed**: `GET /api/notifications/unread-count`, `GET /api/notifications?limit=10`.
- **Notes**: All observed notifications in this tenant were manufacturing work-order lifecycle events (WO-0005 through WO-0010) — no sales/purchase/approval notifications were present at capture time, though the notification-rules settings screen (`/notifications/rules`, documented below) confirms configurable triggers beyond manufacturing. Screenshot: `settings-03-notifications-panel.png`.

### الموافقات (Approvals inbox — nav item)
- **Route**: `/approvals`
- **Purpose**: Top-level nav item (peer to لوحة التحكم, not nested under a module) — central inbox for pending approval requests raised by the workflow/approvals engine.
- **API observed** (fired on every page load, not just this route): `GET /api/workflow/pending?limit=1`, `GET /api/workflow/my-rejected?limit=1` — meaning a pending/rejected approvals badge is computed globally, likely surfaced as a counter on the الموافقات nav item itself.
- **Notes**: Full screen contents documented separately if opened; see also `/settings/workflow` for the engine configuration that generates these approval requests. (This pass focused primary approvals-engine depth on the settings/workflow config screen per the assigned scope; the inbox itself was confirmed reachable and its badge-driving endpoints identified.)

### سجلات المراجعة والأمان (Audit & security logs)
- **Route**: `/audit/reports` (reachable via quick search only — not present in the visible left-nav tree, likely gated by a permission or hidden intentionally). Breadcrumb parents it under "الإعدادات" (Settings).
- **Purpose**: Security and sensitive-operation audit trail for compliance/investigation.
- **Content**:
  - Header stat cards: إجمالي الأحداث (Total events), خطورة عالية (High severity count), الفترة الزمنية (date range, defaults to trailing 30 days e.g. 2026-07-23 — 2026-08-22).
  - Two tabs: **أحداث الأمان (Security events)** and **العمليات الحساسة (Sensitive operations)**, each with its own count badge.
  - Filter bar: "تصفية النتائج" (filter results) toggle revealing من تاريخ / إلى تاريخ (from/to date, both required, HTML date inputs) + تطبيق (apply) button.
  - **Table columns**: التاريخ والوقت (timestamp, sortable), المستخدم (user — shows name + truncated UUID), الإجراء (action, sortable — observed values: `ACCOUNT_LOCKED`, `CREATE`), الوحدة (module, sortable — observed: `auth`, `hr`), نوع الكيان (entity type — observed: `AUTH_USER`, `CONTRACT`), الخطورة (severity, sortable — observed: `CRITICAL`, `WARNING`), التفاصيل (details, "—" when empty, implies an expandable/drill-in detail per row when populated).
  - Pagination: "عرض X - Y من Z", page-number buttons, صفوف لكل صفحة (rows per page) selector defaulting to 25.
  - Observed security-event row: `2026-08-07 00:52:01` — <redacted> — `ACCOUNT_LOCKED` — module `auth` — entity `AUTH_USER` — severity `CRITICAL` (an actual account-lockout event, likely from repeated failed logins).
  - Observed sensitive-operation row: `2026-08-11 09:59:38` — يوسف محمد — `CREATE` — module `hr` — entity `CONTRACT` — severity `WARNING` (HR contract creation flagged as a sensitive op).
- **API observed**: `GET /api/audit/reports/entries?type=security&dateFrom=&dateTo=&page=1&limit=25`, `GET /api/audit/reports/entries?type=sensitive&dateFrom=&dateTo=&page=1&limit=25`.
- **Notes**: This satisfies the "audit log if present" scope item — it exists but is not linked from the sidebar; only discoverable via the command palette. Severity taxonomy observed: `CRITICAL`, `WARNING` (others likely exist, e.g. `INFO`/`ERROR`, not observed in this limited dataset). Screenshot: `settings-02-audit-log.png`.

### Gaps confirmed in this pass
- **Subscription/plan screen**: no dedicated UI screen found under `/settings` or via quick search. Plan info (`ENTERPRISE`) is only exposed via the tenant object in API responses, not rendered as a standalone settings page.
- **Integrations screen**: no dedicated integrations/marketplace UI found. The closest analog is `/accounting/eta` (ETA e-invoicing integration), which is a domain-specific integration screen already noted, not a generic integrations hub.
- **Currencies management**: no standalone "currencies" settings screen; currency config is embedded in tenant settings (`currency`, `secondaryCurrencies`, `multiCurrencyEnabled`) and exchange rates are managed at `/accounting/exchange-rates` (out of this pass's scope, likely covered elsewhere).
- **صندوق الوارد (Inbox)**: appeared as a page option in the quick-search palette but its route wasn't resolved in this pass — flagged for follow-up, may be a personal task/notification inbox distinct from الموافقات.

---

## Settings — عام (General settings hub)

### الإعدادات (Settings — General hub, tabbed)
- **Route**: `/settings` (tabs via `?tab=` query param, e.g. `?tab=company`, `?tab=email`)
- **Purpose**: Central tenant-wide configuration hub with 10 tabs covering general/localization, company profile, email/SMTP, tax, credit control, inventory policy, purchase control, treasury policy, POS & loyalty, and POS payment methods (the last two out of scope for this pass — already documented elsewhere).
- **Actions**: Global "حفظ الإعدادات" (Save settings) button at top, disabled until a field changes (confirms unsaved-changes gating); NOT clicked in this pass (read-only rule).
- **Tabs**: عام, بيانات المنشأة, البريد الإلكتروني, الضريبة, الرقابة الائتمانية, سياسة المخزون, التحكم في المشتريات, سياسة الخزينة, نقطة البيع والولاء (out of scope), طرق الدفع في نقاط البيع (out of scope).

#### Tab: عام (General)
- **Content**:
  - العملة الافتراضية (Default currency) — combobox, value "جنيه مصري (ج.م)".
  - تفعيل العملات المتعددة (Multi-currency toggle) — shown as a read-only "نشط" (Active) badge with note "تدار هذه الميزة من قبل مدير المنصة" (managed by the platform admin) — i.e. NOT tenant-editable, platform-level flag only.
  - العملات الإضافية (Additional currencies) — multi-select chip picker, options: SAR, USD, AED, EUR, KWD, QAR, JOD (matches `secondaryCurrencies` array from the tenant payload, though that array also included AED/QAR/KWD/BHD/OMR/JOD/USD/EUR/GBP — UI shows only 7 of the 10, so either UI limits choices or scroll/overflow hides the rest).
  - سياسة غياب سعر الصرف (FX-rate-missing policy) — combobox, value "صارم — رفض المستند إذا لم يوجد سعر صرف" (Strict — reject the document if no exchange rate exists); maps to `fxRateMissingPolicy: STRICT`.
  - اللغة الافتراضية (Default language) — combobox, "العربية".
  - المنطقة الزمنية (Timezone) — combobox, "القاهرة (UTC+2)".
  - اتجاه الواجهة (UI direction) — combobox, value "LTR" (NOTE: this literally says LTR while the rendered app is RTL — likely a stored/legacy value mismatch worth flagging for the rebuild, or the field controls a different concern than actual UI rendering direction).
  - تنسيق التاريخ (Date format) — combobox, "يوم/شهر/سنة (31/12/2026)".
  - نظام الأرقام (Numeral system) — combobox, "أرقام غربية (0, 1, 2, 3)" (Western numerals).
  - السنة المالية (Fiscal year) — البداية/النهاية (start/end) date inputs, values 2026-01-01 / 2026-12-31; plus a second البداية (start month) combobox, "يناير" (January).
- **Notes**: Directly mirrors much of the tenant `settings` payload documented earlier (currency, language, timezone, dateFormat, fiscalYearStartMonth, fxRateMissingPolicy).

#### Tab: بيانات المنشأة (Company info)
- **Content**:
  - شعار الشركة (Company logo) — file upload dropzone, note: "JPG أو PNG, حد أقصى 2 ميجابايت. يظهر في الفواتير والطباعة" (max 2MB, appears on invoices/print).
  - اسم المنشأة (Company name) — textbox, "النور للتجارة والتوزيع".
  - الرقم الضريبي (Tax registration number) — textbox, empty.
  - السجل التجاري (Commercial registration number) — textbox, empty.
  - الهاتف (Phone) / البريد الإلكتروني (Email) — paired textboxes, both empty.
  - العنوان (Address) — textbox, empty.
  - أيام نهاية الأسبوع (Weekend days) — multi-select day-of-week chips (السبت...الجمعة), currently السبت (Saturday) and الجمعة (Friday) selected; note: "الأيام غير العاملة في المنشأة — تعتمد عليها خدمات الإجازات والحضور في حساب أيام العمل" (non-working days feed leave/attendance day calculations). Matches `weekendDays: [5,6]`.
  - فترة التنبيه على انتهاء العقد (يوم) (Contract-expiry warning period, days) — numeric input, value 30, note: allowed range 7–365, default 30 per Egyptian labor law notice period. Matches `hrContractExpiryWarningDays: 30`.
  - معامل العمل الإضافي (Overtime pay multiplier) — numeric input, value 1.5, note: default 1.5 = 1.5x wage.
  - ساعات العمل اليومية القياسية (Standard daily work hours) — numeric input, value 8; note: overtime = hours beyond this, feeds monthly-salary hourly-rate derivation.
- **Notes**: This tab blends company profile fields with HR policy constants (weekend days, overtime multiplier, standard hours, contract-expiry warning) — likely because these feed both HR attendance calculations and general company identity, so it's a shared config surface. Overlaps with pass-06 (CRM/HR) territory but documented here since it lives under general settings.

#### Tab: البريد الإلكتروني (Email / SMTP)
- **Content**:
  - تفعيل إرسال البريد الإلكتروني (Enable email sending) — toggle, currently OFF.
  - مزود الإرسال (Send provider) — combobox, "SMTP" (alternative implied: a service like Resend — helper text: "يعمل Resend عبر HTTPS فلا تحجبه جدران الحماية. أما SMTP فقد تحجبه بعض الشبكات" / Resend works over HTTPS and isn't blocked by firewalls, unlike SMTP).
  - خادم SMTP (SMTP host)* — textbox, placeholder "smtp.gmail.com".
  - المنفذ (Port)* — textbox, placeholder "587", help text "TLS ل 587، أو SSL ل 465" (587 for TLS, 465 for SSL).
  - اسم المستخدم (Username) / كلمة المرور (Password) — textboxes, empty.
  - بريد المرسل (Sender email)* — textbox, placeholder "noreply@company.com".
  - اسم المرسل (Sender name) — textbox, placeholder "النور للتجارة والتوزيع".
  - إرسال بريد تجريبي (Send test email) — textbox pre-filled "<redacted>" + button "إرسال تجريبي" (send test), help text: "يستخدم الاختبار الإعدادات المحفوظة — احفظ التغييرات قبل الإرسال" (test uses saved settings — save before sending). NOT triggered (read-only rule).
  - قالب البريد الإلكتروني (Email template) section — toggle "استخدام قالب مخصص" (use custom template), currently OFF:
    - معاينة (Preview) panel rendering a live sample email: "فاتورة مبيعات جديدة بانتظار موافقتك" (new sales invoice awaiting your approval) — body: "تم إنشاء الفاتورة INV-000123 بقيمة 1,150.00 ج.م للعميل. يرجى مراجعتها واعتمادها من خلال الزر بالأسفل." — button "عرض التفاصيل" (view details). **This confirms email notifications are wired to the approvals workflow** (sales invoice approval emails).
    - رابط الشعار (Logo URL) — textbox, placeholder "https://.../logo.png", help: direct link to company logo (https), placed at `{{logo}}` in the header.
    - ترويسة (HTML) (Header HTML) — code textarea, pre-filled with a default template using `{{logo}}` and `{{companyName}}` placeholders and inline styles (dark navy background `#0f172a`).
    - تذييل (HTML) (Footer HTML) — code textarea, default template with `{{year}}`, `{{companyName}}` placeholders, "© {{year}} {{companyName}} — جميع الحقوق محفوظة" (all rights reserved).
    - Help line listing available template variables: "{{year}} · {{companyName}} · {{logo}}".
    - Button "حفظ القالب" (Save template) — separate from the page-level save button, NOT clicked.
- **API/behavior notes**: This is a full custom SMTP + HTML email-template editor, tenant-scoped, feeding at least the invoice-approval-request notification type. Screenshots: `settings-07-email-tab.png` (top), `settings-07b-email-tab-scrolled.png` (template editor, scrolled).

#### Tab: الضريبة (Tax)
- **Content**:
  - تفعيل ضريبة القيمة المضافة (Enable VAT) — toggle, ON. Matches `taxEnabled: true`.
  - نسبة الضريبة الافتراضية (%) (Default tax rate) — numeric input, value 14. Matches `defaultTaxRate: 14`.
  - طريقة حساب الضريبة (Tax calculation method) — combobox, value "غير شاملة (تضاف على السعر)" (Exclusive — added on top of price). Matches `taxCalculation: EXCLUSIVE`. This is the "tax mode" the assignment scope asked about.
  - إهلاك شهر الاقتناء (Acquisition-month depreciation method) — combobox, value "يومي (نسبة الأيام) — IFRS" (Daily/day-ratio, IFRS standard), help text: "كيف يحتسب إهلاك الشهر الذي اشتري فيه الأصل. «يومي» يحتسب نسبة الأيام التي فيها امتلكت الأصل خلال الشهر (المعيار المحاسبي IFRS). إجمالي الإهلاك على عمر الأصل لا يتغير — فقط يتغير توزيعه شهرياً." Matches `depreciationProrate: DAILY`. (Note: this field lives on the Tax tab despite being an asset-depreciation policy — cross-domain placement worth flagging.)
  - الرقم الضريبي (Tax registration number) — textbox, placeholder "300xxxxxxxxx" (Egyptian 15-digit VAT format), currently empty.
  - Info callout with a deep link: "لإدارة نسب ضريبية متعددة (مخفضة، معفاة، صادرات) اذهب إلى: المحاسبة ← الضرائب ← معدلات الضرائب" (to manage multiple tax rates — reduced, exempt, exports — go to Accounting → Taxes → tax rates), linking to `/accounting/taxes` (out of this pass's scope, covered elsewhere).
- **Notes**: This tab is the authoritative "tax mode" control the assignment asked about — confirms exclusive-tax calculation and a single default rate, with multi-rate management deferred to a separate Accounting screen.

#### Tab: الرقابة الائتمانية (Credit control)
- **Content**:
  - تفعيل قوائم الأسعار (Enable price lists) — toggle, ON. Matches `priceListsEnabled: true`. Help: "السماح بربط العملاء بقوائم أسعار مخصصة عند إنشاء الفواتير والعروض" (allow linking customers to custom price lists on invoices/quotes).
  - تفعيل الرقابة الائتمانية (Enable credit control) — toggle (visually appears set, though tenant payload showed `creditControlEnabled: false` — worth re-verifying in a follow-up since the UI toggle rendering was ambiguous in the screenshot).
  - وضع الرقابة (Credit control mode) — combobox, value "تحذير فقط (WARNING)", help text: "تحذير: يعرض تنبيه عند تجاوز الحد. منع تام: يمنع إنشاء الفاتورة." (Warning: shows an alert when the limit is exceeded. Full block: prevents invoice creation.) Implies at least two enum modes: `WARNING` and a full-block mode (likely `BLOCK`).
- **Notes**: This is the "credit control" mechanism the assignment scope asked about — it's a per-customer credit-limit enforcement gate on sales invoice creation, with a configurable enforcement strictness (warn vs. hard block).

#### Tab: سياسة المخزون (Inventory policy)
- **Content** (section intro: "تحكم في سلوك البيع عند عدم توفر المخزون" — control sale behavior when stock is unavailable):
  - السماح بالبيع من مستودع آخر (Allow selling from another warehouse) — toggle, ON. Help: "عند نفاد المخزون من مستودع الفاتورة: اسمح بالبيع من مستودع آخر إذا توفر في مستودع آخر." Matches `allowCrossWarehouseSales: true`.
  - عرض المخزون في المستودعات الأخرى (Show stock in other warehouses) — toggle, ON. Help: "إظهار شارة بالكميات المتوفرة في المستودعات الأخرى أثناء إضافة الأصناف في فاتورة المبيعات." Matches `showOtherWarehouseStock: true`.
  - السماح بالطلبات المؤجلة (Allow backorders) — toggle, OFF. Help: "السماح بتأكيد فاتورة مبيعات حتى لو لم تكن جميع الأصناف متوفرة الآن (يسجل العجز كطلب مؤجل)." Matches `allowBackorder: false`.
  - السماح بالمخزون السالب (Allow negative stock) — toggle, OFF. Help: "السماح بتأكيد عمليات البيع والاسترداد حتى لو نتج عنها مخزون أقل من صفر. يطبق على فواتير المبيعات ومرتجعات المشتريات ونقاط البيع وإلغاء استرداد نقاط البيع." Matches `allowNegativeStock: false`.
  - مخصص هبوط المخزون حسب التقادم (Aging-based inventory write-down / shrinkage provision) — toggle, OFF. Help: "خصم تلقائي على صنف المخزون الراكد حسب نسبة يخصص بنسبة المدة المحددة. يرحل شهرياً بمخصص (5060) مقابل مصروف (1190) كمخصص ولا يمس تكلفة المخزون." — an automatic monthly provisioning journal entry against slow-moving stock, posting to account codes 5060 (provision, contra-asset) vs 1190 (expense), without touching actual inventory cost. This is an advanced WAC-adjacent accounting policy not previously documented.
  - توليد رقم الدفعة تلقائيا (Auto-generate batch/lot number) — toggle, OFF. Help: "عند الاستلام يمكن ترك رقم الدفعة فارغاً ليولد تلقائياً. الإدخال اليدوي يبقى الافتراضي (للحفاظ على تتبع أرقام دفعات المورد في الأدوية والأغذية)." — manual entry is default to preserve supplier batch-number traceability for pharma/food.
- **Notes**: Directly corresponds to the assignment's "WAC drift tolerance" scope area conceptually (inventory costing policy), though the actual `wacDriftTolerance`/`wacDriftAlertThreshold`/`wacAutoRebuildOnDrift` fields from the tenant settings payload were NOT found as editable fields on this tab or any other settings tab in this pass — they may be platform-managed-only (not tenant-editable), similar to the multi-currency toggle. Flagged as a gap.

#### Tab: التحكم في المشتريات (Purchase control)
- **Content** (section intro: "اضبط مستوى الصرامة في دورة المشتريات — من إنشاء أوامر الشراء حتى فواتير الموردين" — set strictness level in the purchase cycle from PO creation through supplier invoices):
  - يجب وجود أمر شراء قبل استلام البضاعة (Require PO before goods receipt) — toggle, OFF. Help: "عند التفعيل، لا يمكن إنشاء مذكرة استلام (GRN) إلا إذا كان هناك أمر شراء مؤكد." Matches `requirePoForGrn: false`.
  - يجب وجود استلام بضاعة قبل فاتورة الشراء (Require goods receipt before purchase invoice) — toggle, OFF. Help: "عند التفعيل، لا يمكن إنشاء فاتورة شراء مباشرة — يجب إنشاؤها من استلام بضاعة مؤكد." Matches `requireGrnForInvoice: false`.
  - تتبع البضاعة المستهلكة من فواتير الشراء (Track sold-purchased items) — toggle, ON. Help: "عند التفعيل، لا يمكن إلغاء فاتورة شراء إذا كان قد تم بيع أو تحويل أو استهلاك أيٍّ من بضاعتها لاحقاً. الافتراضي: معطل." Matches `trackSoldPurchaseItems: true`.
- **Notes**: This is a 3-gate procurement strictness model (PO→GRN→Invoice enforcement, plus a cancellation-safety guard) — all three gates are currently OFF/lenient except the sold-item tracking guard, meaning this tenant runs a loose procurement flow (any purchase invoice can be created without a prior PO or GRN).

#### Tab: سياسة الخزينة (Treasury policy)
- **Content** (section intro: "تحكم في سلوك المدفوعات والتحصيلات" — control payment/collection behavior):
  - منع الرصيد السالب للحسابات النقدية (Prevent negative balance for cash accounts) — toggle, ON. Help: "يمنع تأكيد أي سند صرف أو تحويل يجعل رصيد حساب نقدي سالباً (لأن درج النقدية لا يمكن أن يكون سالباً). الحسابات البنكية غير متأثرة (تسمح بالسحب على المكشوف)." — Important nuance: this restriction applies ONLY to cash-drawer-type treasury accounts; bank accounts are explicitly exempted and may go negative (overdraft allowed). This reconciles with the tenant payload's `allowNegativeTreasury: true` — that flag apparently governs bank accounts specifically, while cash accounts are hard-blocked from going negative regardless.
- **Notes**: Single-toggle tab, but the help text embeds an important account-type-aware business rule (cash vs. bank treated differently) relevant to the rebuild's treasury/account-type model.

Screenshots for this section: `settings-08-tax-tab.png`, `settings-09-credit-tab.png`, `settings-10-inventory-tab.png`, `settings-11-purchase-tab.png`, `settings-12-treasury-tab.png`.

**Navigation note**: Tab state is client-side only — reloading the page via direct URL with a `?tab=` query resets to the "عام" tab; tabs must be reached by clicking within the app to preserve state (the query string does update to reflect the active tab, e.g. `?tab=purchases`, `?tab=treasury`, but a fresh navigation to that URL does not restore it).

---

## Settings — المستخدمون والصلاحيات (Users & Roles/Permissions)

### المستخدمون (Users list)
- **Route**: `/settings/users`
- **Purpose**: Manage tenant user accounts, their roles, and branch/warehouse scoping.
- **Content**:
  - Stat cards: الأدوار المستخدمة (roles in use) 2, مستخدمون نشطون (active users) 4, إجمالي المستخدمين (total users) 5.
  - Search box (name/email) + "تصفية النتائج" (filter) panel with fields: الدور (role, combobox), الفروع المتاحة (available branches, combobox), آخر دخول من/إلى (last login date range).
  - Status filter tabs: الكل (5), نشط (4), غير نشط (1).
  - **Table columns**: الاسم الكامل (avatar initials + full name + email), الدور (role badge, e.g. "مدير المنشأة", "مندوب مبيعات"), الفروع المتاحة (branch name), آخر دخول (last login timestamp or "لم يسجل بعد" = never logged in), الحالة (status: نشط/غير نشط), row "..." actions menu.
  - Observed rows (5 users, all on "الفرع الرئيسي" — single-branch tenant): 3 users with role "مدير المنشأة" (Company Admin, including the demo <redacted>), 1 "مندوب مبيعات" (Sales Rep), all "نشط" except one "غير نشط".
- **Actions**: "إضافة مستخدم" (Add user) button → navigates to `/settings/users/new`.

### إضافة مستخدم / تعديل مستخدم (Add/Edit User form)
- **Route**: `/settings/users/new` (create); presumably `/settings/users/:id/edit` for editing (not opened, to avoid mutating an existing account).
- **Purpose**: Create a new user account with role, permissions scope, and branch/warehouse access.
- **Content** (3 sections):
  1. **معلومات الحساب (Account info)**: photo upload (تحميل صورة), الاسم الكامل* (full name), البريد الإلكتروني* (email), كلمة مرور مؤقتة* (temporary password, min. 8 chars), الهاتف (phone) with a full ISO country picker (defaults to Egypt, +20) plus number field.
  2. **الدور والصلاحيات (Role & permissions)**:
     - الدور* (Role) — searchable combobox; in this tenant only ONE assignable custom role appears: "مندوب مبيعات" (Sales Rep, code VAN_SALES). This confirms company-admin is NOT a selectable role in this dropdown — it's granted exclusively via the toggle below.
     - صلاحيات مدير المنشأة (Company-admin permissions) — a separate switch/toggle, help text: "صلاحيات كاملة لجميع الفروع والمستودعات والإعدادات" (full permissions for all branches, warehouses, and settings). This is effectively a super-admin bypass flag independent of the granular role/permission system.
     - الموظف المرتبط (Linked employee) — optional searchable combobox to link the user login to an HR employee record, help text: "اربط حساب المستخدم بسجل موظف — مثلاً ربط حساب دخول السائق بسجل الموظف السائق" (e.g. link a driver's login to their employee record) — ties into field/mobile app logins (van sales drivers).
  3. **الفروع والمستودعات (Branches & warehouses)**:
     - الفروع المتاحة* (Available branches) — checkbox list, at least one required; only "الفرع الرئيسي (MAIN)" exists in this tenant.
     - المستودعات المتاحة (Available warehouses) — checkbox list grouped by branch, e.g. "مستودع الفرع الرئيسي" and "سياره نقل" (a van/vehicle warehouse) both under الفرع الرئيسي — confirms warehouses can represent mobile/vehicle stock locations, not just physical sites.
- **Actions**: "حفظ المستخدم" (Save user) — NOT clicked (read-only rule). Back navigation via breadcrumb.
- **Notes**: User scoping is two-dimensional — WHICH branches/warehouses a user can operate in, independent of WHAT actions their role permits within that scope.

### الأدوار والصلاحيات (Roles list)
- **Route**: `/settings/roles`
- **Purpose**: Manage custom roles and view/edit their permission grants.
- **Content**:
  - Stat cards: إجمالي الصلاحيات (total permissions in the system) 4 [NOTE: this counter reflects permissions GRANTED across all roles, not the system's total permission catalog — the catalog itself has ~268 permissions, see matrix below], الأدوار المخصصة (custom roles) 1, أدوار النظام (system/built-in roles) 0, إجمالي الأدوار (total roles) 1.
  - Filter tabs: الكل (1) / نظام (0) / مخصص (1); plus a "النوع" (type) combobox filter.
  - **Table columns**: اسم الدور (role name), الكود (role code, e.g. `VAN_SALES`), عدد الصلاحيات (permission count, e.g. 4), الحالة (نظام/مخصص — system/custom), التاريخ (created date), row actions.
  - Only one role exists in this tenant: "مندوب مبيعات" / `VAN_SALES`, custom, 4 permissions, created 08/08/2026.
- **Actions**: "دور جديد" (New role) button — NOT opened as a fresh create flow beyond noting its presence (matrix explored via editing the existing role instead, per the "open an existing role" allowance in the task rules).

### تعديل الدور (Role editor — THE PERMISSION MATRIX)
- **Route**: `/settings/roles/:id/edit` (opened for role `VAN_SALES`, id `e962a65e-9c4c-42cd-aeeb-d02d9560d4fe`)
- **Purpose**: Define a role's name/code/description and its exact permission grants across every module in the system, with dependency enforcement between permissions.
- **Content — header fields**: اسم الدور* (role name, "مندوب مبيعات"), رمز الدور* (role code, "VAN_SALES", presumably immutable/unique), وصف الدور (role description, free text, empty here).
- **Content — left sidebar summary panel**: الصلاحيات المحددة (selected permissions count, 4), الوحدة (modules touched, 2), حساسة (sensitive permissions selected, 0), then a breakdown list "الوحدة" showing which modules have grants and how many (المبيعات 2, المبيعات الميدانية 2).
- **Content — permission matrix** (right panel, dominant content): a search-by-name box, then one collapsible section per **module**, each with a header showing a "selected/total" badge (e.g. "27/2" rendered as "٢ / ٢٧" meaning 2 of 27 selected) and a module-level "select all" checkbox. Within each module, permissions are further grouped into **sub-groups** (e.g. Sales → الفواتير/العملاء/عروض الأسعار/المرتجعات/قوائم الأسعار/الأسعار). Each individual permission renders as a card with: Arabic label, a checkbox, a dot-notation **permission code** (`module.entity.action`), a one-line Arabic description, and — where applicable — a "تعتمد على: <other.code>" (depends on) line listing prerequisite permission(s) that must also be granted (the UI appears to enforce/display this dependency graph). A subset of permissions carry a ⚠ "sensitive" flag (observed on `sales.invoice.view_cost` — viewing cost price on sales invoices; also called out by name in `pos.delivery.cancel`'s description: "حساس لأنه يعكس حركة الأموال" / sensitive because it reverses a money movement).
- **Actions**: "حفظ الدور" (Save role) — NOT clicked. Per-permission checkboxes are individually toggleable, and each module header checkbox presumably selects/deselects all permissions in that module (not tested, to avoid mutating state).

#### FULL PERMISSION CATALOG (all modules and actions found in the matrix, ~268 total permissions across 19 modules)

Format: **Module (Arabic — badge count)** → sub-group → `permission.code` (Arabic label) [dependency if any]

1. **لوحة التحكم (Dashboard) — 2 total**: `dashboard.view` (عرض لوحة التحكم), `dashboard.export` (تصدير لوحة التحكم) [dep: dashboard.view]

2. **المبيعات (Sales) — 27 total**, sub-groups:
   - الفواتير (Invoices): `sales.invoice.view`, `sales.invoice.view_own`, `sales.invoice.view_all` [dep:view], `sales.invoice.view_cost` ⚠sensitive [dep:view], `sales.invoice.create` [dep:view_own], `sales.invoice.edit` [dep:view_own], `sales.invoice.confirm` (confirm/send for approval) [dep:view_own], `sales.invoice.void` [dep:view_own], `sales.invoice.print` [dep:view_own], `sales.invoice.delete_draft` [dep:view_own]
   - العملاء (Customers): `sales.customer.view`, `sales.customer.create` [dep:view], `sales.customer.edit` [dep:view], `sales.customer.merge` (irreversible dedup merge) [dep:edit]
   - عروض الأسعار (Quotes): `sales.quote.view`, `sales.quote.view_own`, `sales.quote.create` [dep:view_own], `sales.quote.edit` [dep:view_own], `sales.quote.send` [dep:view_own]
   - المرتجعات (Returns): `sales.return.view`, `sales.return.view_own`, `sales.return.create` [dep:view_own], `sales.return.confirm` [dep:view_own], `sales.return.void` [dep:view_own]
   - قوائم الأسعار (Price lists): `sales.price_list.view`, `sales.price_list.manage` [dep:view]
   - الأسعار (Pricing): `sales.price.override` (override system-computed prices on invoices/quotes) [dep: sales.invoice.create]

3. **المشتريات (Purchases) — 34 total**, sub-groups:
   - الموردين (Suppliers): `purchases.supplier.view`, `.create` [dep:view], `.edit` [dep:view]
   - أوامر الشراء (PO): `purchases.order.view`, `.create` [dep:view], `.cancel` [dep:view], `.edit` [dep:view], `.confirm` [dep:view]
   - طلبات عروض الأسعار (RFQs): `purchases.rfq.view`, `.create` (create/edit/send RFQ + record supplier responses) [dep:view], `.convert` (convert winning quote to PO) [dep: rfq.view, order.create]
   - إيصالات الاستلام (GRN): `purchases.receipt.view`, `.create` [dep:view], `.edit_cost` (override unit cost on receipt lines — directly affects inventory journal entry) [dep:create], `.confirm` [dep:view], `.void` (reverses stock, cost layers, and receipt-adjustment entry) [dep:view]
   - فواتير المشتريات (Purchase invoices): `purchases.invoice.view` (all invoices org-wide), `.view_own`, `.create` [dep:view_own], `.confirm` [dep:view_own], `.void` [dep:view_own], `.delete_draft` [dep:view_own], `.edit` [dep:view_own]
   - مرتجعات المشتريات (Purchase returns): `purchases.return.view`, `.create` [dep:view], `.confirm` [dep:view], `.void` [dep:view]
   - التكاليف المحملة (Landed costs): `purchases.landed_cost.view`, `.create` [dep:view], `.edit` [dep:view], `.confirm` [dep:view], `.void` [dep:view], `.delete_draft` [dep:view]
   - ملف المورد 360: `purchases.supplier360.view` [dep: supplier.view]

4. **المخزون (Inventory) — 12 total**:
   - الأصناف: `inventory.item.view`, `.create` [dep:view], `.edit` [dep:view]
   - المخزون: `inventory.stock.view`
   - تحويلات المخزون: `inventory.transfer.view`, `.create` [dep:view], `.confirm` [dep:view]
   - التسويات: `inventory.adjustment.view`, `.create` [dep:view], `.confirm` [dep:view]
   - تقييم المخزون: `inventory.valuation.view` [dep: stock.view], `inventory.valuation.rebuild` (re-run transactions to recompute WAC, optionally overwriting cache) [dep:valuation.view]

5. **المبيعات الميدانية (Field Sales / Van) — 4 total**:
   - Van Trip: `field.van_trip.view` (manager — all trips), `.view_own` (own crew's trips), `.open` (open trip + load stock) [dep:view_own], `.settle` (reconcile van stock & cash, close trip) [dep:view]

6. **المحاسبة (Accounting) — 17 total**:
   - دليل الحسابات: `accounting.coa.view`, `.manage` [dep:view]
   - القيود (Journals): `accounting.journal.view`, `.create` [dep:view], `.post` (post to ledger) [dep:view], `.approve` (workflow approval) [dep:view]
   - الفترات المالية: `accounting.period.view`, `.close` (period + year-end close) [dep:view], `.reopen` [dep:close]
   - التقارير المالية: `accounting.reports.view` (incl. PDF/Excel export)
   - أسعار الصرف: `accounting.exchange_rate.manage`, `.approve` [dep:manage]
   - الضرائب: `accounting.tax.view`, `.manage` [dep:view]
   - الفوترة الإلكترونية (ETA e-invoicing): `accounting.eta.view`, `.submit` (submit/resubmit/export to Egyptian Tax Authority) [dep:view], `.cancel` [dep:view]

7. **الخزينة (Treasury) — 26 total**:
   - حسابات الخزينة: `treasury.account.view`, `.manage` [dep:view]
   - تحويل الأرصدة: `treasury.balance_transfer.create` [dep: account.view]
   - تسويات العملاء/الموردين/الخزينة: `treasury.customer_adjustment.create`, `treasury.supplier_adjustment.create`, `treasury.treasury_adjustment.create` (all dep: account.view)
   - التخصيصات (Allocations): `treasury.allocation.view` [dep:account.view], `.manage` [dep:account.view]
   - التحويلات الداخلية: `treasury.transfer.view`, `.create` [dep: transfer.view, account.view], `.confirm` [dep:view], `.void` [dep:view]
   - سندات القبض والصرف (Cash vouchers): `treasury.cash_voucher.view` [dep:account.view], `.create` [dep: cash_voucher.view, account.view], `.confirm` (posts entry + applies allocations; also serves as workflow approval) [dep:view], `.void` (posts reversal) [dep:view]
   - مرتجعات العملاء (Customer refunds): `treasury.customer_refund.view`, `.create` [dep: refund.view, account.view], `.confirm` (or send to approval) [dep:view], `.approve` (workflow) [dep:view], `.void` [dep:view]
   - التسويات البنكية (Bank reconciliation): `treasury.reconciliation.view` [dep:account.view], `.import` (CSV/OFX/manual) [dep:view], `.match` (auto/manual match, unmatch, exclude) [dep:view], `.create` (create payment/entry from unmatched line) [dep:view], `.finalize` (finalize/reopen — manager level) [dep:view]

8. **سير العمل (Workflow) — 5 total**:
   - الموافقات: `workflow.view` (view pending approvals), `workflow.approve` [dep:view], `workflow.reject` [dep:view]
   - إعدادات سير العمل: `workflow.config.view`, `workflow.config.manage` [dep:view]

9. **الموارد البشرية (HR) — 36 total**:
   - الموظفين: `hr.employee.view`, `.create` [dep:view], `.edit` [dep:view], `.view_salary` ⚠(salary details) [dep:view], `.view_personal` ⚠(personal data) [dep:view], `.terminate` [dep:edit]
   - الإجازات: `hr.leave.view`, `.approve` [dep:view], `.create` [dep:view]
   - Advance (سلف): `hr.advance.view`, `.approve` (approve+disburse) [dep:view], `.create` [dep:view]
   - الرواتب (Payroll): `hr.payroll.view`, `.run` [dep:view], `.approve` [dep:view], `.pay` [dep:approve], `.create` (create payroll runs) [dep:view], `.calculate` [dep:create], `.void` [dep:view]
   - الحضور: `hr.attendance.view`, `.edit` [dep:view]
   - العقود: `hr.contract.view` [dep: employee.view], `.create` [dep:view], `.edit` [dep:view]
   - الأقسام: `hr.department.view`, `.create` [dep:view], `.edit` [dep:view]
   - المسميات الوظيفية: `hr.job_title.view`, `.create` [dep:view], `.edit` [dep:view]
   - سياسات الإجازات: `hr.leave_policy.view`, `.edit` [dep:view], `.apply_preset` (apply a named template like EGYPT_2003) [dep:edit]
   - استحقاق الإجازات (Leave accrual): `hr.leave_accrual.run` [dep: policy.view], `.year_end` (roll-forward + forced payout) [dep:run], `.migrate_open` (one-time opening-balance recognition per IAS 8) [dep:run]

10. **نقطة البيع (POS) — 38 total** (largest module):
    - الأجهزة (Terminals): `pos.terminal.view`, `.manage` [dep:view], `.open_session` [dep:view], `.close_session` [dep:open_session]
    - الورديات (Sessions): `pos.session.view`, `.open` [dep:view], `.close` [dep:open], `.force_close` (force-close with pending offline sales) [dep:close]
    - المبيعات: `pos.sale.view`, `.create` [dep: sale.view, session.open], `.refund` [dep:view], `.discount` [dep:create]
    - المطعم (Restaurant): `pos.restaurant.view`, `.manage` [dep:view], `.order` [dep:view], `.pay` [dep:order], `.cancel` (post-kitchen-send cancel — manager) [dep:view], `.reopen` (reopen a paid order for correction) [dep:view]
    - الطلبات: `pos.order.set_priority` (mark rush order, surfaces on kitchen display) [dep: restaurant.view]
    - الحجوزات: `pos.reservation.view` [dep:restaurant.view], `.create` [dep:view], `.edit` [dep:view]
    - المطبخ (Kitchen): `pos.kitchen.view`, `.operate` [dep:view], `.recall` (manager override to un-cook/un-ready an item) [dep:view]
    - التقارير: `pos.reports.view`
    - المرتجعات: `pos.refund.create` [dep: sale.view]
    - البيع المعلق (Suspended sales): `pos.suspend.create`, `.resume` [dep:create], `.void` [dep:create]
    - الخصومات: `pos.discount.approve` (approve/reject discount requests exceeding cashier limit)
    - التوصيل (Delivery): `pos.delivery.view`, `.create` [dep:view], `.manage` (prepare/dispatch/deliver/fail/return) [dep:view], `.cancel` ⚠sensitive — description explicitly states: "حساس لأنه يعكس حركة الأموال" (sensitive — reverses money movement; auto-refunds sale, restores stock, clears receivables) [dep:view], `.settle` (COD driver-collections settlement) [dep:view], `.view_own` (assigned-driver-only) [dep:view], `.manage_own` (confirm dispatch, mark delivered/failed, send location, attach POD — own deliveries only) [dep:view_own]

11. **إدارة العملاء (CRM) — 15 total**:
    - العملاء المحتملين (Leads): `crm.lead.view`, `.view_own`, `.create` [dep:view], `.edit` [dep:view], `.assign` [dep:view], `.convert` (lead→opportunity) [dep: lead.view, opportunity.create]
    - الفرص (Opportunities): `crm.opportunity.view`, `.create` [dep:view], `.edit` [dep:view]
    - الأنشطة (Activities): `crm.activity.view`, `.create` [dep:view], `.edit` [dep:view]
    - خط المبيعات (Pipeline): `crm.pipeline.view`, `.manage` [dep:view]
    - العميل 360: `crm.customer360.view` [dep: sales.customer.view]

12. **الأقساط (Installments) — 8 total**:
    - خطط الأقساط: `installments.plan.view`, `.create` [dep:view], `.cancel` [dep:view]
    - الدفعات: `installments.collect` [dep: plan.view]
    - المتابعات: `installments.follow_up.view` [dep:plan.view], `.manage` [dep: follow_up.view]
    - التحصيل: `installments.collection.create` [dep: plan.view]
    - المتأخرات: `installments.overdue.process` [dep: plan.view]

13. **الأوراق المالية (Financial papers / Cheques) — 5 total**: `cheques.view`, `.create` [dep:view], `.deposit` [dep:view], `.collect` [dep:view], `.bounce` [dep:view]

14. **التصنيع (Manufacturing) — 5 total**:
    - قوائم المواد (BOM): `manufacturing.bom.view`, `.manage` [dep:view]
    - أوامر التشغيل (Work orders): `manufacturing.wo.view`, `.create` [dep:view], `.execute` [dep:view]

15. **الأصول (Assets) — 7 total**: `assets.view`, `.create` [dep:view], `.manage` [dep:view], `.dispose` [dep:view]; الإهلاك: `assets.depreciation.view` [dep:assets.view], `.run` [dep:view], `.void` [dep:run]

16. **الإدارة (Admin) — 22 total**:
    - المستخدمين: `admin.users.view`, `.create` [dep:view], `.edit` [dep:view], `.deactivate` [dep:view]
    - الأدوار: `admin.roles.view`, `.manage` [dep:view]
    - الإعدادات: `admin.settings.view`, `.edit` [dep:view]
    - إعدادات المؤسسة (platform-level): `admin.tenant.settings.edit` — note: description explicitly says "(مدير المنصة)" = platform-admin-only, confirming a platform-admin tier above tenant admin [dep: settings.view]
    - الفروع: `admin.branches.create`, `.edit`, `.view`, `.deactivate` [dep:view]
    - المستودعات: `admin.warehouses.create`, `.edit`, `.view`, `.deactivate` [dep:view]
    - التسلسلات: `admin.sequences.view`, `.edit` [dep:view], `.reset` [dep:edit]
    - الوحدات (Modules): `admin.modules.view` (read-only), `admin.modules.manage` — description: "تفعيل/تعطيل الوحدات (مدير المنصة فقط)" = enable/disable modules, platform-admin only [dep:view]

17. **الإشعارات (Notifications) — 2 total**: `notifications.rule.view`, `.manage` [dep:view]

18. **المراجعة (Audit) — 1 total**: `audit.logs.view` — the sole permission gating the `/audit/reports` screen documented above, explaining why it's absent from the visible nav (it's a permission-gated screen, likely hidden from nav for most roles even when granted).

19. **المعاملات (Transactions) — 2 total**: `transactions.view`, `.view_all` [dep:view]

**Permission model summary**: Consistent `module.entity.action` dot-notation. Common action-verb vocabulary across modules: `view` / `view_own` / `view_all` (three-tier visibility scoping — own records vs. all-in-branch vs. all-cross-branch), `create`, `edit`, `delete_draft`, `confirm`, `void`, `cancel`, `approve`/`reject` (workflow-gated), `manage` (bundled create+edit for simple entities), `print`, `merge`, `close`/`reopen`, `run` (batch/background jobs like payroll or depreciation), `deactivate`, `assign`, `convert`, `override`, `rebuild`. A `⚠` sensitive flag exists as first-class metadata on select permissions (cost visibility, salary/personal data, money-reversing actions), and an explicit permission **dependency graph** is enforced/displayed (granting an action implies its prerequisites, e.g. `.confirm` typically depends on `.view_own`). Two permissions (`admin.tenant.settings.edit`, `admin.modules.manage`) are explicitly documented as platform-admin-only despite appearing in the tenant-facing role editor — meaning the UI lists them but a tenant admin likely cannot self-grant them (platform governs a tier above tenant admin).

Screenshots: `settings-13-users-list.png`, `settings-14-add-user.png`, `settings-15-add-user-role-dropdown.png`, `settings-16-roles-list.png`, `settings-17-role-permission-matrix.png`, `settings-18-permission-matrix-sensitive.png`.

---

## Settings — الهيكل التشغيلي (Operational structure) — new content only (shifts/POS/payment-methods documented elsewhere)

### إدارة الفروع (Branches list)
- **Route**: `/settings/branches`
- **Content**: Stat summary (إجمالي الفروع 1, الفرع الرئيسي 1, نشط 1), search + status filter tabs (الكل/نشط/غير نشط), table columns: اسم الفرع, رمز الفرع (code, e.g. `MAIN`), الفرع الرئيسي (parent — implies a branch hierarchy is supported, i.e. sub-branches under a main branch), الهاتف, الحالة. Single branch in this tenant.
- **Actions**: "إضافة فرع" (Add branch) button (form not opened — deprioritized since basic branch CRUD is assumed covered elsewhere).

### صفحة الفرع — MAIN (Branch detail / "Branch 360")
- **Route**: `/settings/branches/:id` (e.g. `/settings/branches/fd189772-70fe-46c8-9ad9-f21592b13773`)
- **Purpose**: NEW FINDING not just an edit form — this is a full branch analytics/profile dashboard ("Branch 360"), mirroring the pattern seen elsewhere in the app (Customer 360, Supplier 360).
- **Content**:
  - Header: branch name + code, صافي ربح الشهر (month net profit) headline metric.
  - Info strip: كود الفرع, العنوان, الهاتف, البريد الإلكتروني (all "لا توجد" / none set), المستودعات (2), الموظفون (1), الحالة (نشط + "الفرع الرئيسي" badge marking it as the root/main branch).
  - **Tabs**: نظرة عامة (Overview), المخزون (Inventory), الموظفون (Employees), الأصول (Assets), نقاط البيع (POS — out of scope), النشاط (Activity).
  - **نظرة عامة (Overview) tab content**: 7 KPI tiles — إيرادات الشهر, مصروفات الشهر, صافي الربح, رصيد النقدية, المستحقات (receivables), المدفوعات (payables), قيمة المخزون (inventory value) — i.e. the SAME KPI set as the main dashboard but scoped to this single branch. Below that, a "حسابات الخزينة" (Treasury accounts) table scoped to the branch: columns الحساب (account, clickable → opens a side panel), الكود, النوع (نقدي/بنكي), الرصيد. This branch has 2 cash accounts: `CASH-001` "صندوق نقدي" (0.00) and `CASH-002` "صندوق نقدي الفرع الرئيسي" (338.00).
- **Notes**: This branch-level financial/operational rollup was not previously catalogued elsewhere per the assigned scope — it's effectively a per-branch mini-dashboard, reinforcing that branches in this system carry their own treasury accounts, inventory, staff roster, and asset registry, not just being a label field on transactions. Screenshots: `settings-19-branches-list.png`, `settings-20-branch-detail.png`.

### إدارة المستودعات (Warehouses)
- **Route**: `/settings/warehouses`
- **Content**: Stat cards إجمالي المستودعات (total) 2, نشط (active) 2, إجمالي الفروع (branches spanned) 1. Search + status filters (الكل/نشط/غير نشط) + filters بالنوع (type) and باسم الفرع (branch). Table columns: اسم المستودع, رمز المستودع (code), اسم الفرع (parent branch, clickable), نوع المستودع (type), افتراضي (default flag), الحالة.
- **Observed warehouses**: `WH-MAIN` "مستودع الفرع الرئيسي" — type رئيسي (main), marked افتراضي (default); `VAN` "سياره نقل" — type ڤان (سيارة توزيع) (van/distribution vehicle), not default. Both under الفرع الرئيسي.
- **"إضافة مستودع" (Add warehouse) dialog**: اسم المستودع* (name), رمز المستودع* (code), اسم الفرع* (parent branch, combobox), نوع المستودع (type, combobox, default "رئيسي"). NOT submitted.
- **Full warehouse-type catalog** (5 types): رئيسي (Main), مستودع وسيط (Transit/intermediate), مرتجعات (Returns), إنتاج (Production), ڤان (سيارة توزيع) (Van/distribution vehicle). Confirms the system models warehouse purpose/role explicitly (not just a name) — relevant for inventory-flow rules (e.g. returns warehouse vs. production staging vs. main sellable stock vs. mobile van stock for field sales).
- Screenshots: `settings-49-warehouses.png`, `settings-50-add-warehouse.png`, `settings-52-warehouse-type-list.png`.

### نقل البيانات (Data migration / onboarding import wizard)
- **Route**: `/settings/data-migration`
- **Purpose**: A one-time-use, opinionated bulk-import wizard for migrating a company's existing data into the system at initial setup — noted in-app as "أدوات تأسيس — بتستخدمها مرة واحدة" (foundation tools — used once).
- **Content**: Intro note (Egyptian-Arabic colloquial tone, notably different register from the rest of the app's MSA): "دي الخطوات اللي بتنقل بيها بيانات شركتك على النظام. رتّبناها بالترتيب اللي لازم تمشي بيه، لأن كل خطوة بتعتمد على اللي قبلها. تقدر تفتح أي خطوة في أي وقت — الترتيب إرشاد مش قفل." (these are the steps to migrate your company data; ordered because each step depends on the previous one, but you can open any step anytime — the order is guidance, not a lock).
- **12 ordered import steps**, each with: النموذج (Download template — Excel/CSV) and استيراد (Import) buttons, a "مسجّل: N" (N records registered) badge once data exists, a green checkmark once satisfied, and a rich Arabic explanation of WHY the step is ordered where it is (dependency rationale):
  1. **الأقسام** (Departments, registered: 1) — "الموظف لازم يكون له قسم... القسم محتاج كود، والنظام مش بيخترعه من الاسم" (employees need a department; department needs a code the system won't auto-generate).
  2. **الموظفين** (Employees, registered: 1) — "المرتبات مش في الملف — بتتسجّل على عقد العمل بعدين" (salaries aren't in this file — registered later via the employment contract).
  3. **حسابات الخزينة** (Treasury accounts, registered: 2) — cash drawers and bank accounts; note: an opening balance here posts an actual journal entry — "راجع الإجمالي في شاشة المراجعة قبل ما تأكّد" (review the total on the review screen before confirming).
  4. **الموردين** (Suppliers, registered: 1) — before items, since an item can reference a preferred supplier; "الأرصدة المستحقة مش في الملف" (outstanding balances aren't in this file — set separately).
  5. **العملاء** (Customers, registered: 4) — independent of other steps; balances are NOT set here — customer debt is derived later from imported historical invoices (step 9/10).
  6. **الأصناف** (Items, registered: 26) — after suppliers, since items link to a preferred supplier; "التصنيفات والعلامات التجارية بتتعمل تلقائي لو مش موجودة" (categories/brands auto-created if missing).
  7. **وحدات الأصناف** (Item units, registered: 6) — after items, since each row references an item by code; covers secondary units (carton, box, dozen) with a conversion factor each — base unit is registered with the item itself.
  8. **تصنيفات الأصول** (Asset categories) — before fixed assets, since category determines default asset/depreciation GL accounts; uncategorized assets fall back to system default accounts.
  9. **الأصول الثابتة** (Fixed assets) — after treasury and suppliers, since each asset posts a journal entry (cash purchase needs a treasury account, credit purchase needs a supplier); legacy assets can be registered as "رصيد افتتاحي" (opening balance) needing neither.
  10. **فواتير المبيعات السابقة** (Historical sales invoices) — last-tier step, since every invoice references a customer and items which must pre-exist; a fully-collected invoice is archived with no journal entry, a partially-collected one posts the remaining amount as customer debt; **inventory is NOT affected** by this import at all.
  11. **مرتجعات المبيعات السابقة** (Historical sales returns) — must come immediately after invoices, since each return line links to an invoice line and inherits its price/tax/accounts; UI explicitly warns "استورد الفواتير أولاً — المرتجع لازم يتربط بفاتورة مستوردة" (import invoices first — returns must link to an imported invoice). Inventory not affected.
  12. **فواتير المشتريات السابقة** (Historical purchase invoices) — mirrors step 10 for the purchase side (references suppliers + items); inventory not affected.
  13. **مرتجعات المشتريات السابقة** (Historical purchase returns) — mirrors step 11 for the purchase side; same "import invoices first" warning; inventory not affected.
  (Note: the in-app numbering visually repeats "٩" for both الأصول الثابتة and فواتير المبيعات السابقة — likely a display/numbering bug worth flagging for the rebuild.)
- **Explicit scope boundary** (footer note): "استيراد الجرد وتحويل المخزون مش هنا — دول أدوات تشغيل يومي، بتلاقيهم جوه ورقة الجرد نفسها وشاشة التحويل." (physical-count import and stock-transfer import are NOT here — those are day-to-day operational tools found inside the physical-count sheet and the transfer screen themselves, not this onboarding wizard.)
- **Notes**: This is a sophisticated, dependency-aware ETL onboarding tool — worth replicating carefully in the rebuild given how much implicit business logic is encoded in the per-step help text (e.g. how partially-paid historical invoices/returns translate into opening AR/AP balances without touching inventory or requiring full re-entry of historical stock movements). Historical invoice/return imports deliberately bypass inventory effects, treating them as accounting-only backfill. Screenshot: `settings-53-data-migration.png`.

---

## Settings — البنية التحتية (Infrastructure): Numbering, Print, Barcode

### تسلسلات الترقيم (Numbering sequences)
- **Route**: `/settings/sequences`
- **Purpose**: Configure the auto-numbering scheme (prefix, suffix, zero-padding length, annual reset) for every document type in the system.
- **Content**: Stat cards: إجمالي التسلسلات (total sequences) 25, إعادة ضبط سنوي (sequences with annual reset enabled) 0. Search (by doc type or prefix) + type filter. Table columns: نوع المستند (document type — Arabic label + system code), البادئة (prefix), طول الرقم (zero-padded number length), القيمة الحالية (current counter value), الرقم التالي (next number preview), إعادة ضبط سنوي (annual reset Y/N), row "..." actions.
- **Full list of all 25 document-type sequences** (code — prefix — number length — current value — next number):
  1. ASSET (أصل ثابت) — `AST-` — 6 — 0 → AST-000001
  2. BOM (قائمة مكونات) — `BOM-` — 4 — 4 → BOM-0005
  3. CASH_VOUCHER (سند نقدي) — `CV-` — 6 — 15 → CV-000016
  4. CHEQUE (شيك) — `CHQ-` — 6 — 0 → CHQ-000001
  5. CONFIG_INSTANCE (منتج قابل للتهيئة) — `CM-` — 6 — 4 → CM-000005
  6. CONTRACT (عقد) — `CTR-` — 4 — 1 → CTR-0002
  7. CUSTOMER_REFUND (استرداد عميل) — `CRF-` — 6 — 0 → CRF-000001
  8. DELIVERY_ORDER (أمر توصيل) — `DLV-` — 6 — 0 → DLV-000001
  9. EMPLOYEE (موظف) — `EMP-` — 4 — 1 → EMP-0002
  10. GOODS_RECEIPT (استلام بضاعة) — `GR-` — 6 — 0 → GR-000001
  11. INSTALLMENT_PLAN (خطة أقساط) — `IP-` — 6 — 0 → IP-000001
  12. JOURNAL_ENTRY (قيد محاسبي) — `JE-` — 6 — 85 → JE-000086
  13. LANDED_COST (تكلفة إضافية) — `LC-` — 6 — 0 → LC-000001
  14. LEAVE_REQUEST (طلب إجازة) — `LR-` — 6 — 0 → LR-000001
  15. PAYMENT_DISBURSEMENT (سند صرف) — `PAY-` — 6 — 0 → PAY-000001
  16. PAYMENT_RECEIPT (سند تحصيل) — `REC-` — 6 — 0 → REC-000001
  17. PAYROLL_RUN (دورة رواتب) — `PR-` — 6 — 0 → PR-000001
  18. PAYSLIP (قسيمة راتب) — `PS-` — 6 — 0 → PS-000001
  19. POS_SALE (مبيعة نقطة بيع) — `POS-` — **8** (longest, to handle high POS volume) — 0 → POS-00000001
  20. PURCHASE_INVOICE (فاتورة مشتريات) — `PI-` — 6 — 2 → PI-000003
  21. PURCHASE_ORDER (أمر شراء) — `PO-` — 6 — 0 → PO-000001
  22. PURCHASE_RETURN (مرتجع مشتريات) — `PRT-` — 6 — 0 → PRT-000001
  23. PURCHASE_RFQ (طلب عرض سعر) — `RFQ-` — 6 — 0 → RFQ-000001
  24. SALES_INVOICE (فاتورة مبيعات) — `INV-` — 6 — 14 → INV-000015
  25. SALES_ORDER (أمر مبيعات) — `SO-` — 6 — 0 → SO-000001
- **Edit dialog** ("تعديل تسلسل الترقيم", opened for SALES_INVOICE, then cancelled): fields البادئة* (prefix, text, e.g. "INV-"), اللاحقة (suffix, optional, e.g. could append "-2026"), طول الرقم* (number length, numeric, 6), إعادة ضبط سنوي (annual reset toggle, off). Buttons: "حفظ التعديلات" (Save) / "إلغاء" (Cancel) — cancelled, not saved.
- **Row menu actions**: "تعديل" (Edit) and "إعادة ضبط" (Reset — resets the counter, presumably to 0 or a chosen value; not opened).
- **Notes**: No per-branch sequence scoping was observed (sequences appear tenant-global, not branch-specific) — worth confirming in the rebuild whether multi-branch tenants need branch-prefixed sequences. Suffix field exists but wasn't populated on any observed sequence — likely supports patterns like year-suffixing. Screenshots: `settings-21-sequences.png`, `settings-22-sequence-edit-menu.png`, `settings-23-sequence-edit-dialog.png`.

### قوالب الطباعة (Print templates)
- **Route**: `/settings/print`
- **Purpose**: Global, tenant-wide visual customization of every printed/PDF document (invoices, quotes, receipts, etc.), with an optional per-document-type override layer. Live preview pane renders the actual document layout as settings change.
- **Content — top controls**: "إعادة التعيين" (Reset) and "حفظ" (Save, disabled until dirty) buttons. Preview panel has its own document-type selector (فاتورة مبيعات / عرض سعر / إيصال نقاط بيع — only 3 preview-able types, though the per-document tab exposes many more types for override).
- **9 tabs**, each a distinct concern:
  1. **الهوية (Identity/branding)**: موضع الشعار (logo position, combobox: يمين/right, presumably also left/center), حجم الشعار (logo size: صغير/متوسط/كبير — small/medium/large), اللون الأساسي (primary brand color, hex input + swatch, e.g. `#1f2937`, help: "يستخدم لعنوان المستند وإطار الترويسة وحدود الجداول" — used for doc title, header border, table borders), شعار فرعي (sub-tagline under company name, free text, e.g. "خدمات محاسبية ومالية متكاملة").
  2. **الترويسة (Header)**: 5 toggles — إظهار عنوان الشركة (address, ON), إظهار هاتف الشركة (phone, ON), إظهار البريد الإلكتروني (email, ON), إظهار الرقم الضريبي (tax number, ON), إظهار السجل التجاري (commercial register, OFF).
  3. **محتوى المستند (Document content)**: 5 toggles — إظهار اسم الفرع (branch name, ON), إظهار اسم المستودع (warehouse name, OFF), إظهار الرقم الضريبي للعميل/المورد (counterparty tax number, ON), إظهار شروط الدفع (payment terms, ON), إظهار الملاحظات (notes, ON).
  4. **أعمدة الأصناف (Line-item columns)**: 6 toggles — إظهار كود الصنف (item code, OFF), إظهار الوحدة (unit, ON), إظهار وصف الصنف (item description, ON), إظهار خصم السطر (line discount, ON), إظهار نسبة الضريبة للسطر (line tax %, OFF), إظهار مبلغ الضريبة للسطر (line tax amount, OFF).
  5. **المجاميع (Totals)**: 4 toggles, all ON — إظهار المجموع الفرعي (subtotal), إظهار إجمالي الخصم (total discount), إظهار تفصيل الضريبة (tax breakdown), كتابة المبلغ بالحروف (amount in words — spelled-out total, e.g. "ألف واثنان وتسعون ريال سعودي وخمسون هللة فقط لا غير").
  6. **التذييل (Footer)**: نص التذييل (free-text footer, e.g. terms/thank-you note), خانات التوقيع (signature blocks toggle, ON), عدد التوقيعات (number of signature slots, combobox, value 2), مسميات التوقيعات (signature labels, one text field per slot — observed "أعده" / prepared-by and "اعتمده" / approved-by).
  7. **علامة مائية (Watermark)**: نص العلامة المائية (watermark text, free text, placeholder examples "مسودة، ملغية، نسخة" = Draft/Voided/Copy; empty = disabled), شفافية العلامة المائية (opacity slider, 0–1 range, value 0.08 observed).
  8. **إيصال الصندوق (POS thermal receipt)** — explicitly scoped, banner note: "هذه الإعدادات تنطبق على إيصالات نقاط البيع الحرارية فقط" (applies only to thermal POS receipts): إظهار العنوان (ON), إظهار الرقم الضريبي (ON), إظهار اسم العميل (OFF), نص الشكر (thank-you text, e.g. "شكراً لزيارتكم").
  9. **تخصيص حسب الوثيقة (Per-document override)**: a "وثيقة للتخصيص" (document to customize) dropdown listing many more document types than the 3-item preview selector — observed: فاتورة مبيعات, عرض سعر, مرتجع مبيعات, فاتورة مشتريات, أمر شراء, مرتجع مشتريات, إشعار استلام, سند قبض, سند صرف (list continues, scrollable/truncated in the dropdown). Selecting a type presumably surfaces a subset of the above settings scoped to override just that document type over the tenant-wide defaults (not further explored to avoid altering state).
- **Live preview**: renders a fully realistic sample سales invoice (INV-000123) reflecting every toggle live — company header, customer block (name/code/tax number/address/phone), doc metadata (date/due date/status/branch), line-items table, totals block, amount-in-words, notes, signature blocks, and print-date/company footer stamp.
- **Notes**: This is a comprehensive, non-technical (no HTML/code editing — pure toggles/pickers) print-template designer, structurally analogous to the email-template editor on the general-settings Email tab but purpose-built for print/PDF layout rather than HTML email. Screenshots: `settings-24-print-templates.png` through `settings-34-print-per-doc-list.png` (11 screenshots covering all 9 tabs).

### أكواد الباركود المدمجة (Embedded/weight-embedded barcode codes)
- **Route**: `/settings/barcode`
- **Purpose**: NOT a label-design tool — despite the nav label suggesting "barcode templates," this screen configures RULES for **parsing scale-printed variable-weight/price barcodes at the POS/sales screen** (the common retail pattern where a barcode encodes an item code AND an embedded price/weight, printed by an in-store scale for items like produce or deli meat).
- **Content**:
  - Intro banner: "بعض المتاجر تطبع بباركود يحمل السعر بداخله (مثل ملصقات التخفيض أو الميزان). عرف هنا كيف يقرأ نقطة البيع أرقام السعر من أرقام الباركود." (some stores print barcodes with an embedded price, e.g. discount labels or scale labels — define here how POS reads price digits from barcode digits).
  - تفعيل قراءة الباركود المدمج (Enable embedded-barcode reading) — master toggle, OFF by default.
  - القواعد (Rules) list — empty state by default ("لا توجد قواعد" / no rules, with guidance to add one). "إضافة قاعدة" (Add rule) button.
  - **Add-rule form fields** (opened, not saved):
    - اسم القاعدة (rule name, e.g. "ملصق تخفيض")
    - البادئة (prefix digit(s) that identify this barcode pattern, e.g. "2" — help text notes "2" is the typical EAN prefix for scale/weight barcodes)
    - عدد أرقام كود الصنف (digit-count for the embedded item code segment, e.g. 6)
    - عدد أرقام السعر (digit-count for the embedded price segment, e.g. 5)
    - المنازل العشرية (decimal places within the price digits, e.g. 2 — so digits "02500" → 25.00)
    - الحد الأقصى للقيمة (sanity-check max price value, e.g. 100000 — help: "أعلى سعر منطقي — أي قراءة أكبر منه تُعتبر خطأ في المسح وتُتجاهل" / any reading above this is treated as a scan error and ignored)
    - التحقق من رقم المراجعة (EAN-13) — toggle to validate the trailing EAN-13 check digit, OFF by default, help: "اتركه مفعلاً للتأكد من صحة القراءة. باركود EAN-13 مكتمل من 13 رقماً" (leave on to confirm read validity; a full EAN-13 barcode is 13 digits).
    - **Live worked example** shown inline, breaking down a sample barcode digit-group-by-digit-group with color-coded segments: `2` (البادئة/prefix) `012345` (كود الصنف/item code) `02500` (السعر/price) `4` (رقم المراجعة/check digit) → "سيقرأ السعر: 25.00 ج.م" (will read price as 25.00 EGP).
  - **اختبار مباشر (Live test)** panel — paste any barcode string (pre-filled "2 012345 02500 4") to see how it would be parsed against the currently defined rules.
- **Notes**: This is a genuinely important retail/grocery feature (weight-embedded barcode support) that's easy to misclassify by name alone — for the rebuild, keep this distinct from the actual print/label templates below. No rules were configured in this tenant. Screenshots: `settings-35-barcode-settings.png`, `settings-36-barcode-add-rule.png`.

### طباعة الملصقات (Label printing — actual barcode/product label templates)
- **Route**: `/inventory/labels` (lives under the المخزون/Inventory nav group, NOT under Settings — worth noting for the rebuild's IA, since the task's "label/barcode template" scope item is actually split across two different nav locations)
- **Purpose**: Print physical barcode/price labels for items (or for all items on a given document, e.g. a goods receipt).
- **Content**:
  - Info banner: "السعر المطبوع هو السعر الفعلي الذي تحسبه نقطة البيع للعميل العادي (بعد قوائم الأسعار والشرائح). الطباعة لا تغير أي سعر." (the printed price is the actual price POS would charge a normal customer, after price lists/tiers are applied; printing does not change any price).
  - Mode toggle: صنف (by item) / مستند (by document — bulk-print labels for every item on a source document like a GRN).
  - إضافة صنف (Add item) — searchable item picker to build the print batch.
  - Empty state: "لا توجد أصناف بعد" (no items yet) with guidance.
  - **قالب الملصق (Label template)** selector — a FIXED set of 3 size presets (no visible custom-template designer/editor in this pass): "ملصق حراري 40mm×30mm" (thermal label), "ملصق رف 50mm×25mm" (shelf label), "ملصق منتج 100mm×50mm" (product label). Shows "الإجمالي: 0 ملصق" (total label count) live as items are added.
  - معاينة الملصق (Label preview) panel — placeholder "أضف صنفاً للمعاينة" (add an item to preview) until at least one item is selected.
  - Action: "معاينة وطباعة" (Preview & print) button, top-left.
- **Notes**: Unlike the print-template designer (which has a full customization UI), label templates here appear to be preset sizes only — no observed way to customize label content/layout fields (what data appears on the label, font sizes, barcode symbology) in this pass. This may be a gap in the current product, or a customization surface not discovered — worth a follow-up check against the "أكواد الباركود المدمجة" or print-template screens for any hidden linkage. Screenshot: `settings-37-inventory-labels.png`, `settings-38-label-template-list.png`.

---

## Settings — الأتمتة والقواعد (Automation & Rules): Notifications & Workflow

### قواعد الإشعارات (Notification rules)
- **Route**: `/notifications/rules`
- **Purpose**: Tenant-configurable rules engine defining WHICH system events trigger a notification, WHO receives it, on which channel(s), at what priority, and with what message content — this is the general-purpose notification layer distinct from (but overlapping with) the email-template editor in general settings.
- **Content**: Stat cards إجمالي القواعد/القواعد النشطة/القواعد المعطلة (total/active/disabled rules) — all 0 in this tenant (no rules configured; every dashboard notification observed earlier came from default/hardcoded manufacturing events, not custom rules). Search + status filter tabs (الكل/نشط/غير نشط) + filter-by الحدث (event) and الأولوية (priority) comboboxes. Table columns: اسم القاعدة, الأولوية, قنوات الإرسال, الحالة.
- **"إضافة قاعدة" (Add rule) dialog fields**:
  - اسم القاعدة* (rule name, free text)
  - الحدث* (event, searchable combobox — see full catalog below)
  - نوع المستلم* (recipient type, combobox, observed default "حسب الصلاحية" = by permission — implying other modes like specific user/role/branch-manager likely exist)
  - قيمة المستلم* (recipient value, depends on recipient type — shown as "اختر الصلاحية..." i.e. pick a permission when type=by-permission, meaning the rule targets anyone holding a given permission)
  - الأولوية* (priority, combobox, default "عادية" = normal — implying a severity scale, e.g. low/normal/high/urgent)
  - قنوات الإرسال* (send channels, checkboxes): داخل التطبيق (in-app, checked by default), بريد إلكتروني (email), إشعار فوري (push notification)
  - عنوان مخصص (عربي) (custom title, Arabic — optional override of default title)
  - نص الإشعار (عربي) (custom notification body, Arabic — optional override), with templating variables noted: `{{customerName}}`, `{{amount}}`, `{{documentNumber}}`
  - "رسائل القنوات (بريد وواتساب)" section — becomes active once email/WhatsApp channels are selected, for composing channel-specific message content (WhatsApp appears as a planned/available channel here even though only 3 checkboxes were shown — possibly gated behind selecting email first, or a naming inconsistency between "إشعار فوري"/push and WhatsApp worth clarifying).
  - **Conditional rule fields**: حقل الشرط (condition field, disabled until an event is chosen — "اختر الحدث أولاً"), العامل (operator, disabled combobox), قيمة الشرط (condition value, disabled) — i.e. rules support an optional condition (e.g. "only if amount > X") layered on top of the event trigger, mirroring the credit-control/discount-threshold conditional patterns seen elsewhere.
  - Buttons: "إلغاء" (Cancel) / "إضافة" (Add) — NOT submitted.
- **FULL EVENT CATALOG** (39 events available as rule triggers, `EVENT_CODE` — Arabic label):
  - **Workflow/approvals**: `WORKFLOW_APPROVAL_REQUESTED` (عملية بانتظار الموافقة), `WORKFLOW_APPROVAL_GRANTED` (تم اعتماد العملية), `WORKFLOW_APPROVAL_REJECTED` (تم رفض العملية), `WORKFLOW_MODIFICATION_REQUESTED` (مطلوب تعديل على العملية)
  - **Sales**: `SALES_INVOICE_CONFIRMED`, `SALES_INVOICE_VOIDED`, `SALES_RETURN_CONFIRMED`, `SALES_QUOTE_CREATED`, `SALES_QUOTE_SENT`, `SALES_QUOTE_ACCEPTED`, `SALES_QUOTE_EXPIRED`
  - **Purchases**: `PURCHASE_ORDER_CONFIRMED` (تم إرسال أمر شراء للمورد), `PURCHASE_RECEIPT_CONFIRMED`, `PURCHASE_RECEIPT_VOIDED`, `PURCHASE_INVOICE_CONFIRMED`, `PURCHASE_INVOICE_VOIDED`, `PURCHASE_RETURN_CONFIRMED`, `PURCHASE_RETURN_VOIDED`
  - **Treasury/cash**: `CASH_VOUCHER_CONFIRMED`, `CASH_VOUCHER_VOIDED`, `PAYMENT_RECEIPT_CONFIRMED` (تم تحصيل دفعة)
  - **Installments**: `INSTALLMENT_OVERDUE` (قسط متأخر عن السداد), `INSTALLMENT_PLAN_CREATED`, `INSTALLMENT_COLLECTION_RECEIVED`, `INSTALLMENT_PLAN_CANCELED`
  - **Cheques**: `CHEQUE_REGISTERED`, `CHEQUE_COLLECTED`, `CHEQUE_BOUNCED` (شيك مرتجع), `CHEQUE_CLEARED` (تم صرف شيك صادر), `CHEQUE_VOIDED`
  - **POS**: `POS_SALE_CONFIRMED`, `POS_REFUND_CONFIRMED`, `POS_REFUND_VOIDED`, `POS_SESSION_CLOSED`, `POS_DISCOUNT_APPROVAL_REQUESTED`
  - **Inventory**: `LOW_STOCK_DETECTED` (انخفاض مخزون عن الحد الأدنى)
  - **Manufacturing**: `WORK_ORDER_STARTED`, `WORK_ORDER_COMPLETED` (these two are what generated every notification observed on the dashboard notification panel earlier in this pass)
  - **Platform**: `TENANT_CREATED` (ترحيب بمستخدم جديد — new-tenant welcome)
- **Notes**: `LOW_STOCK_DETECTED` confirms a low-stock-alert capability exists as a notification trigger (relevant to inventory reorder-point features). No rules configured in this demo tenant explains why the notification panel only showed manufacturing events — those likely fire from a hardcoded/default path rather than this rules engine. Screenshots: `settings-39-notification-rules.png`, `settings-40-notification-rule-form.png`.

### إعدادات الموافقات (Workflow / approvals engine configuration)
- **Route**: `/settings/workflow`
- **Purpose**: THE core configuration screen for the approvals engine (الموافقات) referenced throughout the app — defines, per business action type, whether a multi-step sequential role-based approval chain is required before that action can be confirmed/executed. This is the source of the `workflow.*` permissions and the top-bar الموافقات nav item's pending-approvals queue.
- **Content**: Table columns نوع الإجراء (action type), عدد الخطوات (step count), الحالة (status). Empty state in this tenant: "لا توجد إعدادات موافقات" (no approval configs) — confirms `workflowConfig: []` seen earlier in the tenant settings payload is accurate; this tenant runs with NO mandatory approval gates configured, despite the underlying engine (workflow permissions, approvals inbox, pending-count API endpoints) being fully wired and ready.
- **"إضافة سير عمل جديد" (Add new workflow) dialog**:
  - نوع الإجراء* (Action type) — searchable combobox, single-select, drives which business action this approval chain gates.
  - عدد الخطوات (Steps) — a repeatable step list, each step has: وصف الخطوة (step description, free text), اختر الدور* (role picker — approver role for this step), a step-order number badge (starts at 1, increments per step). "إضافة خطوة" (Add step) button appends further sequential steps — confirms **multi-step sequential (not parallel) approval chains** are supported (e.g. supervisor approval → then finance-manager approval).
  - Role picker scope: **only tenant-defined CUSTOM roles appear as selectable approvers** (in this tenant, only "مندوب مبيعات (VAN_SALES)" was offered) — built-in/implicit roles like "مدير المنشأة" (company admin) are NOT selectable, consistent with admins having blanket `permissions: ["*"]` that bypasses workflow gating entirely. This is an important rebuild constraint: workflow approver assignment is role-based (not user-based), and only from the custom-roles pool.
  - No conditional/threshold fields were found on this form (contrast with the notification-rules engine's optional condition-field/operator/value) — meaning an approval gate configured for an action type appears to apply unconditionally to every instance of that action (e.g. every sales invoice confirmation), not "only if amount > X." (POS discount approval has its own separate threshold mechanism — see general settings "الرقابة الائتمانية"/discount config documented earlier, and the `pos.discount.approve` permission.)
  - Buttons: "حفظ" (Save) / "إلغاء" (Cancel) — NOT submitted.
- **FULL ACTION-TYPE CATALOG** (26 workflow-gateable actions found in the combobox):
  - **Sales**: تأكيد فاتورة المبيعات (Confirm sales invoice), تأكيد مردودات المبيعات (Confirm sales return), إرسال عرض سعر (Send quote)
  - **Purchases**: تأكيد أمر الشراء (Confirm PO), تأكيد فاتورة المشتريات (Confirm purchase invoice), تأكيد سند استلام البضاعة (Confirm GRN), تأكيد مردودات المشتريات (Confirm purchase return), تأكيد سند التكاليف الإضافية (Confirm landed-cost voucher)
  - **Treasury**: تأكيد سند صرف/قبض (Confirm payment/receipt voucher), تأكيد سحب من رأس المال (Confirm capital withdrawal), تأكيد سداد ضريبي (Confirm tax payment)
  - **Inventory**: تأكيد تحويل مخزون (Confirm stock transfer), تأكيد تعديل مخزون (Confirm stock adjustment)
  - **Accounting**: ترحيل قيد يومية (Post journal entry), إلغاء قيد يومية (Void journal entry)
  - **HR/Payroll**: اعتماد مسير الرواتب (Approve payroll run)
  - **HR/Leave** (9 granular leave-type gates, allowing different approval chains per leave type): الموافقة على طلب الإجازة (كل الأنواع) (all leave types — a catch-all), الموافقة على إجازة سنوية (annual), الموافقة على إجازة مرضية (sick), الموافقة على إجازة شخصية (personal), الموافقة على إجازة عارضة (casual), الموافقة على إجازة أمومة (maternity), الموافقة على إجازة أبوة (paternity), الموافقة على إجازة بدون أجر (unpaid), الموافقة على إجازة طارئة (emergency)
  - **Manufacturing**: بدء أمر التصنيع (Start work order)
- **Notes**: This confirms the assignment's "الموافقات" (approvals) scope area's structure precisely: a per-action-type, multi-step, role-gated approval chain builder, with an empty/unconfigured state in this demo tenant. Cross-reference: the `WORKFLOW_APPROVAL_REQUESTED/GRANTED/REJECTED/MODIFICATION_REQUESTED` events documented in the Notification Rules section above are almost certainly emitted by this same engine when a step's decision is recorded, and the `workflow.view/approve/reject/config.view/config.manage` permissions (documented in the Permission Matrix section) gate access to this screen and to acting on pending approvals. Screenshots: `settings-42-workflow-list.png`, `settings-43-workflow-add-form.png`, `settings-44-workflow-action-types.png`, `settings-45-workflow-form-filled.png`, `settings-46-workflow-role-select.png`, `settings-48-workflow-role-options.png`.

---

## Settings — Developer/Integrations & Personal Account — added by verification pass

Three more real, fully-rendered `/settings/*` routes exist that are **not present anywhere in the sidebar nav** and were entirely missed by the original nine-pass capture: `/settings/api-keys`, `/settings/webhooks`, and `/settings/profile`. All three were found by extracting route-literal strings from the production JS bundle (`index-iKlw9m3b.js`) and test-navigating each candidate — the same technique used to find the eight domain "hub" pages documented across the other catalog files (see `01-sales.md`'s Sales Hub entry for that pattern). Unlike the hub pages, these three are **not** duplicates of sidebar-reachable content — they are genuinely new screens with no other entry point found anywhere in the app (no button, tile, or link on any other captured screen points at them). A fourth candidate, `/settings/whatsapp`, is also a real route but is feature-flag-gated off for this tenant (see below).

### الملف الشخصي (Profile — personal account settings)
- **Route**: `/settings/profile`. Breadcrumb reads just "الملف الشخصي" with no "الإعدادات" parent crumb, unlike every other `/settings/*` screen — reinforcing that this is a personal-account page bolted onto the Settings route namespace rather than a tenant-admin configuration screen.
- **Purpose**: Lets the logged-in user manage their own account — display name/phone/avatar, password, and view their own audit trail — independent of the tenant-admin Users & Roles screens (`/settings/users`, `/settings/roles`) documented above, which manage *other* users' accounts and permissions.
- **List view**: n/a — single-record settings page with three tabs.
- **Detail/form view**: Header: "الملف الشخصي" title, disabled "حفظ" (Save) button (enables once a field is dirtied — not exercised in this read-only pass). Tabs:
  - **المعلومات** (Info, default tab) — "معلومات الحساب" (Account info) card: avatar upload ("تحميل صورة"), الاسم الكامل * (Full name, editable textbox, pre-filled), البريد الإلكتروني (Email, disabled/read-only textbox), الهاتف (Phone, editable, empty), الدور (Role, disabled/read-only textbox, shows "مدير المنشأة" for this account), آخر دخول (Last login, disabled, timestamped), تاريخ الإنشاء (Created date, disabled, timestamped).
  - **الأمان** (Security) — "تغيير كلمة المرور" (Change password) card: كلمة المرور الحالية * (Current password), كلمة المرور الجديدة * (New password, helper "8 أحرف على الأقل" min. 8 characters), تأكيد كلمة المرور * (Confirm password), "تغيير كلمة المرور" (Change password) submit button — not submitted in this pass.
  - **النشاط** (Activity) — a personal audit-log feed, empty in this pass ("لا توجد نتائج" no results) despite the account having been actively used throughout every other capture pass; likely windowed to recent-only or filtered to a specific event subset not yet triggered.
- **Actions**: Edit own name/phone/avatar and save; change own password; (implicitly) review own recent account activity.
- **Workflows/statuses**: n/a — account settings, no document lifecycle.
- **API observed**: `GET /api/auth/me`, `GET /api/audit/entity/USER/{ownUserId}` (Activity tab — confirms the generic `audit/entity/{TYPE}/{id}` pattern implied elsewhere in this catalog, e.g. Suppliers'/Purchase Invoices' "سجل المراجعة" tabs in `02-purchases.md`, is a shared cross-module audit-log service, not a per-module bespoke feature).
- **Notes**: This is the only screen in the whole app, across all nine original passes plus this verification pass, where a user manages *their own* account rather than administering tenant data — worth flagging for Mezan's IA as a deliberately separate "my account" surface distinct from tenant-admin Users/Roles management, reachable in the live app only via the top-bar user-menu avatar click (not test-navigated to confirm that specific entry point in this pass, but the route itself is fully documented above).

---

### مفاتيح API (API Keys — public API access management)
- **Route**: `/settings/api-keys`. Breadcrumb: "الإعدادات" → "مفاتيح API".
- **Purpose**: Lets a tenant admin issue scoped, rate-limited bearer tokens for external systems to read tenant data via a documented public REST API (`/api/v1`), and manage OAuth-style third-party app authorizations (explicitly namechecking **Claude** as an example integration) — i.e. this tenant has a first-party, tenant-self-service external-API story, not just the internal `erp-backend` API the SPA itself uses.
- **List view**: Two independent tables on one page:
  - **مفاتيح API** (API Keys) table — columns: الاسم (Name), المفتاح (Key, presumably masked/shown-once), الصلاحيات (Scopes), حد الطلبات (في الدقيقة) (Rate limit per minute), آخر استخدام (Last used), الحالة (Status), row-action column. Empty state: "لا توجد مفاتيح API بعد" (no API keys yet) + inline "إنشاء مفتاح API" CTA, mirrored by a page-level header button of the same name.
  - **التطبيقات المرتبطة** (Connected Apps) table — columns: التطبيق (App), تاريخ الربط (Linked date), الصلاحيات (Scopes), تنتهي في (Expires), row-action column. Intro copy: "التطبيقات الخارجية (مثل Claude) المصرح لها بقراءة بياناتك للقراءة فقط. يمكنك قطع الاتصال في أي وقت." (External apps — like Claude — authorized to read your data, read-only; you can disconnect anytime.) Empty state: "لا توجد تطبيقات مرتبطة" (no connected apps).
- **Detail/form view** ("إنشاء مفتاح API" dialog, opened and inspected, then closed via Escape without submitting):
  - الاسم * (Name, textbox)
  - الصلاحيات * (Scopes, checklist — read-only/`.view`-suffixed permission scopes only, ~38 options observed, grouped by module: `sales.customer.view`, `sales.invoice.view`, `sales.quote.view`, `sales.return.view`, `purchases.supplier.view`, `purchases.invoice.view`, `purchases.order.view`, `purchases.receipt.view`, `purchases.return.view`, `purchases.landed_cost.view`, `purchases.supplier360.view`, `inventory.item.view`, `inventory.stock.view`, `inventory.transfer.view`, `inventory.adjustment.view`, `treasury.account.view`, `treasury.cash_voucher.view`, `accounting.reports.view`, `accounting.coa.view`, `accounting.journal.view`, `accounting.period.view`, `installments.plan.view`, `cheques.view`, `crm.lead.view`, `crm.opportunity.view`, `crm.activity.view`, `crm.customer360.view`, `pos.sale.view`, `pos.session.view`, `hr.employee.view`, `hr.payroll.view`, `manufacturing.bom.view`, `manufacturing.wo.view`, `assets.view`, `admin.users.view`, `admin.settings.view`, `audit.logs.view`, `reports.sales.view`, `reports.purchases.view`, `reports.inventory.view`, `reports.aging.view`, `reports.pos.view`, `reports.installments.view`) — helper text: "تعمل حالياً فقط الصلاحيات المدعومة بنقطة وصول فعالة" (only scopes backed by a live endpoint currently work), implying this public-API scope list is a superset of what's actually wired up yet.
  - حد الطلبات (في الدقيقة) (Rate limit per minute, numeric)
  - Buttons: إلغاء (Cancel) / إضافة (Add) — not submitted.
- **Actions**: Create/revoke API keys; disconnect a connected third-party app.
- **Workflows/statuses**: implied نشط/معطل (active/revoked) per key from the "الحالة" column; not observed live (0 keys exist).
- **API observed**: page loads produced no distinct `/api/settings/api-keys*` calls captured in this pass beyond the shared app-shell calls — the empty-state tables render client-side with no rows, so the list-fetch call itself was not isolated (flagged as a minor residual gap).
- **Notes**: The read-only, `.view`-suffixed, per-module scope list here is effectively a **subset mirror of the full ~268-permission RBAC matrix** documented in the Roles & Permissions section above, confirmed to reuse the exact same dotted `module.resource.action` naming convention (e.g. `sales.invoice.view` here vs. presumably `sales.invoice.create/edit/delete` etc. in the internal permission matrix) — strong evidence the public API's authorization model is a read-only projection of the same permission system, not a separately maintained scope list. The explicit "مثل Claude" (like Claude) example in the Connected Apps copy indicates the reference system already anticipates/supports AI-agent integrations against its own data via this exact mechanism.

---

### Webhooks (outbound event delivery)
- **Route**: `/settings/webhooks`. Breadcrumb: "الإعدادات" → "Webhooks" (untranslated — the only settings screen title in the whole app observed in English rather than Arabic).
- **Purpose**: Lets a tenant admin register external HTTPS endpoints to receive signed, real-time push notifications of tenant events — the outbound counterpart to the API Keys screen's inbound/pull access model.
- **List view**: Intro copy: "ترسل الـ Webhooks الأحداث من نظامك إلى رابط HTTPS خارجي تتحكم به." (Webhooks send events from your system to an external HTTPS URL you control.) Table columns: رابط الوجهة (Destination URL), الأحداث (Events), التاريخ (Date), الحالة (Status), row-action column. Empty state: "لا توجد Webhooks بعد" (no webhooks yet) + inline "إضافة Webhook" CTA, mirrored by a page-level header button of the same name.
- **Detail/form view** ("إضافة Webhook" dialog, opened and inspected, then closed via Escape without submitting):
  - رابط الوجهة * (Destination URL, textbox) — helper: "يجب أن يكون رابط HTTPS عام. يتم توقيع كل طلب باستخدام HMAC-SHA256." (Must be a public HTTPS URL. Every request is signed with HMAC-SHA256.)
  - الأحداث * (Events, multi-select with a "كل الأحداث" / All events convenience option — the individual per-event checklist itself renders inside a dropdown/popover that was not expanded in this pass, so the granular event-type list was not captured; flagged as a residual gap. Given the Notification Rules screen documented above already catalogs **39 trigger events across 3 channels**, it is plausible — but not confirmed — that this webhook event picker draws from the same 39-event vocabulary.)
  - الوصف (Description, optional textbox)
  - Buttons: إلغاء (Cancel) / إضافة (Add) — not submitted.
- **Actions**: Create/delete webhooks; (presumably, not observed) view delivery logs/retry failed deliveries per webhook, though no such affordance was visible in the empty state.
- **Workflows/statuses**: implied نشط/معطل (active/disabled) per webhook from the "الحالة" column; not observed live (0 webhooks exist).
- **API observed**: same as API Keys above — no distinct list-fetch call isolated in this pass beyond shared app-shell calls (residual gap).
- **Notes**: HMAC-SHA256 request signing is stated explicitly in-product, which is a concrete, reusable implementation detail for Mezan's own webhook-delivery design (signing scheme + presumably a shared-secret-per-webhook, though the secret-reveal UI itself was not seen since no webhook was created). Pairs directly with the API Keys screen and the Notification Rules engine (`09-settings-dashboard-ux.md`, Automation & Rules section above) to form a complete "Developer/Integrations" surface: pull access (API Keys) + push access (Webhooks) + internal notification routing (Notification Rules) + OAuth-style third-party app grants (Connected Apps, on the API Keys screen) — none of which had any footprint in the original nine-pass catalog before this verification pass.

---

### واتساب (WhatsApp integration) — confirmed to exist, module-gated off (unfixable in this tenant)
- **Route**: `/settings/whatsapp` — a real route, but rendering it in this tenant produces only a generic module-disabled gate: "الوحدة غير مفعلة — تواصل مع مدير النظام لتفعيل هذه الوحدة" (Module not activated — contact the system admin to activate this module). No settings fields, form, or even a page title beyond the gate message were reachable.
- **Why unfixable in this pass**: WhatsApp is not among this tenant's `activeModules[]` (recon §1 lists: sales, purchases, inventory, accounting, treasury, installments, financial_papers, crm, pos, hr, manufacturing, assets, notifications, loyalty, field — no `whatsapp`). Reaching the real settings form would require either a different demo tenant with the WhatsApp module enabled, or platform-admin access to flip the feature flag on <redacted> — neither available to this read-only recon pass. Flagged in `10-verification.md` as a genuine, data/access-limited (not a missed-capture) blind spot.
- **Notes**: Its existence as a real route alongside `/settings/api-keys` and `/settings/webhooks` reinforces that the reference system's outbound-communication story extends beyond the in-app Notification Rules engine (email/SMS/push documented above) into at least one specific chat-channel integration (WhatsApp Business API, presumably) — worth scoping for Mezan if WhatsApp-based customer/order notifications are a target market expectation for Egyptian SMBs, which is plausible given the whole app's Egypt-first design (ETA e-invoicing, Egyptian Labor Law leave presets, EGP-first currency defaults).
