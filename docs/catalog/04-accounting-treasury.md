# 04 — Accounting & Treasury Domain Catalog

Pass 4 of systematic feature capture. Scope: Accounting (chart of accounts, journal entries,
cost centers, fiscal periods, multi-currency/FX, tax settings, ETA e-invoicing) and Treasury
(cash registers/safes, bank accounts, vouchers, transfers, cheques). Read-only exploration;
only the login form was submitted. Report runs ("عرض التقرير") were executed as they are
read-only.

## Screen Inventory (scope)

### Accounting (nav group "المحاسبة")
- دليل الحسابات (Chart of Accounts) — `/accounting/chart`
- مراكز التكلفة (Cost Centers) — `/accounting/cost-centers`
- أرباح مراكز التكلفة (Cost Center P&L) — `/accounting/cost-center-pl`
- القيود المحاسبية (Journal Entries) — `/accounting/journals`
- الفترات المالية (Fiscal Periods) — `/accounting/fiscal-periods`
- الضرائب (Taxes) — `/accounting/taxes`
- أسعار الصرف (Exchange Rates) — `/accounting/exchange-rates`
- الفاتورة الإلكترونية (ETA e-Invoicing) — `/accounting/eta`
- التقارير المالية (Financial Reports) — `/accounting/reports`
- مطابقة الأرصدة (Balance Reconciliation) — `/accounting/reconciliation`
- إعادة تقييم العملات الأجنبية (FX Revaluation) — `/accounting/revaluation`
- المحاسبة (Accounting Hub, domain landing page) — `/accounting/hub` — **not linked from the sidebar nav**; added by verification pass.

### Treasury (nav group "الخزينة")
- حسابات الخزينة (Treasury Accounts — cash registers/safes/banks) — `/treasury/accounts`
- السندات النقدية (Cash/Payment Vouchers) — `/treasury/vouchers`
- تسوية كشوف البنك (Bank Statement Reconciliation) — `/treasury/bank-reconciliation`
- سجل الشيكات (Cheque Register) — `/financial-papers/cheques`
- الخزينة (Treasury Hub, domain landing page) — `/treasury/hub` — **not linked from the sidebar nav**; added by verification pass. Its "التخصيصات" tile links to `/treasury/allocations`, confirmed to be a redirect alias to `/treasury/vouchers?tab=needs_allocation` — not a separate screen, already covered by the Treasury Vouchers section above.

Note: no dedicated "opening balances" screen was found in the nav; opening balances appear to
be entered per-account in the Chart of Accounts detail (documented below) or via journal
entries dated at fiscal-year start. No separate "customer collections / supplier payments"
screens exist outside of the treasury voucher screen (vouchers cover both).

---

## Accounting

### دليل الحسابات — Chart of Accounts
- **Route**: `/accounting/chart`
- **Purpose**: Manage the company's chart of accounts as a hierarchical tree (main/root accounts
  and detail/posting accounts), and view per-account balances/movements. Second tab "ربط
  الحسابات" (Account Linking/Mapping) presumably maps system accounts to modules (not opened in
  this pass — read-only budget prioritized detail views).
- **List view**: Tree view (tab "شجرة الحسابات"), toggle "توسيع الكل" (expand all) / collapse per
  row (chevron button per row). Search box "بحث بالاسم أو الرقم..." (search by name/number).
  Filter button "تصفية النتائج" reveals two dropdown filters: "الحالة" (Status: الكل/all) and
  "النوع" (Type: الكل/all). Summary stat cards atop: إجمالي الحسابات (Total accounts, 78),
  حسابات نشطة (Active, 78), حسابات رئيسية (Main/root accounts, 9), حسابات تفصيلية (Detail
  accounts, 69). Table columns: اسم الحساب (account name, code + AR/EN name, nested/indented by
  level, clicking opens a side panel), النوع (type: أصول/التزامات/حقوق ملكية/إيرادات/مصروفات),
  الطبيعة (nature: رئيسي "main" or تفصيلي "detail"/leaf), الحالة (status: نشط "active" badge),
  and a row-level action button (kebab menu, not opened). Pagination footer "عرض 5 من 78 حساب"
  (shows count of visible/total; increases as tree nodes expand). A help callout: "دليل أرقام
  الحسابات" (numbering guide, explains ranges like 11xx/12xx when creating accounts).
- **Root account types observed** (9 mains): 1000 الأصول (Assets), 2000 الالتزامات
  (Liabilities), 3000 حقوق الملكية (Equity), 4000 الإيرادات (Revenue), 5000 المصروفات (Expenses).
  Sub-accounts under Assets include: 1100 ذمم مدينة (Accounts Receivable), 1110 ذمم أقساط مدينة
  (Installment Receivables), 1150 محتجزات ضمان مدينة (Retention Receivable), 1160 سلف الموظفين
  (Employee Advances), 1190 مخصص هبوط المخزون (Inventory Provision), 1200 المخزون (Inventory),
  1250 إنتاج تحت التشغيل (WIP), 1300 النقدية (Cash) → 1300-1 صندوق نقدي الفرع الرئيسي (main-branch
  cash drawer, a leaf/detail account under a leaf), 1310 حسابات بنكية (Bank Accounts), 1315
  مستحقات بطاقات الدفع (Card Receivables), 1320 شيكات تحت التحصيل (Cheques Under Collection), 1330
  مستحقات المحافظ الإلكترونية (E-Wallet Receivables), 1350 سلف الموردين (Supplier Advances), 1360
  شيكات مرتجعة (Bounced Cheques Receivable), 1400 ضريبة مدخلات (Tax Receivable/Input VAT), 1500
  أصول ثابتة (Fixed Assets) → 1510 معدات (Equipment), 1520 مركبات (Vehicles), etc. Expense-side
  leaf example: "عجز الصندوق" (Cash Shortage).
