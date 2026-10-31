# Manual test plan — Egyptian tax specialist review

Scope: would Mezan's output survive a tax inspection, and does it keep the client
compliant with the Egyptian Tax Authority (مصلحة الضرائب المصرية / ETA)? Every
scenario below is grounded in code that exists in this tree — screens under
`apps/web/src/screens`, routes under `packages/api/src`, and the domain logic
they call. Journeys with no screen are listed separately in the final section
rather than written as scenarios.

**Preconditions common to all scenarios**, unless a scenario states otherwise:
- Backend seeded with `MEZAN_SEED_DEMO=1` (`pnpm --filter @mezan/backend
  demo-seed` or the app's own seed-on-first-run path).
- Signed in as the seeded company-admin, `admin@cyag.example`, password `Cyag@2026` —
  holds every permission, including `accounting.eta.view` /
  `accounting.eta.submit` / `accounting.eta.cancel`.
- Tenant VAT rate `VAT14` (14%, `ضريبة القيمة المضافة`) is the only tax rate
  seeded by default; the demo tenant additionally seeds `TABLE5` (5%, `ضريبة
  الجدول`) and a compounding group `TXG-DEMO-1` (`قيمة مضافة + ضريبة جدول`,
  effective 19.7%). Every seeded item, invoice and receipt line otherwise
  carries 14% — scenarios that need a 0%, 5% or mixed-rate document say so
  explicitly and build it as their own first step.
- The ETA module (`الفاتورة الإلكترونية`) is pre-configured by the seed:
  `taxRegistrationNumber` 100200300, `activityCode` 4610,
  `autoSubmitOnConfirm: true`, and four items (`ITEM-DEMO-1..4`, i.e. IT-0001
  through IT-0004) carry an EGS item code — the rest of the catalogue does
  not, so the readiness meter starts below 100%.

---

## A. VAT on sales invoices — per-line correctness

### MTP-TAX-01 — Standard-rate invoice charges 14% on the line net, not the total
- **Persona / permission:** `sales.invoice.create`, `sales.invoice.confirm`.
- **Preconditions:** seeded demo tenant.
- **Steps:**
  1. Open **فواتير المبيعات** (Sales Invoices) → **فاتورة جديدة**.
  2. Choose customer "مؤسسة النور للمقاولات" (`CUST-DEMO-2`, not tax-exempt).
  3. Add line item "أرز أبيض 5 كجم" (IT-0001), quantity 10, at its seeded
     price 180.
  4. Add a second line item "زيت عباد الشمس 1 لتر" (IT-0002), quantity 5, at
     its seeded price 95.
  5. Leave the invoice-level discount at 0. Read the totals panel on the
     right.
  6. Save as draft, then **تأكيد الفاتورة**.
- **Expected:** subtotal = (10×180) + (5×95) = 2,275.00. VAT = 2,275.00 ×
  14% = 318.50. Grand total = 2,593.50. On the confirmed invoice's detail
  page, the tax breakdown shows exactly one row: 14%, base 2,275.00, tax
  318.50 — not a figure derived from rounding the grand total by 14/114.
- **False pass:** the grand total looking right is not proof the base is
  right — recompute 2,275.00 × 0.14 by hand and compare to the displayed tax
  figure to the piastre.

### MTP-TAX-02 — Line discount reduces the taxable base before VAT applies
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** MTP-TAX-01's invoice pattern.
- **Steps:**
  1. New sales invoice, same customer, one line: IT-0001, quantity 10, price
     180 (gross 1,800.00).
  2. Set the line's **نوع خصم البند** to "نسبة %" and **خصم %** to 10.
  3. Read the line's tax figure in the totals panel.
- **Expected:** line net = 1,800.00 − 180.00 (10%) = 1,620.00. Tax = 1,620.00
  × 14% = 226.80 — computed on the DISCOUNTED net, not on the 1,800.00 gross
  (which would wrongly read 252.00).
- **False pass:** a plausible-looking tax figure without checking it against
  the discounted base specifically; 252.00 would still look like "a tax
  number" to someone not doing the arithmetic.

### MTP-TAX-03 — Invoice-level discount also reduces the taxable base
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** none beyond the seed.
- **Steps:**
  1. New invoice, two lines at 14%: IT-0001 qty 10 @ 180 (1,800.00) and
     IT-0002 qty 5 @ 95 (475.00). Subtotal 2,275.00, no line discounts.
  2. Set the invoice-level **الخصم** to "مبلغ" (amount) = 275.00.
  3. Read the total tax.
- **Expected:** taxable total = 2,275.00 − 275.00 = 2,000.00. Tax =
  2,000.00 × 14% = 280.00, not 2,275.00 × 14% = 318.50.
- **False pass:** the grand total (2,280.00) looking internally consistent
  does not confirm the discount was applied BEFORE tax rather than after —
  check the tax figure specifically against the post-discount base.

### MTP-TAX-04 — Tax-inclusive pricing backs the tax out of the quoted price
- **Persona / permission:** `settings.tenant.edit`, `sales.invoice.create`.
- **Preconditions:** tenant settings §"الضريبة" has a `taxCalculation`
  (tax-inclusive vs exclusive) switch that the sales-invoice totals engine
  reads at draft time (`SalesInvoice.taxInclusive`, stamped once and never
  re-read).
- **Steps:**
  1. In Settings, switch tax calculation to inclusive (prices already
     contain VAT).
  2. Raise a new invoice, one line, IT-0001, qty 1, price 180.
  3. Read the line's tax and taxable-base figures.
- **Steps (cont'd):** compute expected tax = 180 × 14 / 114 = 22.11 (rounded
  half-up to the piastre), taxable base = 180 − 22.11 = 157.89.
- **Expected:** displayed tax = 22.11, base = 157.89, line total still 180.00
  — NOT 180 + 25.20 = 205.20, which is what exclusive-style math would wrongly
  produce on an inclusive price.
- **False pass:** the line total staying at 180.00 is not proof the split is
  right by itself — a broken split could still net to 180.00 by coincidence
  of rounding; check base + tax = 180.00 to the piastre AND that tax alone
  equals the 14/114 figure.

### MTP-TAX-05 — Half-up rounding at the piastre, not the pound
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** an item priced to produce a fractional-piastre tax.
- **Steps:**
  1. Edit item "سكر أبيض 1 كجم" (IT-0003) — briefly set its sale price to
     33.335 (a price chosen to land the 14% tax on an exact half-piastre:
     33.335 × 0.14 = 4.6669 → rounds to 4.67).
  2. Raise a one-line invoice, IT-0003, qty 1.
  3. Read the tax figure. Restore the item's price afterward.
- **Expected:** tax = 4.67 (HALF_UP to 2dp), not 4.66 (HALF_DOWN/banker's) and
  not a value truncated to whole piastres.
- **False pass:** a tax figure that merely "looks like two decimal places" —
  confirm the third decimal actually rounded up, not down, by trying a case
  exactly on the 0.005 boundary.

### MTP-TAX-06 — Negative invoice-level discount is refused, not silently inflating the total
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** none.
- **Steps:**
  1. New invoice, one line at 950.00 gross.
  2. Set invoice-level discount type to amount, and type a negative value if
     the field's spinner or keyboard allows it.
  3. Attempt to save.
- **Expected:** the discount is rejected or clamped to zero — the invoice
  total must never come out ABOVE the sum of its lines from a "negative
  discount". (This regressed once in this codebase: line-level discounts
  were bounded 0–100 while the invoice-level one was not, letting 950.00
  become 1,140.00.)
- **False pass:** the form simply not letting you type a minus sign is not
  the same as the SERVER refusing one — repeat via the API payload if the
  field itself blocks the character, since client-side input masking is not
  a compliance control.

### MTP-TAX-07 — A tax rate above 100% is accepted with no upper-bound guard (recorded finding, not a pass/fail gate)
- **Persona / permission:** `items.item.edit`, `sales.invoice.create`.
- **Preconditions:** none.
- **Steps:**
  1. Open item "خليط شاي بالسكر 1 كجم" (IT-0005) for edit.
  2. Set **نسبة الضريبة (%)** — a free `NumberField` with `min={0}` and no
     upper bound — to 999.
  3. Save the item, then raise a one-line invoice on it, qty 1, price 150.
  4. Read the invoice's tax figure. Restore the item's tax rate to 14
     afterward.
- **Expected:** the system likely accepts 999% and computes tax = 150 ×
  999% = 1,498.50 with no refusal at either the item form or the invoice
  service — `SalesInvoiceService.validate()` checks quantity, price and
  discount bounds but not `taxRatePercent`, and the contract schema is
  `z.number().min(0).optional()` with no `.max()`.
- **False pass:** treating "the invoice saved and the math is internally
  consistent" as fine — a schema-level ceiling belongs on a value that feeds
  a legal filing; its absence is the finding here, not the arithmetic.

### MTP-TAX-08 — A client cannot supply a tax AMOUNT that disagrees with rate × base
- **Persona / permission:** `sales.invoice.create`, browser devtools / a REST
  client.
- **Preconditions:** none.
- **Steps:**
  1. Inspect the create-sales-invoice request the screen sends (Network tab)
     or read `packages/contracts/src/sales-invoice.ts`
     `createSalesInvoiceLineSchema`.
  2. Confirm the line schema carries `taxRatePercent` only — there is no
     `taxAmount` or `tax` field a caller can submit directly.
  3. Attempt to POST a crafted line body that adds an extra `"tax": "1.00"`
     key alongside a `taxRatePercent` that would legitimately compute to a
     different figure.
- **Expected:** the extra key is silently stripped by the zod schema (unknown
  keys don't survive `safeParse`) and the server computes tax itself via
  `computeInvoiceTotals`, from `taxRatePercent` × the post-discount base only.
  There is structurally no path for a stored tax figure to disagree with
  rate × base on a normally-created invoice.
- **False pass:** none expected here — this is a defence to confirm, not a
  defect to find. If the crafted `tax` key EVER changes the stored figure,
  that is a severe compliance defect (a filed VAT amount an inspector can't
  reconstruct from the base and the printed rate).

### MTP-TAX-09 — Free-text item name never reaches the invoice — every line binds a real item id
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** none.
- **Steps:**
  1. New invoice. In the line's item picker, type an item name that does not
     exist, e.g. "صنف غير موجود".
  2. Try to add the line / save the draft.
- **Expected:** the line is refused or the picker offers no match to select
  — `sales.invoice.create`'s `validate()` requires `line.itemId` non-empty
  and every posted line resolves to a real `Item` for its revenue/COGS/
  inventory account mapping. A typed, non-existent item must not silently
  post with an invented id.
- **False pass:** the picker LOOKING like a free-text box while it is
  actually filtering a real list is fine; the failure mode to watch for is a
  201 response and a saved invoice line with an id that matches no row in
  الأصناف.

### MTP-TAX-10 — Tax-exempt customer zeroes every line's tax, regardless of the item's own rate
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** customer "مجموعة الفجر التجارية" (`CUST-DEMO-3`) is
  seeded with `taxExempt: true`.
- **Steps:**
  1. New invoice, customer = "مجموعة الفجر التجارية".
  2. Add IT-0001 (item's own tax rate is 14%), qty 2, price 180.
  3. Read the line and invoice totals.
- **Expected:** tax = 0.00 on every line, even though the ITEM's own
  `taxRatePercent` is 14 — `customerTaxExempt` on the invoice forces every
  line to zero at compute time (`computeInvoiceTotals({ taxExempt: true })`).
- **False pass:** the printed/detail page not clearly stating WHY the tax is
  zero (exempt customer vs. a 0%-rated item vs. a zero-rated export) — see
  MTP-TAX-13 for why that distinction matters for the return.

---

## B. VAT on purchase invoices

### MTP-TAX-11 — Manually entered purchase invoice charges input VAT per line
- **Persona / permission:** `purchases.invoice.create`.
- **Preconditions:** none.
- **Steps:**
  1. Open **فواتير المشتريات** (Purchase Invoices) → new invoice, method
     "إنشاء فاتورة جديدة" (manual).
  2. Supplier "مصنع الوادي الأخضر" (`SUPP-DEMO-1`).
  3. One line: item IT-0001, qty 50, unit cost 140, **ضريبة %** left at its
     default 14.
  4. Save and confirm.
- **Expected:** subtotal 7,000.00, input VAT 980.00, total payable
  7,980.00. GL debits input-VAT (1400 by default) 980.00 and credits AP
  7,980.00 (net of the inventory debit).
- **False pass:** the invoice total alone; check the input-VAT GL line
  specifically, since that is the figure a VAT return will later credit
  against output tax.

### MTP-TAX-12 — Create-from-receipt auto-fills the item's real tax rate, invisibly to the reviewer
- **Persona / permission:** `purchases.receipt.confirm`, `purchases.invoice.create`.
- **Preconditions:** a confirmed, uninvoiced goods receipt exists (create one
  from **استلام بضاعة** against a purchase order, or use a seeded one if
  present).
- **Steps:**
  1. New purchase invoice, method "من إيصال استلام" (from receipt).
  2. Pick the confirmed receipt. Read the **البنود ستُملأ تلقائياً**
     preview table.
  3. Note: the preview shows item, quantity and unit cost only — no tax rate
     or tax amount column.
  4. Save the invoice, then open its detail/fulfilment page and read the
     posted **ضريبة %** and totals per line.
- **Expected:** the posted invoice DOES carry the item's real
  `taxRatePercent` (14% for stock items, via `resolveTaxRate` →
  `item.taxRatePercent`) even though nothing on the create-time preview told
  the reviewer what VAT the invoice would carry before they confirmed it.
- **False pass:** treating "the preview showed nothing wrong" as
  reassurance — the preview shows nothing about tax AT ALL, which is itself
  the finding: a reviewer cannot catch a wrong item-level tax rate at the
  point they are approving the invoice, only after it posts.

### MTP-TAX-13 — Expense (non-stock) purchase line carries its own tax rate too
- **Persona / permission:** `purchases.invoice.create`.
- **Preconditions:** none.
- **Steps:**
  1. New manual purchase invoice, supplier "شركة سياج للصناعات"
     (`SUPP-DEMO-2`).
  2. Add a line of kind "مصروف" (expense) rather than inventory, description
     "صيانة"، amount 500, tax 14%.
  3. Confirm.
- **Expected:** input VAT = 70.00 posted against the general-expense debit,
  same as a stock line — expense lines are not silently excluded from the
  VAT computation.
- **False pass:** none specific; this exists because expense lines take a
  different code path (`kind: "expense"`) from inventory lines and could
  plausibly diverge.

### MTP-TAX-14 — Purchase invoice line tax rate has no upper bound either
- **Persona / permission:** `purchases.invoice.create`.
- **Preconditions:** none.
- **Steps:**
  1. New manual purchase invoice. On the line's **ضريبة %** `NumberField`
     (`min={0}`, no max), type 150.
  2. Save.
- **Expected:** likely accepted with no refusal, same gap as MTP-TAX-07 on
  the sales side.
- **False pass:** none — recorded finding.

### MTP-TAX-15 — A goods receipt cannot be invoiced twice (double input-VAT claim)
- **Persona / permission:** `purchases.invoice.create`.
- **Preconditions:** a confirmed goods receipt already invoiced once (e.g.
  the one used in MTP-TAX-12).
- **Steps:**
  1. Start a second "from receipt" purchase invoice.
  2. Try to pick the SAME receipt again in the picker.
- **Expected:** the receipt does not appear (or the create is refused with an
  "already invoiced" error) — an already-invoiced receipt must not be
  selectable, which would otherwise let a business claim the same input VAT
  twice against the same physical delivery.
- **False pass:** the receipt simply not showing up is correct; a 201 that
  creates a second invoice against it is the specific defect to watch for.

### MTP-TAX-16 — Purchase invoice payment status does not move the ledger by itself
- **Persona / permission:** `purchases.invoice.edit`.
- **Preconditions:** a confirmed purchase invoice with an outstanding
  balance.
- **Steps:**
  1. Open the invoice, use the payment-recording action.
  2. Record a partial payment.
  3. Cross-check: open **السندات** (treasury vouchers) or the AP sub-ledger
     for the same supplier.
- **Expected:** the payment is backed by an actual treasury voucher /
  journal entry — never a status flag ("مدفوع جزئياً") flipped with no cash
  movement recorded.
- **False pass:** the invoice's own payment-status pill changing colour;
  confirm the GL entry and treasury balance moved by the same amount.

---

## C. Mixed rates, exempt vs zero-rated, and the D28 rate-tagging fix

The domain now tags every journal line with `taxRatePercent`
(`packages/domain/src/journal.ts`) specifically so the VAT return can group
by the RATE THE LINE WAS ACTUALLY CHARGED, rather than deriving one blended
rate by dividing an entry's total tax by its total base. This class of
scenario is the regression guard for that fix (D28) — and probes where the
same fix did NOT reach.

### MTP-TAX-17 — A single invoice at two different rates reports as two rows, not one blended rate
- **Persona / permission:** `taxes.rate.create` (or Taxes screen access),
  `sales.invoice.create`.
- **Preconditions:** create the fixture as step 1 below.
- **Steps:**
  1. Open **الضرائب** (Taxes) → tab **معدلات الضريبة** → **إضافة ضريبة**.
     Create a second rate: name "ضريبة 5%", code `ZERO5DEMO`, rate 5,
     "غير شاملة" (exclusive), leave ETA sub-type "تلقائي".
  2. Edit item IT-0002 ("زيت عباد الشمس 1 لتر") and set its **نسبة الضريبة
     (%)** to 5 (matching the new rate).
  3. New sales invoice, customer `CUST-DEMO-2`: line 1 = IT-0001 (14%) qty
     10 @ 180 (1,800.00 base, 252.00 tax); line 2 = IT-0002 (now 5%) qty 4 @
     95 (380.00 base, 19.00 tax).
  4. Confirm the invoice. Restore IT-0002's tax rate to 14 afterward.
  5. Open Financial Reports → **إقرار ضريبة القيمة المضافة** (VAT return),
     period covering today.
- **Expected:** the "ضريبة المخرجات" group shows TWO rows — 14% (base
  1,800.00, tax 252.00) and 5% (base 380.00, tax 19.00) — never a single
  blended row (which the old derivation would have reported as ~6.3% on
  2,180.00, matching no real rate and no line).
- **False pass:** a single row whose NET tax figure (271.00) happens to
  equal the sum of the two real taxes — the total can accidentally match
  while the rate and the per-rate base are both wrong; check that two rows
  exist and that each rate/base pair is exact.

### MTP-TAX-18 — Exempt-customer 0% line and a standard 14% line in the same return period stay separated
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** none beyond the seed.
- **Steps:**
  1. Raise and confirm an invoice for `CUST-DEMO-2` (not exempt): IT-0001
     qty 1 @ 180, tax 14% → base 180.00, tax 25.20.
  2. Raise and confirm a second invoice, same day, for `CUST-DEMO-3`
     (`taxExempt: true`): IT-0001 qty 1 @ 180 → base 180.00, tax 0.00.
  3. Open the VAT return for the period covering both.
- **Expected:** a 14% row with base 180.00 / tax 25.20 and, separately, the
  exempt invoice's base is either excluded from the taxable-base KPI or
  reported at 0% — but never merged into the 14% row's base (which would
  overstate the 14% taxable base by 180.00 with no matching tax).
- **False pass:** the "net payable" KPI looking correct — it can be right by
  coincidence when only tax amounts are compared; check the BASE figures
  per row, since a padded 14% base with unchanged tax is exactly the shape
  an inspector would flag.

### MTP-TAX-19 — Rounding a mixed-rate invoice: per-line rounding does not compound into the total
- **Persona / permission:** `sales.invoice.create`.
- **Preconditions:** same 5%-item fixture as MTP-TAX-17 (recreate if not
  still present).
- **Steps:**
  1. Line A: IT-0001, 14%, price 33.335 (as in MTP-TAX-05) — tax rounds to
     4.67 on qty 1.
  2. Line B: IT-0002 at 5%, price 33.335 — tax = 33.335 × 5% = 1.66675 →
     rounds to 1.67.
  3. Confirm. Read the invoice grand total and the VAT return's two rows for
     this period.
- **Expected:** invoice tax total = 4.67 + 1.67 = 6.34 exactly (each line
  rounds independently at the `TAX_COMPUTATION` boundary, then sums) —
  not a total re-rounded from a summed unrounded figure (4.6669 + 1.66675 =
  6.33365 → would wrongly round to 6.33). The return's two rows show 4.67
  and 1.67 respectively, summing to the same 6.34.
- **False pass:** the total merely being "close" — 6.33 vs 6.34 is exactly
  the kind of one-piastre drift an ETA reconciliation would reject; check
  the exact figure, not an approximately-right one.

### MTP-TAX-20 — A credit note (sales return) spanning two VAT rates loses the rate breakdown in the ledger
- **Persona / permission:** `sales.return.create`, `sales.return.confirm`.
- **Preconditions:** the confirmed mixed-rate invoice from MTP-TAX-17 (or a
  fresh equivalent — recreate the 5%-item fixture if needed).
- **Steps:**
  1. Open **مرتجعات المبيعات** (Sales Returns) → create from that invoice.
  2. Return both lines in full.
  3. Confirm the return.
  4. Open the journal entry the return posted (via **دفتر اليومية** or the
     return's linked GL entry) and inspect the output-VAT line.
  5. Re-open the VAT return for the period and look at how the return's tax
     is reflected.
- **Expected (what to actually check):** `SalesReturnLine` carries a
  computed `taxAmount` per line (correct proportionally), but the GL POSTING
  (`packages/domain/src/sales-returns/sales-return-document.ts`) sums ALL
  lines' tax into a SINGLE journal line crediting the output-VAT account,
  with no `taxRatePercent` tag — unlike the sales-invoice posting, which
  tags each rate's line separately. A multi-rate credit note therefore has
  no per-rate journal line for the VAT return to key off, and the report
  falls back to its old tax-÷-base derivation for that one entry.
- **False pass:** the return's total credit to AR/output-VAT looking right —
  that total is genuinely correct; the finding is that the RETURN'S
  CONTRIBUTION to the VAT return's per-rate rows is a blended-rate artefact
  again, the exact D28 shape, just scoped to returns rather than invoices.
  Verify by checking whether the return's 14%-and-5% portions actually land
  in the 14% and 5% rows, or in one synthetic rate that matches neither.

### MTP-TAX-21 — Purchase return (debit note) has the identical gap on the input side
- **Persona / permission:** `purchases.return.create`, `purchases.return.confirm`.
- **Preconditions:** a confirmed purchase invoice with two different tax
  rates on its lines (build one manually: two lines, 14% and a second at 5%
  using the ZERO5DEMO rate from MTP-TAX-17, or two lines that otherwise
  differ in rate).
- **Steps:**
  1. Create a purchase return from that invoice, both lines, full quantity.
  2. Confirm.
  3. Inspect the posted journal entry's input-VAT line.
- **Expected:** `packages/domain/src/purchase-returns/purchase-return-document.ts`
  shows the same pattern as MTP-TAX-20 — one aggregate `taxValue` credited to
  input-VAT, no per-line rate tag, so a multi-rate debit note's tax cannot be
  attributed to the right rate row on the return either.
- **False pass:** same as MTP-TAX-20 — the AP/input-VAT total is right, the
  per-rate attribution is not.

### MTP-TAX-22 — A tax group's compounded rate never actually reaches an invoice line
- **Persona / permission:** `taxes.group.view`.
- **Preconditions:** the seeded tax group `TXG-DEMO-1` ("قيمة مضافة +
  ضريبة جدول", VAT14 + TABLE5 compounding to an effective 19.7%).
- **Steps:**
  1. Open **الضرائب** → tab **مجموعات الضرائب** and confirm the group and
     its 19.7% effective rate are visible.
  2. Open a new sales invoice or purchase invoice line and look for any way
     to select a TAX GROUP (rather than a single flat rate) on the line.
- **Expected:** no such control exists — `SalesInvoiceLine.taxRatePercent`
  and `PurchaseInvoiceLine.taxRatePercent` are both single numbers, sourced
  from the ITEM's own `taxRatePercent`, never from a `taxGroupId`. The tax
  group is master data with no consumer anywhere in sales or purchases.
- **False pass:** none — this is a confirmed gap, kept here (rather than in
  the final Gaps section) because the master-data SCREEN for it does exist
  and is testable; only the downstream consumption is missing. A tenant that
  genuinely needs a compounding tax (VAT + ضريبة الجدول on select goods) has
  no way to charge it correctly on a document today.

### MTP-TAX-23 — Two active 0% tax rates can misclassify a line's ETA VAT sub-type by numeric coincidence
- **Persona / permission:** `taxes.rate.create`, `items.item.edit`,
  `sales.invoice.create`.
- **Preconditions:** none beyond the seed.
- **Steps:**
  1. Create tax rate A: code `EXEMPT0`, rate 0, ETA sub-type "V003 — معفى"
     (exempt).
  2. Create tax rate B: code `ZERORATE0`, rate 0, ETA sub-type "V001 —
     تصدير (سلع)" (zero-rated export).
  3. Set item IT-0003's tax rate to 0 (matches both A and B's numeric rate).
  4. Raise and confirm an invoice on IT-0003 with `autoSubmitOnConfirm` on
     (seeded true).
  5. Inspect which ETA sub-type the queued submission actually used — this
     is not shown on any screen directly, so check via the ETA submissions
     list's internal id and cross-reference against
     `packages/backend/src/create-backend.ts`'s enqueue bridge, which
     resolves the sub-type via
     `taxRates.find((r) => r.status === "active" && r.rate === line.taxRatePercent)`
     — i.e. by NUMERIC RATE MATCH, not by the item's actual chosen tax-rate
     ROW.
- **Expected finding:** because the lookup matches by `rate === 0` alone and
  takes the FIRST active row found, an item legitimately exempt (V003) can
  be filed as zero-rated-export (V001) or vice versa, depending purely on
  which 0% rate happens to have been created first / sorts first — with no
  way for the item or the invoice line to say which 0% treatment it means.
- **False pass:** the submission reaching status "جاهز"/being queued at all
  — that only proves SOMETHING was filed, not that the correct VAT
  sub-type classification (which materially changes what the return implies
  about export eligibility vs. domestic exemption) was used.

---

## D. VAT return ties to the ledger, not to a derived figure

### MTP-TAX-24 — VAT return's output-tax KPI matches GL account 2200 (or its configured equivalent) for the period
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** at least one confirmed sales invoice in the period.
- **Steps:**
  1. Open Financial Reports → **إقرار ضريبة القيمة المضافة**, set the period
     to the current month.
  2. Note "ضريبة المخرجات" (output tax) KPI.
  3. Open **دفتر الأستاذ** (general ledger) for the output-VAT account for
     the same period and sum its credit movements.
- **Expected:** the two figures match exactly.
- **False pass:** approximate agreement — any gap at all means the return
  is not reconcilable to the ledger it claims to summarise, which is a
  direct audit failure.

### MTP-TAX-25 — VAT return's net-payable sign matches "مستحق للمصلحة" vs "قابل للاسترداد" correctly
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** a period where input tax exceeds output tax (e.g. right
  after a large purchase invoice with no matching sales).
- **Steps:**
  1. Confirm a large purchase invoice with no offsetting sale in the same
     period.
  2. Open the VAT return for that period.
- **Expected:** "صافي الضريبة" shows negative / tone "success" (refundable),
  matching `vatNetPayable = output − input < 0`. A positive figure in this
  state would misstate a refundable position as a liability.
- **False pass:** the number's magnitude alone; the SIGN and its associated
  label are the actual compliance content here (a business that files a
  liability it doesn't owe, or misses a refund it's owed, both cost money).

### MTP-TAX-26 — The dashboard's VAT tile does not double-count both tax sides
- **Persona / permission:** any with dashboard access.
- **Preconditions:** confirmed sales and purchase invoices exist (seeded).
- **Steps:**
  1. Open the main dashboard, find the VAT-related tile.
  2. Compare its figure against the VAT return's "صافي الضريبة" for the same
     period.
- **Expected:** the two agree. (This codebase previously had a dashboard VAT
  tile that summed BOTH output and input tax — a figure with no accounting
  meaning — showing e.g. 24,983 "due" while the return correctly showed
  12,072.20 refundable; confirm that class of bug has not returned.)
- **False pass:** a large, official-looking number on the dashboard being
  mistaken for "the VAT due" without checking it against the return.

### MTP-TAX-27 — Entries posted before the rate-tagging fix still report through the old fallback, clearly enough to be found
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** the demo seed's historical sales/purchase invoices
  (several months of trading, seeded via `demo-seed/history.ts`) — these
  predate nothing in particular here since the tenant is freshly seeded, but
  serve as a large, uniform-14% population to sanity-check the return's
  volume against.
- **Steps:**
  1. Open the VAT return for a wide period covering the seeded trading
     history (e.g. the whole fiscal year).
  2. Confirm every row is at a real, round rate (14%, 5%, 0%) — none at an
     odd derived percentage like 6.3% or 11.8%.
- **Expected:** every row's rate is a rate that exists in **الضرائب**. A row
  at an odd percentage is itself evidence the fallback derivation fired on
  an entry with no rate tag.
- **False pass:** none expected on a freshly-seeded tenant (the seed posts
  uniformly at 14%) — this scenario is the regression tripwire for a future
  change that stops tagging `taxRatePercent` on some code path.

### MTP-TAX-28 — Withholding-tax report reconciles to GL 2210, not the other way around
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** at least one payment voucher with withholding applied
  (build one per Section E).
- **Steps:**
  1. Open Financial Reports → **ضريبة الخصم والتحصيل** (withholding tax).
  2. Note the "إجمالي المستقطع" KPI.
  3. Open the GL for account 2210 (ضريبة خصم وتحصيل مستحقة) for the same
     period and sum its credit movements.
- **Expected:** the two agree exactly. The report's own doc comment states
  it derives from VOUCHERS, not GL 2210, specifically so the two are an
  independent cross-check — a hand-written journal entry that touches 2210
  directly would create a visible gap here.
- **False pass:** trusting either figure alone; the whole point of this
  report is that it is built from a DIFFERENT source than the account it's
  compared against.

---

## E. Withholding tax (خصم وتحصيل تحت حساب الضريبة) on supplier payments

### MTP-TAX-29 — A payment voucher withholds tax and discharges the supplier in full
- **Persona / permission:** `vouchers.payment.create`.
- **Preconditions:** a confirmed purchase invoice with an outstanding
  balance owed to "مصنع الوادي الأخضر" (`SUPP-DEMO-1`) — use the one from
  MTP-TAX-11.
- **Steps:**
  1. Open **السندات** (Treasury Vouchers) → create a سند صرف (payment) type
     voucher.
  2. Amount = 7,980.00 (the full invoice total from MTP-TAX-11).
  3. Set **نسبة ضريبة الخصم %** to 1 (a plausible commercial-goods WHT
     rate — see the finding in MTP-TAX-30 about there being no rate
     schedule to pick from).
  4. Supplier = SUPP-DEMO-1, treasury account = the seeded main account,
     confirm.
  5. Read the "الصافي المدفوع" figure and open the posted journal entry.
- **Expected:** withheld = 7,980.00 × 1% = 79.80. GL: credit WHT-payable
  (2210) 79.80, credit/debit cash 7,900.20 (7,980.00 − 79.80), and the
  SUPPLIER's account is discharged for the FULL 7,980.00 (`voucher-document.ts`
  §"the supplier is discharged in full — while only amount − withholdingAmount
  leaves the till"). Confirm the supplier's outstanding balance drops by the
  full 7,980.00, not by the net 7,900.20.
- **False pass:** checking only the cash figure — the supplier's AP balance
  is the one an inspector (or the supplier themselves, demanding their
  certificate) will actually care about; it must show the invoice as FULLY
  settled.

### MTP-TAX-30 — Withholding rate is free-typed with no rate schedule by service type
- **Persona / permission:** `vouchers.payment.create`.
- **Preconditions:** none.
- **Steps:**
  1. Start a new payment voucher, direction "صرف" (the only direction the
     withholding field appears for).
  2. Look at the **نسبة ضريبة الخصم %** control.
- **Expected finding:** it is a plain `NumberField` (`vouchers.withholdingRate`)
  with a hint text only ("يُسدَّد المورد بالكامل ويُحتجز الفرق لمصلحة
  الضرائب") — there is no picker over Egypt's actual WHT rate schedule
  (0.5% commercial goods, 1% general contracting/supplies, 3% professional
  services, 5% consultancy, etc.), and no link from the SUPPLIER or the
  underlying purchase to a "service type" that would drive the correct rate.
  The user must know and type the right percentage themselves every time.
- **False pass:** a correctly-computed 79.80 in MTP-TAX-29 does not mean the
  RATE chosen was the legally correct one for that supplier's service —
  the system has no way to catch a wrong rate typed with confidence.

### MTP-TAX-31 — No withholding-tax certificate is generated for the supplier
- **Persona / permission:** `vouchers.payment.create`.
- **Preconditions:** the confirmed voucher from MTP-TAX-29.
- **Steps:**
  1. Open the confirmed voucher's detail view.
  2. Look for any "شهادة خصم" / certificate print or export action, separate
     from the general **طباعة** (print) row action.
  3. Use the general print action and inspect what it renders.
- **Expected finding:** there is no certificate document at all — grep
  confirms no "شهادة"/"certificate" concept anywhere in
  `apps/web/src/screens` or `packages/domain/src`. The general voucher print
  is a generic receipt, not the formal withholding certificate Egyptian
  suppliers require to reclaim the withheld amount against their own tax.
- **False pass:** the voucher printing SOMETHING — that something is not the
  legally-specific document a supplier will actually ask for.

### MTP-TAX-32 — A collection voucher (receipt) does not expose a withholding field, correctly
- **Persona / permission:** `vouchers.receipt.create`.
- **Preconditions:** none.
- **Steps:**
  1. Start a new treasury voucher of a receipt/collection type
     ("تحصيل"), not payment.
  2. Look for the withholding-rate field.
- **Expected:** the field is absent — the screen only shows it when
  `def.direction === "payment"`. Egyptian WHT applies to what a BUSINESS
  PAYS out, not what it collects; a receipt voucher exposing a withholding
  control would be the more severe error to test for. Confirm its absence.
- **False pass:** none — this is a confirm-the-negative scenario.

### MTP-TAX-33 — Withholding on a zero-rate voucher does not post a WHT line at all
- **Persona / permission:** `vouchers.payment.create`.
- **Preconditions:** none.
- **Steps:**
  1. New payment voucher, leave **نسبة ضريبة الخصم %** at its default 0.
  2. Confirm.
  3. Inspect the journal entry.
- **Expected:** no line touches GL 2210 at all — `withholdingOf()` returns
  `{ withholdingAmount: null, ... }` when the rate is 0/unset, so a normal
  payment with no withholding does not manufacture a spurious zero-value tax
  line.
- **False pass:** a phantom 0.00 WHT line appearing anyway — harmless in
  amount but would misstate the withholding-tax report's voucher count if
  the report doesn't also filter zero rows (it does — confirm the withholding
  report excludes it too, per `filter((r) => r.withheldAmount.scaled > 0n)`).

### MTP-TAX-34 — Withholding GL account is required before a withheld voucher can confirm
- **Persona / permission:** `vouchers.payment.create`.
- **Preconditions:** none (this checks a domain guard, exercised through the
  normal UI path since the screen always supplies the withholding account
  when a rate is set).
- **Steps:**
  1. Set a non-zero withholding rate on a payment voucher and confirm
     normally through the UI.
- **Expected:** succeeds, because the screen always sets
  `withholdingGlAccountId` alongside a non-zero rate. This scenario exists
  to document the guard (`voucher-document.ts`: "a withholding voucher needs
  a withholding-tax GL account") as the reason a rate can never silently
  post with nowhere for the money to land — not something reachable via the
  UI, but worth knowing the floor exists.
- **False pass:** none — informational.

---

## F. Credit and debit notes — corrections happen through returns, never edits

### MTP-TAX-35 — A confirmed sales invoice cannot be edited; there is no route for it
- **Persona / permission:** `sales.invoice.edit` (the permission exists;
  the route does not).
- **Preconditions:** a confirmed invoice, e.g. from MTP-TAX-01.
- **Steps:**
  1. Open the confirmed invoice's detail page.
  2. Look for any field that becomes editable, or any "تعديل" action.
  3. Cross-check against `packages/api/src/sales-invoices-routes.ts`: the
     only mutating routes past creation are `/:id/confirm`, `/:id/cancel`
     and `/:id/payments` — there is no `PUT`/`PATCH` on a sales invoice at
     all.
- **Expected:** no edit surface exists anywhere, in the UI or the API. The
  only way to change a confirmed invoice's content is a sales return
  (`إشعار خصم`) or cancelling it outright.
- **False pass:** none — this is a confirm-the-negative scenario and, if it
  ever fails (an edit route appears), it is an automatic dealbreaker.

### MTP-TAX-36 — Correcting an over-charged invoice goes through a سند مرتجع, and reduces AR correctly
- **Persona / permission:** `sales.return.create`, `sales.return.confirm`.
- **Preconditions:** a confirmed invoice, e.g. MTP-TAX-01's (2,593.50 total).
- **Steps:**
  1. Open **مرتجعات المبيعات** → create from invoice, return one line
     partially (e.g. 3 of the 10 IT-0001 units).
  2. Confirm the return.
  3. Check the original invoice's remaining balance and the customer's AR.
- **Expected:** AR drops by exactly the returned line's price + its
  proportional tax (3 × 180 × 1.14 = 615.60); the ORIGINAL invoice is
  untouched (same docNo, same original lines, same original total) — the
  return is a new document, not a mutation.
- **False pass:** the AR figure moving by roughly the right amount without
  checking that the original invoice's own stored total is unchanged.

### MTP-TAX-37 — A sales return never auto-refunds cash — it only reduces the receivable until a separate refund step
- **Persona / permission:** `sales.return.confirm`.
- **Preconditions:** the confirmed return from MTP-TAX-36, on an ALREADY-PAID
  invoice (pick a fully-paid seeded invoice, or pay MTP-TAX-01's invoice in
  full first, then return a line).
- **Steps:**
  1. Confirm a return against an invoice that is already fully paid.
  2. Check whether cash moves automatically.
  3. Look for a separate **استرداد** (refund) action on the return.
- **Expected:** the return only debits AR/credits revenue+tax by itself; no
  cash account moves until the explicit `/:id/refund` action is taken
  separately (`sales-returns/refund.ts`: "the credit note and the cash leave
  [separately]").
- **False pass:** treasury balance appearing to move at the moment of
  RETURN confirm rather than at the moment of REFUND confirm — that would
  be moving money the business hasn't actually decided to hand back yet.

### MTP-TAX-38 — No print output exists for a credit note (إشعار خصم)
- **Persona / permission:** `sales.return.view`.
- **Preconditions:** the confirmed return from MTP-TAX-36.
- **Steps:**
  1. Open the confirmed sales return's detail page.
  2. Look for any print / طباعة action equivalent to the sales invoice's.
- **Expected finding:** none exists — `apps/web/src/screens/SalesReturnsScreen.tsx`
  has no print path, unlike `apps/web/src/print/sales-invoice-print.ts` for
  invoices. A credit note is a legally significant document (it is what
  substantiates a reduced VAT liability to an inspector) and currently
  cannot be produced as a compliant printed page — no seller/buyer TRN, no
  tax breakdown, no reference to the original invoice number on a page a
  customer or auditor can be handed.
- **False pass:** the general "طباعة" browser print of the LIST screen —
  that is a list export, not a per-document legal print.

### MTP-TAX-39 — A confirmed sales return is never queued to ETA, even though the ETA domain models a credit-note type for it
- **Persona / permission:** `sales.return.confirm`, `accounting.eta.view`.
- **Preconditions:** the confirmed return from MTP-TAX-36 (ETA
  `autoSubmitOnConfirm` is seeded true).
- **Steps:**
  1. Confirm a sales return.
  2. Open **الفاتورة الإلكترونية** → tab **الإرسالات** (submissions).
  3. Search/filter for the return's internal id.
- **Expected finding:** no row appears. `EtaSubmissionDocumentType` includes
  `"credit_note"` (label "إشعار خصم") and the payload builder maps it to
  ETA's document-type code `"C"`, but the ONLY place anything ever calls
  `EtaService.enqueue` is the sales-INVOICE confirm bridge in
  `packages/backend/src/create-backend.ts` — gated on
  `event.docType !== "SALES_INVOICE"`. A confirmed sales return never
  reaches this bridge, manually or automatically, so credit notes are
  entirely absent from e-invoicing. Egyptian ETA requires credit/debit notes
  to be filed the same as invoices; this is a direct filing gap.
- **False pass:** the return posting successfully to the ledger — that
  proves the ACCOUNTING side works, not that the authority was ever told
  about it.

### MTP-TAX-40 — A confirmed purchase return (debit note) has the identical ETA gap
- **Persona / permission:** `purchases.return.confirm`.
- **Preconditions:** a confirmed purchase return.
- **Steps:**
  1. Confirm a purchase return.
  2. Check the ETA submissions queue for it.
- **Expected finding:** same as MTP-TAX-39 — `documentType: "debit_note"`
  exists in the domain model and nowhere is it ever enqueued. (Debit notes
  from the buyer's side are less commonly the buyer's own filing obligation
  under ETA — the supplier normally issues the credit note — so this is
  lower-severity than MTP-TAX-39, but confirm the assumption rather than
  taking it on faith, since Mezan models the type as if it intended to file
  one.)
- **False pass:** none — recorded finding, severity to be judged against
  which party's filing obligation this actually is.

---

## G. ETA e-invoicing (الفاتورة الإلكترونية)

### MTP-TAX-41 — THE ONLINE TRANSMIT IS STUBBED — no invoice can actually reach the authority
- **Persona / permission:** `accounting.eta.submit`.
- **Preconditions:** any confirmed sales invoice queued as "جاهز" (ready).
- **Steps:**
  1. Open **الفاتورة الإلكترونية** → **الإرسالات**.
  2. Pick a "جاهز" row → row action **إرسال** (submit).
  3. Read the result.
- **Expected finding:** the submission does NOT go through. `EtaService`'s
  default transmit port (`stubOnlineTransmitPort`) unconditionally throws
  `EtaOfflineError`, and the route maps that to HTTP 202 with the submission
  left queued; the UI shows "eta.actualSubmissionNeedsALive"
  ("Actual submission needs a live [connection]"). Confirm this is the
  outcome on EVERY submit attempt, not an occasional network hiccup — this
  is a code-level stub, not a live integration that sometimes fails.
- **False pass:** the queue STATE changing (e.g. showing "queued" or
  disappearing from a filter) being read as "it was sent" — nothing in this
  build ever calls the real ETA gateway. This is the single most severe
  finding in this plan: a product positioned as Egypt-first has no WORKING
  path to actually file an e-invoice, only a fully-built queue that always
  refuses at the last step.

### MTP-TAX-42 — The demo-only "accept" callback can simulate authority acceptance, and must not be mistaken for a real one
- **Persona / permission:** `accounting.eta.submit`.
- **Preconditions:** a "جاهز" submission.
- **Steps:**
  1. Note that `POST /eta/submissions/:id/accept` exists specifically for
     demo/testing (per the route's own comment) and requires a caller-
     supplied `etaUuid` in the body — there is no UI button that calls it.
  2. Confirm no screen exposes this action (grep
     `apps/web/src/screens/EtaScreen.tsx` for "accept" — it isn't there).
- **Expected:** this endpoint is reachable only by direct API call, never
  from the app. Its existence is fine for automated testing; its absence
  from the UI is correct (it must not be a button an end user could press
  to fake authority acceptance).
- **False pass:** none — confirm-the-negative.

### MTP-TAX-43 — Submitting the same confirmed invoice twice is refused (no duplicate ETA submission)
- **Persona / permission:** `sales.invoice.confirm`, `accounting.eta.submit`.
- **Preconditions:** a confirmed invoice already queued (internal id =
  its `docNo`).
- **Steps:**
  1. Confirm an invoice normally (auto-queues once, per seeded
     `autoSubmitOnConfirm`).
  2. Attempt to trigger a second enqueue for the same document — e.g. by
     cancelling and re-confirming it if the workflow allows re-confirm, or
     by checking that a re-submit through **إرسال** on the SAME already-
     queued row does not create a SECOND row.
  3. Check the submissions list for duplicate internal ids.
- **Expected:** `EtaService.enqueue` throws `DuplicateEtaSubmissionError`
  when a submission with the same `internalId` already exists, and the
  enqueue bridge in `create-backend.ts` explicitly swallows that specific
  error ("a document already queued — a re-confirm after an approval — is
  not an error") rather than surfacing it as a failure. Confirm the
  submissions list never shows two rows for the same invoice number.
- **False pass:** a visible error toast on the second attempt being read as
  "broken" — the correct behaviour here is SILENT idempotence for the
  legitimate re-confirm-after-approval case, not a user-facing rejection.

### MTP-TAX-44 — A submission with errors can be corrected and requeued
- **Persona / permission:** `accounting.eta.submit`.
- **Preconditions:** a submission in status "أخطاء" (error) — since the
  transmit is stubbed, this state must be reached artificially: use the
  `/accept` test endpoint or check `SubmissionsTab`'s `actionable()` logic,
  which treats `"ready" | "pending_signature" | "error"` as re-submittable.
- **Steps:**
  1. Filter the submissions list by status "أخطاء" (chip filter).
  2. Confirm the row's **الأخطاء** column shows the rejection reason(s),
     joined and readable.
  3. Use row action **إرسال** again.
- **Expected:** the row is actionable from error status — a rejected
  document is not a dead end, it can be resubmitted after correction.
- **False pass:** an empty submissions list under this filter being read as
  "the app has no errored submissions to worry about" — on a build where
  transmit is always stubbed offline, this state may never be naturally
  reachable in the seeded tenant, which is itself worth flagging (see
  Gaps section).

### MTP-TAX-45 — Excluding a document from ETA requires a reason, and the reason is retained
- **Persona / permission:** `accounting.eta.cancel`.
- **Preconditions:** a "جاهز" submission.
- **Steps:**
  1. Row action **استبعاد** (exclude) on a ready submission.
  2. Try to confirm with an empty reason field.
  3. Type a reason, e.g. "فاتورة تجريبية، لا تُرسل"، confirm.
- **Expected:** the empty-reason attempt is blocked (button/flow requires
  non-empty text); after confirming, the submission's status becomes
  "مستبعد" and its `exclusionReason` is retrievable (not surfaced directly
  in the list columns shown, but stored per `EtaSubmission.exclusionReason`
  — confirm via the detail if any, or note it is not visible without one).
- **False pass:** the row simply disappearing from the default "all" view
  being mistaken for a soft-delete — it should remain visible under an
  "مستبعد" filter, auditable, not erased.

### MTP-TAX-46 — Readiness meter correctly reflects unmapped items, units and branches
- **Persona / permission:** `accounting.eta.view`.
- **Preconditions:** the seed leaves ITEM-DEMO-5/6/9 etc. unmapped and no
  unit mapped.
- **Steps:**
  1. Open **الفاتورة الإلكترونية** → tab **عام** (general), read the
     **الجاهزية** percentage in the header.
  2. Open tab **ربط الأصناف** (item mapping), toggle **غير المربوطة فقط**
     (unmapped only), and count the rows.
  3. Cross-check the count against the readiness meter's implied gap.
- **Expected:** readiness is below 100%; the unmapped-item count on this tab
  matches `itemsMissingCode` in `computeEtaReadiness`. Register one item's
  code via the row's inline **نوع الكود / كود الصنف لدى المصلحة / كود GPC**
  fields and confirm the count decreases by exactly one and the readiness
  percentage increases.
- **False pass:** a readiness number that never changes when you fix an item
  — the meter must be LIVE against the same data the tab edits, not a
  cached/stale snapshot.

### MTP-TAX-47 — تطبيق الاقتراحات (apply suggestions) maps units in bulk, but only where a suggestion exists
- **Persona / permission:** `accounting.eta.submit`.
- **Preconditions:** at least one unmapped unit whose code/name the
  suggestion heuristic (`suggestEtaUnitCode`) can resolve (e.g. "PCS" /
  "قطعة" should suggest a piece-equivalent authority code), and at least one
  it cannot.
- **Steps:**
  1. Open tab **ربط الوحدات** (unit mapping).
  2. Note which units already show a **الاقتراح** (suggestion) column value.
  3. Click **تطبيق الاقتراحات**.
  4. Re-check the unit list.
- **Expected:** every unit that HAD a suggestion is now mapped to it; units
  with no resolvable suggestion remain unmapped and are reported back
  (`unresolved`) rather than silently skipped with no trace.
- **False pass:** the button appearing to "finish" the job — if any unit
  used on a live invoice line is left unmapped, that invoice's ETA payload
  will carry a raw internal unit code instead of the authority's, per
  `unitByCode.get(unitCode) ?? unitCode` falling back to the internal code.

### MTP-TAX-48 — A VAT rate left on "تلقائي" (auto) sub-type is flagged, not silently resolved wrong
- **Persona / permission:** `accounting.eta.view`.
- **Preconditions:** the seed comment states "the VAT rate is still on
  auto" for VAT14.
- **Steps:**
  1. Open tab **عام** → the **أنواع الضريبة الفرعية** (tax sub-types) table.
  2. Find VAT14's row.
- **Expected:** it shows a warning-toned "تلقائي" pill (`StatusPill tone="warning"`)
  rather than a resolved V009/V004 label — a visible signal that this rate's
  ETA classification has not been explicitly decided by the tenant. Cross-
  reference against MTP-TAX-23: "auto" resolution for a NON-zero rate is
  benign (it always resolves to V009 basic-sales at submission time per
  `resolveEtaVatSubType`), but for a 0% rate "auto" is exactly the ambiguity
  MTP-TAX-23 exploits.
- **False pass:** the warning pill being read as "broken" — it is working as
  designed, flagging an UNRESOLVED classification; the actual risk is a
  tenant ignoring it forever on a 0%-rated item.

### MTP-TAX-49 — Branch without a registered ETA branch code cannot be silently invoiced through
- **Persona / permission:** `accounting.eta.submit`.
- **Preconditions:** a second branch with no ETA branch code registered (add
  one via **الفروع** if only the main branch exists, or note the main
  branch's own registered code "1" from the seed and reason about a
  hypothetical unregistered second branch).
- **Steps:**
  1. Open tab **عام** → **أكواد الفروع لدى المصلحة**.
  2. Confirm the main branch shows code "1" (seeded).
  3. If a second branch exists with no code: raise and confirm a sales
     invoice from it, then check the resulting ETA payload's issuer
     address `branchId`.
- **Expected:** an invoice from a branch with no registered ETA code still
  queues (the enqueue bridge uses
  `branchCodes.find(...)?.etaBranchCode ?? null`), but the payload's
  `branchId` is `null` — which the real ETA gateway would reject. Confirm
  the readiness meter's `branchesMissingCode` counts this branch, so the
  gap is at least visible before the (currently stubbed) transmit step
  would fail against it.
- **False pass:** the invoice confirming without any warning being read as
  "fine" — check the readiness meter specifically, since nothing at
  invoice-confirm time itself blocks or warns about a missing branch code.

---

## H. The printed invoice — legally required content

### MTP-TAX-50 — The printed sales invoice carries both parties' tax registration numbers
- **Persona / permission:** `sales.invoice.view`.
- **Preconditions:** the confirmed invoice from MTP-TAX-01, customer
  `CUST-DEMO-2` (seeded `taxNumber: "300998877665"`).
- **Steps:**
  1. Open the invoice detail page, row action **طباعة**.
  2. Inspect the print preview.
- **Expected:** the seller block shows the tenant's own
  `taxRegistrationNumber` ("203-456-789", from settings) and the buyer block
  shows the customer's `taxNumber` ("300998877665") — both required for the
  document to substantiate input-VAT recovery on the CUSTOMER's own return.
- **False pass:** the invoice printing at all — check specifically that
  BOTH tax numbers are present; either one missing invalidates the document
  for the counterparty's own filing.

### MTP-TAX-51 — Printed tax breakdown groups by the rate actually charged, matching the on-screen totals
- **Persona / permission:** `sales.invoice.view`.
- **Preconditions:** the mixed-rate invoice from MTP-TAX-17 (recreate if not
  present).
- **Steps:**
  1. Print the mixed-rate invoice.
  2. Compare the printed tax-breakdown rows against the on-screen totals
     panel from MTP-TAX-17.
- **Expected:** two rows, 14% and 5%, matching the same base/tax figures as
  the return in MTP-TAX-17 — the print model explicitly groups
  `byRate` from each line's own `taxRatePercent`
  (`apps/web/src/print/sales-invoice-print.ts`), the same fix class as D28.
- **False pass:** a single blended tax line on the printed page while the
  screen correctly shows two — that would mean the print path regressed
  independently of the report/GL path.

### MTP-TAX-52 — Printed line "code" is the internal item id, not the item's own code or its ETA authority code
- **Persona / permission:** `sales.invoice.view`.
- **Preconditions:** an invoice on an item whose `id` and `code` differ
  visibly, e.g. IT-0001 (`id: "ITEM-DEMO-1"`, `code: "IT-0001"`, ETA code
  `EG-100200300-1001`).
- **Steps:**
  1. Print an invoice containing IT-0001.
  2. Read the line's item-code column.
- **Expected finding:** it shows `"ITEM-DEMO-1"` (the internal id, per
  `salesInvoicePrintModel`'s `code: line.itemId`) — not `"IT-0001"` (the
  item's own human code) and not `"EG-100200300-1001"` (the item's mapped
  ETA authority code, which is what a real e-invoice submission actually
  files under `itemCode`). The printed page and the ETA payload disagree
  about what "the item code" is for the same line.
- **False pass:** SOME code being present on the printed line — check it is
  the RIGHT one; a plausible-looking alphanumeric string is exactly what a
  wrong-but-present code looks like from a glance.

### MTP-TAX-53 — Amount-in-words is refused on a negative total rather than printing nonsense
- **Persona / permission:** `sales.invoice.view`.
- **Preconditions:** none directly printable (sales invoices cannot go
  negative through normal creation) — this documents a defensive guard.
- **Steps:**
  1. Review `apps/web/src/print/sales-invoice-print.ts`'s
     `amountInWords: grandTotal >= 0 ? amountInWords(grandTotal) : undefined`.
- **Expected:** confirmed as a code-level guard; a negative total (which
  should never occur for a sales invoice — that shape belongs to a credit
  note) prints no amount-in-words rather than an incoherent one. No manual
  UI reproduction is meaningful here since the invoice document type cannot
  go negative; recorded as a guard to know exists.
- **False pass:** none — informational.

---

## I. Foreign-currency documents

### MTP-TAX-54 — A USD sales invoice's own totals and AR sub-ledger agree, converted at the confirmed rate
- **Persona / permission:** `sales.invoice.create`, `exchange-rates.rate.view`.
- **Preconditions:** customer "شركة دلتا للتصدير" (`CUST-DEMO-USD`, currency
  USD), and a locked exchange rate for USD on today's date (create one via
  **أسعار الصرف** if none is locked).
- **Steps:**
  1. New sales invoice, customer = Delta Export Co., currency USD.
  2. One line, any item, qty 10, price 20.00 (USD). Tax 14%.
  3. Confirm.
  4. Read the invoice's own grand total (in USD) and compare to the AR
     sub-ledger / GL 1105 movement (in EGP).
- **Expected:** invoice grand total = 200.00 × 1.14 = 228.00 USD. GL AR
  movement = 228.00 × the RATE THE INVOICE CONFIRMED AT (`fxRate`, stamped
  once and never re-read even if the rate later changes) —
  `salesInvoiceBaseGrandTotal` converts per LINE (tax total + each line's
  taxable base) and sums, the same order the GL posting uses, so the two
  must agree to the last unit, not just approximately.
- **False pass:** the USD figure alone looking right; the compliance
  question is whether the EGP figure booked to the ledger is defensible —
  check it against `fxRate × 228.00` by hand.

### MTP-TAX-55 — The ETA payload mislabels a foreign-currency line's price as EGP
- **Persona / permission:** `accounting.eta.view` + code inspection (this
  finding is not independently visible on any screen).
- **Preconditions:** the USD invoice from MTP-TAX-54, `autoSubmitOnConfirm`
  seeded true.
- **Steps:**
  1. Confirm the USD invoice (it auto-queues to ETA).
  2. Open **الإرسالات** and find the row — note the submissions list shows
     internal id / type / status / authority id / errors ONLY, no amount
     and no currency column at all.
  3. Cross-reference the code: `buildEtaPayload` in
     `packages/domain/src/eta/payload.ts` hardcodes
     `unitValue: { currencySold: "EGP", amountEGP: l.unitPrice }` for every
     line, and the enqueue bridge in `create-backend.ts` passes
     `line.unitPrice` — which for a USD invoice is the USD price, not a
     converted EGP figure — straight through with no `fxRate` field
     anywhere in the payload.
- **Expected finding:** a USD invoice's ETA submission would file its line
  prices as if they were EGP amounts, with no currency conversion applied
  and no FX rate carried in the document at all — the authority would
  receive, for a 20.00-USD-priced line, a filing that claims 20.00 EGP.
- **False pass:** the submission appearing in the queue with no visible
  error — the queue's list columns cannot show this defect at all; it is
  only visible by reading the payload-construction code, which is exactly
  why it survived: nothing in the UI would ever surface it, and the
  (stubbed) transmit step never runs to have the authority reject it either.

### MTP-TAX-56 — A foreign-currency invoice still splits its VAT rate breakdown correctly (in its own currency)
- **Persona / permission:** `sales.invoice.view`.
- **Preconditions:** the USD invoice from MTP-TAX-54.
- **Steps:**
  1. Print the USD invoice.
  2. Read the tax breakdown and currency label.
- **Expected:** the breakdown is in USD (matching `ctx.currencyLabel`), the
  14% row's base/tax figures match the invoice's own USD totals — the
  per-rate grouping fix (D28's class) applies regardless of currency, since
  it keys off `taxRatePercent` on the line, which is currency-independent.
- **False pass:** none specific; this is a positive confirmation alongside
  the MTP-TAX-55 negative finding, so the two are not conflated — the
  PRINTED page is fine; the ETA PAYLOAD is not.

### MTP-TAX-57 — A foreign-currency purchase invoice's input VAT converts through the same path
- **Persona / permission:** `purchases.invoice.create`.
- **Preconditions:** supplier "مورد المعدات الدولي" (`SUPP-DEMO-USD`,
  currency USD).
- **Steps:**
  1. New manual purchase invoice, that supplier, currency USD, one line at
     14%.
  2. Confirm.
  3. Compare the invoice's own USD tax total against the EGP figure the GL
     debited to the input-VAT account.
- **Expected:** the EGP figure equals the USD tax × the invoice's confirmed
  rate, to the unit — same reconciliation discipline as MTP-TAX-54, on the
  input side.
- **False pass:** the AP total alone; check the input-VAT GL line
  specifically since that's the figure a VAT return period-reconciliation
  (MTP-TAX-24's purchase-side equivalent) depends on.

---

## J. Numbering — gapless, auditable, immutable once posted

### MTP-TAX-58 — Sales-invoice numbers are sequential and gapless across two confirms
- **Persona / permission:** `sales.invoice.confirm`.
- **Preconditions:** none.
- **Steps:**
  1. Confirm one draft invoice, note its `INV-######` number.
  2. Confirm a second draft invoice immediately after.
  3. Confirm the second number is the first's + 1, with no gap.
- **Expected:** consecutive numbers — `SALES_INVOICE`'s sequence
  (`INV-`, pad 6, no annual reset) is allocated via `NextNumber`'s
  transactional counter, inside the same transaction as the document
  insert, per `docs/archive/plan.md` §2.3 rule 5.
- **False pass:** none beyond confirming no gap; a gap here is an automatic
  dealbreaker (an unexplained missing invoice number is exactly what a VAT
  audit flags first).

### MTP-TAX-59 — A cancelled draft invoice never consumed a number
- **Persona / permission:** `sales.invoice.delete_draft`.
- **Preconditions:** none.
- **Steps:**
  1. Note the next expected invoice number (confirm one invoice to see the
     sequence, or check **إعدادات → تسلسلات الترقيم**'s preview for
     `SALES_INVOICE`).
  2. Create a NEW draft, do NOT confirm it, cancel it instead.
  3. Confirm a different draft.
- **Expected:** the confirmed invoice gets the number that was next BEFORE
  the cancelled draft existed — a draft that never confirms must never have
  reserved a sequence number, since `docNo` is stamped "on confirm" per
  `SalesInvoice.docNo`'s own doc comment ("Sequential number stamped on
  confirm; null while draft/pending").
- **False pass:** none — a gap here specifically (skipped number with no
  audit trail explaining it) is a dealbreaker per the review brief.

### MTP-TAX-60 — Sequence prefix / pad length / annual reset are admin-editable, and the change is itself auditable
- **Persona / permission:** `settings.sequences.edit` (or whatever gates
  **إعدادات → تسلسلات الترقيم**).
- **Preconditions:** none.
- **Steps:**
  1. Open the sequences settings screen, find `SALES_INVOICE`
     ("فاتورة مبيعات", prefix `INV-`, pad 6).
  2. Edit its pad length or toggle annual reset.
  3. Confirm a new invoice and read its formatted number.
  4. Check **سجل التدقيق** (audit log) for the change.
- **Expected:** the new format applies to the NEXT number only (existing
  documents' printed numbers are untouched); the settings change itself
  appears in the audit trail — a numbering-scheme change is exactly the
  kind of event an inspector would want dated and attributed.
- **False pass:** the new format applying correctly without checking the
  audit log — a silent, unattributed numbering-scheme change is itself an
  audit red flag even if the numbers stay gapless.

### MTP-TAX-61 — A confirmed invoice's number survives a subsequent return; the return gets its OWN sequence
- **Persona / permission:** `sales.return.confirm`.
- **Preconditions:** the confirmed invoice + return pair from MTP-TAX-36.
- **Steps:**
  1. Note the invoice's `INV-######` and the return's `SRT-######` numbers.
- **Expected:** distinct sequences (`SALES_RETURN`, prefix `SRT-`) — a
  credit note is never issued under the invoice's own number or as a
  suffixed variant of it; it is independently numbered and independently
  auditable, matching how ETA expects credit notes to reference the ORIGINAL
  invoice's number as DATA, not by sharing its sequence.
- **False pass:** none — informational, confirms the numbering model is
  sound for this specific requirement.

---

## K. Period-based tax reporting and the VAT-filing lock

### MTP-TAX-62 — A backdated entry into an already-filed VAT period is refused
- **Persona / permission:** `accounting.period.close` (to record the
  filing — API-only, see Gaps section) plus `sales.invoice.confirm`.
- **Preconditions:** **this scenario needs a VAT filing recorded first, and
  no screen does that (see Gaps)** — reachable only via
  `POST /gl/vat-filings` directly. If exercising this end-to-end, record a
  filing for last month via that endpoint (period, net amount, reference),
  then proceed.
- **Steps:**
  1. With last month filed, attempt to confirm a NEW sales invoice DATED
     inside last month.
- **Expected:** refused with a message naming the filing
  ("لا يمكن الترحيل بتاريخ ...: إقرار ضريبة القيمة المضافة عن هذه الفترة
  ... قد قُدّم بالفعل. عدّل الإقرار أولاً إن كان لا بد من التغيير.") — a
  filed period's output/input tax must not silently move after the return
  went to the authority.
- **False pass:** the invoice failing for a DIFFERENT reason (e.g. a closed
  fiscal period) being mistaken for this specific guard — the two locks
  are independent (`assertVatPeriodOpen` runs alongside, not instead of, the
  fiscal-period gate); confirm the error message is the VAT-specific one.

### MTP-TAX-63 — Amending a filed VAT period requires a reason, and the reason is retained
- **Persona / permission:** same as above, API-only.
- **Preconditions:** the filing from MTP-TAX-62.
- **Steps:**
  1. Call the amend path (`amendVatFiling`) with an empty reason.
  2. Retry with a real reason, e.g. "تصحيح فاتورة مسجلة بتاريخ خاطئ".
- **Expected:** the empty-reason attempt is refused ("سبب تعديل الإقرار
  مطلوب."); the successful amend flips status to "amended" and stores
  `amendmentReason`/`amendedAt`, after which the earlier-refused backdated
  posting from MTP-TAX-62 would now be allowed.
- **False pass:** none — API-level confirmation only, since no screen
  reaches this path (see Gaps).

### MTP-TAX-64 — The VAT return's period picker cannot select `from > to`
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** none.
- **Steps:**
  1. Open the VAT return report, set **من تاريخ** after **إلى تاريخ**.
  2. Try to run the report.
- **Expected:** refused with "تاريخ البداية يجب أن يسبق تاريخ النهاية" —
  the report's own zod schema enforces this before any data is queried.
- **False pass:** the report silently returning an EMPTY result set for an
  inverted range rather than an explicit validation error — an empty VAT
  return could be misread as "no VAT this period" rather than "invalid
  input."

### MTP-TAX-65 — A period spanning a fiscal-year boundary still sums correctly across both years
- **Persona / permission:** `accounting.reports.view`.
- **Preconditions:** the seeded ~2.5 years of trading history
  (`demo-seed/history.ts`).
- **Steps:**
  1. Run the VAT return for a period that spans two fiscal years (e.g.
     December of one year through January of the next, if the seeded
     history covers such a boundary).
  2. Cross-check the output-tax KPI against a manual sum of the two months'
     GL movements taken separately.
- **Expected:** the combined figure equals the sum of the two months taken
  separately — the report has no year-boundary artefact (e.g. from an
  annual-reset SEQUENCE resetting document numbers, which must not be
  confused with a period boundary in the TAX figures — none of the seeded
  sequences have annual reset on, so this is specifically about the report's
  date-range query, not numbering).
- **False pass:** none specific; this is a straightforward reconciliation
  check across a boundary that's easy to get wrong with an off-by-one date
  comparison.

---

## Gaps — no screen to test

These exist in the domain and/or the API but have no reachable UI, so no
manual scenario above exercises them end-to-end through the app. Listed here
per the task's instruction rather than written as false scenarios.

- **Recording a VAT filing has no screen at all.** `POST /gl/vat-filings`
  and `POST /gl/vat-filings/:id/amend` (`packages/api/src/gl-routes.ts`) and
  the domain functions `recordVatFiling` / `amendVatFiling`
  (`packages/domain/src/tax/vat-filing.ts`) are fully implemented — including
  the backdated-posting refusal this whole mechanism exists to enforce
  (MTP-TAX-62/63) — but `grep -rl "vatFiling\|vat-filings" apps/web/src`
  returns nothing. A tenant cannot record "we filed this period" from the
  app at all; the entire filed-period lock is consequently unreachable
  without direct API calls, which is not something a bookkeeper doing
  monthly VAT filing can be expected to do.
- **No withholding-tax certificate (شهادة خصم) generation.** Confirmed as a
  scenario (MTP-TAX-31) but restated here because it is a genuine gap, not
  just a missing print button: nothing in `packages/domain/src` models a
  certificate document at all, so there is nothing to build a screen FOR
  yet either.
- **The real ETA transmit is a stub, not a partial feature.**
  Restated from MTP-TAX-41: this is not "a screen with a bug" but an
  entire integration leg (`EtaTransmitPort`) that has exactly one
  implementation, and that implementation always throws. There is no
  environment or configuration in this codebase where a submission
  actually reaches the authority. Every ETA scenario above tests the
  (real, working) QUEUE; none can test actual FILING, because that
  capability does not exist yet.
- **No withholding-tax rate schedule / service-type picker.** Restated from
  MTP-TAX-30: there is a `NumberField`, not a lookup table, so there is no
  screen to test "does the system pick the right WHT rate" — it never
  tries to.
- **Tax groups have no consuming screen.** Restated from MTP-TAX-22: the
  master-data screen for **مجموعات الضرائب** exists and is testable
  (covered above), but there is no invoice-line UI anywhere that lets a
  document actually charge a compounded group rate — so "does a
  compounded tax post correctly on a real document" has no screen to run
  it on.
