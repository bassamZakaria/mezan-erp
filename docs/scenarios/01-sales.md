# Sales Domain — UI Test Scenarios

## Sources

- `docs/catalog/01-sales.md` — capture of the reference product's running UI (what the product is *supposed* to do).
- Actual implementation, read in full: `apps/web/src/screens/CustomersScreen.tsx`, `SalesQuotesScreen.tsx`, `SalesInvoicesScreen.tsx`, `SalesReturnsScreen.tsx`, `PriceListsScreen.tsx`, `PromotionsScreen.tsx`, `apps/web/src/screens/hubs/SalesHubScreen.tsx`, plus `apps/web/src/nav-config.ts` and `apps/web/src/App.tsx` for routing/nav wiring.
- Domain/validation: `packages/domain/src/sales-invoices/*`, `packages/domain/src/sales-returns/*`, `packages/domain/src/promotions/promotion.ts`, `packages/domain/src/money/{money,qty}.ts`.
- Seed data: `packages/backend/src/demo-seed.ts`, `demo-seed/purchasing.ts`, `demo-seed/treasury.ts`, `demo-seed/platform.ts`.
- `docs/defects.md` — the six known open defects (D1–D6).

## Conventions used throughout

- **Money and Qty** are scale-6 signed integers (`packages/domain/src/money/money.ts`, `qty.ts`). The UI renders them as decimals; digits render Arabic-Indic in `ar` locale and Latin in `en` locale.
- **Language**: the top-bar language toggle (`packages/ui/src/shell/Topbar.tsx`) flips locale and RTL/LTR live, no reload. Rather than duplicate every scenario in both languages, each screen section ends with one explicit "run in English/LTR" scenario that re-checks labels, mirroring, and digit rendering; run any other scenario in both languages if you suspect a locale-specific regression.
- **"Today"** for these scenarios is **2026-08-24**. Every seeded invoice due date and quote expiry date in the base sales seed is still in the future as of this date — scenarios that need an overdue invoice or an expired quote say so explicitly and describe how to force one; don't assume one exists in fresh seed data.
- A scenario tagged **`[NOT IMPLEMENTED]`** describes catalog behavior this build does not have. Run it once to confirm the absence, note it, and move on — it is not a bug to re-file every pass.
- A scenario that touches a known defect cites its ID (**D1–D6**) so it isn't re-filed.
- IDs are `SALES-001`, `SALES-002`, … sequential across the whole document, grouped by screen in the order a user meets them in the sidebar (`سياق` order in `nav-config.ts`: نظرة عامة → العملاء → عروض الأسعار → فواتير المبيعات → مرتجعات المبيعات → قوائم الأسعار → العروض).

## Seed data this file relies on

**Customers** — `CUST-DEMO-1` شركة الأمل للتجارة (C-0001, 30-day terms, credit limit 50,000, no price list), `CUST-DEMO-2` مؤسسة النور للمقاولات (C-0002, 45-day terms, credit limit 120,000, price list `PL-DEMO-2` wholesale), `CUST-DEMO-3` مجموعة الفجر التجارية (C-0003, 15-day terms, credit limit 25,000, price list `PL-DEMO-3` distributor). All active.

**Items** (14% VAT flat) — `ITEM-DEMO-1` أرز أبيض ٥ كجم (180/140 sale/cost), `ITEM-DEMO-2` زيت عباد الشمس ١ لتر (95/72), `ITEM-DEMO-3` سكر أبيض ١ كجم (42/31), `ITEM-DEMO-4` شاي أسود ٥٠٠ جم (260/205), `ITEM-DEMO-5`/`6` configurable tea-blend products, `ITEM-DEMO-7` لبن كامل الدسم ١ لتر (38/27, batch+expiry tracked), `ITEM-DEMO-8` زبادي طبيعي ١٠٠ جم (12/8, batch+expiry tracked).

**Sales invoices** (all confirmed):

| Invoice | Customer | Date / Due | Lines | Subtotal | Tax | Grand total |
|---|---|---|---|---|---|---|
| `INV-DEMO-1` | CUST-DEMO-1 | 2026-08-04 / 2026-09-03 | 40×ITEM-1@180, 120×ITEM-3@42 | 12,240.00 | 1,713.60 | **13,953.60** |
| `INV-DEMO-2` | CUST-DEMO-2 (no salesperson) | 2026-08-11 / 2026-09-25 | 90×ITEM-2@95 | 8,550.00 | 1,197.00 | **9,747.00** |
| `INV-DEMO-3` | CUST-DEMO-3 | 2026-08-18 / 2026-09-02 | 12×ITEM-4@260, 15×ITEM-1@180 | 5,820.00 | 814.80 | **6,634.80** |
| `INV-DEMO-4` | CUST-DEMO-1 | 2026-08-20 / 2026-09-19 | 20×ITEM-4@260 (5,200 gross) | 4,680.00 after SUMMER10 | 655.20 | **5,335.20** |
| `INV-DEMO-5` | CUST-DEMO-1 (EMP-DEMO-2) | 2026-08-20 / 2026-09-19 | 60×ITEM-7@38, 300×ITEM-8@12 | 5,880.00 | 823.20 | **6,703.20** |
| `INV-DEMO-6` | CUST-DEMO-2 | 2026-08-14 / 2026-09-28 | converted from `SQ-DEMO-1` | — | — | ≈ **10,191.60** |

`INV-DEMO-4` crosses `PROMO-DEMO-1`'s (SUMMER10) 2,000 minimum on a scoped item, so it earned an automatic 10% line discount at confirm (`requiresCoupon: false`): 5,200 → 4,680.00 taxable → +655.20 tax → 5,335.20. `INV-DEMO-1` has two confirmed returns against it (`SRT-DEMO-1`, `SRET-DEMO-1`, see below) and one Treasury collection voucher (`VCH-DEMO-1`).

**Sales quotes** — `SQ-DEMO-1` (CUST-DEMO-2, price list PL-DEMO-2, 30×ITEM-1@168 + 100×ITEM-3@39 = 8,940.00 + 1,251.60 tax = **10,191.60**, sent → accepted → converted to `INV-DEMO-6`). `SQ-DEMO-2` (CUST-DEMO-3, price list PL-DEMO-3, 25×ITEM-4@232 = 5,800.00 + 812.00 = **6,612.00**, sent → rejected, expiry 2026-08-29 — not yet expired). `SQ-DEMO-3` (CUST-DEMO-2, price list PL-DEMO-2, 80×ITEM-2@88 = 7,040.00 + 985.60 = **8,025.60**, sent, still pending, expiry 2026-09-18). `SQ-DEMO-4` (CUST-DEMO-1, no price list — retail base prices, 60×ITEM-2@95 + 10×ITEM-4@260 = 8,300.00 + 1,162.00 = **9,462.00**, left as draft, never sent, expiry 2026-09-22).

