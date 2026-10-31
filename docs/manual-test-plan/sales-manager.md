# Manual test plan — Sales (مدير مبيعات، مندوب)

Grounded against the code as it stands in this worktree: `apps/web/src/screens/sales-quotes/*`,
`apps/web/src/screens/SalesInvoicesScreen.tsx`, `apps/web/src/screens/SalesReturnsScreen.tsx`,
`apps/web/src/screens/VanTripsScreen.tsx`, `apps/web/src/screens/CustomersScreen.tsx`,
`apps/web/src/screens/PriceListsScreen.tsx`, `apps/web/src/screens/PromotionsScreen.tsx`,
`apps/web/src/screens/reports/SalesReportsScreens.tsx` and `.../FieldSalesReportsScreens.tsx`;
`packages/api/src/sales-quotes-routes.ts`, `sales-invoices-routes.ts`, `sales-returns-routes.ts`,
`customers-routes.ts`, `price-lists-routes.ts`, `promotions-routes.ts`, `field-sales-routes.ts`,
`reports-routes.ts`. No scenario below exercises a screen or route that does not exist.

## Personas, exactly as seeded

The demo tenant (`MEZAN_SEED_DEMO=1`) has no role literally named "مدير مبيعات". The closest
built role is **مشرف المبيعات** (`SUPERVISOR`) — it holds `sales.invoice.view_all` and
`sales.invoice.confirm`, which is where the approval/oversight half of this plan lives. Use it
for every step marked **[مشرف المبيعات]**. Every login uses password `Cyag@2026`
(`packages/backend/src/demo-seed/access.ts`).

| Persona in this plan | Seeded login | Role code | Notes |
|---|---|---|---|
| مندوب مبيعات (rep) | `karim.fouad@cyag.example` | `SALES_REP` | `sales.quote.view_own`, `sales.invoice.view_own`, `sales.invoice.create` — **no** `sales.invoice.confirm` |
| مشرف المبيعات (closest "sales manager") | `omar.hilal@cyag.example` | `SUPERVISOR` | `sales.invoice.view_all`, `.confirm`, `sales.return.confirm`, `workflow.approve` |
| مندوب توزيع (van rep) | `salma.fouad@cyag.example` | `VAN_SALES`, `warehouseScope: [WH-DEMO-VAN]`, `employeeId: EMP-DEMO-2` | already the crew on seeded trip `TRIP-DEMO-2` |
| Company admin (only account that can manage price lists, promotions, or approve an over-ceiling discount) | `nadia.shafik@cyag.example` | none — `"*"` wildcard | no seeded role holds `sales.price_list.manage`, `sales.promotion.manage`, `pos.discount.approve`, or `sales.price.override` |

Seeded customers: **شركة الأمل للتجارة** (C-0001, حد ائتماني 50,000), **مؤسسة النور للمقاولات**
(C-0002, 120,000), **مجموعة الفجر التجارية** (C-0003, 25,000, tax-exempt individual). Seeded
promotions: `SUMMER10` (10% on زيت عباد الشمس, no coupon), `BULK15` (15% capped 500, coupon
required, min qty 20 on ITEM-DEMO-1), `COMBO` (bundle, coupon required). Seeded van: `VAN-01`
(المركبة `VAN-DEMO-1`) → warehouse `WH-DEMO-VAN` (type `VAN`) → till `TR-DEMO-VAN`. Seeded trips:
`TRIP-DEMO-1` (settled, small cash + stock variance) and `TRIP-DEMO-2` (still جارية).

Credit control is **off** by default (`creditControlEnabled: false` — `packages/domain/src/
settings/settings.ts`); several scenarios below start by turning it on from **الإعدادات → عام
→ الرقابة الائتمانية**, which is a real screen (`apps/web/src/settings/SettingsGeneral.tsx`),
not an invented step.

---

## A. Quotation (عرض سعر)

### MTP-SAL-01 — Create a draft quote with a real item picker
- **Persona / permission:** مندوب مبيعات (`karim.fouad`)
- **Preconditions:** demo seed loaded.
- **Steps:**
  1. Open المبيعات → عروض الأسعار, click "عرض سعر جديد".
  2. Set "العميل *" to شركة الأمل للتجارة.
  3. Add a line, set "الصنف *" to زيت عباد الشمس 1 لتر, "الكمية" 10, leave "السعر" at the
     item's default (95).
  4. Save as مسودة.