- **Detail/form view — "Add Account" dialog** ("إضافة حساب", opened via header button, cancelled
  without submitting): fields — النوع * (Type, combobox: أصول default, presumably
  أصول/التزامات/حقوق ملكية/إيرادات/مصروفات), التصنيف الفرعي * (Subcategory/classification
  combobox, default "بدون (للحسابات الرئيسية فقط)" = none, for main accounts only; helper text:
  used for report grouping e.g. COGS, operating expenses, current assets — required for accurate
  report classification), الكود * (Code, textbox, placeholder "1xxx", helper: "أكواد هذا النوع
  تبدأ عادة بـ 1xxx"), الاسم * (Name, textbox), الاسم بالعربي (Arabic name, textbox, optional —
  implies primary "الاسم" field may be English/bilingual), الحساب الرئيسي (Parent account,
  combobox, default "بدون رئيسي (جذر)" = no parent/root), الرصيد الطبيعي * (Natural balance side,
  combobox: مدين/دائن — Debit/Credit, default مدين), حساب رئيسي (toggle switch "is a main/summary
  account" — when off, account becomes a postable detail account). Dialog actions: إلغاء
  (Cancel), إضافة (Add/submit).
- **Account detail side panel** (opened by clicking any account row; "فتح في صفحة كاملة" button
  opens a full page at `/accounting/accounts/{uuid}`, not opened in this pass to stay within
  budget — side panel captured full data already): header shows account type label ("حساب") with
  quick-preview subtitle. Body: الرصيد الطبيعي (natural balance, e.g. مدين), الحساب الرئيسي
  (parent account, link to parent), عدد المراجع (reference/transaction count), account
  type/classification badges (e.g. "أصول" + "حساب خزينة (نقدية / بنك)" = treasury cash/bank
  account classification), الرصيد الحالي (current balance, e.g. 338.00 ج.م). Period filter: quick
  buttons هذا الشهر / هذه السنة / كل الفترات (this month/this year/all periods) plus custom "من"/
  "إلى" date range pickers. Summary row: رصيد أول المدة (opening balance), حركة الفترة (period
  movement), رصيد نهاية المدة (closing balance). Tabs: "حركات الحساب" (Account Movements, default
  selected) and "سجل التدقيق" (Audit Log, not opened). Movements table columns: التاريخ (date),
  رقم القيد (journal entry number, clickable → opens JE detail panel), المصدر (source, e.g. "سند
  نقدي" = cash voucher), مدين (debit), دائن (credit), الرصيد الجاري (running balance).
  Pagination: "عرض 1 - 5 من 5" with rows-per-page selector.
- **Actions**: إضافة حساب (Add account, header). Per-row kebab menu (not opened — likely
  edit/deactivate/delete). Row click → side panel. "فتح في صفحة كاملة" → full account page.
- **Workflows/statuses**: Accounts have الحالة (status) نشط (Active) — implies an inactive/
  disabled state exists via filter dropdown. Accounts are either حساب رئيسي (main/summary,
  non-postable, groups children) or تفصيلي (detail/leaf, postable).
- **API observed**: Not captured via network tab in this segment (relied on snapshot data); the
  full-page account route is `/accounting/accounts/{uuid}` confirming a REST-ish resource
  pattern; journal entries route as `/accounting/journals/{id}` (inferred, see below); vouchers
  linked at `/treasury/vouchers/{uuid}`.
- **Notes**: This is clearly the GL backbone — every account's movement row links directly to its
  originating journal entry, and journal entries link back to their originating source document
  (e.g. a cash voucher CV-000009), confirming sub-ledger documents (vouchers, invoices) drive
  auto-generated, linked journal entries rather than being entered as free-standing/manual
  entries in most cases. Opening balances are NOT a separate screen — "رصيد أول المدة" in this
  panel was 0.00 for a period starting 2026-08-01, suggesting opening balances are seeded via
  journal entries or a data-migration import (see "نقل البيانات" in Settings) rather than a
  dedicated UI field, though the Fiscal Periods screen (below) may hold this.

### مراكز التكلفة — Cost Centers
- **Route**: `/accounting/cost-centers`
- **Purpose**: Define cost centers (departments/projects/branches) for dimensional
  profit/expense tracking, independent of or linked to the org's department/branch structure.
- **List view**: EMPTY in this tenant — 0 cost centers exist. Summary cards: إجمالي مراكز التكلفة
  (Total, 0), نشط (Active, 0), مرتبط (Linked, 0), مستقل (Standalone, 0). Filter tabs: الكل / نشط /
  غير نشط (All/Active/Inactive), all showing 0. Search: "ابحث بالكود أو الاسم…". Filter panel:
  النوع (Type, combobox) and نوع الربط (Link type, combobox). Table columns (empty state):
  الكود (Code), الاسم (Name), النوع (Type), مرتبط بـ (Linked to), المركز الرئيسي (Parent center),
  الحالة (Status), row-menu. Empty-state message: "لا توجد مراكز تكلفة بعد" — "مراكز التكلفة تتيح
  لك معرفة أرباح ومصروفات كل قسم أو مشروع على حدة" (Cost centers let you see profit/expenses per
  department or project) with an inline "إضافة مركز تكلفة" CTA.
- **Header actions**: "إنشاء من الأقسام" (Create from Departments — bulk-generates cost centers
  from existing HR/org departments, not exercised to avoid mutation), "إضافة مركز تكلفة" (Add
  cost center, opens dialog).
- **Add dialog fields** (opened, cancelled): الكود * (Code, textbox), النوع (Type, combobox,
  default "عام" = General), الاسم * (Name, textbox), الاسم بالعربي (Arabic name, textbox), القسم
  (Department, combobox, default "بدون ربط" = unlinked — confirms cost centers can link 1:1 to an
  HR department), الفرع (Branch, combobox, default "بدون ربط" = unlinked — can also link to a
  branch), المركز الرئيسي (Parent cost center, typeahead, default "بدون مركز رئيسي", helper text:
  "اختياري — لتجميع مراكز التكلفة تحت مركز أعلى في التقارير" = optional, for grouping under a
  higher-level center in reports — confirms hierarchical cost centers), ملاحظات (Notes, textbox).
  Actions: إلغاء (Cancel), إضافة (Add).
- **Notes**: Cost centers are optional dimensional tags that can be independent, linked to a
  department, linked to a branch, and nested under a parent — used for the separate "أرباح مراكز
  التكلفة" (Cost Center P&L) report. This demo tenant has none configured despite having active
  departments/branches, so journal entries/vouchers here do not carry a cost-center dimension.

### أرباح مراكز التكلفة — Cost Center P&L
- **Route**: `/accounting/cost-center-pl`
- **Purpose**: Report showing profit/loss broken down by cost center.
- **Notes**: Since zero cost centers exist in this tenant (see above), this screen was expected
  to render an empty/zero-state and was deprioritized in favor of populated screens within the
  time budget; route confirmed reachable from the nav under المحاسبة.

### الفترات المالية — Fiscal Periods
- **Route**: `/accounting/fiscal-periods`
- **Purpose**: Define monthly fiscal periods per fiscal year and control whether posting is
  allowed into each period (period locking for close-of-books control).
- **List view**: Year selector combobox (showing "2026"); "إنشاء السنة التالية" (Generate next
  fiscal year — creates the 12 monthly periods for the following year, not clicked). Summary
  cards: إجمالي الفترات (Total periods, 24 — implying two fiscal years already exist/generated),
  فترات مفتوحة (Open, 24), فترات مغلقة (Closed, 0), فترات مقفلة (Locked, 0) — three distinct
  states: مفتوحة/مغلقة/مقفلة (open / closed / locked). "يحتاج انتباه" (Needs attention) callout
  panel: shows current period "الفترة الحالية — أغسطس 2026" (2026-08-01→2026-08-31) with posting
  status "مسموح" (Allowed), and a warning "7 فترة مفتوحة تجاوزت نهايتها" (7 open periods have
  passed their end date: يناير–يوليو 2026) with a "عرض المفتوحة" (View open) shortcut — i.e. the
  system flags stale-open periods that should probably be closed. Filter tabs: الكل (24) / مفتوحة
  (24) / مغلقة (0) / مقفلة (0). Table columns: الفترة (period — month name + year, with a status
  badge like "منتهية" ended / "الفترة الحالية" current period, shown inline per row), من — إلى
  (date range, sortable), الترحيل (posting permission, e.g. "مسموح" = allowed), الحالة (status,
  e.g. "مفتوحة" = open), and a row action — "إغلاق" (Close) button per row (present on every row
  including future/unstarted months). Pagination: "عرض 1 - 12 من 12" (12 months for the selected
  year).
- **Actions**: إنشاء السنة التالية (generate next year's periods, header — not exercised), إغلاق
  (close) per period row (not exercised — would mutate state).
- **Workflows/statuses**: مفتوحة (Open, posting allowed) → مغلقة (Closed) → مقفلة (Locked) —
  three-tier period lifecycle. Even periods in the future (Sep–Dec 2026) already exist as "مفتوحة"
  with "مسموح" posting, i.e. the whole year is pre-generated open, and closing is a manual,
  per-period action typically done retroactively at month-end.
- **Notes**: This is the period-control mechanism referenced implicitly by Journal Entries — a
  journal dated into a "مقفلة" period would presumably be blocked from posting/back-dating. The
  "opening balance" concept doesn't have its own field here either; likely opening balances are
  captured via a first journal entry dated at the start of the fiscal year, or via the data
  migration tool. No screen scoped to this pass exposed a literal "Opening Balances" form.

### الضرائب — Taxes
- **Route**: `/accounting/taxes`
- **Purpose**: Define tax rates (e.g. VAT) applied on sales/purchase invoices, including GL
  posting-account overrides and Egyptian ETA e-invoice tax-subtype classification.
- **List view**: Info banner: "تستخدم هذه الضرائب عند إنشاء الفواتير. إذا لم تحدد ضريبة للصنف،
  تطبق الضريبة الافتراضية تلقائيا" (These taxes are used when creating invoices; if no tax is set
  on an item, the default tax applies automatically) with a link to "الإعدادات ← الضريبة"
  (`/settings?tab=tax`). Search box "بحث", filter tabs الكل (1) / نشط (1) / غير نشط (0), filter
  panel with النوع (Type, combobox). Table columns: الاسم (Name — shows tax name, a "الافتراضي"
  Default badge when applicable, and a short code e.g. VAT14), نسبة الضريبة (%) (Rate, e.g.
  14.00%), النوع (Type, e.g. "غير شاملة (تضاف على السعر)" = exclusive/added on top of price — vs
  presumably an "inclusive" option), الحالة (Status, نشط), row action "تعديل" (Edit). Only one tax
  configured in this tenant: "ضريبة القيمة المضافة 14%" (VAT 14%, code VAT14, default, active).
  Pagination "عرض 1 - 1 من 1". Header secondary button "مجموعات الضرائب (0)" (Tax Groups, 0 —
  not opened, presumably a separate page/dialog for combining multiple taxes on one line).
- **Add Tax dialog** (opened, cancelled): اسم الضريبة * (Tax name, textbox), رمز الضريبة * (Tax
  code, textbox), نسبة الضريبة (%) * (Rate, numeric spinbutton, default 0), النوع (Type,
  combobox, default "غير شاملة (تضاف على السعر)" = exclusive), toggle "ضريبة افتراضية" (Default
  tax switch). Section "حسابات الترحيل" (Posting accounts): حساب الضريبة المستحقة (المبيعات)
  (Output/sales tax payable account, textbox, placeholder "تلقائي (الافتراضي 2200)" — defaults to
  account 2200 if left blank), حساب ضريبة المدخلات (المشتريات) (Input/purchases tax receivable
  account, textbox, placeholder "تلقائي (الافتراضي 1400)" — defaults to account 1400, matching
  the "1400 ضريبة مدخلات" account seen in the Chart of Accounts). Section "تصنيف الفاتورة
  الإلكترونية (ETA)": النوع الفرعي لضريبة القيمة المضافة (VAT sub-type, combobox, default
  "تلقائي (أساسي عند وجود ضريبة، غير خاضع عند 0%)" = automatic; helper text lists ETA codes: V009
  = basic sales, V003 = exempt, V004 = not subject to tax, V001/V002 = export — confirming direct
  ETA e-invoice tax-code mapping baked into tax definitions). Section "المجموعات" (Groups):
  message "لا توجد مجموعات بعد. أنشئ مجموعة من قائمة 'مجموعات الضرائب' لتتمكن من إضافة هذه
  الضريبة إليها" (no groups yet — create one from the Tax Groups list) — implies a tax can belong
  to multiple tax groups (e.g. combined VAT + withholding). Actions: إلغاء / إضافة.