**Sales returns** — `SRT-DEMO-1` (against `INV-DEMO-1`, item ITEM-3, reason DEFECTIVE, qty 20 of the invoice's original 120, confirmed, value 840.00 + 117.60 tax = 957.60). `SRET-DEMO-1` (against `INV-DEMO-1`, item ITEM-3, reason DEFECTIVE, qty 5, confirmed, value 210.00 + 29.40 = 239.40, seeded in a separate pass before `SRT-DEMO-1`). Together they return **25 of the original 120** units of ITEM-3 on `INV-DEMO-1` — true remaining returnable is **95**, worth **1,197.00** combined. `SRT-DEMO-2` (against `INV-DEMO-3`, item ITEM-4, reason WRONG_ITEM, qty 3 of 12, left as **draft**, never confirmed).

Every confirmed return is *always* "بانتظار دفع المبلغ" by definition — `isAwaitingRefund(doc) = doc.status === "confirmed"` (`packages/domain/src/sales-returns/sales-return-document.ts:88`). There is no further "settled" state in code; the badge never clears except by cancelling. `SRT-DEMO-1` and `SRET-DEMO-1` both carry it permanently as seeded.

**Price lists** — `PL-DEMO-1` (`PL-BASE`, قائمة الأسعار الأساسية, base=true, 4 lines). `PL-DEMO-2` (`PL-WHOLESALE`, قائمة أسعار الجملة, assigned to CUST-DEMO-2). `PL-DEMO-3` (`PL-DIST`, قائمة أسعار الموزعين, assigned to CUST-DEMO-3). `PL-DEMO-4` (`PL-SUMMER25`, عرض الصيف ٢٠٢٥, deactivated via API after creation — inactive, unassigned).

**Promotions** — `PROMO-DEMO-1` (code `SUMMER10`, خصم الصيف ١٠٪, percentage 10%, min invoice value 2,000, scoped to item ITEM-4, 2026-08-19 → 2026-12-31, `requiresCoupon: false`, active). As of 2026-08-24 it is **فعال** (5 days in, >7 days remain — not "قرب الانتهاء" yet).

## Two compounding gaps behind several assertions below

1. **D1** — a confirmed Treasury collection voucher never updates a sales invoice's `amountPaid`. Only the invoice's own **المدفوعات** tab (`POST /sales-invoices/:id/payments`) updates `amountPaid` correctly; it is a separate, working code path. `VCH-DEMO-1` collected ~45% of `INV-DEMO-1`'s outstanding balance through the *voucher* path — so `INV-DEMO-1.amountPaid` reads **0** everywhere despite that collection.
2. **Unreported finding** (not in `docs/defects.md`, cite exactly if you confirm it) — a sales invoice's `remainingBalance` is computed server-side as `grandTotal − amountPaid` only (`packages/api/src/sales-invoices-routes.ts:132-134`); it never subtracts confirmed returns. Combined with D1, `INV-DEMO-1`'s "الرصيد المتبقي" is expected to keep reading the full **13,953.60** everywhere in the Sales Invoices screen, ignoring both its 1,197.00 of confirmed returns and its voucher-recorded collection. If you reproduce this live, record it as a new, distinct defect — do not fold it into D1.

---

## إدارة المبيعات (Sales Hub) — `/sales/hub`

The build differs from the catalog here: in this build `sales-hub` is a normal entry in the sidebar's `sales` nav group (`apps/web/src/nav-config.ts:24`) wired to a real `<a>`/`onClick` row (`packages/ui/src/shell/Sidebar.tsx`), not the dead toggle the catalog describes. Its Arabic label is **نظرة عامة** ("Overview" in English), not "إدارة المبيعات".

**SALES-001** — Sidebar link reaches the hub.
Pre: logged in, sidebar visible, "المبيعات" group expanded.
Steps: Click "نظرة عامة" under المبيعات.
Assert: Navigates to the hub screen (URL/screen key `sales-hub`); this is a real link in this build, unlike the reference product's non-clickable toggle.

**SALES-002** — Header content.
Steps: Load the hub.
Assert: Eyebrow "Sales", title "المبيعات", description mentioning فواتير وعروض أسعار وعملاء المبيعات — من البيانات الفعلية المسجّلة (or current copy) is shown.

**SALES-003** — Quick action "فاتورة مبيعات جديدة".
Steps: Click it.
Assert: Navigates to `/sales/invoices` and opens the "فاتورة مبيعات جديدة" create panel directly (via `useScreenIntent`).

**SALES-004** — Quick action "عرض سعر جديد".
Steps: Click it.
Assert: Navigates to `/sales/quotes` and opens the "عرض سعر جديد" create panel directly.

**SALES-005 / 006 / 007** — Quick actions "قوائم الأسعار" / "العروض والترويج" / "مرتجعات المبيعات".
Steps: Click each in turn.
Assert: Each navigates to its respective list screen (`/sales/price-lists`, `/sales/promotions`, `/sales/returns`) with no panel pre-opened.

**SALES-008** `[NOT IMPLEMENTED]` — No "عميل جديد" quick action.
Steps: Look at the quick-actions row.
Assert: Only 5 buttons exist (فاتورة مبيعات جديدة / عرض سعر جديد / قوائم الأسعار / العروض والترويج / مرتجعات المبيعات); the catalog's third quick-start button, "عميل جديد", does not exist anywhere on this page.

**SALES-009** — Stat card "فواتير المبيعات".
Pre: seed loaded (6 sales invoices total, including `INV-DEMO-6`).
Assert: Card reads 6.

**SALES-010** — Stat card "مبالغ مستحقة من العملاء".
Assert: Sums `remainingBalance` across confirmed/partially_paid invoices — since D1 means no invoice ever reaches partially_paid via a voucher, and `remainingBalance` never subtracts returns (see compounding-gaps note), this figure equals the plain sum of all 6 invoices' grand totals, not a true net-outstanding figure.

**SALES-011** — Stat card "عروض أسعار قيد الإرسال".
Assert: Counts quotes with `status === "sent"` only. `SQ-DEMO-1` converted, `SQ-DEMO-2` rejected, `SQ-DEMO-4` still draft — only `SQ-DEMO-3` is currently "sent", so the card reads **1**.

**SALES-012** — Stat card "عدد العملاء".
Assert: Reads 3.

**SALES-013** — "أحدث فواتير المبيعات" recent-activity list.
Assert: Shows the 5 most recent invoices by date descending (excludes the oldest of the 6, `INV-DEMO-1`, dated 2026-08-04), each row = customer name + date + docNo + Money total. No status pill per row (gap vs catalog).

**SALES-014** `[NOT IMPLEMENTED]` — No "مناطق العمل" tile grid.
Assert: There is no per-domain tile grid with individual links (فواتير المبيعات / عروض الأسعار / العملاء / مرتجعات المبيعات / قوائم الأسعار tiles, each with its own count and "عرض" link) — replaced entirely by the flat 4-card StatCard row above.

**SALES-015** `[NOT IMPLEMENTED]` — No quotes recent-activity sub-list, no "عرض الكل" links.
Assert: The catalog's second sub-list ("آخر العروض") does not exist; neither recent-activity block has a "عرض الكل" link anywhere on the page.

**SALES-016** `[NOT IMPLEMENTED]` — No conditional overdue-invoices attention banner.
Assert: Only a generic query-error card exists ("تعذّر تحميل بيانات المبيعات."); there is no banner that counts and deep-links overdue invoices.

**SALES-017** — Load-error state.
Pre: force one of the hub's queries to fail (e.g. simulate offline/network failure).
Steps: Load the hub.
Assert: "تعذّر تحميل بيانات المبيعات." card renders in place of the failed section.

**SALES-018** — Run in English/LTR.
Steps: Toggle the language switch in the top bar while on the hub.
Assert: Layout mirrors to LTR, all labels re-render in English, digits render in Latin numerals, no layout overflow/clipping.

---

## العملاء (Customers) — `/sales/customers`

**SALES-019** — Status chip "الكل".
Pre: 3 seeded customers, all active.
Steps: Open `/sales/customers`.
Assert: "الكل" chip reads 3 and all 3 rows show.

**SALES-020** — Status chip "نشط".
Steps: Click "نشط".
Assert: Count and rows both = 3 (every seeded customer is active).

**SALES-021** — Status chip "غير نشط" on an empty match.
Steps: Click "غير نشط".
Assert: Count = 0, table renders the empty state "لا يوجد عملاء مطابقون".

**SALES-022** `[NOT IMPLEMENTED]` — No "عملاء برصيد مستحق" chip or clickable KPI-filter behavior.
Assert: Only 3 status chips exist total (الكل/نشط/غير نشط); none of the 4 stat cards are clickable filters.

**SALES-023 / 024 / 025 / 026** — KPI strip values.
Assert: "إجمالي العملاء" = 3; "نشط" = 3; "إجمالي حدود الائتمان" = 50,000.00 + 120,000.00 + 25,000.00 = **195,000.00**; "إجمالي الأرصدة الافتتاحية" = sum of seeded opening balances (0.00, since none are set in the base seed). All four are static `StatCard`s — clicking does nothing (gap vs catalog's clickable KPI strip).

**SALES-027** — Search by name.
Steps: Type "الأمل" in the search box.
Assert: Only `CUST-DEMO-1` (شركة الأمل للتجارة) shows.

**SALES-028** — Search by code.
Steps: Type "C-0002".
Assert: Only `CUST-DEMO-2` shows (case-insensitive code match).

**SALES-029** — Search by phone.
Steps: Type "01223334455" (CUST-DEMO-3's phone).
Assert: Only `CUST-DEMO-3` shows.

**SALES-030** — Search with no match.
Steps: Type nonsense, e.g. "زذخيوب".
Assert: Empty state "لا يوجد عملاء مطابقون" shows.

**SALES-031** `[NOT IMPLEMENTED]` — No "تصفية النتائج" filter panel.
Assert: No phone / credit-limit-range / balance-range filter fields exist anywhere on this screen.

**SALES-032** — Column sort.
Steps: Click any column header (اسم العميل, الحد الائتماني, etc.).
Assert: Nothing happens — no column on this screen is sortable (the shared `sortable` flag is set on none of the 7 columns), unlike the catalog's implied sortable columns.

**SALES-033** — Pagination summary.
Steps: Observe the footer with all 3 customers loaded.
Assert: Reads "عرض 3 من 3 عميل" — not the catalog's "عرض 1 - N من N" range format — and there is no page-size selector; `page`/`pageCount` are hardcoded to 1/1 so the pager UI never renders even if more customers existed.

**SALES-034** — Row click opens detail.
Steps: Click the `CUST-DEMO-1` row.
Assert: Screen swaps in-place to the detail view (no separate URL/route change observed), header title "شركة الأمل للتجارة · C-0001", status pill "نشط".

**SALES-035** `[NOT IMPLEMENTED]` — No row action menu.
Assert: No per-row ⋮ menu or quick action exists on any row; only the whole row is clickable.

**SALES-036** — Open "إضافة عميل" dialog and check defaults.
Steps: Click the list's create button.
Assert: Dialog opens with الكود placeholder "تلقائي إذا فارغ", شروط الدفع (أيام) = 30, العملة = "EGP", الحد الائتماني = 0, نوع المشتري (ETA) = "تلقائي (منشأة إذا وُجد رقم ضريبي، وإلا فرد)"; إعفاء ضريبي off.

**SALES-037** — Required-field rejection.
Steps: Leave اسم العميل blank, click إضافة عميل.
Assert: Blocked; inline error "الاسم بالعربية مطلوب" shows; dialog stays open. This is the *only* client-validated required field on the whole form.

**SALES-038** — Auto-generated code, persists on reload.
Steps: Fill only اسم العميل ("عميل اختبار ١"), leave الكود blank, save.
Assert: New customer created with an auto-generated code following the pattern `C` + zero-padded sequential count (e.g. `C000004` as the 4th customer). Reload the list — the new customer and its generated code both persist.

**SALES-039 / 040** — Negative numeric fields rejected.
Steps: In the create dialog, try to set شروط الدفع (أيام) and separately الحد الائتماني to a negative value.
Assert: Both `NumberField`s carry `min={0}` — a negative value cannot be entered/committed in either.

**SALES-041** — Very large credit limit accepted.
Steps: Set الحد الائتماني to 999,999,999, save.
Assert: Saves successfully (no max); reload — the value persists exactly.

**SALES-042** — Phone accepts free text (no validation).
Steps: Enter non-numeric text in الهاتف (e.g. "abc-not-a-phone"), save.
Assert: Saves without error — no format/regex validation exists, and there is no country-code selector at all (gap vs catalog's +20-default phone control).

**SALES-043** — Email accepts an invalid string.
Steps: Enter "not-an-email" in البريد الإلكتروني, save.
Assert: Only the browser's native `type=email` hint applies (not app-enforced) — the app itself does not block save on a malformed address.

**SALES-044** `[NOT IMPLEMENTED]` — التصنيف is free text, not a dropdown with quick-add.
Steps: Inspect the التصنيف field.
Assert: It is a plain `TextField`, not the catalog's dropdown + inline "تصنيف جديد" quick-add.

**SALES-045** `[NOT IMPLEMENTED]` — قائمة الأسعار is a raw free-text ID field, not a search/select.
Steps: Inspect the قائمة الأسعار field; type an arbitrary string like "not-a-real-id".
Assert: Field accepts any text with no lookup/validation against real price lists — a typo here would silently fail to resolve pricing later with no warning at save time.

**SALES-046** `[NOT IMPLEMENTED]` — No logo upload, no "خيارات متقدمة" section.
Assert: There is no الشعار upload control anywhere; every "advanced" field from the catalog (phone, email, tax number, ETA buyer type, national ID, tax exempt, contact person, notes) is flat and always visible — no collapsible section exists.

**SALES-047** — Tax-exempt toggle persists.
Steps: In create, toggle إعفاء ضريبي on, save, reload, open the new customer's نظرة عامة tab.
Assert: إعفاء ضريبي reads "نعم" after reload.

**SALES-048** — Cancel discards.
Steps: Fill several fields, click إلغاء.
Assert: Dialog closes, no customer created, list unchanged, count of customers unchanged from before the dialog opened.

**SALES-049** — Code is locked on edit.
Steps: Open `CUST-DEMO-1` → تعديل, try to change الكود.
Assert: The field is disabled — the code cannot be changed once a customer exists.

**SALES-050** — Only way to deactivate a customer.
Steps: Edit `CUST-DEMO-1`, toggle نشط off, save, reload.
Assert: Status pill flips to "غير نشط"; the customer now counts under the "غير نشط" chip. This toggle in the edit dialog is the *only* deactivation path — there is no "المزيد" menu with a standalone "تعطيل" action anywhere (gap vs catalog). Toggle it back on afterward to avoid polluting later scenarios.

**SALES-051** — Edit persists after reload.
Steps: Edit `CUST-DEMO-2`, change شروط الدفع from 45 to 60, save, reload the detail page.
Assert: شروط الدفع summary card reads "60 يوم".

**SALES-052** `[NOT IMPLEMENTED]` — Detail header actions.
Steps: Open any customer's detail page.
Assert: Header shows only تعديل and رجوع لقائمة العملاء buttons. There is no إنشاء فاتورة button and no "المزيد" menu (so no نظرة 360°, تعطيل-via-menu, or دمج مع عميل آخر anywhere).

**SALES-053** — Summary cards, CUST-DEMO-2.
Steps: Open `CUST-DEMO-2`.
Assert: 6 cards show: التصنيف (بدون تصنيف), شروط الدفع (45 يوم), الحد الائتماني (120,000.00), الرصيد الافتتاحي, متبقي من الحد (= creditLimit − openingBalance, danger tone only if negative), نوع المشتري (ETA).

**SALES-054** `[NOT IMPLEMENTED]` — No quick-actions row.
Assert: The catalog's إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد / كشف حساب quick-action button row does not exist; كشف حساب is reachable only via its own tab.

**SALES-055** — نظرة عامة tab.
Steps: Open the نظرة عامة tab on `CUST-DEMO-3`.
Assert: Read-only 2-column grid: الهاتف, البريد الإلكتروني, جهة الاتصال, الرقم الضريبي, الرقم القومي, العملة, إعفاء ضريبي (لا), قائمة الأسعار (شows "قائمة أسعار الموزعين"). Any empty field falls back to "لا يوجد".

**SALES-056** — الفواتير tab shows D1's effect.
Pre: `CUST-DEMO-1` has invoices `INV-DEMO-1`, `INV-DEMO-4`, `INV-DEMO-5`.
Steps: Open `CUST-DEMO-1` → الفواتير tab.
Assert: All 3 invoices list with رقم الفاتورة/التاريخ/الاستحقاق/الحالة/الإجمالي/المحصّل/المتبقي. `INV-DEMO-1`'s المحصّل reads **0** despite `VCH-DEMO-1` having collected against it via a Treasury voucher — this is D1.

**SALES-057** `[NOT IMPLEMENTED]` — الفواتير tab has no strikethrough/actions.
Assert: No strikethrough original-vs-remaining display, and no per-row تحصيل button or menu exists in this tab (gap vs catalog).

**SALES-058** — كشف حساب tab reconciles.
Steps: Open `CUST-DEMO-1` → كشف حساب.
Assert: Shows an opening-balance row plus a running ledger (التاريخ/الحركة/المرجع/مدين/دائن/الرصيد) that includes `INV-DEMO-1`'s original charge and both its confirmed returns (`SRT-DEMO-1`, `SRET-DEMO-1`) as credit lines. The reconciliation pill reads "مطابق لتقرير أعمار الديون" (matches `/reports/aging/customers`) — this tab, unlike the invoice's own remainingBalance field, does account for returns.

**SALES-059** — الفواتير tab empty state.
Pre: create a brand-new customer with zero invoices.
Steps: Open its الفواتير tab.
Assert: "لا توجد فواتير مبيعات مسجّلة لهذا العميل" + explanatory body text ("أول فاتورة تُصدر لهذا العميل من شاشة «فواتير المبيعات» ستظهر هنا فور حفظها.").

**SALES-060** `[NOT IMPLEMENTED]` — Missing tabs.
Assert: Only 3 tabs exist (نظرة عامة / الفواتير / كشف حساب). الأقساط, المرتجعات, نقاط الولاء, المرفقات, سجل المراجعة from the catalog do not exist — the code explicitly comments that there is no attachments tab because there is no file-storage subsystem at all.

**SALES-061** `[NOT IMPLEMENTED]` — No customer categories dialog.
Assert: Nothing on the list screen manages التصنيف as a first-class entity (no "تصنيفات العملاء" dialog, no category CRUD, no empty state for it) — التصنيف is purely a free-text field per customer.

**SALES-062** — List load error + retry.
Steps: Force the customers query to fail (e.g. offline), reload the screen.
Assert: "تعذّر تحميل العملاء." card + "إعادة المحاولة" button; clicking retry re-issues the query.

**SALES-063** — Run in English/LTR.
Steps: Toggle language while on the list, the add dialog, and a customer's detail page.
Assert: Labels flip to English, layout mirrors LTR, numeric values render in Latin digits, no clipped/overflowing controls.

---

## فواتير المبيعات (Sales Invoices) — `/sales/invoices`

**SALES-064** — Status chip "الكل".
Pre: 6 confirmed sales invoices seeded.
Assert: Count = 6, all 6 rows list.

**SALES-065 / 066 / 067 / 068** — Remaining status chips.
Assert: "مسودة" = 0 (nothing seeded as draft); "مؤكد" = 6 (every seeded invoice is confirmed and, per D1, none can reach partially_paid via the voucher path); "مدفوع جزئياً" = 0; "مدفوع" = 0; "ملغي" = 0.

**SALES-069** `[NOT IMPLEMENTED]` — No "مفتوح" or "متأخر" status chips.
Assert: Only 6 chips exist (الكل/مسودة/مؤكد/مدفوع جزئياً/مدفوع/ملغي); the catalog's مفتوح and متأخر chips are absent.

**SALES-070** — KPI "إجمالي الفواتير".
Assert: Reads 6, matching the list's total row count.

**SALES-071** — KPI "إجمالي المبيعات".
Assert: Equals the sum of all 6 grand totals: 13,953.60 + 9,747.00 + 6,634.80 + 5,335.20 + 6,703.20 + ≈10,191.60 ≈ **52,565.40**.

**SALES-072** — KPI "إجمالي المحصل" exposes D1.
Assert: Reads **0.00** — sums `amountPaid` across invoices, and D1 means `VCH-DEMO-1`'s collection against `INV-DEMO-1` never lands in that field.

**SALES-073** — KPI "إجمالي المتبقي".
Assert: Danger tone (>0); equals the same figure as SALES-071 (≈52,565.40), since `amountPaid` reads 0 everywhere — cross-check the two KPI values match exactly.

**SALES-074** `[NOT IMPLEMENTED]` — No إجمالي المرتجع or دفعات غير مخصصة KPI cards.
Assert: Only 4 KPI cards exist total (إجمالي الفواتير/إجمالي المبيعات/إجمالي المحصل/إجمالي المتبقي).

**SALES-075** `[NOT IMPLEMENTED]` — No import action, no overdue-follow-up banner.
Assert: Header shows only "فاتورة جديدة"; there is no "استيراد فواتير سابقة" button and no "تحتاج متابعة" banner anywhere on the list.

**SALES-076** — List columns.
Steps: Inspect a row, e.g. `INV-DEMO-3`.
Assert: رقم الفاتورة column shows docNo with customer name + date as subtext; تاريخ الاستحقاق shows the raw date only (no overdue badge yet, since no seeded invoice is currently overdue); الرصيد المتبقي column has a footer total row summing all visible rows; الحالة shows a StatusPill. No "بواسطة" column exists (gap).

**SALES-077** — Search by docNo.
Steps: Type "INV-DEMO-2" in the search box.
Assert: Exactly one row, case-insensitive match on docNo.

**SALES-078** — Search by customer name.
Steps: Type "الأمل".
Assert: Returns `INV-DEMO-1`, `INV-DEMO-4`, `INV-DEMO-5` (all CUST-DEMO-1's invoices) — note the match on customer name is case-sensitive substring (Arabic has no case, but confirm a partial word like "الأم" still matches, since it's `.includes`, not full-word).

**SALES-079** — Search with no match.
Steps: Type "zzz-nonexistent".
Assert: No rows / empty state.

**SALES-080** `[NOT IMPLEMENTED]` — No filters panel.
Assert: No تصفية بالعميل, من/إلى تاريخ, المستودع, or مصدر الفاتورة filter exists anywhere on this screen.

**SALES-081** — Dead sort affordance.
Steps: Click the رقم الفاتورة column header (it shows a ⇅ sort icon).
Assert: Nothing happens — no rows reorder. The icon implies sortability but `sort`/`onSortChange` are never wired; this is a more misleading gap than "no sort exists at all" since the UI visually promises it.

**SALES-082** — Pagination.
Steps: Observe the footer with all 6 invoices loaded.
Assert: All 6 show on a single page; no page-size selector; `page`/`pageCount` are hardcoded 1/1.

**SALES-083** — Row click opens full detail, no quick-view panel.
Steps: Click the `INV-DEMO-1` row.
Assert: The whole screen swaps in-place to the invoice detail view — there is no slide-out quick-view side panel and therefore no "فتح في صفحة كاملة" link (gap vs catalog, which describes a two-step reveal).

**SALES-084** `[NOT IMPLEMENTED]` — No row-level quick actions.
Assert: No تحصيل quick button and no ⋮ row menu exists on any row.

**SALES-085** — Create form is a panel, not a routed page.
Steps: Click "فاتورة جديدة".
Assert: Opens a SidePanel titled "فاتورة مبيعات جديدة" in place — there is no `/sales/invoices/new` URL/route change.

**SALES-086** `[NOT IMPLEMENTED]` — No manual-vs-from-quote toggle.
Assert: This form has no "طريقة الإنشاء" toggle; converting a quote into an invoice happens entirely from the quote's own detail panel (see the Quotes section), not from here.

**SALES-087** — Required customer field.
Steps: Leave العميل unselected, click تأكيد الفاتورة (or حفظ كمسودة).
Assert: Blocked, banner "العميل مطلوب."

**SALES-088** — Create, confirm, and reload — full persistence check.
Steps: Select العميل = CUST-DEMO-3, keep defaults for التاريخ/تاريخ الاستحقاق/المستودع, add one line (item `ITEM-DEMO-1`, qty 5, price auto-fills 180), click تأكيد الفاتورة.
Assert: A new confirmed invoice appears in the list. Reload the page and reopen it fresh from the list — customer, date, line item, qty, price, and computed totals (subtotal 900.00, tax 126.00, grand total 1,026.00) all match exactly what was entered.

**SALES-089** — المستودع is not client-gated despite being required.
Pre: at least one warehouse exists (normal seed state).
Steps: Open the create form; note المستودع has no asterisk in its label though the domain requires it.
Assert: `canSubmit` does not include `warehouseId` in its gate — if the warehouses list were ever empty, both buttons would stay enabled and clicking تأكيد would surface a server-side error banner ("المستودع مطلوب.") instead of being blocked client-side like العميل is.

**SALES-090** `[NOT IMPLEMENTED]` — No الفرع field.
Steps: Inspect the create form for a branch selector.
Assert: None exists — branch is hardcoded to `"MAIN"` in code; the catalog's required الفرع field is entirely absent from the UI.

**SALES-091** — مندوب المبيعات is optional and not in the catalog.
Steps: Leave مندوب المبيعات unselected, save.
Assert: Saves fine (optional field); this field itself is extra vs. the catalog, which describes no salesperson field on the new-invoice form.

**SALES-092** — Item line auto-fills price.
Steps: Add a line, pick item `ITEM-DEMO-4` via the picker.
Assert: سعر الوحدة auto-fills to 260 (the item's `salePrice`) — no manual entry needed, though it remains editable.

**SALES-093** — Qty rejects negative (client-clamped).
Steps: In a line's الكمية field, try to type a negative number, then blur the field.
Assert: `QtyInput` clamps negative values to 0 on blur — negative quantities cannot persist in the field.

**SALES-094** — Unit price accepts negative (client) but is rejected server-side.
Steps: In a line's سعر الوحدة field, type a negative value (e.g. -50), attempt to save.
Assert: The `MoneyInput` has no client-side minimum — the negative value IS typeable and submittable. The save then fails with a server-side error banner: "السعر لا يقبل قيمة سالبة." This is a real negative-path gap: invalid input surfaces as a banner after a round trip, not blocked at the field like قty is.

**SALES-095** — Cannot delete the last line.
Steps: With only one line remaining, try to delete it.
Assert: The row's delete (✕) button is disabled when exactly one line remains.

**SALES-096** — Confirming with zero valid lines is blocked (client).
Steps: Remove all meaningful content so no line has both a valid item and a positive qty/price yielding a grand total > 0 (e.g. a single line at qty 0).
Assert: Both حفظ كمسودة and تأكيد الفاتورة stay disabled — `canSubmit` requires at least one valid line AND `grandTotal > 0`.

**SALES-097** — Confirming with zero lines is also blocked server-side.
Pre: hypothetically bypass the client gate (e.g. via direct API call) with an empty `lines` array.
Assert: Server throws `InvalidSalesInvoiceError` — "الفاتورة تتطلب بنداً واحداً على الأقل." — a defense-in-depth check behind the disabled buttons.

**SALES-098** — Invoice-level discount, percent type capped.
Steps: Set نوع الخصم = نسبة %, try to enter a value above 100.
Assert: `max={100}` on the field for percent type — cannot exceed 100.

**SALES-099** — Invoice-level discount, amount type uncapped.
Steps: Set نوع الخصم = مبلغ, enter an amount larger than the invoice's subtotal.
Assert: No client-side ceiling exists for amount-type discounts (only `min={0}`) — the field accepts a discount larger than the subtotal; verify what the resulting total does (whether it floors at zero or goes negative) and record any unexpected total as a new finding.

**SALES-100** — Coupon code has no preview/apply step.
Steps: Type a coupon code (real or fake) in كود الكوبون.
Assert: There is no "تطبيق الكوبون" button (gap vs catalog) — the code is only evaluated server-side at confirm time; no discount preview appears before confirming.

**SALES-101** `[NOT IMPLEMENTED]` — No ملاحظات / ملاحظات داخلية fields.
Steps: Inspect the create form for notes fields.
Assert: Neither exists in the UI, even though the domain model supports both — `handleSave` never sends them.

**SALES-102** `[NOT IMPLEMENTED]` — No attachments uploader, no price-list selector.
Assert: Neither المرفقات nor قائمة الأسعار exists on this form; item sale price is pulled straight from the item record with no price-list resolution UI.

**SALES-103** `[NOT IMPLEMENTED]` — No "unsaved changes" pill.
Assert: The catalog's "التغييرات غير المحفوظة" status indicator does not exist anywhere in this panel.

**SALES-104** — Form silently resets on a background refetch.
Pre: open the create panel and start filling it in (customer, lines) without saving.
Steps: Trigger a warehouses refetch in the background (e.g. focus/blur the browser tab, or wait for any automatic refetch window) while the panel stays open.
Assert: `resetForm()` re-runs on every change to the warehouses query's data reference (`useEffect` dep `[open, warehouses]`), which is a new array on every refetch — the entire in-progress form (customer, lines, discount) can silently clear. This is a genuine regression-worthy edge case: reproduce it and note whether data was actually lost.

**SALES-105** — Detail header, no المزيد menu.
Steps: Open `INV-DEMO-2`'s detail.
Assert: Header shows only a "رجوع" action — no مشاركة, no header-level تحصيل دفعة button, and no "المزيد" menu at all (so no print, ETA export, installment-plan creation, or create-return shortcut from here).

**SALES-106** — No way to cancel a saved invoice.
Steps: Look for any cancel action on any confirmed invoice's detail page.
Assert: None exists in the UI. (The domain's `cancel()` only applies to draft/pending invoices anyway — confirmed invoices are only ever correctable through a return — but even for a draft, there is no UI trigger to cancel it once you've navigated away from the create panel.)

**SALES-107** — Effects explainer exists (simplified).
Steps: Open any confirmed invoice's detail.
Assert: A "تأثيرات هذه الفاتورة" block with 2 bullet lines is present — a static draft-vs-posted effects note plus "الرصيد المتبقي على العميل: {value}" — simpler than the catalog's itemized breakdown but present.

**SALES-108** — بنود الفاتورة tab, missing columns.
Steps: Open `INV-DEMO-1`'s بنود الفاتورة tab.
Assert: 6 columns only (الصنف, الكمية, السعر, الخصم %, الضريبة, الإجمالي) — no التكلفة or الربح columns, and the footer shows only "الإجمالي الكلي" — none of المجموع الفرعي / الخصم / إجمالي التكلفة / الربح / هامش الربح % / خصم المرتجعات المؤكدة / الصافي بعد المرتجعات from the catalog.

**SALES-109** — القيود المحاسبية tab.
Steps: Open any confirmed invoice's GL tab.
Assert: Shows the posted journal entry number and an account/مدين/دائن table.

**SALES-110** — المدفوعات tab records a payment correctly (unaffected by D1).
Pre: `INV-DEMO-2` (grand total 9,747.00, `amountPaid` 0).
Steps: Open المدفوعات tab, enter a partial payment (e.g. 3,000.00), submit.
Assert: `amountPaid` updates to 3,000.00, remaining balance drops to 6,747.00, status flips to "مدفوع جزئياً" — reload the invoice and confirm all three persist. This path is genuinely unaffected by D1 (it's the invoice's own `recordPayment`, distinct from the Treasury-voucher path D1 breaks).

**SALES-111** — Payment amount validation.
Steps: In the payments tab, try to submit 0 or a negative amount.
Assert: Client error "قيمة الدفعة يجب أن تكون أكبر من صفر."; try an amount larger than the remaining balance — domain rejects with "الدفعة تتجاوز الرصيد المتبقي للفاتورة."

**SALES-112** — Payments tab blocked state.
Pre: a draft invoice, if one can be created (client gate normally blocks saving drafts with 0 total, but a draft with a valid line can exist — check by saving as draft rather than confirming).
Steps: Open its المدفوعات tab.
Assert: "لا يمكن تسجيل دفعة في حالة الفاتورة الحالية." message shows instead of the payment form.

**SALES-113** `[NOT IMPLEMENTED]` — Missing detail tabs.
Assert: Only 3 tabs exist (بنود الفاتورة / القيود المحاسبية / المدفوعات). المرتجعات, الأقساط, الفاتورة الإلكترونية (ETA), المرفقات, سجل المراجعة from the catalog are all absent.

**SALES-114** `[NOT IMPLEMENTED]` — No tax-exempt banner.
Pre: mark a customer إعفاء ضريبي = true (e.g. via the Customers edit dialog), then create an invoice for them.
Steps: Open the resulting invoice's create form and detail.
Assert: Lines silently get `taxRatePercent = 0` (verify tax total is 0), but no "معفى من الضريبة" banner appears anywhere — the exemption is invisible in the UI aside from the tax column reading 0%.

**SALES-115** — D1 and the remaining-balance compounding gap, precisely.
Pre: `INV-DEMO-1` — grand total 13,953.60, two confirmed returns worth 1,197.00, one Treasury voucher (`VCH-DEMO-1`) collecting ~45% of its true outstanding balance.
Steps: Open `INV-DEMO-1`'s detail page and read "الرصيد المتبقي".
Assert: Per `remainingBalance = grandTotal − amountPaid` (`packages/api/src/sales-invoices-routes.ts:132-134`) and D1 (`amountPaid` stuck at 0 via the voucher path), expect the field to still read the full **13,953.60** — reflecting neither the 1,197.00 of confirmed returns nor the voucher's collection. If reproduced, log this precisely as a new defect separate from D1 (cite this file/line), not a duplicate.

**SALES-116** — Status pill for a manually forced-overdue invoice.
Pre: create a new invoice with تاريخ الاستحقاق set to a past date (e.g. 2026-08-01), confirm it.
Steps: Return to the list.
Assert: The list's متأخر flag appears as a plain danger "متأخر" pill next to the due date with **no day count** (gap vs catalog's "متأخر N يوم" badge); the invoice does not show under any "متأخر" chip since none exists (see SALES-069).

**SALES-117** — Discount and coupon interplay on a real seeded example.
Pre: `INV-DEMO-4` — grand total 5,335.20, earned SUMMER10's 10% discount automatically at confirm (no coupon needed, `requiresCoupon: false`).
Steps: Open `INV-DEMO-4`'s detail.
Assert: تفاصيل line/footer reflect the discounted total; confirm the applied-promotion summary field (شown conditionally per the code) displays "العرض المطبَّق" and "خصم العرض" for this invoice.

**SALES-118** — Run in English/LTR.
Steps: Toggle language on the list, create form, and an invoice detail page.
Assert: Labels flip, RTL→LTR mirrors correctly (line-item table column order, totals alignment), digits render Latin.

---

## عروض الأسعار (Sales Quotes) — `/sales/quotes`

Everything on this screen is inline panels on the list — there is no `/sales/quotes/new` or `/sales/quotes/{id}` route; row click opens a quick-view SidePanel that also hosts every status-transition action.

**SALES-119** — Status chip "الكل".
Pre: 4 seeded quotes.
Assert: Count = 4, all list.

**SALES-120 / 121 / 122 / 123** — Remaining chips.
Assert: "مسودة" = 1 (`SQ-DEMO-4`); "مرسل" = 1 (`SQ-DEMO-3`); "مقبول" = 0 (`SQ-DEMO-1` already converted past "accepted"); "مرفوض" = 1 (`SQ-DEMO-2`); "محول" = 1 (`SQ-DEMO-1`).

**SALES-124** `[NOT IMPLEMENTED]` — No "ملغي" chip.
Assert: Though `cancelled` is a valid status value in code (`STATUS_LABEL`/`STATUS_TONE`), no chip for it exists and no button anywhere can reach it — dead status in this screen.

**SALES-125** — KPI cards are counts, not values.
Assert: "إجمالي العروض" = 4, "مقبولة" = 0 (matches السالس-122's count, not a money value), "محولة" = 1 — all three are plain counts, contradicting the catalog's money-valued KPI cards (إجمالي قيمة العروض, قيمة المقبولة, قيمة المحولة).

**SALES-126** — Header action.
Steps: Click "عرض سعر جديد".
Assert: Opens the create SidePanel titled "عرض سعر جديد" in place (no route change).

**SALES-127** — List columns.
Steps: Inspect the `SQ-DEMO-3` row.
Assert: رقم العرض shows docNo + customer name subtext; تاريخ الانتهاء shows the plain expiry date with **no** "انتهت منذ N يوم" badge (gap — expiry is never flagged at all in this screen, even for an actually-expired quote); الإجمالي shows the MoneyDisplay grand total (8,025.60); الحالة shows the status pill. No بواسطة column, no row action button/menu.

**SALES-128** `[NOT IMPLEMENTED]` — No filters, no search.
Assert: No تصفية بالعميل or تصفية بالتاريخ (من/إلى) fields exist anywhere; there is also no search box at all on this screen (unlike Customers/Invoices, which at least have one).

**SALES-129** — No sort, fake pagination.
Assert: No column is sortable; `page`/`pageCount` hardcoded 1/1, all rows show at once.

**SALES-130** — Required customer on create.
Steps: In "عرض سعر جديد", leave العميل on the blank "اختر عميلاً" option, click حفظ كمسودة.
Assert: Blocked, error "اختر عميلاً."

**SALES-131** — Cannot save with zero valid lines.
Steps: Clear the single default line's اسم الصنف (leave blank) or set الكمية to 0, click حفظ كمسودة.
Assert: Blocked, error "أضف بنداً واحداً على الأقل باسم صنف وكمية أكبر من صفر."

**SALES-132** — Item field is free text, not a real item picker — persistence check.
Steps: Create a quote for CUST-DEMO-3, type "صنف تجريبي" as اسم الصنف (not a real catalog item name), qty 2, unit price 100, save.
Assert: Saves successfully — this screen never resolves a real inventory item; the line's `itemId` is a locally-generated placeholder (`ITEM-{seq}`), not a real catalog item ID like `ITEM-DEMO-1`. Reload the quotes list and reopen the new quote — the typed name/qty/price persist even though they reference no real item. This is a meaningful gap: quotes created through this UI are not tied to real inventory the way invoices are (invoices use a real `EntityPicker`).

**SALES-133** `[NOT IMPLEMENTED]` — Missing fields on the create form.
Assert: No الفرع selector (hardcoded `branchId: "BR1"`), no العملة field, no discount-type dropdown, no ملاحظات/ملاحظات داخلية, no قائمة الأسعار, no attachments uploader — all present in the catalog, none in this build.

**SALES-134** — Negative/zero qty and price on lines.
Steps: Try to set الكمية or سعر الوحدة to a negative number on a line.
Assert: Both `NumberField`s carry `min={0}` — negative values cannot be entered.

**SALES-135** — Cannot delete the last line.
Steps: With one line, click حذف.
Assert: Disabled when `lines.length === 1`.

**SALES-136** — Create only ever saves as draft.
Steps: Fill a valid quote, look for a "send" or "confirm" action in the create panel.
Assert: Only إلغاء and حفظ كمسودة exist — there is no combined save-and-send action; every new quote starts as مسودة regardless.

**SALES-137** — Detail quick-view panel, missing catalog features.
Steps: Click the `SQ-DEMO-3` row.
Assert: Opens a SidePanel with status pill, customer name, expiry date, a flat list of line items (name, qty × unit price), and grand total. No status-explainer banner text, no 4-step visual progress stepper, no "ما الذي سيحدث؟" explainer block, and no tabs (تفاصيل العرض / المرفقات / السجل) exist — all gaps vs catalog.

**SALES-138** — draft → send transition.
Pre: `SQ-DEMO-4` is draft.
Steps: Open it, click "إرسال للعميل".
Assert: Status flips to "مرسل"; reload the list — the quote now shows under the "مرسل" chip and its count increments.

**SALES-139** — sent → accept transition.
Pre: after SALES-138, `SQ-DEMO-4` is now sent (or use `SQ-DEMO-3`, already sent).
Steps: Open it, click "قبول العميل".
Assert: Status flips to "مقبول"; the convert-to-invoice sub-form appears in its place.

**SALES-140** — sent → reject transition.
Pre: create/use a sent quote you don't need for later scenarios.
Steps: Click "رفض".
Assert: Status flips to "مرفوض"; reopen the panel — no action buttons render at all for a rejected quote (falls through every conditional), matching the catalog's terminal state but with no explanatory text.

**SALES-141** — Convert requires a warehouse.
Pre: an accepted quote (from SALES-139).
Steps: In the convert sub-form, leave المستودع * blank, click "إنشاء الفاتورة".
Assert: Blocked, error "أدخل المستودع." — this field is a plain free-text TextField (placeholder "WH1"), not a warehouse picker (gap).

**SALES-142** — Convert succeeds and creates a real invoice.
Pre: same accepted quote.
Steps: Enter a real warehouse ID, click "إنشاء الفاتورة".
Assert: Status flips to "محول"; a success banner "تم تحويل هذا العرض إلى فاتورة مبيعات." replaces the convert form; navigate to `/sales/invoices` and confirm a new confirmed invoice now exists referencing this quote's lines.

**SALES-143** — Converting twice is blocked by UI absence, not an error message.
Pre: the now-converted quote from SALES-142.
Steps: Reopen it.
Assert: Only the static success banner shows — no convert form, no button of any kind — so a second conversion is simply unreachable through the UI (no explicit "already converted" error is ever shown, because the action never becomes available again).

**SALES-144** — Using the real seeded example, `SQ-DEMO-1`.
Pre: `SQ-DEMO-1` — sent → accepted → converted to `INV-DEMO-6`, grand total 10,191.60.
Steps: Open `SQ-DEMO-1`.
Assert: Status "محول", success banner shown, line items still visible (30×ITEM-1, 100×ITEM-3), no action buttons.

**SALES-145** — Rejected quote, `SQ-DEMO-2`, no path forward.
Pre: `SQ-DEMO-2` — sent → rejected.
Steps: Open it.
Assert: Status pill "مرفوض", line items and total visible, but no button/message of any kind below them (matches SALES-140's finding).

**SALES-146** `[NOT IMPLEMENTED]` — No "المزيد" menu.
Assert: No print or delete action exists anywhere on this screen, despite the catalog describing both under a "المزيد" menu.

**SALES-147** — Draft quote, `SQ-DEMO-4`, before any transition.
Pre: fresh seed, `SQ-DEMO-4` still draft (do this scenario before SALES-138 consumes it, or create a new draft quote instead).
Steps: Open it.
Assert: Status "مسودة", only "إرسال للعميل" button shown.

**SALES-148** — Expiry is never flagged, even for a genuinely expired quote.
Pre: create a quote with تاريخ الانتهاء set to a past date (e.g. 2026-08-01), leave it as draft or send it.
Steps: Observe the list row and the detail panel.
Assert: Neither shows any "expired"/"منتهي" indicator — the catalog's "انتهت منذ N يوم" badge and 4th status ("منتهي") do not exist in code at all; an expired quote looks identical to a non-expired one everywhere in this UI.

**SALES-149** — `useScreenIntent` deep-link opens the create panel directly.
Pre: navigate via a quick-start shortcut elsewhere (e.g. the Sales Hub's "عرض سعر جديد" button, SALES-004).
Steps: Land on `/sales/quotes`.
Assert: The create panel is already open on arrival, with the form freshly reset (not showing stale data from a previous visit).

**SALES-150** — Cancel discards a new quote.
Steps: Fill several fields in the create panel, click إلغاء.
Assert: Panel closes, no quote created, quote count unchanged.

**SALES-151** — Reload persistence for a status transition.
Pre: a sent quote.
Steps: Accept it, then reload the whole page (not just the panel).
Assert: Reopening the same quote shows status "مقبول" and the convert sub-form — the transition survived a full reload, confirming it's server-persisted and not just local state.

**SALES-152** — `SQ-DEMO-3`'s exact totals.
Pre: `SQ-DEMO-3` — 80×ITEM-DEMO-2 at wholesale price 88 = 7,040.00 + 985.60 tax.
Steps: Open its detail panel.
Assert: الإجمالي الكلي reads **8,025.60**.

**SALES-153** — Run in English/LTR.
Steps: Toggle language on the list, create panel, and a quote's detail panel.
Assert: Labels flip, layout mirrors, digits render Latin.

---

## مرتجعات المبيعات (Sales Returns) — `/sales/returns`

Same architecture as Quotes: list + two SidePanels, no separate routes for create/detail.

**SALES-154** — Status chip "الكل".
Pre: 3 seeded returns (`SRT-DEMO-1`, `SRET-DEMO-1` confirmed; `SRT-DEMO-2` draft).
Assert: Count = 3.

**SALES-155 / 156 / 157** — Remaining chips.
Assert: "مسودة" = 1 (`SRT-DEMO-2`); "مؤكد" = 2 (`SRT-DEMO-1`, `SRET-DEMO-1`); "ملغي" = 0.

**SALES-158** `[NOT IMPLEMENTED]` — No "بانتظار دفع المبلغ" chip.
Assert: `awaitingRefund` is only ever shown as a secondary badge and a KPI count — it is not one of the 4 filterable status chips (الكل/مسودة/مؤكد/ملغي only), even though both confirmed seeded returns always carry that badge (`isAwaitingRefund = status === "confirmed"`).

**SALES-159** — KPI cards are counts.
Assert: "إجمالي المرتجعات" = 3, "مؤكدة" = 2, "بانتظار دفع المبلغ" = 2 (both confirmed returns, by definition) — all counts, not the catalog's money-valued "قيمة المرتجعات المؤكدة".

**SALES-160** — Header action + panel subtitle.
Steps: Click "مرتجع جديد".
Assert: Opens a SidePanel titled "مرتجع مبيعات جديد" with description "مرتجع لا يعني استرداد المبلغ تلقائياً" — this doubles as the catalog's "doesn't auto-refund cash" banner, rendered as the panel's subtitle rather than a distinct visual block.

**SALES-161** — List columns.
Steps: Inspect the `SRT-DEMO-1` row.
Assert: رقم المرتجع shows docNo + source-invoice-number subtext (NOT the return reason, unlike the catalog's claim); العميل resolves via a lookup map; قيمة المرتجع shows one combined MoneyDisplay total (no separate original-vs-returned breakdown, unlike catalog); الحالة shows the status pill plus a secondary "بانتظار دفع المبلغ" warning pill for confirmed returns.

**SALES-162** `[NOT IMPLEMENTED]` — No filters, no بواسطة/reason column, no row menu.
Assert: No العميل or من/إلى تاريخ filter panel; no سبب column visible in the list itself; no per-row menu (all actions live in the detail panel).

**SALES-163** — Source-invoice picker is a plain dropdown, not a typeahead.
Steps: Open "مرتجع جديد", inspect فاتورة المصدر *.
Assert: It's a `SelectField` populated from confirmed/non-draft/non-cancelled invoices (label = `docNo — customerName`) — not the catalog's searchable typeahead combobox.

**SALES-164** `[NOT IMPLEMENTED]` — No read-only invoice-summary block after selecting a source.
Steps: Select a source invoice.
Assert: None of رقم الفاتورة/العميل/التاريخ/المستودع/الفرع/إجمالي الفاتورة/الحالة render as a read-only summary — the only extra control shown is an independent, editable المستودع * selector (defaults to the first warehouse, not necessarily the invoice's own warehouse).

**SALES-165** — Reason dropdown, exact options.
Steps: Open سبب الإرجاع *.
Assert: Exactly 5 options — معيب (DEFECTIVE, default), صنف خاطئ (WRONG_ITEM), كمية زائدة (EXCESS_QTY), تغيير رأي العميل (CHANGED_MIND), أخرى (OTHER) — matches the catalog exactly.

**SALES-166** — Line item table is missing most catalog columns.
Steps: Select `INV-DEMO-1` as the source invoice, inspect the بنود المرتجع table.
Assert: Only 2 fields per row exist — الصنف (a `SelectField` of the invoice's stock lines) and الكمية (a `NumberField`, `min=0`, no max). سعر الوحدة, الكمية الأصلية, مرتجع سابق, المتاح للإرجاع, and إجمالي السطر from the catalog are **not rendered at all** — the tester has no visibility into original/already-returned/available quantities while filling the form.

**SALES-167** — "Available to return" ignores prior returns — the over-return gap.
Pre: `INV-DEMO-1`'s ITEM-DEMO-3 line originally invoiced 120 units; 25 are already confirmed-returned (`SRT-DEMO-1` qty 20 + `SRET-DEMO-1` qty 5), so the true remaining returnable is **95**.
Steps: Open "مرتجع جديد", select `INV-DEMO-1` as the source, pick ITEM-DEMO-3, enter الكمية = 100 (more than the true 95 remaining, but less than the original 120), save & confirm.
Assert: Per code, `returnableLines` (`SalesReturnsScreen.tsx:118-121`) filters the invoice's *original* stock lines with no subtraction of already-returned qty, and `availableQty` sent to the server is the original invoice-line qty (120), not (120 − 25 = 95). The domain's own guard (`sales-return-document.ts:114-118`, "كمية الإرجاع تتجاوز المتاح للإرجاع") only compares against whatever `availableQty` the *client* supplied — so it is neutered by the inflated value the UI sends. **Expected-if-correct**: the return should be rejected (100 > 95 truly available). **Verify what actually happens** — if the return commits, this is exactly the "returning more than was invoiced" defect the task description points at; log it precisely (qty entered, true available, qty accepted) as a new, distinctly-cited finding — it is not one of D1–D6.

**SALES-168** — Genuine over-original-qty rejection (sanity check).
Steps: On the same form, try entering a quantity larger than the invoice's *original* line qty (e.g. 200 for a 120-unit line).
Assert: Since `availableQty` is set to the original 120 regardless of prior returns, a qty of 200 should still be rejected server-side ("...(200) تتجاوز المتاح للإرجاع (120)") — confirming the guard works correctly against the *original* qty, just not against the *true remaining* qty (see SALES-167).

**SALES-169** — Cannot save with all lines at zero.
Steps: Set every line's الكمية to 0, click حفظ كمسودة.
Assert: Blocked, error "أضف بنداً واحداً على الأقل بكمية أكبر من صفر."

**SALES-170** — Empty returnable-lines state.
Pre: pick a source invoice whose lines are entirely non-stock or already fully consumed by the `isStock && unitCost !== null` filter (uncommon in seed data — may require a purpose-built invoice with a non-stock line only).
Steps: Select such an invoice.
Assert: "لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة" shows; the "إضافة بند" button is disabled.

**SALES-171** — Two save modes: draft-only vs. save-and-confirm.
Steps: Fill a valid return against `INV-DEMO-2`, and separately test both buttons: "حفظ كمسودة" and "حفظ وتأكيد".
Assert: حفظ كمسودة creates a draft (status مسودة, no restock/GL effect expected); حفظ وتأكيد creates AND immediately confirms in one action — this combined action is extra vs. the catalog, which only describes حفظ كمسودة on this form.

**SALES-172** — Cannot delete the last line.
Steps: With one line, click حذف.
Assert: Disabled when `lines.length === 1`.

**SALES-173** — draft → confirm transition, `SRT-DEMO-2`.
Pre: `SRT-DEMO-2` is draft (against `INV-DEMO-3`, item ITEM-4, qty 3).
Steps: Open it, click "تأكيد المرتجع".
Assert: Status flips to "مؤكد"; a "بانتظار دفع المبلغ" badge now shows permanently alongside it; reload — both persist.

**SALES-174** — draft → cancel transition.
Pre: create a fresh draft return (don't reuse `SRT-DEMO-2` if SALES-173 already confirmed it).
Steps: Open it, click "إلغاء" (the draft-state cancel button).
Assert: Status flips to "ملغي"; it now counts under the "ملغي" chip.

**SALES-175** — confirmed → cancel transition.
Pre: `SRT-DEMO-1` (confirmed).
Steps: Open it, click "إلغاء المرتجع" (the confirmed-state cancel button — a different label from the draft-state one).
Assert: Status flips to "ملغي"; verify whether the "بانتظار دفع المبلغ" badge correctly disappears (it should, since `isAwaitingRefund` requires `status === "confirmed"`). **Caution**: this mutates seed data other scenarios depend on (SALES-058, SALES-167 reference `SRT-DEMO-1`) — run this against a fresh return created for the purpose instead if you need those other scenarios to stay reproducible.

**SALES-176** `[NOT IMPLEMENTED]` — No effects explainer on confirm.
Steps: Confirm a draft return.
Assert: No "what will happen" / restock-and-AR-reduction explainer block appears anywhere (unlike invoices' "تأثيرات هذه الفاتورة") — the confirm action just runs silently and the list/detail refresh via query invalidation.

**SALES-177** `[NOT IMPLEMENTED]` — No refund/treasury-voucher UI.
Pre: a confirmed, awaiting-refund return (e.g. `SRT-DEMO-1`).
Steps: Look for any way to record the cash refund from this screen.
Assert: None exists — no button, no link to `/treasury/vouchers`, no explanation of how "بانتظار دفع المبلغ" ever clears. (It structurally never clears on its own — see the seed-data note above.) A tester who needs to actually refund a customer must navigate to Treasury manually and create a disbursement voucher themselves, entirely outside this screen's guidance.

**SALES-178** — `held` field from the confirm response is dead data.
Pre: confirm any draft return.
Steps: Inspect the network response of the confirm call (`useConfirmSalesReturn`).
Assert: The response includes a `held: boolean` field that is never read or surfaced anywhere in the UI — confirm this is genuinely unused by grepping the screen file, and note it as dead API surface (informational, not a user-facing defect on its own).

**SALES-179** — Multi-invoice-line guard is unreachable via UI (defensive only).
Steps: Try to build a return whose lines reference two different source invoices.
Assert: Impossible through this UI — `changeInvoice()` always resets `lines` to items from the newly selected invoice only, so the domain's "كل بنود المرتجع يجب أن تنتمي لنفس الفاتورة." guard can never actually fire from this screen; it only protects a direct API caller.

**SALES-180** — Exact seeded values, `SRT-DEMO-1`.
Pre: `SRT-DEMO-1` — 20×ITEM-3@42 = 840.00 + 117.60 tax.
Steps: Open its detail panel.
Assert: Line reads "٢٠ × ٤٢٫٠٠" (or Latin equivalent in EN mode); confirm the list's قيمة المرتجع column for this row totals **957.60**.

**SALES-181** — Exact seeded values, `SRET-DEMO-1`.
Pre: `SRET-DEMO-1` — 5×ITEM-3@42 = 210.00 + 29.40 tax = 239.40.
Steps: Open its detail panel.
Assert: قيمة المرتجع reads **239.40**.

**SALES-182** — Combined effect on `INV-DEMO-1`, cross-referenced.
Pre: both `SRT-DEMO-1` (957.60) and `SRET-DEMO-1` (239.40) are confirmed against `INV-DEMO-1`.
Steps: Sum their values.
Assert: Combined returned value = **1,197.00** against `INV-DEMO-1`'s original grand total of 13,953.60 — cross-reference this exact figure against SALES-115's finding that the invoice's own "الرصيد المتبقي" does *not* reflect it.

**SALES-183** — List load error + retry.
Steps: Force the returns query to fail, reload.
Assert: "تعذّر تحميل مرتجعات المبيعات." card + "إعادة المحاولة" button (this screen, unlike Quotes, does have a dedicated error/retry card).

**SALES-184** — Cancel discards a new return.
Steps: Fill the create form, click nothing that saves, close the panel (or reuse إلغاء if present at the field level — confirm via the panel's own close control).
Assert: No return created, counts unchanged.

**SALES-185** — Empty-list state (hypothetical, requires a clean tenant).
Pre: on a tenant with zero returns (not the standard demo seed).
Steps: Load the list.
Assert: "لا توجد مرتجعات — أنشئ مرتجعاً جديداً".

**SALES-186** — Reload persistence for a full create-and-confirm cycle.
Steps: Create a new return against `INV-DEMO-5` (item ITEM-DEMO-7, qty 10 of 60), حفظ وتأكيد, then reload the whole page.
Assert: The new return persists with status مؤكد and "بانتظار دفع المبلغ", and its line/qty/value are exactly as entered.

**SALES-187** — "إنشاء مرتجع مبيعات" from an invoice's context.
Steps: Look for a shortcut to pre-fill a return's source invoice from an invoice's own detail page (per the catalog's "المزيد" menu claim).
Assert: `[NOT IMPLEMENTED]` — Sales Invoices has no "المزيد" menu at all (SALES-105), so this pre-filled shortcut does not exist; every return must be started from `/sales/returns` and the source invoice picked manually from the dropdown.

**SALES-188** — Run in English/LTR.
Steps: Toggle language on the list, create panel, and a return's detail panel.
Assert: Labels flip, layout mirrors, digits render Latin, the combined "قيمة المرتجع" total still computes correctly in the new locale.

---

## قوائم الأسعار (Price Lists) — `/sales/price-lists`

Unlike the reference product's empty tenant, this build's seed has 4 real price lists — letting several catalog claims be checked directly against real rows for the first time.

**SALES-189** — List columns with real data.
Pre: 4 seeded price lists.
Steps: Open `/sales/price-lists`.
Assert: 4 rows show. Columns: الاسم (bold, with الكود in mono/muted underneath), الوصف, عدد الأصناف (line count — `PL-DEMO-1`/`PL-BASE` reads 4), الحالة (a StatusPill "نشطة"/"غير نشطة", **plus** a second "قائمة أساسية" info pill when `isBase` — `PL-DEMO-1` shows both pills; `PL-DEMO-4` shows only "غير نشطة").

**SALES-190** — Stat cards.
Assert: "إجمالي القوائم" = 4, "النشطة" = 3 (all except deactivated `PL-DEMO-4`).

**SALES-191** `[NOT IMPLEMENTED]` — No filter chips, no search.
Assert: Neither exists on this screen at all, despite 4 real rows now available to filter/search against.

**SALES-192** `[NOT IMPLEMENTED]` — Rows are not clickable; create-only surface.
Steps: Click the `PL-DEMO-1` row.
Assert: Nothing happens — `onRowClick` is never passed, so there is no detail/edit view and no per-item price-line grid reachable from the UI at all, even though `PL-DEMO-1` genuinely has 4 priced lines behind it (visible only via its "عدد الأصناف" count, never their actual contents).

**SALES-193** — Create dialog, required fields.
Steps: Open "قائمة أسعار جديدة", leave الاسم blank, click حفظ.
Assert: Submit button stays disabled while `!code.trim() || !nameAr.trim()` — both الاسم and الكود are required to enable save (stricter than the catalog, which only marks both with `*` but doesn't specify a disabled-vs-error UX).

**SALES-194** — Create dialog, defaults and persistence.
Steps: Fill الاسم "قائمة اختبار", الكود "PL-TEST-1", leave الوصف blank, leave قائمة أساسية off, save, reload the list.
Assert: New row appears with "غير نشطة"... actually check: new price lists likely default active — confirm the status pill reads "نشطة" (not "غير نشطة") and no "قائمة أساسية" pill, since the toggle was left off. Reload confirms persistence.

**SALES-195** — Duplicate code rejection.
Steps: Create a new price list using الكود "PL-BASE" (already used by `PL-DEMO-1`).
Assert: Server rejects with a 409 `DuplicatePriceListError`; the message renders in the create dialog's red banner (exact text depends on the domain error, not client-validated).

**SALES-196** — قائمة أساسية toggle and its hint.
Steps: Open the create dialog, inspect the قائمة أساسية toggle.
Assert: Hint text reads "القائمة الأساسية تُطبّق افتراضياً على العملاء بلا قائمة أسعار محددة."; toggling it on and saving creates a second "base" list alongside `PL-DEMO-1` — confirm the domain either allows multiple base lists or rejects a second one (verify and record whichever behavior you observe, since the UI gives no warning either way).

**SALES-197** `[NOT IMPLEMENTED]` — No per-item price-line field in the create dialog.
Assert: Despite the backend accepting a `lines` array on `POST /price-lists` (and `PL-DEMO-1..4` all being seeded with real priced lines through that same endpoint), the create dialog never exposes any per-item pricing UI — a price list created through this screen always has zero lines.

**SALES-198** `[NOT IMPLEMENTED]` — No edit capability at all.
Steps: Look for any way to rename, redescribe, or otherwise modify an existing price list (e.g. `PL-DEMO-2`).
Assert: None exists — no `useUpdatePriceList` hook is wired anywhere in the frontend, even though the backend fully supports `PATCH /price-lists/:id`.

**SALES-199** `[NOT IMPLEMENTED]` — No deactivate/reactivate UI.
Pre: `PL-DEMO-4` is already deactivated (seeded via a direct API call).
Steps: Look for any button to reactivate `PL-DEMO-4`, or to deactivate an active one like `PL-DEMO-3`.
Assert: None exists anywhere on this screen — the "غير نشطة" pill on `PL-DEMO-4` is permanently read-only from the UI's perspective, even though the backend exposes both `POST /price-lists/:id/activate` and `/deactivate`.

**SALES-200** — Cancel discards.
Steps: Fill the create dialog, click إلغاء.
Assert: Dialog closes, no price list created.

**SALES-201** — Empty state text differs slightly from the catalog.
Pre: hypothetically, a tenant with zero price lists.
Assert: "لا توجد قوائم أسعار — أنشئ قائمة جديدة" (this build appends a CTA clause the reference product's plain "لا توجد قوائم أسعار" didn't have).

**SALES-202** — Load error state (currently silent).
Steps: Force the price-lists query to fail.
Assert: **No visible error card renders** — `query.isError` is never checked in the JSX, so a failed load looks identical to "still loading" or an empty list with no explanation. This is itself worth flagging: unlike Customers/Invoices/Returns, this screen has no load-failure UI at all.

**SALES-203** — Run in English/LTR.
Steps: Toggle language on the list and the create dialog.
Assert: Labels flip, digits render Latin, the two-pill status cell (نشطة + قائمة أساسية) still renders both pills correctly side by side in LTR.

---

## العروض (Promotions) — `/sales/promotions`, and its inline report

The catalog describes a 2-tab create dialog and a separate `/sales/promotions/report` route; this build has neither — the create dialog is a single flat panel missing most fields, and the report is an inline card at the bottom of the same list screen.

**SALES-204** — Header actions.
Steps: Open `/sales/promotions`.
Assert: Only "إضافة عرض" exists — there is no "تقرير العروض" header link/button (the report is inlined below instead, see SALES-221+).

**SALES-205** — KPI cards, real seeded value.
Pre: `PROMO-DEMO-1` (SUMMER10) — active as of 2026-08-24 (5 days into its window, ends December).
Assert: "الإجمالي" = 1, "فعال" = 1, "مجدول" = 0, "قرب الانتهاء" = 0 (more than 7 days remain until 2026-12-31).

**SALES-206** — Status chips, more than the catalog claims.
Assert: 4 chips exist — الكل / فعال / مجدول / قرب الانتهاء (catalog only described الكل/فعال) — but there is still **no** "منتهي" (ended) chip even though the client-side `deriveState()` computes an `ended` bucket internally; it's simply never surfaced as a chip.

**SALES-207** `[NOT IMPLEMENTED]` — No search box.
Assert: `searchValue`/`onSearchChange` props are unused — no search field renders on this screen.

**SALES-208** — List columns.
Steps: Inspect the `PROMO-DEMO-1` row.
Assert: 5 columns — الرمز (code + nameAr stacked), النوع ("نسبة خصم"), الفترة ("2026-08-19 → 2026-12-31"), الأولوية, الحالة (derived StatusPill "فعال"). No row-menu column exists at all (gap — no per-row action of any kind).

**SALES-209** — Create dialog is single-tab, not two.
Steps: Open "إضافة عرض".
Assert: One flat panel, not the catalog's البيانات الأساسية / النطاق tabs.

**SALES-210** — Required fields.
Steps: Leave الرمز or الاسم blank, try to save.
Assert: Submit stays disabled while `!code.trim() || !nameAr.trim()`.

**SALES-211** — قيمة الخصم % only renders for percentage type.
Steps: Set النوع = "نسبة خصم" (default).
Assert: قيمة الخصم % field appears (`min=0 max=100`, default 10). Now switch النوع to "خصم مبلغ", "سعر خاص", "اشتر واحصل على", or "حزمة".
Assert: `[NOT IMPLEMENTED]` — no equivalent field appears for any of these 4 other types (no amount-value field for fixed_amount/special_price, no buy/get quantity fields, no bundle-component picker) — selecting any type other than percentage leaves the form with literally no way to supply that type's required data, yet the type can still be selected and (attempted to be) saved.

**SALES-212** — Percent-range is not enforced at submit (only via the native input attribute).
Steps: With type = percentage, try to type 150 into قيمة الخصم % directly (bypassing the spinner arrows, e.g. via keyboard).
Assert: The field carries `min={0} max={100}` as HTML attributes but the form never calls `reportValidity()`/native constraint validation on submit — a value like 150 can be typed and the create button clicked. Verify what happens: expect a server-side 422 rejection ("نسبة الخصم يجب أن تكون بين 0 و 100.", `packages/domain/src/promotions/promotion.ts:91-137`) surfacing in the red banner, not a client-side block.

**SALES-213** — Date range default and order validation.
Steps: Open the create dialog fresh.
Assert: Both تاريخ البداية * and تاريخ الانتهاء * default to **today** (not "end blank" as the catalog implies) — so a naive save with only the dates left at default creates a same-day promotion. Now set تاريخ الانتهاء before تاريخ البداية, try to save.
Assert: Server rejects with "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." (client never checks this itself).

**SALES-214** — يتطلب كوبون toggle.
Steps: Toggle it on.
Assert: Hint text updates/confirms: "بدون تفعيل، يُطبّق العرض تلقائياً على الفواتير المطابقة." — matches `PROMO-DEMO-1`'s own `requiresCoupon: false` behavior (it auto-applies, as seen on `INV-DEMO-4`).

**SALES-215** `[NOT IMPLEMENTED]` — Missing fields vs. catalog.
Assert: None of the following exist on the create form: حد أدنى لقيمة الفاتورة, اشتر (كمية)/احصل على (كمية), الوصف, مكونات الحزمة, تقييد الأيام والساعات toggle, or any النطاق UI at all — every new promotion is silently created with `scope: { type: "all", ids: [] }` hardcoded, so **a user can never scope a promotion to a specific item or category through this UI**, unlike `PROMO-DEMO-1` itself (seeded via direct API, scoped to `ITEM-DEMO-4`).

**SALES-216** — Create, save, and reload — persistence check.
Steps: Create a promotion "TESTPROMO" / "عرض اختبار", type نسبة خصم, قيمة الخصم % = 15, leave dates at default, save.
Assert: New row appears in the list with status "فعال" (dates default to today→today, so it may immediately show as ending today/expiring — verify actual derived status); reload the list — the new promotion persists with its exact code/name/percent.

**SALES-217** `[NOT IMPLEMENTED]` — No row menu, no edit, no deactivate, no delete.
Steps: Look for any per-row action on any promotion, including `PROMO-DEMO-1`.
Assert: None exists anywhere — no edit dialog (`useUpdatePromotion` isn't wired despite `PATCH /promotions/:id` existing server-side), no deactivate button (despite `POST /promotions/:id/deactivate` existing), no delete.

**SALES-218** — Status derivation matches the domain formula.
Pre: `PROMO-DEMO-1` — start 2026-08-19, end 2026-12-31, today 2026-08-24.
Assert: `deriveState()` computes: scheduled if today < start (false here), ended if today > end (false), expiring if daysLeft ≤ 7 (false — >7 remain), else active → "فعال", matching SALES-205's KPI reading.

**SALES-219** — Cancel discards.
Steps: Fill the create dialog, click إلغاء.
Assert: No promotion created.

**SALES-220** — Empty-state and error strings.
Pre: hypothetically, an empty promotions tenant.
Assert: "لا توجد عروض" (matches catalog); a forced load failure shows **no visible error card** either (same silent-failure gap as Price Lists — `query.isError` unrendered in JSX).

**SALES-221** — Promotions report is inline, not a route.
Steps: Scroll to the bottom of `/sales/promotions`.
Assert: A "تقرير العروض" section renders inline on the same page (`PromotionUsageReport` component) — navigating directly to `/sales/promotions/report` does **not** exist as a route (`grep` for `PromotionsReport`/`promotions-report` in `App.tsx`'s `ROUTABLE_SCREENS` returns nothing).

**SALES-222** — Report columns, fewer than catalog.
Steps: Inspect the inline report table.
Assert: 5 columns — العرض (code+nameAr stacked), مرات الاستخدام, الخصم الممنوح, المعكوس بالمرتجعات, الصافي. Missing vs. catalog's 7: no separate الرمز/الاسم split, and critically **no النوع column at all**.

**SALES-223** `[NOT IMPLEMENTED]` — No KPI cards on the report.
Assert: None of عروض مستخدمة / عدد مرات الاستخدام / إجمالي الخصم الممنوح / صافي الخصم render anywhere near the inline report.

**SALES-224** `[NOT IMPLEMENTED]` — No period or branch filters; the report is unfilterable.
Steps: Look for هذا الشهر/الشهر الماضي/هذا الربع/هذه السنة chips, a من/إلى تاريخ picker, or a فرع filter near the report.
Assert: None exist. The underlying hook calls `GET /promotions/report` with **no query string at all**, even though the API route accepts `dateFrom`/`dateTo` — the frontend simply never sends them, so the report always covers the whole dataset with no way to narrow it.

**SALES-225** — Report reflects `INV-DEMO-4`'s real discount.
Pre: `INV-DEMO-4` earned SUMMER10's 10% discount at confirm (520.00 off the 5,200 gross line).
Steps: Read the SUMMER10 row in the inline report.
Assert: مرات الاستخدام ≥ 1, الخصم الممنوح includes the 520.00 from `INV-DEMO-4`, المعكوس بالمرتجعات reflects any of that discount reversed by a confirmed return against `INV-DEMO-4` (none seeded, so expect 0 here), الصافي = الخصم الممنوح − المعكوس بالمرتجعات.

**SALES-226** — Report empty state.
Pre: a date range or tenant with no promotion usage (not directly reachable given the report has no filters — this may only be observable on a genuinely fresh tenant).
Assert: "لا توجد عروض في الفترة."

**SALES-227** — Report load error (also silent).
Steps: Force the report's query to fail.
Assert: No visible error card renders — same unrendered-`isError` pattern as the rest of this screen (the "تعذّر تحميل تقرير استخدام العروض." string exists in code as a fallback but is never actually displayed in the JSX; confirm this precisely if you can force the failure).

**SALES-228** — Run in English/LTR.
Steps: Toggle language on the promotions list, the create dialog, and the inline report.
Assert: Labels flip, layout mirrors, digits render Latin; the 4 promotion-type labels in the النوع dropdown re-render in English.

---

## Out of scope

- **رحلات المندوبين (Van/Rep Trips)** — `/field/van-trips` — belongs to the separate Field Sales module, reachable from the Sales nav dropdown but not owned by it; not covered here per task scope.
- **POS** (`/pos/sales`, `/pos/refunds`) — explicitly out of scope per the task brief.
- **Installments** (`/installments/plans`, `/installments/follow-ups`) — its own module; only referenced here where a Sales screen links into it (and every such link, per the audits above, turned out not to exist in this build).
- **Reports module** (`/reports/sales/...`) — a separate top-level nav section; not audited here except where Customers' كشف حساب tab cross-references `/reports/aging/customers` for its reconciliation pill (SALES-058).