- **Expected:** the quote appears with status «مسودة» (`quotes.status.draft`) and a grand total
  of 950.00 EGP plus 14% VAT = 1,083.00 EGP (item's own tax rate, not a typed value). No GL
  entry exists yet — a quote is pre-document and must not touch the ledger.
- **False pass:** the row shows the right total but the line's item id in the saved record is
  not `ITEM-DEMO-2` — confirm from the network response, not the label, that the picker bound to
  the real item (rule: a typed name with a fabricated id still renders correctly on screen).

### MTP-SAL-02 — A line with no item picked is refused
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** quote form open.
- **Steps:** Add a line, leave "الصنف *" unselected, try to save.
- **Expected:** the save is blocked client-side (required field) and, if bypassed, the server's
  `createSalesQuoteSchema` rejects the payload with `VALIDATION_ERROR` (400) — no draft is
  created.
- **False pass:** a draft IS created with an empty `itemId`/`itemNameAr` string — that quote would
  later refuse to convert to an invoice with a cryptic 400, far from where the mistake was made.

### MTP-SAL-03 — Send the quote to the customer
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** MTP-SAL-01's draft.
- **Steps:** Open the quote, click "إرسال للعميل".
- **Expected:** status becomes «مرسل», and only now does the quote get a real `docNo` (numbering
  is allocated on send, per `sales-quotes-routes.ts`'s own comment). `sentAt` is stamped.
- **False pass:** the row shows a doc number before send — check it wasn't reserved on draft
  creation, which would burn numbers on abandoned drafts.

### MTP-SAL-04 — Customer accepts, then convert to invoice
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** MTP-SAL-03.
- **Steps:**
  1. Click "قبول العميل" → status «مقبول».
  2. In the "next step" panel, set "تاريخ الاستحقاق" and "المستودع *", click "إنشاء الفاتورة".
- **Expected:** status flips to «محول» (`convertedAt`/`convertedInvoiceId` set) and a new sales
  invoice is created in status «مسودة» with the SAME lines, same grand total (1,083.00 EGP). No
  stock or GL has moved yet — converting is explicitly stated to post nothing
  (`sales-quotes-routes.ts` comment on `/convert-to-invoice`).
- **False pass:** the quote screen shows «محول» but the invoice total differs from the quote
  total by even one qirsh — recompute both from `totals.grandTotal`, not the rounded display.

### MTP-SAL-05 — Reject a quote
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** the sent quote from MTP-SAL-03.
- **Steps:** On a fresh مرسل quote, click "رفض".
- **Expected:** status «مرفوض», no invoice, no further action available on it besides viewing.
- **False pass:** none — this is a dead-end status and should look like one.

### MTP-SAL-06 — Cancel a draft quote
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** a fresh draft quote (e.g. MTP-SAL-01).
- **Steps:** On a fresh مسودة quote, click "إلغاء العرض".
- **Expected:** status «ملغي»; `InvalidSalesQuoteTransitionError` (409) if attempted on a محول
  quote instead.
- **False pass:** none.

### MTP-SAL-07 — Expired quotes bucket
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** a quote whose "تاريخ الانتهاء" is in the past and still «مرسل».
- **Steps:** Open the status chips, click «منتهي».
- **Expected:** the quote appears — `expired` is derived from `expiryDate` vs today, not a stored
  status, so it must show up even though no column says "expired".
- **False pass:** the KPI strip's totals silently exclude/duplicate this row versus the same set
  filtered any other way — the route computes counts and stats over the identical filtered set on
  purpose (`sales-quotes-routes.ts` §"single filter"); two different numbers here is the finding.

### MTP-SAL-08 — Converting an already-converted quote is refused
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** MTP-SAL-04's now-محول quote.
- **Steps:** Try to reach "إنشاء الفاتورة" again (e.g. via the same URL/deep link).
- **Expected:** the route answers `INVALID_QUOTE_STATUS` (409) — "لا يمكن تحويل عرض السعر إلا
  بعد قبوله من العميل." A quote converts to exactly **one** invoice; there is no way to split it
  into two partial invoices (see Gaps).
- **False pass:** a second invoice IS created — that would silently double the customer's
  receivable for the same goods.

---

## B. Rep and customer visibility — the dealbreaker checks

### MTP-SAL-09 — A rep cannot open their own quotes list [DEALBREAKER]
- **Persona / permission:** مندوب مبيعات (`karim.fouad`, holds only `sales.quote.view_own` and
  `sales.quote.create`, never `sales.quote.view`)
- **Preconditions:** MTP-SAL-01 done (a quote exists that belongs to this rep).
- **Steps:** Sign in as كريم فؤاد, open المبيعات → عروض الأسعار.
- **Expected (as built):** `GET /sales-quotes` is gated with a single
  `gate("sales.quote.view")` (`sales-quotes-routes.ts` line ~301) — not the `gateAny(...view,
  .view_all, .view_own)` pattern `sales-invoices-routes.ts` uses. A caller holding only
  `.view_own` gets `403 PERMISSION_DENIED`. The screen shows an error, not an empty list.
  **This is the dealbreaker: the rep who just created a quote cannot see it, send it, or convert
  it — the entire quotation workflow is unusable for the one role it exists for.**
- **False pass:** "the rep can still create quotes, so the feature basically works" — creation
  succeeds (gate is `sales.quote.create`) but the rep can never list, open, send, accept, reject
  or convert what they created. `GET /sales-quotes/counts`, `/stats` and `/:id` share the same
  single-tier gate and fail identically.

### MTP-SAL-10 — A rep sees every customer in the company, not their own route [DEALBREAKER]
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** demo seed (3 customers across different areas — Cairo, Giza, Tanta).
- **Steps:** Sign in as كريم فؤاد, open المبيعات → العملاء.
- **Expected (as built):** all three customers are listed — `customers-routes.ts`'s
  `listFilteredCustomers` filters only by `status`/`priceListId`/`overLimit`/`q`; it never calls
  `branchScopeOf`/`withinScope` (contrast every other sales route in this file set, which does).
  The permission catalog itself defines only one tier, `sales.customer.view` — there is no
  `sales.customer.view_own`/`.view_all` pair and no "assigned rep"/خط سير field on the customer
  record at all (`packages/domain/src/permissions/catalog.ts` lines 97-100).
  **This is the dealbreaker verbatim: any rep with `sales.customer.view` — which `SALES_REP` and
  `VAN_SALES` both hold — sees the whole company's customer book, credit limits included.**
- **False pass:** "the invoice list is scoped, so customers must be too" — invoice visibility and
  customer visibility are two different code paths; one being right says nothing about the other.

### MTP-SAL-11 — A van rep cannot see the trip they just opened [twin of MTP-SAL-09]
- **Persona / permission:** مندوب توزيع (`salma.fouad`, holds `field.van_trip.view_own`,
  `.open`, `.settle` — never `field.van_trip.view`)
- **Preconditions:** none beyond the seeded VAN_SALES account.
- **Steps:**
  1. Sign in as سلمى فؤاد, open رحلات المندوبين.
  2. Click "فتح رحلة", fill Van/loading warehouse/till/branch, submit.
- **Expected (as built):** the `POST` succeeds (201) — the rep holds `field.van_trip.open`. But
  `useVanTrips()` (`apps/web/src/data/hooks.ts`) calls `GET /field/van-trips`, gated on the
  single `field.van_trip.view` (`field-sales-routes.ts` line ~200) — which `VAN_SALES` does not
  hold. The list refetch that follows the successful open, and the screen's own initial load,
  both come back `403`. The rep who can open and settle a trip can never see the list of trips,
  including the one they just opened.
- **False pass:** the create form's own success toast appears — that only proves the `POST`
  worked, not that the resulting screen renders anything.

### MTP-SAL-12 — A van rep also cannot see their own «مبيعات المندوبين» report [twin]
- **Persona / permission:** مندوب توزيع
- **Preconditions:** demo seed loaded.
- **Steps:** Sign in as سلمى فؤاد, open التقارير → مبيعات المندوبين.
- **Expected (as built):** `GET /reports/field/van-sales` is gated on plain
  `field.van_trip.view` too (`reports-routes.ts`), same failure as MTP-SAL-11. Same shape again
  on `GET /reports/sales/by-salesperson`, `/sales/by-period`, `/sales/by-item`,
  `/sales/by-customer`, `/sales/top-products` — every one gates on plain `sales.invoice.view`,
  which `SALES_REP` (only `.view_own`) never holds, so no sales report screen opens for a rep at
  all.
- **False pass:** none of these is a coincidence worth separate defect tickets — they are the
  same missed upgrade (`sales-invoices-routes.ts`'s own comment names it: "D31... The route gates
  on the weakest tier"), applied to invoices only and never carried to its siblings.

### MTP-SAL-13 — A rep's own invoice list IS correctly scoped [positive control]
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** two confirmed invoices exist with two different `salespersonId`s.
- **Steps:** Sign in as كريم فؤاد, open فواتير المبيعات.
- **Expected:** `gateAny("sales.invoice.view", ".view_all", ".view_own")` passes on `.view_own`,
  and `repoFilterFor` adds `salespersonId: actorOf(c)` — only invoices where this rep is the
  salesperson appear (`sales-invoices-routes.ts`). This is the control proving the pattern
  MTP-SAL-09/11/12 are missing is a real, fixable omission, not a fundamental limitation.
- **False pass:** the KPI strip at the top shows totals for invoices NOT in the visible list —
  the route deliberately threads `ownVisibilityOnly` through the stats endpoint too (D31 comment)
  to prevent exactly this.

### MTP-SAL-14 — `sales.invoice.view_cost` hides unit cost from a rep
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** a confirmed invoice with stock lines.
- **Steps:** Open the invoice's detail as كريم فؤاد.
- **Expected:** no cost/profit column is shown at all — `unitCost` is **omitted**, not `null`,
  from the JSON (`sales-invoices-routes.ts` comment: "a null would still tell the caller the
  field exists (D31)"). "التكلفة"/"الربح" rows do not render.
- **False pass:** the field renders as "—" or 0 — that leaks that a cost exists and is exactly
  the wrong shape of "hidden".

---

## C. Manual invoice creation, pricing, discounts

### MTP-SAL-15 — Manual invoice, multi-line, tax follows the item
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** none beyond seed.
- **Steps:**
  1. فواتير المبيعات → فاتورة جديدة → "إنشاء فاتورة جديدة" (manual method).
  2. العميل = شركة الأمل للتجارة, المستودع = the main seeded warehouse.
  3. Line 1: سكر أبيض 1 كجم, الكمية 5 (unit price 42, tax rate whatever ITEM-DEMO-3 carries).
  4. Line 2: شاي أسود 500 جم, الكمية 2 (260 each).
  5. Save as مسودة (do not confirm yet).
- **Expected:** subtotal = 5×42 + 2×260 = 730.00; tax is computed per line from each item's own
  `taxRatePercent`, summed into `totals.taxTotal`; grand total = subtotal + tax. Status «مسودة».
  No stock or GL movement — a draft invoice, like a draft quote, is pre-document.
- **False pass:** the preview total (computed client-side by `computeInvoiceTotals`) matches what
  was saved — confirm the SERVER's response `totals`, since the client total is explicitly only
  "a pure, local... preview" and the server is authoritative (comment in
  `SalesInvoicesScreen.tsx`).

### MTP-SAL-16 — Convert-from-quote method inside the invoice screen
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** an accepted quote not yet converted.
- **Steps:** فاتورة جديدة → "إنشاء من عرض سعر" → pick the quote → pick "المستودع" → "تحويل إلى
  فاتورة".
- **Expected:** identical outcome to MTP-SAL-04 — this is the same `/convert-to-invoice` route,
  just reached from the invoices screen instead of the quote's own detail page. Only accepted
  quotes appear in "اختر عرض السعر المقبول"; if none exist the screen states "لا توجد عروض أسعار
  مقبولة قابلة للتحويل."
- **False pass:** a rejected or draft quote appears in the picker.

### MTP-SAL-17 — Confirm a draft invoice: stock, GL and AR must agree
- **Persona / permission:** مشرف المبيعات (`SALES_REP` cannot confirm — no
  `sales.invoice.confirm`)
- **Preconditions:** MTP-SAL-15's draft (730.00 + tax, all stock items with on-hand qty).
- **Steps:** Sign in as عمر هلال, open the draft invoice, click "تأكيد الفاتورة".
- **Expected:** status → «مؤكدة». **Two numbers that must agree:** the invoice's own
  `totals.grandTotal` on screen, and the AR account's movement in the same journal entry
  (revenue credited + output-VAT credited + AR debited by the exact grand total; COGS
  debited/inventory credited at moving-average cost via `postIssue`). Stock on-hand for
  ITEM-DEMO-3 and ITEM-DEMO-4 drops by 5 and 2 respectively in that warehouse.
- **False pass:** the status pill turns green and nothing else is checked — per the project's own
  rule, a status flag alone is never a pass; open الحسابات → القيود for this document and confirm
  the entry balances to the cent and its total equals the invoice's `grandTotal`.

### MTP-SAL-18 — A rep cannot confirm their own invoice
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** a draft invoice كريم فؤاد created.
- **Steps:** As كريم فؤاد, try to reach "تأكيد الفاتورة" (button only renders when status is
  draft — check both the button's absence and, if forced via the API, the server response).
- **Expected:** `gate("sales.invoice.confirm")` refuses with `403` — `SALES_REP` never holds this
  permission; only `SUPERVISOR`, `BRANCH_MANAGER` and `VAN_SALES` (for their own van-sale
  invoices) do.
- **False pass:** the button is hidden but a direct `POST /sales-invoices/:id/confirm` with the
  rep's credentials succeeds anyway — the UI hiding a control is not the same as the server
  enforcing it.

### MTP-SAL-19 — Zero unit price needs «تعديل السعر» (`sales.price.override`)
- **Persona / permission:** مندوب مبيعات (holds neither `sales.price.override` nor
- **Preconditions:** demo seed loaded.
  `pos.discount.approve`)
- **Steps:** New invoice, set a line's "السعر" to 0, try to save.
- **Expected:** `403 PERMISSION_DENIED` with message "سعر صفري أو خصم كامل يحتاج صلاحية تعديل
  السعر." (`refuseUnapprovedDiscount` in `sales-invoices-routes.ts`). No draft is created.
- **False pass:** the invoice IS created at 0.00 and only refuses at confirm — the giveaway guard
  runs on `POST /` (creation), before any draft exists to clean up.

### MTP-SAL-20 — A 100% line discount is the same giveaway as a zero price
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** demo seed loaded.
- **Steps:** New invoice, line "خصم %" = 100.
- **Expected:** same `403 PERMISSION_DENIED` / `sales.price.override` as MTP-SAL-19 — the guard
  treats "discount ≥ 100%" and "unit price = 0" identically.
- **False pass:** a 99.99% discount sails through with no ceiling check at all — see MTP-SAL-21.

### MTP-SAL-21 — A discount above the tenant's ceiling needs approval
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** tenant's `maxLineDiscountPercent` is at its seed default, 100 (never
  configured down in the demo seed — see below).
- **Steps:** New invoice, line "خصم %" = 40, save.
- **Expected as configured:** succeeds — 40% is under the default ceiling of 100%, so
  `pos.discount.approve` is never triggered. **To actually exercise this control**, an admin
  must first lower "الحد الأقصى لخصم البند" (`maxLineDiscountPercent`) in الإعدادات → عام →
  الرقابة الائتمانية, e.g. to 20. Repeat with the lowered ceiling: a 40% line discount now
  returns `403 PERMISSION_DENIED`, `permission: "pos.discount.approve"`, message "الخصم يتجاوز
  الحد المسموح (20%) ويحتاج اعتماداً."
- **False pass:** testing this against the un-configured demo tenant and concluding "there is no
  discount ceiling" — the ceiling exists and works, but its default (100%) makes it invisible
  until a manager sets a real one; no seeded role can grant themselves `pos.discount.approve`
  either (see Persona table) — only the tenant admin can approve an over-ceiling discount at all.

### MTP-SAL-22 — Selling below cost, but not to zero, is NOT blocked [finding]
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** شاي أسود 500 جم costs 205, sells at 260.
- **Steps:** New invoice line: شاي أسود 500 جم, "السعر" typed down to 10 (well under its 205
  cost, but not zero, and with the discount fields left untouched — this is a typed price, not a
  discount).
- **Expected (as built):** the invoice saves and later confirms without any warning or gate — the
  giveaway check in `refuseUnapprovedDiscount` only fires on `unitPrice.scaled === 0n` or a
  discount ≥100%/≥gross; a directly-typed low-but-nonzero price is invisible to it. There is no
  "minimum price" or "price vs. cost" check anywhere in `sales-invoices-routes.ts` or
  `SalesInvoiceService`.
- **False pass:** "the price-override permission covers this" — it does not; it only catches
  literal zero or a 100%-equivalent discount. A rep with plain `sales.invoice.create` can sell at
  any positive price, including far under cost, with no ceiling and no approval. This is the
  dealbreaker-adjacent gap the task calls out directly: "a discount field with no ceiling is how
  margin dies" — here it is not even a discount field, it is the price field itself.

### MTP-SAL-23 — Header (document-level) discount, percent and amount
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** demo seed loaded.
- **Steps:** New invoice with two lines totalling 1,000.00. Set "نوع الخصم" = نسبة, "نسبة الخصم
  %" = 5.
- **Expected:** `invoiceDiscountTotal` = 50.00, applied after line discounts and before tax
  (`computeInvoiceTotals`). Switching "نوع الخصم" to مبلغ shows "قيمة الخصم" instead and the
  discount is a flat Money amount, not recomputed as a percent of a changed subtotal.
- **False pass:** the discount is applied twice — once client-side in the preview and once more
  server-side — inflating the saved total past what the screen showed.

### MTP-SAL-24 — Attempting to invoice stock that is not there
- **Persona / permission:** مشرف المبيعات (to reach confirm)
- **Preconditions:** a draft invoice line quantity exceeds on-hand for that item/warehouse (e.g.
  request 10,000 of سكر أبيض).
- **Steps:** Confirm the invoice.
- **Expected:** `NegativeStockError` → `422`, because the tenant's default `allowNegativeStock`
  is `false`. The invoice stays «مسودة»; no stock or GL movement happened.
- **False pass:** the confirm silently succeeds and drives on-hand negative — only possible if a
  manager has explicitly turned `allowNegativeStock` on, which is not the seeded default and
  should be called out if found on.

### MTP-SAL-25 — Editing a confirmed invoice does not exist as a capability
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** a confirmed invoice.
- **Steps:** Look for any "edit" action on the confirmed invoice (kebab menu, detail page).
- **Expected:** none exists. `sales-invoices-routes.ts` defines no `PATCH`/`PUT` at all — not
  even for a draft. The only state-changing routes are `/confirm`, `/cancel` (draft only,
  `sales.invoice.delete_draft`) and `/payments`. A mistake in a draft's lines can only be fixed by
  cancelling and recreating; a confirmed invoice can only be corrected through a return/credit
  note.
- **False pass:** none — this is the correct, immutable-ledger behaviour the project's own
  invariants require ("posted entries are immutable: correct by reversal, never by edit or
  delete"). Flag it as a finding only if an edit path is ever added without a reversal underneath
  it.

---

## D. Credit control at the point of sale

### MTP-SAL-26 — Turn on credit control (setup step, not a defect)
- **Persona / permission:** company admin (`nadia.shafik`) — no seeded sales role can reach
- **Preconditions:** demo seed loaded; signed in as the company admin.
  Settings.
- **Steps:** الإعدادات → عام → الرقابة الائتمانية → toggle "تفعيل الرقابة الائتمانية" on, set
  "وضع الرقابة" (`controlMode`) to "حظر" (BLOCK), save.
- **Expected:** `creditControlEnabled: true`, `creditControlMode: "BLOCK"` persisted; every
  scenario below assumes this has been done first.
- **False pass:** none — this is precondition setup.

### MTP-SAL-27 — BLOCK mode refuses confirm over the limit
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-26 (BLOCK mode on). مجموعة الفجر التجارية has حد ائتماني 25,000.
  Create and leave as draft a manual invoice for this customer totalling more than 25,000 (e.g.
  400 units of شاي أسود 500 جم at 260 = 104,000).
- **Steps:** Confirm the invoice.
- **Expected:** `CreditLimitExceededError` → `422`, message "تجاوز الحد الائتماني بمبلغ … — الحد
  25000.00…، الرصيد المتوقع بعد هذه الفاتورة …" (`credit-check.ts`). Invoice stays «مسودة»; **no**
  stock or GL movement — the block happens before either posts, inside the same `confirm` call.
- **False pass:** the invoice confirms and only a warning banner appears — that is WARNING mode's
  behaviour (MTP-SAL-28), not BLOCK's; re-check "وضع الرقابة" is actually set to حظر.

### MTP-SAL-28 — WARNING mode confirms anyway, and says nothing on screen [finding]
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** set "وضع الرقابة" to "تحذير فقط" (WARNING). Same over-limit invoice as
  MTP-SAL-27.
- **Steps:** Confirm the invoice.
- **Expected (as built):** the `confirm` route computes and returns `creditWarning: { status:
  "warning", projectedBalance, overBy, message }` in its JSON response
  (`sales-invoices-routes.ts`, `serializeCreditWarning`) — but **no screen in
  `apps/web/src` reads the `creditWarning` field at all** (confirmed by an exhaustive grep: zero
  matches outside the route file itself). The invoice confirms, stock and GL post normally, and
  the supervisor sees nothing different from an in-limit sale.
- **False pass:** "WARNING mode is working because the invoice confirmed" — confirming is BLOCK
  mode's failure case and WARNING mode's success case for the SAME reason, which is exactly why
  the missing UI matters: WARNING mode's entire purpose is the warning, and it is silently
  dropped. A sales manager who chose WARNING over BLOCK specifically to be told, not stopped, is
  told nothing.

### MTP-SAL-29 — Credit exposure is invisible while the rep is still building the order [finding]
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** MTP-SAL-26 done, مجموعة الفجر التجارية already near/over its limit from a
  prior invoice.
- **Steps:** New invoice, pick مجموعة الفجر التجارية as العميل, add lines.
- **Expected (as built):** nothing on `SalesInvoicesScreen`'s create form shows this customer's
  balance, limit, or overdue amount (confirmed by grep: no `creditLimit`/`toCollect`/`رصيد`
  reference in the create-form component). The rep only learns the order is over limit — or, in
  WARNING mode, never learns at all — after handing it to a supervisor to confirm. The one place
  this figure IS visible before writing an order is العملاء → the customer's own detail page
  ("الرصيد المتبقي من الحد الائتماني"), which the rep would have to check separately and manually
  before starting the invoice.
- **False pass:** "the confirm-time block is enough" — the task's own dealbreaker is
  "no credit visibility at order entry"; a block that fires only after the order is fully built
  and handed off is a wasted trip, not point-of-sale visibility.

### MTP-SAL-30 — Credit limit of zero means unlimited, by design
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-26 (any mode). A customer with "الحد الائتماني" left at 0 (the
  add-customer form's default).
- **Steps:** Confirm a large invoice for that customer.
- **Expected:** no block/warning regardless of amount — `checkCustomerCredit` short-circuits to
  `"ok"` whenever `creditLimit.scaled <= 0n` (`credit-check.ts` docstring: "0... means unlimited,
  not 'block everything'"). This matches every seeded customer having a nonzero limit already, so
  a brand-new customer created with the field left blank is silently unlimited.
- **False pass:** none — documented, intentional behaviour; the finding is only that a rep adding
  a new customer might not realise leaving credit limit blank means "no limit" rather than "no
  credit".

---

## E. Price lists and promotions

### MTP-SAL-31 — A customer's assigned price list overrides the item default
- **Persona / permission:** company admin (only role with `sales.price_list.manage`), then
- **Preconditions:** demo seed loaded; signed in as the company admin for step 1.
  مندوب مبيعات
- **Steps:**
  1. As admin, المبيعات → قوائم الأسعار → "قائمة أسعار جديدة", add a line: زيت عباد الشمس 1 لتر
     at 80.00 (item default is 95.00).
  2. Assign this list to شركة الأمل للتجارة (customer edit form's "priceListId").
  3. As مندوب مبيعات, create an invoice for this customer with a line of زيت عباد الشمس 1 لتر.
- **Expected:** the line prices at 80.00, not 95.00 — `resolvePriceListPriceSchema`/
  `resolvePrice` resolves the customer's own list. On confirm, if the rep had instead typed
  95.00, the response's `pricingVariances` array would name the line, `listPrice: "80.00"`,
  `chargedPrice: "95.00"` (D35's fix) — but nothing BLOCKS charging off-list; it is surfaced,
  not enforced.
- **False pass:** the invoice prices correctly but no `pricingVariances` entry appears when the
  rep deliberately overrides it — that would mean D35's variance surfacing regressed silently.

### MTP-SAL-32 — A minimum-quantity tier inside a price list
- **Persona / permission:** company admin
- **Preconditions:** MTP-SAL-31's list, add a second line for the same item: minQty 50, price
  75.00.
- **Steps:** Resolve price for qty 60 vs qty 10.
- **Expected:** qty 60 resolves to 75.00 (the tier it reaches); qty 10 resolves to 80.00 (falls
  back to the base line, `resolvePriceTier`).
- **False pass:** qty 10 resolves to 75.00 — that would mean the tier floor isn't respected.

### MTP-SAL-33 — Auto-applying promotion (no coupon)
- **Persona / permission:** مندوب مبيعات, then مشرف المبيعات
- **Preconditions:** `SUMMER10` is live for the invoice date (2026-08-19 through 2026-12-31),
  scoped to ITEM-DEMO-4 (شاي أسود 500 جم), min invoice value 2000.
- **Steps:** Build and confirm an invoice for شاي أسود 500 جم, quantity ≥ enough to clear 2,000
  EGP before discount (e.g. 8 units × 260 = 2,080).
- **Expected:** on confirm, `appliedPromotion` is populated with `code: "SUMMER10"`,
  `discountTotal` = 10% of the qualifying line(s); the invoice detail shows "العرض المطبَّق" and
  "خصم العرض". `promotionDiscountTotal` in `totals` reflects it, separate from any line/header
  discount.
- **False pass:** the discount applies but the invoice total does not actually drop by that
  amount versus an identical invoice with the promotion inactive — recompute both grand totals.

### MTP-SAL-34 — Coupon-gated promotion requires the code
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** `BULK15` (`code: "BULK15"` doubles as the coupon), `requiresCoupon: true`,
  min qty 20 on ITEM-DEMO-1.
- **Steps:**
  1. Build an invoice with 25 units of ITEM-DEMO-1, "كود الكوبون" left empty. Confirm.
  2. Repeat with "كود الكوبون" = `BULK15`.
- **Expected:** (1) confirms with no promotion applied — "a promotion that requires a coupon
  never applies to a document that carries none" (seed comment). (2) confirms with the 15%
  discount applied, capped at `maxDiscountAmount` 500 regardless of how large 15% of the line
  would otherwise be.
- **False pass:** case (1) still discounts 15% — the coupon requirement is decorative.

### MTP-SAL-35 — Promotion priority when more than one qualifies
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** an invoice whose lines could qualify for more than one active promotion at
  once.
- **Steps:** Confirm it.
- **Expected:** exactly one promotion applies — `evaluateBestPromotion` picks by `priority`
  (`BULK15` priority 5, `COMBO` priority 3). No invoice ever stacks two promotions.
- **False pass:** both promotions' discounts appear summed into one total.

---

## F. Payments and the customer as a selling tool

### MTP-SAL-36 — Record a partial collection against a confirmed invoice
- **Persona / permission:** مشرف المبيعات or any role with `sales.invoice.edit`
- **Preconditions:** a confirmed invoice, grand total 1,083.00.
- **Steps:** Open the invoice, "تحصيل" a partial amount, e.g. 500.00, choose a treasury account
  and payment method, submit.
- **Expected:** a REAL confirmed collection voucher is created and allocated to this invoice —
  **two numbers that must agree:** the invoice's `amountPaid` (now 500.00) and the treasury
  account's balance movement (+500.00) from the SAME voucher id returned in the response. Status
  moves to «مدفوعة جزئياً», `remainingBalance` = 583.00.
- **False pass:** `amountPaid` increments but no voucher id comes back, or the voucher exists but
  is not allocated to this invoice — the route explicitly refuses (`503
  COLLECTION_UNAVAILABLE`) rather than doing this old broken way (D1's fix); a false pass here
  would be finding some OTHER code path that still increments `amountPaid` directly.

### MTP-SAL-37 — Customer detail shows credit remaining net of live invoices, not opening balance
- **Persona / permission:** مندوب مبيعات (has `sales.customer.view`)
- **Preconditions:** demo seed loaded.
- **Steps:** Open شركة الأمل للتجارة's customer detail after MTP-SAL-17 and MTP-SAL-36 have run
  against it.
- **Expected:** "الرصيد المتبقي من الحد الائتماني" = creditLimit − (openingBalance + every live
  invoice's remaining balance − confirmed returns − allocated cheques), computed fresh
  (`customerOwedById`), not against the stale opening balance alone (D40's fix, per the
  component's own comment).
- **False pass:** the figure only reflects `openingBalance` and never moves after MTP-SAL-17
  confirms a new invoice against this customer.

### MTP-SAL-38 — Customer statement (كشف حساب) reconciles to the aging report
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** a customer with invoices, a confirmed return, and an allocated payment (e.g. after MTP-SAL-17, MTP-SAL-36, MTP-SAL-43 all run against Al Amal Trading).
- **Steps:** Open a customer with invoices, returns, and an allocated payment; open the "كشف
  حساب" tab, note the closing balance; separately open التقارير → أعمار الديون → العملاء for the
  same customer.
- **Expected:** the two closing figures agree exactly — the statement "reconciles the closing
  figure against `GET /reports/aging/customers`" by design (`CustomersScreen.tsx`'s module
  comment).
- **False pass:** they differ by exactly the amount of one document type (e.g. a confirmed
  return) — that is the "two numbers disagree because they mean different things" trap; check
  whether one includes drafts/cancellations the other excludes before calling it a bug.

### MTP-SAL-39 — "فاتورة جديدة" from the customer's own page carries the customer forward
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** demo seed loaded.
- **Steps:** From a customer's detail page, click "فاتورة جديدة" (`customers.action.newInvoice`).
- **Expected:** the invoice create form opens pre-filled with this customer already selected —
  navigation passes `prefill: { customerId }`.
- **False pass:** the form opens blank and the rep has to re-pick the customer — that would mean
  the customer file is not actually acting as a selling tool the way the button implies.

### MTP-SAL-40 — Outstanding incoming cheques reduce, not inflate, what a customer owes
- **Persona / permission:** مندوب مبيعات
- **Preconditions:** a customer who has handed over an unbounced incoming cheque against an
  invoice, still uncollected.
- **Steps:** Open العملاء list, read the "المستحق" column for this customer.
- **Expected:** the cheque's amount is already subtracted — an incoming, non-bounced cheque
  credits AR the moment it is received (`apps/web/src/lib/partner-balances.ts`), so "المستحق" is
  net of it, not double-counting an invoice that is really already covered.
- **False pass:** a bounced cheque is ALSO subtracted — check `effectiveStatus !== "bounced"` is
  actually excluded; a bounced cheque should put the debt back.

---

## G. Sales returns and refunds

### MTP-SAL-41 — A rep cannot open the returns list either [twin of MTP-SAL-09]
- **Persona / permission:** مندوب توزيع (`sales.return.view_own`, `.create` — never
- **Preconditions:** demo seed loaded.
  `sales.return.view`) or مندوب مبيعات (holds neither `.view` nor `.view_own` for returns at all)
- **Steps:** Sign in as سلمى فؤاد, open المبيعات → مرتجعات المبيعات.
- **Expected (as built):** `GET /sales-returns` gates on plain `gate("sales.return.view")`
  (`sales-returns-routes.ts` line ~187) — same single-tier shape as MTP-SAL-09/11/12. `VAN_SALES`
  holds only `.view_own` and is refused `403`. (`SALES_REP` cannot even reach this screen's
  create action — it holds no `sales.return.*` permission in the seed at all.)
- **False pass:** none — this is a straight repeat of the finding, cited here because it sits on
  a different route file and would otherwise look like a one-off.

### MTP-SAL-42 — Create a return from an invoice (مرتجع من فاتورة), partial quantity
- **Persona / permission:** مشرف المبيعات (holds `sales.return.view`, `.confirm`; use the
  company admin login for the `create` step itself, since no seeded non-admin role holds
  `sales.return.create` — verify against `access.ts` before assuming a specific login covers
  both create and confirm)
- **Preconditions:** MTP-SAL-17's confirmed invoice (5× سكر أبيض, 2× شاي أسود).
- **Steps:** المبيعات → مرتجعات المبيعات → "مرتجع جديد", "الفاتورة المصدر" = that invoice,
  request 2 units of سكر أبيض back with a سبب, "المستودع" = the receiving warehouse. Save as
  draft.
- **Expected:** the line's `qty` is 2, `availableQty` is derived from the invoice server-side
  (`resolveAvailableQty` reads `line.qty.subtract(line.alreadyReturnedQty)`), unit price/cost/tax
  share are copied off the invoice line, not typed. Draft status.
- **False pass:** the draft accepts a client-typed `availableQty`/price that does not match the
  invoice — the `/from-invoice` route path (the one the UI actually calls) derives every figure
  server-side specifically to prevent this (comment: "Every figure that matters... is read off
  the invoice HERE").

### MTP-SAL-43 — Confirm the return: stock, AR and the source invoice's remaining balance all move
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-42's draft.
- **Steps:** Confirm the return.
- **Expected:** **three things move together, or the return has not really happened:** (1) stock
  on-hand for سكر أبيض rises by 2 in the receiving warehouse; (2) a balanced GL entry posts,
  crediting AR (or the equivalent) by the return's grand total; (3) the SOURCE invoice's own
  `remainingBalance` on `GET /sales-invoices/:id` drops by the same figure —
  `sales-invoices-routes.ts` nets `returnedCredit` off `remainingBalance` for exactly this reason
  ("a confirmed return credits the customer's receivable... has to come off what the invoice
  still says is owed").
- **False pass:** stock moves and the return's own GL posts, but the ORIGINAL invoice still shows
  its full original balance as outstanding — check the invoice screen again after confirming the
  return, not just the return's own screen.

### MTP-SAL-44 — Returning more than was sold, or already returned, is refused
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-43's return already confirmed (2 of 5 سكر أبيض returned).
- **Steps:** Create a second return from the SAME invoice for 4 more units of سكر أبيض (2 already
  returned + 4 requested = 6, more than the 5 originally sold).
- **Expected:** `buildSalesReturnLinesFromInvoice` computes what remains returnable as
  `line.qty.subtract(line.alreadyReturnedQty)` = 3, and the requested 4 exceeds it — the route
  returns `NO_RETURNABLE_LINES` (422) or trims to what is actually left, never allowing the total
  returned to exceed what was invoiced. This is D-fix territory: "the same goods returnable
  forever" was the worst defect this codebase ever had, validated against a client-supplied
  `availableQty`; confirm here that the number actually used is server-computed, not whatever the
  request claims.
- **False pass:** posting a raw `POST /sales-returns` (not `/from-invoice`) with a
  self-declared `availableQty` of, say, 999 and a `qty` of 4 succeeds — that is the API's
  lower-trust path for editions with no invoices module wired; confirm the UI never reaches it
  (it only calls `/from-invoice`) and, if it must be tested directly, that a wired invoices module
  still recomputes `availableQty` and does not just echo the claim (`resolveAvailableQty` falls
  back to the claim ONLY when `invoices` is not configured — verify it is configured here).

### MTP-SAL-45 — Refund to the customer posts a real payment voucher
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-43's confirmed return, awaiting refund.
- **Steps:** On the return's detail, "استرداد للعميل" section: choose الخزينة, طريقة الدفع, enter
  an amount up to "المتبقي للرد", submit.
- **Expected:** a confirmed رد مبلغ لعميل voucher posts — the till falls by the amount, AR is
  debited by the same figure, in one balanced entry (route comment). `awaitingRefund` clears (or
  partially reduces) and the return's `refundedTotal` updates.
- **False pass:** the return's screen shows "تم إنشاء سند الصرف..." but the treasury account's own
  balance does not actually drop — the refund route CONFIRMS the voucher, it does not just draft
  it, so this should be immediate.

### MTP-SAL-46 — Refunding more than is due is refused
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-45's return, now fully refunded.
- **Steps:** Attempt a second refund on the same return.
- **Expected:** `assertRefundable` throws `SalesReturnNotRefundableError` (422) — what remains
  refundable is recomputed from the posted return and the vouchers already posted against it,
  never from the request body (route comment mirrors MTP-SAL-44's pattern exactly).
- **False pass:** the refund succeeds and the treasury account is drained twice for one return.

### MTP-SAL-47 — Cancel a draft return
- **Persona / permission:** anyone with `sales.return.void`
- **Preconditions:** a fresh draft return (e.g. MTP-SAL-42 without confirming).
- **Steps:** On a still-draft return, cancel it.
- **Expected:** status «ملغي», no stock/GL/AR effect ever happened (it was never confirmed).
- **False pass:** none.

---

## H. Van sales (رحلات المندوبين)

### MTP-SAL-48 — Van warehouse type exists but nothing enforces it [finding]
- **Persona / permission:** company admin
- **Preconditions:** none.
- **Steps:** `POST /field/vans` with a `warehouseId` pointing at a warehouse whose `type` is
  `"MAIN"` (e.g. the Giza warehouse `WH-DEMO-2`), not `"VAN"`.
- **Expected (as built):** it succeeds. `createVan` (`packages/domain/src/field-sales/van.ts`)
  validates only that the ids are non-empty strings — it never checks the referenced warehouse's
  `type`. The catalog genuinely models a 5-type warehouse taxonomy including `VAN` (ڤان — سيارة
  توزيع), and the SEEDED van correctly uses a `type: "VAN"` warehouse, but nothing in the domain
  or the route layer would refuse a van bound to a `MAIN` warehouse instead.
- **False pass:** "the seed only ever uses a VAN-typed warehouse, so this must be enforced" — the
  seed choosing the right type is not the same as the system requiring it; test the create call
  directly with a mismatched type.

### MTP-SAL-49 — Opening a trip transfers stock AND cash float in one cascade
- **Persona / permission:** مندوب توزيع
- **Preconditions:** `VAN-01` exists; main warehouse holds ≥10 units of ITEM-DEMO-2.
- **Steps:** رحلات المندوبين → "فتح رحلة": "الڤان *" = VAN-01 (this auto-fills warehouse/till —
  `CascadedValue` shows them read-only, resolved server-side, not chosen independently), "مستودع
  التحميل *" = main warehouse, "خزينة المصدر *" = main cash till, "العهدة النقدية" = 500.00,
  crew = سلمى فؤاد (rep), load 10× زيت عباد الشمس 1 لتر.
- **Expected:** **two things move together:** stock for زيت عباد الشمس transfers out of the
  loading warehouse and into `WH-DEMO-VAN` (a real `postTransfer`, not a label change), and
  500.00 transfers from the source till into the van's till (`TR-DEMO-VAN`). The trip opens in
  status «جارية».
  **cascade check:** attempt the same POST but naming a warehouse/till that does NOT belong to
  `VAN-01` — refused with `VAN_CASCADE_MISMATCH` (422), "المستودع المحدد لا يخص المركبة", rather
  than silently overwriting the mismatch (`resolveVanCascade`).
- **False pass:** the trip opens and stock drops from the source warehouse, but on-hand in
  `WH-DEMO-VAN` never actually rises — that would mean the "transfer" is really just an issue
  with no matching receipt, the exact van-sales analogue of "fixes stock but not the balance".

### MTP-SAL-50 — Record a roadside cash sale mid-trip
- **Persona / permission:** مندوب توزيع
- **Preconditions:** MTP-SAL-49's open trip.
- **Steps:** On the trip detail, "تسجيل حركة نقدية": النوع = بيع, المبلغ = 150.00, submit.
- **Expected:** the movement appears in "الحركات النقدية" and — critically — is POSTED into the
  van's treasury account immediately (`recordCashTaking`, per the D22 fix documented in
  `field-sales-routes.ts`: "Without it the trip document was the only record of them... every
  completed trip drove the van's cash account down by exactly what it sold"). The posting happens
  BEFORE the movement is persisted to the trip, so a refused posting leaves no orphan movement.
- **False pass:** the movement shows in the trip's own list but the van treasury account's balance
  is unchanged — that is exactly D22 un-fixed.

### MTP-SAL-51 — Settle a trip: cash AND stock variance both land, using the seeded settled trip
- **Persona / permission:** مندوب توزيع
- **Preconditions:** `TRIP-DEMO-1` — already settled in the seed with opening float 1000.00 + one
  200.00 cash-sale movement (expected cash 1200.00) but only 950.00 counted (variance −250.00),
  and 20 loaded / 18 counted for ITEM-DEMO-1 (variance −2), 30 loaded / 30 counted for
  ITEM-DEMO-3 (no variance).
- **Steps:** Open `TRIP-DEMO-1`'s "التسوية" tab.
- **Expected:** "المتوقع" 1,200.00, "المعدود" 950.00, "الفرق" −250.00 for cash; the stock table
  shows ITEM-DEMO-1 at expected 20 / counted 18 / variance −2, and ITEM-DEMO-3 at 30/30/0. This
  is a REAL recorded settlement, not a live re-computation — reload the page and confirm the same
  figures persist (`trip.settlement`, not derived on the fly).
- **False pass:** the shortfall (250.00 cash, 2 units of stock) is shown on screen but never
  actually posted anywhere — check whether `recordCashVariance` wrote the difference off the van
  treasury; if that dependency is unwired in this deployment, the settlement recomputes a number
  the ledger never records (the same shape as the VAT-return finding: right on screen, absent
  from the books).

### MTP-SAL-52 — A still-open trip: selling from van stock draws the settlement's expected qty down
- **Persona / permission:** مندوب توزيع
- **Preconditions:** `TRIP-DEMO-2`, still جارية, 10× شاي أسود loaded into `WH-DEMO-VAN`.
- **Steps:**
  1. As سلمى فؤاد, create and confirm a sales invoice with "المستودع" = `WH-DEMO-VAN`, line: 3×
     شاي أسود, customer of choice.
  2. Settle `TRIP-DEMO-2` with a stock count reflecting 7 remaining (10 − 3 sold).
- **Expected:** step 1 is an ordinary confirmed sales invoice that happens to draw stock from the
  van's own warehouse — `SALES_REP`/`VAN_SALES` both hold `sales.invoice.create`+`.confirm` for
  this. Step 2's "المتوقع" for شاي أسود reads 7 (10 loaded − 3 already issued by the confirmed
  invoice), matching what was actually counted, so variance is 0.
- **False pass:** step 2's "المتوقع" still reads 10 — that would mean the settlement's expected
  quantity does not account for confirmed van-warehouse sales made mid-trip, silently reporting a
  fictitious 3-unit shortfall.

---

## I. Reports

### MTP-SAL-53 — Sales-by-salesperson report reconciles to the invoice list
- **Persona / permission:** مشرف المبيعات (holds `sales.invoice.view`, unlike a rep — see
- **Preconditions:** MTP-SAL-17/27 confirmed invoices exist.
  MTP-SAL-12)
- **Steps:** Open التقارير → المبيعات حسب المندوب for the period covering MTP-SAL-17/27's
  invoices; separately filter فواتير المبيعات by the same salesperson and date range and sum
  `totals.grandTotal` by hand for the confirmed ones.
- **Expected:** the report's per-salesperson total matches the hand-summed figure exactly — both
  ultimately read the same `deps.salesInvoices.list()`.
- **False pass:** the report includes draft/cancelled invoices in its salesperson totals (they
  are not real sales) — check status filtering.

### MTP-SAL-54 — Top products / by-item reports reflect posted revenue, not list price
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-33 promoted, confirmed invoice exists.
- **Steps:** Open المبيعات حسب الصنف for a period containing a promoted invoice (MTP-SAL-33).
- **Expected:** the reported revenue reflects the discounted amount actually posted
  (`postedGross` reads the real GL revenue accounts), not qty × item list price.
- **False pass:** the figure equals qty × list price for a line that carried a promotion —
  that means the report is computing off the un-discounted line rather than what was posted.

### MTP-SAL-55 — Aging customers report ladders match total receivable
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** MTP-SAL-38 mixed customer history exists.
- **Steps:** Open أعمار الديون → العملاء; sum every bucket for one customer.
- **Expected:** the sum equals that customer's "المستحق" on the customers list (MTP-SAL-38's
  reconciliation, from the report side this time).
- **False pass:** the two differ because one is "trade AR" and the other a broader subtree sum —
  per the project's own prior finding (two figures differing 5,486.12 for exactly this reason) —
  check what each number counts before treating a mismatch as a bug.

### MTP-SAL-56 — Drill-down from a customer report row opens its real documents
- **Persona / permission:** مشرف المبيعات
- **Preconditions:** at least one confirmed sales report row naming a customer.
- **Steps:** From any sales report row naming a customer, use the drill-down affordance.
- **Expected:** `GET /reports/drill-down/customer/:id` returns real facts (phone, credit limit,
  billed, outstanding) and a document list of that customer's actual invoices — resolved from
  posted records, never re-sliced from whatever page happened to be loaded in the browser
  (route's own comment).
- **False pass:** the drill-down shows documents that do not belong to this customer, or misses
  ones outside the currently-loaded report page — the whole point of a server-side drill-down is
  that it is not limited to what the report happened to page in.

---

## Gaps — no screen to test

These are real, verified absences — not oversights in this plan. Each was checked by grep across
`apps/web/src/screens`, `apps/web/src/pages`, and `packages/api/src/*-routes.ts`.

- **Commission (عمولة).** No commission concept exists anywhere in the codebase — no domain
  module, no route, no field on an invoice or a rep. `salespersonId`/`salespersonNameAr` on a
  sales invoice is the only link between a sale and a person; nothing computes what that person
  is owed for it. **Cost of shipping without it:** every payout becomes a manual spreadsheet
  reconciliation against the "sales by salesperson" report, and every dispute over a rate,
  a return's clawback, or a split sale has no system record to point to — the report gives raw
  revenue per rep, not commission, and a return (MTP-SAL-43) has no mechanism to claw a
  commission back even conceptually.
- **Targets / quotas (مستهدف).** No target, quota, or goal-tracking concept exists — no field on
  a rep or a period, no screen, no route. A rep has no way to see how they are doing against a
  number set for them; a manager has no screen to set one. The "sales by salesperson" report is
  the closest substitute and shows only what happened, never what was expected.
- **Sales order (أمر بيع) as a distinct document.** The chain in this codebase is
  عرض سعر → فاتورة مسودة → فاتورة مؤكدة; there is no separate "confirmed order, not yet invoiced"
  state. Converting a quote produces a draft INVOICE directly (`sales-quotes-routes.ts`
  `/convert-to-invoice`), not an order.
- **Delivery note (إذن تسليم) and partial delivery/invoicing.** There is no separate delivery/
  goods-issue document for sales (the purchase side has إذن استلام via goods receipts; sales has
  no counterpart). A quote converts to exactly ONE invoice for its full quantity
  (`markConverted` is a one-way, one-shot status transition — MTP-SAL-08) and a sales invoice has
  no split/partial-fulfillment mechanism. Confirming an invoice both books the sale AND issues
  the stock in the same step — there is no way to invoice now and deliver later, or deliver part
  of an order and invoice the rest separately.
- **Van registry (المركبات) management screen.** `POST /field/vans` and `GET /field/vans` exist
  and are fully wired, but no screen in `apps/web/src/screens` calls either — `VanTripsScreen.tsx`
  only reads an existing van list to populate the trip form's "الڤان" picker. A van can only be
  created through the raw API (as the demo seeder does), never through the product.
- **Branches (الفروع) management screen.** `branches-routes.ts` exists (`admin.branches.view`/
  `.create`) but no `apps/web/src/screens` or `apps/web/src/pages` component calls it. The demo
  tenant has exactly one branch (`BR-MAIN`) and no in-product way to add a second one to actually
  exercise branch-scope visibility end to end.
- **"Usually buys" / basket-affinity on the customer file.** The customer detail page shows
  invoices, a statement, installments, returns and audit history — but nothing summarising what
  this customer typically orders (top items, average order size, order cadence). A rep preparing
  for a visit has to read the raw invoice list and infer it.
- **"Last visit" (آخر زيارة).** CRM activities (`ActivitiesScreen.tsx`) exist for leads and
  opportunities but nothing ties a logged activity to an existing customer record or surfaces
  "last visited on" on the customer detail page.