- **Notes**: Tax posting accounts default to 2200 (output VAT payable, a Liability-side account
  presumably under 2000) and 1400 (input VAT receivable, confirmed present in Chart of Accounts).
  This is the clearest GL-mapping evidence in the Accounting domain — taxes post automatically to
  specific accounts on invoice confirmation. ETA sub-type codes (V001–V009) are wired at the tax
  level, meaning e-invoice classification is data-driven from this screen rather than manual
  per-invoice selection.

### أسعار الصرف — Exchange Rates
- **Route**: `/accounting/exchange-rates`
- **Purpose**: Maintain foreign-currency exchange rates against the base currency, used for
  multi-currency transactions and (paired with the separate FX Revaluation screen) period-end
  revaluation.
- **List view**: Banner "العملة الأساسية: EGP — جميع الأسعار محسوبة مقابل هذه العملة" (Base
  currency EGP — all rates computed against it). Search "بحث بالعملة" (search by currency).
  Filter tabs: الكل (0) / بانتظار الاعتماد (Pending approval, 0) / مقفل (Locked, 0) — implies
  rates go through an approval workflow and can be locked. Filter panel: من تاريخ / إلى تاريخ
  (date range), العملة الأجنبية (foreign currency, combobox). Table columns: زوج العملات (currency
  pair), سعر الصرف (rate), تاريخ السريان (effective date), المصدر (source), الحالة (status),
  row-menu. EMPTY in this tenant: "لا توجد أسعار صرف" / "أضف أسعار الصرف للعملات الأجنبية
  المفعلة" (No exchange rates — add rates for enabled foreign currencies), meaning no foreign
  currencies are actively configured with rates despite multi-currency fields existing elsewhere
  (e.g. journal entry currency selector defaults to EGP).
- **Add dialog** (opened, cancelled): العملة الأجنبية (Foreign currency, combobox, unset
  placeholder shown alongside a static "EGP" label — implying the rate is always quoted as
  foreign-currency-to-EGP), سعر الصرف * (Rate, numeric spinbutton, prefilled with a sample/default
  50.2500), تاريخ السريان * (Effective date, date picker, defaulted to today), نوع السعر (Rate
  type, combobox, default "قياسي" = Standard — implying other rate types exist, e.g. buy/sell),
  المصدر (Source, combobox, default "يدوي" = Manual — implying an automated/API source option
  also exists), ملاحظات (Notes, textbox). Actions: إلغاء / (Save button present but not read,
  panel truncated after cancel button in capture).
- **Notes**: The بانتظار الاعتماد (pending approval) and مقفل (locked) statuses suggest exchange
  rate entries may require approval before use and can be locked against edits — consistent with
  the approval workflow patterns seen elsewhere in the app (`/approvals`, `/settings/workflow`).
  This screen directly feeds `/accounting/revaluation` (FX Revaluation, below).

### إعادة تقييم العملات الأجنبية — FX Revaluation
- **Route**: `/accounting/revaluation`
- **Purpose**: Period-end process that revalues open foreign-currency balances (customers,
  suppliers, treasury accounts) at the tax-authority-approved closing rate and posts the
  resulting FX gain/loss as a journal entry. Explanatory copy on the page: "في نهاية كل فترة
  محاسبية تتغير أسعار صرف العملات الأجنبية. هذه الصفحة تنشئ قيداً يحدث أرصدة العملاء والموردين
  والخزائن المفتوحة بسعر الإقفال المعتمد من مصلحة الضرائب، وتسجل الفروقات كمكاسب أو خسائر فروق
  عملة. تنفذ عادة في آخر يوم من الشهر." (At each period end, FX rates change. This page creates an
  entry that updates open customer, supplier, and treasury balances at the tax-authority-approved
  closing rate, recording the differences as FX gain/loss. Normally run on the last day of the
  month.) Closing rate is sourced from the أسعار الصرف (Exchange Rates) screen (linked button).
  **Not run** — this pass only opened the form to document fields, per read-only scope (the
  primary action button is literally "revalue", excluded by the strict rules).
- **Form fields**: إلى تاريخ (تاريخ القيد) * (To date / posting date, date picker, default
  end-of-current-month 2026-08-31; helper text explains the entry posts on the "to" date, "from"
  is optional and only frames the review period, and the system uses the last exchange rate
  entered on/before the "to" date). Toggle "العكس التلقائي" (Auto-reverse, checkbox, default
  CHECKED "أنشئ قيداً عكسياً تلقائيا بعد الترحيل" — creates an automatic reversing entry after
  posting so the revaluation impact is confined to the closing day only and doesn't distort next
  month's reports; helper shows the computed reversal date, e.g. 2026-09-01). العملات (Currencies)
  — multi-select chip list: الكل (All) plus individual currency codes SAR, AED, QAR, KWD, BHD,
  OMR, JOD, USD, EUR, GBP (helper: optional, leave blank to revalue all open foreign currencies).
  Primary action: "معاينة" (Preview) — NOT clicked, to stay within the read-only/no-revalue rule.
- **Notes**: Confirms multi-currency support spans AR/AP sub-ledgers and treasury (cash/bank)
  accounts, not just journal entries. The currency picker offers 10 currencies (mostly GCC/MENA +
  USD/EUR/GBP) even though the Exchange Rates screen currently has zero configured rates for this
  tenant — meaning this feature is present but effectively unused/unconfigured in the demo data.
  The auto-reversal-by-default design is a notable GL-posting behavior: FX revaluation journal
  entries are meant to be transient/period-boundary-only, not permanent adjustments to the
  underlying AR/AP/cash balances.

### الفاتورة الإلكترونية المصرية (ETA) — e-Invoicing
- **Route**: `/accounting/eta`
- **Purpose**: Configure and monitor integration with Egypt's Tax Authority (ETA) e-invoicing/
  e-receipt system — company registration data, item/branch/tax-subtype mapping, and the
  submission queue for confirmed documents.
- **Readiness header**: "الجاهزية: 22%" (Readiness 22%) with a checklist of setup items and their
  fill state: رقم التسجيل الضريقي (Tax registration number, unset), كود النشاط (Activity code,
  unset), عنوان المنشأة (Company address, unset), أكواد الفروع لدى المصلحة (Branch codes with the
  authority, 1), أكواد الأصناف (Item codes, 23), ربط الوحدات (Unit/branch mapping, 4), أنواع
  الضريبة الفرعية (Tax sub-types, 1) — a completion tracker across all the sub-tabs.
- **Tabs**: عام (General), بيانات الربط (Connection/Credentials), ربط الأصناف (Item Mapping), ربط
  الوحدات (Unit/Branch Mapping), الإرسالات (Submissions).
  - **عام (General)**: البيئة (Environment, combobox, default "بيئة الاختبار (Pre-production)" —
    implies a Production environment option too), كود النشاط * (Activity code, typeahead "ابحث عن
    كود النشاط..."), Address block "عنوان المنشأة" (as registered with the authority): المحافظة *
    (Governorate), المدينة / الحي * (City/District), الشارع * (Street), رقم المبنى * (Building
    number), الرمز البريدي (Postal code, optional) — helper: used as source address when a branch
    lacks its own detailed address. حد بيانات المشتري (ج.م) (Buyer-data threshold, numeric,
    default 25000, helper: invoices at/above this amount legally require the individual buyer's
    national ID — "القيمة القانونية: 25,000 ج.م"). إصدار المستند (Document version, combobox,
    default "1.0 (موقع — للتشغيل الفعلي)" = signed, for production). Toggle "الإرسال التلقائي عند
    التأكيد" (Auto-submit on confirmation, default ON), helper: "إدراج المستندات المؤكدة في قائمة
    الإرسال لمصلحة الضرائب تلقائيا. التجميع نهاية الشهر يعرضك لمخالفة مهلة الإرسال القانونية" (auto
    -queues confirmed documents for submission; batching at month-end risks violating the legal
    submission deadline). Save button "حفظ" (not clicked).
  - **بيانات الربط (Connection/Credentials)**: helper "بيانات ربط النظام من بوابة الممول لدى
    مصلحة الضرائب. يحفظ السر مشفراً ولا يعرض مرة أخرى" (connection data from the ETA taxpayer
    portal; the secret is stored encrypted and never shown again). Fields: البيئة (Environment,
    same as General tab), طريقة التوقيع (Signing method, combobox, default "بدون توقيع (إصدار 0.9
    — للاختبار فقط)" = no signature, testing-only v0.9; helper notes production v1.0 invoices
    require an e-seal signature, with local signing agent/HSM support "in a coming phase"), Client
    ID * (textbox), Client Secret * (textbox, helper: stored AES-256 encrypted, never displayed,
    replaceable anytime). Actions: "اختبار الاتصال" (Test connection, disabled — presumably until
    credentials are filled), "حفظ" (Save, not clicked). Status strip: قائمة الإرسال (submission
    queue count, 15), أخطاء (errors, 0), يحتاج إلغاء (needs cancellation, 0), آخر إرسال ناجح (last
    successful submission, "—" none yet).
  - **ربط الأصناف / ربط الوحدات (Item / Unit mapping)**: not opened in detail (readiness counters
    show 23 items mapped, 4 units mapped) — presumably per-item and per-branch GS1/ETA code
    assignment tables, deprioritized to stay within budget.
  - **الإرسالات (Submissions)**: helper: "كل مستند مؤكد يظهر هنا. الإرسال التزام قانوني —
    الاستبعاد للحالات الاستثنائية فقط ويتطلب سبباً" (Every confirmed document appears here;
    submission is a legal obligation — exclusion is for exceptional cases only and requires a
    reason). Header action: "إرسال كل الجاهز" (Submit all ready, not clicked). Search: "ابحث برقم
    المستند...". Status filter tabs: جاهز (Ready, 15), بانتظار التوقيع (Pending signature, 0),
    أخطاء (Errors, 0), مرسل (Submitted, 0), مقبول (Accepted, 0), مستبعد (Excluded, 0). Table
    columns: المعرف الداخلي (internal doc ID, e.g. SRT-000001 credit/debit note, INV-000014 sales
    invoice), النوع (type: إشعار خصم = debit note, فاتورة = invoice), الحالة (status, e.g. "في
    قائمة الإرسال" = in submission queue), المعرف لدى المصلحة (UUID) (ETA UUID, "—" until
    submitted), الأخطاء (errors, "—"), row actions ("إرسال" = Submit per-row, plus a kebab menu —
    not clicked).
- **Workflows/statuses**: Per-document ETA lifecycle inferred from filter tabs: جاهز (Ready) →
  بانتظار التوقيع (Pending signature) → مرسل (Submitted) → مقبول (Accepted); separate error
  (أخطاء) and excluded (مستبعد) side-states.
- **Notes**: This tenant is only 22% "ready" — company registration fields (tax number, activity
  code, address) are unset, and the connection uses the unsigned v0.9 test environment. This is
  Egypt's mandatory e-invoicing/e-receipt integration (ETA), directly tied to the tax-subtype
  codes configured in the الضرائب (Taxes) screen (V001–V009). All 15 documents currently queued
  are "جاهز" (ready, in-queue) — none have actually been transmitted, consistent with a
  disconnected/unconfigured demo Client ID/Secret.

### مطابقة الأرصدة — Balance Reconciliation
- **Route**: `/accounting/reconciliation` (tabs via `?tab=unassigned` etc.)
- **Purpose**: A control-account integrity dashboard that cross-checks sub-ledger balances
  (inventory valuation, treasury/cash) against their corresponding GL control account balances,
  and separately flags any journal lines posted to "monitoring"/control accounts that weren't
  properly attributed to a sub-ledger record.
- **Tabs**: ملخص المطابقة (Reconciliation Summary, default) and القيود غير المرتبطة (Unlinked/
  Unassigned Entries). Header action: تحديث (Refresh).
- **ملخص المطابقة (Summary) tab**: Top banner "جميع الأرصدة متطابقة" (All balances reconciled) when
  clean. Card-per-comparison layout, each showing a "متطابق" (Matched) badge and a three-line
  breakdown (source balance / GL balance / difference), observed cards:
  - "تقييم المخزون مقابل دفتر الأستاذ" (Inventory valuation vs. Ledger): قيمة المخزون (Inventory
    value) 602,425.90 ج.م vs رصيد دفتر الأستاذ (GL balance) 602,425.90 ج.م, الفارق (Difference)
    0.00 ج.م; drill-down button "تفاصيل المخزون (لكل صنف ولكل نوع مستند)" (Inventory details, per
    item and per document type — not opened).
  - "الخزينة مقابل دفتر الأستاذ (EGP)" (Treasury vs. Ledger, EGP): رصيد المعاملات (Transactions
    balance) 338.00 ج.م vs رصيد دفتر الأستاذ (GL balance) 338.00 ج.م, matched.
  - (Additional cards likely exist for AR/AP control accounts per the page's card-grid layout;
    not all scrolled/captured in this pass — the two above confirm the pattern.)
- **القيود غير المرتبطة (Unlinked Entries) tab**: banner "لا توجد بنود غير مخصصة" (No unassigned
  items). Table "أحدث البنود غير المخصصة" (Most recent unassigned items) columns: رقم القيد
  (entry no.), التاريخ (date), الحساب (account), الوصف (description), مدين (debit), دائن (credit),
  row action. Empty state: "لا توجد بنود" / "جميع بنود حسابات المراقبة مخصصة بشكل صحيح" (all
  control-account line items are correctly attributed).
- **Notes**: This is a data-integrity/audit tool rather than a transactional screen — it verifies
  that automated GL postings from inventory and treasury sub-ledgers stay in lockstep with their
  source balances, and surfaces any journal lines hitting a control account without a proper
  sub-ledger link (e.g. a manual JE posted directly to the inventory or cash control account
  instead of through a proper transaction). In this tenant everything reconciles cleanly (0.00
  differences, zero unassigned items).

### القيود المحاسبية — Journal Entries (list + create)
- **Route**: `/accounting/journals` (list); `/accounting/journals/new` (create, full page, not
  submitted — cancelled by navigating away); individual entries open in a side panel from the
  list (row click) as documented above.
- **Purpose**: Central ledger of all journal entries, both system-generated (from vouchers,
  invoices, inventory adjustments, manufacturing costing, etc.) and manually created.
- **List view**: Summary stat cards: إجمالي القيود (Total entries, 78), مرحل (Posted, 78), معكوس
  (Reversed, 0) — a second, richer stat card set (in a popover/expanded state) additionally shows
  مسودة (Draft, 0) and بانتظار الموافقة (Pending Approval, 0), implying journal entries support a
  draft → pending-approval → posted → reversed lifecycle even though this demo tenant has none in
  draft/pending. Status filter tabs: الكل (All, 78), مسودة (Draft, 0), مرحل (Posted, 78), معكوس
  (Reversed, 0). Search: "بحث برقم القيد..." (search by entry number). Filter button "تصفية
  النتائج" reveals: من تاريخ / إلى تاريخ (date range) and الوحدة المصدر (source unit/module,
  combobox default "الكل"). Table columns: رقم القيد (entry no., e.g. JE-000078, sortable),
  التاريخ (date, sortable), الوحدة المصدر (source module/unit, sortable — e.g. "استلام منتج تام"
  = finished-goods receipt, "صرف مواد تصنيع" = manufacturing material issue, "تكلفة تشغيل تصنيع" /
  "تكلفة عمالة تصنيع" = manufacturing overhead/labor cost, "تسوية مخزون" = inventory adjustment,
  "فاتورة مشتريات"/"فاتورة مبيعات" = purchase/sales invoice, "مرتجع مبيعات" = sales return),
  إجمالي المدين (total debit, sortable), بواسطة (created by, clickable user chip → opens in side
  panel), and a trailing row-menu button. Pagination: "عرض 1 - 25 من 78" with page-number buttons
  (1–4) and rows-per-page selector.
- **Header actions**: طباعة القيود (Print entries), قيد جديد (New entry — opens
  `/accounting/journals/new` as a full page, not a modal).
- **Create form** ("إنشاء قيد يومي", opened, not submitted): Header fields — تاريخ القيد *
  (Entry date, date picker, defaulted to today), العملة (Currency, combobox, default "EGP
  (العملة الأساسية)" = base currency — confirms multi-currency journal entries are supported),
  الوصف * (Description, textbox, placeholder "وصف القيد..."). Line table columns: الحساب *
  (Account, typeahead textbox "اختر حساب..."), البيان (line memo, textbox "وصف البند..."), مدين
  (debit, numeric spinbutton), دائن (credit, numeric spinbutton), row-delete button (disabled
  until 3+ rows, i.e. minimum 2 lines enforced). Footer: "إضافة سطر" (Add line) button, and
  running total cells (0.00 ج.م debit / credit). Below the table: summary — إجمالي المدين (total
  debit), إجمالي الدائن (total credit), الفرق (difference) — all 0.00 ج.م when empty, implying a
  live-computed balance check before allowing posting. Primary actions header: "حفظ كمسودة" (Save
  as draft) and "ترحيل القيد" (Post entry) — both disabled until required fields/balanced lines
  are filled, confirming the draft/posted states seen in the list filters.
- **Actions**: طباعة القيود (bulk print), قيد جديد (create), row click → side-panel detail (see
  below), per-row menu (kebab, not opened).
- **Workflows/statuses**: مسودة (Draft) → بانتظار الموافقة (Pending Approval) → مرحل (Posted) →
  معكوس (Reversed). All 78 entries in this tenant are مرحل (Posted); none in draft/pending/
  reversed states were available to open.
- **API observed**: none captured directly (no network panel opened in this segment); URL pattern
  confirms REST-like routes `/accounting/journals`, `/accounting/journals/new`.
- **Notes**: The overwhelming majority of journal entries are auto-generated by other modules
  (manufacturing costing, inventory adjustments, purchase/sales invoices, treasury vouchers) —
  manual entry via "قيد جديد" exists but appears to be the exception path. This strongly implies
  GL posting is event-driven throughout the ERP: nearly every transactional document (voucher,
  invoice, stock adjustment, work order completion) creates a linked, immutable journal entry
  visible from both the source document and this ledger.

### قيد يومية (Journal Entry) — detail panel, opened via account drill-down
- **Route**: side panel over `/accounting/chart`; likely full page at `/accounting/journals/{id}`
  (not directly confirmed by URL in this capture, see Journals list section below for the list
  route).
- **Purpose**: View a single posted journal entry's header, balance check, and line items.
- **Detail view fields**: تاريخ القيد (entry date), المصدر (source document — link, e.g. "سند
  نقدي · CV-000009" → `/treasury/vouchers/{uuid}`, confirms auto-posting from voucher), تاريخ
  الإنشاء (created date), تاريخ الترحيل (posting date), عدد البنود (line count), الوحدة (unit/
  branch scope, e.g. "خزينة" = Treasury). Totals: إجمالي المدين (total debit), إجمالي الدائن
  (total credit), balance-check badge "متوازن ✓" (Balanced, checkmark — implies an unbalanced
  state is possible/flagged before posting).
- **Line table** ("بنود القيد" tab): columns الحساب (account, code+name, clickable → opens account
  side panel — bidirectional drill-down), الوصف (description/memo per line), مدين (debit), دائن
  (credit). Footer totals row repeats "متوازن ✓" + total debit/credit.
- **Other tabs**: المرفقات (Attachments), سجل المراجعة (Audit/revision log) — not opened.
- **Actions**: "فتح في صفحة كاملة" (open full page), "رجوع" (back — since it was opened from an
  account panel), "إغلاق" (close).
- **Notes**: Confirms double-entry enforcement with an explicit balance indicator in the UI.
  Every line account is a live link back into the Chart of Accounts, reinforcing the two screens
  are tightly integrated.

---

### المحاسبة — Accounting Hub / Domain Landing Page — added by verification pass
- **Route**: `/accounting/hub` — a real, fully-rendered route not linked from the sidebar (the "المحاسبة" sidebar entry only toggles its submenu open, no `/url`). Found by extracting route-literal strings from the production JS bundle and test-navigating; every domain in the app has one of these at `/{module}/hub` (see `01-sales.md`'s Sales Hub entry for the full write-up of the pattern — this is the one domain where the original pass came closest, since neither this file nor `07-mfg-projects-assets.md`'s `/assets/hub` mention actually captured content, only inferred the route's existence from a breadcrumb).
- **Purpose**: Domain dashboard/launcher — "إدارة القيود والتقارير والفترات المالية".
- **List view** (tile/dashboard layout):
  - Status banner: "الفترة المالية مفتوحة — يمكن الترحيل" (current fiscal period is open — posting is allowed).
  - "بدء سريع" quick-create row: قيد يومية جديد (new journal entry).
  - "مناطق العمل" tile grid with live counts and "عرض" links: القيود المحاسبية (N إجمالي), التقارير المالية (no count — "عرض التقارير"), مطابقة الأرصدة ("عرض التسوية"), دليل الحسابات ("عرض"), الفترات المالية (N مفتوحة · N مقفلة), الضرائب ("عرض"), أسعار الصرف ("عرض"), إعادة تقييم العملات الأجنبية ("عرض").
  - "النشاط الأخير" → "آخر القيود المرحلة" (recent posted journal entries) — description, JE number + date, status pill (مرحل/Posted). In this tenant's live data the five most recent entries were all auto-generated manufacturing cost postings tied to a single work order (WO-0010): finished-goods receipt, overhead cost, labor cost, material return, additional material issue — concrete evidence that Manufacturing work-order completion auto-posts a multi-line journal entry chain into Accounting without user intervention.
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above.
- **Actions**: Quick-create shortcut (new journal entry); tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls plus `GET /api/accounting/journal-entries/counts`, `GET /api/accounting/fiscal-periods/counts`, `GET /api/exchange-rates/counts`, `GET /api/accounting/journal-entries?limit=5&status=POSTED&sortBy=date&sortDir=DESC` (the recent-activity feed).
- **Notes**: See `01-sales.md`'s Sales Hub entry for the full discussion of why this whole class of screen was missed by the original recon. The recent-activity feed here is the single best piece of evidence in this whole catalog of Manufacturing → Accounting auto-posting, since the demo tenant's Journal Entries list itself (documented above) doesn't call out which entries originated from work orders vs. manual entry vs. other modules.

---

## Treasury

### حسابات الخزينة — Treasury Accounts (cash registers/safes/banks)
- **Route**: `/treasury/accounts` (list); `/treasury/accounts/{uuid}/statement` (detail — a full
  statement page, not a side panel).
- **Purpose**: Manage the company's cash registers/safes and bank accounts as treasury/cash
  "wallets", each tied to a GL account, with a running statement of all movements.
- **List view**: Summary cards: إجمالي الحسابات (Total accounts, 2), إجمالي الأرصدة (Total
  balances, 338.00 ج.م); expanded popover adds النقد المتاح (Cash on hand, 338.00 ج.م) and الرصيد
  البنكي (Bank balance, 0.00 ج.م) — i.e. cash and bank are summed separately even though both are
  "treasury accounts". Search "بحث بالاسم...". Filter tabs: الكل (2) / نشط (2) / نقدي (Cash, 2) /
  بنكي (Bank, 0) / غير نشط (Inactive, 0). Filter panel: الحالة (Status), العملة (Currency),
  الرصيد (من)/(إلى) (Balance range). Table columns: اسم الحساب (name, with code + branch
  subtitle, e.g. "صندوق نقدي · CASH-001 · الفرع الرئيسي"), نوع الحساب (type: نقدي = Cash), العملة
  (Currency, EGP), الرصيد (Balance), row-menu. Two accounts in this tenant: CASH-001 "صندوق نقدي"
  (0.00 ج.م) and CASH-002 "صندوق نقدي الفرع الرئيسي" (338.00 ج.م), both Cash/EGP/Main branch — no
  bank accounts configured despite the type existing. Pagination "عرض 1 - 2 من 2".
- **Add Account dialog** (opened, cancelled): اسم الحساب * (Name, textbox), نوع الحساب * (Account
  type, combobox, default "نقدي" = Cash — presumably also "بنكي" = Bank), العملة * (Currency,
  combobox, default "EGP — جنيه مصري"), الفرع * (Branch, typeahead "اختر الفرع" — required, unlike
  Chart-of-Accounts entries), حساب دفتر الأستاذ (Ledger/GL account, optional typeahead, helper:
  "لا تحتاج إلى تعبئة هذا الحقل غالباً. سيختار النظام الحساب المناسب تلقائيا حسب النوع" — usually
  left blank; the system auto-selects the matching GL account by type). Section "الرصيد الافتتاحي
  (اختياري)" (Opening balance, optional): الرصيد الافتتاحي (amount, spinbutton, default 0.00),
  تاريخ الرصيد الافتتاحي (opening balance date, date picker, defaulted to today). Actions: إلغاء /
  إضافة.
- **Account statement page** (`/treasury/accounts/{uuid}/statement`, opened for CASH-002): header
  "كشف حساب — {account name}" with a "المزيد" (More) menu offering: طباعة (Print), تعديل (Edit),
  and — importantly — **إضافة رصيد افتتاحي (Add Opening Balance)**, confirming opening balances
  for treasury accounts can also be added/adjusted after creation, not just at creation time.
  Header stat strip: الكود (Code), نوع الحساب (Type), العملة (Currency), إجمالي الوارد (Total
  in), إجمالي الصادر (Total out), صافي الحركة (Net movement), and a prominent الرصيد الختامي
  (Closing balance) card. Date range filter: من / إلى + تطبيق (Apply). A secondary summary
  card repeats الرصيد الختامي / إجمالي الوارد / إجمالي الصادر. Movement table columns: التاريخ
  (date), المرجع (reference — a clickable link to the source document, e.g. "السندات النقدية ·
  CV-000015" → `/treasury/vouchers/{uuid}`), وارد (in/inflow), صادر (out/outflow), الرصيد الجاري
  (running balance). Pagination "عرض 1 - 5 من 5".
- **Actions**: إضافة حساب (header, create), row click → statement page, per-account "المزيد" menu
  (طباعة/تعديل/إضافة رصيد افتتاحي).
- **Notes**: This is the definitive answer to "opening balances" for treasury: both settable at
  account-creation time and addable/adjustable later via a dedicated menu action on the account
  statement page. No equivalent "opening balance" affordance was seen on the Chart of Accounts'
  "Add Account" dialog, suggesting opening balances for non-treasury GL accounts (AR, AP, equity,
  etc.) are handled differently — likely via manual journal entries or the data-migration tool.
  Every movement row links straight to its originating voucher, reinforcing the
  event-driven-GL-posting pattern seen throughout Accounting.

---

### السندات النقدية — Treasury Vouchers (receipts/payments/transfers)
- **Route**: `/treasury/vouchers` (list); `/treasury/vouchers/{uuid}` (detail, full page).
- **Purpose**: The single unified screen for ALL cash/bank movements — customer collections,
  supplier payments, refunds, other income/expense, owner capital movements, tax payments, and
  inter-treasury transfers. This is the reference system's "receipt voucher / payment voucher" equivalent, using
  one document type with a "نوع السند" (voucher type) discriminator rather than separate screens.
- **List view**: Summary cards: الإجمالي (Total, 15), مؤكد (Confirmed, 15), مسودة (Draft, 0).
  Type-breakdown chips (also act as quick filters): تحصيل من عميل (Customer collection, 10),
  إيراد آخر (Other income, 3), تحويل بين الخزائن (Inter-treasury transfer, 2) — only these 3 of
  the 10 possible types have data in this tenant. Search: "ابحث برقم السند، المرجع، العميل،
  المورد…". Status filter tabs: الكل (15) / بحاجة لتخصيص (Needs allocation, 0) / مسودة (Draft, 0)
  / بانتظار الموافقة (Pending approval, 0) / مؤكد (Confirmed, 15) / ملغي (Cancelled, 0). Filter
  panel: نوع السند (Voucher type, combobox with all 10 types as options — see full list below),
  من تاريخ / إلى تاريخ (date range). Table columns: رقم السند (voucher no. + date, e.g.
  CV-000015), نوع السند (type), الطرف (counterparty — customer/supplier name, or "بدون طرف محدد"
  = no party for internal/other types), حساب الخزينة (treasury account — for transfers shown as
  "From → To"), المبلغ (amount, signed +/− with color), الحالة (status), بواسطة (created by),
  row-menu. Pagination not fully captured but consistent "عرض N" pattern with the rest of the app.
- **All 10 voucher types** (from the "New Voucher" type-picker, each with its own guiding
  subtitle): تحصيل من عميل — "استلام دفعة من عميل وتخصيصها على فواتيره" (receive customer payment,
  allocate to invoices); دفع لمورد — "صرف دفعة لمورد وتخصيصها على فواتيره" (pay supplier, allocate
  to invoices); رد مبلغ لعميل — "إرجاع مبلغ نقدي للعميل (بعد مرتجع أو رصيد دائن)" (refund customer
  cash, after a return or credit balance); دفعة مقدمة من عميل مقاولات — "دفعة مقدمة يدفعها العميل
  على عقد مقاولة (تسترد من المستخلصات)" (advance payment on a construction/contracting contract,
  recovered from progress certificates — a contracting-specific voucher subtype); استرداد من مورد
  — "استلام مبلغ نقدي من مورد (بعد مرتجع مشتريات أو رصيد دائن)" (receive cash refund from
  supplier); إيراد آخر — "إيراد لا يخص فاتورة (إيجار محصل، فوائد، خصومات بنكية…)" (other income not
  tied to an invoice: rent collected, interest, bank discounts); مصروف آخر — "مصروف لا يخص مورد
  (إيجار مدفوع، صيانة، مرافق…)" (other expense not tied to a supplier: rent paid, maintenance,
  utilities); ضخ رأس مال من الشريك — "إيداع شخصي من الشريك إلى الخزينة" (partner personal capital
  injection into treasury); سحب شخصي للشريك — "سحب شخصي من الخزينة للشريك" (partner personal
  withdrawal from treasury); دفع لمصلحة الضرائب — "دفعة لمصلحة الضرائب أو جهة حكومية" (payment to
  the tax authority or a government body); تحويل بين الخزائن — "تحويل مبلغ بين خزينتين داخل
  المنشأة" (transfer between two treasuries within the company).
- **Create form** (2-step: pick type, then fill form; "دفع لمورد" opened as example, cancelled):
  Step 1 is a type-picker grid (button per type, as listed above) with a "تغيير نوع السند" (change
  voucher type) link visible once a type is chosen (returns to step 1). Step 2 fields (for دفع
  لمورد): المورد * (Supplier, typeahead "ابحث عن مورد..."), المبلغ * (Amount, numeric spinbutton),
  العملة (Currency, combobox, default "EGP (العملة الأساسية)"), طريقة الدفع * (Payment method,
  combobox, default "نقدي" = Cash — presumably also بنكي/شيك/بطاقة per the payment-method options
  seen elsewhere), حساب الخزينة * (Treasury account, typeahead "اختر حساب الخزينة"), التاريخ *
  (date, defaulted to today), الفرع * (Branch, combobox, default "الفرع الرئيسي"), رقم المرجع
  (Reference number, optional textbox), ملاحظات (Notes, optional textbox). Actions: إلغاء
  (Cancel), "إنشاء وتأكيد" (Create & Confirm — a single-step create-and-post action, no separate
  draft-save button visible on this form, though the list's status filters imply drafts can
  exist via another path).
- **Detail page** (`/treasury/vouchers/{uuid}`, opened for 3 types): Header shows voucher number +
  status badge (e.g. "CV-000015 مؤكد" = Confirmed). Actions: مشاركة (Share), المزيد (More) menu →
  طباعة (Print), إلغاء (Cancel — voucher-level cancel action, not clicked). Field grid (varies by
  type): نوع السند (type), التاريخ (date), طريقة الدفع (payment method), الفرع (branch), and
  type-specific fields — العميل (Customer, for collections) or المورد (Supplier, for payments) or
  من الخزينة / إلى الخزينة (From/To treasury, for transfers), حساب الخزينة (treasury account),
  الحساب المحاسبي (GL account — shown for "other income" type, e.g. "4900 — Cash Overage",
  confirming each voucher type maps to a specific/configurable GL account). Amount card: المبلغ
  (signed amount) and, for allocatable types, "التخصيص" (Allocation status, e.g. "مخصص بالكامل" =
  fully allocated) with a "مخصص:" (allocated amount) readout. "تأثيرات هذا السند" (Effects of this
  voucher) — a plain-language explainer box listing 2 bullet effects per type, e.g. for customer
  collection: "تم استلام المبلغ في الخزينة أو البنك" (amount received into treasury/bank) +
  "تم تحصيل المبلغ من العميل" (amount collected from customer, "يمكن استخدام المبلغ لسداد فاتورة،
  أو يبقى رصيداً دائناً للعميل" — can be applied to an invoice or remain a customer credit
  balance); for transfers: "تم التحويل بين الحسابات" ×2 (transferred between accounts, doesn't
  change total liquidity). Tabs (vary by type): "تخصيص على الفواتير (N)" (Invoice Allocation, only
  on collection/payment types — table columns رقم الفاتورة/المبلغ/التاريخ/الحالة + row action
  "عكس التخصيص" = Reverse allocation), القيود المحاسبية (Journal Entries — table رقم القيد/
  الحساب/مدين/دائن, each row linking to the JE side panel), المرفقات (Attachments), سجل المراجعة
  (Audit log).
- **Vouchers opened in this pass**:
  - CV-000015 (إيراد آخر / Other income, 100 ج.م): posts to GL account "4900 — Cash Overage" via
    JE-000051 (Dr 1300-1 Cash / Cr 4900 Cash Overage).
  - CV-000013 (تحصيل من عميل / Customer collection, from "شركة الامل", 1 ج.م): fully allocated
    ("مخصص بالكامل") against invoice INV-000002, with a reversible allocation action.
  - CV-000014 (تحويل بين الخزائن / Inter-treasury transfer, 6 ج.م, من "صندوق نقدي" إلى "صندوق
    نقدي الفرع الرئيسي"): posts via JE-000050 as a pure balance-sheet reclassification between
    two 1300-x cash accounts.
- **Workflows/statuses**: مسودة (Draft) → بانتظار الموافقة (Pending Approval) → مؤكد (Confirmed) →
  ملغي (Cancelled); a distinct "بحاجة لتخصيص" (Needs allocation) state also exists for
  collection/payment vouchers whose amount hasn't been fully applied to invoices yet. All 15
  vouchers in this tenant are مؤكد (Confirmed).
- **API observed**: none captured via network tab in this segment; URL pattern confirms
  `/treasury/vouchers/{uuid}` as the canonical voucher resource route, matching the "المصدر"
  links seen from Journal Entries and the Chart of Accounts.
- **Notes**: Vouchers are the primary GL-posting trigger for treasury movements — every voucher
  auto-generates exactly one journal entry (visible in the القيود المحاسبية tab) at confirmation
  time, and "إنشاء وتأكيد" suggests creation and posting happen atomically (no separate "confirm"
  step needed after save, unlike Journal Entries which have distinct مسودة/ترحيل actions). The
  invoice-allocation mechanism (تخصيص على الفواتير) is how customer collections and supplier
  payments get matched against specific AR/AP invoices, functioning like a cash-application
  screen embedded directly in the voucher.

---

### تسوية كشوف البنك — Bank Statement Reconciliation
- **Route**: `/treasury/bank-reconciliation`
- **Purpose**: Import bank statements (CSV) and reconcile them line-by-line against system
  treasury transactions. Subtitle: "استيراد كشوف البنك ومطابقتها مع معاملات النظام" (Import bank
  statements and match them against system transactions).
- **List view**: EMPTY in this tenant (no bank accounts exist — consistent with the Treasury
  Accounts screen showing 0 بنكي accounts). Summary cards: إجمالي الكشوف (Total statements, 0),
  قيد التسوية (In progress, 0), منتهية (Completed, 0), نسبة المطابقة (Match rate, 0%); expanded
  popover adds مودع (Deposited, 0.00 ج.م). Search "بحث بالحساب أو المرجع أو الفترة...". Status
  filter tabs: الكل / مستورد (Imported) / قيد التسوية (In progress) / منتهية (Completed), all 0.
  Filter panel: حساب الخزينة (Treasury account, typeahead, placeholder "جميع الحسابات"), من/إلى
  (date range). Table columns: الحساب (Account), الفترة (Period), الرصيد الافتتاحي (Opening
  balance), الرصيد الختامي (Closing balance), نسبة المطابقة (Match %), الحالة (Status), row-menu.
  Empty state: "لا توجد كشوف بنك بعد" (No bank statements yet).
- **Header actions**: استيراد كشف بنك (Import bank statement, opens dialog), المزيد (More menu,
  not opened).
- **Import dialog** (opened, cancelled): حساب الخزينة * (Treasury/bank account, typeahead "اختر
  حسابا بنكيا"), المصدر * (Source, combobox, default "ملف CSV" = CSV file — implying other import
  sources may exist, e.g. direct bank API/OFX/MT940), ملف الكشف * (Statement file, "Choose File"
  uploader), بداية الفترة * / نهاية الفترة * (Period start/end dates), الرصيد الافتتاحي * /
  الرصيد الختامي * (Opening/closing balance, numeric), رقم الكشف (Statement number, optional).
  Section "تعيين الأعمدة *" (Column mapping, disabled until a CSV is chosen): button "تعيين
  الأعمدة" (Map columns), helper: "اختر ملف CSV أولاً ثم عين الأعمدة على الحقول القياسية. يحفظ
  التعيين لكل حساب" (choose a CSV first, then map its columns to standard fields; the mapping is
  saved per account — implying a one-time column-mapping setup per bank account/format).
  Actions: إلغاء / استيراد (Import).
- **Notes**: A proper bank-statement-import + line-matching reconciliation workflow exists (CSV
  with configurable, persisted column mapping) but is entirely unused in this demo tenant since no
  bank treasury accounts are configured — only cash accounts exist.

### سجل الشيكات — Cheque Register
- **Route**: `/financial-papers/cheques` (list, under a distinct URL namespace
  "financial-papers" rather than "treasury"); `/financial-papers/cheques/new` (create, full page).
- **Purpose**: Track physical/post-dated cheques received from customers (واردة) or issued to
  suppliers (صادرة) through their lifecycle (pending → deposited → cleared/bounced/replaced),
  separate from the general voucher/payment flow.
- **List view**: EMPTY in this tenant. Summary cards: إجمالي الشيكات (Total cheques, 0), إجمالي
  القيمة (Total value, 0.00 ج.م), قيد الانتظار (Pending, 0.00 ج.م); popover adds مودع (Deposited,
  0.00 ج.م). Search "بحث برقم الشيك...". Status filter tabs: الكل / قيد الانتظار (Pending) / تحت
  التحصيل (Under collection) / المستحقة اليوم (Due today) / مودع (Deposited) / محصل (Collected) /
  مرتد (Bounced) / مستبدل (Replaced) — a 7-state lifecycle, all 0 in this tenant. Filter panel: من
  تاريخ / إلى تاريخ, الاتجاه (Direction, combobox: presumably واردة/صادرة). Table columns: رقم
  الشيك (Cheque no.), الجهة (Party), المبلغ (Amount), تاريخ الاستحقاق (Due date), اسم البنك (Bank
  name), الاتجاه (Direction), الحالة (Status), بواسطة (Created by), row-menu. Empty state: "لا
  توجد شيكات" (No cheques).
- **Create form** ("شيك جديد", full page, opened, not saved): نوع الشيك (Cheque direction) — two
  large selectable cards: "واردة — شيك مستلم من عميل" (Incoming — cheque received from a
  customer) vs. "صادرة — شيك صادر لمورد" (Outgoing — cheque issued to a supplier); selecting
  "واردة" reveals العميل * (Customer, typeahead — the field was shown disabled/placeholder
  "اختر المورد..." mislabeled in the snapshot, likely a template artifact where the
  customer/supplier field swaps based on direction). Section "بيانات الشيك" (Cheque data): رقم
  الشيك * (Cheque number, textbox, placeholder example "CHQ-5001"), اسم البنك * (Bank name,
  textbox), اسم فرع البنك (Bank branch name, optional), رقم الحساب (Account number, optional).
  Section "القيمة والتواريخ" (Value & dates): المبلغ * (Amount, numeric), تاريخ الإصدار * (Issue
  date), تاريخ الاستحقاق * (Due date). Section "الفرع والملاحظات" (Branch & notes): الفرع * (Branch,
  typeahead) and (a notes field, not fully captured — page content was cut off in this pass).
  Header action: "حفظ الشيك" (Save cheque, not clicked).
- **Notes**: Cheques are tracked as a distinct financial-instrument register (separate URL
  namespace from `/treasury`), reflecting that a cheque received today may not clear/deposit for
  weeks — the 7-state status list (Pending/Under collection/Due today/Deposited/Collected/
  Bounced/Replaced) models that lag explicitly, including a "مرتد" (Bounced) failure state and a
  "مستبدل" (Replaced) state for when a bounced cheque is swapped for a new one. This likely
  integrates with the "1320 شيكات تحت التحصيل" (Cheques Under Collection) and "1360 شيكات مرتجعة"
  (Bounced Cheques Receivable) accounts seen in the Chart of Accounts. Entirely unused in this
  demo tenant (0 cheques).

---

### الخزينة — Treasury Hub / Domain Landing Page — added by verification pass
- **Route**: `/treasury/hub` — a real, fully-rendered route not linked from the sidebar (the "الخزينة" sidebar entry only toggles its submenu open, no `/url`). Found by extracting route-literal strings from the production JS bundle and test-navigating; every domain in the app has one of these at `/{module}/hub` (see `01-sales.md`'s Sales Hub entry for the full write-up of the pattern).
- **Purpose**: Domain dashboard/launcher — "إدارة التحصيل والصرف والحسابات البنكية".
- **List view** (tile/dashboard layout):
  - "بدء سريع" quick-create row: سند نقدي جديد, سند قبض جديد, سند صرف جديد, تحويل داخلي جديد, شيك جديد — five distinct shortcuts even though the underlying document is a single "voucher" type-discriminated record (per this file's own Treasury Vouchers section above); confirms قبض/صرف/تحويل داخلي/شيك are all voucher *type* presets, not separate documents.
  - "مناطق العمل" tile grid: السندات النقدية (N إجمالي, "عرض السندات"), التخصيصات (payment-to-invoice allocations, "عرض التخصيصات" — route `/treasury/allocations`, confirmed to redirect to `/treasury/vouchers?tab=needs_allocation`, i.e. a filtered view of the already-documented Vouchers list, not a separate screen), حسابات الخزينة ("عرض"), تسوية كشوف البنك ("عرض"), سجل الشيكات (N إجمالي, "عرض").
  - "النشاط الأخير" → "آخر السندات النقدية" (recent cash vouchers) — counterparty/label, CV number + date, status pill, signed amount (+ / for receipts, plain for disbursements/transfers).
- **Detail/form view**: n/a — tiles deep-link to the screens already documented above.
- **Actions**: Five quick-create shortcuts; tile navigation links only.
- **Workflows/statuses**: n/a (dashboard).
- **API observed**: shared app-shell calls plus per-tile counts/recent-activity calls for vouchers, accounts, cheques (not individually isolated in this pass).
- **Notes**: The "التخصيصات" (Allocations) tile links to `/treasury/allocations`, confirmed by direct navigation to be a redirect to `/treasury/vouchers?tab=needs_allocation` (a filtered tab of the Treasury Vouchers screen already documented above), not an independent document type. See `01-sales.md`'s Sales Hub entry for the full discussion of why this whole class of hub screen was missed by the original recon.

---

## Ledger report output (from `/accounting/reports`)

This section documents the post-run output of the two report tabs that a prior Reports pass
could not capture: "دفتر الأستاذ العام" (General Ledger) and "دفتر حساب" (Account Ledger), both
under `/accounting/reports`. Both reports were run via "عرض التقرير" (a read-only report-view
action, permitted by scope) — no data was mutated.

### دفتر الأستاذ العام — General Ledger tab
- **Route**: `/accounting/reports?tab=general-ledger`
- **Purpose**: A per-account summary of total debit/credit activity and ending balance for every
  GL account over a chosen period — effectively a "trial balance with account-type context",
  distinct from the separate "ميزان المراجعة" (Trial Balance) tab on the same page.
- **Filter bar** (shared header across all report tabs, tabs are: ميزان المراجعة / قائمة الدخل /
  الميزانية العمومية / التدفقات النقدية / إقرار ضريبة القيمة المضافة / دفتر الأستاذ العام / دفتر
  حساب): من (From date), إلى (To date, both defaulted to the current month: 2026-08-01 →
  2026-08-21), بحث عن حساب (Search for an account, optional filter box — narrows the account list
  without requiring a single selection, unlike the Account Ledger tab), "عرض التقرير" (View
  report) button, and a "تصفية النتائج" (Filter results) button showing an applied-filter count
  badge. Header action: تصدير (Export).
- **Pre-run state**: placeholder heading "اختر الفترة لعرض التقرير" (Choose the period to view
  the report) — no table rendered until run.
- **Post-run output table**: columns الحساب (Account — code + bilingual name, clickable → opens
  the account side panel, same as Chart of Accounts), نوع الحساب (Account type: أصول/التزامات/
  حقوق ملكية/إيرادات/مصروفات), إجمالي المدين (Total debit for the period), إجمالي الدائن (Total
  credit for the period), الرصيد (Balance, with a "مدين"/"دائن" debit/credit-side label appended,
  e.g. "2,782.30 ج.م مدين"). One row per GL account, ALL accounts included regardless of activity
  (e.g. "1110 أقساط مستحقة على العملاء" shows 0.00/0.00/0.00 مدين — zero-activity accounts are
  not filtered out). Pagination: "عرض 1 - 50 من 69" (69 total accounts, 50 per page, page buttons
  1/2). No footer/grand-total row observed on the page (verify via Export if a totals row is
  needed). Row order follows Chart-of-Accounts numbering (1100, 1110, 1150, 1160, ... up through
  4000s/5000s).
- **Example rows observed**: 1100 "الذمم المدينة (العملاء)" (أصول) — debit 3,229.50 / credit
  447.20 / balance 2,782.30 مدين; 5030 "تكاليف صناعية غير مباشرة" (مصروفات) — debit 0.00 / credit
  2.00 / balance 2.00 دائن.
- **Notes**: This is a balance-per-account report (not transaction-level) — clicking an account
  row opens the same quick-preview side panel used throughout Accounting (with its own
  حركات الحساب/سجل التدقيق tabs), which is where transaction-level drill-down actually happens.
  The "بحث عن حساب" filter narrows this list live; it does not need to be set to view the full
  report (unlike Account Ledger below, which requires exactly one account).

### دفتر حساب — Account Ledger tab
- **Route**: `/accounting/reports?tab=account-ledger`
- **Purpose**: A single-account transaction ledger (all journal-entry lines posted to one
  specific account over a date range) — the transaction-level counterpart to the General Ledger
  tab's per-account summary.
- **Filter bar**: من / إلى (date range, same defaults as General Ledger), الحساب (Account — a
  required typeahead "اختر حساب...", distinct from the optional search box on the General Ledger
  tab), "عرض التقرير" button (DISABLED until an account is selected — confirmed by testing: the
  button only became clickable after selecting "1300-1 - صندوق نقدي الفرع الرئيسي" from the
  typeahead's dropdown via keyboard arrow-down + Enter).
- **Pre-run state**: placeholder heading "اختر الحساب والفترة الزمنية لعرض التقرير" (Choose the
  account and time period to view the report).
- **Post-run output** (run for account 1300-1 "صندوق نقدي الفرع الرئيسي", period 2026-08-01 to
  2026-08-21): Header card: اسم الحساب (Account name) "صندوق نقدي الفرع الرئيسي" with code
  "1300-1" beneath it; رصيد أول المدة (Opening balance) 0.00 ج.م; رصيد نهاية المدة (Closing
  balance) 338.00 ج.م. Transaction table columns: التاريخ (Date), رقم القيد (Journal entry
  number, e.g. JE-000041, clickable → opens the JE side panel), الوصف (Description — populated
  here with the SOURCE DOCUMENT label + number, e.g. "Internal Transfer: CV-000009" or "Cash
  Voucher: CV-000010" — notably in English/mixed rather than Arabic, likely a system-generated
  description string rather than a user-entered memo), مدين (Debit), دائن (Credit), الرصيد الجاري
  (Running balance, cumulative). 5 rows returned, matching exactly the movements already seen on
  this account's Chart-of-Accounts side panel and its Treasury statement page (JE-000041 through
  JE-000051, all debits, running balance climbing from 100.40 to 338.00 ج.م). Pagination: "عرض 1 -
  5 من 5".
- **Notes**: This is the canonical "T-account" / account-statement report — it reproduces the same
  underlying data already visible via the Chart of Accounts detail panel and the Treasury account
  statement page, confirming those two are themselves front-ends onto this same ledger data
  rather than separate stores. The auto-generated "الوصف" strings (e.g. "Internal Transfer:
  CV-000014", "Cash Voucher: CV-000015") reveal the internal source-type taxonomy used for
  journal-entry line descriptions: "Internal Transfer" for inter-treasury transfer vouchers vs.
  "Cash Voucher" for all other voucher types — a naming detail not visible from the Arabic UI
  elsewhere. Selecting the account required simulating typeahead keyboard interaction (type text,
  ArrowDown, Enter) because the rendered dropdown option had no clickable accessibility-tree
  target in this capture — worth noting for future automated passes against this screen.

